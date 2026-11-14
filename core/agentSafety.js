const OPT_OUT = /\b(?:par[ae]m|pare|parar|não quero mais|nao quero mais|não me (?:mande|envie)|nao me (?:mande|envie)|remov[ae]-?me|sair|cancelar inscri(?:ç|c)[ãa]o|opt[ -]?out)\b/i;
const POLICY_RESTRICTION = /\b(?:policy|pol[ií]tica|violation|viola[çc][ãa]o|restricted|restri[çc][ãa]o|quality|qualidade|spam|account disabled|conta desativada)\b/i;
const META_POLICY_CODES = new Set(['131047', '131031', '131042']);

function clean(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function detectOptOut(text) {
  return typeof text === 'string' && OPT_OUT.test(text);
}

export function normalizeAgentIdentity(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = {}; }
  }
  return { businessName: clean(parsed?.businessName), humanChannel: clean(parsed?.humanChannel) };
}

export function agentReplyBlock(conversation = {}) {
  if (conversation.agentOptedOutAt) return 'O contato pediu para não receber respostas automáticas.';
  if (conversation.agentPaused) {
    return conversation.agentPauseReason === 'human_handoff'
      ? 'Atendimento humano assumiu esta conversa.'
      : 'As respostas automáticas estão pausadas nesta conversa.';
  }
  return null;
}

export function isMetaPolicyRestriction(message = {}) {
  return META_POLICY_CODES.has(String(message.providerErrorCode || '')) || POLICY_RESTRICTION.test(String(message.error || ''));
}
