#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configListPath = join(repoRoot, 'scripts/tsgo-critical.txt');
const tsgoBin =
  process.env.TSGO_BIN || join(repoRoot, 'node_modules/.bin/tsgo');

if (!existsSync(tsgoBin)) {
  console.error(
    `tsgo binary not found at ${tsgoBin}. Run pnpm install or set TSGO_BIN.`,
  );
  process.exit(1);
}

const configs = readFileSync(configListPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

const failures = [];

for (const config of configs) {
  const started = performance.now();
  const result = spawnSync(
    tsgoBin,
    ['--noEmit', '--pretty', 'false', '-p', config],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const durationMs = Math.round(performance.now() - started);
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

  if (result.status === 0) {
    console.log(`PASS ${config} (${durationMs}ms)`);
    continue;
  }

  console.error(`FAIL ${config} (${durationMs}ms)`);
  if (output) {
    console.error(output);
  }
  failures.push(config);
}

if (failures.length > 0) {
  console.error(
    `tsgo critical validation failed: ${failures.length} config(s)`,
  );
  process.exit(1);
}

console.log(`tsgo critical validation passed: ${configs.length} config(s)`);
