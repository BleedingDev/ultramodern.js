import { execFile } from 'node:child_process';
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

// Async sibling of run() for call sites that need real subprocess
// concurrency; spawnSync blocks the event loop, so a pool built on run()
// executes strictly serially. maxBuffer covers `npm pack --json` /
// `npm view --json` output captured by the registry cohort proof.
function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd || repoRoot,
        env: createProcessEnv(options.env || {}),
        encoding: 'utf-8',
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(new Error(`Command failed: ${[command, ...args].join(' ')}`));
          return;
        }
        resolve(stdout?.trim() ?? '');
      },
    );
  });
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

export { createCleanPnpmDlxEnv, roundDurationMs, run, runAsync };
