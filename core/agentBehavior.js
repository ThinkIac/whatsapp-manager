const MAX_DELAY_SECONDS = 600;

function seconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.trunc(parsed)));
}

export function normalizeAgentBehavior(value) {
  let input = value;
  if (typeof value === 'string') {
    try { input = JSON.parse(value); } catch { input = {}; }
  }
  input = input && typeof input === 'object' ? input : {};
  return {
    accumulationSeconds: seconds(input.accumulationSeconds),
    responseDelaySeconds: seconds(input.responseDelaySeconds),
  };
}

export function responseWaitMs(value) {
  const behavior = normalizeAgentBehavior(value);
  return (behavior.accumulationSeconds + behavior.responseDelaySeconds) * 1000;
}
