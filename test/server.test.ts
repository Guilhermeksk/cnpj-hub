import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { CnpjHub } from '../src/client.js';
import { CnpjNotFoundError, ProviderError } from '../src/errors.js';
import { createServer } from '../src/server.js';
import { fakeProvider, makeCompany, VALID_CNPJ } from './helpers.js';

const MISSING = '98765432000198';
const BROKEN = '11444777000161';

describe('HTTP server', () => {
  const provider = fakeProvider('fake', async (cnpj) => {
    if (cnpj === MISSING) throw new CnpjNotFoundError(cnpj, 'fake');
    if (cnpj === BROKEN) throw new ProviderError({ provider: 'fake', message: 'fora do ar' });
    return makeCompany({ cnpj });
  });
  const server = createServer({
    hub: new CnpjHub({ providers: [provider], retries: 0, cache: false }),
  });
  let base = '';

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const get = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    return { res, body: text ? JSON.parse(text) : null };
  };

  it('GET /health', async () => {
    const { res, body } = await get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(body, { status: 'ok' });
  });

  it('GET /cnpj/:cnpj returns company data', async () => {
    const { res, body } = await get(`/cnpj/${VALID_CNPJ}`);
    assert.equal(res.status, 200);
    assert.equal(body.legalName, 'EMPRESA EXEMPLO LTDA');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('accepts formatted CNPJs with an encoded slash', async () => {
    const { res, body } = await get('/cnpj/11.222.333%2F0001-81');
    assert.equal(res.status, 200);
    assert.equal(body.cnpj, VALID_CNPJ);
  });

  it('maps errors to status codes', async () => {
    assert.equal((await get('/cnpj/123')).res.status, 400);
    const missing = await get(`/cnpj/${MISSING}`);
    assert.equal(missing.res.status, 404);
    assert.equal(missing.body.error, 'cnpj_not_found');
    const broken = await get(`/cnpj/${BROKEN}`);
    assert.equal(broken.res.status, 502);
    assert.equal(broken.body.error, 'providers_unavailable');
  });

  it('GET /cnpj/:cnpj/validate never calls providers', async () => {
    const before = provider.calls;
    const valid = await get('/cnpj/12ABC34501DE35/validate');
    assert.deepEqual(valid.body, {
      input: '12ABC34501DE35',
      valid: true,
      cnpj: '12ABC34501DE35',
      formatted: '12.ABC.345/01DE-35',
    });
    const invalid = await get('/cnpj/123/validate');
    assert.equal(invalid.body.valid, false);
    assert.equal(provider.calls, before);
  });

  it('handles unknown routes, other methods, CORS preflight and bad URLs', async () => {
    assert.equal((await get('/nope')).res.status, 404);
    assert.equal((await get('/cnpj/a/b/c')).res.status, 404);
    const post = await get('/health', { method: 'POST' });
    assert.equal(post.res.status, 405);
    assert.equal(post.res.headers.get('allow'), 'GET, OPTIONS');
    assert.equal((await get('/health', { method: 'OPTIONS' })).res.status, 204);
    assert.equal((await get('/cnpj/%E0%A4%A')).res.status, 400);
  });
});
