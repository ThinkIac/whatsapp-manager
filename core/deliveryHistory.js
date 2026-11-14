// Provider-independent outbound history. Campaigns call the delivery hook;
// only the Manager persists the resulting conversation message.
export async function recordDeliveryMessage(db, { instance, number, text, providerMessageId, variables = {} }) {
  const contactJid = `${String(number).replace(/\D/g, '')}@s.whatsapp.net`;
  let conversation = db.conversation.findOne({ instanceId: instance.id, contactJid });
  if (!conversation) conversation = await db.conversation.push({ instanceId: instance.id, contactJid, contactName: variables.name || number, unreadCount: 0 });
  const duplicate = providerMessageId && db.message.findOne({ instanceId: instance.id, waMessageId: providerMessageId });
  if (duplicate) return duplicate;
  const message = await db.message.push({ conversationId: conversation.id, instanceId: instance.id, direction: 'out', authorType: 'human', text, waMessageId: providerMessageId, status: 'sent', providerStatus: 'sent', statusUpdatedAt: new Date(), timestamp: new Date() });
  conversation.lastMessagePreview = text;
  conversation.lastMessageAt = message.timestamp;
  return message;
}
