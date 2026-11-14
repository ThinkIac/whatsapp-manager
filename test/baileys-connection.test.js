import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_WA_VERSION,
  hasIncompletePersistedAuth,
  isCurrentSocket,
  resolveWAVersion,
  shouldStopWaitingForQr,
} from '../core/baileysConnection.js';
import { shouldReconnectKnownInstance } from '../core/baileysManager.js';

test('usa a versão retornada pelo Baileys quando ela é válida', async () => {
  const version = await resolveWAVersion(async () => ({ version: [2, 3000, 1033000000] }));
  assert.deepEqual(version, [2, 3000, 1033000000]);
});

test('usa a versão de fallback quando a consulta do Baileys falha', async () => {
  let error;
  const version = await resolveWAVersion(async () => { throw new Error('offline'); }, (cause) => { error = cause; });
  assert.deepEqual(version, FALLBACK_WA_VERSION);
  assert.equal(error.message, 'offline');
});

test('identifica credenciais persistidas mas não registradas como sessão incompleta', () => {
  assert.equal(hasIncompletePersistedAuth({ creds: { registered: false } }, true), true);
  assert.equal(hasIncompletePersistedAuth({ creds: { registered: true } }, true), false);
  assert.equal(hasIncompletePersistedAuth({ creds: { registered: false } }, false), false);
});

test('encerra a espera de QR quando a conexão chega a um estado terminal', () => {
  assert.equal(shouldStopWaitingForQr({ status: 'connecting' }), false);
  assert.equal(shouldStopWaitingForQr({ status: 'open' }), true);
  assert.equal(shouldStopWaitingForQr({ status: 'disconnected' }), true);
  assert.equal(shouldStopWaitingForQr({ status: 'error' }), true);
});

test('ignora eventos atrasados de um socket que já foi substituído', () => {
  const oldSocket = {};
  const currentSocket = {};
  assert.equal(isCurrentSocket(new Map([['vendas', { sock: currentSocket }]]), 'vendas', oldSocket), false);
  assert.equal(isCurrentSocket(new Map([['vendas', { sock: currentSocket }]]), 'vendas', currentSocket), true);
});

test('instâncias Meta não são candidatas à reconexão do Baileys', () => {
  assert.equal(shouldReconnectKnownInstance({ provider: 'meta_cloud', status: 'open' }), false);
  assert.equal(shouldReconnectKnownInstance({ provider: 'evolution', status: 'open' }), false);
  assert.equal(shouldReconnectKnownInstance({ provider: 'baileys', status: 'connecting' }), true);
  assert.equal(shouldReconnectKnownInstance({ provider: 'baileys', status: 'disconnected' }), false);
});
