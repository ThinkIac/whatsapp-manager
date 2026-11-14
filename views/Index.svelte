<script>
  import { onMount, onDestroy } from 'svelte';
  import { apiGet } from './lib/api.js';
  import Sidebar from './components/Sidebar.svelte';
  import ConversationList from './components/ConversationList.svelte';
  import ChatThread from './components/ChatThread.svelte';
  import QRConnectModal from './components/QRConnectModal.svelte';
  import InstancePanel from './components/InstancePanel.svelte';
  import NewConversationModal from './components/NewConversationModal.svelte';
  import TemplatesManager from './components/TemplatesManager.svelte';

  let theme = 'dark';
  let instances = [];
  let capabilities = {createInstance:false};
  let selectedInstanceId = null;
  let conversations = [];
  let selectedConversation = null;
  let managedInstance = null;
  let overlay = null;
  let mobileView = 'sidebar';
  let pollTimer;

  function readTheme() {
    theme = localStorage.getItem('think:theme') === 'light' ? 'light' : 'dark';
  }

  function onStorage(event) {
    if (event.key === 'think:theme') readTheme();
  }

  async function refreshInstances() {
    instances = await apiGet('instances/list');
    if (selectedInstanceId && !instances.some(item => item.id === selectedInstanceId)) { selectedInstanceId = null; selectedConversation = null; }
    if (managedInstance) managedInstance = instances.find((item) => item.id === managedInstance.id) || null;
  }

  async function refreshConversations() {
    const params = selectedInstanceId ? { instanceId: selectedInstanceId } : {};
    const response = await apiGet('conversations/list', params);
    conversations = response.conversations || [];
    if (selectedConversation) {
      selectedConversation = conversations.find((item) => item.id === selectedConversation.id) || null;
    }
  }

  function selectInstance(id) {
    selectedInstanceId = id;
    selectedConversation = null;
    refreshConversations();
    mobileView = 'list';
  }

  onMount(async () => {
    readTheme();
    window.addEventListener('storage', onStorage);
    capabilities = await apiGet('capabilities');
    await Promise.all([refreshInstances(), refreshConversations()]);
    pollTimer = setInterval(() => Promise.all([refreshInstances(), refreshConversations()]), 4000);
  });

  onDestroy(() => clearInterval(pollTimer));
</script>

<main class="app" data-theme={theme}>
  <section class:mobile-hidden={mobileView !== 'sidebar'} class="rail">
    <Sidebar
      {instances}
      {capabilities}
      {selectedInstanceId}
      on:select={(event) => selectInstance(event.detail)}
      on:connect={() => (overlay = 'connect')}
      on:manage={(event) => { managedInstance = event.detail; overlay = 'instance'; }}
      on:templates={() => (overlay = 'templates')}
    />
  </section>

  <section class:mobile-hidden={mobileView !== 'list'} class="conversations">
    <ConversationList
      {conversations}
      selectedConversationId={selectedConversation?.id}
      on:back={() => (mobileView = 'sidebar')}
      on:select={(event) => { selectedConversation = event.detail; mobileView = 'thread'; }}
      on:newConversation={() => (overlay = 'new-conversation')}
    />
  </section>

  <section class:mobile-hidden={mobileView !== 'thread'} class="thread">
    <ChatThread
      conversation={selectedConversation}
      {instances}
      on:back={() => (mobileView = 'list')}
      on:conversationUpdated={(event) => { selectedConversation = event.detail; refreshConversations(); }}
      on:deleted={() => { selectedConversation = null; mobileView = 'list'; refreshConversations(); }}
    />
  </section>
{#if overlay === 'connect'}
  <QRConnectModal on:close={() => { overlay = null; refreshInstances(); }} />
{:else if overlay === 'instance' && managedInstance}
  <InstancePanel instance={managedInstance} on:close={() => (overlay = null)} on:changed={refreshInstances} />
{:else if overlay === 'templates'}
  <TemplatesManager {instances} on:close={() => (overlay = null)} />
{:else if overlay === 'new-conversation'}
  <NewConversationModal {instances} initialInstanceId={selectedInstanceId} on:close={() => (overlay = null)} on:opened={(event) => { selectedConversation = event.detail; overlay = null; mobileView = 'thread'; refreshConversations(); }} />
{/if}
</main>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&family=Ubuntu+Mono:wght@400;700&display=swap');

  :global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }
  :global(body) { margin: 0; }

  .app[data-theme='dark'] {
    --tk-bg: #111111; --tk-surface: #181818; --tk-surface-2: #1f1f1f;
    --tk-border: rgba(255,255,255,.09); --tk-border-hi: rgba(255,255,255,.16);
    --tk-text: #f5f5f5; --tk-muted: #888888; --tk-muted-2: rgba(136,136,136,.5);
    --tk-accent: #f5f5f5; --tk-on-accent: #111111;
  }
  .app[data-theme='light'] {
    --tk-bg: #ffffff; --tk-surface: #f5f5f5; --tk-surface-2: #ececec;
    --tk-border: rgba(0,0,0,.10); --tk-border-hi: rgba(0,0,0,.18);
    --tk-text: #1a1a1a; --tk-muted: #666666; --tk-muted-2: rgba(0,0,0,.4);
    --tk-accent: #111111; --tk-on-accent: #ffffff;
  }
  .app {
    --tk-radius-md: 8px; --tk-radius-lg: 14px;
    --tk-font: 'Ubuntu', system-ui, sans-serif; --tk-mono: 'Ubuntu Mono', monospace;
    display: grid; grid-template-columns: 244px 336px minmax(0, 1fr);
    width: 100%; height: 100dvh; overflow: hidden;
    background: var(--tk-bg); color: var(--tk-text); font-family: var(--tk-font);
  }
  .rail, .conversations, .thread { min-width: 0; min-height: 0; }
  .rail, .conversations { border-right: 1px solid var(--tk-border); }
  @media (max-width: 820px) {
    .app { display: block; }
    .rail, .conversations, .thread { width: 100%; height: 100%; }
    .mobile-hidden { display: none; }
  }
</style>
