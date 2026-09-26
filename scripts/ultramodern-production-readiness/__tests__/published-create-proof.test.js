const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writeJsonFile } = require('../../lib/fs-kit');
const { createGitFixture } = require('../../lib/git-fixture');
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
  // A create package the release-age policy cannot exclude makes the
  // documented bootstrap command fail against a freshly published cohort.
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
});

test('orders exact bootstrap specifiers when a reachable package name prefixes another', async () => {
  const { createPnpmDlxArgs, resolveCreatePackage } = await import(
    '../published-create-proof/package-cohort.mjs'
  );
  const release = makeBootstrapRelease('3.9.0-ultramodern.5');
  const { version } = release.release;
  const pluginTarget = '@bleedingdev/modern-js-plugin';
  const dataLoaderTarget = '@bleedingdev/modern-js-plugin-data-loader';
  Object.assign(release.aliases, {
    '@modern-js/plugin': pluginTarget,
    '@modern-js/plugin-data-loader': dataLoaderTarget,
  });
  release.createPackage.packageJson.dependencies[
    '@modern-js/plugin-data-loader'
  ] = `npm:${dataLoaderTarget}@${version}`;
  release.dependencyGraph[release.createPackage.targetName].push(
    dataLoaderTarget,
  );
  release.dependencyGraph[dataLoaderTarget] = [pluginTarget];
  release.dependencyGraph[pluginTarget] = [];
  release.packages.push(
    {
      sourceName: '@modern-js/plugin-data-loader',
      targetName: dataLoaderTarget,
      version,
      packageJson: {
        dependencies: {
          '@modern-js/plugin': `npm:${pluginTarget}@${version}`,
        },
      },
    },
    {
      sourceName: '@modern-js/plugin',
      targetName: pluginTarget,
      version,
      packageJson: {},
    },
  );
  release.publishOrder.push(pluginTarget, dataLoaderTarget);

  // pnpm rejects the whole bootstrap command when the exclusions are not
  // ordered on the full `name@version` specifier, which only shows up when one
  // package name is a prefix of another.
  const args = createPnpmDlxArgs(resolveCreatePackage(release), ['my-app']);
  assert.deepEqual(
    args.filter(argument =>
      argument.startsWith('--config.minimum-release-age-exclude='),
    ),
    [
      `--config.minimum-release-age-exclude=@bleedingdev/modern-js-i18n-utils@${version}`,
      `--config.minimum-release-age-exclude=${dataLoaderTarget}@${version}`,
      `--config.minimum-release-age-exclude=${pluginTarget}@${version}`,
      `--config.minimum-release-age-exclude=@bleedingdev/modern-js-ultramodern-create@${version}`,
      `--config.minimum-release-age-exclude=@bleedingdev/modern-js-utils@${version}`,
    ],
  );
});

test('fails closed when the authenticated create closure is omitted or version-skewed', async () => {
  const { resolveCreatePackage } = await import(
    '../published-create-proof/package-cohort.mjs'
  );

  const omitted = makeBootstrapRelease();
  omitted.dependencyGraph[omitted.createPackage.targetName] = [];
  assert.throws(
    () => resolveCreatePackage(omitted),
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

test('fresh-release installs use exact command-scoped cohort and sidecar selectors in both lanes', async () => {
  const { resolveAcceptanceReleaseAgeExclusions } = await import(
    '../published-create-proof/release-age-audit.mjs'
  );
  const { createAcceptanceReleaseAgeEnv } = await import(
    '../published-create-proof/acceptance-profile.mjs'
  );
  const { resolveCreatePackage } = await import(
    '../published-create-proof/package-cohort.mjs'
  );
  const release = makeBootstrapRelease();
  release.sidecars = {
    packages: [{ name: '@bleedingdev/mf-bridge-react', version: '1.0.0' }],
  };
  const published = resolveAcceptanceReleaseAgeExclusions({
    release,
    mode: 'published',
  });
  const source = resolveAcceptanceReleaseAgeExclusions({
    release,
    mode: 'source',
  });
  assert.equal(published.length, release.packages.length + 1);
  assert.ok(published.includes('@bleedingdev/mf-bridge-react@1.0.0'));
  assert.deepEqual(source, published);
  const env = createAcceptanceReleaseAgeEnv(
    { PATH: '/exact/pnpm' },
    resolveCreatePackage(release),
    source,
  );
  assert.equal(
    env.pnpm_config_minimum_release_age_exclude,
    JSON.stringify(source),
  );
  assert.equal(env.pnpm_config_minimum_release_age, '1440');
  assert.equal(env.pnpm_config_minimum_release_age_strict, 'true');
  assert.equal(env.PATH, '/exact/pnpm');
  release.sidecars.packages[0].version = '1.*';
  for (const mode of ['source', 'published']) {
    assert.throws(
      () => resolveAcceptanceReleaseAgeExclusions({ release, mode }),
      /Acceptance command release-age exclusions/u,
    );
  }
});

test('acceptance production builds and runtime proofs use the same explicit local deployment addresses', async () => {
  const { createAcceptanceBuildEnv, createAcceptanceDeploymentEnv } =
    await import('../published-create-proof/acceptance-profile.mjs');
  const { createSmokeTargets } = await import('../browser-smoke/targets.mjs');
  const contract = {
    apps: [
      {
        id: 'shell-super-app',
        kind: 'shell',
        config: {
          source: {
            siteUrl: {
              defaultLocalhostPort: 3020,
              envFallbackOrder: ['SHELL_SUPER_APP_PORT'],
            },
          },
        },
        deploy: {
          cloudflare: {
            publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
          },
        },
      },
      {
        id: 'analytics',
        kind: 'vertical',
        config: {
          source: {
            siteUrl: {
              defaultLocalhostPort: 3030,
              envFallbackOrder: ['ANALYTICS_PORT'],
            },
          },
        },
        deploy: {
          cloudflare: { publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_ANALYTICS' },
        },
      },
    ],
  };
  const packageManagerEnv = {
    NODE_ENV: 'production',
    ANALYTICS_PORT: '4030',
    ULTRAMODERN_PUBLIC_URL_ANALYTICS: 'https://unrelated.example',
    npm_config_registry: 'http://localhost:4873',
  };
  const deploymentEnv = createAcceptanceDeploymentEnv(
    contract,
    packageManagerEnv,
  );
  const buildEnv = createAcceptanceBuildEnv(deploymentEnv, {});
  const { targets } = createSmokeTargets(contract, { env: deploymentEnv });
  for (const target of targets) {
    assert.equal(buildEnv[target.publicUrlEnv], target.baseUrl);
    assert.equal(buildEnv[target.portEnv], String(target.port));
  }
  assert.equal(
    buildEnv.ULTRAMODERN_PUBLIC_URL_ANALYTICS,
    'http://localhost:4030',
  );
  assert.equal(buildEnv.NODE_ENV, 'production');
  assert.equal(
    buildEnv.npm_config_registry,
    packageManagerEnv.npm_config_registry,
  );
  assert.equal(
    packageManagerEnv.ULTRAMODERN_PUBLIC_URL_ANALYTICS,
    'https://unrelated.example',
  );
});

test('acceptance smoke ports stay reserved through build and release for runtime startup', async () => {
  const { createAcceptanceDeploymentEnv, reserveAcceptanceSmokePorts } =
    await import('../published-create-proof/acceptance-profile.mjs');
  const contract = {
    apps: [
      {
        id: 'shell-super-app',
        kind: 'shell',
        config: {
          source: {
            siteUrl: {
              defaultLocalhostPort: 3020,
              envFallbackOrder: ['SHELL_SUPER_APP_PORT'],
            },
          },
        },
        deploy: {
          cloudflare: {
            publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
          },
        },
      },
    ],
  };
  const first = await reserveAcceptanceSmokePorts(contract);
  const second = await reserveAcceptanceSmokePorts(contract);
  try {
    const firstPort = Number(first.portEnv.SHELL_SUPER_APP_PORT);
    const secondPort = Number(second.portEnv.SHELL_SUPER_APP_PORT);
    assert.ok(firstPort > 0);
    assert.ok(secondPort > 0);
    assert.notEqual(firstPort, secondPort);
    const deploymentEnv = createAcceptanceDeploymentEnv(
      contract,
      first.portEnv,
    );
    assert.equal(
      deploymentEnv.ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP,
      `http://localhost:${firstPort}`,
    );
    await first.release();
    await first.release();
    const rebound = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        rebound.once('error', reject);
        rebound.listen(firstPort, '127.0.0.1', resolve);
      });
    } finally {
      await new Promise((resolve, reject) =>
        rebound.close(error => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await first.release();
    await second.release();
  }
});

test('acceptance children never inherit a source create bin or framework override', async () => {
  const { createAcceptancePackageManagerEnv } = await import(
    '../published-create-proof/acceptance-profile.mjs'
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
    // A leaked source create bin makes the published-package proof silently
    // run the local checkout instead of the published tarball.
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

test('the provisioned pnpm wins over a stale shim and a version mismatch fails closed', async t => {
  const { resolveExactPnpmExecutable } = await import(
    '../published-create-proof/acceptance-profile.mjs'
  );
  const exactPnpmDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-exact-pnpm-'),
  );
  t.after(() => fs.rmSync(exactPnpmDir, { force: true, recursive: true }));
  const pnpmBinaryName = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const exactPnpmExecutable = path.join(exactPnpmDir, pnpmBinaryName);
  fs.writeFileSync(exactPnpmExecutable, 'acceptance test executable');
  fs.chmodSync(exactPnpmExecutable, 0o755);
  const stalePnpmDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-stale-pnpm-shim-'),
  );
  t.after(() => fs.rmSync(stalePnpmDir, { force: true, recursive: true }));
  const stalePnpmExecutable = path.join(stalePnpmDir, pnpmBinaryName);
  fs.writeFileSync(stalePnpmExecutable, 'stale acceptance test executable');
  fs.chmodSync(stalePnpmExecutable, 0o755);

  assert.equal(
    resolveExactPnpmExecutable(
      command => {
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
  // Installing the acceptance workspace with a pnpm the manifest did not pin
  // produces a lockfile the release never validated.
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

  const cleanClosure = [{ name: 'clean-dependency', version: '1.0.0' }];
  assert.deepEqual(assertDefaultOffRscInstall(root, cleanClosure), {
    appPackage: '@acceptance/shell',
    forbiddenDependencyCount: 0,
    renderClient: fs.realpathSync(path.join(renderRoot, 'client.js')),
  });

  assert.throws(
    () =>
      assertDefaultOffRscInstall(
        root,
        cleanClosure.concat({
          name: 'rsbuild-plugin-rsc',
          version: '0.1.1',
        }),
      ),
    /contains forbidden RSC dependencies: rsbuild-plugin-rsc/u,
  );

  // A default-off app that can still resolve the RSC client ships a second
  // React runtime into the user's bundle.
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
    () => assertDefaultOffRscInstall(root, cleanClosure),
    /must not resolve react-server-dom-rspack\/client\.browser/u,
  );
});

test('acceptance Git setup refuses to commit into an enclosing repository', async () => {
  const { configureAcceptanceWorkspaceGit } = await import(
    '../published-create-proof/acceptance-profile.mjs'
  );
  const fixture = createGitFixture({ prefix: 'acceptance-git-root-' });
  const parent = fixture.repoDir;
  const nested = path.join(parent, 'generated');
  const calls = [];
  const runImpl = (command, args, options = {}) => {
    calls.push(args);
    const result = spawnSync(command, args, {
      cwd: options.cwd ?? parent,
      encoding: 'utf8',
      env: options.env ?? fixture.env,
      stdio: 'pipe',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  try {
    fs.mkdirSync(nested, { recursive: true });
    runImpl('git', ['init', '--quiet']);
    fs.writeFileSync(path.join(parent, 'tracked.txt'), 'initial\n');
    runImpl('git', ['add', 'tracked.txt']);
    runImpl('git', ['commit', '--quiet', '-m', 'initial']);
    fs.writeFileSync(path.join(parent, 'tracked.txt'), 'staged\n');
    runImpl('git', ['add', 'tracked.txt']);
    fs.writeFileSync(path.join(parent, 'tracked.txt'), 'unstaged\n');
    fs.writeFileSync(path.join(nested, 'package.json'), '{"private":true}\n');
    const originalHead = runImpl('git', ['rev-parse', 'HEAD']);
    const originalFiles = new Map(
      ['HEAD', 'index', 'config'].map(name => [
        name,
        fs.readFileSync(path.join(parent, '.git', name)),
      ]),
    );

    // Running the proof inside somebody's checkout must not stage, commit, or
    // rewrite their working tree.
    calls.length = 0;
    assert.throws(
      () => configureAcceptanceWorkspaceGit(nested, fixture.env, runImpl),
      /workspace must be its own Git root:.*Use a work directory outside an existing repository/u,
    );
    assert.deepEqual(calls, [['rev-parse', '--show-toplevel']]);
    for (const [name, original] of originalFiles) {
      assert.deepEqual(
        fs.readFileSync(path.join(parent, '.git', name)),
        original,
        `parent ${name} changed`,
      );
    }
    assert.equal(runImpl('git', ['rev-parse', 'HEAD']), originalHead);
  } finally {
    fixture.cleanup();
  }
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

test('asserts generated cohorts only from strict manifest expectations', async () => {
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
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      `catalogs:\n  ultramodern:\n    '@modern-js/ultramodern-create': npm:@bleedingdev/modern-js-ultramodern-create@${version}\n    '@modern-js/runtime': npm:@bleedingdev/modern-js-runtime@${version}\n`,
    );
    writeJson(root, 'package.json', {
      devDependencies: {
        '@modern-js/ultramodern-create': 'catalog:ultramodern',
      },
      dependencies: {
        '@modern-js/runtime': 'catalog:ultramodern',
      },
    });
    const producer = 'node_modules/@modern-js/ultramodern-create';
    writeJson(root, `${producer}/package.json`, {
      name: '@bleedingdev/modern-js-ultramodern-create',
      version,
    });
    release.cohortProjection = {
      sha256: writeCanonicalJson(
        root,
        `${producer}/release-cohort.json`,
        cohortProjection,
      ),
      value: cohortProjection,
    };

    assert.equal(assertGeneratedCohort(root, release).observedPackageCount, 2);

    release.sidecars = {
      packages: [{ name: '@bleedingdev/mf-bridge-react', version: '1.0.0' }],
    };
    writeJson(root, 'package.json', {
      devDependencies: {
        '@modern-js/ultramodern-create': 'catalog:ultramodern',
      },
      dependencies: {
        '@modern-js/runtime': 'catalog:ultramodern',
        '@module-federation/bridge-react':
          'npm:@bleedingdev/mf-bridge-react@1.0.0',
      },
    });
    assert.equal(assertGeneratedCohort(root, release).observedPackageCount, 2);
    writeJson(root, 'package.json', {
      dependencies: {
        '@modern-js/runtime': 'catalog:ultramodern',
        '@module-federation/bridge-react':
          'npm:@bleedingdev/mf-bridge-react@1.0.1',
      },
    });
    assert.throws(
      () => assertGeneratedCohort(root, release),
      /must target exact verified sidecar/u,
    );
    writeJson(root, 'package.json', {
      dependencies: {
        '@modern-js/runtime': 'catalog:ultramodern',
        '@module-federation/bridge-react':
          'npm:@bleedingdev/unknown-sidecar@1.0.0',
      },
    });
    assert.throws(
      () => assertGeneratedCohort(root, release),
      /unknown BleedingDev cohort target/u,
    );
    writeJson(root, 'package.json', {
      devDependencies: {
        '@modern-js/ultramodern-create': 'catalog:ultramodern',
      },
      dependencies: {
        '@modern-js/runtime': 'catalog:ultramodern',
      },
    });

    const catalogPath = path.join(root, 'pnpm-workspace.yaml');
    const catalog = fs.readFileSync(catalogPath, 'utf8');
    fs.writeFileSync(
      catalogPath,
      catalog.replace(/^ {4}'@modern-js\/runtime'.*\n/mu, ''),
    );
    assert.throws(
      () => assertGeneratedCohort(root, release),
      /pnpm catalog ultramodern omits @modern-js\/runtime/u,
    );
    fs.writeFileSync(catalogPath, catalog);

    // A generated manifest carrying a range instead of the exact cohort
    // version silently installs a different framework build for the user.
    writeJson(root, 'package.json', {
      devDependencies: {
        '@modern-js/ultramodern-create': 'catalog:ultramodern',
      },
      dependencies: {
        '@modern-js/runtime': 'catalog:ultramodern',
        'runtime-compat':
          'npm:@bleedingdev/modern-js-runtime@^3.2.0-framework.1',
      },
    });
    assert.throws(
      () => assertGeneratedCohort(root, release),
      /runtime-compat must target exact cohort package @bleedingdev\/modern-js-runtime@3\.2\.0-framework\.1/u,
    );

    // The installed producer must carry the authenticated projection.
    fs.rmSync(path.join(root, producer, 'release-cohort.json'));
    assert.throws(
      () => assertGeneratedCohort(root, release),
      /authenticated release cohort is missing or unsafe/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
