const TERMINAL = new Set(['sent', 'failed', 'cancelled']);

export const DELIVERY_STATES = Object.freeze([
  'pending_approval', 'review', 'approved', 'queued', 'dispatching', 'sent', 'failed', 'cancelled',
]);

function cleanNumber(value) {
  const number = String(value || '').replace(/\D/g, '');
  if (number.length < 8 || number.length > 15) throw new Error('Destinatário inválido.');
  return number;
}

function messageFrom(request) {
  const message = request.message || {};
  if (message.type === 'text' && typeof message.text === 'string' && message.text.trim()) {
    return { type: 'text', text: message.text.trim() };
  }
  if (message.type === 'template' && message.template?.name && message.template?.languageCode) {
    return { type: 'template', template: message.template };
  }
  throw new Error('Mensagem de entrega inválida.');
}

function audit(db, intent, action, actor, details = {}) {
  return db.deliveryAudit.push({
    deliveryIntentId: intent.id,
    action,
    actor: actor || 'system',
    details: JSON.stringify(details),
    createdAt: new Date(),
  });
}

export async function createDeliveryIntent(db, request = {}, { actor = 'automation' } = {}) {
  if (request.schemaVersion !== 1 || !request.requestId || !request.instanceId) {
    throw Object.assign(new Error('Pedido de entrega inválido.'), { retryable: false });
  }
  const existing = db.deliveryIntent.findOne({ requestId: String(request.requestId) });
  if (existing) return { intent: existing, duplicate: true };

  const instance = db.instance[request.instanceId];
  if (!instance) throw Object.assign(new Error('Instância não encontrada.'), { retryable: false });
  const intent = await db.deliveryIntent.push({
    requestId: String(request.requestId),
    source: String(request.source || (request.campaignId ? 'campaign' : 'automation')),
    campaignId: request.campaignId || null,
    recipientId: request.recipientId || null,
    sourceMessageId: request.sourceMessageId || null,
    instanceId: instance.id,
    recipientNumber: cleanNumber(request.recipient?.number),
    recipientVariables: JSON.stringify(request.recipient?.variables || {}),
    message: JSON.stringify(messageFrom(request)),
    status: request.review === true ? 'review' : 'pending_approval',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await audit(db, intent, 'created', actor, { source: intent.source });
  return { intent, duplicate: false };
}

export async function transitionDeliveryIntent(db, id, nextStatus, { actor = 'operator', reason = null } = {}) {
  const intent = db.deliveryIntent[id];
  if (!intent) throw Object.assign(new Error('Entrega não encontrada.'), { status: 404 });
  if (!DELIVERY_STATES.includes(nextStatus)) throw new Error('Estado de entrega inválido.');
  if (TERMINAL.has(intent.status)) throw Object.assign(new Error('A entrega já foi finalizada.'), { status: 409 });
  const allowed = {
    pending_approval: ['approved', 'review', 'cancelled'],
    review: ['approved', 'cancelled'],
    approved: ['queued', 'cancelled'],
    queued: ['dispatching', 'cancelled'],
    dispatching: ['sent', 'failed'],
  };
  if (!allowed[intent.status]?.includes(nextStatus)) throw Object.assign(new Error('Transição de entrega não permitida.'), { status: 409 });
  const previousStatus = intent.status;
  intent.status = nextStatus;
  intent.updatedAt = new Date();
  if (nextStatus === 'approved') { intent.approvedAt = intent.updatedAt; intent.approvedBy = actor; }
  if (nextStatus === 'cancelled') { intent.cancelledAt = intent.updatedAt; intent.cancelReason = reason || null; }
  await audit(db, intent, nextStatus, actor, { previousStatus, reason: reason || null });
  return intent;
}

export async function dispatchDeliveryIntent(db, id, { sendText, sendTemplate, actor = 'dispatcher' } = {}) {
  const intent = db.deliveryIntent[id];
  if (!intent) throw Object.assign(new Error('Entrega não encontrada.'), { status: 404 });
  if (intent.status === 'approved') await transitionDeliveryIntent(db, id, 'queued', { actor });
  if (intent.status !== 'queued') throw Object.assign(new Error('A entrega precisa estar aprovada e na fila.'), { status: 409 });
  await transitionDeliveryIntent(db, id, 'dispatching', { actor });
  const instance = db.instance[intent.instanceId];
  if (!instance || instance.status !== 'open') {
    await transitionDeliveryIntent(db, id, 'failed', { actor, reason: 'Instância não está conectada.' });
    return { intent, accepted: false, retryable: true, error: 'Instância não está conectada.' };
  }
  const message = JSON.parse(intent.message);
  try {
    const sent = message.type === 'template'
      ? await sendTemplate(instance, intent.recipientNumber, message.template)
      : await sendText(instance, intent.recipientNumber, message.text);
    intent.providerMessageId = sent?.providerMessageId || sent?.id || null;
    intent.provider = instance.provider;
    await transitionDeliveryIntent(db, id, 'sent', { actor });
    return { intent, accepted: true, providerMessageId: intent.providerMessageId, provider: intent.provider };
  } catch (error) {
    await transitionDeliveryIntent(db, id, 'failed', { actor, reason: error.message || String(error) });
    return { intent, accepted: false, retryable: error?.status !== 400 && error?.status !== 403, error: error.message || String(error) };
  }
}
