import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceChoreographer } from '../core/antibot/presence.js';

test('envio anuncia online antes de digitando e termina pausado', async () => {
  const updates = [];
  const sock = {
    presenceSubscribe: async () => {},
    sendPresenceUpdate: async (state, jid) => updates.push([state, jid]),
  };
  const choreographer = new PresenceChoreographer();

  await choreographer.executeTypingPlan(sock, '5511999999999@s.whatsapp.net', [
    { state: 'composing', durationMs: 0 },
  ]);

  assert.deepEqual(updates.map(([state]) => state), ['available', 'composing', 'paused']);
});
