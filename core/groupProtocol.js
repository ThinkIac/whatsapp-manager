import { getProxy } from 'logos';
import { requireBridge } from './bridgeRegistry.js';

const db = getProxy('whatsapp-manager');

async function resolve(instanceId, method) {
  const instance = db.instance[instanceId];
  if (!instance) throw Object.assign(new Error('Instância não encontrada.'), { status: 404 });
  const bridge = await requireBridge(instance.provider || 'baileys');
  if (bridge.manifest?.features?.groupManagement !== true || typeof bridge[method] !== 'function') {
    throw Object.assign(new Error(`A instância ${instance.name} (${instance.provider || 'baileys'}) não oferece gerenciamento de grupos.`), { status: 409 });
  }
  return { instance, bridge };
}

export async function listGroups(instanceId) { const { instance, bridge } = await resolve(instanceId, 'listGroups'); return bridge.listGroups(instance); }
export async function getGroup(instanceId, groupJid) { const { instance, bridge } = await resolve(instanceId, 'getGroup'); return bridge.getGroup(instance, groupJid); }
export async function createGroup(instanceId, subject, participants) { const { instance, bridge } = await resolve(instanceId, 'createGroup'); return bridge.createGroup(instance, subject, participants); }
export async function updateGroup(instanceId, groupJid, changes) { const { instance, bridge } = await resolve(instanceId, 'updateGroup'); return bridge.updateGroup(instance, groupJid, changes); }
export async function updateGroupParticipants(instanceId, groupJid, action, participants) { const { instance, bridge } = await resolve(instanceId, 'updateGroupParticipants'); return bridge.updateGroupParticipants(instance, groupJid, action, participants); }
export async function getGroupInviteLink(instanceId, groupJid, reset) { const { instance, bridge } = await resolve(instanceId, 'getGroupInviteLink'); return bridge.getGroupInviteLink(instance, groupJid, reset); }
export async function leaveGroup(instanceId, groupJid) { const { instance, bridge } = await resolve(instanceId, 'leaveGroup'); return bridge.leaveGroup(instance, groupJid); }
export async function sendGroupText(instanceId, groupJid, text) { const { instance, bridge } = await resolve(instanceId, 'sendGroupText'); return bridge.sendGroupText(instance, groupJid, text); }
