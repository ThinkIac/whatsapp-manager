import test from 'node:test';
import assert from 'node:assert/strict';
import { addContact, updateContact, removeContact, listContacts, findOwners } from '../core/contacts.js';

function collection(rows) {
  let nextId = 1;
  return {
    rows,
    all: () => rows,
    findOne: (filter) => rows.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)),
    query: (filter) => rows.filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value)),
    push: async (data) => {
      const row = { id: `c${nextId++}`, ...data };
      rows.push(row);
      return row;
    },
    delete: async (id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
}

function makeDb() {
  return {
    instance: collection([{ id: 'i1', name: 'vendas' }, { id: 'i2', name: 'suporte' }]),
    contact: collection([]),
  };
}

test('cadastra um contato e recusa duplicata do mesmo número na instância', async () => {
  const db = makeDb();
  const contact = await addContact(db, 'vendas', { number: '(11) 99999-0000', name: 'Ana', role: 'Gerente' });
  assert.equal(contact.number, '11999990000');
  assert.equal(contact.isOwner, false);

  await assert.rejects(() => addContact(db, 'vendas', { number: '11999990000', name: 'Ana de novo' }));
});

test('marcar isOwner desmarca o owner anterior da mesma instância, mas não afeta outra instância', async () => {
  const db = makeDb();
  await addContact(db, 'vendas', { number: '11911112222', name: 'Bia', role: 'Dono', isOwner: true });
  await addContact(db, 'vendas', { number: '11933334444', name: 'Caio', role: 'Dono', isOwner: true });
  await addContact(db, 'suporte', { number: '11955556666', name: 'Duda', role: 'Dono', isOwner: true });

  const vendasOwners = listContacts(db, 'vendas').filter((c) => c.isOwner);
  assert.equal(vendasOwners.length, 1);
  assert.equal(vendasOwners[0].name, 'Caio');

  const suporteOwners = listContacts(db, 'suporte').filter((c) => c.isOwner);
  assert.equal(suporteOwners.length, 1);
  assert.equal(suporteOwners[0].name, 'Duda');
});

test('findOwners retorna um owner por instância e respeita o filtro por instanceName', async () => {
  const db = makeDb();
  await addContact(db, 'vendas', { number: '11911112222', name: 'Bia', isOwner: true });
  await addContact(db, 'suporte', { number: '11955556666', name: 'Duda', isOwner: true });

  const all = findOwners(db);
  assert.equal(all.length, 2);

  const onlyVendas = findOwners(db, 'vendas');
  assert.equal(onlyVendas.length, 1);
  assert.equal(onlyVendas[0].instance.name, 'vendas');
  assert.equal(onlyVendas[0].contact.name, 'Bia');
});

test('updateContact troca cargo e removeContact apaga o registro', async () => {
  const db = makeDb();
  await addContact(db, 'vendas', { number: '11999990000', name: 'Ana' });

  updateContact(db, 'vendas', '11999990000', { role: 'Atendente' });
  const [updated] = listContacts(db, 'vendas').filter((c) => c.number === '11999990000');
  assert.equal(updated.role, 'Atendente');

  await removeContact(db, 'vendas', '11999990000');
  assert.equal(listContacts(db, 'vendas').some((c) => c.number === '11999990000'), false);
});
