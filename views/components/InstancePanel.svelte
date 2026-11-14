<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { apiGet, apiPost } from '../lib/api.js';
  const dispatch = createEventDispatcher();
  export let instance;

  let config = { ...(instance.antibotConfig || {}) };
  let metaControls = { enabled: true, maxPerHour: 250, maxPerDay: 1000, maxCampaignRecipients: 500, maxCampaignEstimatedSpend: 0, estimatedUnitCost: 0, ...(instance.metaSendControls || {}) };
  let agentEnabled = instance.agentEnabled === true;
  let specialistId = instance.specialistId || '';
  let agentBehavior = { accumulationSeconds: 0, responseDelaySeconds: 0, ...(instance.agentBehavior || {}) };
  let agentIdentity = { businessName: '', humanChannel: '', ...(instance.agentIdentity || {}) };
  let specialists = [];
  let proxyPoolText = (instance.proxyUrls || []).join('\n');
  let saving = false;
  let error = '';
  let confirmDelete = false;
  let reconnectQr = null;
  let webhookDiagnostic = null;
  let rejectedWebhook = null;
  $: managedProvider = ['meta_cloud', 'evolution', 'whatsmeow'].includes(instance.provider);

  onMount(async () => {
    if (instance.local) return;
    if (!managedProvider) return;
    if (instance.provider === 'meta_cloud') {
      try {
        const response = await apiGet('meta/diagnostics', { instanceId: instance.id });
        webhookDiagnostic = response.instances?.[0]?.diagnostic || null;
        rejectedWebhook = response.lastRejectedWebhook || null;
      } catch { /* diagnóstico não bloqueia o painel */ }
    }
    try {
      // A rota pertence ao próprio WhatsApp Manager. Assim o operador não
      // precisa ter acesso à tela Specialists apenas para configurar esta
      // instância, e recebe só os especialistas elegíveis.
      const response = await apiGet('instances/specialists');
      specialists = Array.isArray(response.specialists) ? response.specialists : [];
    } catch (cause) {
      specialists = [];
      error = cause?.message || 'Não foi possível carregar os especialistas disponíveis.';
    }
  });

  async function save() {
    saving = true; error = '';
    try {
      const response = await apiPost('instances/settings', managedProvider
        ? { name: instance.name, ...(instance.provider === 'meta_cloud' ? { metaSendControls } : {}), agentEnabled, specialistId: specialistId || null, agentBehavior, agentIdentity }
        : { name: instance.name, antibotConfig: config, proxyPool: proxyPoolText.split('\n').map((line) => line.trim()).filter(Boolean) });
      if (response.status >= 400) error = response.message;
      else dispatch('changed');
    } catch (cause) {
      error = cause?.message || 'Não foi possível salvar a configuração.';
    } finally {
      saving = false;
    }
  }

  async function disconnect() {
    error = '';
    try {
      const response = await apiPost(instance.provider === 'evolution' ? 'evolution/instances/disconnect' : 'instances/disconnect', { name: instance.name });
      if (!response.success) error = response.message || 'Não foi possível desconectar';
      else { instance = response.instance || instance; dispatch('changed'); }
    } catch (cause) {
      error = cause?.message || 'Não foi possível desconectar';
    }
  }

  async function reconnect() {
    if (instance.provider === 'meta_cloud') return;
    error = '';
    const response = instance.provider === 'evolution'
      ? await apiGet(`evolution/instances/${encodeURIComponent(instance.name)}/qr`)
      : await apiPost(`instances/${encodeURIComponent(instance.name)}/regenerate-qr`, {});
    if (response.status >= 400) error = response.message || 'Não foi possível iniciar a conexão';
    else { reconnectQr = response.qrcode || null; instance = { ...instance, status: response.status }; dispatch('changed'); }
  }

  async function remove() {
    error = '';
    try {
      const response = await apiPost(instance.provider === 'evolution' ? 'evolution/instances/delete' : 'instances/delete', { name: instance.name });
      if (!response.success) error = response.message || 'Não foi possível apagar';
      else { dispatch('changed'); dispatch('close'); }
    } catch (cause) {
      error = cause?.message || 'Não foi possível apagar';
    }
  }
</script>

<div class="backdrop" role="presentation" on:click|self={() => dispatch('close')}>
  <aside class="panel">
    <header><div><small>Configuração da instância</small><h2>{instance.name}</h2></div><button class="icon" on:click={() => dispatch('close')} aria-label="Fechar"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>

    <section class="status-card">
      <span class:online={instance.status === 'open'}></span>
      <div><strong>{instance.status === 'open' ? 'Conectada' : instance.status === 'connecting' ? 'Conectando' : 'Desconectada'}</strong><small>{instance.provider === 'meta_cloud' ? `Meta Cloud API${instance.phoneNumberId ? ` · ${instance.phoneNumberId}` : ''}` : instance.provider === 'evolution' ? `Evolution API externa${instance.evolutionBaseUrl ? ` · ${instance.evolutionBaseUrl}` : ''}` : `Risco atual: ${instance.banRisk || 'sem leitura'}`}</small></div>
    </section>

    {#if !instance.local}
    {#if instance.provider === 'meta_cloud'}<section>
      <div class="title"><div><h3>Controles de envio e gasto</h3><p>Limites preventivos locais. O custo final é definido pela Meta.</p></div><label class="switch"><input type="checkbox" bind:checked={metaControls.enabled}><span></span></label></div>
      <div class="grid">
        <label>Máximo por hora<input type="number" min="1" bind:value={metaControls.maxPerHour}></label>
        <label>Máximo por dia<input type="number" min="1" bind:value={metaControls.maxPerDay}></label>
        <label>Máximo por campanha<input type="number" min="1" bind:value={metaControls.maxCampaignRecipients}></label>
        <label>Custo estimado/unidade<input type="number" min="0" step="0.01" bind:value={metaControls.estimatedUnitCost}></label>
        <label>Limite estimado/campanha<input type="number" min="0" step="0.01" bind:value={metaControls.maxCampaignEstimatedSpend}></label>
      </div>
      <div class="agent-config">
        <div><h3>Agente de atendimento</h3><p>Opt-in por instância. Só responde após uma mensagem recebida do contato, dentro da janela Meta de 24 horas.</p></div>
        <label class="switch"><input type="checkbox" bind:checked={agentEnabled}><span></span><em>Ativar respostas automáticas</em></label>
        <label>Especialista<select bind:value={specialistId}><option value="">Selecione um especialista</option>{#each specialists as specialist}<option value={specialist.id}>{specialist.name}</option>{/each}</select></label>
        <div class="behavior-config">
          <h4>Comportamento da resposta</h4>
          <p>O acúmulo reinicia a cada mensagem da conversa. Depois do último texto, o atraso é aplicado antes de responder.</p>
          <div class="grid">
            <label>Acumular mensagens (segundos)<input type="number" min="0" max="600" step="1" bind:value={agentBehavior.accumulationSeconds} disabled={!agentEnabled}></label>
            <label>Atraso para responder (segundos)<input type="number" min="0" max="600" step="1" bind:value={agentBehavior.responseDelaySeconds} disabled={!agentEnabled}></label>
          </div>
        </div>
        <div class="behavior-config">
          <h4>Identidade e atendimento humano</h4>
          <p>Essas informações acompanham o especialista para identificação e encaminhamento seguro.</p>
          <div class="grid">
            <label>Nome do negócio<input bind:value={agentIdentity.businessName} maxlength="240" disabled={!agentEnabled}></label>
            <label>Canal humano (telefone, e-mail ou link)<input bind:value={agentIdentity.humanChannel} maxlength="240" disabled={!agentEnabled}></label>
          </div>
        </div>
        {#if instance.agentPausedReason}<p class="error">Respostas automáticas pausadas: {instance.agentPausedReason}</p>{/if}
      </div>
    </section>
    <section>
      <h3>Diagnóstico do webhook</h3>
      {#if webhookDiagnostic}<p>Último webhook autenticado: {new Date(webhookDiagnostic.at).toLocaleString('pt-BR')} · {webhookDiagnostic.received} recebida(s), {webhookDiagnostic.statuses} atualização(ões) de status.</p>
      {:else}<p>Nenhum webhook autenticado chegou a esta instância desde a última recarga. Confirme a URL e a assinatura na Meta.</p>{/if}
      {#if rejectedWebhook}<p class="error">Houve uma rejeição de assinatura em {new Date(rejectedWebhook.at).toLocaleString('pt-BR')}. Confirme o App Secret configurado.</p>{/if}
    </section>
    {:else if instance.provider === 'evolution' || instance.provider === 'whatsmeow'}<section>
      <div class="agent-config">
        <div><h3>Agente de atendimento</h3><p>Responde apenas após uma mensagem recebida. Não se aplica a janela oficial de 24 horas da Meta.</p></div>
        <label class="switch"><input type="checkbox" bind:checked={agentEnabled}><span></span><em>Ativar respostas automáticas</em></label>
        <label>Especialista<select bind:value={specialistId}><option value="">Selecione um especialista</option>{#each specialists as specialist}<option value={specialist.id}>{specialist.name}</option>{/each}</select></label>
        <div class="behavior-config"><h4>Comportamento da resposta</h4><div class="grid"><label>Acumular mensagens (segundos)<input type="number" min="0" max="600" step="1" bind:value={agentBehavior.accumulationSeconds} disabled={!agentEnabled}></label><label>Atraso para responder (segundos)<input type="number" min="0" max="600" step="1" bind:value={agentBehavior.responseDelaySeconds} disabled={!agentEnabled}></label></div></div>
        <div class="behavior-config"><h4>Identidade e atendimento humano</h4><div class="grid"><label>Nome do negócio<input bind:value={agentIdentity.businessName} maxlength="240" disabled={!agentEnabled}></label><label>Canal humano<input bind:value={agentIdentity.humanChannel} maxlength="240" disabled={!agentEnabled}></label></div></div>
        {#if instance.agentPausedReason}<p class="error">Respostas automáticas pausadas: {instance.agentPausedReason}</p>{/if}
      </div>
      <p>Integração não oficial via WhatsApp Web. Monitore a sessão e use a Meta Cloud API para operações oficiais.</p>
    </section>
    {:else}<section>
      <div class="title"><div><h3>Proteção anti-ban</h3><p>Aplicada somente a esta instância.</p></div><label class="switch"><input type="checkbox" bind:checked={config.enabled}><span></span></label></div>
      <div class="grid">
        <label>Por minuto<input type="number" min="1" bind:value={config.maxPerMinute}></label>
        <label>Por hora<input type="number" min="1" bind:value={config.maxPerHour}></label>
        <label>Delay mínimo (ms)<input type="number" min="0" bind:value={config.minDelayMs}></label>
        <label>Delay máximo (ms)<input type="number" min="0" bind:value={config.maxDelayMs}></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={config.warmupEnabled}> Usar curva de aquecimento</label>
      <label class="check"><input type="checkbox" bind:checked={config.blockOnCriticalRisk}> Pausar envios em risco crítico</label>
    </section>

    <section><h3>Pool de proxies</h3><p>Um endereço por linha. A alteração vale na próxima conexão.</p><textarea rows="4" bind:value={proxyPoolText} placeholder="socks5://usuario:senha@host:1080"></textarea></section>{/if}

    {#if error}<p class="error">{error}</p>{/if}
    <button class="primary" disabled={saving} on:click={save}>{saving ? 'Salvando...' : 'Salvar configuração'}</button>
    {/if}

    <section class="danger"><h3>Ciclo de vida</h3><p>Desconectar preserva histórico e configuração. Apagar encerra a sessão e remove todos os dados locais da instância.</p>
      {#if reconnectQr && instance.provider !== 'meta_cloud'}<div class="reconnect-qr"><img src={reconnectQr} alt="QR Code para reconectar a instância"><span>Escaneie em Aparelhos conectados.</span></div>{/if}
      {#if instance.provider === 'meta_cloud'}
        <p>Apagar remove o vínculo, o histórico e as mídias locais. O número e a configuração da Cloud API continuam na Meta.</p>
        {#if !confirmDelete}
          <button class="secondary danger-button" on:click={() => (confirmDelete = true)}>Apagar instância</button>
        {:else}
          <div class="confirm"><span>Esta ação não pode ser desfeita.</span><button on:click={() => (confirmDelete = false)}>Cancelar</button><button class="danger-button" on:click={remove}>Apagar agora</button></div>
        {/if}
      {:else if instance.provider === 'evolution'}
        <p>O webhook é configurado automaticamente em <code>/whatsapp-manager/evolution/webhook</code>.</p>
      {:else if !confirmDelete}
        <div class="lifecycle-actions">{#if instance.status === 'disconnected'}<button class="secondary" disabled={instance.local && (!instance.actions?.includes('instances.connect') || !instance.actions?.includes('instances.qr'))} on:click={reconnect}>Gerar novo QR</button>{:else}<button class="secondary" disabled={instance.local && !instance.actions?.includes('instances.disconnect')} on:click={disconnect}>Desconectar instância</button>{/if}{#if !instance.local}<button class="secondary danger-button" on:click={() => (confirmDelete = true)}>Apagar instância</button>{/if}</div>
      {:else}
        <div class="confirm"><span>Esta ação não pode ser desfeita.</span><button on:click={() => (confirmDelete = false)}>Cancelar</button><button class="danger-button" on:click={remove}>Apagar agora</button></div>
      {/if}
    </section>
  </aside>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 300; display: flex; justify-content: flex-end; background: color-mix(in srgb, var(--tk-bg) 72%, transparent); }
  .panel { width: min(480px, 100%); height: 100dvh; overflow-y: auto; padding: 24px; background: var(--tk-bg); border-left: 1px solid var(--tk-border); color: var(--tk-text); font-family: var(--tk-font); }
  header, .title { display: flex; align-items: center; justify-content: space-between; gap: 16px; } header { margin-bottom: 20px; }
  h2, h3, p { margin: 0; } h2 { margin-top: 3px; font-size: 19px; } h3 { font-size: 13px; } p, small { color: var(--tk-muted); font-size: 11px; }
  section { padding: 17px 0; border-top: 1px solid var(--tk-border); }
  .status-card { border: 1px solid var(--tk-border); border-radius: var(--tk-radius-lg); padding: 14px; display: flex; align-items: center; gap: 11px; margin-bottom: 20px; }
  .status-card > span { width: 9px; height: 9px; border-radius: 50%; background: var(--tk-muted-2); } .status-card > span.online { background: var(--tk-text); }
  .status-card strong, .status-card small { display: block; font-size: 12px; } .status-card small { margin-top: 3px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
  label { color: var(--tk-muted); font-size: 11px; } input[type='number'], textarea, select { display: block; width: 100%; margin-top: 6px; padding: 10px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); background: var(--tk-surface); color: var(--tk-text); font: 12px var(--tk-mono); outline: none; }
  textarea { resize: vertical; } input:focus, textarea:focus, select:focus { border-color: var(--tk-text); }
  .check { display: block; margin-top: 9px; color: var(--tk-text); }
  .switch input { display: none; } .switch span { width: 34px; height: 19px; padding: 2px; display: block; border: 1px solid var(--tk-border-hi); border-radius: 12px; background: var(--tk-surface-2); }
  .switch span::after { content: ''; display: block; width: 13px; height: 13px; border-radius: 50%; background: var(--tk-muted); transition: transform 220ms ease-out; }
  .switch input:checked + span::after { transform: translateX(15px); background: var(--tk-text); }
  .agent-config { border-top: 1px solid var(--tk-border); display: grid; gap: 10px; margin-top: 20px; padding-top: 18px; } .agent-config h3 { margin: 0; } .agent-config p { line-height: 1.45; margin-top: 5px; } .agent-config .switch { align-items: center; display: flex; gap: 8px; color: var(--tk-text); } .agent-config em { font-style: normal; }
  .behavior-config { border-top: 1px solid var(--tk-border); padding-top: 14px; } .behavior-config h4 { margin: 0; font-size: 12px; } .behavior-config p { line-height: 1.45; margin-top: 5px; }
  button { border: 0; border-radius: var(--tk-radius-md); padding: 10px 12px; font: 500 12px var(--tk-font); cursor: pointer; }
  .icon { padding: 6px; background: transparent; color: var(--tk-muted); } svg { width: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; }
  .primary { width: 100%; background: var(--tk-accent); color: var(--tk-on-accent); }
  .secondary { background: var(--tk-surface-2); color: var(--tk-text); border: 1px solid var(--tk-border); margin-top: 12px; }
  .lifecycle-actions { display: flex; gap: 8px; }
  .reconnect-qr { margin-top: 12px; display: flex; align-items: center; gap: 12px; color: var(--tk-muted); font-size: 11px; } .reconnect-qr img { width: 116px; height: 116px; border-radius: var(--tk-radius-md); border: 1px solid var(--tk-border); }
  .danger { margin-top: 22px; } .danger-button { color: var(--tk-text); border: 1px solid var(--tk-border-hi); }
  .confirm { margin-top: 12px; display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; font-size: 11px; color: var(--tk-muted); } .confirm button { background: var(--tk-surface-2); color: var(--tk-text); }
  .error { margin: 0 0 10px; padding: 9px; border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); color: var(--tk-text); }
  @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } .confirm { grid-template-columns: 1fr 1fr; } .confirm span { grid-column: 1 / -1; } }
</style>
