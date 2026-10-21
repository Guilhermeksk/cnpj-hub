/** Base class for every error thrown by cnpj-hub. */
export class CnpjHubError extends Error {
  override readonly name: string = 'CnpjHubError';
}

/** The input is not a structurally valid CNPJ (wrong length, characters or check digits). */
export class InvalidCnpjError extends CnpjHubError {
  override readonly name = 'InvalidCnpjError';

  constructor(readonly input: string) {
    super(`CNPJ inválido: "${input}"`);
  }
}

/** The CNPJ is valid but no provider has a record for it. */
export class CnpjNotFoundError extends CnpjHubError {
  override readonly name = 'CnpjNotFoundError';

  constructor(
    readonly cnpj: string,
    readonly provider?: string,
  ) {
    super(`CNPJ ${cnpj} não encontrado${provider ? ` (${provider})` : ''}`);
  }
}

export interface ProviderErrorOptions {
  provider: string;
  message: string;
  status?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

/** A single provider failed (network error, timeout, rate limit, bad payload...). */
export class ProviderError extends CnpjHubError {
  override readonly name = 'ProviderError';
  readonly provider: string;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(options: ProviderErrorOptions) {
    super(`[${options.provider}] ${options.message}`, { cause: options.cause });
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Every configured provider failed and at least one failure was not a "not found". */
export class AllProvidersFailedError extends CnpjHubError {
  override readonly name = 'AllProvidersFailedError';

  constructor(
    readonly cnpj: string,
    readonly errors: Array<ProviderError | CnpjNotFoundError>,
  ) {
    super(
      `Nenhum provedor conseguiu consultar o CNPJ ${cnpj}: ${errors.map((e) => e.message).join('; ')}`,
    );
  }
}
