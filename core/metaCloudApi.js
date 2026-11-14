const GRAPH_BASE = 'https://graph.facebook.com';

function redact(value, token) {
  return String(value || '').replaceAll(String(token || ''), '[REDACTED]');
}

export class MetaCloudError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'MetaCloudError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class MetaCloudClient {
  constructor({ accessToken, phoneNumberId, apiVersion = 'v25.0', fetchImpl = globalThis.fetch }) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.apiVersion = apiVersion;
    this.fetch = fetchImpl;
  }

  async request(path, init = {}) {
    const response = await this.fetch(`${GRAPH_BASE}/${this.apiVersion}/${path.replace(/^\//, '')}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, ...(init.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      const error = payload.error || {};
      throw new MetaCloudError(redact(error.message || `Meta retornou HTTP ${response.status}`, this.accessToken), {
        status: response.status,
        code: error.code,
        details: error.error_data?.details ? redact(error.error_data.details, this.accessToken) : undefined,
      });
    }
    return payload;
  }

  async send(payload) {
    const result = await this.request(`${this.phoneNumberId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    return { providerMessageId: result.messages?.[0]?.id || null };
  }

  sendText(to, body) { return this.send({ to, type: 'text', text: { body } }); }
  sendTemplate(to, name, languageCode = 'en_US', components) {
    return this.send({ to, type: 'template', template: { name, language: { code: languageCode }, ...(components?.length ? { components } : {}) } });
  }

  async listMessageTemplates(whatsappBusinessAccountId) {
    if (!whatsappBusinessAccountId) throw new MetaCloudError('A instância Meta não possui WhatsApp Business Account ID configurado.');
    const templates = [];
    let path = `${whatsappBusinessAccountId}/message_templates?fields=id,name,status,language,category,components&limit=100`;
    while (path) {
      const result = await this.request(path);
      templates.push(...(result.data || []));
      const next = result.paging?.next;
      path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '') : null;
    }
    return templates;
  }

  async createMessageTemplate(whatsappBusinessAccountId, template) {
    if (!whatsappBusinessAccountId) throw new MetaCloudError('A instância Meta não possui WhatsApp Business Account ID configurado.');
    return this.request(`${whatsappBusinessAccountId}/message_templates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template),
    });
  }

  async updateMessageTemplate(templateId, template) {
    if (!templateId) throw new MetaCloudError('O ID remoto do template é obrigatório para editar.');
    return this.request(templateId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template),
    });
  }

  async deleteMessageTemplate(whatsappBusinessAccountId, { id, name } = {}) {
    if (!whatsappBusinessAccountId || !id || !name) throw new MetaCloudError('A WABA, o ID remoto e o nome do template são obrigatórios para excluir.');
    const query = new URLSearchParams({ hsm_id: id, name });
    return this.request(`${whatsappBusinessAccountId}/message_templates?${query}`, { method: 'DELETE' });
  }

  async downloadMedia(mediaId) {
    const metadata = await this.request(mediaId);
    const response = await this.fetch(metadata.url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (!response.ok) throw new MetaCloudError(`Falha ao baixar mídia da Meta: HTTP ${response.status}`, { status: response.status });
    return { buffer: Buffer.from(await response.arrayBuffer()), mimetype: metadata.mime_type, filename: metadata.id };
  }
}
