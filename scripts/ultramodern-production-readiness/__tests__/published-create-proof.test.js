const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writeJsonFile } = require('../../lib/fs-kit');
const { createProcessEnv } = require('../../lib/process-kit');

async function loadProof() {
  return import('../run-published-create-proof.mjs');
}

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

test('defines generated workspace scale profiles for 10, 25, and 50 verticals', async () => {
  const { scaleProfiles } = await loadProof();

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(scaleProfiles).map(([id, profile]) => [
        id,
        profile.verticalCount,
      ]),
    ),
    {
      'erp-10': 10,
      'erp-25': 25,
      'erp-50': 50,
    },
  );
});

test('generates readable first-ten verticals and deterministic safe names above ten', async () => {
  const { generateVerticalNames } = await loadProof();
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

test('parses scale profile and legacy custom vertical count requests', async () => {
  const { parseArgs } = await loadProof();

  assert.equal(parseArgs([]).createPackage, '@bleedingdev/modern-js-create');
  assert.equal(
    parseArgs(['--command-contract-only']).commandContractOnly,
    true,
  );

  const profiled = parseArgs([
    '--scale-profile',
    'erp-25',
    '--out',
    '.modern/example.json',
  ]);
  assert.equal(profiled.scaleProfile, 'erp-25');
  assert.equal(profiled.verticalCount, 25);
  assert.equal(path.isAbsolute(profiled.out), true);

  const custom = parseArgs(['--vertical-count', '3']);
  assert.equal(custom.scaleProfile, 'custom-3');
  assert.deepEqual(custom.verticals, ['inventory', 'finance', 'people']);

  assert.throws(
    () => parseArgs(['--scale-profile', 'erp-25', '--vertical-count', '10']),
    /does not match --scale-profile erp-25/,
  );
  assert.throws(
    () => parseArgs(['--scale-profile=erp-25']),
    /^Error: Unknown argument: --scale-profile=erp-25$/,
  );
});

test('builds the supported pnpm dlx package command contract', async () => {
  const { createCleanPnpmDlxEnv, createPnpmDlxArgs } = await loadProof();

  assert.deepEqual(
    createPnpmDlxArgs(
      {
        dlxSpecifier: '@bleedingdev/modern-js-create@latest',
        exactSpecifier: '@bleedingdev/modern-js-create@3.4.0-ultramodern.2',
      },
      ['my-super-app', '--lang', 'en'],
    ),
    [
      'dlx',
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
      'dlx',
      '@bleedingdev/modern-js-create@3.2.0-ultramodern.120',
      'catalog',
      '--vertical',
      '--lang',
      'en',
    ],
  );

  const root = path.join(os.tmpdir(), 'published-create-dlx-cache');
  assert.deepEqual(createCleanPnpmDlxEnv(root), {
    XDG_CACHE_HOME: path.join(root, 'xdg'),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_store_dir: path.join(root, 'store'),
    pnpm_config_store_dir: path.join(root, 'store'),
  });
});

test('shared ERP-10 profile requires frozen install, checks, both builds, and no framework override', async () => {
  const { createAcceptancePackageManagerEnv, requiredPnpmCommands } =
    await import('../published-create-proof/acceptance-profile.mjs');
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

test('snapshots the completed generated application source before building', async () => {
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
    runImpl('git', ['config', 'user.name', 'UltraModern Acceptance'], {
      cwd: root,
    });
    runImpl('git', ['config', 'user.email', 'acceptance@example.test'], {
      cwd: root,
    });
    fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}\n');
    runImpl('git', ['add', 'package.json'], { cwd: root });
    runImpl('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root });
    const initial = runImpl('git', ['rev-parse', 'HEAD'], { cwd: root });
    fs.mkdirSync(path.join(root, 'verticals', 'catalog'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, 'verticals', 'catalog', 'package.json'),
      '{"name":"catalog"}\n',
    );
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

    const revision = snapshotAcceptanceWorkspaceSource(root, {}, runImpl);

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
      createBrowserSmokeEnvironment('/tmp/playwright-runtime'),
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
    assert.deepEqual(JSON.parse(child.stdout), {});
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

test('builds Cloudflare proof args without a pnpm separator argument', async () => {
  const { createCloudflareProofArgs } = await loadProof();

  assert.deepEqual(createCloudflareProofArgs(), ['cloudflare:proof']);
  assert.deepEqual(createCloudflareProofArgs({ requirePublicUrls: true }), [
    'cloudflare:proof',
    '--require-public-urls',
  ]);
});

test('records skipped Cloudflare deploy proof evidence when deploy is disabled', async () => {
  const { createCloudflareDeployProofEvidence } = await loadProof();

  assert.deepEqual(createCloudflareDeployProofEvidence(), {
    id: 'cloudflare-deploy-proof',
    dimensions: ['integration', 'browser'],
    status: 'skipped',
    reason:
      'Cloudflare deploy proof was skipped because --deploy-cloudflare was not provided.',
    detail: {
      deployCloudflare: false,
      requiredFlag: '--deploy-cloudflare',
    },
  });
});

test('asserts generated cohorts only from strict manifest expectations and compact observations', async () => {
  const { assertGeneratedCohort } = await loadProof();
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

test('summarizes topology and generated contract evidence', async () => {
  const { createTopologyEvidence, generateVerticalNames } = await loadProof();
  const verticalNames = generateVerticalNames(3);

  const evidence = createTopologyEvidence({
    selectedProfile: {
      id: 'custom-3',
      verticalCount: 3,
    },
    verticalNames,
    packageCohortAssertion: {
      status: 'pass',
      expectedVersion: '1.2.3',
    },
    topology: {
      shell: {
        moduleFederation: {
          remotes: [{ id: 'inventory' }, { id: 'finance' }, { id: 'people' }],
          sharedContractVersion: 'mf-ssr-contract-v1',
        },
      },
      verticals: verticalNames.map(id => ({
        id,
        moduleFederation: {
          sharedContractVersion: 'mf-ssr-contract-v1',
        },
      })),
      sharedPackages: [{ id: 'shared-contracts' }],
    },
    generatedContract: {
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          moduleFederation: {
            remotes: [{ id: 'inventory' }],
            sharedContractVersion: 'mf-ssr-contract-v1',
          },
        },
        ...verticalNames.map(id => ({
          id,
          kind: 'vertical',
          moduleFederation: {
            sharedContractVersion: 'mf-ssr-contract-v1',
          },
        })),
      ],
    },
  });

  assert.equal(evidence.selectedProfile, 'custom-3');
  assert.equal(evidence.verticalCount, 3);
  assert.deepEqual(evidence.verticalNames, verticalNames);
  assert.equal(evidence.mfRemoteCount, 3);
  assert.deepEqual(evidence.contractCounts, {
    topologyVerticals: 3,
    topologySharedPackages: 1,
    generatedContractApps: 4,
    generatedContractVerticals: 3,
  });
  assert.equal(evidence.sharedVersionAssertions.packageCohort.status, 'pass');
  assert.equal(
    evidence.sharedVersionAssertions.moduleFederationSharedContract.status,
    'pass',
  );
});

test('marks mismatched MF shared contract versions as failed evidence', async () => {
  const { createTopologyEvidence } = await loadProof();

  const evidence = createTopologyEvidence({
    selectedProfile: {
      id: 'custom-1',
      verticalCount: 1,
    },
    verticalNames: ['inventory'],
    packageCohortAssertion: {
      status: 'pass',
      expectedVersion: '1.2.3',
    },
    topology: {
      shell: {
        moduleFederation: {
          sharedContractVersion: 'mf-ssr-contract-v1',
        },
      },
      verticals: [
        {
          id: 'inventory',
          moduleFederation: {
            sharedContractVersion: 'mf-ssr-contract-v2',
          },
        },
      ],
    },
    generatedContract: {
      apps: [],
    },
  });

  assert.equal(
    evidence.sharedVersionAssertions.moduleFederationSharedContract.status,
    'fail',
  );
  assert.deepEqual(
    evidence.sharedVersionAssertions.moduleFederationSharedContract.versions,
    ['mf-ssr-contract-v1', 'mf-ssr-contract-v2'],
  );
});
