import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvolutionConnection, normalizeEvolutionMessage } from '../core/evolutionWebhook.js';
import { evolutionInstancePresentation } from '../core/instancePresentation.js';

test('normaliza mensagem recebida Evolution e ignora mensagens próprias e grupos', () => {
  assert.deepEqual(normalizeEvolutionMessage({ data: { key: { id: 'm1', remoteJid: '5511999999999@s.whatsapp.net' }, pushName: 'Ana', message: { conversation: 'Oi' } } }), { id: 'm1', from: '5511999999999', name: 'Ana', text: 'Oi', type: 'text' });
  assert.equal(normalizeEvolutionMessage({ data: { key: { fromMe: true, remoteJid: '5511@s.whatsapp.net' } } }), null);
  assert.equal(normalizeEvolutionMessage({ data: { key: { remoteJid: 'grupo@g.us' } } }), null);
  assert.equal(normalizeEvolutionConnection({ data: { state: 'open' } }), 'open');
});

test('apresentação Evolution não expõe API key', () => {
  const instance = evolutionInstancePresentation({ id: 'i1', name: 'tenant', status: 'connecting', evolutionBaseUrl: 'https://evolution.example', evolutionApiKey: 'segredo', evolutionWebhookSecret: 'token-privado', evolutionQrCode: 'data:image/png;base64,abc' });
  assert.equal(JSON.stringify(instance).includes('segredo'), false);
  assert.equal(JSON.stringify(instance).includes('token-privado'), false);
  assert.equal(instance.qrPending, false);
});
