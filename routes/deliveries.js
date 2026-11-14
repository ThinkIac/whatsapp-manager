import { getProxy } from 'logos';
import { createDeliveryIntent, dispatchDeliveryIntent, transitionDeliveryIntent } from '../core/deliveryPipeline.js';
import { sendText, sendTemplate } from '../core/providerRouter.js';
import { recordDeliveryMessage } from '../core/deliveryHistory.js';
import { emitWhatsappEvent } from '../core/events.js';

const db = getProxy('whatsapp-manager');

export async function listDeliveries(req) {
  /** @register_router deliveries/list */
  const status = req.query?.status;
  return { deliveries: db.deliveryIntent.query(status ? { status } : {}, { sort: 'createdAt DESC', limit: 200 }) };
}

export async function approveDelivery(req) {
  /** @register_router deliveries/:id/approve @method POST */
  const intent = await transitionDeliveryIntent(db, req.params.id, 'approved', { actor: 'operator', reason: req.body?.reason });
  await emitWhatsappEvent('whatsapp:delivery:approved', { schemaVersion: 1, deliveryIntentId: intent.id, instanceId: intent.instanceId });
  return { success: true, delivery: intent };
}

export async function queueDelivery(req) {
  /** @register_router deliveries/:id/queue @method POST */
  const intent = await transitionDeliveryIntent(db, req.params.id, 'queued', { actor: 'operator' });
  await emitWhatsappEvent('whatsapp:delivery:queued', { schemaVersion: 1, deliveryIntentId: intent.id, instanceId: intent.instanceId });
  return { success: true, delivery: intent };
}

export async function cancelDelivery(req) {
  /** @register_router deliveries/:id/cancel @method POST */
  const intent = await transitionDeliveryIntent(db, req.params.id, 'cancelled', { actor: 'operator', reason: req.body?.reason });
  await emitWhatsappEvent('whatsapp:delivery:cancelled', { schemaVersion: 1, deliveryIntentId: intent.id, instanceId: intent.instanceId });
  return { success: true, delivery: intent };
}

export async function dispatchDelivery(req) {
  /** @register_router deliveries/:id/dispatch @method POST */
  const result = await dispatchDeliveryIntent(db, req.params.id, { sendText, sendTemplate });
  const sourceMessage = result.intent.sourceMessageId && db.message[result.intent.sourceMessageId];
  if (result.accepted && sourceMessage) {
    Object.assign(sourceMessage, { status: 'sent', waMessageId: result.providerMessageId, error: null });
  } else if (result.accepted && JSON.parse(result.intent.message).type === 'text') {
    await recordDeliveryMessage(db, { instance: db.instance[result.intent.instanceId], number: result.intent.recipientNumber, text: JSON.parse(result.intent.message).text, providerMessageId: result.providerMessageId, variables: JSON.parse(result.intent.recipientVariables || '{}') });
  }
  await emitWhatsappEvent(result.accepted ? 'whatsapp:delivery:accepted' : 'whatsapp:delivery:failed', { schemaVersion: 1, deliveryIntentId: result.intent.id, ...result });
  return result;
}

export async function requestDelivery(req) {
  /** @register_router deliveries/request @method POST */
  try {
    const { intent, duplicate } = await createDeliveryIntent(db, req.body, { actor: 'automation' });
    await emitWhatsappEvent('whatsapp:delivery:intent-created', { schemaVersion: 1, deliveryIntentId: intent.id, instanceId: intent.instanceId, status: intent.status });
    return { accepted: true, queued: false, duplicate, deliveryIntentId: intent.id, status: intent.status };
  } catch (error) {
    return { accepted: false, retryable: error.retryable !== false, message: error.message, status: error.status || 400 };
  }
}
