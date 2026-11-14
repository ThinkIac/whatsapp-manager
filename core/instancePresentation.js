import { normalizeAgentBehavior } from './agentBehavior.js';
import { normalizeAgentIdentity } from './agentSafety.js';

export function metaInstancePresentation(instance) {
  let metaSendControls = {};
  try { metaSendControls = JSON.parse(instance.metaSendControls || '{}'); } catch { /* usa os defaults do painel */ }
  return {
    id: instance.id,
    name: instance.name,
    provider: 'meta_cloud',
    status: instance.status || 'open',
    phoneNumberId: instance.phoneNumberId || null,
    displayPhoneNumber: instance.displayPhoneNumber || null,
    whatsappBusinessAccountId: instance.whatsappBusinessAccountId || null,
    metaApiVersion: instance.metaApiVersion || null,
    metaSendControls,
    agentEnabled: instance.agentEnabled === true,
    specialistId: instance.specialistId || null,
    agentBehavior: normalizeAgentBehavior(instance.agentBehavior),
    agentIdentity: normalizeAgentIdentity(instance.agentIdentity),
    agentPausedReason: instance.agentPausedReason || null,
    qrcode: null,
    qrPending: false,
    lastError: null,
    reconnecting: false,
  };
}

export function listInstancePresentation(instances, getBaileysInfo) {
  return instances.map((instance) => (
    instance.provider === 'meta_cloud' ? metaInstancePresentation(instance) : instance.provider === 'evolution' ? evolutionInstancePresentation(instance) : instance.provider === 'whatsmeow' ? whatsmeowInstancePresentation(instance) : baileysInstancePresentation(instance, getBaileysInfo(instance.name))
  ));
}

// O estado do Baileys contém internamente sockets e agentes HTTP. Nunca deixe
// esse objeto atravessar a rota: além de vazar detalhes de transporte, uma
// referência circular faz o Express falhar ao serializar a lista inteira.
export function baileysInstancePresentation(instance, info = {}) {
  return {
    id: instance.id,
    name: instance.name,
    provider: 'baileys',
    status: info.status || instance.status || 'disconnected',
    qrcode: typeof info.qrcode === 'string' ? info.qrcode : null,
    proxyUrls: Array.isArray(info.proxyUrls) ? info.proxyUrls.filter((url) => typeof url === 'string') : [],
    antibotConfig: info.antibotConfig && typeof info.antibotConfig === 'object' ? { ...info.antibotConfig } : {},
    banRisk: typeof info.banRisk === 'string' ? info.banRisk : null,
    warmup: info.warmup && typeof info.warmup === 'object' ? { ...info.warmup } : null,
    lastError: typeof info.lastError === 'string' ? info.lastError : null,
    reconnecting: info.reconnecting === true,
    proxyStats: Array.isArray(info.proxyStats)
      ? info.proxyStats.map(({ url, failures, cooldownUntil }) => ({
        url: typeof url === 'string' ? url : null,
        failures: Number.isFinite(failures) ? failures : 0,
        cooldownUntil: Number.isFinite(cooldownUntil) ? cooldownUntil : 0,
      }))
      : [],
    agentEnabled: instance.agentEnabled === true,
    specialistId: instance.specialistId || null,
    agentBehavior: normalizeAgentBehavior(instance.agentBehavior),
    agentIdentity: normalizeAgentIdentity(instance.agentIdentity),
    agentPausedReason: instance.agentPausedReason || null,
  };
}

export function whatsmeowInstancePresentation(instance) {
  return { id: instance.id, name: instance.name, provider: 'whatsmeow', status: instance.status || 'connecting', qrcode: null, qrPending: instance.status === 'connecting', lastError: null, reconnecting: false,
    agentEnabled: instance.agentEnabled === true, specialistId: instance.specialistId || null, agentBehavior: normalizeAgentBehavior(instance.agentBehavior), agentIdentity: normalizeAgentIdentity(instance.agentIdentity), agentPausedReason: instance.agentPausedReason || null };
}

export function evolutionInstancePresentation(instance) {
  return {
    id: instance.id, name: instance.name, provider: 'evolution', status: instance.status || 'connecting',
    evolutionBaseUrl: instance.evolutionBaseUrl || null, qrcode: instance.evolutionQrCode || null,
    qrPending: instance.status === 'connecting' && !instance.evolutionQrCode,
    lastError: instance.evolutionLastError || null, reconnecting: false,
    agentEnabled: instance.agentEnabled === true, specialistId: instance.specialistId || null,
    agentBehavior: normalizeAgentBehavior(instance.agentBehavior), agentIdentity: normalizeAgentIdentity(instance.agentIdentity),
    agentPausedReason: instance.agentPausedReason || null,
  };
}
