import path from 'node:path';
import { createProcessEnv, repoRoot, runCommand } from './constants.mjs';

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

function roundDurationMs(value) {
  return Math.round(value * 100) / 100;
}

export { createCleanPnpmDlxEnv, roundDurationMs, run };
