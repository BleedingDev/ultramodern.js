// Consumer: publish and Tractor workflows using release acceptance helpers.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const {
  createOperationalAcceptanceReceiptFixture,
} = require('../../ultramodern-production-readiness/__tests__/support/operational-acceptance-fixture');

const repoRoot = path.resolve(__dirname, '../../..');
const releaseAcceptanceScriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/run-release-acceptance.mjs',
);
const publishWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/publish-bleedingdev.yml',
);
const tractorProvisionScriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/provision-tractor-acceptance.mjs',
);
const tractorEvidenceScriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/bind-tractor-acceptance-evidence.mjs',
);
const tractorWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/ultramodern-tractor-downstream.yml',
);
const pnpmWorkspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
const requireFromPrebundle = createRequire(
  path.join(repoRoot, 'scripts/prebundle/package.json'),
);
const { load: parseYaml } = requireFromPrebundle('js-yaml');
function workflow(filePath) {
  return parseYaml(fs.readFileSync(filePath, 'utf8'));
}

test('workspace dependency verification fails closed before release commands', () => {
  const pnpmWorkspace = parseYaml(fs.readFileSync(pnpmWorkspacePath, 'utf8'));
  assert.equal(pnpmWorkspace.verifyDepsBeforeRun, 'error');
});

function normalizeNeeds(job) {
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

const writeFixtureFile = (filePath, contents = 'fixture\n') => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const writeFixtureJson = (filePath, value) =>
  writeFixtureFile(filePath, `${JSON.stringify(value, null, 2)}\n`);

async function createRunnerSubprocessFixture(root) {
  const [releaseArtifactsApi, releaseManifestApi, receiptApi, constants] =
    await Promise.all([
      import('../prepare-bleedingdev-packages.mjs'),
      import('../lib/source-create-proof/release-manifest.mjs'),
      import(
        '../../ultramodern-production-readiness/published-create-proof/acceptance-receipt.mjs'
      ),
      import('../lib/prepare-bleedingdev-packages/constants.mjs'),
    ]);
  const version = '3.4.0-ultramodern.2';
  const source = {
    commit: '1'.repeat(40),
    repository: 'BleedingDev/ultramodern.js',
  };
  const aliases = {
    '@modern-js/ultramodern-create':
      '@bleedingdev/modern-js-ultramodern-create',
    '@modern-js/i18n-utils': '@bleedingdev/modern-js-i18n-utils',
  };
  const exportsMap = {
    '.': './index.js',
    './ultramodern-workspace': './index.js',
    './ultramodern-workspace/codesmith': './index.js',
  };
  const definitions = [
    {
      dependencies: {
        '@modern-js/i18n-utils': `npm:${aliases['@modern-js/i18n-utils']}@${version}`,
        '@module-federation/runtime': '2.8.0',
      },
      exports: exportsMap,
      sourceName: '@modern-js/ultramodern-create',
      targetName: aliases['@modern-js/ultramodern-create'],
      ultramodern: { frameworkVersion: version },
    },
    {
      dependencies: {},
      sourceName: '@modern-js/i18n-utils',
      targetName: aliases['@modern-js/i18n-utils'],
    },
  ];
  const packages = definitions.map(definition => {
    const packageDir = path.join(
      root,
      'staged',
      definition.targetName.replaceAll('/', '__'),
    );
    writeFixtureJson(path.join(packageDir, 'package.json'), {
      dependencies: definition.dependencies,
      exports: definition.exports,
      name: definition.targetName,
      publishConfig: {
        access: 'public',
        exports: definition.exports,
      },
      ultramodern: definition.ultramodern,
      version,
    });
    writeFixtureFile(
      path.join(packageDir, 'index.js'),
      'module.exports = {};\n',
    );
    if (definition.sourceName === '@modern-js/ultramodern-create') {
      for (const relativePath of constants.createTemplateRequiredFiles) {
        writeFixtureFile(path.join(packageDir, relativePath));
      }
    }
    return {
      packageDir: path.relative(repoRoot, packageDir),
      sourceName: definition.sourceName,
      targetName: definition.targetName,
      version,
    };
  });
  const releaseDir = path.join(root, 'release');
  releaseArtifactsApi.createReleaseArtifacts({
    aliases,
    command: execFileSync,
    outDir: releaseDir,
    packages,
    source,
    tag: 'latest',
    tools: { node: process.version, npm: 'fixture-npm', pnpm: 'fixture-pnpm' },
    version,
  });
  const manifestPath = path.join(releaseDir, 'manifest.json');
  const release = releaseManifestApi.readReleaseManifest({ manifestPath });
  const producerRunIdentity = `github:${source.repository}:run:123:attempt:1`;
  const receipt = receiptApi.createAcceptanceReceipt({
    release,
    mode: 'source',
    profile: { id: 'erp-10', verticalCount: 10 },
    createPackage: {
      exactSpecifier: `${release.createPackage.targetName}@${version}`,
      packageName: release.createPackage.targetName,
      version,
    },
    runtime: {
      arch: 'x64',
      node: '24.0.0',
      npm: '11.0.0',
      platform: 'linux',
      playwright: '1.60.0',
      pnpm: '10.0.0',
      registry: { name: 'npm', version: '11.0.0', integrity: 'sha512-npm' },
      yaml: { name: 'yaml', version: '2.0.0', integrity: 'sha512-yaml' },
    },
    registry: {
      cohortPackages: 'verified',
      externalDependencies: 'verified',
      resolution: 'verified',
      url: 'https://registry.npmjs.org/',
    },
    runIdentity: producerRunIdentity,
  });
  const fixtureDigest = value =>
    crypto.createHash('sha256').update(value).digest('hex');
  receiptApi.bindSupplyChainEvidence(receipt, {
    closureSha256: fixtureDigest('closure'),
    exceptionPolicySha256: fixtureDigest('exceptions'),
    lockSha256: fixtureDigest('lock'),
    registryMetadataSha256: fixtureDigest('registry'),
    releaseManifestSha256: release.manifestSha256,
  });
  const receiptPath = path.join(releaseDir, 'acceptance-receipt.json');
  const operationalEvidence = await createOperationalAcceptanceReceiptFixture({
    evidencePath: receiptPath.replace(
      /\.json$/u,
      '.operational-independence.json',
    ),
    overrides: {
      identity: {
        baselineRevision: release.source.commit,
        changedRevision: '2'.repeat(40),
        releaseVersion: release.release.version,
        runtimeReleaseVersion: release.release.version,
        runtimeSourceRevision: release.source.commit,
      },
    },
    receipt,
    receiptApi,
  });
  writeFixtureJson(receiptPath, receipt);
  return {
    manifestPath,
    ...operationalEvidence,
    producerRunIdentity,
    receiptPath,
    source,
  };
}

test('release acceptance runner exposes distinct execution and receipt verification modes', async () => {
  const { defaultReleaseAgePolicyPath, parseArgs } = await import(
    pathToFileURL(releaseAcceptanceScriptPath)
  );
  const commonArgs = [
    '--manifest',
    '/tmp/ultramodern-release/manifest.json',
    '--receipt',
    '/tmp/ultramodern-release/acceptance-receipt.json',
    '--scale-profile',
    'erp-10',
    '--run-identity',
    'test:release-run',
  ];

  const defaultOptions = parseArgs(commonArgs);
  assert.equal(defaultOptions.mode, 'prepublish');
  assert.equal(
    defaultOptions.releaseAgePolicyPath,
    path.join(
      repoRoot,
      'scripts/ultramodern-publish/release-age-exceptions-2026-08-10.json',
    ),
  );
  assert.equal(
    defaultOptions.releaseAgePolicyPath,
    defaultReleaseAgePolicyPath,
  );
  assert.equal(
    parseArgs([
      ...commonArgs,
      '--release-age-policy',
      path.join(os.tmpdir(), 'reviewed-release-age-policy.json'),
    ]).releaseAgePolicyPath,
    path.resolve(os.tmpdir(), 'reviewed-release-age-policy.json'),
  );
  assert.equal(
    parseArgs([...commonArgs, '--mode', 'published']).mode,
    'published',
  );
  assert.equal(parseArgs([...commonArgs, '--verify-receipt']).mode, 'verify');
  assert.equal(
    parseArgs([
      ...commonArgs,
      '--verify-receipt',
      '--expected-mode',
      'published',
    ]).expectedMode,
    'published',
  );
  assert.throws(
    () =>
      parseArgs([
        ...commonArgs,
        '--mode',
        'published',
        '--expected-mode',
        'published',
      ]),
    /only valid with receipt verification/u,
  );
  assert.throws(
    () => parseArgs([...commonArgs, '--acceptance-receipt', 'legacy.json']),
    /Unknown argument: --acceptance-receipt/,
  );
  assert.throws(
    () => parseArgs([...commonArgs, '--keep-work-dir']),
    /Unknown argument: --keep-work-dir/,
  );
});

test('release acceptance defaults to the exact reviewed third-party policy', async () => {
  const [
    { defaultReleaseAgePolicyPath, parseArgs },
    { validateExceptionPolicy },
  ] = await Promise.all([
    import(pathToFileURL(releaseAcceptanceScriptPath)),
    import(
      pathToFileURL(
        path.join(
          repoRoot,
          'scripts/ultramodern-production-readiness/published-create-proof/release-age-audit.mjs',
        ),
      )
    ),
  ]);
  const options = parseArgs([
    '--manifest',
    '/tmp/ultramodern-release/manifest.json',
    '--receipt',
    '/tmp/ultramodern-release/acceptance-receipt.json',
    '--scale-profile',
    'erp-10',
    '--run-identity',
    'test:release-run',
  ]);
  const policy = JSON.parse(
    fs.readFileSync(defaultReleaseAgePolicyPath, 'utf8'),
  );
  const browserDataReview = JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        'scripts/ultramodern-publish/release-age-review-2026-08-25.json',
      ),
      'utf8',
    ),
  );
  const stableRsbuildRspackReview = JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        'packages/toolkit/ultramodern-create/release-age-review-2026-08-26-rsbuild-rspack-2.2.0.json',
      ),
      'utf8',
    ),
  );
  const retainedBrowserDataReview = browserDataReview.packages.filter(
    record =>
      `${record.packageName}@${record.version}` === 'caniuse-lite@1.0.30001810',
  );
  assert.equal(retainedBrowserDataReview.length, 1);
  const validated = validateExceptionPolicy(
    policy,
    new Date(stableRsbuildRspackReview.reviewedAt),
  );
  const reviewedRegistry = new Map([
    ...retainedBrowserDataReview.map(record => [
      `${record.packageName}@${record.version}`,
      {
        allowedExpiryDates: new Set([record.maturesAt]),
        evidence: {
          sha256:
            'b8f9c9e91c424bb9ea2900fb613d2c3e383e4f9efaf51868b96e9e8e83ac0c82',
          uri: 'https://github.com/BleedingDev/ultramodern.js/commit/625c94e446ae5b8f91624563c6848f2cc6c934cf',
        },
        record,
        review: browserDataReview,
      },
    ]),
    ...stableRsbuildRspackReview.registryRecords.map(record => [
      `${record.packageName}@${record.version}`,
      {
        allowedExpiryDates: new Set([stableRsbuildRspackReview.expiresAt]),
        evidence: {
          sha256:
            'fe2b9cbf8027a6241d6cad9fc2bfd1efbc1517af95cbddde5bf5167fb0ae6b38',
          uri: 'https://github.com/BleedingDev/ultramodern.js/commit/986768d419f032f98d0cdcfd0893538b94ef1ea5',
        },
        record,
        review: stableRsbuildRspackReview,
      },
    ]),
  ]);
  const allowedExpiryDates = new Set([
    ...retainedBrowserDataReview.map(record => record.maturesAt),
    stableRsbuildRspackReview.expiresAt,
  ]);
  const observedExpiryDates = new Set();

  assert.equal(options.releaseAgePolicyPath, defaultReleaseAgePolicyPath);
  assert.equal(validated.entries.length, 18);
  assert.deepEqual(
    policy.entries,
    validated.entries,
    'policy must be canonical',
  );
  for (const entry of validated.entries) {
    const reviewed = reviewedRegistry.get(`${entry.package}@${entry.version}`);
    assert.ok(reviewed, `missing review record for ${entry.package}`);
    assert.equal(reviewed.record.dist.integrity, entry.integrity);
    if (reviewed.record.maturityAtReview) {
      assert.equal(reviewed.record.maturityAtReview.state, 'immature');
    } else {
      assert.ok(
        new Date(reviewed.record.publishedAt) <
          new Date(reviewed.review.reviewedAt),
        `review must follow publication for ${entry.package}`,
      );
      assert.ok(
        new Date(reviewed.review.reviewedAt) <
          new Date(reviewed.record.maturesAt),
        `reviewed browser data must still be immature for ${entry.package}`,
      );
    }
    assert.equal(entry.approvedBy, reviewed.review.reviewer);
    assert.equal(entry.reviewedAt, reviewed.review.reviewedAt);
    assert.deepEqual(entry.evidence, reviewed.evidence);
    assert.ok(
      reviewed.allowedExpiryDates.has(entry.expiresAt),
      `unexpected expiry for ${entry.package}`,
    );
    assert.ok(
      new Date(entry.expiresAt) > new Date(reviewed.review.reviewedAt),
      `expiry must follow review for ${entry.package}`,
    );
    observedExpiryDates.add(entry.expiresAt);
  }
  assert.deepEqual(observedExpiryDates, allowedExpiryDates);
});

test('release acceptance runner preserves the accepted producer identity on a publish retry', async () => {
  const [runner, receiptApi] = await Promise.all([
    import(pathToFileURL(releaseAcceptanceScriptPath)),
    import(
      pathToFileURL(
        path.join(
          repoRoot,
          'scripts/ultramodern-production-readiness/published-create-proof/acceptance-receipt.mjs',
        ),
      )
    ),
  ]);
  const digest = value =>
    crypto.createHash('sha256').update(value).digest('hex');
  const producerRunIdentity =
    'github:BleedingDev/ultramodern.js:run:123:attempt:1';
  const release = {
    source: {
      commit: '1'.repeat(40),
      repository: 'BleedingDev/ultramodern.js',
    },
    release: { tag: 'latest', version: '3.4.0-ultramodern.2' },
    manifestSha256: digest('release manifest'),
    cohortDigest: digest('release cohort'),
    packages: [
      {
        targetName: '@bleedingdev/modern-js-ultramodern-create',
        version: '3.4.0-ultramodern.2',
        integrity: 'sha512-create',
        packageJson: {
          dependencies: {
            '@module-federation/runtime': '2.8.0',
          },
        },
      },
    ],
    createPackage: {
      sourceName: '@modern-js/ultramodern-create',
      targetName: '@bleedingdev/modern-js-ultramodern-create',
      version: '3.4.0-ultramodern.2',
      integrity: 'sha512-create',
    },
  };
  const receipt = receiptApi.createAcceptanceReceipt({
    release,
    mode: 'source',
    profile: { id: 'erp-10', verticalCount: 10 },
    createPackage: {
      packageName: release.createPackage.targetName,
      version: release.createPackage.version,
      exactSpecifier: `${release.createPackage.targetName}@${release.createPackage.version}`,
    },
    runtime: {
      arch: 'x64',
      node: '24.0.0',
      npm: '11.0.0',
      platform: 'linux',
      playwright: '1.60.0',
      pnpm: '10.0.0',
      registry: { name: 'npm', version: '11.0.0', integrity: 'sha512-npm' },
      yaml: { name: 'yaml', version: '2.0.0', integrity: 'sha512-yaml' },
    },
    registry: {
      cohortPackages: 'verified',
      externalDependencies: 'verified',
      resolution: 'verified',
      url: 'https://registry.npmjs.org/',
    },
    runIdentity: producerRunIdentity,
  });
  receiptApi.bindSupplyChainEvidence(receipt, {
    closureSha256: digest('closure'),
    exceptionPolicySha256: digest('exceptions'),
    lockSha256: digest('lock'),
    registryMetadataSha256: digest('registry'),
    releaseManifestSha256: release.manifestSha256,
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-runner-'));
  try {
    const receiptPath = path.join(root, 'acceptance-receipt.json');
    await createOperationalAcceptanceReceiptFixture({
      evidencePath: receiptPath.replace(
        /\.json$/u,
        '.operational-independence.json',
      ),
      overrides: {
        identity: {
          baselineRevision: release.source.commit,
          changedRevision: '2'.repeat(40),
          releaseVersion: release.release.version,
          runtimeReleaseVersion: release.release.version,
          runtimeSourceRevision: release.source.commit,
        },
      },
      receipt,
      receiptApi,
    });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const options = {
      receiptPath,
      scaleProfile: 'erp-10',
    };

    assert.doesNotThrow(() =>
      runner.verifyReceipt({
        release,
        options,
        runIdentity: producerRunIdentity,
      }),
    );
    assert.doesNotThrow(() =>
      runner.verifyProducedReceipt({
        release,
        options: { ...options, mode: 'prepublish' },
        runIdentity: producerRunIdentity,
      }),
    );
    assert.doesNotThrow(() =>
      runner.verifyReceipt({
        release,
        options,
        runIdentity: producerRunIdentity,
      }),
    );
    assert.throws(
      () =>
        runner.verifyReceipt({
          release,
          options,
          runIdentity: 'github:BleedingDev/ultramodern.js:run:123:attempt:2',
        }),
      /Acceptance receipt (?:binding|run identity)/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release acceptance subprocess verifies producer attempt 1 during publication attempt 2', async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-runner-subprocess-'),
  );
  try {
    const fixture = await createRunnerSubprocessFixture(root);
    const dependencyBlockerPath = path.join(root, 'dependency-blocker.mjs');
    writeFixtureFile(
      dependencyBlockerPath,
      [
        'export async function resolve(specifier, context, nextResolve) {',
        "  if (specifier === '@babel/core') {",
        "    throw new Error('receipt verification loaded execution-only @babel/core');",
        '  }',
        '  return nextResolve(specifier, context);',
        '}',
        '',
      ].join('\n'),
    );
    const commonArgs = [
      releaseAcceptanceScriptPath,
      '--verify-receipt',
      '--manifest',
      fixture.manifestPath,
      '--scale-profile',
      'erp-10',
      '--receipt',
      fixture.receiptPath,
    ];
    const env = {
      ...process.env,
      GITHUB_REPOSITORY: fixture.source.repository,
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_RUN_ID: '123',
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS,
        `--experimental-loader=${pathToFileURL(dependencyBlockerPath).href}`,
      ]
        .filter(Boolean)
        .join(' '),
    };
    const producer = spawnSync(
      process.execPath,
      [...commonArgs, '--run-identity', fixture.producerRunIdentity],
      { cwd: repoRoot, encoding: 'utf8', env },
    );
    assert.equal(producer.status, 0, producer.stderr || producer.stdout);
    assert.match(producer.stdout, /Verified ERP-10 acceptance receipt/u);

    const publicationIdentity = `github:${fixture.source.repository}:run:123:attempt:2`;
    const publication = spawnSync(
      process.execPath,
      [...commonArgs, '--run-identity', publicationIdentity],
      { cwd: repoRoot, encoding: 'utf8', env },
    );
    assert.notEqual(publication.status, 0);
    assert.match(
      publication.stderr,
      /Acceptance receipt (?:binding|run identity)/u,
    );

    const implicit = spawnSync(process.execPath, commonArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(implicit.status, 0);
    assert.match(
      implicit.stderr,
      /--run-identity is required for receipt verification/u,
    );

    fs.writeFileSync(
      fixture.evidencePath,
      fixture.evidenceSource.replace('"result": "pass"', '"result": "fail"'),
    );
    const tampered = spawnSync(
      process.execPath,
      [...commonArgs, '--run-identity', fixture.producerRunIdentity],
      { cwd: repoRoot, encoding: 'utf8', env },
    );
    assert.notEqual(tampered.status, 0);
    assert.match(
      tampered.stderr,
      /Operational-independence node served behavior is missing, degraded, skipped, or non-passing/u,
    );

    fs.rmSync(fixture.evidencePath);
    const missing = spawnSync(
      process.execPath,
      [...commonArgs, '--run-identity', fixture.producerRunIdentity],
      { cwd: repoRoot, encoding: 'utf8', env },
    );
    assert.notEqual(missing.status, 0);
    assert.match(
      missing.stderr,
      /Operational-independence evidence is missing or is not a regular file/u,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('Tractor dependency provisioner installs with verified manifest pnpm before export', async () => {
  const { provisionTractorAcceptance } = await import(
    pathToFileURL(
      path.join(
        repoRoot,
        'scripts/ultramodern-publish/provision-tractor-acceptance.mjs',
      ),
    )
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tractor-provision-'));
  try {
    const pnpmVersion = '11.21.0';
    const manifestPath = path.join(
      root,
      '.modern/bleedingdev-publish/manifest.json',
    );
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify({ tools: { pnpm: pnpmVersion } })}\n`,
    );
    const pnpmRoot = path.join(root, 'mise-pnpm');
    const pnpmExecutable = path.join(pnpmRoot, 'pnpm');
    fs.mkdirSync(pnpmRoot, { recursive: true });
    fs.writeFileSync(pnpmExecutable, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(pnpmExecutable, 0o755);
    const githubEnvPath = path.join(root, 'github-env');
    const calls = [];
    const successfulRun = (command, args, options) => {
      calls.push({ args, command, options });
      if (command === 'mise' && args[0] === 'where') {
        return { status: 0, stderr: '', stdout: `${pnpmRoot}\n` };
      }
      if (command === pnpmExecutable && args[0] === '--version') {
        return { status: 0, stderr: '', stdout: `${pnpmVersion}\n` };
      }
      return { status: 0, stderr: '', stdout: '' };
    };

    assert.deepEqual(
      provisionTractorAcceptance({
        cwd: root,
        environment: { GITHUB_ENV: githubEnvPath },
        run: successfulRun,
      }),
      { pnpmExecutable, pnpmVersion },
    );
    assert.deepEqual(
      calls.map(({ args, command, options }) => [command, args, options.stdio]),
      [
        ['mise', ['install', `pnpm@${pnpmVersion}`], 'inherit'],
        ['mise', ['where', `pnpm@${pnpmVersion}`], 'pipe'],
        [pnpmExecutable, ['--version'], 'pipe'],
        [
          pnpmExecutable,
          [
            'install',
            '--frozen-lockfile',
            '--ignore-scripts',
            '--filter',
            '@scripts/ultramodern-production-readiness',
          ],
          'inherit',
        ],
      ],
    );
    assert.equal(
      fs.readFileSync(githubEnvPath, 'utf8'),
      `ULTRAMODERN_PNPM_EXECUTABLE=${pnpmExecutable}\n`,
    );

    const failedEnvPath = path.join(root, 'failed-github-env');
    assert.throws(
      () =>
        provisionTractorAcceptance({
          cwd: root,
          environment: { GITHUB_ENV: failedEnvPath },
          run(command, args, options) {
            const result = successfulRun(command, args, options);
            return command === pnpmExecutable && args[0] === 'install'
              ? { ...result, status: 1, stderr: 'install failed' }
              : result;
          },
        }),
      /dependency installation exited 1/u,
    );
    assert.equal(fs.existsSync(failedEnvPath), false);

    if (process.platform !== 'win32') {
      const fakeBin = path.join(root, 'fake-bin');
      const misePath = path.join(fakeBin, 'mise');
      const markerPath = path.join(root, 'pnpm-install-argv.json');
      writeFixtureFile(
        misePath,
        [
          '#!/usr/bin/env node',
          'const [action] = process.argv.slice(2);',
          "if (action === 'install') process.exit(0);",
          "if (action === 'where') {",
          '  process.stdout.write(process.env.FAKE_PNPM_ROOT);',
          '  process.exit(0);',
          '}',
          'process.exit(2);',
          '',
        ].join('\n'),
      );
      fs.chmodSync(misePath, 0o755);
      writeFixtureFile(
        pnpmExecutable,
        [
          '#!/usr/bin/env node',
          "const fs = require('node:fs');",
          'const args = process.argv.slice(2);',
          "if (args[0] === '--version') {",
          '  process.stdout.write(process.env.FAKE_PNPM_VERSION);',
          '  process.exit(0);',
          '}',
          'fs.writeFileSync(process.env.FAKE_PNPM_MARKER, JSON.stringify(args));',
          'process.exit(Number(process.env.FAKE_PNPM_INSTALL_STATUS || 0));',
          '',
        ].join('\n'),
      );
      fs.chmodSync(pnpmExecutable, 0o755);
      const cliGithubEnvPath = path.join(root, 'cli-github-env');
      const cliEnvironment = {
        ...process.env,
        FAKE_PNPM_MARKER: markerPath,
        FAKE_PNPM_ROOT: pnpmRoot,
        FAKE_PNPM_VERSION: pnpmVersion,
        GITHUB_ENV: cliGithubEnvPath,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      };
      const cliSuccess = spawnSync(
        process.execPath,
        [tractorProvisionScriptPath],
        { cwd: root, encoding: 'utf8', env: cliEnvironment },
      );
      assert.equal(
        cliSuccess.status,
        0,
        cliSuccess.stderr || cliSuccess.stdout,
      );
      assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, 'utf8')), [
        'install',
        '--frozen-lockfile',
        '--ignore-scripts',
        '--filter',
        '@scripts/ultramodern-production-readiness',
      ]);
      assert.equal(
        fs.readFileSync(cliGithubEnvPath, 'utf8'),
        `ULTRAMODERN_PNPM_EXECUTABLE=${pnpmExecutable}\n`,
      );

      const cliFailedEnvPath = path.join(root, 'cli-failed-github-env');
      const cliFailure = spawnSync(
        process.execPath,
        [tractorProvisionScriptPath],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...cliEnvironment,
            FAKE_PNPM_INSTALL_STATUS: '1',
            GITHUB_ENV: cliFailedEnvPath,
          },
        },
      );
      assert.notEqual(cliFailure.status, 0);
      assert.match(cliFailure.stderr, /dependency installation exited 1/u);
      assert.equal(fs.existsSync(cliFailedEnvPath), false);
    }
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('Tractor evidence binder validates the immutable report before exporting outputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tractor-evidence-'));
  try {
    const tractorRef = '0123456789abcdef0123456789abcdef01234567';
    const reportPath = path.join(
      root,
      '.modern/production-readiness/tractor-downstream-acceptance.json',
    );
    const report = {
      mode: 'published',
      schema: 'bleedingdev.ultramodern.tractor-downstream-acceptance',
      tractor: { baselineRevision: tractorRef },
    };
    writeFixtureJson(reportPath, report);
    const outputPath = path.join(root, 'github-output');
    const result = spawnSync(process.execPath, [tractorEvidenceScriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        GITHUB_RUN_ATTEMPT: '3',
        TRACTOR_REF: tractorRef,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const reportSha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(reportPath))
      .digest('hex');
    assert.equal(
      fs.readFileSync(outputPath, 'utf8'),
      [
        `artifact_name=ultramodern-tractor-downstream-acceptance-${tractorRef}-attempt-3`,
        `baseline_revision=${tractorRef}`,
        `report_sha256=${reportSha256}`,
        '',
      ].join('\n'),
    );

    writeFixtureJson(reportPath, {
      ...report,
      tractor: {
        baselineRevision: 'fedcba9876543210fedcba9876543210fedcba98',
      },
    });
    const failedOutputPath = path.join(root, 'failed-github-output');
    const failure = spawnSync(process.execPath, [tractorEvidenceScriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: failedOutputPath,
        GITHUB_RUN_ATTEMPT: '3',
        TRACTOR_REF: tractorRef,
      },
    });
    assert.notEqual(failure.status, 0);
    assert.match(failure.stderr, /not bound to the immutable baseline/u);
    assert.equal(fs.existsSync(failedOutputPath), false);

    // A pre-publication rehearsal report is bound to the same immutable
    // baseline and is otherwise identical, so the baseline check above cannot
    // separate the two. Mode does: source evidence is never promotable, and the
    // binder is the first of the two places that refuses it.
    writeFixtureJson(reportPath, { ...report, mode: 'source' });
    const rehearsalOutputPath = path.join(root, 'rehearsal-github-output');
    const rehearsal = spawnSync(process.execPath, [tractorEvidenceScriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: rehearsalOutputPath,
        GITHUB_RUN_ATTEMPT: '3',
        TRACTOR_REF: tractorRef,
      },
    });
    assert.notEqual(rehearsal.status, 0);
    assert.match(
      rehearsal.stderr,
      /Only a published-mode Tractor acceptance report is promotable evidence, found source/u,
    );
    assert.equal(fs.existsSync(rehearsalOutputPath), false);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('the pre-publication Tractor rehearsal gates npm publication and can never promote', () => {
  const parsed = workflow(publishWorkflowPath);
  const callee = workflow(tractorWorkflowPath);
  const rehearsal = parsed.jobs['rehearse-tractor'];
  const published = parsed.jobs['tractor-downstream'];
  const calleePath = './.github/workflows/ultramodern-tractor-downstream.yml';

  // (1) DAG reachability: the rehearsal sits behind the immutable bundle and
  // its exact-artifact acceptance, and ahead of both jobs that can reach npm.
  // A failed or skipped rehearsal makes publication unreachable rather than
  // optional.
  assert.equal(rehearsal.uses, calleePath);
  assert.deepEqual(normalizeNeeds(rehearsal).sort(), [
    'accept-release',
    'publish-security',
    'qualify-source',
  ]);
  for (const gated of ['publish-sidecars', 'publish']) {
    assert.ok(
      normalizeNeeds(parsed.jobs[gated]).includes('rehearse-tractor'),
      `${gated} must not be reachable without the rehearsal`,
    );
  }
  // A recovery dispatch replays the gate against the recovered bundle: the
  // rehearsal carries no recovery or dry-run escape hatch.
  assert.doesNotMatch(rehearsal.if, /dry_run|recovery_run_id/u);
  assert.equal(rehearsal.with.mode, 'source');

  // (2) Exact bundle-only seeding: the rehearsal names the producer identity
  // accept-release proved, and the callee downloads that artifact from this
  // run. Nothing in the callee builds, packs, repacks, or rewrites a tarball.
  assert.equal(
    rehearsal.with.release_bundle_artifact,
    [
      'bleedingdev-release-bundle-${{',
      'needs.accept-release.outputs.producer_artifact_identity',
      '}}',
    ].join(' '),
  );
  const bundleDownload = callee.jobs['tractor-downstream'].steps.find(step =>
    String(step.uses ?? '').startsWith('actions/download-artifact@'),
  );
  assert.equal(
    bundleDownload.with.name,
    ['${{', 'inputs.release_bundle_artifact', '}}'].join(' '),
  );
  assert.equal(
    bundleDownload.with['run-id'],
    ['${{', 'github.run_id', '}}'].join(' '),
  );
  const calleeRuns = callee.jobs['tractor-downstream'].steps.map(step =>
    String(step.run ?? ''),
  );
  for (const forbidden of [
    /build-bleedingdev-packages/u,
    /npm\s+pack/u,
    /--publish-existing(?![\s\S]*--dry-run)/u,
  ]) {
    assert.doesNotMatch(calleeRuns.join('\n'), forbidden, String(forbidden));
  }

  // (3) No publish authority anywhere on the rehearsal path: no OIDC, no
  // deployment environment, no secrets, and no npm publish entrypoint. The
  // callee is shared with the published lane, so this covers both.
  assert.equal(rehearsal.permissions, undefined);
  assert.equal(rehearsal.secrets, undefined);
  assert.equal(rehearsal.environment, undefined);
  assert.deepEqual(callee.permissions, { actions: 'read', contents: 'read' });
  for (const [name, job] of Object.entries(callee.jobs)) {
    assert.equal(job.permissions, undefined, name);
    assert.equal(job.environment, undefined, name);
  }
  // Comments are stripped so prose about the absent publish authority cannot
  // satisfy or defeat the check.
  assert.doesNotMatch(
    fs
      .readFileSync(tractorWorkflowPath, 'utf8')
      .split('\n')
      .filter(line => !/^\s*#/u.test(line))
      .join('\n'),
    /id-token|secrets\.|npm-publish/u,
  );
  assert.doesNotMatch(calleeRuns.join('\n'), /publish-sidecars\.mjs/u);

  // (4) No source-report promotion: the callee binds and uploads evidence only
  // in published mode, so a rehearsal leaves no artifact at all, and the
  // publish outcome reads nothing from it. It still requires the rehearsal to
  // have succeeded, because a dry run has no publish job of its own to carry a
  // rehearsal failure.
  for (const stepName of [
    'Bind Tractor acceptance evidence',
    'Upload Tractor acceptance evidence',
  ]) {
    const step = callee.jobs['tractor-downstream'].steps.find(
      candidate => candidate.name === stepName,
    );
    assert.equal(step.if, "always() && inputs.mode == 'published'", stepName);
  }
  assert.ok(
    normalizeNeeds(parsed.jobs['record-publish-outcome']).includes(
      'rehearse-tractor',
    ),
  );
  assert.match(
    parsed.jobs['record-publish-outcome'].if,
    /inputs\.dry_run == true[\s\S]*needs\.rehearse-tractor\.result == 'success'/u,
  );

  // (5) The published Tractor acceptance stays required and unchanged: same
  // callee, still behind the real publication, still waiting on the registry
  // cohort, and still the job record-publish-outcome demands succeed.
  assert.equal(published.uses, calleePath);
  assert.equal(published.with.mode, 'published');
  assert.equal(published.with.wait_for_registry_cohort, true);
  assert.deepEqual(normalizeNeeds(published).sort(), [
    'prepare-release',
    'publish',
  ]);
  assert.match(
    parsed.jobs['record-publish-outcome'].if,
    /needs\.tractor-downstream\.result == 'success'/u,
  );
  assert.ok(
    normalizeNeeds(parsed.jobs['record-publish-outcome']).includes(
      'tractor-downstream',
    ),
  );

  // Both calls must exercise the same reviewed immutable Tractor baseline; a
  // rehearsal against a different commit would prove nothing about the one the
  // published lane adopts.
  assert.match(rehearsal.with.tractor_ref, /^[a-f0-9]{40}$/u);
  assert.equal(rehearsal.with.tractor_ref, published.with.tractor_ref);
});

test('release recovery reuses only an accepted ancestral bundle and preserves its source identity', () => {
  const parsed = workflow(publishWorkflowPath);
  const actionExpression = name => ['${{', name, '}}'].join(' ');
  const inputs = parsed.on.workflow_dispatch.inputs;

  assert.deepEqual(inputs.recovery_run_id, {
    description:
      'Original producer run containing an accepted immutable bundle (never an earlier recovery run)',
    required: false,
    type: 'string',
    default: '',
  });
  assert.deepEqual(inputs.recovery_run_attempt, {
    description: 'Producer attempt for the prior accepted immutable bundle',
    required: false,
    type: 'string',
    default: '',
  });

  const securityJob = parsed.jobs['publish-security'];
  const inputValidation = securityJob.steps.find(
    step => step.name === 'Validate publish inputs',
  );
  assert.deepEqual(inputValidation.env, {
    PUBLISH_VERSION: actionExpression('inputs.version'),
    RECOVERY_RUN_ID: actionExpression('inputs.recovery_run_id'),
    RECOVERY_RUN_ATTEMPT: actionExpression('inputs.recovery_run_attempt'),
    RECOVERY_QUALIFICATION_ATTEMPT: actionExpression(
      'inputs.recovery_qualification_attempt',
    ),
  });
  assert.match(
    inputValidation.run,
    /if \[\[ -n "\$RECOVERY_RUN_ID" \|\| -n "\$RECOVERY_RUN_ATTEMPT" \]\]; then/u,
  );
  assert.match(
    inputValidation.run,
    /\[\[ "\$RECOVERY_RUN_ID" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/u,
  );
  assert.match(
    inputValidation.run,
    /\[\[ "\$RECOVERY_RUN_ATTEMPT" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/u,
  );

  const prepareJob = parsed.jobs['prepare-release'];
  for (const stepName of [
    'Reject an already published source cohort',
    'Build Packages',
    'Prepare exact release tarballs and manifest',
  ]) {
    assert.equal(
      prepareJob.steps.find(step => step.name === stepName).if,
      "inputs.recovery_run_id == ''",
    );
  }

  const recoveryDownloads = prepareJob.steps.filter(
    step =>
      String(step.uses ?? '').startsWith('actions/download-artifact@') &&
      step.if === "inputs.recovery_run_id != ''",
  );
  // Bundle, acceptance receipt, source qualification receipt.
  assert.equal(recoveryDownloads.length, 3);
  for (const step of recoveryDownloads) {
    assert.equal(step.with['github-token'], actionExpression('github.token'));
    assert.equal(step.with.repository, actionExpression('github.repository'));
    assert.equal(
      step.with['run-id'],
      actionExpression('inputs.recovery_run_id'),
    );
  }
  // The bytes and the acceptance that covers them are one indivisible producer
  // artifact pair: only the source-qualification receipt may follow a different
  // attempt of the same run.
  for (const step of recoveryDownloads.filter(
    candidate =>
      candidate.name !== 'Download the recovered source qualification receipt',
  )) {
    assert.match(
      step.with.name,
      /inputs\.recovery_run_id, inputs\.recovery_run_attempt\)/u,
      step.name,
    );
    assert.doesNotMatch(
      step.with.name,
      /recovery_qualification_attempt/u,
      step.name,
    );
  }
  const acceptanceDownload = recoveryDownloads.find(
    step => step.name === 'Download previous release acceptance receipt',
  );
  assert.equal(acceptanceDownload.with.path, '.modern/bleedingdev-publish');

  const previousAcceptance = prepareJob.steps.find(
    step => step.name === 'Verify previously accepted release bundle',
  );
  assert.equal(previousAcceptance.if, "inputs.recovery_run_id != ''");
  assert.match(
    previousAcceptance.run,
    /recovery_run_identity="github:\$\{GITHUB_REPOSITORY\}:run:\$\{RECOVERY_RUN_ID\}:attempt:\$\{RECOVERY_RUN_ATTEMPT\}"/u,
  );
  assert.match(previousAcceptance.run, /--verify-receipt/u);
  assert.match(previousAcceptance.run, /--scale-profile erp-10/u);
  assert.match(
    previousAcceptance.run,
    /--receipt "\$BLEEDINGDEV_RELEASE_ACCEPTANCE_RECEIPT"/u,
  );
  assert.doesNotMatch(previousAcceptance.run, /recovery-acceptance/u);
  assert.match(
    previousAcceptance.run,
    /--run-identity "\$recovery_run_identity"/u,
  );

  const bundleVerification = prepareJob.steps.find(
    step => step.name === 'Verify release bundle identity',
  );
  assert.equal(bundleVerification.id, 'verify-bundle');
  assert.match(
    bundleVerification.run,
    /release\.manifest\.source\.repository !== process\.env\.GITHUB_REPOSITORY/u,
  );
  assert.match(
    bundleVerification.run,
    /\['merge-base', '--is-ancestor', release\.manifest\.source\.commit, process\.env\.GITHUB_SHA\]/u,
  );
  assert.match(
    bundleVerification.run,
    /`source_commit=\$\{release\.manifest\.source\.commit\}\\n`/u,
  );
  assert.equal(
    prepareJob.outputs.release_source_commit,
    actionExpression('steps.verify-bundle.outputs.source_commit'),
  );
  assert.equal(
    parsed.jobs['accept-release'].outputs.release_source_commit,
    actionExpression('needs.prepare-release.outputs.release_source_commit'),
  );

  const acceptedSource = actionExpression(
    'needs.accept-release.outputs.release_source_commit',
  );
  const publishIdentity = parsed.jobs.publish.steps.find(
    step => step.name === 'Prepare non-dry-run release identity',
  );
  assert.equal(publishIdentity.env.SOURCE_COMMIT, acceptedSource);
  const identityUpload = parsed.jobs.publish.steps.find(
    step => step.name === 'Upload published release identity',
  );
  assert.match(
    identityUpload.with.path,
    /^\.modern\/bleedingdev-publish\/sidecars\.json$/mu,
  );
  assert.match(
    identityUpload.with.path,
    /^\.modern\/bleedingdev-publish\/sidecar-tarballs\/\*\.tgz$/mu,
  );
  const publishedAcceptance = parsed.jobs['accept-published'].steps.find(
    step => step.name === 'Run published ERP-10 acceptance',
  );
  assert.match(
    publishedAcceptance.run,
    /--expected-source-revision "\$\{\{ needs\.accept-release\.outputs\.release_source_commit \}\}"/u,
  );
  assert.equal(
    parsed.jobs['record-publish-outcome'].env.RELEASE_SOURCE_COMMIT,
    acceptedSource,
  );
  const outcomeStep = parsed.jobs['record-publish-outcome'].steps.find(
    step => step.name === 'Create publish outcome',
  );
  assert.match(outcomeStep.run, /--source-commit "\$RELEASE_SOURCE_COMMIT"/u);
  assert.doesNotMatch(outcomeStep.run, /--source-commit "\$GITHUB_SHA"/u);
});

test('release recovery may only reuse a bundle qualified at its own source commit', () => {
  const parsed = workflow(publishWorkflowPath);
  const actionExpression = name => ['${{', name, '}}'].join(' ');
  const qualifyJob = parsed.jobs['qualify-source'];
  const prepareJob = parsed.jobs['prepare-release'];

  // The recovery lane publishes the recovered run's bytes, so re-qualifying
  // this run's *source* buys nothing: those suites are skipped and the
  // recovered run's own receipt is verified instead.
  for (const stepName of [
    'Restore Playwright chromium cache',
    'Install browser qualification runtime',
    'Qualify release source',
    'Record the qualified source commit',
    'Upload the source qualification receipt',
  ]) {
    assert.equal(
      qualifyJob.steps.find(step => step.name === stepName).if,
      "inputs.recovery_run_id == ''",
      stepName,
    );
  }

  // Written after the suites pass, so a failed qualification uploads nothing
  // and leaves its bundle unrecoverable.
  const qualifyStepNames = qualifyJob.steps.map(step => step.name);
  assert.ok(
    qualifyStepNames.indexOf('Qualify release source') <
      qualifyStepNames.indexOf('Record the qualified source commit'),
  );
  const recordStep = qualifyJob.steps.find(
    step => step.name === 'Record the qualified source commit',
  );
  assert.match(
    recordStep.run,
    /source-qualification\.mjs create[\s\S]*--commit "\$GITHUB_SHA"[\s\S]*--run-id "\$GITHUB_RUN_ID"[\s\S]*--run-attempt "\$GITHUB_RUN_ATTEMPT"/u,
  );
  const receiptUpload = qualifyJob.steps.find(
    step => step.name === 'Upload the source qualification receipt',
  );
  assert.equal(
    receiptUpload.with.name,
    `${actionExpression(
      'env.BLEEDINGDEV_SOURCE_QUALIFICATION_ARTIFACT',
    )}-run-${actionExpression('github.run_id')}-attempt-${actionExpression(
      'github.run_attempt',
    )}`,
  );
  assert.equal(receiptUpload.with['if-no-files-found'], 'error');

  // Both consumers address the recovered run's artifact by run and attempt, so
  // a run that never uploaded a receipt has nothing to download and fails the
  // job rather than falling back to an unqualified reuse.
  const receiptDownloads = [qualifyJob, prepareJob].map(job =>
    job.steps.find(
      step =>
        step.name === 'Download the recovered source qualification receipt',
    ),
  );
  for (const step of receiptDownloads) {
    assert.equal(step.if, "inputs.recovery_run_id != ''");
    assert.equal(step.with['github-token'], actionExpression('github.token'));
    assert.equal(step.with.repository, actionExpression('github.repository'));
    assert.equal(
      step.with['run-id'],
      actionExpression('inputs.recovery_run_id'),
    );
    assert.match(
      step.with.name,
      /BLEEDINGDEV_SOURCE_QUALIFICATION_ARTIFACT, inputs\.recovery_run_id, inputs\.recovery_qualification_attempt \|\| inputs\.recovery_run_attempt/u,
    );
    assert.equal(step.with.path, '.modern/bleedingdev-publish');
  }

  const qualifyVerify = qualifyJob.steps.find(
    step => step.name === 'Verify the recovered source qualification receipt',
  );
  assert.equal(qualifyVerify.if, "inputs.recovery_run_id != ''");
  assert.deepEqual(qualifyVerify.env, {
    RECOVERY_RUN_ID: actionExpression('inputs.recovery_run_id'),
    RECOVERY_QUALIFICATION_ATTEMPT: actionExpression(
      'inputs.recovery_qualification_attempt || inputs.recovery_run_attempt',
    ),
  });
  assert.match(
    qualifyVerify.run,
    /source-qualification\.mjs verify[\s\S]*--run-id "\$RECOVERY_RUN_ID"[\s\S]*--run-attempt "\$RECOVERY_QUALIFICATION_ATTEMPT"/u,
  );

  // The binding that closes the ancestral hole: the receipt must name the
  // recovered manifest's own commit, not merely an ancestor of this run's HEAD.
  const bundleQualification = prepareJob.steps.find(
    step =>
      step.name ===
      'Verify the recovered bundle was qualified at its own source commit',
  );
  assert.equal(bundleQualification.if, "inputs.recovery_run_id != ''");
  assert.equal(
    bundleQualification.env.RELEASE_SOURCE_COMMIT,
    actionExpression('steps.verify-bundle.outputs.source_commit'),
  );
  assert.equal(
    bundleQualification.env.RECOVERY_QUALIFICATION_ATTEMPT,
    actionExpression(
      'inputs.recovery_qualification_attempt || inputs.recovery_run_attempt',
    ),
  );
  assert.equal(bundleQualification.env.RECOVERY_RUN_ATTEMPT, undefined);
  assert.match(
    bundleQualification.run,
    /--run-attempt "\$RECOVERY_QUALIFICATION_ATTEMPT"/u,
  );
  assert.match(
    bundleQualification.run,
    /--expect-commit "\$RELEASE_SOURCE_COMMIT"/u,
  );
  assert.doesNotMatch(
    bundleQualification.run,
    /--expect-commit "\$GITHUB_SHA"/u,
  );
  const prepareStepNames = prepareJob.steps.map(step => step.name);
  assert.ok(
    prepareStepNames.indexOf('Verify release bundle identity') <
      prepareStepNames.indexOf(bundleQualification.name),
  );

  // Recovery stays inside this workflow's existing job graph, and no job
  // outside the two registry publishers may hold publish authority.
  assert.deepEqual(Object.keys(parsed.jobs), [
    'publish-security',
    'qualify-source',
    'prepare-release',
    'accept-release',
    'validate-release',
    'rehearse-tractor',
    'publish-sidecars',
    'publish',
    'accept-published',
    'tractor-downstream',
    'record-publish-outcome',
    'publish-change-record',
  ]);
  assert.equal(qualifyJob.permissions, undefined);
  assert.equal(prepareJob.permissions, undefined);
  assert.deepEqual(
    Object.entries(parsed.jobs)
      .filter(([, job]) => job.permissions?.['id-token'] === 'write')
      .map(([name]) => name),
    ['publish-sidecars', 'publish'],
  );
  for (const consumer of ['validate-release', 'publish-sidecars', 'publish']) {
    assert.ok(normalizeNeeds(parsed.jobs[consumer]).includes('qualify-source'));
  }
});

test('a recovery dispatch still qualifies the publication tooling that runs with OIDC', () => {
  const parsed = workflow(publishWorkflowPath);
  const qualifyJob = parsed.jobs['qualify-source'];
  const stepNames = qualifyJob.steps.map(step => step.name);
  const step = name =>
    qualifyJob.steps.find(candidate => candidate.name === name);

  // A recovery dispatch reuses the recovered run's bytes, but the workflow file
  // and every publish CLI are checked out from *this* dispatch's HEAD. The
  // workspace and the tooling qualification therefore carry no lane guard at
  // all: gating any of them on the source lane would hand an unqualified HEAD
  // to a job holding id-token: write.
  for (const name of [
    'Setup mise',
    'Resolve pnpm store path',
    'Restore pnpm store cache',
    'Install Dependencies',
    'Qualify the release publication tooling',
  ]) {
    assert.equal(step(name).if, undefined, name);
  }

  const toolingStep = step('Qualify the release publication tooling');
  assert.match(toolingStep.run, /pnpm lint$/mu);
  assert.match(toolingStep.run, /pnpm run test:publish-tooling$/mu);

  // Proportionate by construction: the always-on lane builds no package bytes
  // and runs no framework unit suite, which is what keeps the recovery saving
  // substantial. Comments are stripped so prose about the skipped work cannot
  // satisfy or defeat the check.
  const toolingCommands = toolingStep.run
    .split('\n')
    .filter(line => !/^\s*#/u.test(line))
    .join('\n');
  for (const forbidden of [
    /\bbuild\b/u,
    /test:ut/u,
    /test:scripts/u,
    /check-changeset/u,
    /playwright/iu,
  ]) {
    assert.doesNotMatch(toolingCommands, forbidden, String(forbidden));
  }

  // ...and the expensive work stays behind the source lane, so recovery still
  // drops the framework build, the browser runtime, and the unit suites.
  const sourceStep = step('Qualify release source');
  assert.equal(sourceStep.if, "inputs.recovery_run_id == ''");
  assert.match(sourceStep.run, /pnpm \\\n\s+--filter/u);
  assert.match(sourceStep.run, /pnpm test:ut/u);
  assert.match(sourceStep.run, /pnpm test:scripts/u);
  assert.ok(
    stepNames.indexOf('Install Dependencies') <
      stepNames.indexOf('Qualify the release publication tooling'),
  );
  assert.ok(
    stepNames.indexOf('Qualify the release publication tooling') <
      stepNames.indexOf('Qualify release source'),
  );

  // `pnpm lint` moved into the always-on lane rather than being duplicated.
  assert.doesNotMatch(
    sourceStep.run
      .split('\n')
      .filter(line => !/^\s*#/u.test(line))
      .join('\n'),
    /pnpm lint/u,
  );

  // Coverage is asserted by its own test below, against the import closure
  // rather than against the entrypoint names alone.
});

// A `node --test scripts/<dir>/__tests__/<pattern>` script, split into the
// directories it runs and the filename patterns it runs there.
function parseTestGlobs(scriptName) {
  const script = require(path.join(repoRoot, 'package.json')).scripts[
    scriptName
  ];
  assert.ok(script, `missing root script ${scriptName}`);
  return script
    .split(/\s+/u)
    .filter(token => token.startsWith('scripts/'))
    .map(token => {
      const marker = token.indexOf('/__tests__/');
      assert.notEqual(marker, -1, `unexpected ${scriptName} glob: ${token}`);
      return {
        dir: token.slice(0, marker),
        filePattern: token.slice(marker + '/__tests__/'.length),
      };
    });
}

// A glob run by `node --test` is expanded by the shell, so a directory is only
// as covered as its filename patterns: `*.test.js` silently skips a sibling
// `*.test.mjs`, which reads as coverage but runs nothing.
function assertGlobsRunEveryTestFile(globs, scriptName) {
  for (const dir of [...new Set(globs.map(glob => glob.dir))].sort()) {
    const patterns = globs
      .filter(glob => glob.dir === dir)
      .map(
        glob =>
          new RegExp(
            `^${glob.filePattern
              .split('*')
              .map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
              .join('[^/]*')}$`,
            'u',
          ),
      );
    const testFiles = fs
      .readdirSync(path.join(repoRoot, dir, '__tests__'))
      .filter(entry => /\.test\.[cm]?js$/u.test(entry));
    assert.ok(testFiles.length > 0, `${dir} has an empty __tests__`);
    for (const testFile of testFiles) {
      assert.ok(
        patterns.some(pattern => pattern.test(testFile)),
        `${scriptName} never runs ${dir}/__tests__/${testFile}`,
      );
    }
  }
}

// Relative specifiers a Node module can statically pull in. Bare specifiers
// (`node:fs`, dependencies) are deliberately not followed: this closure is
// about first-party repository code that a test glob could qualify.
const MODULE_SPECIFIER_PATTERNS = [
  /(?:^|[^\w$.])(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/gu,
  /(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  /(?:^|[^\w$.])import\s+['"]([^'"]+)['"]/gu,
  /(?:^|[^\w$.])require\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
];

function moduleSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of MODULE_SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return specifiers;
}

function resolveRepoRelative(fromRepoRelative, specifier) {
  const base = path.posix.join(path.posix.dirname(fromRepoRelative), specifier);
  return [
    base,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.cjs`,
    `${base}/index.mjs`,
    `${base}/index.js`,
  ].find(candidate => {
    const absolute = path.join(repoRoot, candidate);
    return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
  });
}

// Every step's `run` in a job, plus the bodies of any inline `node <<'TAG'`
// heredoc it executes. Heredoc bodies are returned separately because they
// live in the workflow file, so no test glob can ever load them.
function jobShellSources(job) {
  const runs = job.steps.map(step => String(step.run ?? ''));
  const heredocs = [];
  for (const run of runs) {
    const lines = run.split('\n');
    for (const [index, line] of lines.entries()) {
      const opener =
        /\bnode\b(?:\s+--[^\s]+)*\s*<<\s*'([A-Za-z_]\w*)'\s*$/u.exec(line);
      if (!opener) {
        continue;
      }
      const terminator = lines.findIndex(
        (candidate, at) => at > index && candidate.trim() === opener[1],
      );
      // Fail closed: an unterminated heredoc means this test cannot see the
      // code the job runs, which is exactly the case it exists to catch.
      assert.notEqual(terminator, -1, `unterminated heredoc: ${line.trim()}`);
      heredocs.push(lines.slice(index + 1, terminator).join('\n'));
    }
  }
  return { runs, heredocs };
}

test('the tooling lane qualifies the whole import closure the OIDC jobs load', () => {
  const parsed = workflow(publishWorkflowPath);
  const oidcJobs = Object.entries(parsed.jobs)
    .filter(([, job]) => job.permissions?.['id-token'] === 'write')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(oidcJobs, ['publish', 'publish-sidecars']);

  // Entrypoints are the `node scripts/...` targets the OIDC jobs invoke. The
  // qualification claim is about the code those jobs *load*, though, not the
  // filenames they type: an entrypoint drags in a static import closure, and
  // an untested helper in that closure is unqualified code running with
  // id-token: write. So walk the closure and check coverage against it.
  const entrypoints = new Set();
  for (const jobName of oidcJobs) {
    const { runs, heredocs } = jobShellSources(parsed.jobs[jobName]);
    const jobTargets = new Set();
    for (const run of runs) {
      for (const match of run.matchAll(
        /\bnode\b(?:\s+--[^\s]+)*\s+(scripts\/[^\s\\]+)/gu,
      )) {
        jobTargets.add(match[1]);
      }
    }
    assert.ok(jobTargets.size > 0, `${jobName} runs no publish tooling`);
    for (const target of jobTargets) {
      entrypoints.add(target);
    }

    // The inline heredocs are the one part of an OIDC job no glob can cover,
    // so they are held to a shape that needs no coverage: `node:` builtins
    // only. A relative or absolute specifier there would silently extend the
    // closure past what this test can see, so it fails instead.
    for (const body of heredocs) {
      for (const specifier of moduleSpecifiers(body)) {
        assert.ok(
          specifier.startsWith('node:'),
          `${jobName} heredoc imports ${specifier}; it must import only node: builtins or become a file under a qualified scripts directory`,
        );
      }
    }
  }

  const closure = new Set();
  const pending = [...entrypoints];
  while (pending.length > 0) {
    const current = pending.shift();
    if (closure.has(current)) {
      continue;
    }
    closure.add(current);
    const absolute = path.join(repoRoot, current);
    assert.ok(fs.existsSync(absolute), `missing publish tooling: ${current}`);
    for (const specifier of moduleSpecifiers(
      fs.readFileSync(absolute, 'utf8'),
    )) {
      if (!specifier.startsWith('.')) {
        continue;
      }
      const resolved = resolveRepoRelative(current, specifier);
      // Fail closed again: an unresolvable relative import means the closure
      // is incomplete and the coverage answer below would be wrong.
      assert.ok(resolved, `${current} imports unresolvable ${specifier}`);
      pending.push(resolved);
    }
  }
  assert.ok(closure.size > entrypoints.size, 'closure walk found no imports');

  // The `__tests__` directory that owns a closure file is the nearest one at
  // or above it, bounded by `scripts/`. Files outside `scripts/` — vendored
  // and prebundled dependencies — are not publish tooling and are covered by
  // their own packages, so they are not part of this claim.
  const owningTestDirs = new Set();
  for (const file of closure) {
    if (!file.startsWith('scripts/')) {
      continue;
    }
    let dir = path.posix.dirname(file);
    while (dir.startsWith('scripts/')) {
      if (fs.existsSync(path.join(repoRoot, dir, '__tests__'))) {
        owningTestDirs.add(dir);
        break;
      }
      dir = path.posix.dirname(dir);
    }
  }

  // `scripts/lib` is in the closure through cli-kit/fs-kit/process-kit/
  // validation-kit, which both OIDC entrypoint trees import. Anchoring it
  // keeps the derivation above from silently degenerating into a check that
  // covers only the two directories the entrypoints happen to sit in.
  assert.ok(
    owningTestDirs.has('scripts/lib'),
    'expected scripts/lib in the OIDC import closure',
  );

  const toolingGlobs = parseTestGlobs('test:publish-tooling');

  // Two-way: every reached directory with tests is qualified, and the lane
  // carries no glob for a directory outside the closure.
  assert.deepEqual(
    [...new Set(toolingGlobs.map(glob => glob.dir))].sort(),
    [...owningTestDirs].sort(),
  );

  // ...and the globs must reach every test file in those directories, not
  // just the ones sharing an extension with the first suite anyone wrote.
  assertGlobsRunEveryTestFile(toolingGlobs, 'test:publish-tooling');
});

test('the root script suites run every test file they claim to cover', () => {
  // The source lane qualifies the same publish tooling under `pnpm
  // test:scripts`, so a suite the extension patterns skip there is a suite
  // neither lane ever runs.
  assertGlobsRunEveryTestFile(parseTestGlobs('test:scripts'), 'test:scripts');
});

test('the recovered qualification attempt is independent of the recovered bundle attempt', () => {
  const parsed = workflow(publishWorkflowPath);
  const actionExpression = name => ['${{', name, '}}'].join(' ');
  const resolvedAttempt = actionExpression(
    'inputs.recovery_qualification_attempt || inputs.recovery_run_attempt',
  );

  // Optional and blank-defaulted: an operator who does not need it dispatches
  // exactly as before and the receipt follows recovery_run_attempt.
  assert.deepEqual(
    parsed.on.workflow_dispatch.inputs.recovery_qualification_attempt,
    {
      description:
        'Attempt of the producer run whose qualify-source recorded the receipt; blank reuses recovery_run_attempt',
      required: false,
      type: 'string',
      default: '',
    },
  );

  // Negative: a qualification attempt outside the recovery lane would address
  // an artifact of this run, so it is rejected rather than ignored.
  const inputValidation = parsed.jobs['publish-security'].steps.find(
    step => step.name === 'Validate publish inputs',
  );
  assert.match(
    inputValidation.run,
    /if \[\[ -n "\$RECOVERY_QUALIFICATION_ATTEMPT" \]\]; then\n\s+\[\[ -n "\$RECOVERY_RUN_ID" \]\]\n\s+\[\[ "\$RECOVERY_QUALIFICATION_ATTEMPT" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/u,
  );

  // Only the source-qualification receipt follows it. The bundle and the
  // acceptance receipt that covers those exact bytes stay on the producer
  // attempt: splitting them would let an accepted receipt vouch for tarballs it
  // never saw.
  const qualificationConsumers = [];
  const bundleConsumers = [];
  for (const jobName of ['qualify-source', 'prepare-release']) {
    for (const step of parsed.jobs[jobName].steps) {
      const artifactName = String(step.with?.name ?? '');
      if (!step.uses?.startsWith('actions/download-artifact@')) {
        continue;
      }
      if (artifactName.includes('SOURCE_QUALIFICATION')) {
        qualificationConsumers.push(step);
      } else {
        bundleConsumers.push(step);
      }
    }
  }
  assert.equal(qualificationConsumers.length, 2);
  assert.equal(bundleConsumers.length, 2);
  for (const step of qualificationConsumers) {
    assert.match(
      step.with.name,
      /inputs\.recovery_qualification_attempt \|\| inputs\.recovery_run_attempt/u,
    );
  }
  for (const step of bundleConsumers) {
    assert.doesNotMatch(step.with.name, /recovery_qualification_attempt/u);
    assert.match(step.with.name, /inputs\.recovery_run_attempt\)/u);
  }

  // Both verifiers read the same resolved attempt, and neither still reads the
  // producer attempt under the old name.
  const verifiers = [
    parsed.jobs['qualify-source'].steps.find(
      step => step.name === 'Verify the recovered source qualification receipt',
    ),
    parsed.jobs['prepare-release'].steps.find(
      step =>
        step.name ===
        'Verify the recovered bundle was qualified at its own source commit',
    ),
  ];
  for (const step of verifiers) {
    assert.equal(step.env.RECOVERY_QUALIFICATION_ATTEMPT, resolvedAttempt);
    assert.equal(step.env.RECOVERY_RUN_ATTEMPT, undefined);
    assert.match(step.run, /--run-attempt "\$RECOVERY_QUALIFICATION_ATTEMPT"/u);
  }

  // The acceptance verification still binds the producer attempt, unchanged.
  const acceptanceVerify = parsed.jobs['prepare-release'].steps.find(
    step => step.name === 'Verify previously accepted release bundle',
  );
  assert.equal(
    acceptanceVerify.env.RECOVERY_RUN_ATTEMPT,
    actionExpression('inputs.recovery_run_attempt'),
  );
  assert.equal(acceptanceVerify.env.RECOVERY_QUALIFICATION_ATTEMPT, undefined);
});

test('a recovery run records no receipt, so recovery always names the original producer run', () => {
  const parsed = workflow(publishWorkflowPath);
  const qualifyJob = parsed.jobs['qualify-source'];
  const prepareJob = parsed.jobs['prepare-release'];

  // The mechanism behind the documented rule: a recovery run re-uploads the
  // bundle it recovered (that upload carries no lane guard) but records and
  // uploads no qualification receipt of its own. Naming a recovery run as
  // recovery_run_id therefore finds bytes and no proof, and the receipt
  // download fails closed instead of promoting an unqualified chain.
  for (const name of [
    'Record the qualified source commit',
    'Upload the source qualification receipt',
  ]) {
    assert.equal(
      qualifyJob.steps.find(step => step.name === name).if,
      "inputs.recovery_run_id == ''",
      name,
    );
  }
  assert.equal(
    prepareJob.steps.find(
      step => step.name === 'Upload immutable release bundle',
    ).if,
    undefined,
  );

  // The rule is stated where an operator dispatching a recovery reads it.
  const recoveryInput = fs.readFileSync(publishWorkflowPath, 'utf8');
  assert.match(recoveryInput, /never an earlier recovery run/u);
  assert.match(
    fs.readFileSync(
      path.join(repoRoot, 'scripts/ultramodern-publish/ROLLBACK-RUNBOOK.md'),
      'utf8',
    ),
    /original producer run/u,
  );
});

test('publish change record structurally schedules only for a successful real outcome despite a skipped branch ancestor', async () => {
  const { evaluateJobSchedule } = await import(
    pathToFileURL(
      path.join(repoRoot, 'scripts/security/github-job-condition.mjs'),
    )
  );
  const parsed = workflow(publishWorkflowPath);
  const outcomeUpload = parsed.jobs['record-publish-outcome'].steps.find(
    step => step.name === 'Upload publish outcome',
  );
  assert.match(
    outcomeUpload.with.path,
    /^\.modern\/bleedingdev-publish\/sidecars\.json$/mu,
  );
  assert.match(
    outcomeUpload.with.path,
    /^\.modern\/bleedingdev-publish\/sidecar-tarballs\/\*\.tgz$/mu,
  );
  const changeRecordJob = parsed.jobs['publish-change-record'];
  assert.equal(changeRecordJob['continue-on-error'], true);
  const actionExpression = name => ['${{', name, '}}'].join(' ');
  assert.deepEqual(normalizeNeeds(changeRecordJob), [
    'accept-release',
    'record-publish-outcome',
  ]);
  assert.deepEqual(changeRecordJob.permissions, {
    actions: 'read',
    contents: 'write',
  });
  assert.equal(
    parsed.jobs['record-publish-outcome'].outputs.artifact_name,
    actionExpression('steps.publish-outcome.outputs.artifact_name'),
  );
  const outcomeDownloads = changeRecordJob.steps.filter(step =>
    String(step.uses ?? '').startsWith('actions/download-artifact@'),
  );
  assert.equal(outcomeDownloads.length, 1);
  assert.deepEqual(outcomeDownloads[0].with, {
    'github-token': actionExpression('github.token'),
    name: actionExpression(
      'needs.record-publish-outcome.outputs.artifact_name',
    ),
    path: '.modern/bleedingdev-publish',
    repository: actionExpression('github.repository'),
    'run-id': actionExpression('github.run_id'),
  });
  const generateStep = changeRecordJob.steps.find(
    step => step.name === 'Generate the cohort change record',
  );
  assert.equal(generateStep.id, 'change-record');
  assert.deepEqual(generateStep.env, {
    RELEASE_SOURCE_COMMIT: actionExpression(
      'needs.accept-release.outputs.release_source_commit',
    ),
  });
  assert.match(
    generateStep.run,
    /git checkout --detach "\$RELEASE_SOURCE_COMMIT"/u,
  );
  assert.match(
    generateStep.run,
    /--manifest "\$BLEEDINGDEV_RELEASE_MANIFEST"/u,
  );
  assert.match(generateStep.run, /--github-output "\$GITHUB_OUTPUT"/u);
  assert.doesNotMatch(generateStep.run, /--version/u);
  const releaseStep = changeRecordJob.steps.find(
    step => step.name === 'Create or update the GitHub release',
  );
  assert.deepEqual(releaseStep.env, {
    GH_TOKEN: actionExpression('github.token'),
    PUBLISH_VERSION: actionExpression('steps.change-record.outputs.version'),
    SOURCE_COMMIT: actionExpression(
      'steps.change-record.outputs.source_commit',
    ),
  });
  assert.match(releaseStep.run, /--target "\$SOURCE_COMMIT"/u);
  assert.doesNotMatch(releaseStep.run, /\$GITHUB_SHA/u);
  const recordUpload = changeRecordJob.steps.find(step =>
    String(step.uses ?? '').startsWith('actions/upload-artifact@'),
  );
  assert.equal(
    recordUpload.with.name,
    `bleedingdev-change-record-${actionExpression(
      'steps.change-record.outputs.version',
    )}`,
  );

  const results = {
    'accept-published': 'success',
    'accept-release': 'success',
    'prepare-release': 'success',
    publish: 'success',
    'publish-security': 'success',
    'record-publish-outcome': 'success',
    'tractor-downstream': 'success',
    'validate-release': 'skipped',
  };
  const context = {
    github: {
      actor: 'BleedingDev',
      ref: 'refs/heads/main-ultramodern',
      repository_owner: 'BleedingDev',
      triggering_actor: 'BleedingDev',
    },
    inputs: { dry_run: false },
    vars: {},
  };
  const schedules = ({ context: nextContext, results: nextResults } = {}) =>
    evaluateJobSchedule({
      workflow: parsed,
      jobId: 'publish-change-record',
      results: nextResults ?? results,
      context: nextContext ?? context,
    });

  assert.equal(
    schedules(),
    true,
    'real release must survive the intentionally skipped dry-run ancestor',
  );
  assert.equal(
    schedules({
      context: { ...context, inputs: { dry_run: true } },
    }),
    false,
    'dry-run must never publish a change record',
  );
  for (const outcomeResult of ['failure', 'cancelled', 'skipped']) {
    assert.equal(
      schedules({
        results: {
          ...results,
          'record-publish-outcome': outcomeResult,
        },
      }),
      false,
      `${outcomeResult} outcome must never publish a change record`,
    );
  }
  for (const identity of ['actor', 'triggering_actor']) {
    assert.equal(
      schedules({
        context: {
          ...context,
          github: { ...context.github, [identity]: 'Mallory' },
        },
      }),
      false,
      `${identity} must remain bound to the repository owner`,
    );
  }
  assert.equal(
    schedules({
      context: {
        ...context,
        github: { ...context.github, ref: 'refs/heads/not-publish' },
      },
    }),
    false,
    'change record must remain bound to the publish branch',
  );
});
