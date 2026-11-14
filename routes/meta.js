import { getProxy } from 'logos';
import { readMetaConfig, metaPublicConfig, assertMetaConfig } from '../core/metaConfig.js';
import { MetaCloudClient } from '../core/metaCloudApi.js';
import { verifyMetaWebhook, webhookChallenge, metaChanges, webhookDiagnostic } from '../core/metaWebhook.js';
import { emitWhatsappEvent } from '../core/events.js';
import { handleMetaIncomingMessage, handleMetaStatus } from '../core/conversationEngine.js';
import { normalizeMetaSendControls } from '../core/metaSendControls.js';
import { normalizeAgentIdentity } from '../core/agentSafety.js';
import { getSpecialistById, hasRestrictedTools } from '../../specialists/lib/catalog.js';

const db = getProxy('whatsapp-manager');
let lastRejectedWebhook = null;
let lastWebhook = null;

export async function createMetaInstance(req) {
  /**
   * @register_router meta/instances
   * @method post
   */
  const { name, phoneNumberId, whatsappBusinessAccountId, displayPhoneNumber, metaApiVersion, agentEnabled = false, specialistId = null, agentIdentity } = req.body || {};
  if (!name || !phoneNumberId) return { status: 400, data: { message: 'name e phoneNumberId são obrigatórios' } };
  if (db.instance.findOne({ name })) return { status: 409, data: { message: 'Já existe uma instância com este nome' } };
  if (agentEnabled && !specialistId) return { status: 400, data: { message: 'Escolha um especialista antes de ativar as respostas automáticas.' } };
  if (agentEnabled && !hasRestrictedTools(getSpecialistById(specialistId))) return { status: 400, data: { message: 'Respostas automáticas exigem um especialista com ferramentas restritas.' } };
  const instance = await db.instance.push({ name, provider: 'meta_cloud', phoneNumberId, whatsappBusinessAccountId: whatsappBusinessAccountId || null, displayPhoneNumber: displayPhoneNumber || null, metaApiVersion: metaApiVersion || readMetaConfig().apiVersion, metaSendControls: JSON.stringify(normalizeMetaSendControls()), agentEnabled: agentEnabled === true, specialistId: specialistId || null, agentIdentity: JSON.stringify(normalizeAgentIdentity(agentIdentity)), status: 'open' });
  await emitWhatsappEvent('whatsapp:instance:created', { instanceId: instance.id, instanceName: instance.name, provider: 'meta_cloud' });
  return { success: true, instance: publicInstance(instance) };
}

export function metaStatus() {
  /** @register_router meta/status */
  return metaPublicConfig();
}

export async function testMetaConnection() {
  /**
   * @register_router meta/test
   * @method post
   */
  const config = assertMetaConfig();
  const client = new MetaCloudClient(config);
  const result = await client.request(`${config.phoneNumberId}?fields=id,display_phone_number`);
  return { success: true, phoneNumberId: result.id || config.phoneNumberId, displayPhoneNumber: result.display_phone_number || null };
}

export function verifyWebhook(req) {
  /** @register_router meta/webhook
   * @public true
   */
  return webhookChallenge(req.query || {}, readMetaConfig().verifyToken);
}

export async function receiveWebhook(req) {
  /**
   * @register_router meta/webhook
   * @public true
   * @method post
   */
  const config = readMetaConfig();
  const rawBody = typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody) ? req.rawBody : null;
  if (!verifyMetaWebhook({ rawBody, signature: req.headers?.['x-hub-signature-256'], appSecret: config.appSecret })) {
    lastRejectedWebhook = webhookDiagnostic({ outcome: 'rejected' });
    console.warn('[whatsapp:meta:webhook] rejected');
    return { status: 401, data: { message: 'Assinatura inválida' } };
  }
  let received = 0;
  let statuses = 0;
  const failures = { messages: 0, statuses: 0 };
  const ignored = { unknownInstance: 0, duplicateOrInvalidMessage: 0, unmatchedOrStaleStatus: 0 };
  for (const value of metaChanges(req.body)) {
    const phoneNumberId = value.metadata?.phone_number_id;
    const instance = phoneNumberId && db.instance.findOne({ provider: 'meta_cloud', phoneNumberId });
    if (!instance) { ignored.unknownInstance += 1; continue; }
    let instanceReceived = 0;
    let instanceStatuses = 0;
    const instanceFailures = { messages: 0, statuses: 0 };
    for (const message of value.messages || []) {
      try {
        if (await handleMetaIncomingMessage(instance, message, value.contacts || [])) { received++; instanceReceived++; }
        else ignored.duplicateOrInvalidMessage++;
      } catch {
        failures.messages++; instanceFailures.messages++;
      }
    }
    for (const status of value.statuses || []) {
      try {
        if (await handleMetaStatus(instance, status)) { statuses++; instanceStatuses++; }
        else ignored.unmatchedOrStaleStatus++;
      } catch {
        failures.statuses++; instanceFailures.statuses++;
      }
    }
    instance.metaWebhookDiagnostic = JSON.stringify({ ...webhookDiagnostic({ outcome: instanceFailures.messages || instanceFailures.statuses ? 'failed' : 'received', received: instanceReceived, statuses: instanceStatuses }), failures: instanceFailures });
  }
  const failed = failures.messages + failures.statuses > 0;
  lastWebhook = { ...webhookDiagnostic({ outcome: failed ? 'failed' : 'received', received, statuses }), ignored, failures };
  console.info('[whatsapp:meta:webhook]', JSON.stringify(lastWebhook));
  // Non-2xx allows the provider to retry; persisted messages are deduplicated by ID.
  const result = { success: !failed, received, statuses, ignored, failures };
  return failed ? { status: 500, data: result } : result;
}

export function metaWebhookDiagnostics(req) {
  /** @register_router meta/diagnostics */
  const instanceId = req.query?.instanceId;
  const instances = db.instance.query(instanceId ? { id: instanceId, provider: 'meta_cloud' } : { provider: 'meta_cloud' });
  return {
    instances: instances.map((instance) => ({ id: instance.id, name: instance.name, diagnostic: parseDiagnostic(instance.metaWebhookDiagnostic) })),
    lastRejectedWebhook,
    lastWebhook,
  };
}

function parseDiagnostic(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

function publicInstance(instance) {
  const { proxyPool, proxyUrl, antibotConfig, ...safe } = instance;
  return safe;
}
