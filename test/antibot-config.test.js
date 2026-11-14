import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ANTIBOT_CONFIG, normalizeAntibotConfig, serializeAntibotConfig } from '../core/antibot/config.js';

test('normaliza uma configuração anti-ban por instância sem compartilhar estado', () => {
  const first = normalizeAntibotConfig({ maxPerMinute: 8, warmupEnabled: false });
  const second = normalizeAntibotConfig();

  assert.equal(first.maxPerMinute, 8);
  assert.equal(first.warmupEnabled, false);
  assert.deepEqual(second, DEFAULT_ANTIBOT_CONFIG);
});

test('limita valores inválidos e garante delay máximo maior ou igual ao mínimo', () => {
  const config = normalizeAntibotConfig({ maxPerMinute: 0, maxPerHour: 'x', minDelayMs: 9000, maxDelayMs: 100 });
  assert.equal(config.maxPerMinute, 1);
  assert.equal(config.maxPerHour, 250);
  assert.equal(config.maxDelayMs, 9000);
  assert.deepEqual(JSON.parse(serializeAntibotConfig(config)), config);
});
