// Consumer: publish-bleedingdev.yml cohort staging and registry operations.
import { execFileSync } from 'node:child_process';
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { run, sleep };
