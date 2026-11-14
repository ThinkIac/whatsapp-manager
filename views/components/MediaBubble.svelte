<script>
  import { onMount } from 'svelte';
  import { apiGet } from '../lib/api.js';
  export let conversationId; export let filename; export let mediaType = '';
  let dataUri = null; let failed = false;
  onMount(async () => { try { const response = await apiGet(`media/${conversationId}/${filename}`); if (response.base64) dataUri = `data:${response.mimetype};base64,${response.base64}`; else failed = true; } catch { failed = true; } });
  $: kind = mediaType.startsWith('image/') ? 'image' : mediaType.startsWith('audio/') ? 'audio' : mediaType.startsWith('video/') ? 'video' : 'document';
</script>

{#if failed}<span class="failed">Media unavailable</span>{:else if !dataUri}<span class="loading"></span>{:else if kind === 'image'}<img src={dataUri} alt="Attachment">{:else if kind === 'audio'}<audio controls src={dataUri}><track kind="captions"></audio>{:else if kind === 'video'}<video controls src={dataUri}><track kind="captions"></video>{:else}<a href={dataUri} download={filename}><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>{filename}</a>{/if}

<style>
  img, video { display: block; max-width: min(280px, 100%); max-height: 320px; border-radius: var(--tk-radius-md); } audio { max-width: 240px; } .loading { display: block; width: 190px; height: 110px; border-radius: var(--tk-radius-md); background: var(--tk-surface-2); } .failed { color: var(--tk-muted); font-size: 10px; } a { display: flex; align-items: center; gap: 7px; color: var(--tk-text); font-size: 11px; } svg { width: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; }
</style>
