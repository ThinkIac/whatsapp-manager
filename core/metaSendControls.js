export const DEFAULT_META_SEND_CONTROLS = Object.freeze({
  enabled: true,
  maxPerHour: 250,
  maxPerDay: 1000,
  maxCampaignRecipients: 500,
  maxCampaignEstimatedSpend: 0,
  estimatedUnitCost: 0,
});

function number(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function normalizeMetaSendControls(value = {}) {
  let source = value;
  if (typeof source === 'string') { try { source = JSON.parse(source); } catch { source = {}; } }
  if (!source || typeof source !== 'object' || Array.isArray(source)) source = {};
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_META_SEND_CONTROLS.enabled,
    maxPerHour: Math.round(number(source.maxPerHour, DEFAULT_META_SEND_CONTROLS.maxPerHour, 1, 100000)),
    maxPerDay: Math.round(number(source.maxPerDay, DEFAULT_META_SEND_CONTROLS.maxPerDay, 1, 1000000)),
    maxCampaignRecipients: Math.round(number(source.maxCampaignRecipients, DEFAULT_META_SEND_CONTROLS.maxCampaignRecipients, 1, 1000000)),
    maxCampaignEstimatedSpend: number(source.maxCampaignEstimatedSpend, DEFAULT_META_SEND_CONTROLS.maxCampaignEstimatedSpend, 0, 1000000),
    estimatedUnitCost: number(source.estimatedUnitCost, DEFAULT_META_SEND_CONTROLS.estimatedUnitCost, 0, 100000),
  };
}

export function checkMetaCampaignAllowance(controlsInput, { hourSent = 0, daySent = 0, recipientCount = 0 } = {}) {
  const controls = normalizeMetaSendControls(controlsInput);
  if (!controls.enabled) return { allowed: true, estimatedSpend: 0 };
  const estimatedSpend = recipientCount * controls.estimatedUnitCost;
  if (recipientCount > controls.maxCampaignRecipients) return { allowed: false, message: `A campanha excede o máximo de ${controls.maxCampaignRecipients} destinatários.`, estimatedSpend };
  if (hourSent + recipientCount > controls.maxPerHour) return { allowed: false, message: 'A campanha excede o limite de envio por hora.', estimatedSpend };
  if (daySent + recipientCount > controls.maxPerDay) return { allowed: false, message: 'A campanha excede o limite de envio por dia.', estimatedSpend };
  if (controls.maxCampaignEstimatedSpend > 0 && estimatedSpend > controls.maxCampaignEstimatedSpend) return { allowed: false, message: 'O gasto estimado da campanha excede o limite definido.', estimatedSpend };
  return { allowed: true, estimatedSpend };
}

export function metaUsageSince(messages = [], instanceId, now = new Date()) {
  const current = new Date(now).getTime();
  const hourAgo = current - 60 * 60 * 1000;
  const dayAgo = current - 24 * 60 * 60 * 1000;
  return messages.reduce((usage, message) => {
    if (message.instanceId !== instanceId || message.direction !== 'out' || message.status === 'failed') return usage;
    const timestamp = new Date(message.timestamp || message.sentAt || 0).getTime();
    if (!Number.isFinite(timestamp)) return usage;
    if (timestamp >= hourAgo) usage.hourSent += 1;
    if (timestamp >= dayAgo) usage.daySent += 1;
    return usage;
  }, { hourSent: 0, daySent: 0 });
}

export function approvedTemplate(template) {
  return template && String(template.status || '').toUpperCase() === 'APPROVED' && template.name && (template.language || template.languageCode);
}

export function templateComponentsFromRecipient(variableSources = [], recipient = {}) {
  if (!variableSources.length) return [];
  return [{ type: 'body', parameters: variableSources.map((source) => {
    // `string` é o formato legado: o nome de uma coluna do CSV.
    if (typeof source === 'string') return { type: 'text', text: String(recipient[source] ?? '') };
    if (source?.type === 'text') return { type: 'text', text: String(source.value ?? '') };
    return { type: 'text', text: String(recipient[source?.value] ?? '') };
  }) }];
}
