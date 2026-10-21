import { CnpjNotFoundError, ProviderError } from '../errors.js';
import type { ProviderContext } from '../types.js';

const USER_AGENT = 'cnpj-hub (+https://www.npmjs.com/package/cnpj-hub)';

export interface GetJsonOptions {
  provider: string;
  cnpj: string;
  url: string;
  headers?: Record<string, string>;
}

/**
 * GETs a JSON document and maps HTTP failures to the library's error types:
 * 404 → CnpjNotFoundError, 429/5xx/network → retryable ProviderError, other 4xx → fatal ProviderError.
 */
export async function getJson<T>(options: GetJsonOptions, context: ProviderContext): Promise<T> {
  const { provider, cnpj, url } = options;
  let response: Response;
  try {
    response = await context.fetch(url, {
      signal: context.signal,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...options.headers },
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
    throw new ProviderError({
      provider,
      message: timedOut ? 'tempo limite excedido' : `falha de rede: ${describe(cause)}`,
      retryable: true,
      cause,
    });
  }

  if (response.status === 404) {
    await response.body?.cancel();
    throw new CnpjNotFoundError(cnpj, provider);
  }

  if (!response.ok) {
    await response.body?.cancel();
    const retryable = response.status === 429 || response.status >= 500;
    throw new ProviderError({
      provider,
      status: response.status,
      message:
        response.status === 429 ? 'limite de requisições atingido' : `HTTP ${response.status}`,
      retryable,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new ProviderError({
      provider,
      status: response.status,
      message: 'resposta não é um JSON válido',
      cause,
    });
  }
}

/** Parses a `Retry-After` header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}
