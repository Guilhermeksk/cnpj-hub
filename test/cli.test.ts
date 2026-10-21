import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { extractCnpjs, type Io, main } from '../src/cli/main.js';
import { CnpjHub } from '../src/client.js';
import { isValid } from '../src/cnpj.js';
import { CnpjNotFoundError } from '../src/errors.js';
import { fakeProvider, makeCompany, VALID_CNPJ } from './helpers.js';

const MISSING = '98765432000198';

function sink() {
  const stream = {
    text: '',
    isTTY: false,
    write(chunk: string) {
      stream.text += chunk;
      return true;
    },
  };
  return stream;
}

function run(argv: string[], stdinText?: string) {
  const stdout = sink();
  const stderr = sink();
  const stdin = Object.assign(Readable.from(stdinText === undefined ? [] : [stdinText]), {
    isTTY: stdinText === undefined,
  });
  const provider = fakeProvider('fake', async (cnpj) => {
    if (cnpj === MISSING) throw new CnpjNotFoundError(cnpj, 'fake');
    return makeCompany({ cnpj, legalName: `EMPRESA ${cnpj}` });
  });
  const io = {
    stdout,
    stderr,
    stdin,
    env: {},
    createHub: (options) => new CnpjHub({ ...options, providers: [provider], cache: false }),
  } satisfies Io;
  return main(argv, io, '9.9.9').then((code) => ({ code, out: stdout.text, err: stderr.text }));
}

describe('cli', () => {
  it('prints help and version', async () => {
    assert.match((await run([])).out, /Uso:/);
    assert.match((await run(['--help'])).out, /cnpj-hub batch/);
    assert.equal((await run(['--version'])).out, '9.9.9\n');
  });

  it('exits with 2 on unknown flags', async () => {
    const { code, err } = await run(['--nope']);
    assert.equal(code, 2);
    assert.match(err, /--help/);
  });

  it('validate reports each CNPJ and fails when any is invalid', async () => {
    const good = await run(['validate', '11222333000181', '12ABC34501DE35']);
    assert.equal(good.code, 0);
    assert.match(good.out, /11\.222\.333\/0001-81/);
    assert.match(good.out, /12\.ABC\.345\/01DE-35/);

    const bad = await run(['validate', '11222333000181', '123', '--json']);
    assert.equal(bad.code, 1);
    assert.deepEqual(
      JSON.parse(bad.out).map((r: { valid: boolean }) => r.valid),
      [true, false],
    );
  });

  it('format prints formatted CNPJs and errors on invalid input', async () => {
    assert.equal((await run(['format', '11222333000181'])).out, '11.222.333/0001-81\n');
    const bad = await run(['format', '123']);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /inválido/);
  });

  it('generate prints valid CNPJs', async () => {
    const { out } = await run(['generate', '-n', '3', '--alpha', '--json']);
    const lines = out.trim().split('\n');
    assert.equal(lines.length, 3);
    for (const line of lines) assert.ok(isValid(line), line);
  });

  it('looks up a CNPJ with pretty and JSON output', async () => {
    const pretty = await run([VALID_CNPJ]);
    assert.equal(pretty.code, 0);
    assert.match(pretty.out, /EMPRESA 11222333000181/);
    assert.match(pretty.out, /11\.222\.333\/0001-81 \(MATRIZ\)/);

    const json = await run(['lookup', VALID_CNPJ, '--json']);
    assert.equal(JSON.parse(json.out).cnpj, VALID_CNPJ);

    const missing = await run([MISSING]);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /não encontrado/);
  });

  it('batch reads stdin and writes CSV, one row per input', async () => {
    const input = `# leads\n${VALID_CNPJ}\n${MISSING}, 123\n`;
    const { code, out, err } = await run(['batch', '-o', 'csv'], input);
    const rows = out.trim().split('\r\n');
    assert.equal(code, 1);
    assert.equal(rows.length, 4);
    assert.match(rows[0] ?? '', /^input,cnpj,razao_social/);
    assert.match(rows[1] ?? '', /^11222333000181,11222333000181,EMPRESA 11222333000181/);
    assert.match(rows[2] ?? '', /não encontrado/);
    assert.match(err, /1 encontrados, 2 com erro/);
  });

  it('batch writes JSON lines by default', async () => {
    const { code, out } = await run(['batch'], VALID_CNPJ);
    assert.equal(code, 0);
    assert.equal(JSON.parse(out.trim()).cnpj, VALID_CNPJ);
  });

  it('rejects bad option values', async () => {
    const strategy = await run([VALID_CNPJ, '--strategy', 'yolo']);
    assert.equal(strategy.code, 1);
    assert.match(strategy.err, /--strategy/);
    const output = await run(['batch', '-o', 'xml'], VALID_CNPJ);
    assert.equal(output.code, 1);
    assert.match((await run(['batch'])).err, /arquivo/);
  });
});

describe('extractCnpjs', () => {
  it('pulls tokens from lines, CSV cells and quotes while skipping comments', () => {
    assert.deepEqual(
      extractCnpjs('# header\n11.222.333/0001-81\r\n"00000000000191";x\n\n  # nada'),
      ['11.222.333/0001-81', '00000000000191', 'x'],
    );
  });
});
