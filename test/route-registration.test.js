import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { registerRoutes, registerTools } = require('logos/dist/src/kernel/scan.js');

test('runtime discovers instance routes and both public Meta webhook methods', async () => {
  const routes = await registerRoutes(fileURLToPath(new URL('../', import.meta.url)));
  for (const [path, method] of [
    ['meta/instances', 'post'], ['instances/create', 'post'],
    ['instances/list', 'get'], ['instances/specialists', 'get'], ['conversations/list', 'get'], ['events', 'get'],
    ['providers', 'get'],
    ['conversations/open-template', 'post'],
    ['deliveries/list', 'get'], ['deliveries/:id/approve', 'post'], ['deliveries/:id/queue', 'post'],
    ['deliveries/:id/cancel', 'post'], ['deliveries/:id/dispatch', 'post'],
    ['conversations/:id/delete', 'post'],
    ['conversations/:id/block', 'post'],
    ['whatsmeow/webhook', 'post'],
  ]) {
    assert.ok(routes.some(route => route.path === path && route.method === method), `${method} ${path}`);
  }
  for (const method of ['get', 'post']) {
    const route = routes.find(route => route.path === 'meta/webhook' && route.method === method);
    assert.ok(route, `${method} meta/webhook`);
    assert.equal(route.public, true);
  }
});

test('runtime discovers the complete WhatsApp operation toolset', async () => {
  const tools = await registerTools(fileURLToPath(new URL('../', import.meta.url)));
  const names = new Set(tools.map(tool => tool.name));
  for (const name of [
    'whatsapp_list_instances',
    'whatsapp_list_contacts',
    'whatsapp_list_conversations',
    'whatsapp_get_messages',
    'whatsapp_request_agent_consultation',
    'whatsapp_take_agent_consultation_answer',
    'whatsapp_store_agent_knowledge',
    'whatsapp_find_agent_knowledge',
    'whatsapp_get_agent_knowledge_context',
    'whatsapp_block_user',
    'whatsapp_open_conversation',
    'whatsapp_send_message',
    'whatsapp_send_media',
    'whatsapp_list_groups',
    'whatsapp_get_group',
    'whatsapp_create_group',
    'whatsapp_update_group',
    'whatsapp_update_group_participants',
    'whatsapp_get_group_invite_link',
    'whatsapp_leave_group',
    'whatsapp_send_group_message',
    'whatsapp_retry_message',
    'whatsapp_list_meta_templates',
    'whatsapp_send_meta_template',
    'whatsapp_start_meta_template',
  ]) assert.ok(names.has(name), name);

  const send = tools.find(tool => tool.name === 'whatsapp_send_message');
  const contacts = tools.find(tool => tool.name === 'whatsapp_list_contacts');
  assert.notEqual(contacts.reach, 'manual');
  assert.deepEqual(contacts.parameters.required, ['instanceName']);
  assert.notEqual(tools.find(tool => tool.name === 'whatsapp_list_instances').reach, 'manual');
  assert.notEqual(send.reach, 'manual');
  assert.deepEqual(send.parameters.required, ['text']);
  assert.ok(send.parameters.properties.instanceId);
  assert.ok(send.parameters.properties.number);
  assert.ok(send.parameters.properties.name);
  assert.ok(send.parameters.properties.conversationId);
  assert.match(send.description, /universal de envio por instância/i);
});

test('Manager não publica tools de campanha após a extração', async () => {
  const tools = await registerTools(fileURLToPath(new URL('../', import.meta.url)));
  assert.equal(tools.some(tool => /campaign/i.test(tool.name)), false);
});
