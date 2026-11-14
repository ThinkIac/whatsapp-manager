import { getProxy } from 'logos';
import {
  getMessages,
  listConversations,
  openConversation,
  openConversationWithTemplate,
  retryMessage,
  sendMessage,
  sendTemplate,
} from './routes/conversations.js';
import { listInstances } from './routes/instances.js';
import { listMetaTemplates } from './routes/templates.js';
import { listContacts } from './core/contacts.js';
import * as groups from './core/groupProtocol.js';
import { setConversationBlocked } from './core/conversationBlock.js';
import { consultationTarget, isPendingConsultationForConversation, rankKnowledge } from './core/agentConsultation.js';

const db = getProxy('whatsapp-manager');

function normalizeInput(input) {
  return input?.input && typeof input.input === 'object' && !Array.isArray(input.input)
    ? input.input
    : input || {};
}

function toolResult(result) {
  if (result?.status >= 400) {
    const error = new Error(result.message || result.data?.message || 'Falha na operação do WhatsApp');
    error.status = result.status;
    throw error;
  }
  return result;
}

/**
 * @register_tool whatsapp_list_instances
 * @reach auto
 * @description Lista todas as instâncias do WhatsApp Manager, incluindo Meta Cloud, Baileys, Evolution e Whatsmeow, com provedor e estado atual.
 */
export async function whatsappListAllInstances() {
  return listInstances({});
}

/**
 * @register_tool whatsapp_list_contacts
 * @reach auto
 * @description Lista os contatos cadastrados em uma instância do WhatsApp Manager. Use antes de enviar quando o usuário identificar destinatários pelo cadastro, sem informar os números.
 * @param {string} instanceName - Nome da instância
 */
export async function whatsappListContacts(input) {
  const { instanceName } = normalizeInput(input);
  if (!instanceName) {
    const error = new Error('Informe instanceName');
    error.status = 400;
    throw error;
  }
  return {
    success: true,
    instanceName: String(instanceName),
    contacts: listContacts(db, String(instanceName)).map(({ id, instanceId, number, name, role, isOwner }) => ({
      id,
      instanceId,
      number,
      name,
      role,
      isOwner: !!isOwner,
    })),
  };
}

/**
 * @register_tool whatsapp_list_conversations
 * @reach manual
 * @description Lista as conversas recentes do WhatsApp, opcionalmente filtradas por instância.
 * @param {string?} instanceId - Identificador da instância
 */
export async function whatsappListConversations(input) {
  const { instanceId } = normalizeInput(input);
  return listConversations({ query: { instanceId } });
}

/**
 * @register_tool whatsapp_get_messages
 * @reach manual
 * @description Lê as mensagens recentes de uma conversa do WhatsApp e marca a conversa como lida.
 * @param {string} conversationId - Identificador da conversa
 * @param {number?} limit - Quantidade máxima de mensagens, padrão 40
 */
export async function whatsappGetMessages(input) {
  const { conversationId, limit } = normalizeInput(input);
  return toolResult(await getMessages({ params: { id: conversationId }, query: { limit } }));
}

/**
 * @register_tool whatsapp_count_automated_replies
 * @reach manual
 * @description Conta respostas automáticas válidas de uma automação específica na conversa. Mensagens manuais e envios que falharam não entram na contagem.
 * @param {string} conversationId - Identificador da conversa
 * @param {string} automationId - Identificador estável da automação, por exemplo flow:wf_abc
 */
export async function whatsappCountAutomatedReplies(input) {
  const { conversationId, automationId } = normalizeInput(input);
  if (!conversationId || !automationId) {
    const error = new Error('Informe conversationId e automationId');
    error.status = 400;
    throw error;
  }
  const replies = db.message.query({
    conversationId,
    direction: 'out',
    authorType: 'agent',
    automationId: String(automationId),
  }).filter((message) => message.status !== 'failed');
  return {
    success: true,
    conversationId,
    automationId: String(automationId),
    replyCount: replies.length,
  };
}

/**
 * @register_tool whatsapp_is_latest_received_message
 * @reach manual
 * @description Confirma se uma mensagem recebida ainda é a mais recente da conversa. Útil para debouncing de respostas automáticas.
 * @param {string} conversationId - Identificador da conversa
 * @param {string} messageId - Identificador da mensagem recebida
 */
export async function whatsappIsLatestReceivedMessage(input) {
  const { conversationId, messageId } = normalizeInput(input);
  if (!conversationId || !messageId) {
    const error = new Error('Informe conversationId e messageId');
    error.status = 400;
    throw error;
  }

  const latest = db.message.query(
    { conversationId, direction: 'in', authorType: 'contact' },
    { sort: 'timestamp DESC', limit: 1 },
  )[0] || null;

  return {
    success: true,
    isLatest: latest?.id === messageId,
    latestMessageId: latest?.id || null,
  };
}

/**
 * @register_tool whatsapp_block_user
 * @reach manual
 * @description Bloqueia localmente um usuário para automações desta conversa. Mensagens futuras continuam registradas no histórico, mas agentes e Flows podem identificar o bloqueio e não responder. A operação é reversível com blocked:false.
 * @param {string} conversationId - Identificador da conversa
 * @param {boolean?} blocked - true para bloquear; false para desbloquear. Padrão true
 * @param {string?} reason - Motivo curto e auditável do bloqueio
 */
export async function whatsappBlockUser(input) {
  const { conversationId, blocked = true, reason } = normalizeInput(input);
  const conversation = db.conversation[conversationId];
  if (!conversation) {
    const error = new Error('Conversa não encontrada');
    error.status = 404;
    throw error;
  }

  const shouldBlock = blocked !== false;
  setConversationBlocked(conversation, shouldBlock, reason || 'Bloqueado por automação');

  return {
    success: true,
    conversationId: conversation.id,
    blocked: shouldBlock,
    reason: conversation.agentBlockReason,
  };
}

/**
 * @register_tool whatsapp_open_conversation
 * @reach manual
 * @description Abre ou reutiliza uma conversa com um telefone. Para Meta Cloud, use whatsapp_start_meta_template no primeiro contato ou fora da janela de 24 horas.
 * @param {string} instanceId - Identificador da instância
 * @param {string} number - Telefone completo com DDI
 * @param {string?} name - Nome do contato
 */
export async function whatsappOpenConversation(input) {
  return toolResult(await openConversation({ body: normalizeInput(input) }));
}

/**
 * @register_tool whatsapp_send_message
 * @reach auto
 * @description Tool universal de envio por instância. Informe instanceId e number para abrir ou reutilizar a conversa e enviar pelo provedor configurado na instância (Meta Cloud, Baileys, Evolution ou Whatsmeow). conversationId continua aceito para conversas existentes. O retorno inicial pode ter status sending; consulte as mensagens para confirmar sent, delivered, read ou failed.
 * @param {string?} instanceId - Identificador da instância; obrigatório quando conversationId e instanceName não forem informados
 * @param {string?} instanceName - Nome da instância; alternativa legível ao instanceId quando conversationId não for informado
 * @param {string?} number - Telefone completo com DDI; obrigatório quando conversationId não for informado
 * @param {string?} name - Nome do contato ao abrir uma nova conversa
 * @param {string?} conversationId - Identificador de uma conversa existente
 * @param {string} text - Texto da mensagem
 * @param {boolean?} splitOnBlankLines - Divide respostas em mensagens menores nos separadores de parágrafo ou em uma linha contendo ---
 * @param {number?} maxChunkLength - Tamanho máximo de cada parte quando splitOnBlankLines for verdadeiro
 * @param {boolean?} humanize - Para respostas automáticas: reconhece --- como nova mensagem, simula presença/digitação quando o provedor suporta e espaça as partes
 * @param {string?} authorType - Use agent apenas para uma resposta automática que precise ser auditada pelo Flow
 * @param {string?} automationId - Identificador da automação que enviou a resposta; usado junto com authorType:agent
 */
export async function whatsappSendMessage(input) {
  const { instanceId, instanceName, number, name, conversationId, text, splitOnBlankLines, maxChunkLength, humanize, authorType, automationId } = normalizeInput(input);
  let resolvedConversationId = conversationId;

  if (!resolvedConversationId) {
    const resolvedInstanceId = instanceId || (instanceName ? db.instance.findOne({ name: String(instanceName) })?.id : null);
    if (!resolvedInstanceId || !number) {
      const error = new Error('Informe conversationId ou o par instanceId/instanceName e number');
      error.status = 400;
      throw error;
    }
    const opened = toolResult(await openConversation({ body: { instanceId: resolvedInstanceId, number, name } }));
    resolvedConversationId = opened.conversation.id;
  }

  return toolResult(await sendMessage({
    params: { id: resolvedConversationId },
    body: {
      text,
      splitOnBlankLines: splitOnBlankLines === true,
      maxChunkLength,
      humanize: humanize === true,
      authorType: authorType === 'agent' ? 'agent' : 'human',
      automationId: authorType === 'agent' ? automationId : null,
    },
  }));
}

/**
 * @register_tool whatsapp_request_agent_consultation
 * @reach manual
 * @description Registra uma dúvida que o agente não conseguiu confirmar e a envia para um responsável pelo WhatsApp. Não duplica uma consulta pendente da mesma conversa.
 * @param {string} conversationId - Conversa do cliente que originou a dúvida
 * @param {string} targetNumber - Número do responsável, com DDI
 * @param {string} question - Dúvida objetiva a confirmar
 * @param {string?} sourceMessageId - Mensagem que originou a consulta
 */
export async function whatsappRequestAgentConsultation(input) {
  const { conversationId, targetNumber, question, sourceMessageId } = normalizeInput(input);
  const source = db.conversation[conversationId];
  if (!source) throw Object.assign(new Error('Conversa de origem não encontrada'), { status: 404 });
  const normalizedTarget = consultationTarget(targetNumber);
  const cleanQuestion = String(question || '').trim().slice(0, 1800);
  if (!cleanQuestion) throw Object.assign(new Error('Informe a dúvida a confirmar'), { status: 400 });
  const existing = db.agentConsultation.query({ sourceConversationId: source.id, status: 'pending' }, { sort: 'createdAt DESC', limit: 1 })[0];
  if (existing) return { success: true, consultation: existing, duplicate: true };

  const sent = await whatsappSendMessage({
    instanceId: source.instanceId,
    number: normalizedTarget,
    name: 'Responsável',
    text: `Consulta pendente de um cliente:\n${cleanQuestion}\n\nResponda nesta conversa para que eu repasse ao cliente.`,
    authorType: 'agent',
    automationId: 'agent-consultation',
  });
  const helper = sent.conversation;
  const consultation = await db.agentConsultation.push({
    instanceId: source.instanceId,
    sourceConversationId: source.id,
    sourceMessageId: sourceMessageId || null,
    helperConversationId: helper.id,
    helperContactJid: helper.contactJid,
    question: cleanQuestion,
    status: 'pending',
    createdAt: new Date(),
  });
  return { success: true, consultation, helperConversationId: helper.id };
}

/**
 * @register_tool whatsapp_take_agent_consultation_answer
 * @reach manual
 * @description Consome a resposta recebida do responsável para uma consulta pendente. Só uma resposta pendente da conversa do responsável é aceita.
 * @param {string} conversationId - Conversa que recebeu a resposta do responsável
 * @param {string} answer - Texto recém-recebido do responsável
 */
export async function whatsappTakeAgentConsultationAnswer(input) {
  const { conversationId, answer } = normalizeInput(input);
  const cleanAnswer = String(answer || '').trim().slice(0, 4000);
  const consultation = db.agentConsultation.query({ helperConversationId: conversationId, status: 'pending' }, { sort: 'createdAt ASC', limit: 1 })[0];
  if (!isPendingConsultationForConversation(consultation, conversationId) || !cleanAnswer) return { success: true, hasPending: false };
  consultation.status = 'answered';
  consultation.helperAnswer = cleanAnswer;
  consultation.answeredAt = new Date();
  return { success: true, hasPending: true, consultation };
}

/**
 * @register_tool whatsapp_store_agent_knowledge
 * @reach manual
 * @description Guarda uma informação confirmada para consultas futuras do agente. A resposta deve ser redigida para o cliente, sem dados privados do responsável.
 * @param {string} consultationId - Consulta humana já respondida
 * @param {string} answer - Informação confirmada, redigida para reutilização
 */
export async function whatsappStoreAgentKnowledge(input) {
  const { consultationId, answer } = normalizeInput(input);
  const consultation = db.agentConsultation[consultationId];
  if (!consultation || consultation.status !== 'answered') throw Object.assign(new Error('Consulta respondida não encontrada'), { status: 404 });
  const cleanAnswer = String(answer || '').trim().slice(0, 4000);
  if (!cleanAnswer) throw Object.assign(new Error('Informe a informação confirmada'), { status: 400 });
  const existing = db.agentKnowledge.findOne({ consultationId: consultation.id });
  if (existing) { existing.answer = cleanAnswer; return { success: true, knowledge: existing, updated: true }; }
  const knowledge = await db.agentKnowledge.push({ instanceId: consultation.instanceId, consultationId: consultation.id, question: consultation.question, answer: cleanAnswer, createdAt: new Date() });
  return { success: true, knowledge, updated: false };
}

/**
 * @register_tool whatsapp_find_agent_knowledge
 * @reach manual
 * @description Busca informações confirmadas anteriormente para a mesma instância, antes de pedir nova confirmação humana.
 * @param {string} instanceId - Instância do WhatsApp
 * @param {string} query - Dúvida do cliente
 * @param {number?} limit - Máximo de resultados, até 5
 */
export async function whatsappFindAgentKnowledge(input) {
  const { instanceId, query, limit } = normalizeInput(input);
  if (!instanceId || !String(query || '').trim()) throw Object.assign(new Error('Informe instanceId e query'), { status: 400 });
  const entries = db.agentKnowledge.query({ instanceId }, { sort: 'createdAt DESC', limit: 100 });
  return { success: true, entries: rankKnowledge(query, entries, limit) };
}

/**
 * @register_tool whatsapp_get_agent_knowledge_context
 * @reach manual
 * @description Obtém toda a memória confirmada de uma instância para inserção automática no contexto do agente.
 * @param {string} instanceId - Instância do WhatsApp
 */
export async function whatsappGetAgentKnowledgeContext(input) {
  const { instanceId } = normalizeInput(input);
  if (!instanceId) throw Object.assign(new Error('Informe instanceId'), { status: 400 });
  const entries = db.agentKnowledge.query({ instanceId }, { sort: 'createdAt ASC', limit: 500 });
  return {
    success: true,
    entries: entries.map(({ id, question, answer, createdAt }) => ({ id, question, answer, createdAt })),
  };
}

/**
 * @register_tool whatsapp_send_media
 * @reach manual
 * @description Envia uma imagem, áudio, vídeo ou documento em base64 para uma conversa existente. Meta Cloud ainda não aceita mídia por este fluxo.
 * @param {string} conversationId - Identificador da conversa
 * @param {string} mediaBase64 - Conteúdo do arquivo em base64
 * @param {string} mediaType - Tipo: image, audio, video ou document
 * @param {string} mimetype - MIME type do arquivo
 * @param {string?} filename - Nome do arquivo
 * @param {string?} text - Legenda opcional
 */
export async function whatsappSendMedia(input) {
  const { conversationId, mediaBase64, mediaType, mimetype, filename, text } = normalizeInput(input);
  return toolResult(await sendMessage({
    params: { id: conversationId },
    body: { mediaBase64, mediaType, mimetype, filename, text },
  }));
}

/**
 * @register_tool whatsapp_list_groups
 * @reach manual
 * @description Lista os grupos da instância usando o bridge configurado. Inicialmente disponível para Whatsmeow.
 * @param {string} instanceId - Identificador da instância
 */
export async function whatsappListGroups(input) {
  const { instanceId } = normalizeInput(input);
  return groups.listGroups(instanceId);
}

/**
 * @register_tool whatsapp_get_group
 * @reach manual
 * @description Obtém metadados e participantes de um grupo. Inicialmente disponível para Whatsmeow.
 * @param {string} instanceId - Identificador da instância
 * @param {string} groupJid - Identificador do grupo terminado em @g.us
 */
export async function whatsappGetGroup(input) {
  const { instanceId, groupJid } = normalizeInput(input);
  return groups.getGroup(instanceId, groupJid);
}

/**
 * @register_tool whatsapp_create_group
 * @reach manual
 * @description Cria um grupo na instância. Os participantes são telefones completos com DDI ou JIDs válidos.
 * @param {string} instanceId - Identificador da instância
 * @param {string} subject - Nome do grupo, com no máximo 25 caracteres
 * @param {string[]} participants - Participantes iniciais
 */
export async function whatsappCreateGroup(input) {
  const { instanceId, subject, participants } = normalizeInput(input);
  if (!subject?.trim() || subject.trim().length > 25) throw Object.assign(new Error('O nome do grupo deve ter entre 1 e 25 caracteres.'), { status: 400 });
  if (!Array.isArray(participants) || participants.length < 1) throw Object.assign(new Error('Informe ao menos um participante.'), { status: 400 });
  return groups.createGroup(instanceId, subject.trim(), participants);
}

/**
 * @register_tool whatsapp_update_group
 * @reach manual
 * @description Atualiza nome e/ou descrição de um grupo. Inicialmente disponível para Whatsmeow.
 * @param {string} instanceId - Identificador da instância
 * @param {string} groupJid - Identificador do grupo terminado em @g.us
 * @param {string?} subject - Novo nome, com no máximo 25 caracteres
 * @param {string?} description - Nova descrição; string vazia remove a descrição
 */
export async function whatsappUpdateGroup(input) {
  const { instanceId, groupJid, subject, description } = normalizeInput(input);
  if (subject === undefined && description === undefined) throw Object.assign(new Error('Informe subject e/ou description.'), { status: 400 });
  if (subject !== undefined && (!String(subject).trim() || String(subject).trim().length > 25)) throw Object.assign(new Error('O nome do grupo deve ter entre 1 e 25 caracteres.'), { status: 400 });
  return groups.updateGroup(instanceId, groupJid, { ...(subject === undefined ? {} : { subject: String(subject).trim() }), ...(description === undefined ? {} : { description: String(description) }) });
}

/**
 * @register_tool whatsapp_update_group_participants
 * @reach manual
 * @description Adiciona, remove, promove ou rebaixa participantes de um grupo.
 * @param {string} instanceId - Identificador da instância
 * @param {string} groupJid - Identificador do grupo terminado em @g.us
 * @param {string} action - Ação: add, remove, promote ou demote
 * @param {string[]} participants - Telefones completos com DDI ou JIDs válidos
 */
export async function whatsappUpdateGroupParticipants(input) {
  const { instanceId, groupJid, action, participants } = normalizeInput(input);
  if (!['add', 'remove', 'promote', 'demote'].includes(action)) throw Object.assign(new Error('Ação inválida. Use add, remove, promote ou demote.'), { status: 400 });
  if (!Array.isArray(participants) || participants.length < 1) throw Object.assign(new Error('Informe ao menos um participante.'), { status: 400 });
  return groups.updateGroupParticipants(instanceId, groupJid, action, participants);
}

/**
 * @register_tool whatsapp_get_group_invite_link
 * @reach manual
 * @description Obtém o link de convite do grupo. reset=true revoga o link anterior e cria outro.
 * @param {string} instanceId - Identificador da instância
 * @param {string} groupJid - Identificador do grupo terminado em @g.us
 * @param {boolean?} reset - Revoga o link anterior antes de obter um novo
 */
export async function whatsappGetGroupInviteLink(input) {
  const { instanceId, groupJid, reset = false } = normalizeInput(input);
  return groups.getGroupInviteLink(instanceId, groupJid, reset === true);
}

/**
 * @register_tool whatsapp_leave_group
 * @reach manual
 * @description Faz a instância sair do grupo. Esta operação altera a associação da conta ao grupo.
 * @param {string} instanceId - Identificador da instância
 * @param {string} groupJid - Identificador do grupo terminado em @g.us
 */
export async function whatsappLeaveGroup(input) {
  const { instanceId, groupJid } = normalizeInput(input);
  return groups.leaveGroup(instanceId, groupJid);
}

/**
 * @register_tool whatsapp_send_group_message
 * @reach manual
 * @description Envia texto a um grupo pela instância. Inicialmente disponível para Whatsmeow.
 * @param {string} instanceId - Identificador da instância
 * @param {string} groupJid - Identificador do grupo terminado em @g.us
 * @param {string} text - Texto da mensagem
 */
export async function whatsappSendGroupMessage(input) {
  const { instanceId, groupJid, text } = normalizeInput(input);
  if (!String(text || '').trim()) throw Object.assign(new Error('O texto é obrigatório.'), { status: 400 });
  return groups.sendGroupText(instanceId, groupJid, String(text));
}

/**
 * @register_tool whatsapp_retry_message
 * @reach manual
 * @description Tenta reenviar uma mensagem de saída que falhou.
 * @param {string} conversationId - Identificador da conversa
 * @param {string} messageId - Identificador da mensagem com falha
 */
export async function whatsappRetryMessage(input) {
  const { conversationId, messageId } = normalizeInput(input);
  return toolResult(await retryMessage({ params: { id: conversationId, messageId } }));
}

/**
 * @register_tool whatsapp_list_meta_templates
 * @reach manual
 * @description Lista os templates oficiais disponíveis para uma instância Meta Cloud API.
 * @param {string} instanceId - Identificador da instância Meta Cloud API
 */
export async function whatsappListMetaTemplates(input) {
  const { instanceId } = normalizeInput(input);
  return toolResult(await listMetaTemplates({ query: { instanceId } }));
}

/**
 * @register_tool whatsapp_send_meta_template
 * @reach manual
 * @description Envia um template aprovado da Meta Cloud API para uma conversa existente.
 * @param {string} conversationId - Identificador da conversa
 * @param {string} templateName - Nome do template aprovado
 * @param {string?} languageCode - Código do idioma, como pt_BR
 */
export async function sendMetaTemplate(input) {
  const { conversationId, templateName, languageCode = 'pt_BR', components } = normalizeInput(input);
  const conversation = db.conversation[conversationId];
  if (!conversation) throw new Error('Conversa não encontrada');
  return toolResult(await sendTemplate({
    params: { id: conversationId },
    body: { name: templateName, languageCode, components },
  }));
}

/**
 * @register_tool whatsapp_start_meta_template
 * @reach manual
 * @description Inicia uma conversa com um contato pela Meta Cloud API usando um template aprovado. Use para o primeiro contato ou fora da janela de atendimento; exige opt-in do destinatário.
 * @param {string} instanceId - Identificador da instância Meta Cloud API
 * @param {string} number - Telefone com DDI, somente dígitos
 * @param {string} templateName - Nome do template aprovado
 * @param {string?} languageCode - Código do idioma, como pt_BR
 * @param {object?} components - Componentes e parâmetros do template aprovados pela Meta
 * @param {string?} name - Nome opcional do contato
 */
export async function startMetaTemplate(input) {
  const { instanceId, number, templateName, languageCode = 'pt_BR', components, name } = normalizeInput(input);
  return toolResult(await openConversationWithTemplate({
    body: { instanceId, number, name, templateName, languageCode, components },
  }));
}
