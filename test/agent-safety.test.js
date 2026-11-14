import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectOptOut, normalizeAgentIdentity, agentReplyBlock, isMetaPolicyRestriction,
} from '../core/agentSafety.js';

test('reconhece opt-out explícito sem confundir texto comum', () => {
  assert.equal(detectOptOut('Por favor, parem de me enviar mensagens'), true);
  assert.equal(detectOptOut('quero sair'), true);
  assert.equal(detectOptOut('Não quero mais receber novidades'), true);
  assert.equal(detectOptOut('Quero visitar o imóvel'), false);
});

test('normaliza identidade e canal humano por instância', () => {
  assert.deepEqual(normalizeAgentIdentity({ businessName: '  Desta Casa ', humanChannel: ' whatsapp.me/atendimento ' }), {
    businessName: 'Desta Casa', humanChannel: 'whatsapp.me/atendimento',
  });
  assert.deepEqual(normalizeAgentIdentity(), { businessName: '', humanChannel: '' });
});

test('pausas, opt-out e transferência humana bloqueiam o agente da conversa', () => {
  assert.equal(agentReplyBlock({ agentPaused: true, agentPauseReason: 'human_handoff' }), 'Atendimento humano assumiu esta conversa.');
  assert.equal(agentReplyBlock({ agentOptedOutAt: new Date() }), 'O contato pediu para não receber respostas automáticas.');
  assert.equal(agentReplyBlock({}), null);
});

test('falhas Meta explicitamente de política ou restrição pausam o agente', () => {
  assert.equal(isMetaPolicyRestriction({ providerErrorCode: '131047', error: 'Reengajamento fora da janela de 24 horas' }), true);
  assert.equal(isMetaPolicyRestriction({ error: 'Account restricted due to policy violation' }), true);
  assert.equal(isMetaPolicyRestriction({ providerErrorCode: '100', error: 'Parâmetro inválido' }), false);
});
