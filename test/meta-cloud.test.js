import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { MetaCloudClient, MetaCloudError } from '../core/metaCloudApi.js';
import { verifyMetaWebhook, webhookChallenge, webhookDiagnostic } from '../core/metaWebhook.js';
import { metaAcceptedState, metaDeliveryState } from '../core/metaDeliveryState.js';
import { metaPublicConfig } from '../core/metaConfig.js';

test('cliente Meta normaliza envio de texto e nunca inclui token no erro', async () => {
  const client = new MetaCloudClient({ accessToken: 'token-ultra-secreto', phoneNumberId: '123', fetchImpl: async (url, init) => {
    assert.equal(url, 'https://graph.facebook.com/v25.0/123/messages');
    assert.equal(init.headers.Authorization, 'Bearer token-ultra-secreto');
    assert.deepEqual(JSON.parse(init.body), { messaging_product: 'whatsapp', to: '5511999999999', type: 'text', text: { body: 'Olá' } });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.abc' }] }), { status: 200 });
  } });

  assert.deepEqual(await client.sendText('5511999999999', 'Olá'), { providerMessageId: 'wamid.abc' });

  const failing = new MetaCloudClient({ accessToken: 'token-ultra-secreto', phoneNumberId: '123', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Token token-ultra-secreto recusado', code: 190 } }), { status: 401 }) });
  await assert.rejects(() => failing.sendText('5511999999999', 'Olá'), (error) => {
    assert.ok(error instanceof MetaCloudError);
    assert.equal(error.code, 190);
    assert.doesNotMatch(error.message, /token-ultra-secreto/);
    return true;
  });
});

test('webhook aceita somente assinatura HMAC válida e responde ao desafio correto', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const secret = 'app-secret';
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyMetaWebhook({ rawBody: body, signature, appSecret: secret }), true);
  assert.equal(verifyMetaWebhook({ rawBody: body, signature: 'sha256=invalida', appSecret: secret }), false);
  assert.deepEqual(webhookChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify', 'hub.challenge': 'abc' }, 'verify'), { status: 200, body: 'abc', headers: { 'content-type': 'text/plain' } });
  assert.equal(webhookChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': 'abc' }, 'verify').status, 403);
});

test('configuração pública Meta não expõe nenhum segredo', () => {
  const config = metaPublicConfig({ phoneNumberId: '123', whatsappBusinessAccountId: '456', accessToken: 'secret', appSecret: 'app-secret', verifyToken: 'verify' });
  assert.deepEqual(config, { configured: true, phoneNumberId: '123', whatsappBusinessAccountId: '456' });
  assert.doesNotMatch(JSON.stringify(config), /secret|verify/i);
});

test('envio aceito pela Meta não é apresentado como entregue antes do webhook', () => {
  assert.deepEqual(metaAcceptedState('wamid.abc'), { status: 'sent', providerStatus: 'accepted', waMessageId: 'wamid.abc' });
  assert.deepEqual(metaDeliveryState({ status: 'delivered' }), { status: 'delivered', providerStatus: 'delivered', error: null, providerErrorCode: null });
  assert.deepEqual(metaDeliveryState({ status: 'failed', errors: [{ code: 131047, title: 'Reengajamento fora da janela de 24 horas' }] }), {
    status: 'failed', providerStatus: 'failed', error: 'Reengajamento fora da janela de 24 horas', providerErrorCode: '131047',
  });
  assert.equal(metaDeliveryState({ status: 'unknown' }), null);
});

test('diagnóstico do webhook não persiste payload, assinatura ou segredos', () => {
  const diagnostic = webhookDiagnostic({ outcome: 'received', received: 2, statuses: 1, now: new Date('2026-09-02T04:00:00Z') });
  assert.deepEqual(diagnostic, { outcome: 'received', received: 2, statuses: 1, at: '2026-09-02T04:00:00.000Z' });
  assert.doesNotMatch(JSON.stringify(diagnostic), /signature|token|secret|payload/i);
});

test('cliente Meta gerencia templates pelo catálogo remoto da WABA', async () => {
  const requests = [];
  const client = new MetaCloudClient({ accessToken: 'secret', phoneNumberId: '123', fetchImpl: async (url, init = {}) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: [], id: 'remote-template' }), { status: 200 });
  } });
  const template = { name: 'aviso_pagamento', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}}' }] };

  await client.createMessageTemplate('waba-1', template);
  await client.updateMessageTemplate('remote-template', template);
  await client.deleteMessageTemplate('waba-1', { id: 'remote-template', name: 'aviso_pagamento' });

  assert.deepEqual(requests.map(({ url, init }) => [url, init.method, init.body && JSON.parse(init.body)]), [
    ['https://graph.facebook.com/v25.0/waba-1/message_templates', 'POST', template],
    ['https://graph.facebook.com/v25.0/remote-template', 'POST', template],
    ['https://graph.facebook.com/v25.0/waba-1/message_templates?hsm_id=remote-template&name=aviso_pagamento', 'DELETE', undefined],
  ]);
});
