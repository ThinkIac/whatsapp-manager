const DEFAULT_BASE_URL = 'http://127.0.0.1:8765';

// A API do whatsmeow trabalha com JIDs. Campanhas, por sua vez, armazenam o
// telefone em formato E.164 sem o sufixo do WhatsApp. Normalizar aqui mantém o
// contrato do bridge igual ao do Baileys e impede que o número seja usado como
// se fosse o servidor do JID ("unknown server 5511...").
export function whatsmeowRecipient(value) {
  const raw = String(value || '').trim();
  // Um LID é uma identidade válida e necessária para algumas contas recentes.
  // Não o reduza ao número: o whatsmeow não consegue sempre recuperar o LID a
  // partir do PN e então rejeita o envio com "no LID found ... from server".
  if (/^\d+@lid$/i.test(raw)) return raw;

  // A campanha trabalha com telefones. Nunca encaminhe um JID arbitrário ao
  // sidecar: um valor como "5511@575" seria interpretado pelo whatsmeow como
  // um servidor e terminaria em "can't send message to unknown server 575".
  // Para JIDs que não são LID, extraímos somente o telefone e emitimos o
  // servidor de usuário canônico do WhatsApp.
  const local = raw.includes('@') ? raw.slice(0, raw.indexOf('@')) : raw;
  const number = local.replace(/\D/g, '');
  if (number.length < 8 || number.length > 15) {
    throw new Error('Informe um número de WhatsApp válido, com DDI.');
  }
  return `${number}@s.whatsapp.net`;
}

export function whatsmeowGroupJid(value) {
  const jid = String(value || '').trim();
  if (!/^\d+(?:-\d+)?@g\.us$/i.test(jid)) throw new Error('Informe um JID de grupo válido (@g.us).');
  return jid;
}

export class WhatsmeowApiClient {
  constructor({ baseUrl = process.env.WHATSMEOW_SERVICE_URL || DEFAULT_BASE_URL, token = process.env.WHATSMEOW_SERVICE_TOKEN } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.token = token;
  }

  async request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(`Serviço whatsmeow indisponível em ${this.baseUrl}: ${error.message}`);
    }
    const parsed = await response.json().catch(() => ({}));
    const payload = parsed && typeof parsed === 'object' ? parsed : {};
    if (!response.ok) throw new Error(payload?.message || payload?.error || `Serviço whatsmeow respondeu HTTP ${response.status}`);
    return payload;
  }

  createInstance(name) { return this.request('/instances', { method: 'POST', body: { name } }); }
  getQr(name) { return this.request(`/instances/${encodeURIComponent(name)}/qr`); }
  disconnect(name) { return this.request(`/instances/${encodeURIComponent(name)}/disconnect`, { method: 'POST' }); }
  deleteInstance(name) { return this.request(`/instances/${encodeURIComponent(name)}`, { method: 'DELETE' }); }
  sendText(name, recipient, text, { humanize = false } = {}) { return this.request(`/instances/${encodeURIComponent(name)}/messages/text`, { method: 'POST', body: { recipient: whatsmeowRecipient(recipient), text, humanize: humanize === true } }); }
  sendMedia(name, recipient, media) { return this.request(`/instances/${encodeURIComponent(name)}/messages/media`, { method: 'POST', body: { recipient: whatsmeowRecipient(recipient), ...media } }); }
  listGroups(name) { return this.request(`/instances/${encodeURIComponent(name)}/groups`); }
  getGroup(name, groupJid) { return this.request(`/instances/${encodeURIComponent(name)}/groups/${encodeURIComponent(whatsmeowGroupJid(groupJid))}`); }
  createGroup(name, subject, participants) { return this.request(`/instances/${encodeURIComponent(name)}/groups`, { method: 'POST', body: { subject, participants: participants.map(whatsmeowRecipient) } }); }
  updateGroup(name, groupJid, changes) { return this.request(`/instances/${encodeURIComponent(name)}/groups/${encodeURIComponent(whatsmeowGroupJid(groupJid))}`, { method: 'PATCH', body: changes }); }
  updateGroupParticipants(name, groupJid, action, participants) { return this.request(`/instances/${encodeURIComponent(name)}/groups/${encodeURIComponent(whatsmeowGroupJid(groupJid))}/participants`, { method: 'POST', body: { action, participants: participants.map(whatsmeowRecipient) } }); }
  getGroupInviteLink(name, groupJid, reset = false) { return this.request(`/instances/${encodeURIComponent(name)}/groups/${encodeURIComponent(whatsmeowGroupJid(groupJid))}/invite`, reset ? { method: 'POST', body: { reset: true } } : undefined); }
  leaveGroup(name, groupJid) { return this.request(`/instances/${encodeURIComponent(name)}/groups/${encodeURIComponent(whatsmeowGroupJid(groupJid))}/leave`, { method: 'POST' }); }
  sendGroupText(name, groupJid, text) { return this.request(`/instances/${encodeURIComponent(name)}/messages/text`, { method: 'POST', body: { recipient: whatsmeowGroupJid(groupJid), text } }); }
}

export function whatsmeowClient() { return new WhatsmeowApiClient(); }
