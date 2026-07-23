import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  boundCombinedLogTail,
  formatFailureWithLogEvidence,
} from '../browser-smoke/log-tail.mjs';
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

function createBrowserSmokeEnvironment(runtimeDir, packageManagerEnv = {}) {
  return {
    ...packageManagerEnv,
    // Acceptance installs the generated workspace with CI=true. Keep pnpm's
    // install-mode defaults identical when the smoke runner starts package
    // scripts, including enableGlobalVirtualStore on pnpm 11.
    CI: 'true',
    MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: undefined,
    // Exact-artifact acceptance must load plugin-bff from the generated
    // workspace cohort, never from the repository that launched acceptance.
    ULTRAMODERN_CREATE_BIN: undefined,
    ULTRAMODERN_BROWSER_SMOKE_PLAYWRIGHT_ROOT: runtimeDir,
    // Acceptance proves builds without a Zephyr account or upload side effect.
    ZE_CI_TOKEN: undefined,
  };
}

function runBrowserSmoke(
  projectDir,
  {
    artifactMode,
    mode,
    packageManagerEnv,
    platform,
    requirePublicUrls = false,
    shellRuntime,
  },
  {
    ensureBrowserSmokeRuntimeImpl = ensureBrowserSmokeRuntime,
    readJsonFileImpl = readJsonFile,
    runImpl = run,
  } = {},
) {
  const releaseAcceptanceMode = artifactMode ?? mode;
  const executionMode = ['source', 'published'].includes(mode) ? 'local' : mode;
  const runtimePlatform =
    platform ??
    shellRuntime ??
    (executionMode === 'local' ? 'workerd' : 'public');
  const artifactKey = `${releaseAcceptanceMode}-${runtimePlatform}`;
  const artifactDir = `.modern/production-readiness/browser-smoke/${artifactKey}`;
  const out = `.modern/production-readiness/browser-smoke/${artifactKey}-summary.json`;
  const runtimeDir = ensureBrowserSmokeRuntimeImpl();
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
    executionMode,
  ];

  if (['source', 'published'].includes(releaseAcceptanceMode)) {
    args.push(
      '--artifact-mode',
      releaseAcceptanceMode,
      '--platform',
      runtimePlatform,
    );
  }

  if (executionMode === 'local') {
    args.push('--shell-runtime', shellRuntime ?? platform ?? 'workerd');
  }

  if (requirePublicUrls) {
    args.push('--require-public-urls');
  }

  const reportPath = path.resolve(repoRoot, out);
  fs.rmSync(reportPath, { force: true });
  try {
    runImpl(args[0], args.slice(1), {
      env: createBrowserSmokeEnvironment(runtimeDir, packageManagerEnv),
    });
  } catch (cause) {
    if (!fs.existsSync(reportPath) && readJsonFileImpl === readJsonFile) {
      throw cause;
    }
    const report = readJsonFileImpl(reportPath);
    const details =
      report?.errorDetails && typeof report.errorDetails === 'object'
        ? {
            ...report.errorDetails,
            ...(report.errorDetails.logTail
              ? {
                  logTail: boundCombinedLogTail(report.errorDetails.logTail),
                }
              : {}),
            reportPath,
          }
        : { reportPath };
    const error = new Error(
      formatFailureWithLogEvidence(
        report?.error ||
          (cause instanceof Error ? cause.message : String(cause)),
        details,
      ),
      { cause },
    );
    error.name = 'BrowserSmokeAcceptanceError';
    error.details = details;
    throw error;
  }
  const report = readJsonFileImpl(reportPath);
  if (['source', 'published'].includes(releaseAcceptanceMode)) {
    return {
      ...report,
      artifactMode: releaseAcceptanceMode,
      platform: runtimePlatform,
    };
  }
  return report;
}

export {
  createBrowserSmokeEnvironment,
  ensureBrowserSmokeRuntime,
  playwrightRuntimeDir,
  runBrowserSmoke,
};
