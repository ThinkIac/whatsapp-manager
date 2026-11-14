export function metaAcceptedState(providerMessageId) {
  return { status: 'sent', providerStatus: 'accepted', ...(providerMessageId ? { waMessageId: providerMessageId } : {}) };
}

export function metaDeliveryState(providerStatus = {}) {
  const status = providerStatus.status;
  if (!['sent', 'delivered', 'read', 'failed'].includes(status)) return null;
  return {
    status,
    providerStatus: status,
    error: status === 'failed' ? providerStatus.errors?.[0]?.title || 'Mensagem rejeitada pela Meta' : null,
    providerErrorCode: providerStatus.errors?.[0]?.code ? String(providerStatus.errors[0].code) : null,
  };
}

export function shouldApplyMetaStatus(current, incoming) {
  const next = metaDeliveryState(incoming);
  if (!next) return false;
  const previous = current.providerStatus || current.status;
  if (previous === next.status) return false;
  const rank = { accepted: 0, sending: 0, pending: 0, sent: 1, failed: 1, delivered: 2, read: 3 };
  return (rank[next.status] ?? 0) >= (rank[previous] ?? 0)
    && !(previous === 'failed' && next.status === 'sent');
}
