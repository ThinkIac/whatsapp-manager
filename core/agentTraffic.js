const META_WINDOW_MS = 24 * 60 * 60 * 1000;
import { agentReplyBlock } from './agentSafety.js';

function dateOf(message) {
  const value = new Date(message?.timestamp);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function canRunMetaSpecialist(instance, messages = [], now = new Date(), conversation = {}) {
  if (!['meta_cloud', 'evolution', 'whatsmeow'].includes(instance?.provider)) return { allowed: false, reason: 'A resposta automática não está disponível neste provedor.' };
  if (instance?.agentEnabled !== true) return { allowed: false, reason: 'O opt-in do agente está desligado.' };
  if (!instance?.specialistId) return { allowed: false, reason: 'Nenhum especialista está vinculado à instância.' };
  const replyBlock = agentReplyBlock(conversation);
  if (replyBlock) return { allowed: false, reason: replyBlock };
  const inbound = messages.filter((message) => message.direction === 'in' && message.authorType === 'contact')
    .map(dateOf).filter(Boolean).sort((a, b) => b - a)[0];
  if (!inbound) return { allowed: false, reason: 'Não há mensagem recebida do contato.' };
  if (instance?.provider === 'meta_cloud' && now.getTime() - inbound.getTime() > META_WINDOW_MS) return { allowed: false, reason: 'A janela Meta de 24 horas expirou.' };
  return { allowed: true };
}

export function specialistHistory(messages = []) {
  return [...messages].sort((a, b) => dateOf(a) - dateOf(b)).slice(-12)
    .filter((message) => typeof message.text === 'string' && message.text.trim())
    .map((message) => ({ role: message.direction === 'in' ? 'user' : 'assistant', content: message.text.slice(0, 1200) }));
}
