<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  export let instances = [];
  export let capabilities = {createInstance:true};
  export let selectedInstanceId = null;
</script>

<aside class="sidebar">
  {#if capabilities.createInstance}<button class="primary" on:click={() => dispatch('connect')}>
    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
    Connect
  </button>{/if}

  <div class="section-label">Instances</div>
  <nav>
    <button class:active={selectedInstanceId === null} on:click={() => dispatch('select', null)}>
      <span class="status all"></span><span>All</span><small>{instances.length}</small>
    </button>
    {#each instances as instance (instance.id || instance.name)}
      <div class="instance-row" class:active={selectedInstanceId === instance.id}>
        <button class="instance" on:click={() => dispatch('select', instance.id)}>
          <span class:online={instance.status === 'open'} class:waiting={instance.status === 'connecting'} class="status"></span>
          <span>{instance.name}</span>
        </button>
        <button class="icon" aria-label={`Manage ${instance.name}`} on:click={() => dispatch('manage', instance)}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.1A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.1a1.7 1.7 0 0 0 1 1.7 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1Z"/></svg>
        </button>
      </div>
    {/each}
  </nav>

  <footer>
    <button on:click={() => dispatch('templates')}><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>Templates</button>
  </footer>
</aside>

<style>
  .sidebar { height: 100%; padding: 12px; display: flex; flex-direction: column; gap: 12px; background: var(--tk-surface); }
  button { border: 0; color: inherit; font: inherit; cursor: pointer; }
  .primary { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 10px; border-radius: var(--tk-radius-md); background: var(--tk-accent); color: var(--tk-on-accent); font-size: 13px; font-weight: 500; }
  svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .section-label { padding: 8px 8px 0; color: var(--tk-muted); font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
  nav > button, .instance-row { min-height: 38px; border-radius: var(--tk-radius-md); background: transparent; }
  nav > button { width: 100%; padding: 0 10px; display: grid; grid-template-columns: 9px 1fr auto; align-items: center; gap: 9px; text-align: left; }
  .instance-row { display: grid; grid-template-columns: 1fr 34px; align-items: center; }
  .instance { min-width: 0; padding: 0 10px; display: grid; grid-template-columns: 9px 1fr; align-items: center; gap: 9px; text-align: left; background: transparent; }
  .instance span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  nav button, .instance-row { font-size: 13px; } nav small { color: var(--tk-muted); }
  nav > button:hover, .instance-row:hover, .active { background: var(--tk-surface-2); }
  .status { width: 7px; height: 7px; border-radius: 50%; background: var(--tk-muted-2); }
  .status.online { background: var(--tk-text); } .status.waiting { border: 1px solid var(--tk-muted); background: transparent; } .status.all { border-radius: 2px; }
  .icon { display: grid; place-items: center; background: transparent; color: var(--tk-muted); opacity: 0; }
  .instance-row:hover .icon, .instance-row:focus-within .icon { opacity: 1; }
  footer { border-top: 1px solid var(--tk-border); padding-top: 9px; display: grid; grid-template-columns: 1fr; gap: 4px; }
  footer button { background: transparent; color: var(--tk-muted); border-radius: var(--tk-radius-md); display: flex; justify-content: flex-start; align-items: center; gap: 8px; padding: 9px 10px; font-size: 11px; }
  footer button:hover { color: var(--tk-text); background: var(--tk-surface-2); }
  @media (max-width: 820px) { .icon { opacity: 1; } }
</style>
