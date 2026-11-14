import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { metaDeliveryState, shouldApplyMetaStatus } from '../core/metaDeliveryState.js';
import { MetaCloudClient } from '../core/metaCloudApi.js';
import { verifyMetaWebhook, metaChanges, webhookDiagnostic } from '../core/metaWebhook.js';
import { createHmac } from 'node:crypto';
import { normalizeWhatsAppNumber } from '../core/conversationHelpers.js';

// Execute production handlers with isolated stores and transport; never send messages.
async function handlers(file, dependencies, names) {
  const source = (await readFile(new URL(file, import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(dependencies), `${source}\nreturn {${names.join(',')}};`)(...Object.values(dependencies));
}
function table(rows = []) {
  return { rows, findOne: query => rows.find(row => Object.entries(query).every(([k,v]) => row[k] === v)),
    query: query => rows.filter(row => Object.entries(query).every(([k,v]) => row[k] === v)),
    push: async row => { const saved = { id: String(rows.length + 1), ...row }; rows.push(saved); return saved; } };
}

test('Meta persists media captions, deduplicates input and leaves campaign state to the delivery protocol', async () => {
  const db = { message: table(), conversation: table() };
  const events = [];
  const engine = await handlers('../core/conversationEngine.js', {
    getProxy: () => db, metaDeliveryState, shouldApplyMetaStatus,
    providerRouter: { clientForInstance: () => ({ downloadMedia: async id => { assert.equal(id, 'media'); return { buffer: Buffer.from('image'), mimetype: 'image/jpeg' }; } }) },
    saveMedia: (id, buffer) => { assert.equal(buffer.toString(), 'image'); return { mimetype: 'image/jpeg', filename: 'saved.jpg' }; },
    emitWhatsappEvent: async (...args) => events.push(args), responseWaitMs: () => 0, normalizeWhatsAppNumber,
    canRunMetaSpecialist: () => ({ allowed: false }), executeSpecialist: () => {},
  }, ['handleMetaIncomingMessage', 'handleMetaStatus']);
  const instance = { id: 'i', name: 'test' };
  const incoming = { id: 'incoming', from: '12345678', type: 'image', image: { id: 'media', caption: 'Legenda' } };
  const msg = await engine.handleMetaIncomingMessage(instance, incoming);
  assert.equal(msg.text, 'Legenda'); assert.equal(msg.mediaUrl, 'saved.jpg');
  assert.equal(await engine.handleMetaIncomingMessage(instance, incoming), null);
  assert.equal(db.conversation.rows[0].unreadCount, 1);
  const second = await engine.handleMetaIncomingMessage(instance, { id: 'incoming-2', from: '+12 (345) 678', type: 'text', text: { body: 'Oi' } }, [{ wa_id: '12345678', profile: { name: 'Outro nome' } }]);
  assert.equal(second.conversationId, db.conversation.rows[0].id);
  assert.equal(db.conversation.rows.length, 1);
  assert.equal(await engine.handleMetaStatus(instance, { id: 'campaign', status: 'read' }), null);
  assert.equal(await engine.handleMetaStatus(instance, {}), null);
  assert.equal(await engine.handleMetaStatus(instance, { id: 'missing', status: 'read' }), null);
  db.message.rows.push({ instanceId: 'i', waMessageId: 'out', providerStatus: 'read', status: 'read' });
  assert.equal(await engine.handleMetaStatus(instance, { id: 'out', status: 'delivered' }), null);
  assert.equal(db.message.findOne({ waMessageId: 'out' }).status, 'read');
});

test('Whatsmeow persists received and device-sent messages in the same local timeline', async () => {
  const db = { message: table(), conversation: table(), campaignRecipient: table() };
  const events = [];
  const engine = await handlers('../core/conversationEngine.js', {
    getProxy: () => db, metaDeliveryState, shouldApplyMetaStatus,
    providerRouter: {}, saveMedia: (_, buffer, media) => ({ mimetype: media.mimetype, filename: `saved.${media.mediaType}` }), emitWhatsappEvent: async (...args) => events.push(args),
    responseWaitMs: () => 0, normalizeWhatsAppNumber, canRunMetaSpecialist: () => ({ allowed: false }), executeSpecialist: () => {},
  }, ['handleWhatsmeowMessage']);
  const instance = { id: 'w', name: 'piloto', provider: 'whatsmeow' };
  const incoming = await engine.handleWhatsmeowMessage(instance, { id: 'in-1', chatJid: '5511999999999@s.whatsapp.net', pushName: 'Ana', text: 'Oi', timestamp: '2026-09-11T19:00:00.000Z' });
  assert.equal(incoming.direction, 'in');
  assert.equal(db.conversation.rows[0].unreadCount, 1);
  const direct = await engine.handleWhatsmeowMessage(instance, { id: 'web-1', chatJid: '5511999999999@s.whatsapp.net', text: 'Respondido pelo Web', fromMe: true });
  assert.equal(direct.direction, 'out');
  assert.equal(direct.authorType, 'human');
  assert.equal(db.conversation.rows.length, 1);
  const directWithOwnLid = await engine.handleWhatsmeowMessage(instance, { id: 'web-2', chatJid: '5511999999999@s.whatsapp.net', senderJid: '999999999@lid', text: 'Ainda para Ana', fromMe: true });
  assert.equal(directWithOwnLid.conversationId, db.conversation.rows[0].id);
  assert.equal(db.conversation.rows.length, 1);
  const lid = await engine.handleWhatsmeowMessage(instance, { id: 'lid-1', chatJid: '5511999999999@s.whatsapp.net', senderJid: '43023442432074@lid', text: 'Agora via LID' });
  assert.equal(lid.conversationId, db.conversation.rows[0].id);
  assert.equal(db.conversation.rows[0].contactJid, '43023442432074@lid');
  const image = await engine.handleWhatsmeowMessage(instance, { id: 'image-1', chatJid: '5511999999999@s.whatsapp.net', senderJid: '43023442432074@lid', media: { type: 'image', mimetype: 'image/jpeg', filename: 'foto.jpg', base64: Buffer.from('image').toString('base64') } });
  assert.equal(image.mediaUrl, 'saved.image');
  assert.equal(image.mediaType, 'image/jpeg');
  assert.equal(await engine.handleWhatsmeowMessage(instance, { id: 'in-1', chatJid: '5511999999999@s.whatsapp.net' }), null);
  assert.equal(events.length, 5);
});

test('webhook rejects invalid signatures using the HTTP envelope and reports discarded events', async () => {
  const secret = 'test-secret';
  const route = await handlers('../routes/meta.js', { getProxy: () => ({ instance: table([{ id: 'i', provider: 'meta_cloud', phoneNumberId: '123' }]) }),
    readMetaConfig: () => ({ appSecret: secret }), verifyMetaWebhook, metaChanges, webhookDiagnostic,
    handleMetaIncomingMessage: async () => null, handleMetaStatus: async () => null,
  }, ['receiveWebhook']);
  const rejected = await route.receiveWebhook({ headers: {}, body: {} });
  assert.equal(rejected.status, 401); assert.ok(rejected.data);
  const body = { entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'unknown' }, messages: [{}] } }, { field: 'messages', value: { metadata: { phone_number_id: '123' }, messages: [{}], statuses: [{}] } }] }] };
  const rawBody = JSON.stringify(body);
  const result = await route.receiveWebhook({ body, rawBody, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}` } });
  assert.equal(result.received, 0); assert.equal(result.statuses, 0);
  assert.deepEqual(result.ignored, { unknownInstance: 1, duplicateOrInvalidMessage: 1, unmatchedOrStaleStatus: 1 });
});

test('webhook processes the remaining batch and requests retry after a processing failure', async () => {
  const secret = 'test-secret';
  const instance = { id: 'i', provider: 'meta_cloud', phoneNumberId: '123' };
  const handled = [];
  const route = await handlers('../routes/meta.js', {
    getProxy: () => ({ instance: table([instance]) }), readMetaConfig: () => ({ appSecret: secret }),
    verifyMetaWebhook, metaChanges, webhookDiagnostic,
    handleMetaIncomingMessage: async (_, message) => { handled.push(message.id); if (message.id === 'broken') throw new Error('private transport details'); return message; },
    handleMetaStatus: async () => ({ id: 'status' }),
  }, ['receiveWebhook', 'metaWebhookDiagnostics']);
  const body = { entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '123' }, messages: [{ id: 'broken' }, { id: 'good' }], statuses: [{ id: 'status' }] } }] }] };
  const rawBody = JSON.stringify(body);
  const result = await route.receiveWebhook({ body, rawBody, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}` } });
  assert.equal(result.status, 500);
  assert.equal(result.data.received, 1);
  assert.equal(result.data.statuses, 1);
  assert.equal(result.data.failures.messages, 1);
  assert.deepEqual(handled, ['broken', 'good']);
  const diagnostics = route.metaWebhookDiagnostics({ query: {} });
  assert.equal(diagnostics.lastWebhook.outcome, 'failed');
  assert.equal(JSON.parse(instance.metaWebhookDiagnostic).failures.messages, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private transport details/);
});

test('Meta cannot enter Baileys through creation, QR read or regeneration', async () => {
  const routes = await handlers('../routes/instances.js', { getProxy: () => ({ instance: table([{ name: 'meta', provider: 'meta_cloud' }]) }), baileysManager: new Proxy({}, { get() { throw new Error('Baileys must not be called'); } }) }, ['createInstance', 'getInstanceQr', 'regenerateQr']);
  for (const [name, req] of [['createInstance', { body: { name: 'meta' } }], ['createInstance', { body: { name: 'new', provider: 'meta_cloud' } }], ['getInstanceQr', { params: { name: 'meta' } }], ['regenerateQr', { params: { name: 'meta' } }]]) {
    const result = await routes[name](req); assert.equal(result.status, 400); assert.ok(result.data.message);
  }
});

test('media download authenticates both requests and honors the selected API version', async () => {
  const calls = [];
  const client = new MetaCloudClient({ accessToken: 'secret', phoneNumberId: '123', apiVersion: 'v26.0', fetchImpl: async (url, options) => {
    calls.push(url); assert.equal(options.headers.Authorization, 'Bearer secret');
    return calls.length === 1 ? new Response(JSON.stringify({ url: 'https://media.example/image', mime_type: 'image/jpeg' })) : new Response('image');
  } });
  const result = await client.downloadMedia('media');
  assert.equal(calls[0], 'https://graph.facebook.com/v26.0/media'); assert.equal(result.buffer.toString(), 'image');
});
