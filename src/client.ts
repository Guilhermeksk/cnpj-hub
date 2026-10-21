import { mapConcurrent, sleep } from './async.js';
import { type Cache, MemoryCache } from './cache.js';
import { parse } from './cnpj.js';
import { AllProvidersFailedError, CnpjNotFoundError, ProviderError } from './errors.js';
import { builtinProviders, DEFAULT_PROVIDERS, isBuiltinProvider } from './providers/index.js';
import type { Company, Provider } from './types.js';

export type Strategy = 'fallback' | 'race';

export type CnpjHubEvent =
  | { type: 'cache-hit'; cnpj: string }
  | { type: 'cache-error'; cnpj: string; error: unknown }
  | { type: 'attempt'; cnpj: string; provider: string; attempt: number }
  | { type: 'success'; cnpj: string; provider: string; attempt: number; durationMs: number }
  | {
      type: 'failure';
      cnpj: string;
      provider: string;
      attempt: number;
      durationMs: number;
      error: ProviderError | CnpjNotFoundError;
      willRetry: boolean;
    };

export interface CnpjHubOptions {
  /**
   * Providers to query, in order. Accepts built-in names (`brasilapi`, `cnpjws`, `receitaws`)
   * or custom {@link Provider} objects. Default: `['brasilapi', 'cnpjws', 'receitaws']`.
   */
  providers?: Array<string | Provider>;
  /**
   * `fallback` (default) tries one provider at a time, in order — gentle on rate limits.
   * `race` queries all of them at once and returns the first success — lowest latency.
   */
  strategy?: Strategy;
  /** Timeout for each HTTP attempt, in ms. Default: 10000. */
  timeoutMs?: number;
  /** Extra attempts per provider for retryable failures (timeouts, 429, 5xx). Default: 1. */
  retries?: number;
  /** Base delay for exponential backoff, in ms. Default: 500. */
  retryDelayMs?: number;
  /**
   * Longest wait before a retry, in ms. If a provider asks (via `Retry-After`) for a
   * longer pause, the client moves on to the next provider instead. Default: 5000.
   */
  maxRetryDelayMs?: number;
  /** Cache implementation, or `false` to disable. Default: in-memory LRU with 1000 entries. */
  cache?: Cache<Company> | false;
  /** How long results stay cached, in ms. Default: 24 hours. */
  cacheTtlMs?: number;
  /** Custom `fetch` implementation (proxies, testing). Default: global `fetch`. */
  fetch?: typeof fetch;
  /** Observability hook called on cache hits, attempts, successes and failures. */
  onEvent?: (event: CnpjHubEvent) => void;
}

export interface LookupOptions {
  signal?: AbortSignal;
  /** Skip the cache read (the fresh result is still written to the cache). */
  bypassCache?: boolean;
}

export interface LookupManyOptions {
  /** Maximum number of lookups in flight. Default: 3. */
  concurrency?: number;
  signal?: AbortSignal;
}

export type LookupResult =
  | { input: string; ok: true; company: Company }
  | { input: string; ok: false; error: Error };

type Failure = ProviderError | CnpjNotFoundError;

/** Resilient CNPJ lookup across multiple providers. */
export class CnpjHub {
  readonly providers: readonly Provider[];
  readonly strategy: Strategy;

  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #retryDelayMs: number;
  readonly #maxRetryDelayMs: number;
  readonly #cache: Cache<Company> | null;
  readonly #cacheTtlMs: number;
  readonly #fetch: typeof fetch;
  readonly #onEvent: ((event: CnpjHubEvent) => void) | undefined;
  readonly #inFlight = new Map<string, Promise<Company>>();

  constructor(options: CnpjHubOptions = {}) {
    this.providers = resolveProviders(options.providers ?? DEFAULT_PROVIDERS);
    this.strategy = options.strategy ?? 'fallback';
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#retries = Math.max(0, options.retries ?? 1);
    this.#retryDelayMs = options.retryDelayMs ?? 500;
    this.#maxRetryDelayMs = options.maxRetryDelayMs ?? 5_000;
    this.#cache = options.cache === false ? null : (options.cache ?? new MemoryCache());
    this.#cacheTtlMs = options.cacheTtlMs ?? 24 * 60 * 60 * 1000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#onEvent = options.onEvent;
  }

  /**
   * Looks up a CNPJ. Accepts formatted or bare input.
   *
   * @throws InvalidCnpjError when the input is not a valid CNPJ.
   * @throws CnpjNotFoundError when every provider reports the CNPJ as nonexistent.
   * @throws AllProvidersFailedError when no provider could answer.
   */
  async lookup(input: string | number, options: LookupOptions = {}): Promise<Company> {
    const cnpj = parse(input);

    if (!options.bypassCache) {
      const cached = await this.#readCache(cnpj);
      if (cached) {
        this.#emit({ type: 'cache-hit', cnpj });
        return cached;
      }
    }

    // A caller-provided signal must only cancel that caller's request, so it is not shared.
    if (options.signal) return this.#fetchAndCache(cnpj, options.signal);

    const pending = this.#inFlight.get(cnpj);
    if (pending) return pending;
    const promise = this.#fetchAndCache(cnpj).finally(() => this.#inFlight.delete(cnpj));
    this.#inFlight.set(cnpj, promise);
    return promise;
  }

  /** Looks up many CNPJs with bounded concurrency. Never rejects; check each result's `ok`. */
  async lookupMany(
    inputs: ReadonlyArray<string | number>,
    options: LookupManyOptions = {},
  ): Promise<LookupResult[]> {
    const lookupOptions: LookupOptions = options.signal ? { signal: options.signal } : {};
    return mapConcurrent(inputs, options.concurrency ?? 3, async (raw) => {
      const input = String(raw);
      try {
        return { input, ok: true, company: await this.lookup(raw, lookupOptions) };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        return {
          input,
          ok: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    });
  }

  async #fetchAndCache(cnpj: string, signal?: AbortSignal): Promise<Company> {
    const company =
      this.strategy === 'race'
        ? await this.#race(cnpj, signal)
        : await this.#fallback(cnpj, signal);
    await this.#writeCache(cnpj, company);
    return company;
  }

  async #fallback(cnpj: string, signal?: AbortSignal): Promise<Company> {
    const failures: Failure[] = [];
    for (const provider of this.providers) {
      try {
        return await this.#tryProvider(provider, cnpj, signal);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        failures.push(toFailure(error, provider.name));
      }
    }
    throw combine(cnpj, failures);
  }

  async #race(cnpj: string, signal?: AbortSignal): Promise<Company> {
    const losers = new AbortController();
    const linked = signal ? AbortSignal.any([signal, losers.signal]) : losers.signal;
    try {
      return await Promise.any(
        this.providers.map((provider) =>
          this.#tryProvider(provider, cnpj, linked).catch((error: unknown) => {
            throw toFailure(error, provider.name);
          }),
        ),
      );
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw combine(cnpj, (error as AggregateError).errors as Failure[]);
    } finally {
      losers.abort();
    }
  }

  /** Calls one provider, retrying retryable failures with exponential backoff. */
  async #tryProvider(provider: Provider, cnpj: string, parent?: AbortSignal): Promise<Company> {
    for (let attempt = 1; ; attempt++) {
      // An explicit, cleared timer instead of AbortSignal.timeout(): it keeps the event loop
      // alive while waiting and does not linger after the attempt settles.
      const timeout = new AbortController();
      const timer = setTimeout(
        () => timeout.abort(new DOMException('Tempo limite excedido', 'TimeoutError')),
        this.#timeoutMs,
      );
      const signal = parent ? AbortSignal.any([parent, timeout.signal]) : timeout.signal;
      const started = performance.now();
      this.#emit({ type: 'attempt', cnpj, provider: provider.name, attempt });

      try {
        // Racing against the signal enforces the timeout even for providers that ignore it.
        const company = await abortable(
          provider.lookup(cnpj, { fetch: this.#fetch, signal }),
          signal,
        );
        clearTimeout(timer);
        const durationMs = performance.now() - started;
        this.#emit({ type: 'success', cnpj, provider: provider.name, attempt, durationMs });
        return company;
      } catch (raw) {
        clearTimeout(timer);
        if (parent?.aborted) throw parent.reason;
        const error = toFailure(raw, provider.name);
        const delay = this.#retryDelay(error, attempt);
        this.#emit({
          type: 'failure',
          cnpj,
          provider: provider.name,
          attempt,
          durationMs: performance.now() - started,
          error,
          willRetry: delay !== null,
        });
        if (delay === null) throw error;
        await sleep(delay, parent);
      }
    }
  }

  #retryDelay(error: Failure, attempt: number): number | null {
    if (!(error instanceof ProviderError) || !error.retryable || attempt > this.#retries) {
      return null;
    }
    if (error.retryAfterMs !== undefined) {
      return error.retryAfterMs <= this.#maxRetryDelayMs ? error.retryAfterMs : null;
    }
    const exponential = Math.min(this.#maxRetryDelayMs, this.#retryDelayMs * 2 ** (attempt - 1));
    // "Equal jitter": half fixed, half random, so concurrent clients do not retry in lockstep.
    return exponential / 2 + Math.random() * (exponential / 2);
  }

  async #readCache(cnpj: string): Promise<Company | undefined> {
    if (!this.#cache) return undefined;
    try {
      return await this.#cache.get(cnpj);
    } catch (error) {
      this.#emit({ type: 'cache-error', cnpj, error });
      return undefined;
    }
  }

  async #writeCache(cnpj: string, company: Company): Promise<void> {
    if (!this.#cache) return;
    try {
      await this.#cache.set(cnpj, company, this.#cacheTtlMs);
    } catch (error) {
      this.#emit({ type: 'cache-error', cnpj, error });
    }
  }

  #emit(event: CnpjHubEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      // A faulty listener must never break a lookup.
    }
  }
}

function resolveProviders(list: Array<string | Provider>): Provider[] {
  if (list.length === 0) throw new TypeError('Informe ao menos um provedor.');
  return list.map((item) => {
    if (typeof item !== 'string') return item;
    if (!isBuiltinProvider(item)) {
      const known = Object.keys(builtinProviders).join(', ');
      throw new TypeError(`Provedor desconhecido: "${item}". Disponíveis: ${known}.`);
    }
    return builtinProviders[item]();
  });
}

function toFailure(error: unknown, provider: string): Failure {
  if (error instanceof ProviderError || error instanceof CnpjNotFoundError) return error;
  const timedOut = error instanceof Error && error.name === 'TimeoutError';
  return new ProviderError({
    provider,
    message: timedOut
      ? 'tempo limite excedido'
      : error instanceof Error
        ? error.message
        : String(error),
    retryable: timedOut,
    cause: error,
  });
}

function combine(cnpj: string, failures: Failure[]): Error {
  if (failures.every((f) => f instanceof CnpjNotFoundError)) return new CnpjNotFoundError(cnpj);
  return new AllProvidersFailedError(cnpj, failures);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
