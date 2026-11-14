/**
 * core/proxyAgent.js
 * Usado só pro teste de conectividade de proxy (routes/instances.js ->
 * testProxies). A conexão real usa core/antibot/proxyPool.js.
 */

import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

function buildTestAgent(proxyUrl) {
  const url = new URL(proxyUrl);
  if (url.protocol.startsWith('socks')) return new SocksProxyAgent(proxyUrl);
  return new HttpsProxyAgent(proxyUrl);
}

export function testProxyReachable(proxyUrl, { timeoutMs = 8000, testHost = 'web.whatsapp.com' } = {}) {
  return new Promise((resolve) => {
    let agent;
    try {
      agent = buildTestAgent(proxyUrl);
    } catch (err) {
      return resolve({ ok: false, error: `URL de proxy inválida: ${err.message}` });
    }

    const start = Date.now();
    const req = https.request({ host: testHost, path: '/', method: 'HEAD', agent, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode, latencyMs: Date.now() - start });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ ok: false, error: err.message, latencyMs: Date.now() - start }));
    req.end();
  });
}
