import assert from 'node:assert/strict';
import type { Company, Provider, ProviderContext } from '../src/types.js';

export const VALID_CNPJ = '11222333000181';

/** Asserts that every key in `expected` deep-equals the same key in `actual` (recursively). */
export function assertPartial(actual: unknown, expected: object, path = 'value'): void {
  assert.ok(actual !== null && typeof actual === 'object', `${path} should be an object`);
  for (const [key, value] of Object.entries(expected)) {
    const current: unknown = (actual as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      assertPartial(current, value, `${path}.${key}`);
    } else {
      assert.deepEqual(current, value, `${path}.${key}`);
    }
  }
}

/** Awaits a promise that must reject and returns the rejection reason. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected the promise to reject');
}

export function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
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
    secondaryActivities: [],
    address: {
      street: 'RUA DAS FLORES',
      number: '100',
      complement: null,
      district: 'CENTRO',
      zipCode: '01001000',
      city: 'SAO PAULO',
      state: 'SP',
    },
    phones: ['11999990000'],
    email: 'contato@exemplo.com.br',
    simples: true,
    mei: false,
    partners: [],
    source: 'fake',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export type FakeImpl = (cnpj: string, context: ProviderContext, call: number) => Promise<Company>;

export function fakeProvider(name: string, impl: FakeImpl): Provider & { calls: number } {
  const provider = {
    name,
    calls: 0,
    lookup(cnpj: string, context: ProviderContext) {
      provider.calls++;
      return impl(cnpj, context, provider.calls);
    },
  };
  return provider;
}

/** A `fetch` stub that answers every request with the given JSON body and status. */
export function jsonFetch(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): typeof fetch & { urls: string[]; requests: RequestInit[] } {
  const urls: string[] = [];
  const requests: RequestInit[] = [];
  const stub = (async (url: string | URL | Request, request?: RequestInit) => {
    urls.push(String(url));
    requests.push(request ?? {});
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  }) as typeof fetch & { urls: string[]; requests: RequestInit[] };
  stub.urls = urls;
  stub.requests = requests;
  return stub;
}

export function context(fetchImpl: typeof fetch): ProviderContext {
  return { fetch: fetchImpl, signal: new AbortController().signal };
}

/** Resolves after `ms`, or rejects when the provider's signal aborts (like a real fetch). */
export function delayed<T>(ms: number, value: T, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(value), ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
