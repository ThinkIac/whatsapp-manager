import test from 'node:test';
import assert from 'node:assert/strict';
import { consultationTarget, isPendingConsultationForConversation, knowledgeTerms, rankKnowledge } from '../core/agentConsultation.js';

test('consulta humana normaliza o destino e só aceita resposta da conversa pendente', () => {
  assert.equal(consultationTarget('(11) 98672-3965'), '11986723965');
  assert.equal(isPendingConsultationForConversation({ status: 'pending', helperConversationId: 'helper' }, 'helper'), true);
  assert.equal(isPendingConsultationForConversation({ status: 'answered', helperConversationId: 'helper' }, 'helper'), false);
});

test('memória recupera somente entradas relacionadas à pergunta', () => {
  assert.deepEqual(knowledgeTerms('Qual é o preço da casa?'), ['qual', 'preco', 'casa']);
  assert.deepEqual(rankKnowledge('preço da casa', [
    { id: '1', question: 'Qual é o preço da casa?', answer: 'O valor confirmado é R$ 500 mil.' },
    { id: '2', question: 'Aceita cachorro?', answer: 'Não há informação sobre animais.' },
  ]).map((entry) => entry.id), ['1']);
});
