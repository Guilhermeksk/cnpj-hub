#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { main } from './cli/main.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

main(process.argv.slice(2), process, version).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
