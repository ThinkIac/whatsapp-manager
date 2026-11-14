import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { loadPrismaModels } from '../../../../../packages/scriba/src/parser/Prisma.js';

test('WhatsApp schema model constraints never become persisted fields', () => {
  const { models } = loadPrismaModels(new URL('../schema.prisma', import.meta.url));

  for (const model of Object.values(models)) {
    assert.equal(
      model.fields.some((field) => field.name.startsWith('@@')),
      false,
      'model-level Prisma constraints must not become database columns',
    );
  }

  assert.deepEqual(
    models.Conversation.fields.map((field) => field.name),
    [
      'id', 'instanceId', 'contactJid', 'contactName', 'unreadCount',
      'lastMessagePreview', 'lastMessageAt', 'agentPaused', 'agentPauseReason', 'agentOptedOutAt', 'agentHandoffAt', 'instance', 'messages',
    ],
  );
});

test('Message declara automationId nos dois schemas usados pelo runtime', async () => {
  const { models } = loadPrismaModels(new URL('../schema.prisma', import.meta.url));
  const jsonSchema = JSON.parse(await readFile(new URL('../schema/whatsapp-manager.schema.json', import.meta.url), 'utf8'));

  assert.ok(models.Message.fields.some((field) => field.name === 'automationId'));
  assert.equal(jsonSchema.collections.message.fields.automationId.type, 'string|null');
});

test('consulta humana e memória têm contratos nos dois schemas', async () => {
  const { models } = loadPrismaModels(new URL('../schema.prisma', import.meta.url));
  const jsonSchema = JSON.parse(await readFile(new URL('../schema/whatsapp-manager.schema.json', import.meta.url), 'utf8'));

  assert.ok(models.AgentConsultation.fields.some((field) => field.name === 'helperConversationId'));
  assert.ok(models.AgentKnowledge.fields.some((field) => field.name === 'consultationId'));
  assert.equal(jsonSchema.collections.agentConsultation.fields.status.type, 'string');
  assert.equal(jsonSchema.collections.agentKnowledge.fields.answer.type, 'string');
});
