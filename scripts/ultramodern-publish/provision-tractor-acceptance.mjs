// Consumer: ultramodern-tractor-downstream.yml manifest-pinned acceptance install.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pnpmVersionPattern = /^[1-9]\d*\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;

function defaultRun(command, args, options) {
  return spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
  });
}

function requireSuccess(result, label) {
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} exited ${String(result.status)}: ${result.stderr || result.stdout || ''}`,
    );
  }
  return result;
}

export function provisionTractorAcceptance({
  cwd = process.cwd(),
  environment = process.env,
  run = defaultRun,
} = {}) {
  const manifestPath = path.join(
    cwd,
    '.modern/bleedingdev-publish/manifest.json',
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pnpmVersion = manifest.tools?.pnpm;
  if (
    typeof pnpmVersion !== 'string' ||
    !pnpmVersionPattern.test(pnpmVersion)
  ) {
    throw new Error(
      `Release manifest must bind an exact pnpm version, found ${String(pnpmVersion)}`,
    );
  }
  if (
    typeof environment.GITHUB_ENV !== 'string' ||
    environment.GITHUB_ENV.length === 0
  ) {
    throw new Error('GITHUB_ENV is required to bind the verified pnpm');
  }

  const miseTool = `pnpm@${pnpmVersion}`;
  requireSuccess(
    run('mise', ['install', miseTool], { cwd, stdio: 'inherit' }),
    'Manifest pnpm installation',
  );
  const miseWhere = requireSuccess(
    run('mise', ['where', miseTool], { cwd, stdio: 'pipe' }),
    'Manifest pnpm resolution',
  );
  const pnpmRoot = miseWhere.stdout.trim();
  if (!path.isAbsolute(pnpmRoot)) {
    throw new Error(`Manifest pnpm root must be absolute: ${pnpmRoot}`);
  }
  const pnpmExecutable = path.join(pnpmRoot, 'pnpm');
  fs.accessSync(pnpmExecutable, fs.constants.X_OK);

  const actualVersion = requireSuccess(
    run(pnpmExecutable, ['--version'], { cwd, stdio: 'pipe' }),
    'Manifest pnpm version verification',
  ).stdout.trim();
  if (actualVersion !== pnpmVersion) {
    throw new Error(
      `Manifest pnpm resolved ${actualVersion}, expected ${pnpmVersion}`,
    );
  }

  requireSuccess(
    run(
      pnpmExecutable,
      [
        'install',
        '--frozen-lockfile',
        '--ignore-scripts',
        '--filter',
        '@scripts/ultramodern-production-readiness',
      ],
      { cwd, stdio: 'inherit' },
    ),
    'Tractor acceptance runner dependency installation',
  );

  if (/[\r\n]/u.test(pnpmExecutable)) {
    throw new Error('Manifest pnpm executable must not contain a newline');
  }
  fs.appendFileSync(
    environment.GITHUB_ENV,
    `ULTRAMODERN_PNPM_EXECUTABLE=${pnpmExecutable}\n`,
  );
  return { pnpmExecutable, pnpmVersion };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  provisionTractorAcceptance();
}
