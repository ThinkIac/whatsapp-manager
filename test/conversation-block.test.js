import test from 'node:test';
import assert from 'node:assert/strict';
import { setConversationBlocked } from '../core/conversationBlock.js';

test('bloqueio local pausa automações e desbloqueio restaura a conversa', () => {
  const conversation = { id: 'c1', agentPaused: false };

  setConversationBlocked(conversation, true, 'Assunto fora do escopo');
  assert.equal(conversation.agentBlocked, true);
  assert.equal(conversation.agentPaused, true);
  assert.equal(conversation.agentPauseReason, 'blocked');
  assert.equal(conversation.agentBlockReason, 'Assunto fora do escopo');
  assert.ok(conversation.agentBlockedAt instanceof Date);

  setConversationBlocked(conversation, false);
  assert.equal(conversation.agentBlocked, false);
  assert.equal(conversation.agentPaused, false);
  assert.equal(conversation.agentPauseReason, null);
  assert.equal(conversation.agentBlockReason, null);
  assert.equal(conversation.agentBlockedAt, null);
});
