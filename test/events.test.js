import test from 'node:test';
import assert from 'node:assert/strict';
import { WHATSAPP_EVENTS } from '../core/events.js';

test('catálogo público não contém eventos do subsistema próprio de agentes', () => {
  assert.equal(WHATSAPP_EVENTS.length, 11);
  assert.equal(WHATSAPP_EVENTS.some((event) => event.name === 'whatsapp:message:delivered'), true);
  assert.equal(WHATSAPP_EVENTS.some((event) => event.name === 'whatsapp:message:read'), true);
  assert.equal(WHATSAPP_EVENTS.some((event) => event.name.includes('agent')), false);
  assert.equal(new Set(WHATSAPP_EVENTS.map((event) => event.name)).size, WHATSAPP_EVENTS.length);
});
