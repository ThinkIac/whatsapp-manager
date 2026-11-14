/**
 * core/conversationEngine.js
 * ─────────────────────────────────────────────────────────────────────────
 * Ponto único que processa mensagens recebidas via Baileys: encontra ou
 * cria a conversa, persiste texto/mídia e publica o evento do Runtime.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { getProxy } from 'logos';
import * as baileysManager from './baileysManager.js';
import { saveMedia } from './mediaStore.js';
import { emitWhatsappEvent } from './events.js';
import { metaDeliveryState, shouldApplyMetaStatus } from './metaDeliveryState.js';
import { metaAcceptedState } from './metaDeliveryState.js';
import { createDeliveryIntent } from './deliveryPipeline.js';
import * as providerRouter from './providerRouter.js';
import { canRunMetaSpecialist, specialistHistory } from './agentTraffic.js';
import { responseWaitMs } from './agentBehavior.js';
import { detectOptOut, isMetaPolicyRestriction, normalizeAgentIdentity } from './agentSafety.js';
import { normalizeWhatsAppNumber } from './conversationHelpers.js';
import { executeSpecialist } from '../../specialists/lib/executor.js';

const db = getProxy('whatsapp-manager');
const pendingMetaReplies = new Map();

function extractContent(waMessage) {
  const m = waMessage.message;
  if (!m) return null;

  if (m.conversation) return { text: m.conversation };
  if (m.extendedTextMessage) return { text: m.extendedTextMessage.text || '' };

  if (m.imageMessage) {
    return { text: m.imageMessage.caption || '', media: { type: 'image', mimetype: m.imageMessage.mimetype } };
  }
  if (m.videoMessage) {
    return { text: m.videoMessage.caption || '', media: { type: 'video', mimetype: m.videoMessage.mimetype } };
  }
  if (m.audioMessage || m.pttMessage) {
    const am = m.audioMessage || m.pttMessage;
    return { text: '', media: { type: 'audio', mimetype: am.mimetype } };
  }
  if (m.documentMessage) {
    return {
      text: m.documentMessage.caption || '',
      media: { type: 'document', mimetype: m.documentMessage.mimetype, filename: m.documentMessage.fileName },
    };
  }
  if (m.stickerMessage) {
    return { text: '', media: { type: 'sticker', mimetype: m.stickerMessage.mimetype || 'image/webp' } };
  }

  return null;
}

export async function handleIncomingMessage(instanceName, waMessage) {
  if (waMessage.key?.fromMe) return; // v1: não espelha mensagens enviadas do próprio celular

  const instance = db.instance.findOne({ name: instanceName });
  if (!instance) return;

  const jid = waMessage.key?.remoteJid;
  if (!jid || jid.endsWith('@g.us')) return; // v1: conversas 1:1 apenas

  const content = extractContent(waMessage);
  if (!content) return;

  let conv = db.conversation.findOne({ instanceId: instance.id, contactJid: jid });
  if (!conv) {
    conv = await db.conversation.push({
      instanceId: instance.id,
      contactJid: jid,
      contactName: waMessage.pushName || jid.split('@')[0],
      unreadCount: 0,
    });
  }

  let mediaField = null;
  if (content.media) {
    try {
      const buffer = await baileysManager.downloadIncomingMedia(instanceName, waMessage);
      const saved = saveMedia(conv.id, buffer, {
        mediaType: content.media.type,
        mimetype: content.media.mimetype,
        filename: content.media.filename,
      });
      mediaField = { mediaType: saved.mimetype, mediaUrl: saved.filename };
    } catch (err) {
      console.error('[conversationEngine] Falha ao baixar mídia:', err.message);
    }
  }

  const message = await db.message.push({
    conversationId: conv.id,
    instanceId: instance.id,
    direction: 'in',
    authorType: 'contact',
    text: content.text || null,
    mediaType: mediaField?.mediaType || null,
    mediaUrl: mediaField?.mediaUrl || null,
    waMessageId: waMessage.key?.id || null,
    status: 'sent',
    timestamp: new Date(),
  });

  conv.lastMessagePreview = content.text || (mediaField ? '[mídia]' : '');
  conv.lastMessageAt = new Date();
  conv.unreadCount = (conv.unreadCount || 0) + 1;
  if (detectOptOut(content.text)) {
    conv.agentPaused = true;
    conv.agentPauseReason = 'opt_out';
    conv.agentOptedOutAt = new Date();
  }

  await emitWhatsappEvent('whatsapp:message:received', {
    conversationId: conv.id,
    instanceName,
    instanceId: instance.id,
    messageId: message.id,
    text: content.text || '',
  });

}

export async function handleMetaIncomingMessage(instance, incoming, contacts = []) {
  if (!incoming?.id || !incoming?.from) return null;
  if (db.message.findOne({ instanceId: instance.id, waMessageId: incoming.id })) return null;
  const contact = contacts.find((item) => item.wa_id === incoming.from);
  // O wa_id é a identidade estável fornecida pela Meta. Nome de perfil é só
  // apresentação e jamais pode abrir uma segunda conversa.
  let jid;
  try { jid = normalizeWhatsAppNumber(incoming.from); }
  catch { return null; }
  let conv = db.conversation.findOne({ instanceId: instance.id, contactJid: jid });
  if (!conv) conv = await db.conversation.push({ instanceId: instance.id, contactJid: jid, contactName: contact?.profile?.name || jid, unreadCount: 0 });
  const media = ['image', 'video', 'audio', 'document', 'sticker'].includes(incoming.type) ? incoming[incoming.type] : null;
  const text = incoming.type === 'text' ? incoming.text?.body || '' : media?.caption || incoming.button?.text || incoming.interactive?.button_reply?.title || incoming.interactive?.list_reply?.title || '';
  let saved = null;
  if (media?.id) {
    const downloaded = await providerRouter.clientForInstance(instance).downloadMedia(media.id);
    saved = saveMedia(conv.id, downloaded.buffer, { mediaType: incoming.type, mimetype: downloaded.mimetype || media.mime_type, filename: media.filename });
  }
  const message = await db.message.push({ conversationId: conv.id, instanceId: instance.id, direction: 'in', authorType: 'contact', text: text || null, mediaType: saved?.mimetype || null, mediaUrl: saved?.filename || null, waMessageId: incoming.id, status: 'sent', providerStatus: 'received', statusUpdatedAt: new Date(), timestamp: new Date() });
  conv.lastMessagePreview = text || `[${incoming.type || 'mensagem'}]`;
  conv.lastMessageAt = new Date();
  conv.unreadCount = (conv.unreadCount || 0) + 1;
  await emitWhatsappEvent('whatsapp:message:received', { conversationId: conv.id, instanceName: instance.name, instanceId: instance.id, messageId: message.id, text });
  // A mensagem de entrada é persistida antes da verificação: a janela de 24h
  // é sempre calculada sobre dados locais e auditáveis, nunca sobre o payload.
  if (text.trim()) await scheduleMetaSpecialistReply(instance, conv, message);
  return message;
}

export async function handleEvolutionIncomingMessage(instance, incoming) {
  if (!incoming?.id || !incoming?.from) return null;
  if (db.message.findOne({ instanceId: instance.id, waMessageId: incoming.id })) return null;
  const jid = incoming.from;
  let conv = db.conversation.findOne({ instanceId: instance.id, contactJid: jid });
  if (!conv) conv = await db.conversation.push({ instanceId: instance.id, contactJid: jid, contactName: incoming.name || jid, unreadCount: 0 });
  const text = String(incoming.text || '');
  const message = await db.message.push({ conversationId: conv.id, instanceId: instance.id, direction: 'in', authorType: 'contact', text: text || null, waMessageId: incoming.id, status: 'sent', providerStatus: 'received', statusUpdatedAt: new Date(), timestamp: new Date() });
  conv.lastMessagePreview = text || `[${incoming.type || 'mensagem'}]`;
  conv.lastMessageAt = new Date();
  conv.unreadCount = (conv.unreadCount || 0) + 1;
  if (detectOptOut(text)) { conv.agentPaused = true; conv.agentPauseReason = 'opt_out'; conv.agentOptedOutAt = new Date(); }
  await emitWhatsappEvent('whatsapp:message:received', { conversationId: conv.id, instanceName: instance.name, instanceId: instance.id, messageId: message.id, text });
  if (text.trim()) await scheduleMetaSpecialistReply(instance, conv, message);
  return message;
}

// O sidecar whatsmeow entrega tanto mensagens recebidas quanto as que foram
// enviadas por outro dispositivo da mesma conta (WhatsApp Web/celular). Isso
// mantém a linha do tempo local coerente sem duplicar o que já foi enviado
// pelo próprio Manager: a chave do provedor é única por instância.
export async function handleWhatsmeowMessage(instance, incoming) {
  if (!incoming?.id || !incoming?.chatJid) return null;
  if (db.message.findOne({ instanceId: instance.id, waMessageId: incoming.id })) return null;
  // Para contas migradas para LID, o chat pode ainda vir como PN enquanto o
  // remetente traz o identificador que o servidor exige no envio. Priorizar o
  // LID evita converter a conversa de volta para @s.whatsapp.net.
  const fromMe = incoming.fromMe === true;
  // senderJid identifies our own account on outgoing device echoes. Only an
  // inbound sender may replace the remote chat JID with its LID mapping.
  const jid = String(!fromMe && incoming.senderJid || incoming.chatJid);
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return null;
  let conv = db.conversation.findOne({ instanceId: instance.id, contactJid: jid });
  // Migra a conversa existente do PN para o LID assim que o sidecar o
  // observa. Assim os envios manuais e do especialista passam a usar a rota
  // aceita pelo WhatsApp, sem criar duas conversas para o mesmo contato.
  if (!conv && incoming.senderJid && jid.endsWith('@lid')) {
    conv = db.conversation.findOne({ instanceId: instance.id, contactJid: String(incoming.chatJid) });
    if (conv) conv.contactJid = jid;
  }
  if (!conv) conv = await db.conversation.push({
    instanceId: instance.id,
    contactJid: jid,
    contactName: String(incoming.pushName || jid.split('@')[0]),
    unreadCount: 0,
  });
  const text = String(incoming.text || '');
  const timestamp = incoming.timestamp ? new Date(incoming.timestamp) : new Date();
  let saved = null;
  const media = incoming.media;
  if (media?.base64 && media?.type) {
    try {
      const buffer = Buffer.from(media.base64, 'base64');
      if (!buffer.length) throw new Error('conteúdo vazio');
      saved = saveMedia(conv.id, buffer, {
        mediaType: media.type,
        mimetype: media.mimetype,
        filename: media.filename,
      });
    } catch (error) {
      console.error('[conversationEngine] Falha ao persistir mídia whatsmeow:', error.message);
    }
  }
  const message = await db.message.push({
    conversationId: conv.id,
    instanceId: instance.id,
    direction: fromMe ? 'out' : 'in',
    authorType: fromMe ? 'human' : 'contact',
    text: text || null,
    mediaType: saved?.mimetype || null,
    mediaUrl: saved?.filename || null,
    waMessageId: incoming.id,
    status: fromMe ? 'sent' : 'sent',
    providerStatus: fromMe ? 'sent' : 'received',
    statusUpdatedAt: timestamp,
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
  });
  conv.lastMessagePreview = text || (saved ? '[mídia]' : '[mensagem]');
  conv.lastMessageAt = message.timestamp;
  if (!fromMe) conv.unreadCount = (conv.unreadCount || 0) + 1;
  await emitWhatsappEvent(fromMe ? 'whatsapp:message:sent' : 'whatsapp:message:received', {
    conversationId: conv.id, instanceName: instance.name, instanceId: instance.id, messageId: message.id, authorType: message.authorType, ...(fromMe ? {} : { text }),
  });
  return message;
}

export function scheduleMetaSpecialistReply(instance, conversation, incomingMessage) {
  const waitMs = responseWaitMs(instance.agentBehavior);
  if (!waitMs) return answerWithMetaSpecialist(instance, conversation, incomingMessage);

  const key = `${instance.id}:${conversation.id}`;
  const pending = pendingMetaReplies.get(key);
  if (pending) clearTimeout(pending.timer);
  const entry = { incomingMessage, timer: null };
  entry.timer = setTimeout(async () => {
    if (pendingMetaReplies.get(key) !== entry) return;
    pendingMetaReplies.delete(key);
    const currentInstance = db.instance.findOne({ id: instance.id }) || instance;
    const currentConversation = db.conversation[conversation.id] || conversation;
    await answerWithMetaSpecialist(currentInstance, currentConversation, entry.incomingMessage);
  }, waitMs);
  pendingMetaReplies.set(key, entry);
  return { scheduled: true, waitMs };
}

const META_AGENT_SCHEMA = {
  type: 'object', required: ['reply'],
  properties: { reply: { type: 'string' }, openContact: { type: 'boolean' }, handoff: { type: 'boolean' } },
};

export async function answerWithMetaSpecialist(instance, conversation, incomingMessage, runSpecialist = executeSpecialist) {
  const messages = db.message.query({ conversationId: conversation.id }, { sort: 'timestamp ASC', limit: 20 });
  const policy = canRunMetaSpecialist(instance, messages, new Date(), conversation);
  if (!policy.allowed) return { sent: false, reason: policy.reason };
  try {
    const result = await runSpecialist({
      specialistId: instance.specialistId,
      message: incomingMessage.text,
      messages: specialistHistory(messages.filter((message) => message.id !== incomingMessage.id)),
      context: {
        channel: instance.provider === 'evolution' ? 'whatsapp-evolution' : instance.provider === 'whatsmeow' ? 'whatsapp-whatsmeow' : 'whatsapp-meta', contactName: conversation.contactName || null,
        ...normalizeAgentIdentity(instance.agentIdentity),
        safety: 'Identifique-se pelo nome do negócio quando configurado. Não se passe por terceiros, não exponha dados de outros contatos e encaminhe para atendimento humano quando não puder atender com segurança.',
      },
      toolNames: ['destaCasaBuscarImoveis', 'destaCasaDetalharImovel', 'destaCasaSolicitarVisita'],
      outputSchema: META_AGENT_SCHEMA,
    });
    const output = result.output && typeof result.output === 'object' ? result.output : { reply: result.text };
    const text = String(output.reply || '').trim().slice(0, 4000);
    if (!text) return { sent: false, reason: 'O especialista não devolveu texto.' };
    if (output.handoff === true) {
      conversation.agentPaused = true;
      conversation.agentPauseReason = 'human_handoff';
      conversation.agentHandoffAt = new Date();
    }
    const message = await db.message.push({
      conversationId: conversation.id, instanceId: instance.id, direction: 'out', authorType: 'agent', text,
      status: 'pending_approval', timestamp: new Date(),
    });
    conversation.lastMessagePreview = text;
    conversation.lastMessageAt = new Date();
    const { intent } = await createDeliveryIntent(db, {
      schemaVersion: 1, requestId: `specialist:${message.id}`, source: 'agent', sourceMessageId: message.id,
      instanceId: instance.id, recipient: { number: conversation.contactJid, variables: { name: conversation.contactName } },
      message: { type: 'text', text },
    });
    message.deliveryIntentId = intent.id;
    await emitWhatsappEvent('whatsapp:delivery:intent-created', { schemaVersion: 1, deliveryIntentId: intent.id, instanceId: instance.id, status: intent.status });
    return { sent: false, pendingApproval: true, message, deliveryIntentId: intent.id };
  } catch (error) {
    if (isMetaPolicyRestriction({ providerErrorCode: error?.code, error: error?.message })) {
      instance.agentEnabled = false;
      instance.agentPausedReason = `Falha Meta de política ou restrição: ${error.message}`;
      instance.agentPausedAt = new Date();
    }
    console.error(`[conversationEngine] Falha ao responder com especialista na conversa "${conversation.id}":`, error.message);
    return { sent: false, reason: error.message };
  }
}

export async function handleMetaStatus(instance, providerStatus) {
  if (!providerStatus?.id) return null;
  const message = db.message.findOne({ instanceId: instance.id, waMessageId: providerStatus.id });
  if (!message || !shouldApplyMetaStatus(message, providerStatus)) return null;
  const delivery = metaDeliveryState(providerStatus);
  if (!delivery) return null;
  Object.assign(message, delivery);
  message.statusUpdatedAt = new Date();
  const { status } = delivery;
  const event = status === 'failed' ? 'whatsapp:message:failed' : `whatsapp:message:${status}`;
  if (status === 'failed' && isMetaPolicyRestriction(message)) {
    instance.agentEnabled = false;
    instance.agentPausedReason = `Falha Meta de política ou restrição: ${message.error || message.providerErrorCode}`;
    instance.agentPausedAt = new Date();
  }
  await emitWhatsappEvent(event, { conversationId: message.conversationId, instanceName: instance.name, messageId: message.id, ...(status === 'failed' ? { error: message.error } : {}) });
  await emitWhatsappEvent('whatsapp:delivery:status', { schemaVersion: 1, instanceId: instance.id, providerMessageId: providerStatus.id, status, error: delivery.error, providerErrorCode: delivery.providerErrorCode });
  return message;
}
