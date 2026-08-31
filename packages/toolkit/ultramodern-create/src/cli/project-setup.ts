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

  // Stamp an initial commit so the fresh project is a COMPLETE git repository,
  // not a half-initialized one. A build tool such as the Zephyr rspack plugin
  // reads git information and hard-fails in CI (`CI=true`) when there is no
  // HEAD commit, which would make a just-scaffolded project unbuildable in CI
  // out of the box. The `-c user.*` options make the commit succeed even when
  // no global git identity is configured (e.g. clean CI runners), without
  // mutating the user's global config; `--no-verify` skips hooks whose tooling
  // is not installed yet.
  try {
    runSetupCommand('git', ['add', '-A'], {
      cwd: targetDir,
      stdio: 'inherit',
    });
    runSetupCommand(
      'git',
      [
        '-c',
        'user.name=UltraModern',
        '-c',
        'user.email=ultramodern@bleedingdev.dev',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--no-verify',
        '-m',
        'chore: initial UltraModern scaffold',
      ],
      { cwd: targetDir, stdio: 'inherit' },
    );
  } catch {
    // A failed initial commit must never abort scaffolding; the project is
    // still generated and the user can commit themselves.
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
