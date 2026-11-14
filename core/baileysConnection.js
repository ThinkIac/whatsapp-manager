/** Utilitários puros do ciclo de conexão Baileys. */

// Mantido apenas para a indisponibilidade temporária da consulta de versão.
// Atualize por fetchLatestBaileysVersion sempre que possível.
export const FALLBACK_WA_VERSION = [2, 3000, 1032141294];

export async function resolveWAVersion(fetchLatestVersion, onFallback = () => {}) {
  try {
    const result = await fetchLatestVersion();
    if (!Array.isArray(result?.version) || result.version.length !== 3) {
      throw new Error('Baileys retornou uma versão WA inválida');
    }
    return result.version;
  } catch (error) {
    onFallback(error);
    return FALLBACK_WA_VERSION;
  }
}

// Uma sessão criada pelo Baileys sempre tem creds.json. Se ela já existia e
// não está registrada, há chaves parciais de um pareamento abandonado: elas
// impedem que o WhatsApp inicie um QR limpo.
export function hasIncompletePersistedAuth(state, hadPersistedAuth) {
  return Boolean(hadPersistedAuth && !state?.creds?.registered);
}

export function shouldStopWaitingForQr(info) {
  return ['open', 'closed', 'disconnected', 'error', 'failed'].includes(info?.status);
}

// Eventos do Baileys podem chegar depois que uma tentativa de QR foi trocada.
// Só o socket ainda registrado pode alterar o estado compartilhado da instância.
export function isCurrentSocket(sockets, name, sock) {
  return sockets.get(name)?.sock === sock;
}
