/**
 * core/antibot/fingerprint.js
 * Fingerprint de browser estável por instância + rampa de presença
 * gradual em vez de "acender" disponível assim que conecta.
 */

export function getStealthSocketConfig(browser) {
  return {
    browser,
    markOnlineOnConnect: false,
  };
}

export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export function rampPresenceAfterConnect(sock, { minDelayMs = 20000, maxDelayMs = 60000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const delay = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
    const timer = setTimeout(async () => {
      if (signal?.aborted) return reject(new AbortError());
      try {
        await sock.sendPresenceUpdate('available');
        resolve();
      } catch (err) {
        reject(err);
      }
    }, delay);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new AbortError());
    });
  });
}
