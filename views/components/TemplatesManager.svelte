<script>
  import { createEventDispatcher } from 'svelte';
  import { apiGet, apiPost } from '../lib/api.js';

  export let instances = [];
  const dispatch = createEventDispatcher();
  $: metaInstances = instances.filter((item) => item.provider === 'meta_cloud');
  $: selectedInstance = instances.find(item => item.id === instanceId);
  const allowed = (instance, action) => !instance?.local || instance.actions?.includes(action);
  $: variables = [...String(form.body || '').matchAll(/{{\s*([^{}\s]+)\s*}}/g)].map((match, index) => ({ index: index + 1, label: match[1], token: `{{${match[1]}}}` }));
  $: examplesComplete = variables.every((_, index) => String(form.examples[index] || '').trim());
  $: bodyPreview = previewBody(form.body, form.examples);

  let instanceId = '';
  let templates = [];
  let loading = false;
  let saving = false;
  let error = '';
  let success = '';
  let editingId = null;
  let showEditor = false;
  let pendingDelete = null;
  let form = blankForm();

  function blankForm() { return { name: '', language: 'pt_BR', category: 'UTILITY', header: '', body: '', footer: '', buttons: '', examples: [] }; }
  function previewBody(text, examples) { let index = 0; return String(text || '').replace(/{{\s*([^{}\s]+)\s*}}/g, (_, token) => examples[index++] || `{{${token}}}`); }
  function components() {
    const value = [];
    if (form.header.trim()) value.push({ type: 'HEADER', format: 'TEXT', text: form.header.trim() });
    value.push({ type: 'BODY', text: form.body.trim() });
    if (form.footer.trim()) value.push({ type: 'FOOTER', text: form.footer.trim() });
    const buttons = form.buttons.split('\n').map((text) => text.trim()).filter(Boolean).map((text) => ({ type: 'QUICK_REPLY', text }));
    if (buttons.length) value.push({ type: 'BUTTONS', buttons });
    return value;
  }
  function openNew() { editingId = null; form = blankForm(); error = ''; success = ''; showEditor = true; }
  function fromTemplate(template) {
    const find = (type) => (template.components || []).find((item) => item.type === type);
    const body = find('BODY') || {};
    form = {
      name: template.name || '', language: template.language || 'pt_BR', category: template.category || 'UTILITY',
      header: find('HEADER')?.text || '', body: body.text || '', footer: find('FOOTER')?.text || '',
      buttons: (find('BUTTONS')?.buttons || []).map((item) => item.text).join('\n'), examples: body.example?.body_text?.[0] || [],
    };
    editingId = template.id || null; error = ''; success = ''; showEditor = true;
  }
  async function load() {
    if (!instanceId) { templates = []; return; }
    loading = true; error = ''; success = '';
    try { templates = (await apiGet('templates/list', { instanceId })).templates || []; }
    catch (cause) { templates = []; error = cause.message || 'Não foi possível consultar a Meta.'; }
    finally { loading = false; }
  }
  function chooseInstance(event) { instanceId = event.target.value; editingId = null; showEditor = false; form = blankForm(); load(); }
  async function save() {
    if (!instanceId || !form.name.trim() || !form.body.trim()) { error = 'Escolha a instância e informe nome e corpo do template.'; return; }
    saving = true; error = ''; success = '';
    const template = { name: form.name.trim(), language: form.language, category: form.category, components: components() };
    try {
      if (editingId) await apiPost('templates/update', { instanceId, templateId: editingId, template, examples: form.examples });
      else await apiPost('templates/create', { instanceId, template, examples: form.examples });
      success = editingId ? 'Alteração enviada para análise da Meta.' : 'Template enviado para análise da Meta.';
      editingId = null; form = blankForm(); showEditor = false; await load();
    } catch (cause) { error = cause.message || 'A Meta recusou o template.'; }
    finally { saving = false; }
  }
  async function remove() {
    const template = pendingDelete;
    if (!template) return;
    error = ''; success = '';
    try { await apiPost('templates/delete', { instanceId, templateId: template.id, templateName: template.name }); success = 'Template excluído na Meta.'; pendingDelete = null; await load(); }
    catch (cause) { error = cause.message || 'Não foi possível excluir o template.'; }
  }
</script>

<div class="backdrop" role="presentation">
  <section class="panel" aria-labelledby="templates-title">
    <header class="panel-header"><div><p class="eyebrow">META CLOUD API</p><h2 id="templates-title">Templates</h2><p class="subtle">Catálogo consultado diretamente na Meta.</p></div><button class="icon" aria-label="Fechar" on:click={() => dispatch('close')}><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <label class="instance-field">Instância Meta<select value={instanceId} on:change={chooseInstance}><option value="">Selecione uma instância</option>{#each metaInstances as instance}<option value={instance.id}>{instance.name}</option>{/each}</select></label>
    {#if !metaInstances.length}<p class="notice">Conecte uma instância Meta Cloud API para gerenciar templates.</p>{/if}
    {#if instanceId}
      <div class="toolbar"><div><strong>Templates remotos</strong><small>{templates.length} retornado{templates.length === 1 ? '' : 's'}</small></div><div class="toolbar-actions"><button on:click={load} disabled={loading}>{loading ? 'Consultando…' : 'Atualizar'}</button><button class="primary" disabled={!allowed(selectedInstance, 'templates.create')} on:click={openNew}>Novo template</button></div></div>
      {#if error}<p class="feedback error">{error}</p>{/if}{#if success}<p class="feedback success">{success}</p>{/if}
      <div class="catalog" aria-busy={loading}>
        {#each templates as template (template.id || `${template.name}-${template.language}`)}
          <article class="template-card"><div class="template-info"><div class="template-name"><strong>{template.name}</strong><span class:approved={template.status === 'APPROVED'} class="status">{template.status || 'UNKNOWN'}</span></div><small>{template.language} · {template.category}</small><p>{(template.components || []).find((item) => item.type === 'BODY')?.text || 'Sem corpo retornado pela Meta.'}</p></div><div class="card-actions"><button on:click={() => fromTemplate(template)} disabled={!template.id || !allowed(selectedInstance, 'templates.update')}>Editar</button><button class="danger" on:click={() => (pendingDelete = template)} disabled={!template.id || !allowed(selectedInstance, 'templates.delete')}>Excluir</button></div></article>
        {:else}<p class="notice">{loading ? 'Consultando a Meta…' : 'Nenhum template retornado pela Meta.'}</p>{/each}
      </div>
    {/if}
  </section>
</div>

{#if showEditor}
  <div class="editor-backdrop" role="presentation"><section class="editor" role="dialog" aria-modal="true" aria-labelledby="template-editor-title">
    <header class="editor-header"><div><p class="eyebrow">{editingId ? 'ALTERAÇÃO REMOTA' : 'NOVO TEMPLATE'}</p><h3 id="template-editor-title">{editingId ? 'Editar template' : 'Criar template'}</h3></div><button class="icon" aria-label="Fechar editor" on:click={() => (showEditor = false)}><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <form on:submit|preventDefault={save}><div class="form-grid"><label>Nome<input bind:value={form.name} disabled={Boolean(editingId)} pattern="[a-z0-9_]+" required></label><label>Idioma<input bind:value={form.language} required></label><label>Categoria<select bind:value={form.category}><option>UTILITY</option><option>MARKETING</option><option>AUTHENTICATION</option></select></label></div><label>Cabeçalho <span>(opcional)</span><input bind:value={form.header} maxlength="60"></label><label>Corpo<textarea rows="5" bind:value={form.body} placeholder="Olá &#123;&#123;name&#125;&#125;, seu pedido &#123;&#123;1&#125;&#125; está confirmado." required></textarea><small class="field-help">Você pode escrever &#123;&#123;name&#125;&#125; ou &#123;&#123;1&#125;&#125;. A Meta recebe a numeração sequencial exigida por ela.</small></label>
      {#if variables.length}<section class="variables"><div><strong>Exemplos para análise da Meta</strong><small>Preencha um exemplo realista para cada variável.</small></div>{#each variables as variable, index}<label>{variable.token}<input value={form.examples[index] || ''} on:input={(event) => { form.examples[index] = event.currentTarget.value; form = { ...form }; }} placeholder={`Exemplo para ${variable.label}`}></label>{/each}</section>{/if}
      <div class="preview"><small>Prévia enviada para análise</small><p>{bodyPreview || 'O conteúdo do template aparecerá aqui.'}</p></div><label>Rodapé <span>(opcional)</span><input bind:value={form.footer} maxlength="60"></label><label>Botões de resposta rápida <span>(um por linha, opcional)</span><textarea rows="2" bind:value={form.buttons}></textarea></label><div class="editor-actions"><button type="button" on:click={() => (showEditor = false)}>Cancelar</button><button class="primary" disabled={saving || !examplesComplete}>{saving ? 'Enviando…' : editingId ? 'Salvar alteração' : 'Enviar para análise'}</button></div></form>
  </section></div>
{/if}

{#if pendingDelete}
  <div class="editor-backdrop" role="presentation"><section class="confirm" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h3 id="delete-title">Excluir template?</h3><p>“{pendingDelete.name}” será removido diretamente da Meta.</p><div class="editor-actions"><button on:click={() => (pendingDelete = null)}>Cancelar</button><button class="danger primary" on:click={remove}>Excluir</button></div></section></div>
{/if}

<style>
  .backdrop, .editor-backdrop { position: fixed; inset: 0; z-index: 320; display: grid; place-items: center; padding: 20px; background: color-mix(in srgb, var(--tk-bg) 76%, transparent); color: var(--tk-text); font-family: var(--tk-font); }
  .panel { width: min(900px, 100%); max-height: calc(100dvh - 40px); overflow: auto; padding: 22px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-lg); background: var(--tk-surface); }
  .panel-header, .editor-header, .toolbar, .toolbar-actions, .card-actions, .editor-actions, .template-name { display: flex; align-items: center; gap: 9px; } .panel-header, .editor-header, .toolbar, .editor-actions { justify-content: space-between; }
  h2, h3, p { margin: 0; } h2 { margin-top: 2px; font-size: 21px; } h3 { font-size: 17px; } .eyebrow { color: var(--tk-muted); font: 700 10px var(--tk-mono); letter-spacing: .08em; } .subtle, small, .field-help { display: block; color: var(--tk-muted); font-size: 12px; } .subtle { margin-top: 4px; }
  button { border: 1px solid transparent; padding: 8px 11px; border-radius: var(--tk-radius-md); background: var(--tk-surface-2); color: var(--tk-text); font: 500 12px var(--tk-font); cursor: pointer; } button:disabled { opacity: .45; cursor: not-allowed; } .icon { padding: 6px; background: transparent; color: var(--tk-muted); } svg { width: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; } .primary { background: var(--tk-accent); color: var(--tk-on-accent); } .danger { border-color: var(--tk-border-hi); color: var(--tk-text); }
  label { display: grid; gap: 6px; margin-top: 14px; color: var(--tk-text); font-size: 12px; } label span { color: var(--tk-muted); font-weight: 400; } input, textarea, select { width: 100%; padding: 10px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); outline: none; background: var(--tk-bg); color: var(--tk-text); font: 13px var(--tk-font); } textarea { resize: vertical; } .instance-field { max-width: 420px; }
  .toolbar { margin: 24px 0 12px; } .toolbar small { margin-top: 3px; } .catalog { display: grid; gap: 8px; } .template-card { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding: 15px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-md); background: var(--tk-bg); } .template-info { min-width: 0; } .template-name { flex-wrap: wrap; } .status { padding: 2px 6px; border: 1px solid var(--tk-border); border-radius: 999px; color: var(--tk-muted); font: 700 10px var(--tk-mono); } .status.approved { color: var(--tk-text); border-color: var(--tk-border-hi); } .template-info small { margin-top: 4px; } .template-info p { margin-top: 9px; color: var(--tk-muted); font: 12px var(--tk-mono); white-space: pre-wrap; } .card-actions { flex: none; }
  .notice, .feedback { margin-top: 16px; padding: 11px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-md); color: var(--tk-muted); font-size: 12px; } .feedback.error { color: var(--tk-text); border-color: var(--tk-border-hi); } .feedback.success { color: var(--tk-text); }
  .editor-backdrop { z-index: 330; } .editor { width: min(680px, 100%); max-height: calc(100dvh - 40px); overflow: auto; padding: 22px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-lg); background: var(--tk-surface); } .confirm { width: min(390px, 100%); padding: 20px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-lg); background: var(--tk-surface); } .confirm p { margin-top: 9px; color: var(--tk-muted); font-size: 13px; }
  .form-grid { display: grid; grid-template-columns: minmax(0, 1fr) 110px 150px; gap: 10px; } .variables { margin-top: 15px; padding: 14px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-md); background: var(--tk-bg); } .variables > div { display: grid; gap: 4px; } .variables label { grid-template-columns: 105px minmax(0, 1fr); align-items: center; } .variables label input { margin: 0; } .preview { margin-top: 14px; padding: 13px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-md); background: var(--tk-bg); } .preview p { margin-top: 6px; white-space: pre-wrap; font-size: 13px; } .editor-actions { margin-top: 20px; justify-content: flex-end; }
  @media (max-width: 620px) { .backdrop, .editor-backdrop { padding: 0; } .panel, .editor { width: 100%; height: 100dvh; max-height: 100dvh; border-width: 0; border-radius: 0; } .toolbar, .template-card { align-items: stretch; flex-direction: column; } .toolbar-actions, .card-actions { justify-content: flex-end; } .form-grid { grid-template-columns: 1fr; gap: 0; } .variables label { grid-template-columns: 1fr; } }
</style>
