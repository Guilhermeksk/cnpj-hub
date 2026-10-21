import { CnpjHub, type LookupOptions } from './client.js';
import type { Company } from './types.js';

export { type Cache, MemoryCache, type MemoryCacheOptions } from './cache.js';
export {
  CnpjHub,
  type CnpjHubEvent,
  type CnpjHubOptions,
  type LookupManyOptions,
  type LookupOptions,
  type LookupResult,
  type Strategy,
} from './client.js';
export {
  computeCheckDigits,
  format,
  type GenerateOptions,
  generate,
  isAlphanumeric,
  isValid,
  parse,
  sanitize,
} from './cnpj.js';
export {
  AllProvidersFailedError,
  CnpjHubError,
  CnpjNotFoundError,
  InvalidCnpjError,
  ProviderError,
} from './errors.js';
export {
  type BrasilApiOptions,
  type BuiltinProviderName,
  brasilApi,
  builtinProviders,
  type CnpjWsOptions,
  cnpjWs,
  DEFAULT_PROVIDERS,
  type ReceitaWsOptions,
  receitaWs,
} from './providers/index.js';
export { createServer, type ServerOptions } from './server.js';
export type { Activity, Address, Company, Partner, Provider, ProviderContext } from './types.js';

let defaultHub: CnpjHub | undefined;

/** Shortcut that uses a shared {@link CnpjHub} with default options. */
export function lookup(cnpj: string | number, options?: LookupOptions): Promise<Company> {
  defaultHub ??= new CnpjHub();
  return defaultHub.lookup(cnpj, options);
}
