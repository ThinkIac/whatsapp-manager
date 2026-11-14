<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { apiGet, apiPost } from '../lib/api.js';
  import MessageComposer from './MessageComposer.svelte';
  import MediaBubble from './MediaBubble.svelte';
  const dispatch = createEventDispatcher();
  export let conversation = null;
  export let instances = [];
  let messages = [];
  let currentId = null;
  let timer;
  let sending = false;
  let scrollBox;
  let error = '';
  let confirmDelete = false;
  let actionsOpen = false;
  let changingBlock = false;
  $: allowed = action => !conversation?.local || conversation.actions?.includes(action);
  $: instance = instances.find((item) => item.id === conversation?.instanceId);
  $: hasAgent = instance?.agentEnabled === true && Boolean(instance?.specialistId);

  async function load() {
    if (!conversation?.id) { messages = []; return; }
    const id = conversation.id;
    let response;
    try { response = await apiGet(`conversations/${id}/messages`, { limit: 80 }); error = ''; }
    catch (failure) { messages = []; error = failure.message; return; }
    if (conversation?.id !== id) return;
    messages = response.messages || [];
    if (response.conversation) dispatch('conversationUpdated', response.conversation);
    setTimeout(() => { if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight; }, 0);
  }
  $: if (conversation?.id !== currentId) {
    currentId = conversation?.id || null;
    messages = [];
    clearInterval(timer);
    if (currentId) { load(); timer = setInterval(load, 3000); }
  }
  onDestroy(() => clearInterval(timer));

  async function send(event) {
    if (!conversation || sending) return;
    sending = true;
    try {
      await apiPost(`conversations/${conversation.id}/send`, event.detail);
      await load();
    } finally { sending = false; }
  }
  async function retry(message) { await apiPost(`conversations/${conversation.id}/messages/${message.id}/retry`, {}); load(); }
  async function toggleAgentPause() {
    if (!conversation) return;
    const response = await apiPost(`conversations/${conversation.id}/agent-pause`, { paused: !conversation.agentPaused, reason: 'human_handoff' });
    if (response.conversation) dispatch('conversationUpdated', response.conversation);
  }
  async function toggleBlock() {
    if (!conversation || changingBlock) return;
    changingBlock = true;
    try {
      const response = await apiPost(`conversations/${conversation.id}/block`, {
        blocked: !conversation.agentBlocked,
        reason: 'Blocked by operator',
      });
      actionsOpen = false;
      if (response.conversation) dispatch('conversationUpdated', response.conversation);
    } catch (failure) { error = failure.message; }
    finally { changingBlock = false; }
  }
  async function removeConversation() {
    if (!conversation) return;
    try {
      await apiPost(`conversations/${conversation.id}/delete`, {});
      confirmDelete = false;
      dispatch('deleted', conversation.id);
    } catch (failure) { error = failure.message; }
  }
  function clock(value) { return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
  function statusLabel(message) {
    if (message.providerStatus === 'accepted') return 'accepted · pending delivery';
    const status = message.status;
    return ({ sending: 'sending', sent: 'sent', delivered: 'delivered', read: 'read' })[status] || '';
  }
</script>

<div class="chat">
  {#if conversation}
    <header><button class="back" on:click={() => dispatch('back')} aria-label="Back"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button><span class="avatar">{(conversation.contactName || '?').slice(0, 1).toUpperCase()}</span><div><h2>{conversation.contactName || conversation.contactJid?.split('@')[0]}</h2><small>{conversation.contactJid?.split('@')[0]}{conversation.agentBlocked ? ' · blocked' : conversation.agentPaused ? ' · paused' : ''}</small></div>{#if !conversation.local}<div class="actions"><button class="more" on:click={() => (actionsOpen = !actionsOpen)} aria-label="More actions" aria-expanded={actionsOpen}><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>{#if actionsOpen}<div class="action-menu">{#if hasAgent}<label class="agent-switch"><input type="checkbox" checked={conversation.agentPaused} disabled={conversation.agentBlocked} on:change={toggleAgentPause}><span></span><em>Take over</em></label>{/if}<button class:unblock={conversation.agentBlocked} disabled={changingBlock} on:click={toggleBlock}>{conversation.agentBlocked ? 'Unblock' : 'Block'}</button><button class="delete" on:click={() => { actionsOpen = false; confirmDelete = true; }}>Delete chat</button></div>{/if}</div>{/if}</header>
    <div class="messages" bind:this={scrollBox}>
      {#each messages as message (message.id)}
        <div class:out={message.direction === 'out'} class="line">
          <div class="bubble">
            {#if message.mediaUrl}<MediaBubble conversationId={conversation.id} filename={message.mediaUrl} mediaType={message.mediaType} />{/if}
            {#if message.text}<p>{message.text}</p>{/if}
            <footer><time>{clock(message.timestamp)}</time>{#if message.status === 'failed' && allowed('messages.retry')}<button on:click={() => retry(message)}>Failed · retry</button>{:else if message.direction === 'out' && statusLabel(message)}<span>{statusLabel(message)}</span>{/if}</footer>
            {#if message.status === 'failed' && (message.providerErrorCode || message.error)}
              <small class="failure-detail">Failed{message.providerErrorCode ? ` ${message.providerErrorCode}` : ''}: {message.error || 'Message rejected by provider'}</small>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    {#if error}<p role="alert">{error}</p>{/if}
    <MessageComposer disabled={sending || !allowed('messages.send')} on:send={send} />
  {:else}
    <div class="placeholder"><svg viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg><h2>Select a chat</h2><p>Messages appear here.</p></div>
  {/if}
</div>

{#if confirmDelete}
  <div class="confirm-backdrop" role="presentation"><section class="confirm" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title"><h3 id="delete-conversation-title">Delete chat?</h3><p>Local history and media will be removed. WhatsApp messages remain.</p><div><button on:click={() => (confirmDelete = false)}>Cancel</button><button class="delete" on:click={removeConversation}>Delete chat</button></div></section></div>
{/if}

<style>
  .chat { height: 100%; min-width: 0; display: flex; flex-direction: column; background: var(--tk-bg); }
  header { min-height: 72px; padding: 12px 18px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--tk-border); }
  header > div { min-width: 0; flex: 1; }
  .avatar { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; background: var(--tk-surface-2); color: var(--tk-muted); font-size: 13px; }
  h2, p { margin: 0; } header h2 { font-size: 13px; } header small { color: var(--tk-muted); font-size: 10px; }
  button { border: 0; font: inherit; cursor: pointer; } .back { display: none; padding: 6px; background: transparent; color: var(--tk-text); }
  .actions { position: relative; flex: none; } .more { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); background: transparent; color: var(--tk-text); } .more svg { width: 17px; }
  .action-menu { position: absolute; z-index: 5; top: calc(100% + 6px); right: 0; min-width: 190px; padding: 5px; display: grid; gap: 3px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); background: var(--tk-surface); box-shadow: 0 10px 26px rgba(0,0,0,.22); }
  .agent-switch { padding: 7px; display: flex; align-items: center; gap: 8px; color: var(--tk-text); font-size: 11px; cursor: pointer; } .agent-switch input { position: absolute; opacity: 0; } .agent-switch span { width: 30px; height: 17px; padding: 2px; border: 1px solid var(--tk-border-hi); border-radius: 10px; background: var(--tk-surface-2); } .agent-switch span::after { content: ''; display: block; width: 11px; height: 11px; border-radius: 50%; background: var(--tk-muted); transition: transform 160ms ease; } .agent-switch input:checked + span::after { transform: translateX(13px); background: var(--tk-text); } .agent-switch em { font-style: normal; }
  .delete { width: 100%; flex: none; padding: 7px 9px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); background: transparent; color: var(--tk-text); font-size: 10px; text-align: left; }
  .action-menu > button { width: 100%; padding: 7px 9px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); background: transparent; color: var(--tk-text); font-size: 10px; text-align: left; }
  .action-menu > button:disabled { cursor: wait; opacity: .55; }
  .action-menu > button.unblock { background: var(--tk-surface-2); }
  svg { width: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .messages { flex: 1; min-height: 0; overflow-y: auto; padding: 22px clamp(14px, 4vw, 50px); background: var(--tk-surface); }
  .line { display: flex; margin: 5px 0; } .line.out { justify-content: flex-end; }
  .bubble { max-width: min(72%, 580px); padding: 9px 11px 7px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-lg); background: var(--tk-bg); font-size: 12px; line-height: 1.45; }
  .out .bubble { background: var(--tk-surface-2); border-color: var(--tk-border-hi); }
  .bubble p { white-space: pre-wrap; overflow-wrap: anywhere; }
  footer { margin-top: 5px; display: flex; justify-content: flex-end; gap: 6px; color: var(--tk-muted); font-size: 9px; } footer button { padding: 0; background: transparent; color: var(--tk-text); font-size: 9px; text-decoration: underline; }
  .failure-detail { display: block; margin-top: 4px; color: var(--tk-muted); font-size: 9px; line-height: 1.35; text-align: right; overflow-wrap: anywhere; }
  .placeholder { margin: auto; text-align: center; color: var(--tk-muted); } .placeholder svg { width: 34px; } .placeholder h2 { margin-top: 10px; color: var(--tk-text); font-size: 14px; } .placeholder p { margin-top: 4px; font-size: 11px; }
  .confirm-backdrop { position: fixed; inset: 0; z-index: 350; display: grid; place-items: center; padding: 18px; background: color-mix(in srgb, var(--tk-bg) 72%, transparent); }
  .confirm { width: min(390px, 100%); padding: 20px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-lg); background: var(--tk-surface); color: var(--tk-text); }
  .confirm h3, .confirm p { margin: 0; } .confirm h3 { font-size: 15px; } .confirm p { margin-top: 8px; color: var(--tk-muted); font-size: 12px; line-height: 1.45; } .confirm div { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; } .confirm button { padding: 8px 10px; background: var(--tk-surface-2); color: var(--tk-text); border-radius: var(--tk-radius-md); }
  @media (max-width: 820px) { .back { display: grid; place-items: center; } .bubble { max-width: 86%; } }
</style>
