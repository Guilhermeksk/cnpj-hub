import type { Provider } from '../types.js';
import { brasilApi } from './brasilapi.js';
import { cnpjWs } from './cnpjws.js';
import { receitaWs } from './receitaws.js';

export { type BrasilApiOptions, brasilApi } from './brasilapi.js';
export { type CnpjWsOptions, cnpjWs } from './cnpjws.js';
export { type ReceitaWsOptions, receitaWs } from './receitaws.js';

export const builtinProviders = {
  brasilapi: brasilApi,
  cnpjws: cnpjWs,
  receitaws: receitaWs,
} as const satisfies Record<string, () => Provider>;

export type BuiltinProviderName = keyof typeof builtinProviders;

/**
 * Default order: BrasilAPI first (no rate limit worth mentioning), then the two
 * providers limited to 3 requests/minute on their free tiers.
 */
export const DEFAULT_PROVIDERS: BuiltinProviderName[] = ['brasilapi', 'cnpjws', 'receitaws'];

export function isBuiltinProvider(name: string): name is BuiltinProviderName {
  return Object.hasOwn(builtinProviders, name);
}
