import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWhatsAppNumber, conversationAddress } from '../core/conversationHelpers.js';

test('normaliza números para uma conversa e usa JID apenas no Baileys', () => {
  assert.equal(normalizeWhatsAppNumber('+55 (11) 99999-9999'), '5511999999999');
  assert.equal(conversationAddress('baileys', '5511999999999'), '5511999999999@s.whatsapp.net');
  assert.equal(conversationAddress('meta_cloud', '5511999999999'), '5511999999999');
  assert.equal(conversationAddress('evolution', '5511999999999'), '5511999999999');
});

test('rejeita número vazio ou fora do intervalo E.164', () => {
  assert.throws(() => normalizeWhatsAppNumber('abc'), /número/i);
  assert.throws(() => normalizeWhatsAppNumber('1234'), /número/i);
  assert.throws(() => normalizeWhatsAppNumber('1234567890123456'), /número/i);
});
