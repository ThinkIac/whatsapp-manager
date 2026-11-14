import { getProxy } from 'logos';
import { randomUUID } from 'node:crypto';
import { EvolutionApiClient, evolutionConnectionInfo } from '../core/evolutionApi.js';
import { evolutionWebhookEvents, normalizeEvolutionConnection, normalizeEvolutionMessage } from '../core/evolutionWebhook.js';
import { handleEvolutionIncomingMessage } from '../core/conversationEngine.js';
import { emitWhatsappEvent } from '../core/events.js';
import { normalizeAgentBehavior } from '../core/agentBehavior.js';
import { normalizeAgentIdentity } from '../core/agentSafety.js';
import { getSpecialistById, hasRestrictedTools } from '../../specialists/lib/catalog.js';
import { evolutionInstancePresentation } from '../core/instancePresentation.js';
import { canDeleteInstance, purgeInstanceData } from '../core/instanceData.js';
import { removeConversationMedia } from '../core/mediaStore.js';

const db = getProxy('whatsapp-manager');

function client(instance) { return new EvolutionApiClient({ baseUrl: instance.evolutionBaseUrl, apiKey: instance.evolutionApiKey }); }

function webhookUrl(req, secret) {
  const configured = process.env.WHATSAPP_MANAGER_PUBLIC_URL || process.env.PUBLIC_URL;
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  const protocol = req.headers?.['x-forwarded-proto'] || 'https';
  const origin = configured || (host ? `${protocol}://${host}` : null);
  if (!origin) throw new Error('Defina WHATSAPP_MANAGER_PUBLIC_URL para configurar o webhook Evolution.');
  const url = new URL('/whatsapp-manager/evolution/webhook', origin);
  url.searchParams.set('token', secret);
  return url.toString();
}

function updateInfo(instance, state, connect) {
  const info = evolutionConnectionInfo(state, connect);
  instance.status = info.status;
  instance.evolutionQrCode = info.qrcode;
  instance.evolutionLastError = null;
  return info;
}

export async function createEvolutionInstance(req) {
  /**
   * @register_router evolution/instances
   * @method POST
   */
  const { name, baseUrl, apiKey, agentEnabled = false, specialistId = null, agentBehavior, agentIdentity } = req.body || {};
  if (!name || !baseUrl || !apiKey) return { status: 400, message: 'name, baseUrl e apiKey são obrigatórios.' };
  if (db.instance.findOne({ name })) return { status: 409, message: 'Já existe uma instância com este nome.' };
  if (agentEnabled && !specialistId) return { status: 400, message: 'Escolha um especialista antes de ativar as respostas automáticas.' };
  if (agentEnabled && !hasRestrictedTools(getSpecialistById(specialistId))) return { status: 400, message: 'Respostas automáticas exigem um especialista com ferramentas restritas.' };
  const webhookSecret = randomUUID();
  let hook;
  try { hook = webhookUrl(req, webhookSecret); } catch (error) { return { status: 400, message: error.message }; }
  const draft = { name: String(name).trim(), evolutionBaseUrl: String(baseUrl).trim(), evolutionApiKey: String(apiKey).trim(), evolutionWebhookSecret: webhookSecret };
  try {
    const api = client(draft);
    const created = await api.createInstance(draft.name);
    await api.setWebhook(draft.name, hook);
    const connected = await api.connect(draft.name);
    const state = await api.connectionState(draft.name);
    const info = evolutionConnectionInfo(state, created?.qrcode ? created : connected);
    const instance = await db.instance.push({ ...draft, provider: 'evolution', status: info.status, evolutionQrCode: info.qrcode, evolutionWebhookUrl: hook, evolutionLastError: null, agentEnabled: agentEnabled === true, specialistId: specialistId || null, agentBehavior: JSON.stringify(normalizeAgentBehavior(agentBehavior)), agentIdentity: JSON.stringify(normalizeAgentIdentity(agentIdentity)), createdAt: new Date() });
    await emitWhatsappEvent('whatsapp:instance:created', { instanceId: instance.id, instanceName: instance.name, provider: 'evolution' });
    return { success: true, instance: evolutionInstancePresentation(instance) };
  } catch (error) {
    return { status: 502, message: `Não foi possível criar a instância na Evolution: ${error.message}` };
  }
}

export async function evolutionInstanceQr(req) {
  /** @register_router evolution/instances/:name/qr */
  const instance = db.instance.findOne({ name: req.params?.name, provider: 'evolution' });
  if (!instance) return { status: 404, message: 'Instância Evolution não encontrada.' };
  try {
    const [state, connect] = await Promise.all([client(instance).connectionState(instance.name), client(instance).connect(instance.name)]);
    updateInfo(instance, state, connect);
    return evolutionInstancePresentation(instance);
  } catch (error) {
    instance.evolutionLastError = error.message;
    return { status: 502, message: `Não foi possível consultar a Evolution: ${error.message}` };
  }
}

export async function evolutionDisconnect(req) {
  /**
   * @register_router evolution/instances/disconnect
   * @method POST
   */
  const instance = db.instance.findOne({ name: req.body?.name, provider: 'evolution' });
  if (!instance) return { status: 404, message: 'Instância Evolution não encontrada.' };
  try { await client(instance).logout(instance.name); } catch (error) { return { status: 502, message: `Não foi possível desconectar na Evolution: ${error.message}` }; }
  instance.status = 'disconnected'; instance.evolutionQrCode = null;
  await emitWhatsappEvent('whatsapp:instance:disconnected', { instanceId: instance.id, instanceName: instance.name, status: 'disconnected', reason: 'operator' });
  return { success: true, instance: evolutionInstancePresentation(instance) };
}

export async function evolutionDelete(req) {
  /**
   * @register_router evolution/instances/delete
   * @method POST
   */
  const instance = db.instance.findOne({ name: req.body?.name, provider: 'evolution' });
  if (!instance) return canDeleteInstance(instance);
  // Apagar é final, como nos conectores locais: encerra primeiro a sessão
  // remota para não deixar o número conectado quando a remoção for concluída.
  if (instance.status !== 'disconnected') {
    try { await client(instance).logout(instance.name); } catch (error) { return { status: 502, message: `Não foi possível desconectar na Evolution: ${error.message}` }; }
    instance.status = 'disconnected'; instance.evolutionQrCode = null;
    await emitWhatsappEvent('whatsapp:instance:disconnected', { instanceId: instance.id, instanceName: instance.name, status: 'disconnected', reason: 'delete' });
  }
  const permission = canDeleteInstance(instance);
  if (!permission.allowed) return permission;
  try { await client(instance).deleteInstance(instance.name); } catch (error) { return { status: 502, message: `Não foi possível apagar na Evolution: ${error.message}` }; }
  for (const conversation of db.conversation.query({ instanceId: instance.id })) removeConversationMedia(conversation.id);
  const removed = await purgeInstanceData(db, instance);
  await emitWhatsappEvent('whatsapp:instance:deleted', { instanceId: instance.id, instanceName: instance.name, removed });
  return { success: true, removed };
}

export async function receiveEvolutionWebhook(req) {
  /**
   * @register_router evolution/webhook
   * @method POST
   */
  let received = 0;
  for (const event of evolutionWebhookEvents(req.body)) {
    const name = event.instance || event.instanceName || event.data?.instanceName;
    const instance = name ? db.instance.findOne({ name, provider: 'evolution' }) : null;
    if (!instance) continue;
    if (!instance.evolutionWebhookSecret || req.query?.token !== instance.evolutionWebhookSecret) continue;
    const message = normalizeEvolutionMessage(event);
    if (message) { await handleEvolutionIncomingMessage(instance, message); received += 1; }
    const status = normalizeEvolutionConnection(event);
    if (status) {
      const changed = instance.status !== status;
      instance.status = status;
      if (status === 'open') instance.evolutionQrCode = null;
      if (changed) await emitWhatsappEvent(status === 'open' ? 'whatsapp:instance:connected' : 'whatsapp:instance:disconnected', { instanceId: instance.id, instanceName: instance.name, status });
    }
  }
  return { success: true, received };
}
