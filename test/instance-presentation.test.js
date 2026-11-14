import test from 'node:test';
import assert from 'node:assert/strict';
import { listInstancePresentation, metaInstancePresentation } from '../core/instancePresentation.js';

test('mantém a instância Meta Cloud API na lista sem consultar o Baileys', () => {
  const meta = { id: 'meta-1', name: 'oficial', provider: 'meta_cloud', status: 'open', phoneNumberId: '123', displayPhoneNumber: '+55 11 99999-9999' };
  const baileys = { id: 'qr-1', name: 'pareado', provider: 'baileys', status: 'open' };
  const lookedUp = [];

  const result = listInstancePresentation([meta, baileys], (name) => {
    lookedUp.push(name);
    return { ...baileys, qrcode: null, proxyUrls: [] };
  });

  assert.deepEqual(lookedUp, ['pareado']);
  assert.deepEqual(result[0], {
    id: 'meta-1', name: 'oficial', provider: 'meta_cloud', status: 'open',
    phoneNumberId: '123', displayPhoneNumber: '+55 11 99999-9999',
    whatsappBusinessAccountId: null, metaApiVersion: null, metaSendControls: {}, agentEnabled: false,
    specialistId: null, agentBehavior: { accumulationSeconds: 0, responseDelaySeconds: 0 },
    agentIdentity: { businessName: '', humanChannel: '' }, agentPausedReason: null, qrcode: null,
    qrPending: false, lastError: null, reconnecting: false,
  });
});

test('expõe controles Meta normalizados para o painel sem segredos', () => {
  const result = metaInstancePresentation({ id: 'meta-1', name: 'oficial', metaSendControls: JSON.stringify({ maxPerDay: 70 }) });
  assert.deepEqual(result.metaSendControls, { maxPerDay: 70 });
  assert.equal(JSON.stringify(result).includes('accessToken'), false);
});

test('expõe comportamento do agente normalizado sem vazar a string de banco', () => {
  const result = metaInstancePresentation({ id: 'meta-1', name: 'oficial', agentBehavior: JSON.stringify({ accumulationSeconds: 8, responseDelaySeconds: 3 }) });
  assert.deepEqual(result.agentBehavior, { accumulationSeconds: 8, responseDelaySeconds: 3 });
});

test('expõe identidade do agente e motivo de pausa para o painel Meta', () => {
  const result = metaInstancePresentation({ id: 'meta-1', name: 'oficial', agentIdentity: JSON.stringify({ businessName: 'Desta Casa', humanChannel: 'contato@desta.casa' }), agentPausedReason: 'Restrição Meta' });
  assert.deepEqual(result.agentIdentity, { businessName: 'Desta Casa', humanChannel: 'contato@desta.casa' });
  assert.equal(result.agentPausedReason, 'Restrição Meta');
});

test('a lista Baileys nunca expõe objetos de transporte não serializáveis', () => {
  const instance = { id: 'qr-1', name: 'pareado', provider: 'baileys', status: 'open' };
  const socket = {};
  socket.socket = socket;

  const [result] = listInstancePresentation([instance], () => ({
    id: 'qr-1',
    name: 'pareado',
    status: 'open',
    qrcode: 'data:image/png;base64,qr',
    proxyUrls: ['https://proxy.example'],
    antibotConfig: { maxPerMinute: 10 },
    lastError: { socket },
    proxyStats: [{ url: 'https://proxy.example', failures: 0, cooldownUntil: 0, agent: socket }],
    internalSocket: socket,
  }));

  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(result.provider, 'baileys');
  assert.equal(result.lastError, null);
  assert.deepEqual(result.proxyStats, [{ url: 'https://proxy.example', failures: 0, cooldownUntil: 0 }]);
});
