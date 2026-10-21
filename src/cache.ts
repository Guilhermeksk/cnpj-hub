/**
 * Minimal cache contract. Methods may be sync or async, so a Redis/KeyDB/Memcached adapter
 * fits in a few lines.
 */
export interface Cache<T> {
  get(key: string): T | undefined | Promise<T | undefined>;
  set(key: string, value: T, ttlMs: number): void | Promise<void>;
}

export interface MemoryCacheOptions {
  /** Maximum number of entries before the least recently used one is evicted. Default: 1000. */
  maxEntries?: number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/** In-memory LRU cache with per-entry TTL. */
export class MemoryCache<T> implements Cache<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #maxEntries: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.#maxEntries = Math.max(1, options.maxEntries ?? 1000);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    if (entry.expiresAt <= Date.now()) return undefined;
    // Re-insert so Map iteration order reflects recency.
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string;
      this.#entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}
