import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTemplateBody, templateParameters } from '../core/templateVariables.js';

test('normaliza aliases legíveis para a numeração exigida pela Meta e inclui exemplos', () => {
  assert.deepEqual(normalizeTemplateBody('Olá {{name}}, seu código é {{ code }}', ['Ana', 'X9']), {
    text: 'Olá {{1}}, seu código é {{2}}',
    variables: [{ index: 1, label: 'name' }, { index: 2, label: 'code' }],
    example: { body_text: [['Ana', 'X9']] },
  });
});

test('preserva variáveis posicionais válidas e exige exemplos para todas', () => {
  assert.deepEqual(normalizeTemplateBody('Olá {{1}}', ['Ana']), {
    text: 'Olá {{1}}',
    variables: [{ index: 1, label: '1' }],
    example: { body_text: [['Ana']] },
  });
  assert.throws(() => normalizeTemplateBody('Olá {{1}} e {{3}}', ['Ana', 'Bia']), /sequência/);
  assert.throws(() => normalizeTemplateBody('Olá {{name}}', []), /exemplo/);
});

test('lê os parâmetros retornados pelo catálogo remoto na ordem do corpo', () => {
  assert.deepEqual(templateParameters({ components: [{ type: 'BODY', text: 'Olá {{1}}, código {{2}}' }] }), [
    { index: 1, token: '{{1}}' }, { index: 2, token: '{{2}}' },
  ]);
});

test('preserva o identificador exibido de variáveis nomeadas para o editor e a campanha', () => {
  assert.deepEqual(templateParameters({ components: [{ type: 'BODY', text: 'Olá {{ name }}, pedido {{order_id}}' }] }), [
    { index: 1, token: '{{name}}' }, { index: 2, token: '{{order_id}}' },
  ]);
});
