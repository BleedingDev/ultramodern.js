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

function makeBootstrapRelease(version = '3.4.0-ultramodern.2') {
  const aliases = {
    '@modern-js/ultramodern-create':
      '@bleedingdev/modern-js-ultramodern-create',
    '@modern-js/i18n-utils': '@bleedingdev/modern-js-i18n-utils',
    '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
    '@modern-js/utils': '@bleedingdev/modern-js-utils',
  };
  const packageJson = (sourceName, dependencies = {}) => ({
    dependencies,
    ...(sourceName === '@modern-js/ultramodern-create'
      ? { ultramodern: { frameworkVersion: version } }
      : {}),
  });
  const packages = [
    {
      packageJson: packageJson('@modern-js/ultramodern-create', {
        '@modern-js/i18n-utils': `npm:${aliases['@modern-js/i18n-utils']}@${version}`,
        chalk: '^5.6.2',
      }),
      sourceName: '@modern-js/ultramodern-create',
      targetName: aliases['@modern-js/ultramodern-create'],
      version,
    },
    {
      packageJson: packageJson('@modern-js/i18n-utils', {
        '@modern-js/utils': `npm:${aliases['@modern-js/utils']}@${version}`,
      }),
      sourceName: '@modern-js/i18n-utils',
      targetName: aliases['@modern-js/i18n-utils'],
      version,
    },
    {
      packageJson: packageJson('@modern-js/runtime'),
      sourceName: '@modern-js/runtime',
      targetName: aliases['@modern-js/runtime'],
      version,
    },
    {
      packageJson: packageJson('@modern-js/utils'),
      sourceName: '@modern-js/utils',
      targetName: aliases['@modern-js/utils'],
      version,
    },
  ];
  return {
    aliases,
    createPackage: packages[0],
    dependencyGraph: {
      [aliases['@modern-js/ultramodern-create']]: [
        aliases['@modern-js/i18n-utils'],
      ],
      [aliases['@modern-js/i18n-utils']]: [aliases['@modern-js/utils']],
      [aliases['@modern-js/runtime']]: [],
      [aliases['@modern-js/utils']]: [],
    },
    packages,
    publishOrder: packages.map(item => item.targetName),
    release: { version },
  };
}

test('builds the supported pnpm dlx package command contract from the authenticated create closure', async () => {
  const { createPnpmDlxArgs, resolveCreatePackage } = await import(
    '../published-create-proof/package-cohort.mjs'
  );
  const { createCleanPnpmDlxEnv } = await import(
    '../published-create-proof/process.mjs'
  );

  const createPackage = resolveCreatePackage(makeBootstrapRelease());
  assert.deepEqual(
    createPnpmDlxArgs(createPackage, ['my-super-app', '--lang', 'en']),
    [
      '--pm-on-fail=ignore',
      '--config.minimum-release-age=1440',
      '--config.minimum-release-age-strict=true',
      '--config.minimum-release-age-ignore-missing-time=false',
      '--config.minimum-release-age-exclude=@bleedingdev/modern-js-i18n-utils@3.4.0-ultramodern.2',
      '--config.minimum-release-age-exclude=@bleedingdev/modern-js-ultramodern-create@3.4.0-ultramodern.2',
      '--config.minimum-release-age-exclude=@bleedingdev/modern-js-utils@3.4.0-ultramodern.2',
      'dlx',
      '--allow-build=esbuild',
      '@bleedingdev/modern-js-ultramodern-create@3.4.0-ultramodern.2',
      'my-super-app',
      '--lang',
      'en',
    ],
  );
  assert.deepEqual(
    createPnpmDlxArgs(createPackage, ['catalog', '--vertical', '--lang', 'en']),
    [
      '--pm-on-fail=ignore',
      '--config.minimum-release-age=1440',
      '--config.minimum-release-age-strict=true',
      '--config.minimum-release-age-ignore-missing-time=false',
      '--config.minimum-release-age-exclude=@bleedingdev/modern-js-i18n-utils@3.4.0-ultramodern.2',
      '--config.minimum-release-age-exclude=@bleedingdev/modern-js-ultramodern-create@3.4.0-ultramodern.2',
      '--config.minimum-release-age-exclude=@bleedingdev/modern-js-utils@3.4.0-ultramodern.2',
      'dlx',
      '--allow-build=esbuild',
      '@bleedingdev/modern-js-ultramodern-create@3.4.0-ultramodern.2',
      'catalog',
      '--vertical',
      '--lang',
      'en',
    ],
  );
  assert.throws(
    () =>
      createPnpmDlxArgs(
        {
          exactSpecifier: 'modern-js-ultramodern-create@3.5.0-ultramodern.77',
        },
        [],
      ),
    /exact authenticated bootstrap release-age policy/u,
  );

  const root = path.join(os.tmpdir(), 'published-create-dlx-cache');
  assert.deepEqual(createCleanPnpmDlxEnv(root), {
    XDG_CACHE_HOME: path.join(root, 'xdg'),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_store_dir: path.join(root, 'store'),
    pnpm_config_store_dir: path.join(root, 'store'),
  });
});

test('fails closed when the authenticated create closure is omitted, broadened, or version-skewed', async () => {
  const { resolveCreatePackage } = await import(
    '../published-create-proof/package-cohort.mjs'
  );

  const omitted = makeBootstrapRelease();
  omitted.dependencyGraph[omitted.createPackage.targetName] = [];
  assert.throws(
    () => resolveCreatePackage(omitted),
    /differs from authenticated packed runtime dependencies/u,
  );

  const extra = makeBootstrapRelease();
  extra.dependencyGraph[extra.createPackage.targetName].push(
    extra.aliases['@modern-js/runtime'],
  );
  assert.throws(
    () => resolveCreatePackage(extra),
    /differs from authenticated packed runtime dependencies/u,
  );

  const wrongVersion = makeBootstrapRelease();
  wrongVersion.packages.find(
    item => item.sourceName === '@modern-js/i18n-utils',
  ).version = '3.4.0-ultramodern.1';
  assert.throws(
    () => resolveCreatePackage(wrongVersion),
    /must use release version 3\.4\.0-ultramodern\.2/u,
  );
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
  assert.deepEqual(
    createAcceptancePackageManagerEnv(
      '/tmp/acceptance',
      { PATH: '/hostile/registry/path' },
      exactPnpmExecutable,
      { PATH: '/injected/tool/path' },
    ).PATH.split(path.delimiter),
    [path.dirname(exactPnpmExecutable), '/injected/tool/path'],
    'the manifest-verified pnpm heads the injected PATH, and no registry or ambient entry survives',
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
      ULTRAMODERN_CREATE_BIN:
        '/repo/packages/toolkit/ultramodern-create/bin/run.js',
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
      '@modern-js/ultramodern-create':
        '@bleedingdev/modern-js-ultramodern-create',
      '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
    },
    createPackage: {
      sourceName: '@modern-js/ultramodern-create',
      targetName: '@bleedingdev/modern-js-ultramodern-create',
      version,
    },
    packages: [
      {
        sourceName: '@modern-js/ultramodern-create',
        targetName: '@bleedingdev/modern-js-ultramodern-create',
      },
      {
        sourceName: '@modern-js/runtime',
        targetName: '@bleedingdev/modern-js-runtime',
      },
    ],
    publishOrder: [
      '@bleedingdev/modern-js-runtime',
      '@bleedingdev/modern-js-ultramodern-create',
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
        package: '@modern-js/ultramodern-create',
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

test('one acceptance runtime context owns pnpm, stores, registry, and the browsers path', async t => {
  const { acceptancePlaywrightInstallArgs, createAcceptanceRuntimeContext } =
    await import('../published-create-proof/acceptance-profile.mjs');

  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-runtime-context-'),
  );
  t.after(() => fs.rmSync(workDir, { force: true, recursive: true }));
  const packageManagerRoot = path.join(workDir, 'package-manager');
  const pnpmExecutable = path.join('/opt', 'pnpm-11.17.0', 'bin', 'pnpm');
  const injectedPath = path.join('/injected', 'tool', 'path');
  const resolverCalls = [];
  const resolveExactPnpmExecutableImpl = (...args) => {
    resolverCalls.push(args);
    return pnpmExecutable;
  };

  const isolated = createAcceptanceRuntimeContext({
    browsers: 'isolated',
    environment: {
      PATH: injectedPath,
      PLAYWRIGHT_BROWSERS_PATH: '/inherited/ms-playwright',
    },
    expectedPnpmVersion: '11.17.0',
    registryEnv: {
      npm_config_registry: 'https://registry.npmjs.org/',
      pnpm_config_registry: 'https://registry.npmjs.org/',
    },
    resolveExactPnpmExecutableImpl,
    workDir,
  });

  assert.deepEqual(
    Object.keys(isolated).sort(),
    ['env', 'pnpmExecutable'],
    'the context exposes only what a clean room consumes',
  );
  assert.equal(isolated.pnpmExecutable, pnpmExecutable);
  // The whole PATH, not just its head: the injected environment decides what
  // the child can execute, so the ambient parent PATH must not leak in behind
  // the manifest-verified pnpm.
  assert.deepEqual(isolated.env.PATH.split(path.delimiter), [
    path.dirname(pnpmExecutable),
    injectedPath,
  ]);
  assert.deepEqual(
    {
      XDG_CACHE_HOME: isolated.env.XDG_CACHE_HOME,
      npm_config_cache: isolated.env.npm_config_cache,
      npm_config_registry: isolated.env.npm_config_registry,
      npm_config_store_dir: isolated.env.npm_config_store_dir,
      pnpm_config_registry: isolated.env.pnpm_config_registry,
      pnpm_config_store_dir: isolated.env.pnpm_config_store_dir,
    },
    {
      XDG_CACHE_HOME: path.join(packageManagerRoot, 'xdg'),
      npm_config_cache: path.join(packageManagerRoot, 'npm-cache'),
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_store_dir: path.join(packageManagerRoot, 'store'),
      pnpm_config_registry: 'https://registry.npmjs.org/',
      pnpm_config_store_dir: path.join(packageManagerRoot, 'store'),
    },
    'one module owns the stores, the XDG cache, and the registry',
  );
  assert.equal(
    isolated.env.PLAYWRIGHT_BROWSERS_PATH.startsWith(
      `${packageManagerRoot}${path.sep}`,
    ),
    true,
    'isolated browsers must stay inside the disposable package-manager root',
  );
  assert.deepEqual(
    [...acceptancePlaywrightInstallArgs],
    ['exec', 'playwright', 'install', '--with-deps', 'chromium'],
    'the shared install must be dependency-resolved through pnpm exec, never a pinned version',
  );
  assert.deepEqual(resolverCalls[0].slice(1), [
    '11.17.0',
    {
      PATH: injectedPath,
      PLAYWRIGHT_BROWSERS_PATH: '/inherited/ms-playwright',
    },
    workDir,
  ]);

  const inherited = createAcceptanceRuntimeContext({
    environment: { PLAYWRIGHT_BROWSERS_PATH: '/inherited/ms-playwright' },
    expectedPnpmVersion: '11.17.0',
    resolveExactPnpmExecutableImpl,
    workDir,
  });
  assert.equal(
    inherited.env.PLAYWRIGHT_BROWSERS_PATH,
    '/inherited/ms-playwright',
    'ERP reuses the operationally provisioned browsers on the runner',
  );

  const unprovisioned = createAcceptanceRuntimeContext({
    environment: {},
    expectedPnpmVersion: '11.17.0',
    resolveExactPnpmExecutableImpl,
    workDir,
  });
  assert.equal(
    Object.hasOwn(unprovisioned.env, 'PLAYWRIGHT_BROWSERS_PATH'),
    false,
    'an absent inherited browsers path must not be forced into the child env',
  );

  assert.throws(
    () =>
      createAcceptanceRuntimeContext({
        expectedPnpmVersion: '11.17.0',
        resolveExactPnpmExecutableImpl,
        workDir: 'relative/work-dir',
      }),
    /absolute work directory/u,
  );
  assert.throws(
    () =>
      createAcceptanceRuntimeContext({
        browsers: 'shared',
        expectedPnpmVersion: '11.17.0',
        resolveExactPnpmExecutableImpl,
        workDir,
      }),
    /browser isolation must be inherited or isolated/u,
  );
  // Exact pnpm stays fail-closed through the single owner.
  assert.throws(
    () =>
      createAcceptanceRuntimeContext({
        expectedPnpmVersion: '11',
        workDir,
      }),
    /must bind an exact pnpm version/u,
  );
  assert.throws(
    () =>
      createAcceptanceRuntimeContext({
        environment: { PATH: '' },
        expectedPnpmVersion: '11.17.0',
        runImpl: () => {
          throw new Error('no pnpm on PATH');
        },
        workDir,
      }),
    /pnpm executable is absent from the acceptance parent PATH/u,
  );
});

test('the in-process Playwright launch restores the parent browsers path', async t => {
  const { withAcceptancePlaywrightBrowsersPath } = await import(
    '../published-create-proof/acceptance-profile.mjs'
  );
  const originalBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  t.after(() => {
    if (originalBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = originalBrowsersPath;
    }
  });

  process.env.PLAYWRIGHT_BROWSERS_PATH = '/parent/ms-playwright';
  const observed = await withAcceptancePlaywrightBrowsersPath(
    '/isolated/ms-playwright',
    async () => process.env.PLAYWRIGHT_BROWSERS_PATH,
  );
  assert.equal(observed, '/isolated/ms-playwright');
  assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, '/parent/ms-playwright');

  await assert.rejects(
    () =>
      withAcceptancePlaywrightBrowsersPath('/isolated/ms-playwright', () => {
        throw new Error('launch failed');
      }),
    /launch failed/u,
  );
  assert.equal(
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/parent/ms-playwright',
    'a failed launch must still restore the parent process',
  );

  const cleared = await withAcceptancePlaywrightBrowsersPath(
    undefined,
    async () => Object.hasOwn(process.env, 'PLAYWRIGHT_BROWSERS_PATH'),
  );
  assert.equal(cleared, false);
  assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, '/parent/ms-playwright');

  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  await withAcceptancePlaywrightBrowsersPath(
    '/isolated/ms-playwright',
    async () => undefined,
  );
  assert.equal(
    Object.hasOwn(process.env, 'PLAYWRIGHT_BROWSERS_PATH'),
    false,
    'an unset parent value must be removed again, not left behind',
  );
});

test('browser provisioning resolves an exact version without installing and keys each runtime apart', async t => {
  const {
    acceptanceBrowserCacheKey,
    acceptanceBrowserInstallArgs,
    parseProvisionArgs,
    provisionAcceptanceBrowsers,
    qualificationRuntimeDir,
    resolveAcceptanceBrowserVersion,
  } = await import('../published-create-proof/browser-provisioning.mjs');
  const { browserSmokePlaywrightPackage } = await import(
    '../published-create-proof/constants.mjs'
  );

  const runtimeDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-browser-runtime-'),
  );
  t.after(() => fs.rmSync(runtimeDir, { force: true, recursive: true }));
  writeJson(runtimeDir, 'node_modules/playwright/package.json', {
    name: 'playwright',
    version: '1.60.0',
  });

  // An exactly pinned smoke specifier resolves by parsing it: keying the cache
  // must never reach the network or write a runtime.
  assert.equal(
    resolveAcceptanceBrowserVersion('smoke', {
      ensureBrowserSmokeRuntimeImpl: () =>
        assert.fail('resolving an exact specifier must install nothing'),
      playwrightPackage: 'playwright@1.60.0',
    }),
    '1.60.0',
  );
  // Only a non-exact override has to materialize a runtime to learn what it
  // resolved to.
  assert.equal(
    resolveAcceptanceBrowserVersion('smoke', {
      ensureBrowserSmokeRuntimeImpl: () => runtimeDir,
      playwrightPackage: 'playwright@^1.60.0',
    }),
    '1.60.0',
  );
  assert.equal(
    resolveAcceptanceBrowserVersion('qualification', {
      ensureBrowserSmokeRuntimeImpl: () =>
        assert.fail('the qualification runtime is the rstest browser fixture'),
      readJsonFileImpl: manifestPath => {
        assert.equal(
          manifestPath,
          path.join(
            qualificationRuntimeDir,
            'node_modules/playwright/package.json',
          ),
        );
        return { name: 'playwright', version: '1.61.1' };
      },
    }),
    '1.61.1',
  );

  // The qualification runtime is independently versioned: the rstest browser
  // fixture declares its own playwright dependency, resolved by the workspace
  // lockfile, and never inherits the ERP smoke specifier. Distinct targets
  // therefore key distinct caches even at an identical version.
  const fixtureManifest = JSON.parse(
    fs.readFileSync(path.join(qualificationRuntimeDir, 'package.json'), 'utf8'),
  );
  assert.equal(
    typeof fixtureManifest.devDependencies.playwright,
    'string',
    'the qualification runtime must own its playwright dependency',
  );
  assert.notEqual(
    `playwright@${fixtureManifest.devDependencies.playwright}`,
    browserSmokePlaywrightPackage,
    'the qualification and smoke playwright runtimes are versioned separately',
  );
  assert.notEqual(
    acceptanceBrowserCacheKey({
      runnerOs: 'Linux',
      target: 'qualification',
      version: '1.60.0',
    }),
    acceptanceBrowserCacheKey({
      runnerOs: 'Linux',
      target: 'smoke',
      version: '1.60.0',
    }),
  );
  assert.equal(
    acceptanceBrowserCacheKey({
      runnerOs: 'Linux',
      target: 'smoke',
      version: '1.60.0',
    }),
    'playwright-smoke-chromium-1.60.0-Linux',
  );
  assert.deepEqual(acceptanceBrowserInstallArgs(false), [
    'install',
    '--with-deps',
    'chromium',
  ]);
  assert.deepEqual(acceptanceBrowserInstallArgs(true), [
    'install-deps',
    'chromium',
  ]);

  const outputs = [];
  assert.deepEqual(
    provisionAcceptanceBrowsers(['--resolve', '--target', 'smoke'], {
      environment: { RUNNER_OS: 'Linux' },
      resolveAcceptanceBrowserVersionImpl: target => {
        assert.equal(target, 'smoke');
        return '1.60.0';
      },
      writeOutput: (name, value) => outputs.push([name, value]),
    }),
    { cacheKey: 'playwright-smoke-chromium-1.60.0-Linux', version: '1.60.0' },
  );
  assert.deepEqual(outputs, [
    ['cache_key', 'playwright-smoke-chromium-1.60.0-Linux'],
    ['version', '1.60.0'],
  ]);

  // Installing is operational: it reports no evidence, drives the resolved
  // runtime's own binary, and fails closed when that runtime is not the
  // version that keyed the cache.
  const { installAcceptanceBrowsers } = await import(
    '../published-create-proof/browser-provisioning.mjs'
  );
  const installCalls = [];
  assert.deepEqual(
    provisionAcceptanceBrowsers(
      ['--install', '--target', 'smoke', '--cache-hit', 'true'],
      {
        environment: {},
        installAcceptanceBrowsersImpl: options => {
          installCalls.push(options);
          return installAcceptanceBrowsers(options, {
            ensureBrowserSmokeRuntimeImpl: () => runtimeDir,
            runImpl: (command, args, runOptions) => {
              installCalls.push([command, args, runOptions.cwd]);
              return '';
            },
          });
        },
        resolveAcceptanceBrowserVersionImpl: () => '1.60.0',
        writeOutput: () => assert.fail('provisioning must report no evidence'),
      },
    ),
    {
      browsers: ['chromium'],
      cacheHit: true,
      target: 'smoke',
      version: '1.60.0',
    },
  );
  assert.deepEqual(installCalls, [
    { cacheHit: true, target: 'smoke', version: '1.60.0' },
    [
      path.join(
        runtimeDir,
        'node_modules/.bin',
        process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
      ),
      ['install-deps', 'chromium'],
      runtimeDir,
    ],
  ]);
  assert.throws(
    () =>
      installAcceptanceBrowsers(
        { target: 'smoke', version: '1.61.1' },
        {
          ensureBrowserSmokeRuntimeImpl: () => runtimeDir,
          runImpl: () =>
            assert.fail('a mismatched runtime must not install browsers'),
        },
      ),
    /Provisioned playwright 1\.60\.0 is not the 1\.61\.1 that keyed the browser cache/u,
  );

  assert.deepEqual(parseProvisionArgs(['--resolve', '--target', 'smoke']), {
    cacheHit: false,
    install: false,
    resolve: true,
    target: 'smoke',
  });
  assert.throws(
    () => parseProvisionArgs(['--target', 'smoke']),
    /exactly one of --resolve/u,
  );
  assert.throws(
    () => parseProvisionArgs(['--resolve', '--install', '--target', 'smoke']),
    /exactly one of --resolve/u,
  );
  assert.throws(
    () => parseProvisionArgs(['--resolve', '--resolve', '--target', 'smoke']),
    /Duplicate argument: --resolve/u,
  );
  assert.throws(
    () =>
      parseProvisionArgs([
        '--install',
        '--target',
        'smoke',
        '--cache-hit',
        'true',
        '--cache-hit',
        'false',
      ]),
    /Duplicate argument: --cache-hit/u,
  );
  assert.throws(
    () =>
      parseProvisionArgs([
        '--resolve',
        '--target',
        'smoke',
        '--cache-hit',
        'true',
      ]),
    /--cache-hit applies only to --install/u,
  );
  assert.throws(
    () =>
      parseProvisionArgs([
        '--install',
        '--target',
        'smoke',
        '--cache-hit',
        'maybe',
      ]),
    /--cache-hit requires true or false/u,
  );
  assert.throws(
    () => parseProvisionArgs(['--resolve']),
    /requires --target qualification or smoke/u,
  );
  assert.throws(
    () => parseProvisionArgs(['--resolve', '--target', 'browser']),
    /--target requires qualification or smoke/u,
  );
  writeJson(runtimeDir, 'node_modules/playwright/package.json', {
    name: 'playwright',
    version: 'latest',
  });
  assert.throws(
    () =>
      resolveAcceptanceBrowserVersion('smoke', {
        ensureBrowserSmokeRuntimeImpl: () => runtimeDir,
        playwrightPackage: 'playwright@latest',
      }),
    /must be an exact playwright version/u,
  );
  assert.throws(
    () =>
      resolveAcceptanceBrowserVersion('smoke', {
        ensureBrowserSmokeRuntimeImpl: () => path.join(runtimeDir, 'absent'),
        playwrightPackage: 'playwright@latest',
      }),
    /Playwright runtime is not installed at/u,
  );
  assert.throws(
    () =>
      acceptanceBrowserCacheKey({
        runnerOs: 'Linux',
        target: 'smoke',
        version: '1.60',
      }),
    /must be an exact playwright version/u,
  );
});

test('no workflow owns a Playwright installer, version literal, or lockfile-hashed browser cache', () => {
  const workflowDir = path.join(__dirname, '../../../.github/workflows');
  const offenders = [];
  for (const entry of fs.readdirSync(workflowDir).sort()) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) {
      continue;
    }
    const source = fs.readFileSync(path.join(workflowDir, entry), 'utf8');
    source.split('\n').forEach((line, index) => {
      if (
        /playwright@\d/u.test(line) ||
        /playwright-chromium-\d/u.test(line) ||
        /npx[^\n]*playwright/u.test(line) ||
        /playwright[^\n]*hashFiles/iu.test(line)
      ) {
        offenders.push(`${entry}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'Playwright version and installer ownership belongs to the acceptance runtime, not workflow YAML',
  );
});
