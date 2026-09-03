// Operational browser provisioning for the ERP acceptance runner.
//
// This module is deliberately non-reporting: it writes no acceptance evidence,
// contributes no check or result id, and nothing in a receipt reads it. Its
// only job is to place the browsers where the shared acceptance runtime
// context expects them, so the workflow never has to name a playwright
// version or installer of its own. The version and the cache key are read back
// from the resolved runtime, so a playwright bump lands in exactly one place.
import fs from 'node:fs';
import path from 'node:path';
import { ensureBrowserSmokeRuntime } from './browser-smoke.mjs';
import { readJsonFile } from './constants.mjs';
import { run } from './process.mjs';

const playwrightVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const installedBrowsers = Object.freeze(['chromium']);

function resolveAcceptanceBrowserRuntime({
  ensureBrowserSmokeRuntimeImpl = ensureBrowserSmokeRuntime,
  readJsonFileImpl = readJsonFile,
} = {}) {
  const runtimeDir = ensureBrowserSmokeRuntimeImpl();
  const manifest = readJsonFileImpl(
    path.join(runtimeDir, 'node_modules/playwright/package.json'),
  );
  const version = manifest?.version;
  if (typeof version !== 'string' || !playwrightVersionPattern.test(version)) {
    throw new Error(
      `Resolved acceptance browser runtime must expose an exact playwright version, found ${String(version)}`,
    );
  }
  return {
    executable: path.join(
      runtimeDir,
      'node_modules/.bin',
      process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
    ),
    runtimeDir,
    version,
  };
}

// Derived from a resolved runtime output, never from a workflow literal: the
// key changes exactly when the installed playwright changes.
function acceptanceBrowserCacheKey({ runnerOs, version }) {
  if (!playwrightVersionPattern.test(String(version))) {
    throw new Error(
      `Acceptance browser cache key requires an exact resolved playwright version, found ${String(version)}`,
    );
  }
  if (typeof runnerOs !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(runnerOs)) {
    throw new Error(
      `Acceptance browser cache key requires a simple runner OS name, found ${String(runnerOs)}`,
    );
  }
  return `playwright-${installedBrowsers.join('-')}-${version}-${runnerOs}`;
}

// OS packages live outside the cached browser directory, so install-deps runs
// on every job; only the browser download itself is cacheable.
function acceptanceBrowserInstallArgs(cacheHit) {
  return cacheHit
    ? ['install-deps', ...installedBrowsers]
    : ['install', '--with-deps', ...installedBrowsers];
}

function installAcceptanceBrowsers(
  { cacheHit = false, runtime },
  { runImpl = run } = {},
) {
  runImpl(runtime.executable, acceptanceBrowserInstallArgs(cacheHit), {
    cwd: runtime.runtimeDir,
  });
  return {
    browsers: [...installedBrowsers],
    cacheHit,
    version: runtime.version,
  };
}

function parseProvisionArgs(argv) {
  const allowed = new Set(['--resolve', '--install', '--cache-hit']);
  const options = { cacheHit: false, install: false, resolve: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!allowed.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (argument === '--cache-hit') {
      const value = argv[index + 1];
      if (value !== 'true' && value !== 'false') {
        throw new Error('--cache-hit requires true or false');
      }
      options.cacheHit = value === 'true';
      index += 1;
      continue;
    }
    options[argument === '--resolve' ? 'resolve' : 'install'] = true;
  }
  if (options.resolve === options.install) {
    throw new Error(
      'Browser provisioning requires exactly one of --resolve or --install',
    );
  }
  return options;
}

function provisionAcceptanceBrowsers(
  argv = process.argv.slice(2),
  {
    environment = process.env,
    installAcceptanceBrowsersImpl = installAcceptanceBrowsers,
    resolveAcceptanceBrowserRuntimeImpl = resolveAcceptanceBrowserRuntime,
    writeOutput = (name, value) => {
      if (environment.GITHUB_OUTPUT) {
        fs.appendFileSync(environment.GITHUB_OUTPUT, `${name}=${value}\n`);
      }
    },
  } = {},
) {
  const options = parseProvisionArgs(argv);
  const runtime = resolveAcceptanceBrowserRuntimeImpl();
  if (options.install) {
    return installAcceptanceBrowsersImpl({
      cacheHit: options.cacheHit,
      runtime,
    });
  }
  const cacheKey = acceptanceBrowserCacheKey({
    runnerOs: environment.RUNNER_OS ?? process.platform,
    version: runtime.version,
  });
  writeOutput('cache_key', cacheKey);
  writeOutput('version', runtime.version);
  return { cacheKey, version: runtime.version };
}

export {
  acceptanceBrowserCacheKey,
  acceptanceBrowserInstallArgs,
  installAcceptanceBrowsers,
  parseProvisionArgs,
  provisionAcceptanceBrowsers,
  resolveAcceptanceBrowserRuntime,
};
