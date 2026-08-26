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
    '@modern-js/create': '@bleedingdev/modern-js-create',
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
      sourceName: '@modern-js/create',
      targetName: aliases['@modern-js/create'],
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
    if (definition.sourceName === '@modern-js/create') {
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
  const cohortReview = JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        'packages/toolkit/create/release-age-review-2026-08-10.json',
      ),
      'utf8',
    ),
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
        'packages/toolkit/create/release-age-review-2026-08-26-rsbuild-rspack-2.2.0.json',
      ),
      'utf8',
    ),
  );
  const validated = validateExceptionPolicy(
    policy,
    new Date(stableRsbuildRspackReview.reviewedAt),
  );
  const cohortExpiryDates = new Set([
    '2026-09-25T23:59:59.000Z',
    '2026-10-09T23:59:59.000Z',
    '2026-10-23T23:59:59.000Z',
    '2026-11-06T23:59:59.000Z',
  ]);
  const reviewedRegistry = new Map([
    ...cohortReview.registryRecords.map(record => [
      `${record.packageName}@${record.version}`,
      {
        allowedExpiryDates: cohortExpiryDates,
        evidence: {
          sha256:
            '47c9f25308e6bb521fa6e5a603205be9664034ae92bb94b1aa7d5683229bb240',
          uri: 'https://github.com/BleedingDev/ultramodern.js/commit/eb27eddccec4e51896d63abb070ef46a7b7d3eb7',
        },
        record,
        review: cohortReview,
      },
    ]),
    ...browserDataReview.packages.map(record => [
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
    ...cohortExpiryDates,
    ...browserDataReview.packages.map(record => record.maturesAt),
    stableRsbuildRspackReview.expiresAt,
  ]);
  const observedExpiryDates = new Set();

  assert.equal(options.releaseAgePolicyPath, defaultReleaseAgePolicyPath);
  assert.equal(validated.entries.length, 70);
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
        targetName: '@bleedingdev/modern-js-create',
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
      sourceName: '@modern-js/create',
      targetName: '@bleedingdev/modern-js-create',
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
      /Operational-independence evidence file SHA-256 does not match the acceptance receipt/u,
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
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('publish change record structurally schedules only for a successful real outcome despite a skipped branch ancestor', async () => {
  const { evaluateJobSchedule } = await import(
    pathToFileURL(
      path.join(repoRoot, 'scripts/security/github-job-condition.mjs'),
    )
  );
  const parsed = workflow(publishWorkflowPath);
  const changeRecordJob = parsed.jobs['publish-change-record'];
  assert.deepEqual(normalizeNeeds(changeRecordJob), ['record-publish-outcome']);

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
