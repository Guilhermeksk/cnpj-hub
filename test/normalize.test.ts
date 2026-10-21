import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRetryAfter } from '../src/providers/http.js';
import * as n from '../src/providers/normalize.js';

describe('normalize helpers', () => {
  it('text trims, collapses whitespace and nulls empty values', () => {
    assert.equal(n.text('  a   b  '), 'a b');
    assert.equal(n.text('   '), null);
    assert.equal(n.text(undefined), null);
    assert.equal(n.text(42), '42');
  });

  it('isoDate understands both Brazilian and ISO dates', () => {
    assert.equal(n.isoDate('01/08/1966'), '1966-08-01');
    assert.equal(n.isoDate('1966-08-01'), '1966-08-01');
    assert.equal(n.isoDate('2026-10-10T03:00:00.000Z'), '2026-10-10');
    assert.equal(n.isoDate('ontem'), null);
  });

  it('amount parses numbers and numeric strings', () => {
    assert.equal(n.amount('120000000000.00'), 120_000_000_000);
    assert.equal(n.amount(1500), 1500);
    assert.equal(n.amount('abc'), null);
    assert.equal(n.amount(''), null);
  });

  it('yesNo maps Portuguese answers', () => {
    assert.equal(n.yesNo('Sim'), true);
    assert.equal(n.yesNo('Não'), false);
    assert.equal(n.yesNo(false), false);
    assert.equal(n.yesNo('talvez'), null);
    assert.equal(n.yesNo(null), null);
  });

  it('activity normalizes codes to 7 digits and drops empty ones', () => {
    assert.deepEqual(n.activity('64.22-1-00', 'Bancos'), {
      code: '6422100',
      description: 'Bancos',
    });
    assert.deepEqual(n.activity(111301, 'Cultivo de arroz'), {
      code: '0111301',
      description: 'Cultivo de arroz',
    });
    assert.equal(n.activity('00.00-0-00', 'Não informada'), null);
    assert.equal(n.activity('6201501', null), null);
  });

  it('phones splits, strips and de-duplicates numbers', () => {
    assert.deepEqual(n.phones('(61) 3493-9002 / (61) 3493-1040', '6134939002', '', null), [
      '6134939002',
      '6134931040',
    ]);
    assert.deepEqual(n.phones('3493-9002'), []);
  });

  it('stripCode removes leading codes', () => {
    assert.equal(n.stripCode('203-8 - Sociedade de Economia Mista'), 'Sociedade de Economia Mista');
    assert.equal(n.stripCode('10-Diretor'), 'Diretor');
    assert.equal(n.stripCode('Diretor'), 'Diretor');
  });

  it('branchType only accepts MATRIZ/FILIAL', () => {
    assert.equal(n.branchType('Matriz'), 'MATRIZ');
    assert.equal(n.branchType('filial'), 'FILIAL');
    assert.equal(n.branchType('outro'), null);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    assert.equal(parseRetryAfter('2'), 2000);
    assert.equal(
      parseRetryAfter('Wed, 21 Oct 2026 10:00:30 GMT', Date.UTC(2026, 9, 21, 10, 0, 0)),
      30_000,
    );
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter('soon'), undefined);
  });
});
