function cleanBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) throw new Error('Informe uma URL HTTP(S) válida para a Evolution API.');
  return url;
}

function parseResponse(response, body) {
  if (response.ok) return body;
  const message = body?.response?.message || body?.message || body?.error || `Evolution API respondeu HTTP ${response.status}`;
  const error = new Error(typeof message === 'string' ? message : JSON.stringify(message));
  error.code = body?.response?.statusCode || response.status;
  throw error;
}

export class EvolutionApiClient {
  constructor({ baseUrl, apiKey, fetchImpl = fetch }) {
    this.baseUrl = cleanBaseUrl(baseUrl);
    if (!String(apiKey || '').trim()) throw new Error('A API key da Evolution é obrigatória.');
    this.apiKey = String(apiKey).trim();
    this.fetch = fetchImpl;
  }

  async request(path, { method = 'GET', body } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { apikey: this.apiKey, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { message: text }; }
    return parseResponse(response, parsed);
  }

  createInstance(name) {
    return this.request('/instance/create', { method: 'POST', body: { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true } });
  }

  connect(name) { return this.request(`/instance/connect/${encodeURIComponent(name)}`); }
  connectionState(name) { return this.request(`/instance/connectionState/${encodeURIComponent(name)}`); }
  logout(name) { return this.request(`/instance/logout/${encodeURIComponent(name)}`, { method: 'DELETE' }); }
  deleteInstance(name) { return this.request(`/instance/delete/${encodeURIComponent(name)}`, { method: 'DELETE' }); }

  setWebhook(name, url) {
    return this.request(`/webhook/set/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: { webhook: { enabled: true, url, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'] } },
    });
  }

  async sendText(name, number, text) {
    const result = await this.request(`/message/sendText/${encodeURIComponent(name)}`, {
      method: 'POST', body: { number: String(number).replace(/\D/g, ''), text },
    });
    return { providerMessageId: result?.key?.id || result?.message?.key?.id || result?.messageId || null };
  }
}

export function evolutionConnectionInfo(state = {}, connect = {}) {
  const instance = state?.instance || state;
  const status = String(instance?.state || instance?.status || connect?.instance?.state || 'connecting').toLowerCase();
  const qrcode = connect?.base64 || connect?.qrcode?.base64 || connect?.qrcode || instance?.qrcode?.base64 || null;
  return {
    status: ['open', 'connected'].includes(status) ? 'open' : ['close', 'closed', 'disconnected'].includes(status) ? 'disconnected' : 'connecting',
    qrcode: typeof qrcode === 'string' && qrcode.startsWith('data:image') ? qrcode : qrcode ? `data:image/png;base64,${qrcode}` : null,
  };
}
