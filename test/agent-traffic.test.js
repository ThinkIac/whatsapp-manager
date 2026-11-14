import test from 'node:test';
import assert from 'node:assert/strict';
import { canRunMetaSpecialist, specialistHistory } from '../core/agentTraffic.js';

const now = new Date('2026-09-04T18:00:00Z');
const instance = { provider: 'meta_cloud', agentEnabled: true, specialistId: 'pkg:desta-casa' };

test('tráfego Meta só libera agente com opt-in e mensagem de contato dentro de 24 horas', () => {
  const messages = [{ direction: 'in', authorType: 'contact', text: 'Olá', timestamp: new Date('2026-09-04T01:00:01Z') }];
  assert.deepEqual(canRunMetaSpecialist(instance, messages, now), { allowed: true });
  assert.equal(canRunMetaSpecialist(instance, [{ ...messages[0], timestamp: new Date('2026-09-03T17:59:59Z') }], now).allowed, false);
  assert.equal(canRunMetaSpecialist({ ...instance, agentEnabled: false }, messages, now).allowed, false);
  assert.equal(canRunMetaSpecialist({ ...instance, provider: 'baileys' }, messages, now).allowed, false);
  assert.equal(canRunMetaSpecialist({ ...instance, provider: 'whatsmeow' }, messages, now).allowed, true);
});

test('Evolution aplica opt-in e pausas, sem herdar a janela oficial da Meta', () => {
  const oldInbound = [{ direction: 'in', authorType: 'contact', timestamp: new Date('2026-08-01T12:00:00Z') }];
  assert.deepEqual(canRunMetaSpecialist({ provider: 'evolution', agentEnabled: true, specialistId: 'pkg:atendimento' }, oldInbound, new Date('2026-09-04T12:00:00Z')), { allowed: true });
  assert.equal(canRunMetaSpecialist({ provider: 'evolution', agentEnabled: true, specialistId: 'pkg:atendimento' }, oldInbound, new Date(), { agentPaused: true, agentPauseReason: 'human_handoff' }).allowed, false);
});

test('histórico do especialista preserva a ordem e identifica resposta automática como assistente', () => {
  const history = specialistHistory([
    { direction: 'out', authorType: 'agent', text: 'Como posso ajudar?', timestamp: new Date('2026-09-04T17:00:00Z') },
    { direction: 'in', authorType: 'contact', text: 'Quero visitar', timestamp: new Date('2026-09-04T17:01:00Z') },
  ]);
  assert.deepEqual(history, [{ role: 'assistant', content: 'Como posso ajudar?' }, { role: 'user', content: 'Quero visitar' }]);
});
