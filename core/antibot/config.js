export const DEFAULT_ANTIBOT_CONFIG = Object.freeze({
  enabled: true,
  warmupEnabled: true,
  blockOnCriticalRisk: true,
  maxPerMinute: 15,
  maxPerHour: 250,
  minDelayMs: 1500,
  maxDelayMs: 5000,
  newChatDelayMs: 3000,
  burstAllowance: 3,
});

const LIMITS = {
  maxPerMinute: [1, 120],
  maxPerHour: [1, 5000],
  minDelayMs: [0, 60000],
  maxDelayMs: [0, 120000],
  newChatDelayMs: [0, 120000],
  burstAllowance: [0, 50],
};

function clampNumber(value, fallback, [min, max]) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeAntibotConfig(value = {}) {
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) source = {};

  const config = {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_ANTIBOT_CONFIG.enabled,
    warmupEnabled: typeof source.warmupEnabled === 'boolean' ? source.warmupEnabled : DEFAULT_ANTIBOT_CONFIG.warmupEnabled,
    blockOnCriticalRisk: typeof source.blockOnCriticalRisk === 'boolean'
      ? source.blockOnCriticalRisk
      : DEFAULT_ANTIBOT_CONFIG.blockOnCriticalRisk,
  };

  for (const [key, range] of Object.entries(LIMITS)) {
    config[key] = clampNumber(source[key], DEFAULT_ANTIBOT_CONFIG[key], range);
  }
  if (config.maxDelayMs < config.minDelayMs) config.maxDelayMs = config.minDelayMs;
  return config;
}

export function readInstanceAntibotConfig(instance) {
  return normalizeAntibotConfig(instance?.antibotConfig);
}

export function serializeAntibotConfig(value) {
  return JSON.stringify(normalizeAntibotConfig(value));
}
