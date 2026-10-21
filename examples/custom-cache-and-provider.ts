// Shows how to plug an external cache (e.g. Redis) and a custom data source.
import { type Cache, CnpjHub, CnpjNotFoundError, type Company, type Provider } from 'cnpj-hub';

/** Anything with get/set — e.g. an `ioredis` or `redis` client. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
}

export function redisCache(redis: RedisLike, prefix = 'cnpj:'): Cache<Company> {
  return {
    async get(cnpj) {
      const raw = await redis.get(prefix + cnpj);
      return raw ? (JSON.parse(raw) as Company) : undefined;
    },
    async set(cnpj, company, ttlMs) {
      await redis.set(prefix + cnpj, JSON.stringify(company), 'PX', ttlMs);
    },
  };
}

/** A provider backed by your own database, queried before the public APIs. */
export function internalDatabase(findByCnpj: (cnpj: string) => Promise<Company | null>): Provider {
  return {
    name: 'internal-db',
    async lookup(cnpj) {
      const company = await findByCnpj(cnpj);
      if (!company) throw new CnpjNotFoundError(cnpj, 'internal-db');
      return company;
    },
  };
}

export function createHub(redis: RedisLike, findByCnpj: (cnpj: string) => Promise<Company | null>) {
  return new CnpjHub({
    providers: [internalDatabase(findByCnpj), 'brasilapi', 'cnpjws', 'receitaws'],
    cache: redisCache(redis),
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  });
}
