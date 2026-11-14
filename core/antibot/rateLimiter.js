/**
 * core/antibot/rateLimiter.js
 * Limita mensagens/minuto e /hora, com jitter gaussiano e penalidade
 * extra pro primeiro contato com um número novo.
 */

function gaussianRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * stdDev;
}

export class RateLimiter {
  constructor({
    maxPerMinute = 15,
    maxPerHour = 250,
    minDelayMs = 1500,
    maxDelayMs = 5000,
    newChatDelayMs = 3000,
    burstAllowance = 3,
  } = {}) {
    this.maxPerMinute = maxPerMinute;
    this.maxPerHour = maxPerHour;
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.newChatDelayMs = newChatDelayMs;
    this.burstAllowance = burstAllowance;
    this.sendLog = [];
    this.knownChats = new Set();
  }

  loadState(state) {
    if (!state) return;
    this.sendLog = state.sendLog || [];
    this.knownChats = new Set(state.knownChats || []);
  }

  exportState() {
    return { sendLog: this.sendLog.slice(-500), knownChats: [...this.knownChats] };
  }

  _prune(now) {
    const hourAgo = now - 3_600_000;
    this.sendLog = this.sendLog.filter((e) => e.ts > hourAgo);
  }

  getWaitMs(jid, text = '', now = Date.now()) {
    this._prune(now);
    const lastMinuteEntries = this.sendLog.filter((e) => now - e.ts <= 60_000);
    const lastMinute = lastMinuteEntries.length;
    const lastHour = this.sendLog.length;

    let hardWaitMs = 0;
    if (lastMinute >= this.maxPerMinute) {
      hardWaitMs = Math.max(hardWaitMs, 60_000 - (now - lastMinuteEntries[0].ts));
    }
    if (lastHour >= this.maxPerHour) {
      hardWaitMs = Math.max(hardWaitMs, 3_600_000 - (now - this.sendLog[0].ts));
    }

    const isBurst = lastMinute < this.burstAllowance;
    const meanDelay = isBurst ? this.minDelayMs : (this.minDelayMs + this.maxDelayMs) / 2;
    const stdDev = (this.maxDelayMs - this.minDelayMs) / 4;
    let humanJitter = gaussianRandom(meanDelay, stdDev);
    humanJitter = Math.min(this.maxDelayMs, Math.max(this.minDelayMs, humanJitter));
    humanJitter += Math.min(2000, text.length * 5);

    if (!this.knownChats.has(jid)) humanJitter += this.newChatDelayMs;

    return Math.max(hardWaitMs, humanJitter);
  }

  record(jid, now = Date.now()) {
    this.sendLog.push({ jid, ts: now });
    this.knownChats.add(jid);
  }
}
