import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CnpjHub, type CnpjHubEvent } from '../src/client.js';
import { generate } from '../src/cnpj.js';
import {
  AllProvidersFailedError,
  CnpjNotFoundError,
  InvalidCnpjError,
  ProviderError,
} from '../src/errors.js';
import { delayed, fakeProvider, makeCompany, rejection, VALID_CNPJ } from './helpers.js';

const fast = { retryDelayMs: 1, maxRetryDelayMs: 50, cache: false as const };

const ok = (source: string) => fakeProvider(source, async (cnpj) => makeCompany({ cnpj, source }));
const failing = (
  name: string,
  options: Partial<ConstructorParameters<typeof ProviderError>[0]> = {},
) =>
  fakeProvider(name, async () => {
    throw new ProviderError({ provider: name, message: 'falhou', ...options });
  });
const notFound = (name: string) =>
  fakeProvider(name, async (cnpj) => {
    throw new CnpjNotFoundError(cnpj, name);
  });

describe('CnpjHub — fallback strategy', () => {
  it('returns the first provider that succeeds', async () => {
    const a = failing('a');
    const b = ok('b');
    const company = await new CnpjHub({ ...fast, providers: [a, b] }).lookup('11.222.333/0001-81');
    assert.equal(company.source, 'b');
    assert.equal(company.cnpj, VALID_CNPJ);
    assert.equal(a.calls, 1);
  });

  it('retries retryable failures before falling back', async () => {
    const a = fakeProvider('a', async (cnpj, _ctx, call) => {
      if (call === 1) throw new ProviderError({ provider: 'a', message: '503', retryable: true });
      return makeCompany({ cnpj, source: 'a' });
    });
    const b = ok('b');
    const company = await new CnpjHub({ ...fast, providers: [a, b] }).lookup(VALID_CNPJ);
    assert.equal(company.source, 'a');
    assert.equal(a.calls, 2);
    assert.equal(b.calls, 0);
  });

  it('gives up on a provider after the configured retries', async () => {
    const a = failing('a', { retryable: true });
    await rejection(new CnpjHub({ ...fast, retries: 2, providers: [a] }).lookup(VALID_CNPJ));
    assert.equal(a.calls, 3);
  });

  it('skips to the next provider when Retry-After is longer than maxRetryDelayMs', async () => {
    const a = failing('a', { retryable: true, retryAfterMs: 60_000 });
    const b = ok('b');
    const company = await new CnpjHub({ ...fast, providers: [a, b] }).lookup(VALID_CNPJ);
    assert.equal(company.source, 'b');
    assert.equal(a.calls, 1);
  });

  it('honors a short Retry-After', async () => {
    const a = fakeProvider('a', async (cnpj, _ctx, call) => {
      if (call === 1) {
        throw new ProviderError({
          provider: 'a',
          message: '429',
          retryable: true,
          retryAfterMs: 30,
        });
      }
      return makeCompany({ cnpj, source: 'a' });
    });
    const started = performance.now();
    await new CnpjHub({ ...fast, providers: [a] }).lookup(VALID_CNPJ);
    assert.ok(performance.now() - started >= 25);
    assert.equal(a.calls, 2);
  });

  it('throws CnpjNotFoundError when every provider says the CNPJ does not exist', async () => {
    const error = await rejection(
      new CnpjHub({ ...fast, providers: [notFound('a'), notFound('b')] }).lookup(VALID_CNPJ),
    );
    assert.ok(error instanceof CnpjNotFoundError);
    assert.equal(error.cnpj, VALID_CNPJ);
  });

  it('keeps asking other providers after a "not found" (their data may be fresher)', async () => {
    const company = await new CnpjHub({ ...fast, providers: [notFound('a'), ok('b')] }).lookup(
      VALID_CNPJ,
    );
    assert.equal(company.source, 'b');
  });

  it('throws AllProvidersFailedError listing every failure', async () => {
    const error = await rejection(
      new CnpjHub({ ...fast, providers: [notFound('a'), failing('b')] }).lookup(VALID_CNPJ),
    );
    assert.ok(error instanceof AllProvidersFailedError);
    assert.equal(error.errors.length, 2);
    assert.ok(error.errors[0] instanceof CnpjNotFoundError);
    assert.ok(error.errors[1] instanceof ProviderError);
  });

  it('wraps unexpected errors thrown by custom providers', async () => {
    const weird = fakeProvider('weird', async () => {
      throw new Error('boom');
    });
    const error = await rejection(new CnpjHub({ ...fast, providers: [weird] }).lookup(VALID_CNPJ));
    assert.ok(error instanceof AllProvidersFailedError);
    assert.ok(error.errors[0] instanceof ProviderError);
    assert.match(error.message, /boom/);
  });

  it('enforces the timeout even when a provider ignores the abort signal', async () => {
    const stuck = fakeProvider('stuck', () => new Promise(() => {}));
    const error = await rejection(
      new CnpjHub({ ...fast, retries: 0, timeoutMs: 20, providers: [stuck] }).lookup(VALID_CNPJ),
    );
    assert.ok(error instanceof AllProvidersFailedError);
    assert.match(error.message, /tempo limite/);
  });

  it('validates the input before calling any provider', async () => {
    const a = ok('a');
    await assert.rejects(new CnpjHub({ providers: [a] }).lookup('123'), InvalidCnpjError);
    assert.equal(a.calls, 0);
  });

  it('stops immediately when the caller aborts', async () => {
    const slow = fakeProvider('slow', (cnpj, ctx) =>
      delayed(1_000, makeCompany({ cnpj }), ctx.signal),
    );
    const b = ok('b');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const error = await rejection(
      new CnpjHub({ ...fast, providers: [slow, b] }).lookup(VALID_CNPJ, {
        signal: controller.signal,
      }),
    );
    assert.equal((error as Error).name, 'AbortError');
    assert.equal(b.calls, 0);
  });
});

describe('CnpjHub — race strategy', () => {
  it('returns the fastest provider and aborts the others', async () => {
    let slowAborted = false;
    const slow = fakeProvider('slow', (cnpj, ctx) => {
      ctx.signal.addEventListener('abort', () => {
        slowAborted = true;
      });
      return delayed(500, makeCompany({ cnpj, source: 'slow' }), ctx.signal);
    });
    const quick = fakeProvider('quick', (cnpj, ctx) =>
      delayed(5, makeCompany({ cnpj, source: 'quick' }), ctx.signal),
    );
    const hub = new CnpjHub({ ...fast, strategy: 'race', providers: [slow, quick] });
    const company = await hub.lookup(VALID_CNPJ);
    assert.equal(company.source, 'quick');
    assert.equal(slowAborted, true);
  });

  it('uses a slower provider when the faster one fails', async () => {
    const quickFail = failing('quick');
    const slowOk = fakeProvider('slow', (cnpj, ctx) =>
      delayed(20, makeCompany({ cnpj, source: 'slow' }), ctx.signal),
    );
    const hub = new CnpjHub({ ...fast, strategy: 'race', providers: [quickFail, slowOk] });
    assert.equal((await hub.lookup(VALID_CNPJ)).source, 'slow');
  });

  it('aggregates failures when every provider fails', async () => {
    const hub = new CnpjHub({
      ...fast,
      strategy: 'race',
      providers: [failing('a'), notFound('b')],
    });
    const error = await rejection(hub.lookup(VALID_CNPJ));
    assert.ok(error instanceof AllProvidersFailedError);
    assert.equal(error.errors.length, 2);
  });
});

describe('CnpjHub — cache, dedupe and events', () => {
  it('serves repeated lookups from the cache', async () => {
    const a = ok('a');
    const events: CnpjHubEvent[] = [];
    const hub = new CnpjHub({ providers: [a], onEvent: (e) => events.push(e) });
    await hub.lookup(VALID_CNPJ);
    await hub.lookup('11.222.333/0001-81');
    assert.equal(a.calls, 1);
    assert.ok(events.some((e) => e.type === 'cache-hit'));

    await hub.lookup(VALID_CNPJ, { bypassCache: true });
    assert.equal(a.calls, 2);
  });

  it('deduplicates concurrent lookups for the same CNPJ', async () => {
    const a = fakeProvider('a', (cnpj, ctx) => delayed(20, makeCompany({ cnpj }), ctx.signal));
    const hub = new CnpjHub({ ...fast, providers: [a] });
    const results = await Promise.all([
      hub.lookup(VALID_CNPJ),
      hub.lookup(VALID_CNPJ),
      hub.lookup(VALID_CNPJ),
    ]);
    assert.equal(a.calls, 1);
    assert.equal(results[0], results[2]);
  });

  it('emits attempt, failure and success events', async () => {
    const events: CnpjHubEvent[] = [];
    const hub = new CnpjHub({
      ...fast,
      providers: [failing('a'), ok('b')],
      onEvent: (e) => events.push(e),
    });
    await hub.lookup(VALID_CNPJ);
    assert.deepEqual(
      events.map((e) => `${e.type}:${'provider' in e ? e.provider : ''}`),
      ['attempt:a', 'failure:a', 'attempt:b', 'success:b'],
    );
  });

  it('ignores errors thrown by event listeners', async () => {
    const hub = new CnpjHub({
      ...fast,
      providers: [ok('a')],
      onEvent: () => {
        throw new Error('listener bug');
      },
    });
    assert.equal((await hub.lookup(VALID_CNPJ)).source, 'a');
  });

  it('keeps working when the cache backend fails', async () => {
    const events: CnpjHubEvent[] = [];
    const brokenCache = {
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => {
        throw new Error('redis down');
      },
    };
    const hub = new CnpjHub({
      providers: [ok('a')],
      cache: brokenCache,
      onEvent: (e) => events.push(e),
    });
    assert.equal((await hub.lookup(VALID_CNPJ)).source, 'a');
    assert.equal(events.filter((e) => e.type === 'cache-error').length, 2);
  });
});

describe('CnpjHub — configuration', () => {
  it('resolves built-in providers by name', () => {
    const hub = new CnpjHub({ providers: ['receitaws', 'brasilapi'] });
    assert.deepEqual(
      hub.providers.map((p) => p.name),
      ['receitaws', 'brasilapi'],
    );
    assert.deepEqual(
      new CnpjHub().providers.map((p) => p.name),
      ['brasilapi', 'cnpjws', 'receitaws'],
    );
  });

  it('rejects unknown provider names and empty lists', () => {
    assert.throws(() => new CnpjHub({ providers: ['nope'] }), /desconhecido/);
    assert.throws(() => new CnpjHub({ providers: [] }), /ao menos um/);
  });
});

describe('CnpjHub.lookupMany', () => {
  it('keeps input order, reports failures and respects the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const a = fakeProvider('a', async (cnpj, ctx) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        return await delayed(10, makeCompany({ cnpj }), ctx.signal);
      } finally {
        inFlight--;
      }
    });
    const inputs = [generate(), generate(), 'invalido', generate(), generate(), generate()];
    const results = await new CnpjHub({ ...fast, providers: [a] }).lookupMany(inputs, {
      concurrency: 2,
    });

    assert.equal(peak, 2);
    assert.deepEqual(
      results.map((r) => r.input),
      inputs,
    );
    assert.deepEqual(
      results.map((r) => r.ok),
      [true, true, false, true, true, true],
    );
    const failed = results[2];
    assert.ok(failed && !failed.ok && failed.error instanceof InvalidCnpjError);
  });
});
