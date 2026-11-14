import test from 'node:test';
import assert from 'node:assert/strict';
import { apiGet, apiPost } from '../views/lib/api.js';

function response({ ok = true, status = 200, contentType = 'application/json', body = '{}' } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    text: async () => body,
  };
}

test('apiPost retorna JSON de uma resposta HTTP válida', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/whatsapp-manager/instances/create');
    assert.equal(options.method, 'POST');
    return response({ body: JSON.stringify({ status: 'connecting', qrPending: true }) });
  };

  assert.deepEqual(await apiPost('instances/create', { name: 'vendas' }), {
    status: 'connecting',
    qrPending: true,
  });
});

test('apiGet rejeita status HTTP de erro usando a mensagem JSON', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => response({
    ok: false,
    status: 409,
    body: JSON.stringify({ message: 'Instância já existe' }),
  });

  await assert.rejects(() => apiGet('instances/vendas/qr'), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.message, 'Instância já existe');
    return true;
  });
});

test('apiGet rejeita HTML e explica possível redirecionamento de sessão', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => response({ contentType: 'text/html', body: '<html>login</html>' });

  await assert.rejects(
    () => apiGet('instances/list'),
    /resposta inválida.*sessão pode ter expirado/i,
  );
});

test('apiPost preserva erro JSON mesmo sem content-type JSON', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => response({ ok: false, status: 500, contentType: 'text/plain', body: JSON.stringify({ error: 'Falha ao criar campanha' }) });
  await assert.rejects(() => apiPost('campaigns/create', {}), { message: 'Falha ao criar campanha', status: 500 });
});

test('apiPost rejeita validação do domínio em resposta HTTP 200', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => response({ body: JSON.stringify({ status: 409, message: 'A campanha excede o limite de envio por hora.' }) });
  await assert.rejects(() => apiPost('campaigns/create', {}), { status: 409, message: 'A campanha excede o limite de envio por hora.' });
});

test('erro HTML 500 não atribui a falha à sessão nem expõe HTML', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => response({ ok: false, status: 500, contentType: 'text/html', body: '<html>internal stack</html>' });
  await assert.rejects(() => apiPost('campaigns/create', {}), (error) => {
    assert.equal(error.status, 500);
    assert.doesNotMatch(error.message, /sessão|internal stack|<html>/);
    return true;
  });
});
