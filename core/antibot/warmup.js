/**
 * core/antibot/warmup.js
 * Curva de aquecimento: instâncias novas mandam menos mensagens/dia,
 * subindo gradualmente. Reinicia se ficar 72h+ sem enviar nada.
 */

const WARMUP_TABLE = [
  { day: 1, limit: 150 },
  { day: 2, limit: 36 },
  { day: 3, limit: 65 },
  { day: 4, limit: 117 },
  { day: 5, limit: 210 },
  { day: 6, limit: 378 },
  { day: 7, limit: 680 },
];
const INACTIVITY_RESET_HOURS = 72;

export class WarmUp {
  constructor(state) {
    this.startedAt = state?.startedAt ? new Date(state.startedAt) : new Date();
    this.sentLog = Array.isArray(state?.sentLog) ? state.sentLog : [];
    this.lastActivityAt = state?.lastActivityAt ? new Date(state.lastActivityAt) : new Date();
  }

  _sync(now) {
    const hoursSinceActivity = (now - this.lastActivityAt.getTime()) / 3_600_000;
    if (hoursSinceActivity > INACTIVITY_RESET_HOURS) {
      this.startedAt = new Date(now);
      this.sentLog = [];
    }
    const dayAgo = now - 86_400_000;
    this.sentLog = this.sentLog.filter((t) => t > dayAgo);
  }

  getDailyLimit(now = Date.now()) {
    this._sync(now);
    const days = Math.floor((now - this.startedAt.getTime()) / 86_400_000) + 1;
    if (days > WARMUP_TABLE.length) return Infinity;
    return WARMUP_TABLE[Math.min(days, WARMUP_TABLE.length) - 1].limit;
  }

  getTodaySentCount(now = Date.now()) {
    this._sync(now);
    return this.sentLog.length;
  }

  canSend(now = Date.now()) {
    this._sync(now);
    return this.sentLog.length < this.getDailyLimit(now);
  }

  record(now = Date.now()) {
    this._sync(now);
    this.sentLog.push(now);
    this.lastActivityAt = new Date(now);
  }

  getStatus(now = Date.now()) {
    this._sync(now);
    const days = Math.floor((now - this.startedAt.getTime()) / 86_400_000) + 1;
    return {
      day: days,
      todayLimit: this.getDailyLimit(now),
      todaySent: this.sentLog.length,
      warmedUp: days > WARMUP_TABLE.length,
    };
  }

  exportState() {
    return {
      startedAt: this.startedAt.toISOString(),
      sentLog: this.sentLog,
      lastActivityAt: this.lastActivityAt.toISOString(),
    };
  }
}
