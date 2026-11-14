import { getProxy } from 'logos';
import * as baileysManager from '../core/baileysManager.js';
import { listContacts, addContact, updateContact, removeContact, findOwners } from '../core/contacts.js';

const db = getProxy('whatsapp-manager');

// O runtime do Agent pode passar os params de duas formas:
//   1. Direta: { instanceName, number, ... }
//   2. Envelopada: { input: { instanceName, number, ... } }
function normalizeInput(input) {
  return input?.input && typeof input.input === 'object' && !Array.isArray(input.input)
    ? input.input
    : input || {};
}

// ── Tools (LLM / MCP) ────────────────────────────────────────────────────

export function whatsappListInstances() {
  /**
   * @register_tool whatsappListInstances
   * @description Lista as instâncias de WhatsApp cadastradas, com nome e status de conexão (open, connecting, disconnected).
   */
  return baileysManager.listInstances().map(({ name, status }) => ({ name, status }));
}

export function whatsappListContacts(input) {
  /**
   * @register_tool whatsappListContacts
   * @description Lista os contatos cadastrados de uma instância do WhatsApp (nome, número, cargo e se é o owner).
   * @param {string} instanceName - Nome da instância @enumSource tool:whatsapp-manager/whatsappListInstances#name
   */
  const { instanceName } = normalizeInput(input);
  return listContacts(db, instanceName).map(({ number, name, role, isOwner }) => ({ number, name, role, isOwner }));
}

export async function whatsappAddContact(input) {
  /**
   * @register_tool whatsappAddContact
   * @description Cadastra um contato numa instância do WhatsApp (nome, número e cargo opcional). Marque isOwner:true para definir quem recebe as notificações de whatsappNotifyOwner (no máximo um owner por instância — marcar um novo desmarca o anterior).
   * @param {string} instanceName - Nome da instância @enumSource tool:whatsapp-manager/whatsappListInstances#name
   * @param {string} number - Número com DDI, apenas dígitos (ex: 5511999999999)
   * @param {string} name - Nome do contato
   * @param {string?} role - Cargo/função (ex: "Dono", "Gerente", "Atendente")
   * @param {boolean?} isOwner - Marca este contato como o owner/responsável da instância
   */
  const data = normalizeInput(input);
  const contact = await addContact(db, data.instanceName, data);
  return { success: true, contact: { number: contact.number, name: contact.name, role: contact.role, isOwner: contact.isOwner } };
}

export function whatsappUpdateContact(input) {
  /**
   * @register_tool whatsappUpdateContact
   * @description Atualiza nome, cargo ou a flag de owner de um contato já cadastrado.
   * @param {string} instanceName - Nome da instância @enumSource tool:whatsapp-manager/whatsappListInstances#name
   * @param {string} number - Número do contato a atualizar
   * @param {string?} name - Novo nome
   * @param {string?} role - Novo cargo
   * @param {boolean?} isOwner - Marca (true) ou desmarca (false) este contato como owner/responsável
   */
  const data = normalizeInput(input);
  const contact = updateContact(db, data.instanceName, data.number, data);
  return { success: true, contact: { number: contact.number, name: contact.name, role: contact.role, isOwner: contact.isOwner } };
}

export async function whatsappRemoveContact(input) {
  /**
   * @register_tool whatsappRemoveContact
   * @description Remove um contato cadastrado de uma instância.
   * @param {string} instanceName - Nome da instância @enumSource tool:whatsapp-manager/whatsappListInstances#name
   * @param {string} number - Número do contato a remover
   */
  const { instanceName, number } = normalizeInput(input);
  return removeContact(db, instanceName, number);
}

export async function whatsappNotifyOwner(input) {
  /**
   * @register_tool whatsappNotifyOwner
   * @description Envia uma mensagem de WhatsApp para o contato marcado como owner (dono/responsável) de uma instância — use para avisar o usuário sobre algo pedido durante a conversa (ex: "no final me manda um whatsapp sobre X"). Se só existir um owner cadastrado no total, instanceName pode ser omitido.
   * @param {string} message - Texto da mensagem a enviar
   * @param {string?} instanceName - Nome da instância cujo owner deve ser notificado. Opcional se só houver um owner cadastrado. @enumSource tool:whatsapp-manager/whatsappListInstances#name
   */
  const { message, instanceName } = normalizeInput(input);
  if (!message) throw new Error('Campo "message" é obrigatório');

  const owners = findOwners(db, instanceName);
  if (!owners.length) {
    throw new Error(
      instanceName
        ? `Nenhum contato marcado como owner na instância "${instanceName}". Use whatsappAddContact ou whatsappUpdateContact com isOwner:true.`
        : 'Nenhum contato marcado como owner em nenhuma instância. Use whatsappAddContact ou whatsappUpdateContact com isOwner:true.'
    );
  }
  if (owners.length > 1) {
    const names = owners.map((o) => o.instance.name).join(', ');
    throw new Error(`Mais de uma instância tem um owner cadastrado (${names}). Informe instanceName.`);
  }

  const { contact, instance } = owners[0];
  await baileysManager.sendText(instance.name, contact.number, message);
  return { success: true, sentTo: contact.name, instanceName: instance.name };
}

// ── Rotas HTTP (painel de contatos) ────────────────────────────────────────

export function routerListContacts(req) {
  /**
   * @register_router contacts/list
   */
  const { instanceName } = req.query || {};
  if (!instanceName) return { status: 400, message: 'instanceName é obrigatório' };
  try {
    return { contacts: listContacts(db, instanceName) };
  } catch (err) {
    return { status: 400, message: err.message };
  }
}

export async function routerAddContact(req) {
  /**
   * @register_router contacts/create
   * @method POST
   */
  const { instanceName, ...data } = req.body || {};
  try {
    const contact = await addContact(db, instanceName, data);
    return { success: true, contact };
  } catch (err) {
    return { status: 400, message: err.message };
  }
}

export function routerUpdateContact(req) {
  /**
   * @register_router contacts/update
   * @method POST
   */
  const { instanceName, number, ...data } = req.body || {};
  try {
    return { success: true, contact: updateContact(db, instanceName, number, data) };
  } catch (err) {
    return { status: 400, message: err.message };
  }
}

export async function routerRemoveContact(req) {
  /**
   * @register_router contacts/delete
   * @method POST
   */
  const { instanceName, number } = req.body || {};
  try {
    return await removeContact(db, instanceName, number);
  } catch (err) {
    return { status: 400, message: err.message };
  }
}
