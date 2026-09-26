const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  browserCacheKey,
  browserCachePath,
  browserInstallArgs,
  installBrowsers,
  parseProvisionArgs,
  provisionBrowsers,
} = require('../browser-provisioning');

function makeRuntime(root, name, version) {
  const runtimeDir = path.join(root, name);
  const packageDir = path.join(runtimeDir, 'node_modules/playwright');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ bin: { playwright: 'cli.js' }, name: 'playwright', version }),
  );
  return runtimeDir;
}

function withRuntimes(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-provisioning-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

test('resolve writes the version, cache key and cache path the workflow restores', () =>
  withRuntimes(root => {
    const runtime = makeRuntime(root, 'a', '1.63.0');
    const output = path.join(root, 'github-output');
    const result = provisionBrowsers(['--resolve', '--runtime', runtime], {
      environment: {
        GITHUB_OUTPUT: output,
        PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'browsers'),
        RUNNER_OS: 'Linux',
      },
    });
    assert.deepEqual(result, {
      cache_key: 'playwright-chromium-1.63.0-Linux',
      cache_path: path.join(root, 'browsers'),
      version: '1.63.0',
    });
    assert.equal(
      fs.readFileSync(output, 'utf8'),
      `cache_key=playwright-chromium-1.63.0-Linux\ncache_path=${path.join(root, 'browsers')}\nversion=1.63.0\n`,
    );
  }));

test('runtimes that resolve different playwright versions fail with both paths', () =>
  withRuntimes(root => {
    const a = makeRuntime(root, 'a', '1.63.0');
    const b = makeRuntime(root, 'b', '1.60.0');
    assert.throws(
      () =>
        provisionBrowsers(['--resolve', '--runtime', a, '--runtime', b], {
          environment: { RUNNER_OS: 'Linux' },
        }),
      error =>
        error.message.includes(`${b} resolves playwright 1.60.0`) &&
        error.message.includes(`${a} resolves 1.63.0`),
    );
  }));

test('a runtime without playwright names the missing install', () =>
  withRuntimes(root => {
    assert.throws(
      () =>
        provisionBrowsers(['--resolve', '--runtime', path.join(root, 'none')], {
          environment: { RUNNER_OS: 'Linux' },
        }),
      /Playwright is not installed at .*pnpm install --frozen-lockfile/u,
    );
  }));

test('install spawns the runtime CLI through node on every platform', () =>
  withRuntimes(root => {
    const runtime = makeRuntime(root, 'a', '1.63.0');
    for (const [platform, args] of [
      ['linux', ['install', '--with-deps', 'chromium']],
      ['darwin', ['install', 'chromium']],
      ['win32', ['install', 'chromium']],
    ]) {
      const calls = [];
      installBrowsers(
        { runtimeDirs: [runtime], version: '1.63.0' },
        {
          platform,
          runCommandImpl: (command, commandArgs, options) => {
            calls.push({ command, commandArgs, options });
            return { exitCode: 0 };
          },
        },
      );
      assert.deepEqual(calls, [
        {
          command: process.execPath,
          commandArgs: [
            path.join(runtime, 'node_modules/playwright/cli.js'),
            ...args,
          ],
          options: { cwd: runtime },
        },
      ]);
      assert.deepEqual(browserInstallArgs(platform), args);
    }
  }));

test('install fails closed when the runtime is not the version that keyed the cache', () =>
  withRuntimes(root => {
    const runtime = makeRuntime(root, 'a', '1.63.0');
    assert.throws(
      () =>
        installBrowsers(
          { runtimeDirs: [runtime], version: '1.64.0' },
          {
            runCommandImpl: () => assert.fail('must not spawn the installer'),
          },
        ),
      /Installed playwright 1\.63\.0 .* is not the 1\.64\.0 that keyed the browser cache/u,
    );
  }));

test('install surfaces a failing playwright CLI', () =>
  withRuntimes(root => {
    const runtime = makeRuntime(root, 'a', '1.63.0');
    assert.throws(
      () =>
        installBrowsers(
          { runtimeDirs: [runtime], version: '1.63.0' },
          { platform: 'linux', runCommandImpl: () => ({ exitCode: 3 }) },
        ),
      /playwright install --with-deps chromium failed in .* with exit code 3/u,
    );
  }));

test('argument parsing requires one mode, a runtime and a carried version', () => {
  assert.throws(() => parseProvisionArgs(['--runtime', 'x']), /exactly one/u);
  assert.throws(
    () => parseProvisionArgs(['--resolve', '--install', '--runtime', 'x']),
    /exactly one/u,
  );
  assert.throws(() => parseProvisionArgs(['--resolve']), /requires --runtime/u);
  assert.throws(
    () => parseProvisionArgs(['--install', '--runtime', 'x']),
    /--install requires --version/u,
  );
  assert.throws(
    () =>
      parseProvisionArgs(['--resolve', '--runtime', 'x', '--version', '1.0.0']),
    /--version applies only to --install/u,
  );
  assert.throws(
    () => parseProvisionArgs(['--resolve', '--runtime', 'x', '--cache-hit']),
    /Unknown option '--cache-hit'/u,
  );
});

test('cache key and path follow the playwright version and registry directory', () => {
  assert.throws(
    () => browserCacheKey({ runnerOs: 'Linux', version: '^1.63.0' }),
    /exact playwright version/u,
  );
  assert.throws(
    () => browserCacheKey({ runnerOs: 'Linux OS', version: '1.63.0' }),
    /simple runner OS name/u,
  );
  const home = path.join(path.sep, 'home', 'runner');
  assert.equal(
    browserCachePath({ environment: {}, homedir: home, platform: 'linux' }),
    path.join(home, '.cache', 'ms-playwright'),
  );
  assert.equal(
    browserCachePath({ environment: {}, homedir: home, platform: 'darwin' }),
    path.join(home, 'Library', 'Caches', 'ms-playwright'),
  );
  assert.equal(
    browserCachePath({
      environment: { LOCALAPPDATA: path.join(home, 'Local') },
      homedir: home,
      platform: 'win32',
    }),
    path.join(home, 'Local', 'ms-playwright'),
  );
  assert.throws(
    () =>
      browserCachePath({
        environment: { PLAYWRIGHT_BROWSERS_PATH: '0' },
        homedir: home,
        platform: 'linux',
      }),
    /PLAYWRIGHT_BROWSERS_PATH=0/u,
  );
});
