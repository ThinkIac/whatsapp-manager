<script>
  import { createEventDispatcher } from 'svelte';
  import { apiGet, apiPost } from '../lib/api.js';

  const dispatch = createEventDispatcher();
  export let instances = [];
  export let initialInstanceId = null;
  let instanceId = initialInstanceId || '';
  let name = '';
  let number = '';
  let error = '';
  let opening = false;
  let templates = [];
  let loadingTemplates = false;
  let templateSelection = '';
  let templateValues = [];
  $: available = instances.filter((item) => item.status === 'open');
  $: if (!instanceId && available.length === 1) instanceId = available[0].id;
  $: instance = available.find((item) => item.id === instanceId);
  $: isMeta = instance?.provider === 'meta_cloud';
  $: selectedTemplate = templates.find((item) => templateKey(item) === templateSelection);
  $: templateVariables = bodyVariables(selectedTemplate);
  $: if (templateValues.length !== templateVariables.length) templateValues = templateVariables.map((_, index) => templateValues[index] || '');

  function bodyVariables(template) {
    const body = template?.components?.find((component) => component.type === 'BODY')?.text || '';
    return [...String(body).matchAll(/{{\s*([^{}\s]+)\s*}}/g)].map((match, index) => ({ index, label: match[1] }));
  }

  function templateKey(template) {
    return `${template.name}::${template.language || template.languageCode || ''}`;
  }

  async function loadTemplates() {
    templates = [];
    templateSelection = '';
    templateValues = [];
    if (!isMeta) return;
    loadingTemplates = true;
    try {
      const response = await apiGet('templates/list', { instanceId });
      templates = (response.templates || []).filter((template) => String(template.status).toUpperCase() === 'APPROVED');
      if (templates.length === 1) templateSelection = templateKey(templates[0]);
    } catch (cause) {
      error = cause.message || 'Could not load approved templates.';
    } finally { loadingTemplates = false; }
  }

  $: if (instanceId) loadTemplates();

  async function open() {
    error = '';
    opening = true;
    try {
      const payload = { instanceId, name, number };
      const response = isMeta
        ? await apiPost('conversations/open-template', {
          ...payload,
          templateName: selectedTemplate?.name,
          languageCode: selectedTemplate?.language || selectedTemplate?.languageCode || 'pt_BR',
          components: templateVariables.length ? [{ type: 'body', parameters: templateValues.map((value) => ({ type: 'text', text: value })) }] : [],
        })
        : await apiPost('conversations/open', payload);
      dispatch('opened', response.conversation);
    } catch (cause) {
      error = cause.message || 'Could not open the chat.';
    } finally { opening = false; }
  }
</script>

<div class="backdrop" role="presentation" on:click|self={() => dispatch('close')}>
  <article>
    <header><div><small>ONE MESSAGE</small><h2>{isMeta ? 'Start with template' : 'New chat'}</h2></div><button class="icon" on:click={() => dispatch('close')} aria-label="Close">×</button></header>
    <label>Instance<select bind:value={instanceId}>{#each available as instance}<option value={instance.id}>{instance.name}{instance.provider === 'meta_cloud' ? ' · Meta Cloud API' : ''}</option>{/each}</select></label>
    <label>Phone with country code<input bind:value={number} inputmode="tel" placeholder="5511999999999"></label>
    <label>Optional name<input bind:value={name} placeholder="Contact name"></label>
    {#if isMeta}
      <p class="notice">O primeiro contato pela Meta é enviado somente por template aprovado e pressupõe o opt-in do destinatário.</p>
      <label>Approved template<select bind:value={templateSelection} disabled={loadingTemplates}><option value="">{loadingTemplates ? 'Loading templates...' : 'Select a template'}</option>{#each templates as template}<option value={templateKey(template)}>{template.name} · {template.language || template.languageCode}</option>{/each}</select></label>
      {#each templateVariables as variable, index}
        <label>Variável {variable.index + 1} <span>({variable.label})</span><input bind:value={templateValues[index]} placeholder={`Valor para {{${variable.label}}}`}></label>
      {/each}
      {#if !loadingTemplates && !templates.length}<p class="error">No approved templates found.</p>{/if}
    {/if}
    {#if !available.length}<p class="error">Connect an instance first.</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
    <button class="primary" disabled={opening || !instanceId || !number.trim() || (isMeta && (!selectedTemplate || templateValues.some((value) => !value.trim())))} on:click={open}>{opening ? 'Sending...' : isMeta ? 'Send template' : 'Open chat'}</button>
  </article>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 320; display: grid; place-items: center; padding: 18px; background: color-mix(in srgb, var(--tk-bg) 72%, transparent); color: var(--tk-text); font-family: var(--tk-font); }
  article { width: min(420px, 100%); padding: 22px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-lg); background: var(--tk-bg); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; } h2, p { margin: 0; } h2 { margin-top: 3px; font-size: 18px; } small, label { color: var(--tk-muted); font-size: 11px; }
  label { display: block; margin: 12px 0; } input, select { display: block; width: 100%; margin-top: 6px; padding: 10px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); background: var(--tk-surface); color: var(--tk-text); font: 12px var(--tk-font); }
  button { border: 0; border-radius: var(--tk-radius-md); cursor: pointer; font: 500 12px var(--tk-font); } .icon { width: 28px; height: 28px; background: transparent; color: var(--tk-muted); font-size: 20px; } .primary { width: 100%; margin-top: 10px; padding: 11px; background: var(--tk-accent); color: var(--tk-on-accent); } .primary:disabled { opacity: .4; } .error, .notice { margin-top: 12px; padding: 9px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); color: var(--tk-text); font-size: 11px; line-height: 1.4; } .notice { border-color: var(--tk-border); color: var(--tk-muted); } label span { color: var(--tk-muted); }
</style>
