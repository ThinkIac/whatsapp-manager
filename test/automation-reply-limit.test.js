import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadCounter(messages) {
  const source = (await readFile(new URL('../tools.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace(/^export /gm, '');
  const db = {
    message: {
      query(query) {
        return messages.filter((message) => Object.entries(query).every(([key, value]) => message[key] === value));
      },
    },
  };
  return new Function('getProxy', `${source}\nreturn { whatsappCountAutomatedReplies };`)(() => db);
}

test('contador de respostas automáticas ignora operador, outras automações e falhas', async () => {
  const counter = await loadCounter([
    ...Array.from({ length: 20 }, (_, index) => ({ id: `agent-${index}`, conversationId: 'c1', direction: 'out', authorType: 'agent', automationId: 'flow:gb1', status: 'sent' })),
    { id: 'failed', conversationId: 'c1', direction: 'out', authorType: 'agent', automationId: 'flow:gb1', status: 'failed' },
    { id: 'manual', conversationId: 'c1', direction: 'out', authorType: 'human', automationId: null, status: 'sent' },
    { id: 'other-flow', conversationId: 'c1', direction: 'out', authorType: 'agent', automationId: 'flow:other', status: 'sent' },
  ]);

  const result = await counter.whatsappCountAutomatedReplies({ conversationId: 'c1', automationId: 'flow:gb1' });
  assert.equal(result.replyCount, 20);
});
