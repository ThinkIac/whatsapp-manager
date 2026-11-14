/**
 * core/contacts.js
 * ─────────────────────────────────────────────────────────────────────────
 * Contatos por instância — nome, número e cargo livre, mais uma flag
 * isOwner (no máximo um contato por instância) que identifica quem recebe
 * as notificações da tool whatsappNotifyOwner. Recebe `db` por parâmetro
 * (em vez de chamar getProxy no topo do módulo) pra ficar testável com um
 * fake, seguindo o mesmo padrão de core/instanceData.js.
 * ─────────────────────────────────────────────────────────────────────────
 */

function normalizeNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) throw new Error('Campo "number" é obrigatório (apenas dígitos, com DDI)');
  return digits;
}

function getInstanceByName(db, name) {
  if (!name) throw new Error('Campo "instanceName" é obrigatório');
  const instance = db.instance.findOne({ name });
  if (!instance) throw new Error(`Instância "${name}" não existe`);
  return instance;
}

function unsetOwner(db, instanceId) {
  for (const contact of db.contact.query({ instanceId, isOwner: true })) {
    contact.isOwner = false;
  }
}

export function listContacts(db, instanceName) {
  const instance = getInstanceByName(db, instanceName);
  return db.contact.query({ instanceId: instance.id });
}

export async function addContact(db, instanceName, { number, name, role, isOwner } = {}) {
  const instance = getInstanceByName(db, instanceName);
  const cleanNumber = normalizeNumber(number);
  if (!name) throw new Error('Campo "name" é obrigatório');

  const existing = db.contact.findOne({ instanceId: instance.id, number: cleanNumber });
  if (existing) throw new Error(`Contato "${cleanNumber}" já existe nesta instância`);

  if (isOwner) unsetOwner(db, instance.id);

  return db.contact.push({
    instanceId: instance.id,
    number: cleanNumber,
    name,
    role: role || null,
    isOwner: !!isOwner,
    createdAt: new Date(),
  });
}

export function updateContact(db, instanceName, number, { name, role, isOwner } = {}) {
  const instance = getInstanceByName(db, instanceName);
  const cleanNumber = normalizeNumber(number);
  const contact = db.contact.findOne({ instanceId: instance.id, number: cleanNumber });
  if (!contact) throw new Error(`Contato "${cleanNumber}" não encontrado`);

  if (name !== undefined) contact.name = name;
  if (role !== undefined) contact.role = role || null;
  if (isOwner !== undefined) {
    if (isOwner) unsetOwner(db, instance.id);
    contact.isOwner = !!isOwner;
  }
  return contact;
}

export async function removeContact(db, instanceName, number) {
  const instance = getInstanceByName(db, instanceName);
  const cleanNumber = normalizeNumber(number);
  const contact = db.contact.findOne({ instanceId: instance.id, number: cleanNumber });
  if (!contact) throw new Error(`Contato "${cleanNumber}" não encontrado`);
  await db.contact.delete(contact.id);
  return { success: true };
}

/**
 * Acha o(s) contato(s) marcado(s) isOwner. Sem instanceName, procura em
 * todas as instâncias — útil quando só existe uma instância/owner cadastrado
 * e a tool pode inferir sozinha quem notificar.
 */
export function findOwners(db, instanceName) {
  const instances = instanceName ? [getInstanceByName(db, instanceName)] : db.instance.all();
  const owners = [];
  for (const instance of instances) {
    const owner = db.contact.findOne({ instanceId: instance.id, isOwner: true });
    if (owner) owners.push({ contact: owner, instance });
  }
  return owners;
}
