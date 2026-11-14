import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTextForWhatsApp } from '../routes/conversations.js';

test('uma linha com --- força mensagens separadas', () => {
  assert.deepEqual(
    splitTextForWhatsApp('Oi! Como posso ajudar?\n---\nEstou ajudando a família do Gabriel.'),
    ['Oi! Como posso ajudar?', 'Estou ajudando a família do Gabriel.'],
  );
});

test('hífens dentro da frase não dividem a mensagem', () => {
  assert.deepEqual(splitTextForWhatsApp('Imóvel bem-localizado e pronto.'), ['Imóvel bem-localizado e pronto.']);
});

test('marcadores repetidos preservam a ordem e descartam blocos vazios', () => {
  assert.deepEqual(
    splitTextForWhatsApp('Primeira parte\n---\n\n---\nSegunda parte'),
    ['Primeira parte', 'Segunda parte'],
  );
});
