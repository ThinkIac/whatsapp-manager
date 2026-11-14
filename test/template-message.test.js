import test from 'node:test';
import assert from 'node:assert/strict';
import { templateDisplayText, templateForRetry, templateMessageData } from '../core/templateMessage.js';

test('reenvio de template Meta preserva tipo, idioma e parâmetros', () => {
  const components = [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }];
  const stored = templateMessageData({ name: 'welcome', languageCode: 'pt_BR', components });
  assert.deepEqual(templateForRetry({ text: '[Template: welcome]', ...stored }), { name: 'welcome', languageCode: 'pt_BR', components });
});

test('template legado sem parâmetros ainda é reenviado como template, não como texto', () => {
  assert.deepEqual(templateForRetry({ text: '[Template: welcome]' }), { name: 'welcome', languageCode: 'pt_BR', components: undefined });
});

test('metadados corrompidos bloqueiam reenvio inseguro como texto livre', () => {
  assert.match(templateForRetry({ text: '[Template: welcome]', templateComponents: '{' }).error, /parâmetros originais/i);
});

test('mostra o conteúdo do template com as variáveis enviadas, sem o marcador técnico', () => {
  const template = { components: [{ type: 'BODY', text: 'Olá {{1}}, seu código é {{2}}.' }] };
  const components = [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '8391' }] }];
  assert.equal(templateDisplayText(template, components, 'welcome'), 'Olá Ana, seu código é 8391.');
});
