// Operational browser provisioning for the acceptance and qualification jobs.
//
// This module is deliberately non-reporting: it writes no acceptance evidence,
// contributes no check or result id, and nothing in a receipt reads it. Its
// only job is to place the browsers where the runtime that drives them expects
// them and to report the exact playwright version that keys their cache, so no
// workflow names a playwright version or an installer of its own.
//
// The two browser runtimes are versioned independently, so they resolve and
// key independently and a bump to one never invalidates the other's cache:
//   * `smoke` is the ERP browser-smoke runtime, pinned by the exact
//     `browserSmokePlaywrightPackage` specifier.
//   * `qualification` is the playwright the rstest browser fixture resolves
//     from the frozen workspace lockfile, which plugin-runtime's
//     boundary-debugger suite drives through its own node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { ensureBrowserSmokeRuntime } from './browser-smoke.mjs';
import {
  browserSmokePlaywrightPackage,
  readJsonFile,
  repoRoot,
} from './constants.mjs';
import { run } from './process.mjs';

const playwrightVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const exactPlaywrightSpecPattern =
  /^playwright@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u;
const installedBrowsers = Object.freeze(['chromium']);
const acceptanceBrowserTargets = Object.freeze(['qualification', 'smoke']);
const qualificationRuntimeDir = path.join(
  repoRoot,
  'tests/integration/rstest/basic-app-rstest-browser',
);

function assertExactPlaywrightVersion(version, subject) {
  if (typeof version !== 'string' || !playwrightVersionPattern.test(version)) {
    throw new Error(
      `${subject} must be an exact playwright version, found ${String(version)}`,
    );
  }
  return version;
}

function installedPlaywrightVersion(runtimeDir, readJsonFileImpl) {
  const manifestPath = path.join(
    runtimeDir,
    'node_modules/playwright/package.json',
  );
  let manifest;
  try {
    manifest = readJsonFileImpl(manifestPath);
  } catch (cause) {
    throw new Error(`Playwright runtime is not installed at ${manifestPath}`, {
      cause,
    });
  }
  return assertExactPlaywrightVersion(manifest?.version, manifestPath);
}

// The installer is the resolved runtime's own binary, never an ad-hoc
// download, so the browsers it writes belong to the playwright that will
// launch them.
function acceptanceBrowserExecutable(runtimeDir) {
  return path.join(
    runtimeDir,
    'node_modules/.bin',
    process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
  );
}

// Pure by construction for the pinned smoke specifier and a plain manifest
// read for the qualification runtime the frozen workspace install already
// materialized: resolving a cache key never installs anything or touches the
// network. Only a non-exact override has to materialize the runtime to learn
// what it resolved to.
function resolveAcceptanceBrowserVersion(
  target,
  {
    ensureBrowserSmokeRuntimeImpl = ensureBrowserSmokeRuntime,
    playwrightPackage = browserSmokePlaywrightPackage,
    readJsonFileImpl = readJsonFile,
  } = {},
) {
  if (target === 'qualification') {
    return installedPlaywrightVersion(
      qualificationRuntimeDir,
      readJsonFileImpl,
    );
  }
  const exactSpec = exactPlaywrightSpecPattern.exec(playwrightPackage);
  if (exactSpec) {
    return exactSpec[1];
  }
  return installedPlaywrightVersion(
    ensureBrowserSmokeRuntimeImpl(),
    readJsonFileImpl,
  );
}

// Derived from a resolved runtime version, never from a workflow literal or a
// whole-lockfile hash: the key changes exactly when that runtime's playwright
// changes, and the two independently versioned runtimes never share a key.
function acceptanceBrowserCacheKey({ runnerOs, target, version }) {
  assertExactPlaywrightVersion(version, 'Acceptance browser cache key');
  if (!acceptanceBrowserTargets.includes(target)) {
    throw new Error(
      `Acceptance browser target must be ${acceptanceBrowserTargets.join(' or ')}, found ${String(target)}`,
    );
  }
  if (typeof runnerOs !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(runnerOs)) {
    throw new Error(
      `Acceptance browser cache key requires a simple runner OS name, found ${String(runnerOs)}`,
    );
  }
  return `playwright-${target}-${installedBrowsers.join('-')}-${version}-${runnerOs}`;
}

// OS packages live outside the cached browser directory, so install-deps runs
// on every job; only the browser download itself is cacheable.
function acceptanceBrowserInstallArgs(cacheHit) {
  return cacheHit
    ? ['install-deps', ...installedBrowsers]
    : ['install', '--with-deps', ...installedBrowsers];
}

function installAcceptanceBrowsers(
  { cacheHit = false, target, version },
  {
    ensureBrowserSmokeRuntimeImpl = ensureBrowserSmokeRuntime,
    readJsonFileImpl = readJsonFile,
    runImpl = run,
  } = {},
) {
  const runtimeDir =
    target === 'qualification'
      ? qualificationRuntimeDir
      : ensureBrowserSmokeRuntimeImpl();
  // Fail closed if the materialized runtime is not the version that keyed the
  // cache; otherwise a cache hit could be restored for browsers this runtime
  // cannot launch.
  const installedVersion = installedPlaywrightVersion(
    runtimeDir,
    readJsonFileImpl,
  );
  if (installedVersion !== version) {
    throw new Error(
      `Provisioned playwright ${installedVersion} is not the ${String(version)} that keyed the browser cache`,
    );
  }
  runImpl(
    acceptanceBrowserExecutable(runtimeDir),
    acceptanceBrowserInstallArgs(cacheHit),
    { cwd: runtimeDir },
  );
  return {
    browsers: [...installedBrowsers],
    cacheHit,
    target,
    version: installedVersion,
  };
}

function parseProvisionArgs(argv) {
  const options = { cacheHit: false, install: false, resolve: false };
  const seen = new Set();
  let target;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (seen.has(argument)) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    seen.add(argument);
    if (argument === '--cache-hit' || argument === '--target') {
      const value = argv[index + 1];
      index += 1;
      if (argument === '--target') {
        if (!acceptanceBrowserTargets.includes(value)) {
          throw new Error(
            `--target requires ${acceptanceBrowserTargets.join(' or ')}`,
          );
        }
        target = value;
        continue;
      }
      if (value !== 'true' && value !== 'false') {
        throw new Error('--cache-hit requires true or false');
      }
      options.cacheHit = value === 'true';
      continue;
    }
    if (argument !== '--resolve' && argument !== '--install') {
      throw new Error(`Unknown argument: ${argument}`);
    }
    options[argument === '--resolve' ? 'resolve' : 'install'] = true;
  }
  if (options.resolve === options.install) {
    throw new Error(
      'Browser provisioning requires exactly one of --resolve or --install',
    );
  }
  if (options.resolve && seen.has('--cache-hit')) {
    throw new Error('--cache-hit applies only to --install');
  }
  if (target === undefined) {
    throw new Error(
      `Browser provisioning requires --target ${acceptanceBrowserTargets.join(' or ')}`,
    );
  }
  return { ...options, target };
}

function provisionAcceptanceBrowsers(
  argv = process.argv.slice(2),
  {
    environment = process.env,
    installAcceptanceBrowsersImpl = installAcceptanceBrowsers,
    resolveAcceptanceBrowserVersionImpl = resolveAcceptanceBrowserVersion,
    writeOutput = (name, value) => {
      if (environment.GITHUB_OUTPUT) {
        fs.appendFileSync(environment.GITHUB_OUTPUT, `${name}=${value}\n`);
      }
    },
  } = {},
) {
  const options = parseProvisionArgs(argv);
  const version = resolveAcceptanceBrowserVersionImpl(options.target);
  if (options.install) {
    return installAcceptanceBrowsersImpl({
      cacheHit: options.cacheHit,
      target: options.target,
      version,
    });
  }
  const cacheKey = acceptanceBrowserCacheKey({
    runnerOs: environment.RUNNER_OS ?? process.platform,
    target: options.target,
    version,
  });
  writeOutput('cache_key', cacheKey);
  writeOutput('version', version);
  return { cacheKey, version };
}

export {
  acceptanceBrowserCacheKey,
  acceptanceBrowserInstallArgs,
  acceptanceBrowserTargets,
  installAcceptanceBrowsers,
  parseProvisionArgs,
  provisionAcceptanceBrowsers,
  qualificationRuntimeDir,
  resolveAcceptanceBrowserVersion,
};
