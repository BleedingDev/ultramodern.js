const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writeJsonFile } = require('../../lib/fs-kit');

async function loadProof() {
  return import('../run-published-create-proof.mjs');
}

function writeJson(root, relativePath, value) {
  writeJsonFile(path.join(root, relativePath), value, { atomic: false });
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

test('builds Cloudflare proof args without a pnpm separator argument', async () => {
  const { createCloudflareProofArgs } = await loadProof();

  assert.deepEqual(createCloudflareProofArgs(), ['cloudflare:proof']);
  assert.deepEqual(createCloudflareProofArgs({ requirePublicUrls: true }), [
    'cloudflare:proof',
    '--require-public-urls',
  ]);
});

test('asserts generated cohorts from package source metadata and framework version', async () => {
  const { assertGeneratedCohort } = await loadProof();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'published-create-cohort-'),
  );

  try {
    writeJson(root, '.modernjs/ultramodern-package-source.json', {
      schemaVersion: 1,
      strategy: 'install',
      modernPackages: {
        packages: ['@modern-js/runtime'],
        specifier: '3.2.0-framework.1',
        aliases: {
          '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
        },
      },
    });
    writeJson(root, '.modernjs/ultramodern-workspace-template-manifest.json', {
      packageSource: {
        modernPackageSpecifier: '3.2.0-framework.1',
      },
      template: {
        version: '3.2.0-create.1',
      },
    });
    writeJson(root, 'package.json', {
      dependencies: {
        '@modern-js/runtime':
          'npm:@bleedingdev/modern-js-runtime@3.2.0-framework.1',
      },
    });

    assert.doesNotThrow(() =>
      assertGeneratedCohort(root, '3.2.0-framework.1', {
        expectedTemplateVersion: '3.2.0-create.1',
      }),
    );

    writeJson(root, 'package.json', {
      dependencies: {
        '@modern-js/runtime':
          'npm:@bleedingdev/modern-js-runtime@3.2.0-framework.1',
        '@modern-js/app-tools':
          'npm:@bleedingdev/modern-js-app-tools@3.2.0-framework.1',
      },
    });

    assert.throws(
      () =>
        assertGeneratedCohort(root, '3.2.0-framework.1', {
          expectedTemplateVersion: '3.2.0-create.1',
        }),
      /declares @modern-js\/app-tools outside package source metadata/,
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
