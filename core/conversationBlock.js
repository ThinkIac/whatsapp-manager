export function setConversationBlocked(conversation, blocked, reason) {
  const shouldBlock = blocked !== false;
  conversation.agentBlocked = shouldBlock;
  conversation.agentPaused = shouldBlock;
  conversation.agentPauseReason = shouldBlock ? 'blocked' : null;
  conversation.agentBlockedAt = shouldBlock ? new Date() : null;
  conversation.agentBlockReason = shouldBlock
    ? String(reason || 'Bloqueado manualmente').trim().slice(0, 240)
    : null;
  if (!shouldBlock) conversation.agentHandoffAt = null;
  return conversation;
}
