import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeCheckDigits,
  format,
  generate,
  isAlphanumeric,
  isValid,
  parse,
  sanitize,
} from '../src/cnpj.js';
import { InvalidCnpjError } from '../src/errors.js';

describe('sanitize', () => {
  it('removes punctuation and whitespace and upper-cases letters', () => {
    assert.equal(sanitize(' 11.222.333/0001-81 '), '11222333000181');
    assert.equal(sanitize('12.abc.345/01de-35'), '12ABC34501DE35');
  });

  it('left-pads numbers with zeros', () => {
    assert.equal(sanitize(191), '00000000000191');
  });
});

describe('isValid', () => {
  for (const cnpj of [
    '00000000000191',
    '00.000.000/0001-91',
    '11222333000181',
    '11.444.777/0001-61',
  ]) {
    it(`accepts numeric CNPJ ${cnpj}`, () => {
      assert.equal(isValid(cnpj), true);
    });
  }

  it('accepts numbers with stripped leading zeros', () => {
    assert.equal(isValid(191), true);
  });

  it('accepts the official alphanumeric example from Receita Federal', () => {
    assert.equal(isValid('12.ABC.345/01DE-35'), true);
    assert.equal(isValid('12abc34501de35'), true);
  });

  const invalid: Array<[string, string]> = [
    ['wrong check digits', '11222333000182'],
    ['wrong alphanumeric check digits', '12ABC34501DE36'],
    ['too short', '1122233300018'],
    ['too long', '112223330001811'],
    ['repeated digits', '11111111111111'],
    ['letters in check digits', '12ABC34501DEAB'],
    ['symbols', '11222333000!81'],
    ['empty', ''],
  ];
  for (const [label, cnpj] of invalid) {
    it(`rejects ${label}`, () => {
      assert.equal(isValid(cnpj), false);
    });
  }
});

describe('computeCheckDigits', () => {
  it('computes digits for numeric and alphanumeric bases', () => {
    assert.equal(computeCheckDigits('112223330001'), '81');
    assert.equal(computeCheckDigits('12ABC34501DE'), '35');
  });

  it('throws on malformed bases', () => {
    assert.throws(() => computeCheckDigits('123'), InvalidCnpjError);
  });
});

describe('format / parse', () => {
  it('formats valid CNPJs', () => {
    assert.equal(format('11222333000181'), '11.222.333/0001-81');
    assert.equal(format('12abc34501de35'), '12.ABC.345/01DE-35');
  });

  it('parse returns the bare CNPJ', () => {
    assert.equal(parse('11.222.333/0001-81'), '11222333000181');
  });

  it('throws InvalidCnpjError for invalid input', () => {
    assert.throws(() => format('123'), InvalidCnpjError);
    assert.throws(() => parse('11222333000182'), /inválido/);
  });
});

describe('isAlphanumeric', () => {
  it('detects letters', () => {
    assert.equal(isAlphanumeric('12.ABC.345/01DE-35'), true);
    assert.equal(isAlphanumeric('11.222.333/0001-81'), false);
  });
});

describe('generate', () => {
  it('generates valid numeric CNPJs', () => {
    for (let i = 0; i < 200; i++) {
      const cnpj = generate();
      assert.match(cnpj, /^\d{14}$/);
      assert.ok(isValid(cnpj), cnpj);
    }
  });

  it('generates valid alphanumeric CNPJs', () => {
    for (let i = 0; i < 200; i++) {
      const cnpj = generate({ alphanumeric: true });
      assert.ok(isAlphanumeric(cnpj), cnpj);
      assert.ok(isValid(cnpj), cnpj);
    }
  });

  it('can format the output', () => {
    assert.match(generate({ formatted: true }), /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
  });
});
