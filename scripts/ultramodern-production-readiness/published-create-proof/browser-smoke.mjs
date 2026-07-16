import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  browserSmokePlaywrightPackage,
  browserSmokeScript,
  readJsonFile,
  repoRoot,
} from './constants.mjs';
import { run } from './process.mjs';

function playwrightRuntimeDir() {
  const digest = crypto
    .createHash('sha256')
    .update(browserSmokePlaywrightPackage)
    .digest('hex')
    .slice(0, 12);
  return path.join(os.tmpdir(), `ultramodern-browser-smoke-${digest}`);
}

function ensureBrowserSmokeRuntime() {
  const runtimeDir = playwrightRuntimeDir();
  const packageJsonPath = path.join(
    runtimeDir,
    'node_modules/playwright/package.json',
  );
  if (fs.existsSync(packageJsonPath)) {
    return runtimeDir;
  }

  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      browserSmokePlaywrightPackage,
    ],
    { cwd: runtimeDir },
  );
  return runtimeDir;
}

function runBrowserSmoke(projectDir, { mode, requirePublicUrls = false }) {
  const artifactDir = `.modern/production-readiness/browser-smoke/${mode}`;
  const out = `.modern/production-readiness/browser-smoke/${mode}-summary.json`;
  const runtimeDir = ensureBrowserSmokeRuntime();
  const args = [
    'node',
    browserSmokeScript,
    '--project-dir',
    projectDir,
    '--artifact-dir',
    artifactDir,
    '--out',
    out,
    '--mode',
    mode,
  ];

  if (mode === 'local') {
    args.push('--shell-runtime', 'workerd');
  }

  if (requirePublicUrls) {
    args.push('--require-public-urls');
  }

  run(args[0], args.slice(1), {
    env: {
      // Acceptance installs the generated workspace with CI=true. Keep pnpm's
      // install-mode defaults identical when the smoke runner starts package
      // scripts, including enableGlobalVirtualStore on pnpm 11.
      CI: 'true',
      ULTRAMODERN_BROWSER_SMOKE_PLAYWRIGHT_ROOT: runtimeDir,
    },
  });
  return readJsonFile(path.resolve(repoRoot, out));
}

export { ensureBrowserSmokeRuntime, playwrightRuntimeDir, runBrowserSmoke };
