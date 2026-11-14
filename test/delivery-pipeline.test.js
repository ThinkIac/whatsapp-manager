import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryIntent, dispatchDeliveryIntent, transitionDeliveryIntent } from '../core/deliveryPipeline.js';

function table(rows = []) {
  return {
    rows,
    findOne(query) { return rows.find(row => Object.entries(query).every(([key, value]) => row[key] === value)); },
    query(query = {}) { return rows.filter(row => Object.entries(query).every(([key, value]) => row[key] === value)); },
    async push(row) { const saved = { id: `id-${rows.length + 1}`, ...row }; rows.push(saved); return saved; },
  };
}

function database() {
  const intentTable = table();
  const intents = new Proxy(intentTable, { get(target, key, receiver) {
    if (typeof key === 'string' && !(key in target)) return target.rows.find(row => row.id === key);
    return Reflect.get(target, key, receiver);
  } });
  return {
    instance: { i1: { id: 'i1', provider: 'fake', status: 'open' } },
    deliveryIntent: intents,
    deliveryAudit: table(),
  };
}

test('an automated delivery is persisted and cannot reach a provider before approval and queueing', async () => {
  const db = database();
  const { intent } = await createDeliveryIntent(db, {
    schemaVersion: 1, requestId: 'campaign:recipient', campaignId: 'campaign', instanceId: 'i1',
    recipient: { number: '+55 (11) 99999-9999', variables: { name: 'Ana' } },
    message: { type: 'text', text: 'Olá, Ana' },
  });
  assert.equal(intent.status, 'pending_approval');
  assert.equal(db.deliveryAudit.rows[0].action, 'created');
  let calls = 0;
  await assert.rejects(() => dispatchDeliveryIntent(db, intent.id, { sendText: async () => { calls += 1; } }), /precisa estar aprovada/i);
  assert.equal(calls, 0);
  await transitionDeliveryIntent(db, intent.id, 'approved', { actor: 'alice' });
  await transitionDeliveryIntent(db, intent.id, 'queued', { actor: 'alice' });
  const result = await dispatchDeliveryIntent(db, intent.id, { sendText: async () => { calls += 1; return { id: 'provider-1' }; } });
  assert.equal(result.accepted, true);
  assert.equal(calls, 1);
  assert.equal(intent.status, 'sent');
  assert.equal(intent.providerMessageId, 'provider-1');
  assert.deepEqual(db.deliveryAudit.rows.map(row => row.action), ['created', 'approved', 'queued', 'dispatching', 'sent']);
});

test('idempotent requests preserve one auditable intent and cancelled work cannot dispatch', async () => {
  const db = database();
  const request = { schemaVersion: 1, requestId: 'same', instanceId: 'i1', recipient: { number: '5511999999999' }, message: { type: 'text', text: 'Oi' } };
  const first = await createDeliveryIntent(db, request);
  const second = await createDeliveryIntent(db, request);
  assert.equal(second.duplicate, true);
  assert.equal(db.deliveryIntent.rows.length, 1);
  await transitionDeliveryIntent(db, first.intent.id, 'cancelled', { reason: 'opt-out' });
  await assert.rejects(() => dispatchDeliveryIntent(db, first.intent.id, { sendText: async () => ({}) }), /precisa estar aprovada/i);
});
