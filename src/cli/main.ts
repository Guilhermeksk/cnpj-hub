import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { CnpjHub, type CnpjHubOptions, type LookupResult } from '../client.js';
import { format, generate, isValid } from '../cnpj.js';
import { AllProvidersFailedError, CnpjHubError } from '../errors.js';
import { createServer } from '../server.js';
import type { Company } from '../types.js';
import { toCsv } from './csv.js';
import { createStyle, type Output, printCompany } from './print.js';

export interface Io {
  stdout: Output;
  stderr: Output;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  env: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to `new CnpjHub(options)`. */
  createHub?: (options: CnpjHubOptions) => CnpjHub;
}

export const HELP = `cnpj-hub — consulta de CNPJ com fallback entre provedores

Uso:
  cnpj-hub <cnpj...>                  Consulta um ou mais CNPJs
  cnpj-hub validate <cnpj...>         Valida (sem acessar a rede)
  cnpj-hub format <cnpj...>           Formata como XX.XXX.XXX/XXXX-XX
  cnpj-hub generate [-n 5] [--alpha]  Gera CNPJs válidos para testes
  cnpj-hub batch [arquivo]            Consulta em lote (arquivo ou stdin)
  cnpj-hub serve [--port 3000]        Sobe uma API HTTP

Opções:
  --json                 Saída em JSON
  -o, --output <fmt>     Formato do lote: jsonl (padrão), json ou csv
  -c, --concurrency <n>  Consultas simultâneas no lote (padrão: 3)
  --providers <lista>    Ex.: brasilapi,cnpjws,receitaws
  --strategy <s>         fallback (padrão) ou race
  --timeout <ms>         Tempo limite por requisição (padrão: 10000)
  --retries <n>          Novas tentativas por provedor (padrão: 1)
  -v, --verbose          Mostra cada tentativa no stderr
  -h, --help             Mostra esta ajuda
  --version              Mostra a versão

Exemplos:
  cnpj-hub 00.000.000/0001-91
  cnpj-hub batch leads.txt -o csv > empresas.csv
  cat cnpjs.txt | cnpj-hub batch --strategy race
`;

export async function main(argv: string[], io: Io, version = '0.0.0'): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n\nUse --help para ver as opções.\n`);
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    io.stdout.write(`${version}\n`);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    io.stdout.write(HELP);
    return 0;
  }

  const [first, ...rest] = positionals as [string, ...string[]];
  try {
    switch (first) {
      case 'validate':
        return validateCommand(rest, values.json, io);
      case 'format':
        return formatCommand(rest, io);
      case 'generate':
        return generateCommand(values, io);
      case 'batch':
        return await batchCommand(rest[0], values, io);
      case 'serve':
        return await serveCommand(values, io);
      case 'lookup':
        return await lookupCommand(rest, values, io);
      default:
        return await lookupCommand(positionals, values, io);
    }
  } catch (error) {
    if (error instanceof CnpjHubError || error instanceof TypeError) {
      io.stderr.write(`Erro: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: 'boolean', default: false },
      output: { type: 'string', short: 'o' },
      concurrency: { type: 'string', short: 'c' },
      providers: { type: 'string' },
      strategy: { type: 'string' },
      timeout: { type: 'string' },
      retries: { type: 'string' },
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      count: { type: 'string', short: 'n' },
      alpha: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
  });
}

type Values = ReturnType<typeof parse>['values'];

function buildHub(values: Values, io: Io): CnpjHub {
  const options: CnpjHubOptions = {};
  if (values.providers) options.providers = values.providers.split(',').map((p) => p.trim());
  if (values.strategy) {
    if (values.strategy !== 'fallback' && values.strategy !== 'race') {
      throw new TypeError('--strategy deve ser "fallback" ou "race".');
    }
    options.strategy = values.strategy;
  }
  if (values.timeout) options.timeoutMs = positiveInt(values.timeout, '--timeout');
  if (values.retries) options.retries = positiveInt(values.retries, '--retries', true);
  if (values.verbose) {
    options.onEvent = (event) => {
      if (event.type === 'attempt') {
        io.stderr.write(`→ ${event.provider} (tentativa ${event.attempt}) ${event.cnpj}\n`);
      } else if (event.type === 'success') {
        io.stderr.write(`✔ ${event.provider} ${Math.round(event.durationMs)}ms\n`);
      } else if (event.type === 'failure') {
        io.stderr.write(
          `✖ ${event.error.message}${event.willRetry ? ' — tentando de novo' : ''}\n`,
        );
      } else if (event.type === 'cache-hit') {
        io.stderr.write(`● cache ${event.cnpj}\n`);
      }
    };
  }
  return io.createHub ? io.createHub(options) : new CnpjHub(options);
}

async function lookupCommand(inputs: string[], values: Values, io: Io): Promise<number> {
  if (inputs.length === 0) throw new TypeError('Informe ao menos um CNPJ.');
  const hub = buildHub(values, io);
  const results = await hub.lookupMany(inputs, { concurrency: 3 });

  if (values.json) {
    const payload = results.map((r) =>
      r.ok ? r.company : { input: r.input, error: r.error.message },
    );
    io.stdout.write(`${JSON.stringify(inputs.length === 1 ? payload[0] : payload, null, 2)}\n`);
  } else {
    const style = createStyle(io.stdout, io.env);
    results.forEach((result, i) => {
      if (i > 0) io.stdout.write('\n');
      if (result.ok) printCompany(result.company, io.stdout, style);
      else io.stderr.write(`${describeFailure(result)}\n`);
    });
  }
  return results.every((r) => r.ok) ? 0 : 1;
}

function validateCommand(inputs: string[], json: boolean, io: Io): number {
  if (inputs.length === 0) throw new TypeError('Informe ao menos um CNPJ.');
  const results = inputs.map((input) => ({
    input,
    valid: isValid(input),
    formatted: isValid(input) ? format(input) : null,
  }));
  if (json) {
    io.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    const style = createStyle(io.stdout, io.env);
    for (const r of results) {
      io.stdout.write(
        r.valid
          ? `${style.green('✔')} ${r.formatted}\n`
          : `${style.red('✖')} ${r.input} inválido\n`,
      );
    }
  }
  return results.every((r) => r.valid) ? 0 : 1;
}

function formatCommand(inputs: string[], io: Io): number {
  if (inputs.length === 0) throw new TypeError('Informe ao menos um CNPJ.');
  for (const input of inputs) io.stdout.write(`${format(input)}\n`);
  return 0;
}

function generateCommand(values: Values, io: Io): number {
  const count = values.count ? positiveInt(values.count, '--count') : 1;
  for (let i = 0; i < count; i++) {
    io.stdout.write(`${generate({ alphanumeric: values.alpha, formatted: !values.json })}\n`);
  }
  return 0;
}

async function batchCommand(file: string | undefined, values: Values, io: Io): Promise<number> {
  const output = values.output ?? (values.json ? 'json' : 'jsonl');
  if (!['jsonl', 'json', 'csv'].includes(output)) {
    throw new TypeError('--output deve ser jsonl, json ou csv.');
  }
  if (!file && io.stdin.isTTY) {
    throw new TypeError('Informe um arquivo ou envie os CNPJs pela entrada padrão.');
  }

  const content = file ? await readFile(file, 'utf8') : await readStream(io.stdin);
  const inputs = extractCnpjs(content);
  if (inputs.length === 0) throw new TypeError('Nenhum CNPJ encontrado na entrada.');

  const hub = buildHub(values, io);
  const concurrency = values.concurrency ? positiveInt(values.concurrency, '--concurrency') : 3;
  const results = await hub.lookupMany(inputs, { concurrency });

  if (output === 'csv') {
    io.stdout.write(toCsv(results));
  } else if (output === 'json') {
    io.stdout.write(`${JSON.stringify(results.map(serialize), null, 2)}\n`);
  } else {
    for (const result of results) io.stdout.write(`${JSON.stringify(serialize(result))}\n`);
  }

  const failed = results.filter((r) => !r.ok).length;
  io.stderr.write(`${results.length - failed} encontrados, ${failed} com erro.\n`);
  return failed === 0 ? 0 : 1;
}

async function serveCommand(values: Values, io: Io): Promise<number> {
  const port = values.port ? positiveInt(values.port, '--port', true) : Number(io.env.PORT ?? 3000);
  const host = values.host ?? io.env.HOST ?? '0.0.0.0';
  const server = createServer({ hub: buildHub(values, io) });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  io.stdout.write(
    `cnpj-hub ouvindo em http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`,
  );

  await new Promise<void>((resolve) => {
    const stop = () => server.close(() => resolve());
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

/** Pulls CNPJ-looking tokens from free text (one per line, CSV, comments with `#`). */
export function extractCnpjs(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, ''))
    .flatMap((line) => line.split(/[\s,;]+/))
    .map((token) => token.replace(/^["']|["']$/g, '').trim())
    .filter((token) => /[0-9A-Za-z]/.test(token));
}

function serialize(result: LookupResult): Company | { input: string; error: string } {
  return result.ok ? result.company : { input: result.input, error: result.error.message };
}

function describeFailure(result: Extract<LookupResult, { ok: false }>): string {
  const { error } = result;
  if (error instanceof AllProvidersFailedError) {
    return `✖ ${result.input}: nenhum provedor respondeu\n${error.errors.map((e) => `  - ${e.message}`).join('\n')}`;
  }
  return `✖ ${result.input}: ${error.message}`;
}

function positiveInt(value: string, flag: string, allowZero = false): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1)) {
    throw new TypeError(`${flag} deve ser um inteiro ${allowZero ? 'não negativo' : 'positivo'}.`);
  }
  return n;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}
