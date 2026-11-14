import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QR_POLL_TIMEOUT_MS, connectionState, startQrPolling } from '../views/lib/qrFlow.js';

test('classifica estados terminais e mantém connecting enquanto o QR está pendente', () => {
  assert.deepEqual(connectionState({ status: 'open' }), { stage: 'connected', terminal: true, message: '' });
  assert.deepEqual(connectionState({ status: 'connecting', qrPending: true }), {
    stage: 'connecting', terminal: false, message: 'Aguardando o WhatsApp gerar o QR Code.',
  });
  assert.deepEqual(connectionState({ status: 'connecting', reconnecting: true, lastError: 'Restart requerido pelo Baileys' }), {
    stage: 'connecting', terminal: false, message: 'Vínculo confirmado. Finalizando a conexão com o WhatsApp…',
  });
  assert.deepEqual(connectionState({ status: 'disconnected', lastError: 'handshake recusado' }), {
    stage: 'error', terminal: true, message: 'handshake recusado',
  });
});

test('mantém a espera de QR alinhada ao handshake mais lento', () => {
  assert.equal(DEFAULT_QR_POLL_TIMEOUT_MS, 75_000);
});

test('polling é sequencial e para ao receber um estado terminal', async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const seen = [];
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const cancel = startQrPolling({
    intervalMs: 0,
    load: async () => {
      active += 1;
      peak = Math.max(peak, active);
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return calls === 2 ? { status: 'open' } : { status: 'connecting', qrPending: true };
    },
    onResponse: (value) => {
      seen.push(value.status);
      if (value.status === 'open') resolveDone();
      return connectionState(value).terminal;
    },
    onError: (error) => assert.fail(error),
  });

  await done;
  await new Promise((resolve) => setTimeout(resolve, 5));
  cancel();
  assert.equal(peak, 1);
  assert.equal(calls, 2);
  assert.deepEqual(seen, ['connecting', 'open']);
});

test('polling encerra ao falhar e expõe o erro', async () => {
  let calls = 0;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  startQrPolling({
    intervalMs: 0,
    load: async () => { calls += 1; throw new Error('rede indisponível'); },
    onResponse: () => false,
    onError: (error) => { assert.equal(error.message, 'rede indisponível'); resolveDone(); },
  });

  await done;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 1);
});
