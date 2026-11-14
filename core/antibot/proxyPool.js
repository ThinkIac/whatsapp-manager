/**
 * core/antibot/proxyPool.js
 * Pool de proxies por instância, com failover e cooldown — nativo.
 */

import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

function buildAgent(proxyUrl) {
  const url = new URL(proxyUrl);
  if (url.protocol.startsWith('socks')) return new SocksProxyAgent(proxyUrl);
  return new HttpsProxyAgent(proxyUrl);
}

export class ProxyPool {
  constructor(urls = []) {
    this.entries = urls.map((url) => ({ url, agent: this._safeBuild(url), failures: 0, cooldownUntil: 0 }));
    this.cursor = 0;
  }

  _safeBuild(url) {
    try {
      return buildAgent(url);
    } catch (err) {
      console.error(`[proxyPool] Proxy inválido ignorado ("${url}"):`, err.message);
      return null;
    }
  }

  hasProxies() {
    return this.entries.length > 0;
  }

  _healthyEntries(now = Date.now()) {
    return this.entries.filter((e) => e.agent && e.cooldownUntil <= now);
  }

  currentAgent() {
    const healthy = this._healthyEntries();
    if (!healthy.length) return this.entries[0]?.agent ?? null;
    return healthy[this.cursor % healthy.length].agent;
  }

  currentUrl() {
    const healthy = this._healthyEntries();
    if (!healthy.length) return this.entries[0]?.url ?? null;
    return healthy[this.cursor % healthy.length].url;
  }

  markFailure() {
    const healthy = this._healthyEntries();
    const entry = healthy[this.cursor % healthy.length] || this.entries[this.cursor % Math.max(1, this.entries.length)];
    if (entry) {
      entry.failures += 1;
      if (entry.failures >= 3) entry.cooldownUntil = Date.now() + 10 * 60 * 1000;
    }
    this.cursor += 1;
  }

  markSuccess() {
    const healthy = this._healthyEntries();
    const entry = healthy[this.cursor % Math.max(1, healthy.length)];
    if (entry) entry.failures = 0;
  }

  getStats() {
    return this.entries.map((e) => ({ url: e.url, failures: e.failures, cooldownUntil: e.cooldownUntil }));
  }
}

export function resolveProxyUrls(record) {
  let pool = [];
  if (record?.proxyPool) {
    try {
      pool = JSON.parse(record.proxyPool);
    } catch {
      pool = [];
    }
  }
  if (Array.isArray(pool) && pool.length) return pool;
  if (record?.proxyUrl) return [record.proxyUrl];
  return [];
}

export function buildProxyPool(record) {
  const urls = resolveProxyUrls(record);
  if (!urls.length) return null;
  return new ProxyPool(urls);
}
