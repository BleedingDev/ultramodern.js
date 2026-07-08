import { execFileSync, spawn } from 'node:child_process';
import processKit from '../../../lib/process-kit.js';
import { repoRoot } from './constants.mjs';

const { runCommand } = processKit;

function run(command, args, options = {}) {
  const result = runCommand(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.stdio ?? 'inherit',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.exitCode}`,
    );
  }
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: options.captureOutput
        ? ['ignore', 'pipe', 'pipe']
        : (options.stdio ?? 'inherit'),
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    });

    const stdout = [];
    const stderr = [];
    if (options.captureOutput) {
      child.stdout?.on('data', chunk => {
        stdout.push(chunk);
        process.stdout.write(chunk);
      });
      child.stderr?.on('data', chunk => {
        stderr.push(chunk);
        process.stderr.write(chunk);
      });
    }

    child.on('error', reject);
    child.on('close', status => {
      if (status === 0) {
        resolve();
        return;
      }

      const error = new Error(
        `${command} ${args.join(' ')} failed with ${status}`,
      );
      error.status = status;
      error.stdout = Buffer.concat(stdout).toString('utf-8');
      error.stderr = Buffer.concat(stderr).toString('utf-8');
      reject(error);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { run, runAsync, sleep };
