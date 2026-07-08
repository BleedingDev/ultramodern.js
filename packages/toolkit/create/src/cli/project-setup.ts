import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export function runSetupCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    stdio?: 'ignore' | 'inherit';
    timeoutMs?: number;
  } = {},
) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf-8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
  });
}

export function commandExists(command: string): boolean {
  try {
    runSetupCommand(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function assertGitAvailableForGeneratedProject() {
  if (commandExists('git')) {
    return;
  }

  throw new Error(
    'Git is required for UltraModern setup. Install git yourself (for example "brew install git" or "sudo apt-get install git") and rerun create. This tool never installs system packages on your behalf.',
  );
}

function isInsideGitWorkTree(targetDir: string): boolean {
  try {
    return (
      runSetupCommand('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: targetDir,
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
}

export function initializeGeneratedGitRepository(targetDir: string) {
  assertGitAvailableForGeneratedProject();
  if (isInsideGitWorkTree(targetDir)) {
    return;
  }

  try {
    runSetupCommand('git', ['init', '-b', 'main'], {
      cwd: targetDir,
      stdio: 'inherit',
    });
  } catch {
    runSetupCommand('git', ['init'], { cwd: targetDir, stdio: 'inherit' });
    runSetupCommand('git', ['branch', '-M', 'main'], {
      cwd: targetDir,
      stdio: 'inherit',
    });
  }
}

export function isDirectoryEmpty(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  try {
    const files = fs.readdirSync(dirPath);
    return files.length === 0;
  } catch {
    return false;
  }
}
