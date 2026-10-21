import { format } from '../cnpj.js';
import type { Company } from '../types.js';

type Paint = (text: string) => string;

/** The subset of a writable stream the CLI needs (easy to fake in tests). */
export interface Output {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export interface Style {
  bold: Paint;
  dim: Paint;
  green: Paint;
  red: Paint;
  yellow: Paint;
}

/** ANSI colors only for real terminals, honoring the NO_COLOR / FORCE_COLOR conventions. */
export function createStyle(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): Style {
  const enabled = env.FORCE_COLOR ? env.FORCE_COLOR !== '0' : !env.NO_COLOR && !!stream.isTTY;
  const wrap =
    (open: number, close: number): Paint =>
    (text) =>
      enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    green: wrap(32, 39),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
  };
}

export function printCompany(c: Company, out: Output, style: Style): void {
  const statusColor = c.status === 'ATIVA' ? style.green : style.red;
  const address = [
    [c.address.street, c.address.number].filter(Boolean).join(', '),
    c.address.complement,
    c.address.district,
    [c.address.city, c.address.state].filter(Boolean).join('/'),
    c.address.zipCode && `CEP ${c.address.zipCode.replace(/^(\d{5})(\d{3})$/, '$1-$2')}`,
  ]
    .filter(Boolean)
    .join(' — ');

  const rows: Array<[string, string | null | undefined]> = [
    ['CNPJ', `${format(c.cnpj)}${c.branchType ? ` (${c.branchType})` : ''}`],
    ['Nome fantasia', c.tradeName],
    ['Situação', c.status && statusColor(c.status)],
    ['Abertura', c.openedAt],
    ['Natureza', c.legalNature],
    ['Porte', c.size],
    ['Capital social', c.shareCapital === null ? null : formatMoney(c.shareCapital)],
    ['Atividade', c.mainActivity && `${c.mainActivity.code} — ${c.mainActivity.description}`],
    ['Endereço', address],
    ['Telefones', c.phones.join(', ')],
    ['E-mail', c.email],
    ['Simples / MEI', `${yesNo(c.simples)} / ${yesNo(c.mei)}`],
    ['Sócios', c.partners.length ? `${c.partners.length}` : null],
  ];

  out.write(`${style.bold(c.legalName)}\n`);
  for (const [label, value] of rows) {
    if (value) out.write(`  ${style.dim(label.padEnd(15))}${value}\n`);
  }
  for (const p of c.partners.slice(0, 5)) {
    out.write(
      `  ${' '.repeat(15)}${style.dim('•')} ${p.name}${p.role ? style.dim(` (${p.role})`) : ''}\n`,
    );
  }
  if (c.partners.length > 5) {
    out.write(`  ${' '.repeat(15)}${style.dim(`… e mais ${c.partners.length - 5}`)}\n`);
  }
  out.write(`  ${style.dim('Fonte'.padEnd(15))}${style.yellow(c.source)}\n`);
}

function yesNo(value: boolean | null): string {
  return value === null ? '?' : value ? 'sim' : 'não';
}

function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
