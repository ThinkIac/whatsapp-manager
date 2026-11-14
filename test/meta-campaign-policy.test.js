import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedTemplate, metaUsageSince, checkMetaCampaignAllowance } from '../core/metaSendControls.js';

test('considera apenas envios Meta recentes no consumo preventivo', () => {
  const now = new Date('2026-09-02T12:00:00Z');
  const usage = metaUsageSince([
    { instanceId: 'meta', direction: 'out', status: 'sent', timestamp: new Date('2026-09-02T11:30:00Z') },
    { instanceId: 'meta', direction: 'out', status: 'failed', timestamp: new Date('2026-09-02T11:50:00Z') },
    { instanceId: 'meta', direction: 'out', status: 'sent', timestamp: new Date('2026-09-01T11:00:00Z') },
    { instanceId: 'other', direction: 'out', status: 'sent', timestamp: new Date('2026-09-02T11:30:00Z') },
  ], 'meta', now);
  assert.deepEqual(usage, { hourSent: 1, daySent: 1 });
  assert.equal(checkMetaCampaignAllowance({ maxPerHour: 1, maxPerDay: 3 }, { ...usage, recipientCount: 1 }).allowed, false);
});

test('só permite template Meta com aprovação e idioma', () => {
  assert.equal(approvedTemplate({ name: 'aviso', status: 'APPROVED', language: 'pt_BR' }), 'pt_BR');
  assert.equal(approvedTemplate({ name: 'aviso', status: 'PENDING', language: 'pt_BR' }), false);
  assert.equal(approvedTemplate({ name: 'aviso', status: 'APPROVED' }), undefined);
});
