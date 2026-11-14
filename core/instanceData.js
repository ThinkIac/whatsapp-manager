export function canDeleteInstance(instance, hasLiveSocket = false) {
  if (!instance) return { allowed: false, status: 404, message: 'Instância não encontrada' };
  if (hasLiveSocket || instance.status !== 'disconnected') {
    return {
      allowed: false,
      status: 409,
      message: 'Desconecte a instância antes de apagá-la',
    };
  }
  return { allowed: true };
}

async function removeRows(collection, rows) {
  for (const row of rows) await collection.delete(row.id);
}

export async function purgeInstanceData(db, instance) {
  const conversations = db.conversation.query({ instanceId: instance.id });
  const messages = db.message.query({ instanceId: instance.id });

  await removeRows(db.message, messages);
  await removeRows(db.conversation, conversations);

  await db.instance.delete(instance.id);
  return { conversations: conversations.length, messages: messages.length };
}
