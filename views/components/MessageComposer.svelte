<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  export let disabled = false;
  let text = '';
  let fileInput;
  let attachment = null;

  function pickFile(event) { attachment = event.target.files?.[0] || null; }
  function send() {
    if (disabled || (!text.trim() && !attachment)) return;
    if (!attachment) { dispatch('send', { text: text.trim() }); text = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      dispatch('send', { text: text.trim(), mediaBase64: String(reader.result).split(',')[1], mediaType: attachment.type.split('/')[0], mimetype: attachment.type, filename: attachment.name });
      text = ''; attachment = null; fileInput.value = '';
    };
    reader.readAsDataURL(attachment);
  }
  function keydown(event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }
</script>

<div class="composer">
  {#if attachment}<div class="attachment"><span>{attachment.name}</span><button on:click={() => (attachment = null)} aria-label="Remove file"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div>{/if}
  <div class="row">
    <button class="icon" disabled={disabled} on:click={() => fileInput.click()} aria-label="Attach"><svg viewBox="0 0 24 24"><path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 1 1-2.8-2.8l8.3-8.3"/></svg></button>
    <input class="hidden" bind:this={fileInput} type="file" on:change={pickFile}>
    <textarea rows="1" bind:value={text} on:keydown={keydown} disabled={disabled} placeholder={disabled ? 'Select a chat' : 'Write a message'}></textarea>
    <button class="send" disabled={disabled || (!text.trim() && !attachment)} on:click={send} aria-label="Send"><svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></button>
  </div>
</div>

<style>
  .composer { padding: 10px 14px 13px; border-top: 1px solid var(--tk-border); background: var(--tk-bg); }
  .row { display: flex; align-items: flex-end; gap: 8px; }
  textarea { flex: 1; min-height: 40px; max-height: 110px; resize: none; padding: 11px 12px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-md); outline: none; background: var(--tk-surface); color: var(--tk-text); font: 12px var(--tk-font); }
  textarea:focus { border-color: var(--tk-border-hi); }
  button { width: 40px; height: 40px; display: grid; place-items: center; border: 0; border-radius: var(--tk-radius-md); cursor: pointer; }
  button:disabled { opacity: .35; cursor: default; } .icon { background: var(--tk-surface); color: var(--tk-muted); } .send { background: var(--tk-accent); color: var(--tk-on-accent); }
  svg { width: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .hidden { display: none; }
  .attachment { margin-bottom: 8px; padding: 7px 9px; display: flex; justify-content: space-between; align-items: center; border-radius: var(--tk-radius-md); background: var(--tk-surface); color: var(--tk-muted); font-size: 10px; }
  .attachment button { width: 24px; height: 24px; background: transparent; color: var(--tk-muted); }
</style>
