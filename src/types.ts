/** An economic activity (CNAE). `code` has 7 digits, without punctuation. */
export interface Activity {
  code: string;
  description: string;
}

/** A partner/administrator listed in the company's QSA. */
export interface Partner {
  name: string;
  role: string | null;
  /** ISO date (`YYYY-MM-DD`) the partner joined, when the provider reports it. */
  since: string | null;
}

export interface Address {
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  /** 8 digits, without punctuation. */
  zipCode: string | null;
  city: string | null;
  /** Two-letter state code (UF). */
  state: string | null;
}

/** Company data normalized to the same shape regardless of which provider answered. */
export interface Company {
  /** 14 characters, without punctuation. */
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  /** Registration status, upper-cased (e.g. `ATIVA`, `BAIXADA`, `INAPTA`). */
  status: string | null;
  branchType: 'MATRIZ' | 'FILIAL' | null;
  /** ISO date (`YYYY-MM-DD`). */
  openedAt: string | null;
  legalNature: string | null;
  size: string | null;
  shareCapital: number | null;
  mainActivity: Activity | null;
  secondaryActivities: Activity[];
  address: Address;
  /** Phone numbers with area code, digits only. */
  phones: string[];
  email: string | null;
  simples: boolean | null;
  mei: boolean | null;
  partners: Partner[];
  /** Name of the provider that answered. */
  source: string;
  /** ISO timestamp of when the data was fetched. */
  fetchedAt: string;
}

export interface ProviderContext {
  fetch: typeof fetch;
  signal: AbortSignal;
}

/**
 * A data source. Implementations must resolve with a {@link Company}, throw
 * `CnpjNotFoundError` when the CNPJ does not exist and `ProviderError` for anything else.
 */
export interface Provider {
  readonly name: string;
  lookup(cnpj: string, context: ProviderContext): Promise<Company>;
}
