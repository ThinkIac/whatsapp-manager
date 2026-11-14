import test from 'node:test';
import assert from 'node:assert/strict';
import { LidResolver } from '../core/antibot/jidResolver.js';

test('prefere o LID conhecido ao enviar para um PN', () => {
  const resolver = new LidResolver();
  resolver.learn('123456789@lid', '43023442432074@s.whatsapp.net');

  assert.equal(resolver.resolveForSend('43023442432074@s.whatsapp.net'), '123456789@lid');
  assert.equal(resolver.resolveCanonical('123456789@lid'), '43023442432074@s.whatsapp.net');
});

test('aprende o par LID e PN em ambas as orientações do payload', () => {
  const primaryLid = new LidResolver();
  primaryLid.learnFromMessage({ key: {
    remoteJid: '111@lid',
    remoteJidAlt: '5511999999999@s.whatsapp.net',
  } });
  assert.equal(primaryLid.resolveForSend('5511999999999@s.whatsapp.net'), '111@lid');

  const alternateLid = new LidResolver();
  alternateLid.learnFromMessage({ key: {
    remoteJid: '5511888888888@s.whatsapp.net',
    remoteJidAlt: '222@lid',
  } });
  assert.equal(alternateLid.resolveForSend('5511888888888@s.whatsapp.net'), '222@lid');
});

test('mantem o endereco original quando ainda nao ha mapeamento', () => {
  const resolver = new LidResolver();
  assert.equal(resolver.resolveForSend('5511777777777@s.whatsapp.net'), '5511777777777@s.whatsapp.net');
  assert.equal(resolver.resolveForSend('333@lid'), '333@lid');
});
