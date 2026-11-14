/**
 * core/antibot/disconnect.js
 * Classifica o motivo de uma desconexão do Baileys pra decidir se
 * reconecta e com que backoff.
 */

const TABLE = {
  401: { category: 'fatal', message: 'Sessão desconectada (logged out)', shouldReconnect: false },
  408: { category: 'recoverable', message: 'Timeout de conexão', shouldReconnect: true, backoffMs: 2000 },
  428: { category: 'recoverable', message: 'Conexão substituída por outro dispositivo', shouldReconnect: true, backoffMs: 5000 },
  429: { category: 'rate-limited', message: 'Rate limited pelo WhatsApp', shouldReconnect: true, backoffMs: 30000 },
  440: { category: 'fatal', message: 'Sessão encerrada (logged out em outro lugar)', shouldReconnect: false },
  500: { category: 'recoverable', message: 'Erro interno do WhatsApp', shouldReconnect: true, backoffMs: 5000 },
  503: { category: 'recoverable', message: 'Serviço indisponível', shouldReconnect: true, backoffMs: 5000 },
  515: { category: 'recoverable', message: 'Restart requerido pelo Baileys', shouldReconnect: true, backoffMs: 1000 },
  1000: { category: 'recoverable', message: 'Fechamento normal', shouldReconnect: true, backoffMs: 3000 },
};

export function classifyDisconnect(statusCode) {
  return (
    TABLE[statusCode] || {
      category: 'unknown',
      message: `Código de desconexão desconhecido: ${statusCode}`,
      shouldReconnect: true,
      backoffMs: 5000,
    }
  );
}
