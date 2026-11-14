import test from 'node:test';
import assert from 'node:assert/strict';
import { EvolutionApiClient, evolutionConnectionInfo } from '../core/evolutionApi.js';

test('cliente Evolution v2 usa apikey, cria instância e envia texto sem vazar a chave', async () => {
  const calls = [];
  const client = new EvolutionApiClient({ baseUrl: 'https://evolution.example/', apiKey: 'segredo', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ key: { id: 'abc' } }), { status: 200 });
  } });
  const result = await client.sendText('tenant-a', '55 (11) 99999-9999', 'Olá');
  assert.deepEqual(result, { providerMessageId: 'abc' });
  assert.equal(calls[0].url, 'https://evolution.example/message/sendText/tenant-a');
  assert.equal(calls[0].options.headers.apikey, 'segredo');
  assert.deepEqual(JSON.parse(calls[0].options.body), { number: '5511999999999', text: 'Olá' });
});

test('normaliza estados e QR remoto da Evolution', () => {
  assert.deepEqual(evolutionConnectionInfo({ instance: { state: 'open' } }), { status: 'open', qrcode: null });
  assert.deepEqual(evolutionConnectionInfo({ instance: { state: 'connecting' } }, { base64: 'abc' }), { status: 'connecting', qrcode: 'data:image/png;base64,abc' });
});

test('cliente Evolution expõe logout e exclusão da instância como operações separadas', async () => {
  const calls = [];
  const client = new EvolutionApiClient({ baseUrl: 'https://evolution.example', apiKey: 'segredo', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({}), { status: 200 });
  } });
  await client.logout('tenant-a');
  await client.deleteInstance('tenant-a');
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ['https://evolution.example/instance/logout/tenant-a', 'DELETE'],
    ['https://evolution.example/instance/delete/tenant-a', 'DELETE'],
  ]);
});
