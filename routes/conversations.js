import { getProxy } from 'logos';
import * as baileysManager from '../core/baileysManager.js';
import * as providerRouter from '../core/providerRouter.js';
import { saveMedia, readMedia, removeConversationMedia } from '../core/mediaStore.js';
import { emitWhatsappEvent } from '../core/events.js';
import { conversationAddress, normalizeWhatsAppNumber } from '../core/conversationHelpers.js';
import { approvedTemplate, checkMetaCampaignAllowance, metaUsageSince, normalizeMetaSendControls } from '../core/metaSendControls.js';
import { metaAcceptedState } from '../core/metaDeliveryState.js';
import { templateDisplayText, templateForRetry, templateMessageData } from '../core/templateMessage.js';
import { setConversationBlocked } from '../core/conversationBlock.js';
import { createDeliveryIntent } from '../core/deliveryPipeline.js';

const db = getProxy('whatsapp-manager');

function mediaKindFromMime(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

// Mantém respostas de atendimento legíveis no WhatsApp sem quebrar uma frase
// no meio quando o fluxo pede envio segmentado.
export function splitTextForWhatsApp(text, maxLength = 650) {
  const limit = Math.max(120, Math.min(Number(maxLength) || 650, 4000));
  // `---` em uma linha própria força uma nova mensagem. Linhas em branco
  // continuam servindo como limites preferenciais para o empacotamento.
  const sections = String(text || '').trim().split(/^\s*---\s*$/m).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  const add = (part) => {
    if (!current) { current = part; return; }
    if (current.length + 2 + part.length <= limit) { current += `\n\n${part}`; return; }
    chunks.push(current);
    current = part;
  };

  for (const section of sections) {
    const paragraphs = section.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
    for (const paragraph of paragraphs) {
      if (paragraph.length <= limit) { add(paragraph); continue; }
      const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
      for (const sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
        if (sentence.length <= limit) { add(sentence); continue; }
        for (let start = 0; start < sentence.length; start += limit) add(sentence.slice(start, start + limit).trim());
      }
    }
    if (current) chunks.push(current);
    current = '';
  }
  return chunks;
}

export async function listConversations(req) {
  /**
   * @register_router conversations/list
   */
  const { instanceId } = req.query || {};
  const filter = instanceId ? { instanceId } : {};
  const conversations = db.conversation.query(filter, { sort: 'lastMessageAt DESC', limit: 200 });
  return { conversations };
}

export async function getMessages(req) {
  /**
   * @register_router conversations/:id/messages
   */
  const { id } = req.params;
  const { limit } = req.query || {};
  const take = Number(limit) || 40;

  const conv = db.conversation[id];
  if (!conv) return { status: 404, message: 'Conversa não encontrada' };

  const rows = db.message.query({ conversationId: id }, { sort: 'timestamp DESC', limit: take });
  const ordered = [...rows].reverse();

  conv.unreadCount = 0;

  return { messages: ordered, conversation: conv };
}

export async function deleteConversation(req) {
  /**
   * @register_router conversations/:id/delete
   * @method POST
   *
   * A conversa e as mídias pertencem ao histórico local do Manager. Apagá-la
   * não pede a remoção de mensagens no provedor, pois isso não é suportado de
   * forma uniforme por Meta Cloud, Evolution e conexões Web.
   */
  const conversation = db.conversation[req.params.id];
  if (!conversation) return { status: 404, message: 'Conversa não encontrada' };

  const messages = db.message.query({ conversationId: conversation.id });
  removeConversationMedia(conversation.id);
  for (const message of messages) await db.message.delete(message.id);
  await db.conversation.delete(conversation.id);

  await emitWhatsappEvent('whatsapp:conversation:deleted', {
    conversationId: conversation.id,
    instanceId: conversation.instanceId,
    messages: messages.length,
  });
  return { success: true, removed: { messages: messages.length } };
}

export async function setConversationAgentPause(req) {
  /**
   * @register_router conversations/:id/agent-pause
   * @method POST
   */
  const conv = db.conversation[req.params.id];
  if (!conv) return { status: 404, message: 'Conversa não encontrada' };
  const paused = req.body?.paused === true;
  if (paused) {
    conv.agentPaused = true;
    conv.agentPauseReason = req.body?.reason === 'opt_out' ? 'opt_out' : 'human_handoff';
    conv.agentHandoffAt = new Date();
  } else {
    conv.agentPaused = false;
    conv.agentPauseReason = null;
    conv.agentHandoffAt = null;
    conv.agentOptedOutAt = null;
  }
  return { success: true, conversation: conv };
}

export async function setConversationBlock(req) {
  /**
   * @register_router conversations/:id/block
   * @method POST
   */
  const conv = db.conversation[req.params.id];
  if (!conv) return { status: 404, message: 'Conversa não encontrada' };
  setConversationBlocked(conv, req.body?.blocked !== false, req.body?.reason || 'Bloqueado pelo operador');
  return { success: true, conversation: conv };
}

export async function openConversation(req) {
  /**
   * @register_router conversations/open
   * @method POST
   */
  const { instanceId, number, name } = req.body || {};
  const instance = db.instance[instanceId];
  if (!instance) return { status: 404, message: 'Instância não encontrada' };
  if (instance.status !== 'open') return { status: 409, message: 'Selecione uma instância conectada.' };

  let normalized;
  try { normalized = normalizeWhatsAppNumber(number); }
  catch (error) { return { status: 400, message: error.message }; }

  const contactJid = conversationAddress(instance.provider, normalized);
  let conversation = db.conversation.findOne({ instanceId: instance.id, contactJid });
  if (!conversation) {
    conversation = await db.conversation.push({
      instanceId: instance.id,
      contactJid,
      contactName: String(name || '').trim() || normalized,
      unreadCount: 0,
      lastMessageAt: new Date(),
    });
  }
  return { success: true, conversation };
}

export async function openConversationWithTemplate(req) {
  /**
   * @register_router conversations/open-template
   * @method POST
   *
   * A Meta só permite uma conversa iniciada pela empresa com um template
   * aprovado. Esta rota cria (ou reutiliza) a conversa local e envia esse
   * primeiro template no mesmo fluxo, sem tentar enviar texto livre fora da
   * janela de atendimento de 24 horas.
   */
  const { instanceId, templateName, languageCode = 'pt_BR' } = req.body || {};
  const instance = db.instance[instanceId];
  if (!instance) return { status: 404, message: 'Instância não encontrada' };
  if (!providerRouter.isMetaInstance(instance)) return { status: 400, message: 'O primeiro contato por template exige uma instância Meta Cloud API.' };
  if (!templateName) return { status: 400, message: 'Selecione um template aprovado para iniciar a conversa.' };

  const template = await findApprovedMetaTemplate(instance, templateName, languageCode);
  if (!template.success) return template;

  const opened = await openConversation(req);
  if (!opened?.success) return opened;

  const result = await sendTemplate({
    ...req,
    params: { ...(req.params || {}), id: opened.conversation.id },
    body: { ...(req.body || {}), name: req.body?.templateName || req.body?.name },
  }, template.template);
  return { ...result, conversation: opened.conversation };
}

async function findApprovedMetaTemplate(instance, name, languageCode) {
  try {
    const catalog = await providerRouter.clientForInstance(instance).listMessageTemplates(instance.whatsappBusinessAccountId);
    const template = catalog.find((item) => item.name === name && (item.language === languageCode || item.languageCode === languageCode));
    if (!approvedTemplate(template)) return { status: 400, message: 'Selecione um template aprovado na Meta e no idioma informado.' };
    return { success: true, template };
  } catch (error) {
    return { status: error.status || 502, message: `Não foi possível confirmar o template na Meta: ${error.message}` };
  }
}

export async function sendMessage(req) {
  /**
   * @register_router conversations/:id/send
   * @method POST
   *
   * CORREÇÃO: antes esta rota fazia `await baileysManager.sendText/sendMedia`
   * ANTES de criar a Message. Se o envio falhasse (instância caiu, número
   * inválido, timeout do Baileys etc.), a exception subia e a mensagem
   * NUNCA era salva — sumia sem deixar rastro, e o operador só via "nada
   * aconteceu" até tentar de novo manualmente.
   *
   * Agora: a Message é criada IMEDIATAMENTE com status "sending" e a rota
   * já retorna — o front mostra a bolha na hora. O envio real ao WhatsApp
   * roda em background e atualiza o status pra "sent" ou "failed" (com o
   * motivo) quando terminar. O polling de 3s do ChatThread pega essa
   * atualização sozinho.
   */
  const { id } = req.params;
  const { text, mediaBase64, mediaType, mimetype, filename, splitOnBlankLines, maxChunkLength, humanize, deferDispatch, authorType, automationId } = req.body || {};
  // A UI e os envios manuais continuam sendo humanos por padrão. Flows podem
  // identificar explicitamente seus envios automáticos para aplicar políticas
  // por conversa sem contar respostas do operador.
  // `automationId` também identifica automação. Assim, um Flow não consegue
  // contornar o pipeline só por omitir o marcador authorType legado.
  const resolvedAuthorType = authorType === 'agent' || typeof automationId === 'string' && automationId.trim()
    ? 'agent'
    : 'human';
  const resolvedAutomationId = resolvedAuthorType === 'agent' && typeof automationId === 'string'
    ? automationId.trim().slice(0, 160) || null
    : null;

  const conv = db.conversation[id];
  if (!conv) return { status: 404, message: 'Conversa não encontrada' };
  const instance = db.instance[conv.instanceId];
  if (!instance) return { status: 404, message: 'Instância não encontrada' };
  if (!text && !mediaBase64) return { status: 400, message: 'text ou mediaBase64 é obrigatório' };
  if (resolvedAuthorType === 'agent') {
    if (mediaBase64) return { status: 400, message: 'Mídia automática ainda não é suportada no pipeline de aprovação.' };
    const message = await db.message.push({
      conversationId: conv.id, instanceId: instance.id, direction: 'out', authorType: 'agent',
      automationId: resolvedAutomationId, text: String(text), status: 'pending_approval', timestamp: new Date(),
    });
    try {
      const { intent } = await createDeliveryIntent(db, {
        schemaVersion: 1, requestId: `agent:${message.id}`, source: 'agent', sourceMessageId: message.id,
        instanceId: instance.id, recipient: { number: conv.contactJid, variables: { name: conv.contactName } },
        message: { type: 'text', text: String(text) },
      });
      message.deliveryIntentId = intent.id;
      conv.lastMessagePreview = text;
      conv.lastMessageAt = new Date();
      await emitWhatsappEvent('whatsapp:delivery:intent-created', { schemaVersion: 1, deliveryIntentId: intent.id, instanceId: instance.id, status: intent.status });
      return { success: true, message, conversation: conv, deliveryIntentId: intent.id, status: intent.status };
    } catch (error) {
      message.status = 'failed';
      message.error = error.message;
      return { status: error.status || 400, message: error.message };
    }
  }
  // Mídia permanece uma única mensagem. Para texto, o Flow pode optar por
  // dividir em blocos curtos, preservando parágrafos e a ordem de envio.
  // `humanize` é o atalho próprio para automações: reconhece `---`, divide a
  // resposta e aplica presença/digitação em cada parte. O parâmetro antigo é
  // mantido para telas e flows já publicados.
  if ((splitOnBlankLines === true || humanize === true) && !mediaBase64) {
    const parts = splitTextForWhatsApp(text, maxChunkLength);
    if (parts.length > 1) {
      const pending = [];
      for (const part of parts) {
        const result = await sendMessage({ ...req, body: {
          text: part,
          deferDispatch: true,
          authorType: resolvedAuthorType,
          automationId: resolvedAutomationId,
        } });
        if (!result?.success) return result;
        pending.push({ message: result.message, text: part });
      }
      // A rota responde logo, mas o despacho é serial para preservar a ordem
      // dos parágrafos no provedor, inclusive quando há atraso de digitação.
      void (async () => {
        for (let index = 0; index < pending.length; index += 1) {
          // Um intervalo curto impede que dois balões apareçam como um único
          // envio. A digitação da próxima parte é calculada pelo bridge.
          if (index > 0 && humanize === true) await humanizedInterMessageDelay();
          const item = pending[index];
          await dispatchOutgoingSend(instance, conv, item.message, { text: item.text }, req.localAuthorize, { humanize: humanize === true });
        }
      })();
      return { success: true, messages: pending.map((item) => item.message), conversation: conv, split: true };
    }
  }
  if (providerRouter.isMetaInstance(instance) && mediaBase64) return { status: 400, message: 'Envio de mídia Meta ainda requer upload oficial; envie texto ou use um template.' };
  if (providerRouter.isMetaInstance(instance)) {
    const allowance = checkMetaCampaignAllowance(normalizeMetaSendControls(instance.metaSendControls), {
      ...metaUsageSince(db.message.all(), instance.id), recipientCount: 1,
    });
    if (!allowance.allowed) return { status: 429, message: allowance.message };
  }

  let savedMediaType = null;
  let savedMediaUrl = null;

  if (mediaBase64) {
    const buffer = Buffer.from(mediaBase64, 'base64');
    const saved = saveMedia(conv.id, buffer, { mediaType, mimetype, filename });
    savedMediaType = mimetype || saved.mimetype;
    savedMediaUrl = saved.filename;
  }

  const message = await db.message.push({
    conversationId: conv.id,
    instanceId: instance.id,
    direction: 'out',
    authorType: resolvedAuthorType,
    automationId: resolvedAutomationId,
    text: text || null,
    mediaType: savedMediaType,
    mediaUrl: savedMediaUrl,
    status: 'sending',
    timestamp: new Date(),
  });

  conv.lastMessagePreview = text || (savedMediaType ? '[mídia]' : '');
  conv.lastMessageAt = new Date();

  // Não usa "await" aqui de propósito — o envio ao WhatsApp roda depois
  // da rota já ter respondido.
  if (!deferDispatch) {
    dispatchOutgoingSend(instance, conv, message, { text, mediaBase64, mediaType, mimetype, filename }, req.localAuthorize, { humanize: humanize === true });
  }

  return { success: true, message, conversation: conv };
}

function humanizedInterMessageDelay() {
  // Pausa natural entre balões, sem competir com o tempo de digitação da
  // próxima parte. Não é um delay fixo visível para todas as conversas.
  return new Promise((resolve) => setTimeout(resolve, 900 + Math.round(Math.random() * 900)));
}

async function dispatchOutgoingSend(instance, conv, message, { text, mediaBase64, mediaType, mimetype, filename }, authorize, { humanize = false } = {}) {
  try {
    authorize?.();
    if (providerRouter.isMetaInstance(instance)) {
      const sent = await providerRouter.sendText(instance, conv.contactJid, text, authorize, { humanize });
      Object.assign(message, metaAcceptedState(sent.providerMessageId));
    } else if (mediaBase64) {
      const sent = await providerRouter.sendMedia(instance, conv.contactJid, {
        mediaType, base64: mediaBase64, mimetype, filename, caption: text,
      }, authorize);
      message.waMessageId = sent?.providerMessageId || null;
    } else {
      const sent = await providerRouter.sendText(instance, conv.contactJid, text, authorize, { humanize });
      message.waMessageId = sent.providerMessageId;
    }
    if (!providerRouter.isMetaInstance(instance)) message.status = 'sent';
    message.error = null;

    await emitWhatsappEvent('whatsapp:message:sent', {
      conversationId: conv.id,
      instanceName: instance.name,
      messageId: message.id,
      authorType: message.authorType,
    });
  } catch (err) {
    message.status = 'failed';
    message.error = err.message;
    console.error(`[conversations] Falha ao enviar mensagem manual na conversa "${conv.id}":`, err.message);
    await emitWhatsappEvent('whatsapp:message:failed', {
      conversationId: conv.id,
      instanceName: instance.name,
      messageId: message.id,
      error: err.message,
    });
  }
}

export async function retryMessage(req) {
  /**
   * @register_router conversations/:id/messages/:messageId/retry
   * @method POST
   */
  const { id, messageId } = req.params;
  const conv = db.conversation[id];
  if (!conv) return { status: 404, message: 'Conversa não encontrada' };
  const instance = db.instance[conv.instanceId];
  if (!instance) return { status: 404, message: 'Instância não encontrada' };
  const message = db.message[messageId];
  if (!message || message.conversationId !== conv.id) {
    return { status: 404, message: 'Mensagem não encontrada' };
  }

  message.status = 'sending';
  message.error = null;

  try {
    req.localAuthorize?.();
    if (providerRouter.isMetaInstance(instance) && message.mediaUrl) {
      throw new Error('Reenvio de mídia Meta ainda não está disponível');
    } else if (providerRouter.isMetaInstance(instance)) {
      const template = templateForRetry(message);
      if (template?.error) throw new Error(template.error);
      const sent = template
        ? await providerRouter.sendTemplate(instance, conv.contactJid, template, req.localAuthorize)
        : await providerRouter.sendText(instance, conv.contactJid, message.text, req.localAuthorize);
      Object.assign(message, metaAcceptedState(sent.providerMessageId));
    } else if (message.mediaUrl) {
      const buffer = readMedia(conv.id, message.mediaUrl);
      if (!buffer) throw new Error('Mídia original não encontrada para reenvio');
      const sent = await providerRouter.sendMedia(instance, conv.contactJid, {
        mediaType: mediaKindFromMime(message.mediaType || ''),
        base64: buffer.toString('base64'),
        mimetype: message.mediaType,
        filename: message.mediaUrl,
        caption: message.text,
      }, req.localAuthorize);
      message.waMessageId = sent?.providerMessageId || null;
    } else {
      const sent = await providerRouter.sendText(instance, conv.contactJid, message.text, req.localAuthorize);
      message.waMessageId = sent.providerMessageId;
    }
    if (!providerRouter.isMetaInstance(instance)) message.status = 'sent';
    message.error = null;
    await emitWhatsappEvent('whatsapp:message:sent', {
      conversationId: conv.id,
      instanceName: instance.name,
      messageId: message.id,
      authorType: 'human',
      retry: true,
    });
  } catch (err) {
    message.status = 'failed';
    message.error = err.message;
    await emitWhatsappEvent('whatsapp:message:failed', {
      conversationId: conv.id,
      instanceName: instance.name,
      messageId: message.id,
      error: err.message,
      retry: true,
    });
    return { success: false, message, error: err.message };
  }

  return { success: true, message };
}

export async function sendTemplate(req, approvedRemoteTemplate = null) {
  /**
   * @register_router conversations/:id/send-template
   * @method post
   */
  const conv = db.conversation[req.params.id];
  if (!conv) return { status: 404, message: 'Conversa não encontrada' };
  const instance = db.instance[conv.instanceId];
  if (!instance) return { status: 404, message: 'Instância não encontrada' };
  const { name, languageCode, components } = req.body || {};
  if (!name) return { status: 400, message: 'name do template é obrigatório' };
  if (!providerRouter.isMetaInstance(instance)) return { status: 400, message: 'Templates oficiais exigem uma instância Meta Cloud API.' };
  const resolvedLanguageCode = languageCode || 'pt_BR';
  const template = approvedRemoteTemplate || await findApprovedMetaTemplate(instance, name, resolvedLanguageCode);
  if (!approvedRemoteTemplate && !template.success) return template;
  const allowance = checkMetaCampaignAllowance(normalizeMetaSendControls(instance.metaSendControls), {
    ...metaUsageSince(db.message.all(), instance.id), recipientCount: 1,
  });
  if (!allowance.allowed) return { status: 429, message: allowance.message };
  const remoteTemplate = approvedRemoteTemplate || template.template;
  const displayText = templateDisplayText(remoteTemplate, components, name);
  const message = await db.message.push({
    conversationId: conv.id, instanceId: instance.id, direction: 'out', authorType: 'human',
    text: displayText, ...templateMessageData({ name, languageCode: resolvedLanguageCode, components }),
    status: 'sending', timestamp: new Date(),
  });
  conv.lastMessagePreview = displayText;
  conv.lastMessageAt = new Date();
  try {
    req.localAuthorize?.();
    const sent = await providerRouter.sendTemplate(instance, conv.contactJid, { name, languageCode: resolvedLanguageCode, components }, req.localAuthorize);
    Object.assign(message, metaAcceptedState(sent.providerMessageId));
    message.statusUpdatedAt = new Date();
    await emitWhatsappEvent('whatsapp:message:sent', { conversationId: conv.id, instanceName: instance.name, messageId: message.id, authorType: 'human' });
    return { success: true, message };
  } catch (err) {
    message.status = 'failed';
    message.error = err.message;
    await emitWhatsappEvent('whatsapp:message:failed', { conversationId: conv.id, instanceName: instance.name, messageId: message.id, error: err.message });
    return { success: false, message, error: err.message };
  }
}
