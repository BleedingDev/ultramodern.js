import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import {
  buildDependencyClosure,
  validateExactExclusions,
} from '../../../../scripts/ultramodern-production-readiness/published-create-proof/release-age-audit.mjs';
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

test('does not treat Module Federation registry evidence as a release-age approval', () => {
  const moduleFederation =
    ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.registryEvidence
      .moduleFederation;
  assert.equal(moduleFederation.version, '2.8.2');
  assert.equal(moduleFederation.nodeVersion, '2.7.49');
  assert.equal(moduleFederation.releases.length, 18);
  assert.equal(
    moduleFederation.releases.find(
      release => release.packageName === '@module-federation/modern-js-v3',
    )?.registry.publishedAt,
    '2026-08-06T11:25:21.202Z',
  );
  assert.equal(
    moduleFederation.node.registry.dist.integrity,
    'sha512-xNGYfhA2aqFpogb/uq6lwBeEbnmDLV6PwHzSe97mRrSSr00eUKAMwlLG6PcQP6ynbkPeDG86RYj/YUC7EWgLMA==',
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
          version: '2.8.2',
          reviewedAt: '2026-07-09T20:51:39.000Z',
          registry: {
            publishedAt: '2026-08-06T11:24:39.297Z',
            dist: {
              integrity:
                'sha512-SUoP+PD5EjSPSi6FxEPGIZoRkFifxdeYcVQbJE9mO0VEjF51gAk3/TgX8k0vzUryOBPmXekLr9SfQXU6DqUtvA==',
            },
          },
        },
      ]),
    /cannot be reviewed before its registry publish time/u,
  );
});

test('approves only the reviewed lock-reachable immature latest cohort', () => {
  const review = JSON.parse(
    fs.readFileSync(
      new URL('../release-age-review-2026-08-10.json', import.meta.url),
      'utf8',
    ),
  ) as {
    expiresAt: string;
    registryRecords: Array<{
      packageName: string;
      version: string;
      publishedAt: string;
      dist: { integrity: string };
    }>;
    reviewedAt: string;
  };
  const reviewedClosure = review.registryRecords.filter(
    record =>
      record.packageName === 'effect' ||
      record.packageName === '@effect/opentelemetry' ||
      record.packageName.startsWith('@effect/tsgo') ||
      record.packageName === 'oxfmt' ||
      record.packageName.startsWith('@oxfmt/binding-') ||
      record.packageName === 'oxlint' ||
      record.packageName.startsWith('@oxlint/binding-'),
  );
  const expectedSelectors = new Set(
    reviewedClosure.map(record =>
      packageKey(record.packageName, record.version),
    ),
  );
  const approvalBySelector = new Map(
    ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals.map(approval => [
      packageKey(approval.packageName, approval.version),
      approval,
    ]),
  );

  assert.equal(reviewedClosure.length, 50);
  assert.deepEqual(
    new Set(
      renderMinimumReleaseAgeExclude({
        now: new Date('2026-08-11T00:39:42.463Z'),
      }),
    ),
    expectedSelectors,
  );
  for (const record of reviewedClosure) {
    const selector = packageKey(record.packageName, record.version);
    const approval = approvalBySelector.get(selector);
    assert.ok(approval, `${selector} must have exact review approval`);
    assert.equal(approval.reviewedAt, review.reviewedAt);
    assert.equal(Date.parse(approval.expiresAt), Date.parse(review.expiresAt));
    assert.deepEqual(approval.registry, {
      publishedAt: record.publishedAt,
      dist: { integrity: record.dist.integrity },
    });
    assert.deepEqual(approval.evidence, {
      uri: 'https://github.com/BleedingDev/ultramodern.js/commit/eb27eddccec4e51896d63abb070ef46a7b7d3eb7',
      sha256:
        '47c9f25308e6bb521fa6e5a603205be9664034ae92bb94b1aa7d5683229bb240',
      sha256Subject: 'git-commit-payload',
    });
  }

  for (const packageName of [
    '@effect/vitest',
    '@tanstack/react-router',
    '@tanstack/router-core',
    '@cloudflare/workers-types',
  ]) {
    assert.equal(
      ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals.some(
        approval => approval.packageName === packageName,
      ),
      false,
      `${packageName} is reviewed but not in the failing lock closure`,
    );
  }
});

test('temporarily approves the exact fresh Modern.js dependency closure', () => {
  const review = JSON.parse(
    fs.readFileSync(
      new URL('../release-age-review-2026-08-24.json', import.meta.url),
      'utf8',
    ),
  ) as {
    expiresAt: string;
    registryRecords: Array<{
      packageName: string;
      version: string;
      publishedAt: string;
      dist: { integrity: string };
    }>;
    reviewedAt: string;
  };
  const expectedSelectors = new Set(
    review.registryRecords.map(record =>
      packageKey(record.packageName, record.version),
    ),
  );
  const approvalBySelector = new Map(
    ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals.map(approval => [
      packageKey(approval.packageName, approval.version),
      approval,
    ]),
  );

  assert.equal(expectedSelectors.size, 3);
  for (const record of review.registryRecords) {
    const selector = packageKey(record.packageName, record.version);
    const approval = approvalBySelector.get(selector);
    assert.ok(approval, `${selector} must have exact review approval`);
    assert.equal(approval.reviewedAt, review.reviewedAt);
    assert.equal(Date.parse(approval.expiresAt), Date.parse(review.expiresAt));
    assert.deepEqual(approval.registry, {
      publishedAt: record.publishedAt,
      dist: { integrity: record.dist.integrity },
    });
    assert.deepEqual(approval.evidence, {
      uri: 'https://github.com/BleedingDev/ultramodern.js/commit/b1cb9adc60074f9619e94e8653f2a1f6c8e40ce9',
      sha256:
        'fed95e26dcacd298e6a848448ed5965809315c7169d26b7fc4c78ec12505adb7',
      sha256Subject: 'git-commit-payload',
    });
  }

  const active = new Set(
    renderMinimumReleaseAgeExclude({
      now: new Date('2026-08-24T19:40:58.000Z'),
    }),
  );
  const expired = new Set(
    renderMinimumReleaseAgeExclude({
      now: new Date('2026-09-01T00:00:00.000Z'),
    }),
  );
  for (const selector of expectedSelectors) {
    assert.equal(active.has(selector), true);
    assert.equal(expired.has(selector), false);
  }
  for (const retired of [
    'i18next',
    'typescript',
    '@typescript/native-preview',
  ]) {
    assert.equal(
      ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals.some(
        approval => approval.packageName === retired,
      ),
      false,
    );
  }
});

test('temporarily approves the exact fresh browser data cohort', () => {
  const review = JSON.parse(
    fs.readFileSync(
      new URL('../release-age-review-2026-08-25.json', import.meta.url),
      'utf8',
    ),
  ) as {
    expiresAt: string;
    registryRecords: Array<{
      packageName: string;
      version: string;
      publishedAt: string;
      dist: { integrity: string };
    }>;
    reviewedAt: string;
  };
  const approvalBySelector = new Map(
    ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals.map(approval => [
      packageKey(approval.packageName, approval.version),
      approval,
    ]),
  );

  assert.equal(review.registryRecords.length, 2);
  for (const record of review.registryRecords) {
    const selector = packageKey(record.packageName, record.version);
    const approval = approvalBySelector.get(selector);
    assert.ok(approval, `${selector} must have exact review approval`);
    assert.equal(approval.reviewedAt, review.reviewedAt);
    assert.equal(approval.expiresAt, review.expiresAt);
    assert.deepEqual(approval.registry, {
      publishedAt: record.publishedAt,
      dist: { integrity: record.dist.integrity },
    });
    assert.deepEqual(approval.evidence, {
      uri: 'https://github.com/BleedingDev/ultramodern.js/commit/18a7063b427ee1fcb64ede59c85ff7c7adebe4a1',
      sha256:
        'e957c320a8877b107d50ac25ddaae467543d0846ef88c8094cbc8b2a684491db',
      sha256Subject: 'git-commit-payload',
    });
  }

  const active = new Set(
    renderMinimumReleaseAgeExclude({
      now: new Date(review.reviewedAt),
    }),
  );
  const expired = new Set(
    renderMinimumReleaseAgeExclude({
      now: new Date(review.expiresAt),
    }),
  );
  for (const record of review.registryRecords) {
    const selector = packageKey(record.packageName, record.version);
    assert.equal(active.has(selector), true);
    assert.equal(expired.has(selector), false);
  }
});

test('renders reviewed and first-party exclusions in the clean-room canonical order', () => {
  const approvalTime = new Date('2026-08-11T00:39:42.463Z');
  const renderedPolicies = [
    renderMinimumReleaseAgeExclude({ now: approvalTime }),
    renderMinimumReleaseAgeExclude({
      now: approvalTime,
      packageSource,
      releaseCohort,
    }),
  ];

  for (const exclusions of renderedPolicies) {
    assert.deepEqual(exclusions, [...exclusions].sort());
    assert.doesNotThrow(() =>
      validateExactExclusions(exclusions, 'Generated minimumReleaseAgeExclude'),
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
