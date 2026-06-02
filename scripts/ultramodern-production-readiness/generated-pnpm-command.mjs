import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);

function commandExists(command) {
  return (
    spawnSync(command, ['--version'], {
      encoding: 'utf-8',
      stdio: 'ignore',
    }).status === 0
  );
}

function generatedPnpmCommand(projectDir, args) {
  if (
    fs.existsSync(path.join(projectDir, '.mise.toml')) &&
    commandExists('mise')
  ) {
    return {
      args: ['exec', '-y', '-C', projectDir, '--', 'pnpm', ...args],
      command: 'mise',
      cwd: repoRoot,
    };
  }

  return {
    args,
    command: 'pnpm',
    cwd: projectDir,
  };
}

export { commandExists, generatedPnpmCommand };
