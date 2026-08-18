// Consumer: publish-bleedingdev.yml cohort staging and registry operations.
import { execFile } from 'node:child_process';
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

// Async sibling of run() for mutually independent subprocesses; spawnSync
// blocks the event loop, so a batch built on run() executes strictly
// serially. Failures carry the child's captured output because parallel
// lanes cannot share the parent's inherited stdio.
function runAsync(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd ?? repoRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          FORCE_COLOR: '0',
        },
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const output = `${stdout ?? ''}${stderr ?? ''}`.trim();
          rejectPromise(
            new Error(
              `${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`,
            ),
          );
          return;
        }
        resolvePromise(stdout ?? '');
      },
    );
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { run, runAsync, sleep };
