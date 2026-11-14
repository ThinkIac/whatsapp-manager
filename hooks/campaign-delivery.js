import { getProxy, dispatchEvent } from 'logos';
import { createDeliveryIntent } from '../core/deliveryPipeline.js';

const db = getProxy('whatsapp-manager');

function failure(request, error, retryable = true) {
  return { ...request, accepted: false, retryable, error: error.message || String(error) };
}

/**
 * Boundary owned by the Manager. Campaign packages never receive providers,
 * credentials or bridge objects. This hook creates an auditable intent only;
 * a separate, explicit Manager action is required before provider dispatch.
 */
export async function deliverCampaignMessage(request = {}) {
  /** @register_hook whatsapp:delivery:requested */
  if (request.schemaVersion !== 1 || !request.requestId || !request.instanceId || !request.recipient?.number) {
    return failure(request, new Error('Pedido de entrega inválido.'), false);
  }
  try {
    const { intent, duplicate } = await createDeliveryIntent(db, request);
    const accepted = { ...request, accepted: true, queued: false, duplicate, deliveryIntentId: intent.id, status: intent.status };
    void dispatchEvent('whatsapp:delivery:intent-created', { schemaVersion: 1, deliveryIntentId: intent.id, instanceId: intent.instanceId, status: intent.status }).catch(() => {});
    return accepted;
  } catch (error) {
    const result = failure(request, error, error?.status !== 400 && error?.status !== 403);
    void dispatchEvent('whatsapp:delivery:failed', result).catch(() => {});
    return result;
  }
}

export async function campaignInstances(request = {}) {
  /** @register_hook whatsapp:campaign:instances:requested */
  return { ...request, instances: db.instance.all().map(({ id, name, provider, status, displayPhoneNumber }) => ({ id, name, provider, status, displayPhoneNumber })) };
}

export async function exportLegacyCampaigns(request = {}) {
  /** @register_hook whatsapp:campaign:migration-requested */
  if (request.schemaVersion !== 1) return { ...request, migration: null };
  return {
    ...request,
    migration: {
      source: 'whatsapp-manager',
      campaigns: db.campaign?.all?.() || [],
      recipients: db.campaignRecipient?.all?.() || [],
    },
  };
}
