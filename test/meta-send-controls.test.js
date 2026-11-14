import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetaSendControls, checkMetaCampaignAllowance, templateComponentsFromRecipient } from '../core/metaSendControls.js';

test('normaliza controles Meta e limita destinatários e gasto preventivamente', () => {
  const controls = normalizeMetaSendControls({ maxPerHour: 3, maxPerDay: 5, maxCampaignRecipients: 2, maxCampaignEstimatedSpend: 1.5, estimatedUnitCost: .8 });
  assert.deepEqual(controls, { enabled: true, maxPerHour: 3, maxPerDay: 5, maxCampaignRecipients: 2, maxCampaignEstimatedSpend: 1.5, estimatedUnitCost: .8 });
  assert.match(checkMetaCampaignAllowance(controls, { hourSent: 2, daySent: 2, recipientCount: 2 }).message, /hora/i);
  assert.match(checkMetaCampaignAllowance(controls, { hourSent: 0, daySent: 0, recipientCount: 2 }).message, /estimado/i);
});

test('gera parâmetros de corpo do template conforme a ordem das colunas mapeadas', () => {
  assert.deepEqual(templateComponentsFromRecipient(['nome', 'codigo'], { nome: 'Ana', codigo: '42' }), [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '42' }] }]);
  assert.deepEqual(templateComponentsFromRecipient([], { nome: 'Ana' }), []);
});

test('aceita texto fixo e coluna na mesma campanha Meta', () => {
  assert.deepEqual(templateComponentsFromRecipient([
    { type: 'text', value: 'Olá' },
    { type: 'column', value: 'nome' },
  ], { nome: 'Ana' }), [{ type: 'body', parameters: [{ type: 'text', text: 'Olá' }, { type: 'text', text: 'Ana' }] }]);
});
