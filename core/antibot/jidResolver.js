/**
 * core/antibot/jidResolver.js
 * Resolve o par LID <-> número de telefone.
 */

export class LidResolver {
  constructor({ maxEntries = 5000 } = {}) {
    this.lidToPn = new Map();
    this.pnToLid = new Map();
    this.maxEntries = maxEntries;
  }

  learn(lid, pn) {
    if (!lid || !pn) return;
    this.lidToPn.set(lid, pn);
    this.pnToLid.set(pn, lid);
    if (this.lidToPn.size > this.maxEntries) {
      const oldest = this.lidToPn.keys().next().value;
      const oldPn = this.lidToPn.get(oldest);
      this.lidToPn.delete(oldest);
      if (oldPn) this.pnToLid.delete(oldPn);
    }
  }

  learnFromMessage(msg) {
    const key = msg?.key;
    if (!key) return;
    const candidates = [
      [key.remoteJidAlt, key.remoteJid],
      [key.remoteJid, key.remoteJidAlt],
      [key.participantAlt, key.participant],
      [key.participant, key.participantAlt],
    ];
    for (const [lid, pn] of candidates) {
      if (lid?.endsWith('@lid') && pn?.endsWith('@s.whatsapp.net')) this.learn(lid, pn);
    }
  }

  resolveCanonical(jid) {
    if (!jid) return jid;
    if (jid.endsWith('@lid') && this.lidToPn.has(jid)) return this.lidToPn.get(jid);
    return jid;
  }

  resolveForSend(jid) {
    if (!jid) return jid;
    if (jid.endsWith('@s.whatsapp.net') && this.pnToLid.has(jid)) return this.pnToLid.get(jid);
    return jid;
  }

  exportState() {
    return { lidToPn: [...this.lidToPn.entries()] };
  }

  loadState(state) {
    if (!state?.lidToPn) return;
    for (const [lid, pn] of state.lidToPn) this.learn(lid, pn);
  }
}
