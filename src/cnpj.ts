import { randomInt } from 'node:crypto';
import { InvalidCnpjError } from './errors.js';

const WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SHAPE = /^[0-9A-Z]{12}\d{2}$/;
const REPEATED = /^(.)\1+$/;
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Removes punctuation and whitespace and upper-cases the input.
 * Numbers are left-padded with zeros, so `191` becomes `00000000000191`.
 */
export function sanitize(input: string | number): string {
  if (typeof input === 'number') return String(Math.trunc(input)).padStart(14, '0');
  return input.toUpperCase().replace(/[\s./-]/g, '');
}

/**
 * Computes the two check digits for a 12-character CNPJ base.
 *
 * Works for both the classic numeric CNPJ and the alphanumeric format adopted by
 * Receita Federal in July 2026 (IN RFB 2.229/2024): each character contributes
 * `charCode - 48`, so digits keep their value and `A` = 17, `B` = 18, ...
 */
export function computeCheckDigits(base: string): string {
  const normalized = sanitize(base);
  if (!/^[0-9A-Z]{12}$/.test(normalized)) throw new InvalidCnpjError(base);
  const first = checkDigit(normalized, WEIGHTS_1);
  const second = checkDigit(normalized + first, WEIGHTS_2);
  return `${first}${second}`;
}

function checkDigit(value: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += (value.charCodeAt(i) - 48) * (weights[i] as number);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Returns `true` when the input is a valid CNPJ (numeric or alphanumeric, formatted or not). */
export function isValid(input: string | number): boolean {
  const cnpj = sanitize(input);
  if (!SHAPE.test(cnpj) || REPEATED.test(cnpj)) return false;
  return computeCheckDigits(cnpj.slice(0, 12)) === cnpj.slice(12);
}

/** Returns `true` when the CNPJ uses the alphanumeric format (contains at least one letter). */
export function isAlphanumeric(input: string | number): boolean {
  return /[A-Z]/.test(sanitize(input));
}

/** Validates and returns the CNPJ as 14 bare characters. Throws {@link InvalidCnpjError}. */
export function parse(input: string | number): string {
  if (!isValid(input)) throw new InvalidCnpjError(String(input));
  return sanitize(input);
}

/** Formats a CNPJ as `XX.XXX.XXX/XXXX-XX`. Throws {@link InvalidCnpjError} if it is not valid. */
export function format(input: string | number): string {
  const c = parse(input);
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export interface GenerateOptions {
  /** Generate an alphanumeric CNPJ. Default: `false`. */
  alphanumeric?: boolean;
  /** Return it formatted (`XX.XXX.XXX/XXXX-XX`). Default: `false`. */
  formatted?: boolean;
}

/** Generates a random valid CNPJ. Useful for tests and fixtures. */
export function generate(options: GenerateOptions = {}): string {
  const alphabet = options.alphanumeric ? ALPHANUMERIC : ALPHANUMERIC.slice(0, 10);
  let cnpj: string;
  do {
    let root = '';
    for (let i = 0; i < 8; i++) root += alphabet[randomInt(alphabet.length)];
    const base = `${root}0001`;
    cnpj = base + computeCheckDigits(base);
  } while (REPEATED.test(cnpj) || (options.alphanumeric && !isAlphanumeric(cnpj)));
  return options.formatted ? format(cnpj) : cnpj;
}
