import { normalizeWhatsAppNumber } from './conversationHelpers.js';

export function consultationTarget(number) {
  return normalizeWhatsAppNumber(number);
}

export function isPendingConsultationForConversation(consultation, conversationId) {
  return consultation?.status === 'pending' && consultation.helperConversationId === conversationId;
}

export function knowledgeTerms(text) {
  return [...new Set(String(text || '').toLocaleLowerCase('pt-BR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]{3,}/g) || [])];
}

export function rankKnowledge(query, entries = [], limit = 3) {
  const terms = knowledgeTerms(query);
  if (!terms.length) return [];
  return entries.map((entry) => {
    const haystack = `${entry.question || ''} ${entry.answer || ''}`.toLocaleLowerCase('pt-BR')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return { entry, score: terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0) };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(Number(limit) || 3, 5)))
    .map(({ entry }) => entry);
}
