import { getProxy } from 'logos';
import * as baileysManager from '../core/baileysManager.js';
import { testProxyReachable } from '../core/proxyAgent.js';
import { emitWhatsappEvent, WHATSAPP_EVENTS } from '../core/events.js';
import { listInstancePresentation, whatsmeowInstancePresentation } from '../core/instancePresentation.js';
import { normalizeMetaSendControls } from '../core/metaSendControls.js';
import { normalizeAgentBehavior } from '../core/agentBehavior.js';
import { normalizeAgentIdentity } from '../core/agentSafety.js';
import { getSpecialistById, hasRestrictedTools, listCatalog } from '../../specialists/lib/catalog.js';
import { evolutionInstancePresentation } from '../core/instancePresentation.js';
import { requireBridge } from '../core/bridgeRegistry.js';
import { purgeInstanceData } from '../core/instanceData.js';
import { removeConversationMedia } from '../core/mediaStore.js';

const db = getProxy('whatsapp-manager');

function qrResponse(name, info) {
  const qrPending = info.status === 'connecting' && !info.qrcode;
  return {
    name,
    status: info.status,
    qrcode: info.qrcode,
    qrPending,
    message: qrPending ? 'Aguardando o WhatsApp gerar o QR Code.' : null,
    banRisk: info.banRisk,
    lastError: info.lastError,
    reconnecting: info.reconnecting,
  };
}

export async function createInstance(req) {
  /**
   * @register_router instances/create
   * @method POST
   */
  const { name, proxyPool, antibotConfig, metaSendControls, provider } = req.body || {};
  if (!name) return { status: 400, message: 'name é obrigatório' };

  const existing = db.instance.findOne({ name });
  if (provider && existing && existing.provider !== provider) return { status: 409, message: 'Já existe uma instância com esse nome em outro provedor.' };
  if (req.body?.provider === 'meta_cloud' || existing?.provider === 'meta_cloud') return { status: 400, data: { message: 'Instâncias Meta Cloud API não usam QR Code. Use a configuração Meta.' } };
  if (provider === 'whatsmeow' || existing?.provider === 'whatsmeow') {
    const result = await (await requireBridge('whatsmeow')).create(name);
    const instance = existing || await db.instance.push({ name, provider: 'whatsmeow', status: result.status || 'connecting', agentEnabled: false, createdAt: new Date() });
    instance.status = result.status || instance.status;
    return qrResponse(name, result);
  }

  const cleanPool = Array.isArray(proxyPool) ? proxyPool.map((p) => p.trim()).filter(Boolean) : [];

  const bridge = await requireBridge('baileys');
  await bridge.create(name, { proxyPool: cleanPool, antibotConfig });
  await baileysManager.waitForQr(name, 10000);
  const info = await bridge.getQr(name);

  return qrResponse(name, info);
}

export async function testProxies(req) {
  /**
   * @register_router instances/test-proxies
   * @method POST
   */
  const { proxyUrls } = req.body || {};
  const list = Array.isArray(proxyUrls) ? proxyUrls.map((p) => p.trim()).filter(Boolean) : [];
  if (!list.length) return { results: [] };

  const results = await Promise.all(
    list.map(async (proxyUrl) => ({ proxyUrl, ...(await testProxyReachable(proxyUrl)) }))
  );
  return { results };
}

export async function regenerateQr(req) {
  /**
   * @register_router instances/:name/regenerate-qr
   * @method POST
   */
  const { name } = req.params;
  const instance = db.instance.findOne({ name });
  if (instance?.provider === 'meta_cloud') return { status: 400, data: { message: 'Instâncias Meta Cloud API não usam QR Code.' } };
  if (instance?.provider === 'evolution') return { status: 400, message: 'Use o endpoint Evolution para gerar o QR Code.' };
  if (instance?.provider === 'whatsmeow') return qrResponse(name, await (await requireBridge('whatsmeow')).regenerateQr(name));
  const info = await (await requireBridge('baileys')).regenerateQr(name);
  return qrResponse(name, info);
}

export async function getInstanceQr(req) {
  /**
   * @register_router instances/:name/qr
   */
  const { name } = req.params;
  const instance = db.instance.findOne({ name });
  if (instance?.provider === 'meta_cloud') return { status: 400, data: { message: 'Instâncias Meta Cloud API não usam QR Code.' } };
  if (instance?.provider === 'evolution') return { status: 400, message: 'Use o endpoint Evolution para consultar o QR Code.' };
  if (instance?.provider === 'whatsmeow') return qrResponse(name, await (await requireBridge('whatsmeow')).getQr(name));
  const info = await (await requireBridge('baileys')).getQr(name);
  return qrResponse(name, info);
}

export async function listInstances(req) {
  /**
   * @register_router instances/list
   */
  // O whatsmeow mantém o estado da conexão no sidecar. O registro local é
  // apenas uma configuração persistida, portanto não pode ser a fonte de
  // verdade para o indicador de conexão nem para habilitar novos chats.
  const instances = db.instance.all();
  const presented = await Promise.all(instances.map(async (instance) => {
    if (instance.provider !== 'whatsmeow') return null;
    try {
      const live = await (await requireBridge('whatsmeow')).getQr(instance.name);
      instance.status = live.status || instance.status;
      return whatsmeowInstancePresentation(instance);
    } catch {
      // Mantém o último estado conhecido se o sidecar estiver temporariamente
      // indisponível, sem tornar a listagem inteira indisponível.
      return whatsmeowInstancePresentation(instance);
    }
  }));
  return instances.map((instance, index) => instance.provider === 'whatsmeow'
    ? presented[index]
    : listInstancePresentation([instance], baileysManager.getInstanceInfo)[0]);
}

export function listEligibleSpecialists() {
  /**
   * @register_router instances/specialists
   * @method GET
   */
  // Não peça o catálogo diretamente ao pacote Specialists pela view. Um
  // operador pode ter permissão para administrar esta instância sem permissão
  // para abrir a aplicação Specialists; nesse caso a falha de autorização era
  // tratada como um select vazio. Esta rota expõe somente o resumo necessário
  // para configurar o atendimento automático.
  return {
    specialists: listCatalog()
      .filter(hasRestrictedTools)
      .map(({ id, name, description }) => ({ id, name, description: description || null })),
  };
}

export async function deleteInstance(req) {
  /**
   * @register_router instances/delete
   * @method POST
   */
  const { name } = req.body || {};
  if (!name) return { status: 400, message: 'name é obrigatório' };
  const instance = db.instance.findOne({ name });
  if (!instance) return { status: 404, message: 'Instância não encontrada' };
  if (instance?.provider === 'evolution') return { status: 400, message: 'Remova a instância Evolution pelo fluxo Evolution.' };
  if (instance?.provider === 'whatsmeow') {
    // O sidecar encerra a sessão e remove suas credenciais. O Manager ainda é
    // responsável pelo histórico, mídias e pelo registro persistido local.
    await (await requireBridge('whatsmeow')).remove(name);
    for (const conversation of db.conversation.query({ instanceId: instance.id })) removeConversationMedia(conversation.id);
    const removed = await purgeInstanceData(db, instance);
    await emitWhatsappEvent('whatsapp:instance:deleted', { instanceId: instance.id, instanceName: instance.name, provider: 'whatsmeow', removed });
    return { success: true, removed };
  }
  if (instance?.provider === 'meta_cloud') {
    // A Cloud API não possui uma "instância" equivalente para apagar por esta
    // integração. A remoção limpa somente o vínculo e o histórico locais.
    for (const conversation of db.conversation.query({ instanceId: instance.id })) removeConversationMedia(conversation.id);
    const removed = await purgeInstanceData(db, instance);
    await emitWhatsappEvent('whatsapp:instance:deleted', { instanceId: instance.id, instanceName: instance.name, provider: 'meta_cloud', removed });
    return { success: true, removed, localOnly: true };
  }
  return (await requireBridge('baileys')).remove(name);
}

export async function disconnectInstance(req) {
  /**
   * @register_router instances/disconnect
   * @method POST
   */
  const { name } = req.body || {};
  if (!name) return { status: 400, message: 'name é obrigatório' };
  const instance = db.instance.findOne({ name });
  if (instance?.provider === 'meta_cloud') return { status: 400, message: 'Instâncias Meta Cloud API não são desconectadas por QR.' };
  if (instance?.provider === 'evolution') return { status: 400, message: 'Desconecte a instância Evolution pelo fluxo Evolution.' };
  if (instance?.provider === 'whatsmeow') return (await requireBridge('whatsmeow')).disconnect(name);
  return (await requireBridge('baileys')).disconnect(name);
}

export async function updateInstanceSettings(req) {
  /**
   * @register_router instances/settings
   * @method POST
   */
  const { name, proxyPool, antibotConfig, metaSendControls, agentEnabled, specialistId, agentBehavior, agentIdentity } = req.body || {};
  const instance = db.instance.findOne({ name });
  if (!instance) return { status: 404, message: 'Instância não encontrada' };
  if (instance.provider === 'meta_cloud' || instance.provider === 'evolution' || instance.provider === 'whatsmeow') {
    if (instance.provider === 'meta_cloud' && metaSendControls !== undefined) instance.metaSendControls = JSON.stringify(normalizeMetaSendControls(metaSendControls));
    if (agentEnabled !== undefined) instance.agentEnabled = agentEnabled === true;
    if (specialistId !== undefined) instance.specialistId = specialistId ? String(specialistId) : null;
    if (agentBehavior !== undefined) instance.agentBehavior = JSON.stringify(normalizeAgentBehavior(agentBehavior));
    if (agentIdentity !== undefined) instance.agentIdentity = JSON.stringify(normalizeAgentIdentity(agentIdentity));
    if (instance.agentEnabled && !instance.specialistId) return { status: 400, message: 'Escolha um especialista antes de ativar as respostas automáticas.' };
    if (instance.agentEnabled && !hasRestrictedTools(getSpecialistById(instance.specialistId))) return { status: 400, message: 'Respostas automáticas exigem um especialista com ferramentas restritas.' };
    if (metaSendControls === undefined && agentEnabled === undefined && specialistId === undefined && agentBehavior === undefined && agentIdentity === undefined) return { status: 400, message: 'Informe controles de envio ou a configuração do agente.' };
    if (instance.provider === 'evolution') return { success: true, instance: evolutionInstancePresentation(instance) };
    return { success: true, instance: { ...instance, metaSendControls: normalizeMetaSendControls(instance.metaSendControls), agentBehavior: normalizeAgentBehavior(instance.agentBehavior), agentIdentity: normalizeAgentIdentity(instance.agentIdentity) } };
  }
  let normalizedAntibotConfig = baileysManager.getInstanceInfo(name).antibotConfig;
  if (antibotConfig !== undefined) {
    normalizedAntibotConfig = baileysManager.updateInstanceAntibotConfig(name, antibotConfig);
    await emitWhatsappEvent('whatsapp:antiban:updated', {
      instanceId: instance.id,
      instanceName: name,
      config: normalizedAntibotConfig,
    });
  }

  if (proxyPool !== undefined) {
    const cleanPool = Array.isArray(proxyPool) ? proxyPool.map((p) => p.trim()).filter(Boolean) : [];
    await baileysManager.updateInstanceProxyPool(name, cleanPool);
  }

  return { success: true, instance: baileysManager.getInstanceInfo(name) };
}

export function listEvents(req) {
  /**
   * @register_router events
   */
  return { events: WHATSAPP_EVENTS };
}

export function capabilities() {
  /** @register_router capabilities @method GET */
  return { local: false, createInstance: true };
}
