import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CnpjNotFoundError, ProviderError } from '../src/errors.js';
import { brasilApi, cnpjWs, receitaWs } from '../src/providers/index.js';
import type { Provider } from '../src/types.js';
import { brasilApiPayload, cnpjWsPayload, receitaWsPayload } from './fixtures.js';
import { assertPartial, context, jsonFetch, rejection, VALID_CNPJ } from './helpers.js';

const expectedCore = {
  cnpj: VALID_CNPJ,
  legalName: 'EMPRESA EXEMPLO LTDA',
  tradeName: 'EXEMPLO',
  status: 'ATIVA',
  branchType: 'MATRIZ',
  openedAt: '2010-05-20',
  legalNature: 'Sociedade Empresária Limitada',
  size: 'MICRO EMPRESA',
  shareCapital: 10000,
  mainActivity: {
    code: '6201501',
    description: 'Desenvolvimento de programas de computador sob encomenda',
  },
  address: {
    number: '100',
    complement: null,
    district: 'CENTRO',
    zipCode: '01001000',
    state: 'SP',
  },
  email: 'contato@exemplo.com.br',
  simples: true,
  mei: false,
};

const cases: Array<[string, () => Provider, unknown, string]> = [
  ['brasilapi', () => brasilApi(), brasilApiPayload, 'https://brasilapi.com.br/api/cnpj/v1/'],
  ['receitaws', () => receitaWs(), receitaWsPayload, 'https://receitaws.com.br/v1/cnpj/'],
  ['cnpjws', () => cnpjWs(), cnpjWsPayload, 'https://publica.cnpj.ws/cnpj/'],
];

for (const [name, create, payload, baseUrl] of cases) {
  describe(`${name} provider`, () => {
    it('normalizes the response to the common Company shape', async () => {
      const fetch = jsonFetch(payload);
      const company = await create().lookup(VALID_CNPJ, context(fetch));

      assert.deepEqual(fetch.urls, [`${baseUrl}${VALID_CNPJ}`]);
      assertPartial(company, { ...expectedCore, source: name });
      assert.equal(company.phones[0], '1199999000');
      assert.equal(company.partners.length, 1);
      assertPartial(company.partners[0], { name: 'FULANA DE TAL', role: 'Sócio-Administrador' });
      assert.ok(!Number.isNaN(Date.parse(company.fetchedAt)));
    });

    it('throws CnpjNotFoundError on 404', async () => {
      await assert.rejects(
        create().lookup(VALID_CNPJ, context(jsonFetch({}, { status: 404 }))),
        CnpjNotFoundError,
      );
    });

    it('throws a retryable ProviderError with Retry-After on 429', async () => {
      const fetch = jsonFetch({}, { status: 429, headers: { 'retry-after': '3' } });
      const error = await rejection(create().lookup(VALID_CNPJ, context(fetch)));
      assert.ok(error instanceof ProviderError);
      assertPartial(error, { provider: name, status: 429, retryable: true, retryAfterMs: 3000 });
    });

    it('marks 5xx as retryable and other 4xx as fatal', async () => {
      const e503 = await rejection(
        create().lookup(VALID_CNPJ, context(jsonFetch({}, { status: 503 }))),
      );
      const e403 = await rejection(
        create().lookup(VALID_CNPJ, context(jsonFetch({}, { status: 403 }))),
      );
      assertPartial(e503, { retryable: true, status: 503 });
      assertPartial(e403, { retryable: false, status: 403 });
    });

    it('wraps network errors as retryable', async () => {
      const failing = (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;
      const error = await rejection(create().lookup(VALID_CNPJ, context(failing)));
      assertPartial(error, { retryable: true });
      assert.match((error as Error).message, /fetch failed/);
    });

    it('rejects invalid JSON and payloads without a legal name', async () => {
      await assert.rejects(create().lookup(VALID_CNPJ, context(jsonFetch('<html>'))), /JSON/);
      await assert.rejects(
        create().lookup(VALID_CNPJ, context(jsonFetch({ status: 'OK' }))),
        /razão social/,
      );
    });
  });
}

describe('receitaws specifics', () => {
  it('maps status ERROR + "rejeitado" to CnpjNotFoundError', async () => {
    const fetch = jsonFetch({ status: 'ERROR', message: 'CNPJ rejeitado pela Receita Federal' });
    await assert.rejects(receitaWs().lookup(VALID_CNPJ, context(fetch)), CnpjNotFoundError);
  });

  it('maps other status ERROR responses to ProviderError', async () => {
    const fetch = jsonFetch({
      status: 'ERROR',
      message: 'Too many requests, please try again later.',
    });
    await assert.rejects(receitaWs().lookup(VALID_CNPJ, context(fetch)), ProviderError);
  });

  it('sends the token as a bearer header', async () => {
    const fetch = jsonFetch(receitaWsPayload);
    await receitaWs({ token: 'abc' }).lookup(VALID_CNPJ, context(fetch));
    assertPartial(fetch.requests[0]?.headers, { authorization: 'Bearer abc' });
  });

  it('collects every phone number and drops placeholder activities', async () => {
    const company = await receitaWs().lookup(VALID_CNPJ, context(jsonFetch(receitaWsPayload)));
    assert.deepEqual(company.phones, ['1199999000', '1133334444']);
    assert.deepEqual(company.secondaryActivities, []);
  });
});

describe('cnpjws specifics', () => {
  it('uses the commercial endpoint and header when a token is given', async () => {
    const fetch = jsonFetch(cnpjWsPayload);
    await cnpjWs({ token: 'xyz' }).lookup(VALID_CNPJ, context(fetch));
    assert.equal(fetch.urls[0], `https://comercial.cnpj.ws/cnpj/${VALID_CNPJ}`);
    assertPartial(fetch.requests[0]?.headers, { x_api_token: 'xyz' });
  });
});

describe('brasilapi specifics', () => {
  it('accepts a custom base URL and drops empty secondary activities', async () => {
    const fetch = jsonFetch(brasilApiPayload);
    const company = await brasilApi({ baseUrl: 'http://mirror.local/cnpj' }).lookup(
      VALID_CNPJ,
      context(fetch),
    );
    assert.equal(fetch.urls[0], `http://mirror.local/cnpj/${VALID_CNPJ}`);
    assert.deepEqual(company.secondaryActivities, [
      {
        code: '6202300',
        description: 'Desenvolvimento e licenciamento de programas customizáveis',
      },
    ]);
    assert.equal(company.address.street, 'RUA DAS FLORES');
  });
});
