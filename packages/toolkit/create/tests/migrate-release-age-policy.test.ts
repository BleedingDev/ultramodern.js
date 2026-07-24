import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import { buildDependencyClosure } from '../../../../scripts/ultramodern-production-readiness/published-create-proof/release-age-audit.mjs';
import type { ResolvedUltramodernPackageSource } from '../src/ultramodern-package-source';
import { parseUltramodernReleaseCohort } from '../src/ultramodern-release-cohort';
import {
  type ReleaseAgeRegistryFetch,
  validateGeneratedPnpmLockReleaseAgePolicy,
} from '../src/ultramodern-tooling/commands/migrate-strict-effect/pnpm-policy';
import { discoverReachablePnpmLockReleaseAgeClosure } from '../src/ultramodern-tooling/commands/migrate-strict-effect/pnpm-yaml';
import {
  renderMinimumReleaseAgeExclude,
  ULTRAMODERN_WORKSPACE_POLICY,
  validateReleaseAgeApprovals,
} from '../src/ultramodern-workspace/policy';

const now = new Date('2026-07-10T12:00:00.000Z');
const packageSource: ResolvedUltramodernPackageSource = {
  strategy: 'install',
  modernPackageVersion: '3.5.0-ultramodern.1',
  registry: 'https://registry.npmjs.org/',
  aliasScope: 'bleedingdev',
  aliasPackageNamePrefix: 'modern-js-',
};
const integrity =
  'sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==';
const releaseCohort = parseUltramodernReleaseCohort({
  aliases: {
    '@modern-js/create': '@bleedingdev/modern-js-create',
  },
  packages: [
    {
      sourceName: '@modern-js/create',
      targetName: '@bleedingdev/modern-js-create',
      version: packageSource.modernPackageVersion,
    },
  ],
  release: { tag: 'latest', version: packageSource.modernPackageVersion },
  schema: 'bleedingdev.ultramodern.release-cohort',
  schemaVersion: 1,
  source: {
    commit: 'a'.repeat(40),
    repository: 'bleedingdev/modern.js',
  },
});

const effectReviewReason =
  'Reviewed Effect 4 beta cohort required by generated strict Effect workspaces before pnpm minimum release age elapsed.';
const cloudflareReviewReason =
  'Reviewed Cloudflare runtime cohort required by generated Worker tooling before pnpm minimum release age elapsed.';

test('does not treat Module Federation registry evidence as a release-age approval', () => {
  const moduleFederation =
    ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.registryEvidence
      .moduleFederation;
  assert.equal(moduleFederation.version, '2.8.0');
  assert.equal(moduleFederation.nodeVersion, '2.7.47');
  assert.equal(moduleFederation.releases.length, 18);
  assert.equal(
    moduleFederation.releases.find(
      release => release.packageName === '@module-federation/modern-js-v3',
    )?.registry.publishedAt,
    '2026-07-15T09:17:49.953Z',
  );
  assert.equal(
    moduleFederation.node.registry.dist.integrity,
    'sha512-mifMvCjWmLl53GS+badQws0j2bsu1ICpdGzCbez4I6kSpaYA8v86L6dwcHtVHIZtkUC6cjAZBDcgpxs4fK3nFQ==',
  );
  assert.equal(
    ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals.some(approval =>
      approval.packageName.startsWith('@module-federation/'),
    ),
    false,
  );
});

test('rejects review evidence created before a dependency was published', () => {
  const existing = ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals[0];
  assert.ok(existing);

  assert.throws(
    () =>
      validateReleaseAgeApprovals([
        {
          ...existing,
          packageName: '@module-federation/runtime',
          version: '2.8.0',
          reviewedAt: '2026-07-09T20:51:39.000Z',
          registry: {
            publishedAt: '2026-07-15T09:16:02.203Z',
            dist: {
              integrity:
                'sha512-cGtUBQ1/TVy7KrXy6xPgy3FEmOGyIYkBA2T4iGH3ZH5PNPPTmqN9jF2AfneTSOj0RtBr7Pxq3CUt81E/UCvK1A==',
            },
          },
        },
      ]),
    /cannot be reviewed before its registry publish time/u,
  );
});

test('pins exact approval evidence for every fresh Effect and Cloudflare dependency', () => {
  const expected = new Map([
    [
      '@effect/opentelemetry',
      [
        '4.0.0-beta.97',
        '2026-07-10T00:07:44.725Z',
        'sha512-x9yPmb8K8D0GLlGogz28VpKN6q5va9Zvti8kA3Mq1DgTIQf2641Tt6UbhlYfvHxjtwE/mVgztuuapjN8qlDLBw==',
        effectReviewReason,
      ],
    ],
    [
      '@effect/vitest',
      [
        '4.0.0-beta.97',
        '2026-07-10T00:07:56.326Z',
        'sha512-1dH6LBWSZyqnTV7ZO+yIpPGPf/xd7RtFfvQ4ZpTy9elzFN+wr1YBFpHSCr8+BfXOml6b8g9Mtj5eDy1qjbizUA==',
        effectReviewReason,
      ],
    ],
    [
      'effect',
      [
        '4.0.0-beta.97',
        '2026-07-10T00:07:52.514Z',
        'sha512-pK03HpQVxGZOWdwDAy/iwvV8u3KYcUf2mOWyWqaut2zau8V2u6ejWP7b4BELjyUIiZWW1fl/s/VJpgZUcTjThg==',
        effectReviewReason,
      ],
    ],
    [
      '@cloudflare/workers-types',
      [
        '5.20260710.1',
        '2026-07-10T01:13:24.132Z',
        'sha512-4ooaY2Pb5XGwDn8Fzm6jnTAJkIX0R5LBvL9euQpp2T58sQItlAQd9yivAlkwGhpY5cM1u81/9HaXwKAjXwtyzA==',
        cloudflareReviewReason,
      ],
    ],
    [
      'miniflare',
      [
        '4.20260708.1',
        '2026-07-09T18:25:09.203Z',
        'sha512-c94O9zRDISdqO18EHt6l0iF/fWgWt8p18PJvRsA/L/NJZ9Cfke3s/F5Blg1XXF7WDutVRzWVWy8Vy4LaT5ifsA==',
        cloudflareReviewReason,
      ],
    ],
    [
      'wrangler',
      [
        '4.110.0',
        '2026-07-09T18:25:09.429Z',
        'sha512-xZeXKYi7hxQRF5anL+v77RkufJNpF9f3Eqeyqq2QBsETpLZgh0Agj0jJ6JPtkbgn6ukZdh8OK5egsGPWIditgg==',
        cloudflareReviewReason,
      ],
    ],
  ]);
  const approvals = ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals;

  assert.equal(expected.size, 6);
  for (const [
    packageName,
    [version, publishedAt, integrity, reason],
  ] of expected) {
    const approval = approvals.find(item => item.packageName === packageName);
    assert.deepEqual(
      approval && [
        approval.version,
        approval.registry.publishedAt,
        approval.registry.dist.integrity,
        approval.reason,
      ],
      [version, publishedAt, integrity, reason],
      `approval evidence for ${packageName}`,
    );
  }
});

function packageKey(packageName: string, version: string) {
  return `${packageName}@${version}`;
}

function createWorkspace(lockfile: Record<string, unknown>) {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-release-age-'),
  );
  fs.writeFileSync(
    path.join(workspaceRoot, 'pnpm-workspace.yaml'),
    yaml.dump({
      minimumReleaseAgeExclude: renderMinimumReleaseAgeExclude({
        now,
        packageSource,
        releaseCohort,
      }),
    }),
  );
  fs.writeFileSync(
    path.join(workspaceRoot, 'pnpm-lock.yaml'),
    yaml.dump(lockfile),
  );
  fs.mkdirSync(path.join(workspaceRoot, '.modernjs'), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, '.modernjs/release-cohort.json'),
    `${JSON.stringify(releaseCohort, null, 2)}\n`,
  );
  return workspaceRoot;
}

function lockfileWithImporter(
  dependencyName: string,
  version: string,
  options: {
    specifier?: string;
    packages?: Record<string, unknown>;
    snapshots?: Record<string, unknown>;
  } = {},
) {
  return {
    lockfileVersion: '9.0',
    importers: {
      '.': {
        dependencies: {
          [dependencyName]: {
            specifier: options.specifier ?? version,
            version,
          },
        },
      },
    },
    packages: options.packages ?? {
      [version]: { resolution: { integrity } },
    },
    snapshots: options.snapshots ?? {
      [version]: {},
    },
  };
}

function packument(
  version: string,
  publishedAt: string,
  packageIntegrity = integrity,
) {
  return {
    time: { [version]: publishedAt },
    versions: {
      [version]: {
        dist: { integrity: packageIntegrity },
      },
    },
  };
}

function registryFetch(
  packuments: Record<string, Record<string, unknown>>,
): ReleaseAgeRegistryFetch {
  return async url => {
    const packageName = decodeURIComponent(url.pathname.replace(/^\//u, ''));
    const packument = packuments[packageName];
    return {
      ok: Boolean(packument),
      status: packument ? 200 : 404,
      json: async () => packument,
    };
  };
}

function validate(
  workspaceRoot: string,
  packuments: Record<string, Record<string, unknown>> = {},
) {
  return validateGeneratedPnpmLockReleaseAgePolicy(
    workspaceRoot,
    packageSource,
    {
      fetchImpl: registryFetch(packuments),
      now,
      registryUrl: 'https://registry.example.test/',
      releaseCohort,
    },
  );
}

test('accepts a reachable aliased first-party cohort member without static approval', async () => {
  const target = '@bleedingdev/modern-js-create@3.5.0-ultramodern.1';
  const workspaceRoot = createWorkspace(
    lockfileWithImporter('@modern-js/create', target, {
      specifier: 'npm:@bleedingdev/modern-js-create@3.5.0-ultramodern.1',
    }),
  );

  try {
    assert.deepEqual((await validate(workspaceRoot)).reviewCandidates, []);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ignores unreachable lockfile entries when validating the release-age closure', async () => {
  const target = '@bleedingdev/modern-js-create@3.5.0-ultramodern.1';
  const unreachable = '@unreachable/invalid@1.0.0';
  const workspaceRoot = createWorkspace(
    lockfileWithImporter('@modern-js/create', target, {
      specifier: 'npm:@bleedingdev/modern-js-create@3.5.0-ultramodern.1',
      packages: {
        [target]: { resolution: { integrity } },
        [unreachable]: { resolution: { integrity: 'not-an-sri' } },
      },
      snapshots: {
        [target]: {},
        [unreachable]: {},
      },
    }),
  );

  try {
    assert.deepEqual((await validate(workspaceRoot)).reviewCandidates, []);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a reachable immature dependency without an exact reviewed integrity', async () => {
  const approval = ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals[0];
  const target = packageKey(approval.packageName, approval.version);
  const workspaceRoot = createWorkspace(
    lockfileWithImporter(approval.packageName, target, {
      packages: {
        [target]: { resolution: { integrity } },
      },
    }),
  );

  try {
    await assert.rejects(
      () =>
        validate(workspaceRoot, {
          [approval.packageName]: packument(
            approval.version,
            '2026-07-10T11:00:00.000Z',
          ),
        }),
      new RegExp(
        `Release-age approval ${target} does not match lock integrity`,
        'u',
      ),
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a reachable immature dependency without an approval', async () => {
  const target = 'unapproved-package@1.0.0';
  const workspaceRoot = createWorkspace(
    lockfileWithImporter('unapproved-package', target),
  );

  try {
    await assert.rejects(
      () =>
        validate(workspaceRoot, {
          'unapproved-package': packument('1.0.0', '2026-07-10T11:00:00.000Z'),
        }),
      /Dependency closure contains 1 immature package\(s\) without an exact, unexpired approval:[\s\S]*unapproved-package@1\.0\.0/u,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('accepts a reachable mature dependency without an approval', async () => {
  const target = 'mature-package@1.0.0';
  const workspaceRoot = createWorkspace(
    lockfileWithImporter('mature-package', target),
  );

  try {
    assert.deepEqual(
      (
        await validate(workspaceRoot, {
          'mature-package': packument('1.0.0', '2026-07-01T12:00:00.000Z'),
        })
      ).reviewCandidates,
      [],
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('traverses reachable snapshot dependencies before resolving approvals', async () => {
  const approval = ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals[0];
  const target = '@bleedingdev/modern-js-create@3.5.0-ultramodern.1';
  const approvedTarget = packageKey(approval.packageName, approval.version);
  const workspaceRoot = createWorkspace(
    lockfileWithImporter('@modern-js/create', target, {
      specifier: 'npm:@bleedingdev/modern-js-create@3.5.0-ultramodern.1',
      packages: {
        [target]: { resolution: { integrity } },
        [approvedTarget]: { resolution: { integrity } },
      },
      snapshots: {
        [target]: {
          dependencies: {
            [approval.packageName]: approval.version,
          },
        },
        [approvedTarget]: {},
      },
    }),
  );

  try {
    await assert.rejects(
      () =>
        validate(workspaceRoot, {
          [approval.packageName]: packument(
            approval.version,
            '2026-07-10T11:00:00.000Z',
          ),
        }),
      new RegExp(
        `Release-age approval ${approvedTarget} does not match lock integrity`,
        'u',
      ),
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('matches the production audit closure for reachable pnpm graph entries', () => {
  const root = '@bleedingdev/modern-js-create@3.5.0-ultramodern.1';
  const nested = 'nested-package@1.0.0';
  const lockfile = lockfileWithImporter('@modern-js/create', root, {
    specifier: 'npm:@bleedingdev/modern-js-create@3.5.0-ultramodern.1',
    packages: {
      [root]: { resolution: { integrity } },
      [nested]: { resolution: { integrity } },
    },
    snapshots: {
      [root]: {
        dependencies: {
          'nested-package': '1.0.0',
        },
      },
      [nested]: {},
    },
  });

  const migrationClosure = discoverReachablePnpmLockReleaseAgeClosure(lockfile);
  const productionClosure = buildDependencyClosure(lockfile);

  assert.deepEqual(migrationClosure.unresolved, productionClosure.unresolved);
  assert.deepEqual(
    migrationClosure.candidates,
    productionClosure.closure.map(candidate => ({
      packageName: candidate.name,
      version: candidate.version,
      registry: { dist: { integrity: candidate.integrity } },
      path: candidate.path,
    })),
  );
});

test('matches the production audit closure across peer-variant snapshots', () => {
  const peerA = 'peer-a@1.0.0';
  const peerB = 'peer-b@1.0.0';
  const variantA = `variant@1.0.0(${peerA})`;
  const variantB = `variant@1.0.0(${peerB})`;
  const lockfile = lockfileWithImporter('variant', variantA, {
    packages: {
      [peerA]: { resolution: { integrity } },
      [peerB]: { resolution: { integrity } },
      [variantA]: { resolution: { integrity } },
      [variantB]: { resolution: { integrity } },
    },
    snapshots: {
      [peerA]: {},
      [peerB]: {},
      [variantA]: {},
      [variantB]: {},
    },
  });

  const migrationClosure = discoverReachablePnpmLockReleaseAgeClosure(lockfile);
  const productionClosure = buildDependencyClosure(lockfile);

  assert.deepEqual(migrationClosure.unresolved, productionClosure.unresolved);
  assert.deepEqual(
    migrationClosure.candidates,
    productionClosure.closure.map(candidate => ({
      packageName: candidate.name,
      version: candidate.version,
      registry: { dist: { integrity: candidate.integrity } },
      path: candidate.path,
    })),
  );
});

test('accepts pnpm 11.17 base package records and nested peer snapshot locators', () => {
  const root = '@bleedingdev/modern-js-plugin-tanstack@3.5.0-ultramodern.77';
  const nestedPeer = 'nested-peer@2.0.0';
  const directPeer = `direct-peer@1.0.0(${nestedPeer})`;
  const rootSnapshot = `${root}(${directPeer})(patch_hash=${'a'.repeat(
    64,
  )})(${'b'.repeat(32)})`;
  const lockfile = lockfileWithImporter(
    '@modern-js/plugin-tanstack',
    rootSnapshot,
    {
      specifier:
        'npm:@bleedingdev/modern-js-plugin-tanstack@3.5.0-ultramodern.77',
      packages: {
        [root]: { resolution: { integrity } },
        'direct-peer@1.0.0': { resolution: { integrity } },
        [nestedPeer]: { resolution: { integrity } },
      },
      snapshots: {
        [rootSnapshot]: {},
        [directPeer]: {},
        [nestedPeer]: {},
      },
    },
  );

  const migrationClosure = discoverReachablePnpmLockReleaseAgeClosure(lockfile);
  const productionClosure = buildDependencyClosure(lockfile);

  assert.deepEqual(migrationClosure.unresolved, []);
  assert.deepEqual(productionClosure.unresolved, []);
  assert.deepEqual(
    migrationClosure.candidates.map(candidate => candidate.packageName).sort(),
    ['@bleedingdev/modern-js-plugin-tanstack', 'direct-peer', 'nested-peer'],
  );
  assert.deepEqual(
    migrationClosure.candidates,
    productionClosure.closure.map(candidate => ({
      packageName: candidate.name,
      version: candidate.version,
      registry: { dist: { integrity: candidate.integrity } },
      path: candidate.path,
    })),
  );
});

test('rejects a reachable importer dependency missing from packages and snapshots', async () => {
  const workspaceRoot = createWorkspace(
    lockfileWithImporter('missing-package', '1.0.0', {
      packages: {},
      snapshots: {},
    }),
  );

  try {
    await assert.rejects(
      () => validate(workspaceRoot),
      /Dependency closure has unresolved candidates:[\s\S]*missing lock snapshot/u,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a reachable package entry with no matching snapshot', async () => {
  const workspaceRoot = createWorkspace(
    lockfileWithImporter('missing-snapshot', '1.0.0', {
      packages: {
        'missing-snapshot@1.0.0': { resolution: { integrity } },
      },
      snapshots: {},
    }),
  );

  try {
    await assert.rejects(
      () => validate(workspaceRoot),
      /Dependency closure has unresolved candidates:[\s\S]*missing lock snapshot/u,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects HTTP registries and disables registry redirects', async () => {
  const target = 'unapproved-package@1.0.0';
  const workspaceRoot = createWorkspace(
    lockfileWithImporter('unapproved-package', target),
  );

  try {
    await assert.rejects(
      () =>
        validateGeneratedPnpmLockReleaseAgePolicy(
          workspaceRoot,
          packageSource,
          {
            fetchImpl: registryFetch({}),
            now,
            registryUrl: 'http://registry.example.test/',
            releaseCohort,
          },
        ),
      /Registry URL must use HTTPS/u,
    );

    await assert.rejects(
      () =>
        validateGeneratedPnpmLockReleaseAgePolicy(
          workspaceRoot,
          packageSource,
          {
            fetchImpl: async (_url, init) => {
              assert.equal(init.redirect, 'error');
              throw new Error('redirect rejected');
            },
            now,
            registryUrl: 'https://registry.example.test/',
            releaseCohort,
          },
        ),
      /Registry metadata is uncertain.*redirect rejected/u,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('bounds registry metadata concurrency and retries transient transport failures', async () => {
  const packageNames = Array.from(
    { length: 20 },
    (_, index) => `registry-load-${index}`,
  );
  const version = '1.0.0';
  const dependencies = Object.fromEntries(
    packageNames.map(packageName => [
      packageName,
      { specifier: version, version },
    ]),
  );
  const packages = Object.fromEntries(
    packageNames.map(packageName => [
      `${packageName}@${version}`,
      { resolution: { integrity } },
    ]),
  );
  const snapshots = Object.fromEntries(
    packageNames.map(packageName => [`${packageName}@${version}`, {}]),
  );
  const workspaceRoot = createWorkspace({
    lockfileVersion: '9.0',
    importers: { '.': { dependencies } },
    packages,
    snapshots,
  });
  let active = 0;
  let maximumActive = 0;
  const attempts = new Map<string, number>();

  try {
    await validateGeneratedPnpmLockReleaseAgePolicy(
      workspaceRoot,
      packageSource,
      {
        async fetchImpl(url) {
          const packageName = decodeURIComponent(
            url.pathname.replace(/^\//u, ''),
          );
          const attempt = (attempts.get(packageName) ?? 0) + 1;
          attempts.set(packageName, attempt);
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          try {
            await new Promise(resolve => setTimeout(resolve, 1));
            if (packageName === packageNames[0] && attempt === 1) {
              throw new Error('transient socket reset');
            }
            return {
              ok: true,
              status: 200,
              json: async () => packument(version, '2026-07-01T00:00:00.000Z'),
            };
          } finally {
            active -= 1;
          }
        },
        now,
        registryUrl: 'https://registry.example.test/',
        releaseCohort,
      },
    );
    assert.equal(attempts.get(packageNames[0]), 2);
    assert.ok(
      maximumActive <= 16,
      `registry audit exceeded its 16-request bound: ${maximumActive}`,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects package-source aliases that rebind the authenticated cohort', () => {
  assert.throws(
    () =>
      renderMinimumReleaseAgeExclude({
        now,
        packageSource: {
          ...packageSource,
          aliasScope: 'attacker',
        },
        releaseCohort,
      }),
    /Package source aliases rebind the authenticated release cohort/u,
  );
});

test('reports malformed reachable descriptors and peer locators as unresolved', () => {
  const malformedDescriptorValues: unknown[] = [
    undefined,
    '',
    1,
    {},
    '01.02.03',
    '1.0.0-',
    '1.0.0-..',
    '1.0.0+..',
  ];
  for (const version of malformedDescriptorValues) {
    const lockfile = lockfileWithImporter('malformed', 'malformed@1.0.0');
    (lockfile.importers['.'] as Record<string, any>).dependencies.malformed = {
      specifier: '1.0.0',
      ...(version === undefined ? {} : { version }),
    };
    assert.match(
      discoverReachablePnpmLockReleaseAgeClosure(lockfile).unresolved[0]
        ?.reason ?? '',
      /descriptor version/u,
    );
  }

  for (const locator of [
    'variant@1.0.0(peer@)',
    'variant@1.0.0(peer@workspace:*)',
    'variant@1.0.0(peer@https://example.test/peer.tgz)',
    'variant@1.0.0(peer@01.02.03)',
    'variant@1.0.0(peer@1.0.0-..)',
    'variant@01.02.03(peer@1.0.0)',
    'variant@1.0.0(peer@1.0.0',
  ]) {
    const closure = discoverReachablePnpmLockReleaseAgeClosure(
      lockfileWithImporter('variant', locator, {
        packages: {},
        snapshots: {},
      }),
    );
    assert.match(
      closure.unresolved[0]?.reason ?? '',
      /non-exact dependency locator/u,
      locator,
    );
  }
});
