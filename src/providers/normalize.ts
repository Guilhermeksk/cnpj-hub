import type { Activity, Company } from '../types.js';

type Nullable<T> = T | null | undefined;

/** Trims, collapses inner whitespace and turns empty strings into `null`. */
export function text(value: Nullable<string | number>): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

export function upper(value: Nullable<string>): string | null {
  return text(value)?.toUpperCase() ?? null;
}

export function digits(value: Nullable<string | number>): string | null {
  const only = text(value)?.replace(/\D/g, '');
  return only ? only : null;
}

export function joinText(...parts: Nullable<string>[]): string | null {
  return text(parts.filter(Boolean).join(' '));
}

/** Accepts `YYYY-MM-DD` or `DD/MM/YYYY` and returns `YYYY-MM-DD`. */
export function isoDate(value: Nullable<string>): string | null {
  const v = text(value);
  if (!v) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return iso ? (iso[1] as string) : null;
}

export function amount(value: Nullable<string | number>): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '.'));
  return Number.isFinite(n) ? n : null;
}

/** Maps `"Sim"`/`"Não"`/booleans to booleans. */
export function yesNo(value: Nullable<string | boolean>): boolean | null {
  if (typeof value === 'boolean') return value;
  const v = text(value)?.toLowerCase();
  if (!v) return null;
  if (v === 'sim' || v === 's' || v === 'true') return true;
  if (v === 'não' || v === 'nao' || v === 'n' || v === 'false') return false;
  return null;
}

export function branchType(value: Nullable<string>): Company['branchType'] {
  const v = upper(value);
  return v === 'MATRIZ' || v === 'FILIAL' ? v : null;
}

export function activity(
  code: Nullable<string | number>,
  description: Nullable<string>,
): Activity | null {
  const c = digits(code);
  const d = text(description);
  if (!c || !d || /^0+$/.test(c)) return null;
  return { code: c.padStart(7, '0'), description: d };
}

export function activities(
  list: Nullable<Array<{ code: Nullable<string | number>; description: Nullable<string> }>>,
): Activity[] {
  return (list ?? [])
    .map((item) => activity(item.code, item.description))
    .filter((item): item is Activity => item !== null);
}

/** Splits strings such as `"(61) 3493-9002 / (61) 3493-1040"` into digit-only numbers. */
export function phones(...values: Nullable<string>[]): string[] {
  const result = new Set<string>();
  for (const value of values) {
    for (const part of String(value ?? '').split('/')) {
      const d = digits(part);
      if (d && d.length >= 10) result.add(d);
    }
  }
  return [...result];
}

/** Removes a leading code such as `"203-8 - "` or `"10-"` from a description. */
export function stripCode(value: Nullable<string>): string | null {
  return text(text(value)?.replace(/^[\d-]+\s*-\s*/, ''));
}

export function email(value: Nullable<string>): string | null {
  return text(value)?.toLowerCase() ?? null;
}
