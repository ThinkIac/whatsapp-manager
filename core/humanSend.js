/**
 * core/humanSend.js
 * Digitação humanizada via nosso próprio PresenceChoreographer.
 */

import { PresenceChoreographer } from './antibot/presence.js';

const choreo = new PresenceChoreographer({
  typingWPM: 42,
  typingWPMStdDev: 14,
  thinkPauseProbability: 0.08,
  thinkPauseMinMs: 1000,
  thinkPauseMaxMs: 3500,
  circadianProfile: 'default',
  timezone: process.env.WA_TIMEZONE || 'America/Sao_Paulo',
});

export async function humanSendText(sock, jid, text, authorize) {
  if (!text) return undefined;
  const plan = choreo.computeTypingPlan(text.length);
  await choreo.executeTypingPlan(sock, jid, plan);
  await authorize?.();
  return sock.sendMessage(jid, { text });
}

export function interMessageDelay() {
  const minMs = 1200; // O seu novo "piso" mínimo
  const variacao = 1000; 
  const ms = minMs + Math.random() * variacao;
  return new Promise((resolve) => setTimeout(resolve, ms));
}