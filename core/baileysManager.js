/**
 * core/baileysManager.js
 * ─────────────────────────────────────────────────────────────────────────
 * Gerencia as sessões Baileys (multi-instância). Antibot 100% nativo
 * (core/antibot/*) — SEM dependência de 'baileys-antiban' ou qualquer
 * pacote de terceiros.
 * ─────────────────────────────────────────────────────────────────────────
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pino from 'pino';
import QRCode from 'qrcode';
import {
  default as makeWASocket,
  Browsers,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from 'baileys';
import { getProxy } from 'logos';
import { humanSendText } from './humanSend.js';
import { WarmUp } from './antibot/warmup.js';
import { RateLimiter } from './antibot/rateLimiter.js';
import { HealthMonitor } from './antibot/health.js';
import { classifyDisconnect } from './antibot/disconnect.js';
import { LidResolver } from './antibot/jidResolver.js';
import { buildProxyPool, resolveProxyUrls } from './antibot/proxyPool.js';
import { getStealthSocketConfig, rampPresenceAfterConnect, AbortError } from './antibot/fingerprint.js';
import { loadState, saveState } from './antibot/state.js';
import { readInstanceAntibotConfig, serializeAntibotConfig } from './antibot/config.js';
import { canDeleteInstance, purgeInstanceData } from './instanceData.js';
import { removeConversationMedia } from './mediaStore.js';
import { emitWhatsappEvent } from './events.js';
import { hasIncompletePersistedAuth, isCurrentSocket, resolveWAVersion, shouldStopWaitingForQr } from './baileysConnection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SESSIONS_DIR = path.join(ROOT, 'sessions');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const db = getProxy('whatsapp-manager');
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

const ANTIBOT_PERSIST_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RECONNECT_BACKOFF_MS = 60_000;
const CONNECT_WATCHDOG_MS = 75_000;

// name -> { sock, qrcode, status, lastError, presenceAbort, antibotStatePath,
//           persistTimer, watchdog, warmup, rateLimiter, health, lidResolver, proxyPool }
const sockets = new Map();

const inFlight = new Map(); // name -> Promise<entry>
const reconnectScheduled = new Set();
const manuallyDisconnected = new Set();
const connectionErrors = new Map();
const reconnectingInstances = new Set();

let messageListener = null;
export function onIncomingMessage(fn) {
  messageListener = fn;
}

function toJid(number) {
  return number.includes('@') ? number : `${number}@s.whatsapp.net`;
}

export function getInstanceInfo(name) {
  const record = db.instance.findOne({ name });
  const entry = sockets.get(name);
  return {
    id: record?.id,
    name,
    status: entry ? entry.status || record?.status || 'connecting' : record?.status || 'disconnected',
    qrcode: entry?.qrcode ?? null,
    proxyUrls: resolveProxyUrls(record),
    antibotConfig: readInstanceAntibotConfig(record),
    createdAt: record?.createdAt || null,
    banRisk: entry?.health?.getStatus()?.risk ?? null,
    warmup: entry?.warmup?.getStatus() ?? null,
    lastError: entry?.lastError ?? connectionErrors.get(name) ?? null,
    reconnecting: reconnectingInstances.has(name),
    proxyStats: entry?.proxyPool?.getStats() ?? null,
  };
}

export function listInstances() {
  const records = db.instance.all();
  return records.map((r) => getInstanceInfo(r.name));
}

export async function waitForQr(name, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = getInstanceInfo(name);
    if (info.qrcode) return info.qrcode;
    if (shouldStopWaitingForQr(info)) return null;
    await new Promise((r) => setTimeout(r, 300));
  }
  return getInstanceInfo(name).qrcode;
}

function stopPersistTimer(entry) {
  if (entry?.persistTimer) {
    clearInterval(entry.persistTimer);
    entry.persistTimer = null;
  }
}

function clearWatchdog(entry) {
  if (entry?.watchdog) {
    clearTimeout(entry.watchdog);
    entry.watchdog = null;
  }
}

function persistAntibotState(name) {
  const entry = sockets.get(name);
  if (!entry) return;
  saveState(entry.antibotStatePath, {
    warmup: entry.warmup.exportState(),
    rateLimiter: entry.rateLimiter.exportState(),
    health: entry.health.exportState(),
    lidResolver: entry.lidResolver.exportState(),
  });
}

function closeSocket(entry, reason) {
  if (!entry?.sock) return;
  try {
    if (typeof entry.sock.end === 'function') {
      entry.sock.end(new Error(reason));
    } else {
      entry.sock.ws?.close();
    }
  } catch {
    /* já pode estar fechado */
  }
}

function scheduleReconnect(name, attempt = 1, initialBackoffMs = 3000) {
  if (manuallyDisconnected.has(name)) return;
  if (reconnectScheduled.has(name)) return;
  reconnectScheduled.add(name);

  const backoffMs = Math.min(MAX_RECONNECT_BACKOFF_MS, initialBackoffMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * 1000);

  setTimeout(async () => {
    reconnectScheduled.delete(name);
    if (manuallyDisconnected.has(name)) return;
    try {
      await createInstance(name, { reconnectAttempt: true });
    } catch (err) {
      console.error(`[baileysManager] Tentativa ${attempt} de reconectar "${name}" falhou:`, err.message);
      scheduleReconnect(name, attempt + 1, initialBackoffMs);
    }
  }, backoffMs);
}

async function openSocket(name, record) {
  const sessionPath = path.join(SESSIONS_DIR, name);
  const hadPersistedAuth = fs.existsSync(path.join(sessionPath, 'creds.json'));
  fs.mkdirSync(sessionPath, { recursive: true });

  let { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  if (hasIncompletePersistedAuth(state, hadPersistedAuth)) {
    console.warn(`[baileysManager] Sessão incompleta de "${name}" descartada antes do pareamento.`);
    fs.rmSync(sessionPath, { recursive: true, force: true });
    fs.mkdirSync(sessionPath, { recursive: true });
    ({ state, saveCreds } = await useMultiFileAuthState(sessionPath));
  }

  const version = await resolveWAVersion(fetchLatestBaileysVersion, (error) => {
    console.warn(`[baileysManager] Não foi possível consultar a versão WA para "${name}": ${error.message}. Usando fallback.`);
  });
  const stealthConfig = getStealthSocketConfig(Browsers.ubuntu('ThinkIac'));

  const proxyPool = buildProxyPool(record);
  const fetchAgent = proxyPool?.currentAgent() ?? undefined;

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    ...stealthConfig,
    fetchAgent,
  });

  const antibotStatePath = path.join(sessionPath, 'antibot-state.json');
  const saved = loadState(antibotStatePath);

  const antibotConfig = readInstanceAntibotConfig(record);
  const warmup = new WarmUp(saved.warmup);
  const rateLimiter = new RateLimiter(antibotConfig);
  rateLimiter.loadState(saved.rateLimiter);
  const health = new HealthMonitor(saved.health);
  const lidResolver = new LidResolver();
  lidResolver.loadState(saved.lidResolver);

  const entry = {
    sock,
    status: 'connecting',
    qrcode: null,
    lastError: null,
    presenceAbort: null,
    antibotStatePath,
    persistTimer: null,
    watchdog: null,
    warmup,
    rateLimiter,
    health,
    lidResolver,
    proxyPool,
    antibotConfig,
    lastRisk: health.getStatus().risk,
  };
  sockets.set(name, entry);
  connectionErrors.delete(name);

  entry.watchdog = setTimeout(() => {
    console.error(`[baileysManager] "${name}" sem QR/handshake em ${CONNECT_WATCHDOG_MS / 1000}s — encerrando tentativa.`);
    entry.lastError = 'Timeout aguardando QR/handshake (verifique o(s) proxy(ies) configurado(s))';
    closeSocket(entry, 'connect-watchdog-timeout');
  }, CONNECT_WATCHDOG_MS);
  entry.watchdog.unref?.();

  entry.persistTimer = setInterval(() => persistAntibotState(name), ANTIBOT_PERSIST_INTERVAL_MS);
  entry.persistTimer.unref?.();

  sock.ev.on('creds.update', saveCreds);

  // O Baileys também recebe pares PN <-> LID fora de messages.upsert
  // (por exemplo, durante o sync de histórico). Espelhe-os no resolver
  // persistido do manager para que um envio à conversa já existente use o
  // LID correto, sem pedir uma nova resolução ao servidor.
  sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
    entry.lidResolver.learn(lid, pn);
  });

  sock.ev.on('connection.update', async (update) => {
    if (!isCurrentSocket(sockets, name, sock)) return;

    const { connection, lastDisconnect, qr } = update;
    const rec = db.instance.findOne({ name });

    if (qr) {
      clearWatchdog(entry);
      reconnectingInstances.delete(name);
      entry.qrcode = await QRCode.toDataURL(qr);
      entry.status = 'connecting';
      entry.lastError = null;
      connectionErrors.delete(name);
      if (rec) rec.status = 'connecting';
    }

    if (connection === 'open') {
      clearWatchdog(entry);
      reconnectingInstances.delete(name);
      entry.status = 'open';
      entry.qrcode = null;
      entry.lastError = null;
      connectionErrors.delete(name);
      if (rec) rec.status = 'open';
      entry.proxyPool?.markSuccess();
      entry.health.recordReconnect();
      await emitWhatsappEvent('whatsapp:instance:connected', {
        instanceId: rec?.id || null,
        instanceName: name,
        status: 'open',
      });

      const ac = new AbortController();
      entry.presenceAbort = ac;
      rampPresenceAfterConnect(sock, { minDelayMs: 20000, maxDelayMs: 60000, signal: ac.signal }).catch((err) => {
        if (!(err instanceof AbortError)) {
          console.error(`[baileysManager] rampPresenceAfterConnect falhou em "${name}":`, err.message);
        }
      });
    }

    if (connection === 'close') {
      clearWatchdog(entry);
      entry.presenceAbort?.abort();

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const operatorRequested = manuallyDisconnected.has(name);
      const classification = classifyDisconnect(statusCode);
      const willReconnect = classification.shouldReconnect && !operatorRequested;
      const isRestartRequired = statusCode === 515;
      entry.status = willReconnect ? 'connecting' : 'disconnected';
      if (rec) rec.status = entry.status;
      if (!operatorRequested) entry.health.recordDisconnect(statusCode);
      entry.proxyPool?.markFailure();
      if (!operatorRequested) await reportRiskIfChanged(name, entry);

      persistAntibotState(name);
      stopPersistTimer(entry);
      sockets.delete(name);

      if (willReconnect) {
        if (isRestartRequired) {
          // O 515 é parte esperada do primeiro vínculo: o Baileys pede um socket
          // novo depois de persistir as credenciais. Não exponha isso como erro
          // nem preserve a mensagem na próxima tentativa.
          reconnectingInstances.add(name);
          entry.lastError = null;
          connectionErrors.delete(name);
        } else {
          entry.lastError = classification.message;
          connectionErrors.set(name, classification.message);
        }
        scheduleReconnect(name, 1, classification.backoffMs);
      } else {
        reconnectingInstances.delete(name);
        entry.lastError = classification.message;
        connectionErrors.set(name, classification.message);
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }

      if (!operatorRequested) {
        await emitWhatsappEvent('whatsapp:instance:disconnected', {
          instanceId: rec?.id || null,
          instanceName: name,
          status: 'disconnected',
          reason: classification.message,
        });
      }
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    for (const msg of upsert.messages || []) {
      if (!msg.message) continue;
      entry.lidResolver.learnFromMessage(msg);
      if (messageListener) {
        try {
          await messageListener(name, msg);
        } catch (err) {
          console.error('[baileysManager] Erro no listener de mensagens:', err.message);
        }
      }
    }
  });

  return entry;
}

export async function createInstance(name, { proxyPool, antibotConfig, reconnectAttempt = false } = {}) {
  if (reconnectAttempt && manuallyDisconnected.has(name)) return null;
  if (!reconnectAttempt) manuallyDisconnected.delete(name);
  if (sockets.has(name)) return sockets.get(name);
  if (inFlight.has(name)) return inFlight.get(name);

  const promise = (async () => {
    let record = db.instance.findOne({ name });
    if (!record) {
      record = await db.instance.push({
        name,
        status: 'connecting',
        proxyPool: JSON.stringify(proxyPool || []),
        proxyUrl: null,
        antibotConfig: serializeAntibotConfig(antibotConfig),
        createdAt: new Date(),
      });
      await emitWhatsappEvent('whatsapp:instance:created', {
        instanceId: record.id,
        instanceName: name,
        status: 'connecting',
      });
    } else {
      record.status = 'connecting';
      if (proxyPool !== undefined) record.proxyPool = JSON.stringify(proxyPool);
      if (antibotConfig !== undefined) record.antibotConfig = serializeAntibotConfig(antibotConfig);
    }
    try {
      return await openSocket(name, record);
    } catch (error) {
      const message = error?.message || 'Não foi possível abrir a conexão do WhatsApp';
      connectionErrors.set(name, message);
      record.status = 'disconnected';
      throw error;
    }
  })();

  inFlight.set(name, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(name);
  }
}

export async function regenerateQr(name) {
  const entry = sockets.get(name);
  if (entry) {
    clearWatchdog(entry);
    entry.presenceAbort?.abort();
    persistAntibotState(name);
    stopPersistTimer(entry);
    closeSocket(entry, 'regenerate-qr solicitado pelo operador');
    sockets.delete(name);
  }

  const record = db.instance.findOne({ name });
  if (!record) throw new Error(`Instância "${name}" não existe`);
  if (record.status === 'open') return getInstanceInfo(name);

  // O WhatsApp decide QR-novo vs. retomar sessão pelas chaves que o cliente
  // apresenta no handshake — não existe flag local pra "pedir QR de novo".
  // Sem apagar a sessão antiga, o Baileys sempre tenta retomar as chaves
  // velhas e o evento 'qr' nunca dispara.
  fs.rmSync(path.join(SESSIONS_DIR, name), { recursive: true, force: true });

  record.status = 'connecting';
  await openSocket(name, record);
  await waitForQr(name, 10000);
  return getInstanceInfo(name);
}

export function shouldReconnectKnownInstance(record) {
  return (!record?.provider || record.provider === 'baileys') && record?.status !== 'disconnected';
}

export async function reconnectAllKnownInstances() {
  const records = db.instance.all();
  for (const r of records) {
    if (!shouldReconnectKnownInstance(r)) continue;
    createInstance(r.name).catch((err) => {
      console.error(`[baileysManager] Falha ao restaurar sessão "${r.name}":`, err.message);
      scheduleReconnect(r.name);
    });
  }
}

export async function disconnectInstance(name) {
  const record = db.instance.findOne({ name });
  if (!record) return { status: 404, message: 'Instância não encontrada' };

  manuallyDisconnected.add(name);
  reconnectScheduled.delete(name);
  if (inFlight.has(name)) {
    try {
      await inFlight.get(name);
    } catch {
      /* a tentativa já falhou; ainda precisamos consolidar o estado */
    }
  }
  const entry = sockets.get(name);
  if (entry) {
    clearWatchdog(entry);
    entry.presenceAbort?.abort();
    stopPersistTimer(entry);
    try {
      await entry.sock.logout();
    } catch {
      /* a sessão pode já ter sido encerrada pelo WhatsApp */
    }
    closeSocket(entry, 'instância desconectada pelo operador');
    sockets.delete(name);
  }
  record.status = 'disconnected';
  const sessionPath = path.join(SESSIONS_DIR, name);
  fs.rmSync(sessionPath, { recursive: true, force: true });
  await emitWhatsappEvent('whatsapp:instance:disconnected', {
    instanceId: record.id,
    instanceName: name,
    status: 'disconnected',
    reason: 'operator',
  });
  return { success: true, instance: getInstanceInfo(name) };
}

export async function deleteInstance(name) {
  const record = db.instance.findOne({ name });
  if (!record) return canDeleteInstance(record);

  // Apagar é uma ação final: uma tentativa de conexão pendente não deve deixar
  // a instância presa no painel. Encerra a sessão primeiro e só então remove os
  // registros e arquivos locais.
  if (record.status !== 'disconnected' || sockets.has(name) || inFlight.has(name) || reconnectScheduled.has(name)) {
    await disconnectInstance(name);
  }
  const permission = canDeleteInstance(record, sockets.has(name) || inFlight.has(name) || reconnectScheduled.has(name));
  if (!permission.allowed) return permission;

  const conversations = db.conversation.query({ instanceId: record.id });
  for (const conversation of conversations) removeConversationMedia(conversation.id);
  const removed = await purgeInstanceData(db, record);
  manuallyDisconnected.delete(name);
  fs.rmSync(path.join(SESSIONS_DIR, name), { recursive: true, force: true });

  await emitWhatsappEvent('whatsapp:instance:deleted', {
    instanceId: record.id,
    instanceName: name,
    removed,
  });
  return { success: true, removed };
}

export async function updateInstanceProxyPool(name, proxyPool) {
  const record = db.instance.findOne({ name });
  if (!record) throw new Error(`Instância "${name}" não existe`);
  record.proxyPool = JSON.stringify(proxyPool || []);
  return getInstanceInfo(name);
}

export function updateInstanceAntibotConfig(name, value) {
  const record = db.instance.findOne({ name });
  if (!record) throw new Error(`Instância "${name}" não existe`);
  record.antibotConfig = serializeAntibotConfig(value);
  const config = readInstanceAntibotConfig(record);
  const entry = sockets.get(name);
  if (entry) {
    const state = entry.rateLimiter.exportState();
    entry.antibotConfig = config;
    entry.rateLimiter = new RateLimiter(config);
    entry.rateLimiter.loadState(state);
  }
  return config;
}

async function reportRiskIfChanged(name, entry) {
  const status = entry.health.getStatus();
  if (status.risk === entry.lastRisk) return;
  entry.lastRisk = status.risk;
  const record = db.instance.findOne({ name });
  await emitWhatsappEvent('whatsapp:antiban:risk', {
    instanceId: record?.id || null,
    instanceName: name,
    ...status,
  });
}

function getEntry(name) {
  const entry = sockets.get(name);
  if (!entry) throw new Error(`Instância "${name}" não está conectada`);
  return entry;
}

export async function sendText(name, jid, text, authorize) {
  const entry = getEntry(name);
  const targetJid = entry.lidResolver.resolveForSend(toJid(jid));

  const risk = entry.health.getStatus().risk;
  if (entry.antibotConfig.enabled && entry.antibotConfig.blockOnCriticalRisk && risk === 'critical') {
    throw new Error('Envio pausado: risco de ban crítico nesta instância (aguarde a pontuação de risco cair).');
  }

  if (entry.antibotConfig.enabled && entry.antibotConfig.warmupEnabled && !entry.warmup.canSend()) {
    throw new Error('Limite diário de aquecimento atingido para esta instância — tente novamente amanhã.');
  }

  const waitMs = entry.antibotConfig.enabled ? entry.rateLimiter.getWaitMs(targetJid, text) : 0;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

  try {
    const result = await humanSendText(entry.sock, targetJid, text, authorize);
    entry.rateLimiter.record(targetJid);
    entry.warmup.record();
    entry.lastError = null;
    return result;
  } catch (err) {
    entry.lastError = err.message;
    entry.health.recordMessageFailed(err.message);
    await reportRiskIfChanged(name, entry);
    console.error(`[baileysManager] Falha ao enviar texto em "${name}":`, err.message);
    throw err;
  }
}

function buildMediaContent(mediaType, buffer, mimetype, filename, caption) {
  switch (mediaType) {
    case 'image':
      return { image: buffer, caption, mimetype };
    case 'audio':
      return { audio: buffer, mimetype: mimetype || 'audio/mp4', ptt: true };
    case 'video':
      return { video: buffer, caption, mimetype };
    default:
      return { document: buffer, mimetype, fileName: filename, caption };
  }
}

export async function sendMedia(name, jid, { mediaType, base64, mimetype, filename, caption }, authorize) {
  const entry = getEntry(name);
  const targetJid = entry.lidResolver.resolveForSend(toJid(jid));
  try {
    const buffer = Buffer.from(base64, 'base64');
    const content = buildMediaContent(mediaType, buffer, mimetype, filename, caption);
    await authorize?.();
    const result = await entry.sock.sendMessage(targetJid, content);
    entry.rateLimiter.record(targetJid);
    entry.warmup.record();
    entry.lastError = null;
    return result;
  } catch (err) {
    entry.lastError = err.message;
    entry.health.recordMessageFailed(err.message);
    await reportRiskIfChanged(name, entry);
    console.error(`[baileysManager] Falha ao enviar mídia em "${name}":`, err.message);
    throw err;
  }
}

export async function downloadIncomingMedia(name, waMessage) {
  const entry = getEntry(name);
  return downloadMediaMessage(
    waMessage,
    'buffer',
    {},
    { logger, reuploadRequest: entry.sock.updateMediaMessage }
  );
}

export async function getContactInfo(name, jid) {
  const entry = getEntry(name);
  const targetJid = entry.lidResolver.resolveCanonical(toJid(jid));
  const number = targetJid.split('@')[0];
  const formatted = number.length > 4
    ? `+${number.slice(0, 2)} ${number.slice(2, 4)} ${number.slice(4, 9)}-${number.slice(9)}`
    : number;

  const info = { number, formattedNumber: formatted, about: null, hasProfilePic: false };

  try {
    const [status] = await entry.sock.onWhatsApp(targetJid);
    info.existsOnWhatsApp = !!status?.exists;
  } catch {
    info.existsOnWhatsApp = null;
  }

  try {
    const status = await entry.sock.fetchStatus(targetJid);
    info.about = status?.status || null;
  } catch {
    /* contato pode ter "sobre" privado */
  }

  try {
    const pic = await entry.sock.profilePictureUrl(targetJid, 'image');
    info.hasProfilePic = !!pic;
    info.profilePicUrl = pic || null;
  } catch {
    info.hasProfilePic = false;
  }

  return info;
}
