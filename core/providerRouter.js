import { MetaCloudClient } from './metaCloudApi.js';
import { assertMetaConfig, readMetaConfig } from './metaConfig.js';
import { requireBridge } from './bridgeRegistry.js';

function metaClient(instance) {
  const base = readMetaConfig();
  const config = assertMetaConfig({ ...base, phoneNumberId: instance.phoneNumberId || base.phoneNumberId, apiVersion: instance.metaApiVersion || base.apiVersion });
  return new MetaCloudClient({ ...config, phoneNumberId: instance.phoneNumberId || config.phoneNumberId });
}

export function isMetaInstance(instance) { return instance?.provider === 'meta_cloud'; }
export function isEvolutionInstance(instance) { return instance?.provider === 'evolution'; }
export function isWhatsmeowInstance(instance) { return instance?.provider === 'whatsmeow'; }

export async function sendText(instance, recipient, text, authorize, options = {}) {
  await authorize?.();
  if (isMetaInstance(instance)) return metaClient(instance).sendText(String(recipient).replace(/\D/g, ''), text);
  return (await requireBridge(instance?.provider || 'baileys')).sendText(instance, recipient, text, authorize, options);
}

export async function sendMedia(instance, recipient, media, authorize) {
  await authorize?.();
  const bridge = await requireBridge(instance?.provider || 'baileys');
  if (typeof bridge.sendMedia !== 'function') throw new Error(`O bridge whatsapp-${bridge.id} ainda não oferece envio de mídia.`);
  return bridge.sendMedia(instance, recipient, media, authorize);
}

export async function sendTemplate(instance, recipient, template, authorize) {
  await authorize?.();
  if (!isMetaInstance(instance)) throw new Error('Templates oficiais exigem uma instância Meta Cloud API');
  return metaClient(instance).sendTemplate(String(recipient).replace(/\D/g, ''), template.name, template.languageCode, template.components);
}

export function clientForInstance(instance) { return isMetaInstance(instance) ? metaClient(instance) : null; }
