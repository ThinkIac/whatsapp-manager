/**
 * core/antibot/presence.js
 * Digitação humanizada: modelo de WPM, pausas de "pensar", e
 * multiplicador circadiano.
 */

function gaussianRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * stdDev;
}

const CIRCADIAN_PROFILES = {
  default: { awakeStart: 9, awakeEnd: 22, deadStart: 2, deadEnd: 6 },
  nightOwl: { awakeStart: 12, awakeEnd: 1, deadStart: 4, deadEnd: 9 },
  earlyBird: { awakeStart: 6, awakeEnd: 20, deadStart: 23, deadEnd: 4 },
  always_on: null,
};

function hourInRange(hour, start, end) {
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function getCircadianMultiplier(date, profile = 'default', timezone) {
  if (profile === 'always_on') return 1;
  const cfg = CIRCADIAN_PROFILES[profile] || CIRCADIAN_PROFILES.default;
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(date));
  } catch {
    hour = date.getHours();
  }
  if (hourInRange(hour, cfg.deadStart, cfg.deadEnd)) return 4.5;
  if (!hourInRange(hour, cfg.awakeStart, cfg.awakeEnd)) return 1.8;
  return 1;
}

export class PresenceChoreographer {
  constructor({
    typingWPM = 42,
    typingWPMStdDev = 14,
    thinkPauseProbability = 0.08,
    thinkPauseMinMs = 800,
    thinkPauseMaxMs = 3500,
    circadianProfile = 'default',
    timezone = 'America/Sao_Paulo',
  } = {}) {
    this.typingWPM = typingWPM;
    this.typingWPMStdDev = typingWPMStdDev;
    this.thinkPauseProbability = thinkPauseProbability;
    this.thinkPauseMinMs = thinkPauseMinMs;
    this.thinkPauseMaxMs = thinkPauseMaxMs;
    this.circadianProfile = circadianProfile;
    this.timezone = timezone;
  }

  computeTypingPlan(textLength) {
    const wpm = Math.max(15, gaussianRandom(this.typingWPM, this.typingWPMStdDev));
    const charsPerSec = (wpm * 5) / 60;
    const circadianMult = getCircadianMultiplier(new Date(), this.circadianProfile, this.timezone);
    const totalTypingMs = Math.min(12000, (textLength / charsPerSec) * 1000) * circadianMult;

    const steps = [];
    let remaining = totalTypingMs;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 1500 + Math.random() * 1500);
      steps.push({ state: 'composing', durationMs: chunk });
      remaining -= chunk;
      if (remaining > 0 && Math.random() < this.thinkPauseProbability * 3) {
        const pause = (this.thinkPauseMinMs + Math.random() * (this.thinkPauseMaxMs - this.thinkPauseMinMs)) * circadianMult;
        steps.push({ state: 'paused', durationMs: pause });
      }
    }
    if (!steps.length) steps.push({ state: 'composing', durationMs: 800 * circadianMult });
    return steps;
  }

  async executeTypingPlan(sock, jid, plan) {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate('available').catch(() => {});
    for (const step of plan) {
      await sock.sendPresenceUpdate(step.state, jid).catch(() => {});
      await new Promise((r) => setTimeout(r, step.durationMs));
    }
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  }
}
