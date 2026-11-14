/**
 * core/antibot/health.js
 * Pontuação de risco de ban: sobe com desconexões/falhas/timelocks,
 * decai sozinha com o tempo se nada de ruim acontecer.
 */

const RISK_WEIGHTS = {
  disconnect: 20,
  loggedOut: 60,
  timelock: 25,
  messageFailed: 15,
};
const DECAY_PER_HOUR = 10;

export class HealthMonitor {
  constructor(state) {
    this.score = state?.score || 0;
    this.lastUpdateAt = state?.lastUpdateAt ? new Date(state.lastUpdateAt) : new Date();
    this.reasons = state?.reasons || [];
  }

  _decay(now) {
    const hours = (now - this.lastUpdateAt.getTime()) / 3_600_000;
    if (hours > 0) {
      this.score = Math.max(0, this.score - hours * DECAY_PER_HOUR);
      this.lastUpdateAt = new Date(now);
    }
  }

  _bump(amount, reason, now = Date.now()) {
    this._decay(now);
    this.score = Math.min(100, this.score + amount);
    this.reasons = [...this.reasons.slice(-9), { reason, at: now }];
    this.lastUpdateAt = new Date(now);
  }

  recordDisconnect(statusCode, now = Date.now()) {
    const weight = statusCode === 401 || statusCode === 440 ? RISK_WEIGHTS.loggedOut : RISK_WEIGHTS.disconnect;
    this._bump(weight, `disconnect:${statusCode}`, now);
  }

  recordReconnect(now = Date.now()) {
    this._decay(now);
  }

  recordMessageFailed(error, now = Date.now()) {
    this._bump(RISK_WEIGHTS.messageFailed, `send-failed:${error || ''}`, now);
  }

  recordReachoutTimelock(now = Date.now()) {
    this._bump(RISK_WEIGHTS.timelock, 'timelock-463', now);
  }

  getStatus(now = Date.now()) {
    this._decay(now);
    let risk = 'low';
    if (this.score >= 85) risk = 'critical';
    else if (this.score >= 60) risk = 'high';
    else if (this.score >= 30) risk = 'medium';

    const recommendation = {
      low: 'Operando normalmente.',
      medium: 'Reduza o ritmo de envio em ~50%.',
      high: 'Reduza drasticamente (~80%) ou considere pausar.',
      critical: 'Envio pausado automaticamente até o risco cair.',
    }[risk];

    return { risk, score: Math.round(this.score), recommendation };
  }

  exportState() {
    return { score: this.score, lastUpdateAt: this.lastUpdateAt.toISOString(), reasons: this.reasons };
  }
}
