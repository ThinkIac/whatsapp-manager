<script>
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { apiGet, apiPost } from '../lib/api.js';
  import { connectionState, startQrPolling } from '../lib/qrFlow.js';
  const dispatch = createEventDispatcher();
  let name = '';
  let provider = 'meta_cloud';
  let providers = [{ id: 'meta_cloud', label: 'Meta Cloud API', connection: 'external', official: true }];
  let phoneNumberId = '';
  let whatsappBusinessAccountId = '';
  let evolutionBaseUrl = '';
  let evolutionApiKey = '';
  let proxyPoolText = '';
  let stage = 'form';
  let qrcode = null;
  let lastError = '';
  let statusMessage = '';
  let cancelPolling = () => {};
  let regenerating = false;
  let config = { enabled: true, warmupEnabled: true, blockOnCriticalRisk: true, maxPerMinute: 15, maxPerHour: 250, minDelayMs: 1500, maxDelayMs: 5000, newChatDelayMs: 3000, burstAllowance: 3 };

  onMount(async () => {
    try { providers = (await apiGet('providers')).providers || providers; } catch { /* Meta continua disponível sem bridges */ }
  });

  async function connect() {
    if (!name.trim()) return;
    cancelPolling();
    stage = 'connecting';
    qrcode = null;
    lastError = '';
    statusMessage = '';
    try {
      const response = provider === 'meta_cloud'
        ? await apiPost('meta/instances', { name: name.trim(), phoneNumberId: phoneNumberId.trim(), whatsappBusinessAccountId: whatsappBusinessAccountId.trim() || null })
        : provider === 'evolution'
          ? await apiPost('evolution/instances', { name: name.trim(), baseUrl: evolutionBaseUrl.trim(), apiKey: evolutionApiKey.trim() })
        : await apiPost('instances/create', { name: name.trim(), provider, proxyPool: proxyPoolText.split('\n').map((line) => line.trim()).filter(Boolean), antibotConfig: config });
      if (typeof response.status === 'number' && response.status >= 400) {
        throw new Error(response.message || 'Falha ao criar a instância.');
      }
      if (provider === 'meta_cloud') { stage = 'connected'; statusMessage = ''; }
      else if (!applyResponse(response)) beginPolling();
    } catch (error) {
      showError(error);
    }
  }

  function applyResponse(response) {
    const detail = response.instance || response;
    if (detail.qrcode) qrcode = detail.qrcode;
    const state = connectionState(detail);
    stage = state.stage;
    statusMessage = state.stage === 'connecting' ? state.message : '';
    lastError = state.stage === 'error' ? state.message : '';
    return state.terminal;
  }

  function showError(error) {
    stage = 'error';
    statusMessage = '';
    lastError = error?.message || 'Could not start the connection.';
  }

  function beginPolling() {
    if (provider === 'meta_cloud') return;
    cancelPolling();
    cancelPolling = startQrPolling({
      load: () => provider === 'evolution' ? apiGet(`evolution/instances/${encodeURIComponent(name.trim())}/qr`) : apiGet(`instances/${encodeURIComponent(name.trim())}/qr`),
      onResponse: applyResponse,
      onError: showError,
    });
  }

  async function regenerateQr() {
    if (provider === 'meta_cloud' || !name.trim() || regenerating) return;
    regenerating = true;
    cancelPolling();
    stage = 'connecting';
    lastError = '';
    statusMessage = 'Requesting a new QR code...';
    try {
      const response = provider === 'evolution'
        ? await apiGet(`evolution/instances/${encodeURIComponent(name.trim())}/qr`)
        : await apiPost(`instances/${encodeURIComponent(name.trim())}/regenerate-qr`, {});
      if (!applyResponse(response)) beginPolling();
    } catch (error) {
      showError(error);
    } finally {
      regenerating = false;
    }
  }

  function retry() {
    cancelPolling();
    qrcode = null;
    lastError = '';
    statusMessage = '';
    stage = 'form';
  }

  function close() { cancelPolling(); dispatch('close'); }
  onDestroy(() => cancelPolling());
</script>

<div class="backdrop" role="presentation" on:click|self={close}>
  <article>
    <header><div><small>NEW INSTANCE</small><h2>Connect WhatsApp</h2></div><button class="icon" on:click={close} aria-label="Close"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    {#if stage === 'form'}
      <label>Name<input bind:value={name} placeholder="sales-01"></label>
      <label>Provider<select bind:value={provider}>{#each providers as item}<option value={item.id}>{item.label}{item.official ? ' (default)' : ''}</option>{/each}</select></label>
      {#if provider === 'meta_cloud'}
        <label>Phone Number ID<input bind:value={phoneNumberId} placeholder="1302424252952004"></label>
        <label>WhatsApp Business Account ID (optional)<input bind:value={whatsappBusinessAccountId}></label>
        <p>Default provider. Credentials stay in protected environment variables. This instance does not use QR, proxies, or anti-ban controls.</p>
        <button class="primary" disabled={!name.trim() || !phoneNumberId.trim()} on:click={connect}>Add Cloud API</button>
      {:else if provider === 'evolution'}
        <label>Evolution API URL<input bind:value={evolutionBaseUrl} placeholder="https://evolution.example.com"></label>
        <label>API key<input type="password" bind:value={evolutionApiKey} autocomplete="off"></label>
        <p>The external Evolution server creates this instance and receives this ThinkIac webhook. WhatsApp Web may carry operational risk.</p>
        <button class="primary" disabled={!name.trim() || !evolutionBaseUrl.trim() || !evolutionApiKey.trim()} on:click={connect}>Create QR code</button>
      {:else if provider === 'whatsmeow'}
        <p>Provided by the whatsapp-whatsmeow bridge. Requires <code>WHATSMEOW_SERVICE_URL</code>.</p>
        <button class="primary" disabled={!name.trim()} on:click={connect}>Create QR code</button>
      {:else}
        <label>Optional proxies<textarea rows="3" bind:value={proxyPoolText} placeholder="One address per line"></textarea></label>
        <div class="limits"><label>Messages per minute<input type="number" min="1" bind:value={config.maxPerMinute}></label><label>Messages per hour<input type="number" min="1" bind:value={config.maxPerHour}></label></div>
        <p>Provided by the whatsapp-baileys bridge. Anti-ban protection is isolated per instance.</p>
        <button class="primary" disabled={!name.trim()} on:click={connect}>Create QR code</button>
      {/if}
    {:else if stage === 'connecting' && provider === 'meta_cloud'}
      <div class="center" aria-busy="true"><strong>Adding Meta integration...</strong><p>This connection uses Cloud API.</p></div>
    {:else if stage === 'connecting'}
      <div class="center">
        {#if qrcode}<img src={qrcode} alt="QR code for this instance">{:else}<div class="qr-placeholder"></div>{/if}
        <strong>{qrcode ? 'Scan with WhatsApp' : 'Preparing connection...'}</strong>
        <p>Open Linked devices and select Link a device.</p>
        {#if statusMessage}<p>{statusMessage}</p>{/if}
        {#if lastError}<p class="error">{lastError}</p>{/if}
        <button class="secondary" disabled={regenerating} on:click={regenerateQr}>{regenerating ? 'Creating...' : 'New QR code'}</button>
      </div>
    {:else if stage === 'connected'}
      <div class="center"><svg class="large" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg><strong>Instance connected</strong><button class="primary" on:click={close}>Done</button></div>
    {:else}
      <div class="center"><p class="error">{lastError}</p>{#if provider !== 'meta_cloud'}<button class="primary" on:click={regenerateQr} disabled={regenerating}>{regenerating ? 'Creating...' : 'New QR code'}</button>{/if}<button class="secondary" on:click={retry}>Back</button></div>
    {/if}
  </article>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 320; display: grid; place-items: center; padding: 18px; background: color-mix(in srgb, var(--tk-bg) 72%, transparent); color: var(--tk-text); font-family: var(--tk-font); }
  article { width: min(420px, 100%); max-height: 90dvh; overflow-y: auto; padding: 22px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-lg); background: var(--tk-bg); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; } h2 { margin: 3px 0 0; font-size: 18px; } small, p { color: var(--tk-muted); font-size: 11px; }
  label { display: block; margin: 12px 0; color: var(--tk-muted); font-size: 11px; }
  input, textarea, select { display: block; width: 100%; margin-top: 6px; padding: 10px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); outline: none; background: var(--tk-surface); color: var(--tk-text); font: 12px var(--tk-font); }
  textarea { resize: vertical; font-family: var(--tk-mono); } input:focus, textarea:focus { border-color: var(--tk-text); }
  .limits { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  button { border: 0; border-radius: var(--tk-radius-md); font: 500 12px var(--tk-font); cursor: pointer; } .icon { padding: 5px; background: transparent; color: var(--tk-muted); }
  .primary { width: 100%; margin-top: 14px; padding: 11px; background: var(--tk-accent); color: var(--tk-on-accent); } .primary:disabled { opacity: .4; }
  .secondary { padding: 8px 10px; background: var(--tk-surface-2); color: var(--tk-text); } .secondary:disabled { opacity: .4; }
  svg { width: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .center { min-height: 260px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; text-align: center; }
  .center img, .qr-placeholder { width: 220px; height: 220px; border-radius: var(--tk-radius-md); border: 1px solid var(--tk-border); } .qr-placeholder { background: var(--tk-surface); }
  .large { width: 44px; height: 44px; } .error { padding: 9px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); color: var(--tk-text); }
</style>
