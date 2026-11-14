import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a view principal compila para SSR sem acessar window no escopo do módulo', async () => {
  const source = await fs.readFile(path.join(packageRoot, 'views/Index.svelte'), 'utf8');
  const compiled = compile(source, { generate: 'ssr', filename: 'Index.svelte' });
  assert.match(compiled.js.code, /create_ssr_component/);
  assert.doesNotMatch(source, /let\s+window\b/);
});

test('a bolha de conversa apresenta o detalhe de falha vindo da Meta', async () => {
  const source = await fs.readFile(path.join(packageRoot, 'views/components/ChatThread.svelte'), 'utf8');
  const compiled = compile(source, { generate: 'ssr', filename: 'ChatThread.svelte' });
  assert.match(compiled.js.code, /create_ssr_component/);
  assert.match(source, /providerErrorCode/);
  assert.match(source, /message\.error/);
});

test('a conversa permite bloquear e desbloquear o contato', async () => {
  const source = await fs.readFile(path.join(packageRoot, 'views/components/ChatThread.svelte'), 'utf8');
  const compiled = compile(source, { generate: 'ssr', filename: 'ChatThread.svelte' });
  assert.match(compiled.js.code, /create_ssr_component/);
  assert.match(source, /'Block'/);
  assert.match(source, /'Unblock'/);
  assert.match(source, /conversations\/\$\{conversation\.id\}\/block/);
});

test('o modal de nova conversa oferece início por template para a Meta', async () => {
  const source = await fs.readFile(path.join(packageRoot, 'views/components/NewConversationModal.svelte'), 'utf8');
  const compiled = compile(source, { generate: 'ssr', filename: 'NewConversationModal.svelte' });
  assert.match(compiled.js.code, /create_ssr_component/);
  assert.match(source, /Start with template/);
  assert.match(source, /templates\/list/);
  assert.match(source, /conversations\/open-template/);
  assert.match(source, /Approved template/);
});

test('a extensão de campanha abre o FilePicker antes de processar a lista', async () => {
  const filename = path.resolve(packageRoot, '../whatsapp-campaign/views/Index.svelte');
  const source = await fs.readFile(filename, 'utf8');
  const compiled = compile(source, { generate: 'ssr', filename });
  assert.match(compiled.js.code, /create_ssr_component/);
  assert.match(source, /FilePicker/);
  assert.match(source, /accept="\.csv,\.tsv,\.txt"/);
  assert.match(source, /on:select/);
});

test('Meta loading and error screens never offer QR; paired providers retain QR', async () => {
  const { build } = await import('esbuild');
  const { createRequire } = await import('node:module');
  const vm = await import('node:vm');
  const filename = path.join(packageRoot, 'views/components/QRConnectModal.svelte');
  const source = await fs.readFile(filename, 'utf8');
  for (const provider of ['meta_cloud', 'baileys', 'evolution']) {
    for (const stage of ['connecting', 'error']) {
      const candidate = source.replace("let provider = 'meta_cloud'", `let provider = '${provider}'`).replace("let stage = 'form'", `let stage = '${stage}'`);
      const compiled = compile(candidate, { generate: 'ssr', filename });
      const bundle = await build({ stdin: { contents: compiled.js.code, resolveDir: path.dirname(filename) }, bundle: true, platform: 'node', format: 'cjs', write: false });
      const module = { exports: {} };
      vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), console });
      const html = module.exports.default.render().html;
      if (provider === 'meta_cloud') assert.doesNotMatch(html, /QR|Escaneie|Aparelhos conectados/);
      else assert.match(html, /QR/);
    }
  }
});

test('Manager não mantém componentes de campanha na interface', async () => {
  const source = await fs.readFile(path.join(packageRoot, 'views/Index.svelte'), 'utf8');
  assert.doesNotMatch(source, /CampaignManager|campaigns/);
});

test('Manager UI has no events entry or sidebar header', async () => {
  const [index, sidebar] = await Promise.all([
    fs.readFile(path.join(packageRoot, 'views/Index.svelte'), 'utf8'),
    fs.readFile(path.join(packageRoot, 'views/components/Sidebar.svelte'), 'utf8'),
  ]);
  assert.doesNotMatch(index, /EventsHelp|overlay === 'events'/);
  assert.doesNotMatch(sidebar, /dispatch\('events'\)|<header>/);
});

test('painel da instância carrega especialistas pela rota do WhatsApp Manager', async () => {
  const filename = path.join(packageRoot, 'views/components/InstancePanel.svelte');
  const source = await fs.readFile(filename, 'utf8');
  const compiled = compile(source, { generate: 'ssr', filename });
  assert.match(compiled.js.code, /create_ssr_component/);
  assert.match(source, /apiGet\('instances\/specialists'\)/);
  assert.doesNotMatch(source, /fetch\('\/specialists\/catalog'\)/);
});

test('especialista pode ser escolhido antes de ativar as respostas automáticas', async () => {
  const filename = path.join(packageRoot, 'views/components/InstancePanel.svelte');
  const source = await fs.readFile(filename, 'utf8');
  assert.doesNotMatch(source, /bind:value=\{specialistId\}\s+disabled=\{!agentEnabled\}/);
});
