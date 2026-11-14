import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsmeowApiClient, whatsmeowGroupJid, whatsmeowRecipient } from '../core/whatsmeowApi.js';

test('whatsmeow normalizes campaign phone numbers to WhatsApp JIDs', () => {
  assert.equal(whatsmeowRecipient('+55 (11) 99999-9999'), '5511999999999@s.whatsapp.net');
  assert.equal(whatsmeowRecipient('5511999999999@s.whatsapp.net'), '5511999999999@s.whatsapp.net');
  assert.equal(whatsmeowRecipient('123456789@lid'), '123456789@lid');
  assert.equal(whatsmeowRecipient('5511999999999@575'), '5511999999999@s.whatsapp.net');
  assert.throws(() => whatsmeowRecipient('575'), /número/i);
});

test('whatsmeow only accepts canonical group JIDs at the group boundary', () => {
  assert.equal(whatsmeowGroupJid('120363012345678901@g.us'), '120363012345678901@g.us');
  assert.throws(() => whatsmeowGroupJid('5511999999999@s.whatsapp.net'), /JID de grupo/i);
  assert.throws(() => whatsmeowGroupJid('120363012345678901@broadcast'), /JID de grupo/i);
});

test('whatsmeow client reports the HTTP failure when the service returns JSON null', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('null', {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
  try {
    const client = new WhatsmeowApiClient({ baseUrl: 'http://127.0.0.1:8765' });
    await assert.rejects(client.createInstance('sales'), /HTTP 503/);
  } finally {
    globalThis.fetch = original;
  }
});

test('whatsmeow client normalizes a successful JSON null response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('null', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    const client = new WhatsmeowApiClient({ baseUrl: 'http://127.0.0.1:8765' });
    assert.deepEqual(await client.createInstance('sales'), {});
  } finally {
    globalThis.fetch = original;
  }
});

test('whatsmeow client routes QR, text and media through a loopback service with bearer token', async () => {
  const calls = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, options }); return new Response(JSON.stringify({ status: 'connecting', qrcode: 'data:image/png;base64,qr', providerMessageId: 'm1' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const client = new WhatsmeowApiClient({ baseUrl: 'http://127.0.0.1:8765/', token: 'secret' });
    assert.equal((await client.createInstance('sales')).qrcode, 'data:image/png;base64,qr');
    assert.equal((await client.sendText('sales', '5511999999999', 'Olá')).providerMessageId, 'm1');
    await client.sendText('sales', '123456789@lid', 'Resposta', { humanize: true });
    await client.sendMedia('sales', '5511999999999@s.whatsapp.net', { mediaType: 'image', base64: 'aW1hZ2U=', mimetype: 'image/jpeg', filename: 'foto.jpg', caption: 'Oi' });
    await client.listGroups('sales');
    await client.getGroup('sales', '120363012345678901@g.us');
    await client.createGroup('sales', 'Equipe', ['5511999999999']);
    await client.updateGroup('sales', '120363012345678901@g.us', { description: 'Operações' });
    await client.updateGroupParticipants('sales', '120363012345678901@g.us', 'promote', ['5511999999999']);
    await client.getGroupInviteLink('sales', '120363012345678901@g.us', true);
    await client.leaveGroup('sales', '120363012345678901@g.us');
    await client.sendGroupText('sales', '120363012345678901@g.us', 'Olá, grupo');
    assert.equal(calls[0].url, 'http://127.0.0.1:8765/instances');
    assert.equal(calls[1].url, 'http://127.0.0.1:8765/instances/sales/messages/text');
    assert.equal(calls[1].options.headers.authorization, 'Bearer secret');
    assert.equal(JSON.parse(calls[1].options.body).recipient, '5511999999999@s.whatsapp.net');
    assert.equal(JSON.parse(calls[2].options.body).recipient, '123456789@lid');
    assert.equal(JSON.parse(calls[2].options.body).humanize, true);
    assert.equal(calls[3].url, 'http://127.0.0.1:8765/instances/sales/messages/media');
    assert.equal(JSON.parse(calls[3].options.body).filename, 'foto.jpg');
    assert.equal(calls[4].url, 'http://127.0.0.1:8765/instances/sales/groups');
    assert.match(calls[5].url, /groups\/120363012345678901%40g\.us$/);
    assert.equal(JSON.parse(calls[6].options.body).participants[0], '5511999999999@s.whatsapp.net');
    assert.equal(calls[7].options.method, 'PATCH');
    assert.equal(JSON.parse(calls[8].options.body).action, 'promote');
    assert.match(calls[9].url, /invite$/);
    assert.equal(calls[9].options.method, 'POST');
    assert.equal(JSON.parse(calls[9].options.body).reset, true);
    assert.match(calls[10].url, /leave$/);
    assert.equal(JSON.parse(calls[11].options.body).recipient, '120363012345678901@g.us');
  } finally { globalThis.fetch = original; }
});

test('whatsmeow client expõe ciclos distintos de desconectar e apagar', async () => {
  const calls = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new WhatsmeowApiClient({ baseUrl: 'http://127.0.0.1:8765' });
    await client.disconnect('sales');
    await client.deleteInstance('sales');
    assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
      ['http://127.0.0.1:8765/instances/sales/disconnect', 'POST'],
      ['http://127.0.0.1:8765/instances/sales', 'DELETE'],
    ]);
  } finally { globalThis.fetch = original; }
});
