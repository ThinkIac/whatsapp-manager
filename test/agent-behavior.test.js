import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentBehavior, responseWaitMs } from '../core/agentBehavior.js';

test('comportamento do agente preserva resposta imediata por padrão', () => {
  assert.deepEqual(normalizeAgentBehavior(), { accumulationSeconds: 0, responseDelaySeconds: 0 });
  assert.equal(responseWaitMs(), 0);
});

test('comportamento do agente limita e normaliza tempos inválidos por instância', () => {
  assert.deepEqual(
    normalizeAgentBehavior({ accumulationSeconds: '12.8', responseDelaySeconds: 9999 }),
    { accumulationSeconds: 12, responseDelaySeconds: 600 },
  );
  assert.deepEqual(normalizeAgentBehavior({ accumulationSeconds: -1, responseDelaySeconds: 'x' }), { accumulationSeconds: 0, responseDelaySeconds: 0 });
  assert.equal(responseWaitMs({ accumulationSeconds: 3, responseDelaySeconds: 2 }), 5000);
});
