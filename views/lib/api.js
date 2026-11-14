const BASE = '/whatsapp-manager';

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function readJsonResponse(res) {
  const contentType = res.headers?.get?.('content-type') || '';
  const body = await res.text();
  let payload = null;

  if (contentType.includes('application/json') || /^\s*[{[]/.test(body)) {
    try {
      payload = body ? JSON.parse(body) : {};
    } catch {
      throw new ApiError(`O servidor retornou JSON inválido (HTTP ${res.status}).`, res.status);
    }
  } else {
    throw new ApiError(
      res.status >= 500
        ? `Erro no servidor (HTTP ${res.status}). Não foi possível concluir a operação.`
        : `Resposta inválida do servidor (HTTP ${res.status}); a sessão pode ter expirado.`,
      res.status,
    );
  }

  const status = typeof payload?.status === 'number' && payload.status >= 400 ? payload.status : res.status;
  if (!res.ok || status >= 400) {
    throw new ApiError(payload?.message || payload?.error || `A requisição falhou (HTTP ${status}).`, status, payload);
  }

  return payload;
}

async function request(path, options) {
  let res;
  try {
    res = await fetch(`${BASE}/${path}`, options);
  } catch (error) {
    throw new ApiError(`Não foi possível acessar o WhatsApp Manager: ${error.message}`);
  }
  return readJsonResponse(res);
}

export function apiGet(path, params) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request(`${path}${qs}`);
}

export function apiPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}
