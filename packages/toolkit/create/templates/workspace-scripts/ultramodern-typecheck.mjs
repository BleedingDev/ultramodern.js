#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
} from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const workspaceRoot = process.env.ULTRAMODERN_WORKSPACE_ROOT
  ? resolve(process.env.ULTRAMODERN_WORKSPACE_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), '..');
const cpuCount = Math.max(
  1,
  typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length,
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    fail(`${label} must be a positive integer.`);
  }
  return parsed;
}

function envPositiveInt(name, fallback) {
  const value = process.env[name]?.trim();
  return value ? parsePositiveInt(value, name) : fallback;
}

function readArgs() {
  let buildTarget;
  let projectTarget;
  let checkers;
  let builders;
  const passthrough = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--') {
      passthrough.push(...args.slice(index + 1));
      break;
    }

    if (arg === '--build' || arg === '-b') {
      buildTarget = next && !next.startsWith('-') ? next : 'tsconfig.json';
      if (buildTarget === next) {
        index += 1;
      }
      continue;
    }

    if (arg === '--project' || arg === '-p') {
      if (!next || next.startsWith('-')) {
        fail(`${arg} requires a tsconfig path.`);
      }
      projectTarget = next;
      index += 1;
      continue;
    }

    if (arg === '--checkers') {
      if (!next || next.startsWith('-')) {
        fail('--checkers requires a positive integer.');
      }
      checkers = parsePositiveInt(next, '--checkers');
      index += 1;
      continue;
    }

    if (arg === '--builders') {
      if (!next || next.startsWith('-')) {
        fail('--builders requires a positive integer.');
      }
      builders = parsePositiveInt(next, '--builders');
      index += 1;
      continue;
    }

    passthrough.push(arg);
  }

  if (buildTarget && projectTarget) {
    fail('Choose either --build or --project, not both.');
  }

  return {
    mode: buildTarget ? 'build' : 'project',
    target: buildTarget ?? projectTarget ?? 'tsconfig.json',
    checkers,
    builders,
    passthrough,
  };
}

function resolveTsgoBinary() {
  const explicitBinary = process.env.EFFECT_TSGO_BIN || process.env.TSGO_BIN;
  if (explicitBinary) {
    return explicitBinary;
  }

  const cli = process.env.EFFECT_TSGO_CLI || 'effect-tsgo';
  const result = spawnSync(cli, ['get-exe-path'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    fail(
      `Unable to run ${cli}. Run pnpm install or set EFFECT_TSGO_BIN to a TS-Go binary.`,
    );
  }
  if (result.status !== 0) {
    fail(
      result.stderr?.trim() ||
        `${cli} get-exe-path exited with status ${result.status}.`,
    );
  }

  return result.stdout.trim() || cli;
}

const parsed = readArgs();
const defaultBuilders = Math.min(8, Math.max(1, Math.floor(cpuCount / 2)));
const builders =
  parsed.builders ??
  envPositiveInt('ULTRAMODERN_TSGO_BUILDERS', defaultBuilders);
const defaultCheckers =
  parsed.mode === 'build'
    ? Math.min(4, Math.max(1, Math.floor(cpuCount / builders)))
    : Math.min(8, Math.max(2, cpuCount - 1));
const checkers =
  parsed.checkers ??
  envPositiveInt('ULTRAMODERN_TSGO_CHECKERS', defaultCheckers);
const tsgoBin = resolveTsgoBinary();

if (!existsSync(tsgoBin)) {
  fail(`TS-Go binary not found at ${tsgoBin}. Run pnpm install.`);
}

try {
  accessSync(tsgoBin, constants.X_OK);
} catch {
  chmodSync(tsgoBin, 0o755);
}

mkdirSync(join(workspaceRoot, 'node_modules/.cache/tsgo'), {
  recursive: true,
});

const tsgoArgs =
  parsed.mode === 'build'
    ? [
        '--build',
        parsed.target,
        '--pretty',
        'false',
        '--checkers',
        String(checkers),
        '--builders',
        String(builders),
        '--stopBuildOnErrors',
        ...parsed.passthrough,
      ]
    : [
        '--project',
        parsed.target,
        '--noEmit',
        '--pretty',
        'false',
        '--checkers',
        String(checkers),
        ...parsed.passthrough,
      ];

const result = spawnSync(tsgoBin, tsgoArgs, {
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
