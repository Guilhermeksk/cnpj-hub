import type { LookupResult } from '../client.js';

const COLUMNS = [
  'input',
  'cnpj',
  'razao_social',
  'nome_fantasia',
  'situacao',
  'abertura',
  'porte',
  'cnae_principal',
  'atividade_principal',
  'municipio',
  'uf',
  'cep',
  'telefone',
  'email',
  'simples',
  'mei',
  'fonte',
  'erro',
] as const;

/** Serializes lookup results as RFC 4180 CSV — one row per input, failures included. */
export function toCsv(results: LookupResult[]): string {
  const rows = results.map((result) => {
    if (!result.ok) {
      return COLUMNS.map((col) =>
        col === 'input' ? result.input : col === 'erro' ? result.error.message : '',
      );
    }
    const c = result.company;
    return [
      result.input,
      c.cnpj,
      c.legalName,
      c.tradeName,
      c.status,
      c.openedAt,
      c.size,
      c.mainActivity?.code,
      c.mainActivity?.description,
      c.address.city,
      c.address.state,
      c.address.zipCode,
      c.phones[0],
      c.email,
      c.simples === null ? '' : c.simples ? 'sim' : 'não',
      c.mei === null ? '' : c.mei ? 'sim' : 'não',
      c.source,
      '',
    ];
  });
  return `${[COLUMNS, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

function cell(value: string | null | undefined): string {
  const v = value ?? '';
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
