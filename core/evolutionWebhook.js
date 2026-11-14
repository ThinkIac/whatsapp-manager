export function evolutionWebhookEvents(payload = {}) {
  if (Array.isArray(payload)) return payload.flatMap(evolutionWebhookEvents);
  if (payload.event) return [payload];
  return [];
}

export function normalizeEvolutionMessage(event = {}) {
  const data = event.data || {};
  const key = data.key || {};
  if (key.fromMe || !key.remoteJid || key.remoteJid.endsWith('@g.us')) return null;
  const message = data.message || {};
  const text = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || '';
  return { id: key.id || data.id || null, from: key.remoteJid.replace(/@.+$/, ''), name: data.pushName || null, text, type: message.conversation || message.extendedTextMessage ? 'text' : 'media' };
}

export function normalizeEvolutionConnection(event = {}) {
  const data = event.data || {};
  const state = String(data.state || data.status || '').toLowerCase();
  if (!state) return null;
  return ['open', 'connected'].includes(state) ? 'open' : ['close', 'closed', 'disconnected'].includes(state) ? 'disconnected' : 'connecting';
}
