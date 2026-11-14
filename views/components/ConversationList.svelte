<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  export let conversations = [];
  export let selectedConversationId = null;
  let search = '';
  $: filtered = conversations.filter((conversation) => {
    const value = `${conversation.contactName || ''} ${conversation.contactJid || ''}`.toLowerCase();
    return value.includes(search.trim().toLowerCase());
  });
  function time(value) {
    if (!value) return '';
    return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="list">
  <header><button class="back" on:click={() => dispatch('back')} aria-label="Back"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button><div><h2>Chats</h2><small>{conversations.length} total</small></div><button class="new" on:click={() => dispatch('newConversation')}>New chat</button></header>
  <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input bind:value={search} placeholder="Search"></label>
  <div class="rows">
    {#each filtered as conversation (conversation.id)}
      <button class:active={selectedConversationId === conversation.id} on:click={() => dispatch('select', conversation)}>
        <span class="avatar">{(conversation.contactName || conversation.contactJid || '?').slice(0, 1).toUpperCase()}</span>
          <span class="content"><strong>{conversation.contactName || conversation.contactJid?.split('@')[0]}</strong><small>{conversation.lastMessagePreview || 'No messages'}</small></span>
        <span class="meta"><time>{time(conversation.lastMessageAt)}</time>{#if conversation.unreadCount > 0}<b>{conversation.unreadCount}</b>{/if}</span>
      </button>
    {:else}
      <div class="empty"><svg viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg><span>{search ? 'No results' : 'Chats appear here'}</span></div>
    {/each}
  </div>
</div>

<style>
  .list { height: 100%; display: flex; flex-direction: column; background: var(--tk-bg); }
  header { min-height: 72px; padding: 15px 17px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--tk-border); } header > div { margin-right: auto; }
  h2 { margin: 0; font-size: 15px; } header small { color: var(--tk-muted); font-size: 10px; }
  button, input { font: inherit; } button { border: 0; color: inherit; cursor: pointer; }
  svg { width: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .back { display: none; padding: 6px; background: transparent; }
  .new { padding: 7px 9px; border-radius: var(--tk-radius-md); background: var(--tk-accent); color: var(--tk-on-accent); font-size: 10px; }
  .search { margin: 12px 14px; padding: 0 10px; min-height: 36px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-md); color: var(--tk-muted); background: var(--tk-surface); }
  .search input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--tk-text); font-size: 12px; }
  .rows { flex: 1; min-height: 0; overflow-y: auto; padding: 0 7px 10px; }
  .rows > button { width: 100%; min-height: 67px; padding: 9px; display: grid; grid-template-columns: 40px 1fr auto; align-items: center; gap: 10px; text-align: left; background: transparent; border-radius: var(--tk-radius-md); }
  .rows > button:hover, .rows > button.active { background: var(--tk-surface); }
  .avatar { width: 39px; height: 39px; display: grid; place-items: center; border-radius: 50%; background: var(--tk-surface-2); color: var(--tk-muted); font-size: 13px; font-weight: 500; }
  .content { min-width: 0; } .content strong, .content small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .content strong { font-size: 12px; font-weight: 500; } .content small, time { margin-top: 5px; color: var(--tk-muted); font-size: 10px; }
  .meta { align-self: stretch; display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; }
  .meta b { min-width: 17px; height: 17px; padding: 0 4px; display: grid; place-items: center; border-radius: 9px; background: var(--tk-accent); color: var(--tk-on-accent); font-size: 9px; }
  .empty { height: 100%; display: grid; place-content: center; justify-items: center; gap: 9px; color: var(--tk-muted); font-size: 11px; } .empty svg { width: 28px; }
  @media (max-width: 820px) { .back { display: grid; place-items: center; } }
</style>
