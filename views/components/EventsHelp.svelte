<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { apiGet } from '../lib/api.js';
  const dispatch = createEventDispatcher();
  let events = [];
  onMount(async () => { const response = await apiGet('events'); events = response.events || []; });
</script>

<div class="backdrop" role="presentation" on:click|self={() => dispatch('close')}>
  <article>
    <header><div><small>Integração Runtime</small><h2>Eventos disponíveis</h2></div><button on:click={() => dispatch('close')} aria-label="Fechar"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <p>Use um hook com o nome exato ou <code>whatsapp:*</code>. Todo payload é um objeto e inclui os identificadores relacionados.</p>
    <pre><code>{`export function onMessage(payload) {
  /**
   * @register_hook whatsapp:message:received
   */
  return payload;
}`}</code></pre>
    <div class="events">{#each events as event}<div><code>{event.name}</code><span>{event.description}</span></div>{/each}</div>
  </article>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 310; display: grid; place-items: center; padding: 18px; background: color-mix(in srgb, var(--tk-bg) 72%, transparent); color: var(--tk-text); font-family: var(--tk-font); }
  article { width: min(620px, 100%); max-height: 86dvh; overflow: auto; padding: 22px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-lg); background: var(--tk-bg); }
  header { display: flex; justify-content: space-between; align-items: center; } h2 { margin: 3px 0 0; font-size: 18px; } small, p, span { color: var(--tk-muted); font-size: 11px; }
  button { border: 0; padding: 5px; background: transparent; color: var(--tk-muted); cursor: pointer; } svg { width: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; }
  pre { margin: 18px 0; padding: 14px; overflow: auto; border-radius: var(--tk-radius-md); background: var(--tk-surface); border: 1px solid var(--tk-border); }
  code { font-family: var(--tk-mono); font-size: 11px; }
  .events { border-top: 1px solid var(--tk-border); } .events div { padding: 11px 2px; display: grid; grid-template-columns: minmax(220px, .8fr) 1fr; gap: 12px; border-bottom: 1px solid var(--tk-border); }
  @media (max-width: 560px) { .events div { grid-template-columns: 1fr; gap: 4px; } }
</style>
