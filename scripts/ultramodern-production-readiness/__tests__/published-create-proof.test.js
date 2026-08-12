const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writeJsonFile } = require('../../lib/fs-kit');
const { createProcessEnv } = require('../../lib/process-kit');

function writeJson(root, relativePath, value) {
  writeJsonFile(path.join(root, relativePath), value, { atomic: false });
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function writeCanonicalJson(root, relativePath, value) {
  const bytes = Buffer.from(
    `${JSON.stringify(canonicalValue(value), null, 2)}\n`,
    'utf8',
  );
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

test('generates readable first-ten verticals and deterministic safe names above ten', async () => {
  const { generateVerticalNames } = await import(
    '../published-create-proof/args.mjs'
  );
  const verticals = generateVerticalNames(25);

  assert.deepEqual(verticals.slice(0, 10), [
    'inventory',
    'finance',
    'people',
    'analytics',
    'orders',
    'procurement',
    'billing',
    'logistics',
    'support',
    'compliance',
  ]);
  assert.deepEqual(verticals.slice(10, 13), [
    'erp-vertical-011',
    'erp-vertical-012',
    'erp-vertical-013',
  ]);
  assert.equal(verticals[24], 'erp-vertical-025');
  assert.equal(new Set(verticals).size, verticals.length);
  assert.equal(
    verticals.every(name => /^[a-z][a-z0-9-]*$/u.test(name)),
    true,
  );
});

test('builds the supported pnpm dlx package command contract', async () => {
  const { createPnpmDlxArgs } = await import(
    '../published-create-proof/package-cohort.mjs'
  );
  const { createCleanPnpmDlxEnv } = await import(
    '../published-create-proof/process.mjs'
  );

  assert.deepEqual(
    createPnpmDlxArgs(
      {
        dlxSpecifier: '@bleedingdev/modern-js-create@latest',
        exactSpecifier: '@bleedingdev/modern-js-create@3.4.0-ultramodern.2',
      },
      ['my-super-app', '--lang', 'en'],
    ),
    [
      '--pm-on-fail=ignore',
      '--config.minimum-release-age-exclude=@bleedingdev/*',
      'dlx',
      '--allow-build=esbuild',
      '@bleedingdev/modern-js-create@3.4.0-ultramodern.2',
      'my-super-app',
      '--lang',
      'en',
    ],
  );
  assert.deepEqual(
    createPnpmDlxArgs(
      {
        dlxSpecifier: '@bleedingdev/modern-js-create@3.2.0-ultramodern.120',
        exactSpecifier: '@bleedingdev/modern-js-create@3.2.0-ultramodern.120',
      },
      ['catalog', '--vertical', '--lang', 'en'],
    ),
    [
      '--pm-on-fail=ignore',
      '--config.minimum-release-age-exclude=@bleedingdev/*',
      'dlx',
      '--allow-build=esbuild',
      '@bleedingdev/modern-js-create@3.2.0-ultramodern.120',
      'catalog',
      '--vertical',
      '--lang',
      'en',
    ],
  );
  assert.throws(
    () =>
      createPnpmDlxArgs(
        { exactSpecifier: 'modern-js-create@3.5.0-ultramodern.77' },
        [],
      ),
    /must use a scoped exact specifier/u,
  );

  const root = path.join(os.tmpdir(), 'published-create-dlx-cache');
  assert.deepEqual(createCleanPnpmDlxEnv(root), {
    XDG_CACHE_HOME: path.join(root, 'xdg'),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_store_dir: path.join(root, 'store'),
    pnpm_config_store_dir: path.join(root, 'store'),
  });
});

test('shared ERP-10 profile requires frozen install, checks, both builds, and no framework override', async t => {
  const {
    createAcceptancePackageManagerEnv,
    requiredPnpmCommands,
    resolveExactPnpmExecutable,
  } = await import('../published-create-proof/acceptance-profile.mjs');
  const { requiredAcceptanceResultIds } = await import(
    '../published-create-proof/acceptance-receipt.mjs'
  );

  assert.deepEqual(requiredPnpmCommands, {
    lockfileOnly: ['install', '--lockfile-only', '--ignore-scripts'],
    install: ['install', '--frozen-lockfile'],
    check: ['check'],
    build: ['build'],
    cloudflareBuild: ['cloudflare:build'],
  });
  assert.equal(requiredAcceptanceResultIds.includes('generate-lockfile'), true);
  assert.equal(
    requiredAcceptanceResultIds.indexOf('generate-lockfile') <
      requiredAcceptanceResultIds.indexOf('dependency-closure-audit'),
    true,
  );
  assert.equal(requiredAcceptanceResultIds.includes('cloudflare-build'), true);
  assert.equal(
    createAcceptancePackageManagerEnv('/tmp/acceptance', {
      MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: 'forbidden',
    }).MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION,
    undefined,
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(
        createAcceptancePackageManagerEnv('/tmp/acceptance'),
      ).filter(([name]) => /(?:fetch|network_concurrency)/u.test(name)),
    ),
    {
      npm_config_fetch_retries: '5',
      npm_config_fetch_timeout: '600000',
      pnpm_config_fetch_retries: '5',
      pnpm_config_fetch_timeout: '600000',
      pnpm_config_network_concurrency: '8',
    },
    'cold acceptance installs must tolerate slow registries without unbounded request concurrency',
  );
  const exactPnpmDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-exact-pnpm-'),
  );
  t.after(() => fs.rmSync(exactPnpmDir, { force: true, recursive: true }));
  const exactPnpmExecutable = path.join(
    exactPnpmDir,
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  );
  fs.writeFileSync(exactPnpmExecutable, 'acceptance test executable');
  fs.chmodSync(exactPnpmExecutable, 0o755);
  const calls = [];
  const resolvedPnpmExecutable = resolveExactPnpmExecutable(
    (command, args, options) => {
      calls.push({ args, command, options });
      if (command === 'pnpm') {
        throw new Error('mise pnpm exec PATH does not expose the pnpm shim');
      }
      if (command === exactPnpmExecutable) {
        return '11.17.0';
      }
      throw new Error(`Unexpected command ${command}`);
    },
    '11.17.0',
    { PATH: exactPnpmDir },
    exactPnpmDir,
  );
  assert.equal(resolvedPnpmExecutable, exactPnpmExecutable);
  assert.deepEqual(
    calls.map(call => [call.command, call.args]),
    [
      ['pnpm', ['exec', 'node', '-e', calls[0].args[3]]],
      [exactPnpmExecutable, ['--version']],
    ],
  );
  assert.equal(calls[1].options.cwd, exactPnpmDir);
  const stalePnpmDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-stale-pnpm-shim-'),
  );
  t.after(() => fs.rmSync(stalePnpmDir, { force: true, recursive: true }));
  const stalePnpmExecutable = path.join(
    stalePnpmDir,
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  );
  fs.writeFileSync(stalePnpmExecutable, 'stale acceptance test executable');
  fs.chmodSync(stalePnpmExecutable, 0o755);
  const explicitCalls = [];
  assert.equal(
    resolveExactPnpmExecutable(
      (command, args) => {
        explicitCalls.push([command, args]);
        if (command === exactPnpmExecutable) {
          return '11.17.0';
        }
        if (command === stalePnpmExecutable || command === 'pnpm') {
          return '11.11.0';
        }
        throw new Error(`Unexpected command ${command}`);
      },
      '11.17.0',
      {
        PATH: stalePnpmDir,
        ULTRAMODERN_PNPM_EXECUTABLE: exactPnpmExecutable,
      },
      exactPnpmDir,
    ),
    exactPnpmExecutable,
    'an explicitly provisioned manifest pnpm must win over a stale project shim',
  );
  assert.deepEqual(explicitCalls, [[exactPnpmExecutable, ['--version']]]);
  assert.equal(
    createAcceptancePackageManagerEnv(
      '/tmp/acceptance',
      { PATH: '/hostile/registry/path' },
      exactPnpmExecutable,
    ).PATH.split(path.delimiter)[0],
    path.dirname(exactPnpmExecutable),
    'the manifest-verified pnpm must override inherited and registry PATH entries',
  );
  assert.throws(
    () =>
      resolveExactPnpmExecutable(
        command => {
          if (command === 'pnpm') {
            throw new Error('nested discovery unavailable');
          }
          assert.equal(command, exactPnpmExecutable);
          return '11.14.0';
        },
        '11.17.0',
        { PATH: exactPnpmDir },
        exactPnpmDir,
      ),
    /resolved 11\.14\.0, expected 11\.17\.0/u,
  );
  const directoryDecoyPath = path.join(exactPnpmDir, 'directory-decoy');
  fs.mkdirSync(path.join(directoryDecoyPath, 'pnpm'), { recursive: true });
  assert.throws(
    () =>
      resolveExactPnpmExecutable(
        () => {
          throw new Error('directory decoy must not be executed');
        },
        '11.17.0',
        { PATH: directoryDecoyPath },
        exactPnpmDir,
      ),
    /pnpm executable is absent from the acceptance parent PATH/u,
  );
  assert.equal(
    createAcceptancePackageManagerEnv('/tmp/acceptance', {
      ULTRAMODERN_CREATE_BIN: '/repo/packages/toolkit/create/bin/run.js',
    }).ULTRAMODERN_CREATE_BIN,
    undefined,
  );

  const inherited = {
    MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION:
      process.env.MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION,
    ULTRAMODERN_CREATE_BIN: process.env.ULTRAMODERN_CREATE_BIN,
    ZE_CI_TOKEN: process.env.ZE_CI_TOKEN,
  };
  try {
    process.env.MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION =
      'inherited-framework-override';
    process.env.ULTRAMODERN_CREATE_BIN = '/inherited/source-create-bin.js';
    process.env.ZE_CI_TOKEN = 'inherited-zephyr-token';
    const effectiveEnv = createProcessEnv(
      createAcceptancePackageManagerEnv('/tmp/acceptance'),
    );
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `process.stdout.write(JSON.stringify({
          frameworkOverride: process.env.MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION,
          sourceCreateBin: process.env.ULTRAMODERN_CREATE_BIN,
          zephyrToken: process.env.ZE_CI_TOKEN,
        }))`,
      ],
      { encoding: 'utf8', env: effectiveEnv },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(
      JSON.parse(child.stdout),
      {},
      'the effective acceptance child environment must scrub inherited source/runtime and deploy overrides',
    );
  } finally {
    for (const [name, value] of Object.entries(inherited)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test('default-off clean-room install excludes and cannot resolve RSC runtimes', async t => {
  const { assertDefaultOffRscInstall } = await import(
    '../published-create-proof/acceptance-profile.mjs'
  );
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-default-off-rsc-'),
  );
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const appRoot = path.join(root, 'apps', 'shell');
  const runtimeRoot = path.join(root, 'node_modules', '@modern-js', 'runtime');
  const renderRoot = path.join(
    runtimeRoot,
    'node_modules',
    '@modern-js',
    'render',
  );
  fs.mkdirSync(appRoot, { recursive: true });
  fs.mkdirSync(renderRoot, { recursive: true });
  writeJson(root, 'apps/shell/package.json', {
    name: '@acceptance/shell',
    dependencies: { '@modern-js/runtime': '3.5.0-ultramodern.103' },
  });
  writeJson(root, 'node_modules/@modern-js/runtime/package.json', {
    name: '@modern-js/runtime',
    exports: { '.': './index.js' },
  });
  fs.writeFileSync(path.join(runtimeRoot, 'index.js'), 'module.exports = {}\n');
  writeJson(
    root,
    'node_modules/@modern-js/runtime/node_modules/@modern-js/render/package.json',
    {
      name: '@modern-js/render',
      exports: { './client': './client.js' },
    },
  );
  fs.writeFileSync(path.join(renderRoot, 'client.js'), 'module.exports = {}\n');

  const oversizedCleanClosure = Array.from({ length: 25_000 }, (_, index) => ({
    name: `clean-dependency-${index}`,
    version: '1.0.0',
  }));
  assert.deepEqual(assertDefaultOffRscInstall(root, oversizedCleanClosure), {
    appPackage: '@acceptance/shell',
    forbiddenDependencyCount: 0,
    renderClient: fs.realpathSync(path.join(renderRoot, 'client.js')),
  });

  assert.throws(
    () =>
      assertDefaultOffRscInstall(
        root,
        oversizedCleanClosure.concat({
          name: 'rsbuild-plugin-rsc',
          version: '0.1.1',
        }),
      ),
    /contains forbidden RSC dependencies: rsbuild-plugin-rsc/u,
  );

  const poisonRoot = path.join(
    renderRoot,
    'node_modules',
    'react-server-dom-rspack',
  );
  fs.mkdirSync(poisonRoot, { recursive: true });
  writeJson(
    root,
    'node_modules/@modern-js/runtime/node_modules/@modern-js/render/node_modules/react-server-dom-rspack/package.json',
    {
      name: 'react-server-dom-rspack',
      exports: { './client.browser': './client.browser.js' },
    },
  );
  fs.writeFileSync(
    path.join(poisonRoot, 'client.browser.js'),
    'module.exports = {}\n',
  );
  assert.throws(
    () => assertDefaultOffRscInstall(root, oversizedCleanClosure),
    /must not resolve react-server-dom-rspack\/client\.browser/u,
  );
});

test('snapshots install-materialized generated source before building', async () => {
  const { snapshotAcceptanceWorkspaceSource } = await import(
    '../published-create-proof/acceptance-profile.mjs'
  );
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-acceptance-source-'),
  );
  const runImpl = (command, args, options = {}) => {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      env: createProcessEnv(options.env ?? {}),
      stdio: options.stdio === 'inherit' ? 'ignore' : 'pipe',
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `${command} failed`);
    }
    return result.stdout?.trim() ?? '';
  };

  try {
    runImpl('git', ['init', '--quiet'], { cwd: root });
    fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}\n');
    runImpl('git', ['add', 'package.json'], { cwd: root });
    runImpl(
      'git',
      [
        '-c',
        'user.name=Fixture Author',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '--quiet',
        '-m',
        'initial',
      ],
      { cwd: root },
    );
    const initial = runImpl('git', ['rev-parse', 'HEAD'], { cwd: root });
    fs.mkdirSync(path.join(root, 'verticals', 'catalog'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, 'verticals', 'catalog', 'package.json'),
      '{"name":"catalog"}\n',
    );
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    fs.mkdirSync(path.join(root, '.codex', 'skills', 'mf'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, '.codex', 'skills', 'mf', 'SKILL.md'),
      '# Pinned Module Federation skill\n',
    );

    const revision = snapshotAcceptanceWorkspaceSource(
      root,
      {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_KEY_0: 'user.useConfigOnly',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_VALUE_0: 'true',
      },
      runImpl,
    );

    assert.match(revision, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
    assert.notEqual(revision, initial);
    assert.equal(
      runImpl('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
        cwd: root,
      }),
      '',
    );
    assert.equal(
      runImpl('git', ['show', '--format=', '--name-only', 'HEAD'], {
        cwd: root,
      }).includes('verticals/catalog/package.json'),
      true,
    );
    assert.equal(
      runImpl('git', ['show', '--format=', '--name-only', 'HEAD'], {
        cwd: root,
      }).includes('.codex/skills/mf/SKILL.md'),
      true,
      'the promotable source identity must include first-install materialization',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('browser runtime children scrub inherited source and deployment overrides', async () => {
  const { createBrowserSmokeEnvironment } = await import(
    '../published-create-proof/browser-smoke.mjs'
  );
  const inherited = {
    MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION:
      process.env.MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION,
    ULTRAMODERN_CREATE_BIN: process.env.ULTRAMODERN_CREATE_BIN,
    ZE_CI_TOKEN: process.env.ZE_CI_TOKEN,
  };
  try {
    process.env.MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION =
      'inherited-framework-override';
    process.env.ULTRAMODERN_CREATE_BIN = '/inherited/source-create-bin.js';
    process.env.ZE_CI_TOKEN = 'inherited-zephyr-token';
    const effectiveEnv = createProcessEnv(
      createBrowserSmokeEnvironment('/tmp/playwright-runtime', {
        PATH: '/tmp/exact-pnpm/bin',
        pnpm_config_registry: 'http://127.0.0.1:4873/',
      }),
    );
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `process.stdout.write(JSON.stringify({
          frameworkOverride: process.env.MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION,
          sourceCreateBin: process.env.ULTRAMODERN_CREATE_BIN,
          zephyrToken: process.env.ZE_CI_TOKEN,
          path: process.env.PATH,
          registry: process.env.pnpm_config_registry,
        }))`,
      ],
      { encoding: 'utf8', env: effectiveEnv },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      path: '/tmp/exact-pnpm/bin',
      registry: 'http://127.0.0.1:4873/',
    });
  } finally {
    for (const [name, value] of Object.entries(inherited)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test('browser smoke exposes the bounded child cause through the outer acceptance failure', async () => {
  const { runBrowserSmoke } = await import(
    '../published-create-proof/browser-smoke.mjs'
  );
  const logPath = '/tmp/inventory-serve.log';
  const exactCause = "Error: Cannot find module '@modern-js/prod-server'";
  const genericFailure = new Error(
    'Command failed: node run-browser-smoke.mjs',
  );

  assert.throws(
    () =>
      runBrowserSmoke(
        '/tmp/generated-superapp',
        {
          artifactMode: 'source',
          mode: 'source',
          platform: 'node',
          shellRuntime: 'node',
        },
        {
          ensureBrowserSmokeRuntimeImpl: () => '/tmp/playwright-runtime',
          readJsonFileImpl: () => ({
            error: 'inventory serve process exited before readiness',
            errorDetails: {
              apiPrefix: '/inventory-api',
              apiResponse: {
                body: {
                  AUTH_TOKEN: 'do-not-copy-me',
                  nested: {
                    password: 'also-do-not-copy-me',
                  },
                  message: `Effect request failed ${'x'.repeat(8_000)}`,
                },
                status: 500,
                url: 'http://127.0.0.1:4173/inventory-api/items',
              },
              appId: 'inventory',
              exitCode: 1,
              logPath,
              logTail: `${'old output\n'.repeat(2_000)}AUTH_TOKEN=do-not-copy-me\n${exactCause}`,
              phase: 'backend-driven-ui',
              signal: null,
            },
            status: 'fail',
          }),
          runImpl: () => {
            throw genericFailure;
          },
        },
      ),
    error => {
      assert.equal(error.name, 'BrowserSmokeAcceptanceError');
      assert.match(error.message, /inventory serve process exited/);
      assert.match(error.message, new RegExp(logPath.replaceAll('/', '\\/')));
      assert.match(
        error.message,
        /Cannot find module '@modern-js\/prod-server'/,
      );
      assert.doesNotMatch(error.message, /do-not-copy-me/);
      assert.match(error.message, /AUTH_TOKEN=\[REDACTED\]/);
      assert.match(error.message, /\\"AUTH_TOKEN\\":\\"\[REDACTED\]\\"/);
      assert.match(error.message, /\\"password\\":\\"\[REDACTED\]\\"/);
      assert.match(error.message, /structured failure evidence:/);
      assert.match(error.message, /"appId": "inventory"/);
      assert.match(error.message, /"status": 500/);
      assert.match(error.message, /Effect request failed/);
      assert.doesNotMatch(error.message, /^Command failed/u);
      assert.ok(error.message.length < 13_000);
      const evidenceSource = error.message
        .split('structured failure evidence:\n')[1]
        .split('\nchild log:')[0];
      const evidence = JSON.parse(evidenceSource);
      assert.equal(evidence.appId, 'inventory');
      assert.equal(evidence.apiResponse.status, 500);
      assert.equal(error.details.logPath, logPath);
      assert.ok(error.details.logTail.length <= 8_192);
      assert.equal(typeof error.details.apiResponse.body, 'string');
      assert.ok(error.details.apiResponse.body.length <= 2_048);
      assert.doesNotMatch(JSON.stringify(error.details), /do-not-copy-me/);
      assert.match(
        error.details.apiResponse.body,
        /"AUTH_TOKEN":"\[REDACTED\]"/,
      );
      assert.match(error.details.apiResponse.body, /"password":"\[REDACTED\]"/);
      assert.equal(error.cause, genericFailure);
      return true;
    },
  );
});

test('browser smoke diagnostics redact structured and embedded JSON secrets', async () => {
  const { createBrowserSmokeFailureDetails } = await import(
    '../published-create-proof/browser-smoke.mjs'
  );
  for (const body of [
    {
      AUTH_TOKEN: 'object-secret',
      nested: { password: 'nested-secret' },
    },
    '<pre>{"AUTH_TOKEN":"string-secret","password":"embedded-secret"}</pre>',
  ]) {
    const details = createBrowserSmokeFailureDetails({
      apiResponse: { body, status: 500 },
    });
    const serialized = JSON.stringify(details);
    assert.doesNotMatch(serialized, /object-secret|nested-secret/u);
    assert.doesNotMatch(serialized, /string-secret|embedded-secret/u);
    assert.match(serialized, /\[REDACTED\]/u);
    assert.ok(details.apiResponse.body.length <= 2_048);
  }
});

test('asserts MF shared contract versions across generated topology evidence', async () => {
  const { createSharedContractVersionAssertion } = await import(
    '../published-create-proof/topology.mjs'
  );
  const matchingTopology = {
    shell: {
      moduleFederation: {
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
    },
    verticals: [
      {
        moduleFederation: {
          sharedContractVersion: 'mf-ssr-contract-v1',
        },
      },
    ],
  };
  const matchingContract = {
    apps: [
      {
        moduleFederation: {
          sharedContractVersion: 'mf-ssr-contract-v1',
        },
      },
    ],
  };

  assert.deepEqual(
    createSharedContractVersionAssertion({
      topology: matchingTopology,
      generatedContract: matchingContract,
    }),
    {
      status: 'pass',
      versions: ['mf-ssr-contract-v1'],
    },
  );
  assert.deepEqual(
    createSharedContractVersionAssertion({
      topology: {
        ...matchingTopology,
        verticals: [
          {
            moduleFederation: {
              sharedContractVersion: 'mf-ssr-contract-v2',
            },
          },
        ],
      },
      generatedContract: matchingContract,
    }),
    {
      status: 'fail',
      versions: ['mf-ssr-contract-v1', 'mf-ssr-contract-v2'],
    },
  );
  assert.deepEqual(
    createSharedContractVersionAssertion({
      topology: { shell: {}, verticals: [{}] },
      generatedContract: { apps: [{}] },
    }),
    {
      status: 'unknown',
      versions: [],
      message: 'No MF sharedContractVersion values found in topology/contract.',
    },
  );
});

test('asserts generated cohorts only from strict manifest expectations and compact observations', async () => {
  const { assertGeneratedCohort } = await import(
    '../published-create-proof/package-cohort.mjs'
  );
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'published-create-cohort-'),
  );
  const version = '3.2.0-framework.1';
  const release = {
    aliases: {
      '@modern-js/create': '@bleedingdev/modern-js-create',
      '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
    },
    createPackage: {
      sourceName: '@modern-js/create',
      targetName: '@bleedingdev/modern-js-create',
      version,
    },
    packages: [
      {
        sourceName: '@modern-js/create',
        targetName: '@bleedingdev/modern-js-create',
      },
      {
        sourceName: '@modern-js/runtime',
        targetName: '@bleedingdev/modern-js-runtime',
      },
    ],
    publishOrder: [
      '@bleedingdev/modern-js-runtime',
      '@bleedingdev/modern-js-create',
    ],
    release: { version },
  };
  const cohortProjection = {
    aliases: release.aliases,
    packages: release.packages.map(item => ({ ...item, version })),
    release: { tag: 'latest', version },
    schema: 'bleedingdev.ultramodern.release-cohort',
    schemaVersion: 1,
    source: {
      commit: 'a'.repeat(40),
      repository: 'BleedingDev/ultramodern.js',
    },
  };

  try {
    writeJson(root, '.modernjs/ultramodern.json', {
      schemaVersion: 1,
      generator: {
        package: '@modern-js/create',
        version,
      },
      packageSource: {
        strategy: 'install',
        modernPackageVersion: version,
        aliasScope: 'bleedingdev',
        aliasPackageNamePrefix: 'modern-js-',
      },
    });
    writeJson(root, 'package.json', {
      dependencies: {
        '@modern-js/runtime': `npm:@bleedingdev/modern-js-runtime@${version}`,
      },
    });
    release.cohortProjection = {
      sha256: writeCanonicalJson(
        root,
        '.modernjs/release-cohort.json',
        cohortProjection,
      ),
      value: cohortProjection,
    };

    assert.equal(assertGeneratedCohort(root, release).observedPackageCount, 1);

    writeJson(root, 'package.json', {
      dependencies: {
        '@modern-js/runtime': `npm:@bleedingdev/modern-js-runtime@${version}`,
        'runtime-compat':
          'npm:@bleedingdev/modern-js-runtime@^3.2.0-framework.1',
      },
    });
    assert.throws(
      () => assertGeneratedCohort(root, release),
      /runtime-compat must target exact cohort package @bleedingdev\/modern-js-runtime@3\.2\.0-framework\.1/u,
    );

    writeJson(root, 'package.json', {
      dependencies: {
        '@modern-js/runtime': `npm:@bleedingdev/modern-js-runtime@${version}`,
        'runtime-compat': `npm:@bleedingdev/modern-js-runtime@${version}`,
      },
    });
    assert.equal(assertGeneratedCohort(root, release).observedPackageCount, 1);

    fs.rmSync(path.join(root, '.modernjs/release-cohort.json'));
    assert.throws(
      () => assertGeneratedCohort(root, release),
      /authenticated release cohort is missing or unsafe/,
    );
    writeCanonicalJson(root, '.modernjs/release-cohort.json', cohortProjection);

    writeJson(root, '.modernjs/ultramodern-package-source.json', {
      strategy: 'install',
    });
    assert.throws(
      () => assertGeneratedCohort(root, release),
      /retired package-cohort metadata/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
