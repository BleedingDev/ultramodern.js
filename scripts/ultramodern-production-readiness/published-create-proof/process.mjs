import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  createProcessEnv,
  readJsonFile,
  repoRoot,
  runCommand,
} from './constants.mjs';

function run(command, args, options = {}) {
  const result = runCommand(command, args, {
    cwd: options.cwd || repoRoot,
    env: createProcessEnv(options.env || {}),
    encoding: 'utf-8',
    stdio: options.stdio || 'inherit',
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(' ')}`);
  }
  return result.stdout?.trim() ?? '';
}

function createCleanPnpmDlxEnv(root) {
  return {
    XDG_CACHE_HOME: path.join(root, 'xdg'),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_store_dir: path.join(root, 'store'),
    pnpm_config_store_dir: path.join(root, 'store'),
  };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return readJsonFile(filePath);
}

function roundDurationMs(value) {
  return Math.round(value * 100) / 100;
}

function timedStep(summary, id, action) {
  const startedAt = performance.now();
  try {
    const value = action();
    summary.timings[id] = {
      status: 'pass',
      durationMs: roundDurationMs(performance.now() - startedAt),
    };
    return value;
  } catch (error) {
    summary.timings[id] = {
      status: 'fail',
      durationMs: roundDurationMs(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  }
}

export {
  createCleanPnpmDlxEnv,
  readJsonIfExists,
  roundDurationMs,
  run,
  timedStep,
};
