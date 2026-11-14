import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteInstance, purgeInstanceData } from '../core/instanceData.js';

function collection(rows) {
  return {
    rows,
    all: () => rows,
    query: (filter) => rows.filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value)),
    delete: async (id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
}

test('a checagem interna só permite apagar uma instância já desconectada e sem socket ativo', () => {
  assert.equal(canDeleteInstance({ status: 'open' }).status, 409);
  assert.equal(canDeleteInstance({ status: 'disconnected' }, true).status, 409);
  assert.equal(canDeleteInstance({ status: 'disconnected' }).allowed, true);
});

test('apaga somente dados pertencentes ao Manager', async () => {
  const instance = { id: 'i1', status: 'disconnected' };
  const db = {
    instance: collection([instance, { id: 'i2' }]),
    conversation: collection([{ id: 'c1', instanceId: 'i1' }, { id: 'c2', instanceId: 'i2' }]),
    message: collection([{ id: 'm1', instanceId: 'i1' }, { id: 'm2', instanceId: 'i2' }]),
  };

  const removed = await purgeInstanceData(db, instance);
  assert.deepEqual(removed, { conversations: 1, messages: 1 });
  assert.deepEqual(db.conversation.rows.map((row) => row.id), ['c2']);
});
