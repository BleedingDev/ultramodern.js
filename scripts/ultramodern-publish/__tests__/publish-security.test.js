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
const scriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/validate-publish-security.mjs',
);
const trustedPublisherScriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/configure-bleedingdev-trusted-publishing.mjs',
);
const releaseAcceptanceScriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/run-release-acceptance.mjs',
);
const publishWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/publish-bleedingdev.yml',
);
const tractorWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/ultramodern-tractor-downstream.yml',
);
const readinessWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/ultramodern-production-readiness.yml',
);
const workflowSecurityPath = path.join(
  repoRoot,
  '.github/workflows/workflow-security.yml',
);
const pnpmWorkspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
const requireFromPrebundle = createRequire(
  path.join(repoRoot, 'scripts/prebundle/package.json'),
);
const { load: parseYaml } = requireFromPrebundle('js-yaml');
const githubExpression = expression => `\${{ ${expression} }}`;
const releaseArtifactEnvironmentNames = new Map([
  ['bleedingdev-release-bundle', 'BLEEDINGDEV_RELEASE_BUNDLE_ARTIFACT'],
  ['bleedingdev-release-acceptance', 'BLEEDINGDEV_RELEASE_ACCEPTANCE_ARTIFACT'],
  ['bleedingdev-release-identity', 'BLEEDINGDEV_RELEASE_IDENTITY_ARTIFACT'],
]);
const qualifiedArtifactName = (name, identityExpression) =>
  `${githubExpression(`env.${releaseArtifactEnvironmentNames.get(name)}`)}-${githubExpression(identityExpression)}`;
const qualifiedPublicationIdentityArtifactName = (
  producerIdentityExpression,
  publicationAttemptExpression,
) =>
  `${qualifiedArtifactName(
    'bleedingdev-release-identity',
    producerIdentityExpression,
  )}-publication-attempt-${githubExpression(publicationAttemptExpression)}`;

function workflow(filePath) {
  return parseYaml(fs.readFileSync(filePath, 'utf8'));
}

test('workspace dependency verification fails closed before release commands', () => {
  const pnpmWorkspace = parseYaml(fs.readFileSync(pnpmWorkspacePath, 'utf8'));
  assert.equal(pnpmWorkspace.verifyDepsBeforeRun, 'error');
});

function cleanEnvironment(extra = {}) {
  const env = { ...process.env };
  for (const envName of [
    'AFFECTED_BASE',
    'AFFECTED_HEAD',
    'DEPENDENCY_VERSION',
    'EXPLICIT_PACKAGES',
    'GITHUB_ACTIONS',
    'GITHUB_EVENT_NAME',
    'GITHUB_REF',
    'GITHUB_REPOSITORY',
    'NODE_AUTH_TOKEN',
    'NPM_TOKEN',
    'PACKAGE_MODE',
    'SKIP_EXISTING',
  ]) {
    delete env[envName];
  }

  return {
    ...env,
    PUBLISH_VERSION: '3.2.0-ultramodern.45',
    PUBLISH_TAG: 'latest',
    PUBLISH_CONCURRENCY: '8',
    DRY_RUN: 'false',
    ...extra,
  };
}

const runSecurityValidation = env =>
  spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: cleanEnvironment(env),
  });

function normalizeNeeds(job) {
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

function actionSteps(job, action) {
  return (job.steps ?? []).filter(
    step => typeof step.uses === 'string' && step.uses.startsWith(`${action}@`),
  );
}

function artifactStep(job, action, name) {
  const step = actionSteps(job, action).find(
    candidate => candidate.with?.name === name,
  );
  assert.ok(step, `${action} step for ${name}`);
  return step;
}

function namedStep(job, name) {
  const step = job.steps.find(candidate => candidate.name === name);
  assert.ok(step, `step named ${name}`);
  return step;
}

function artifactPaths(step) {
  return step.with.path
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
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

test('publish security validation accepts the hermetic release workflows', () => {
  const result = runSecurityValidation();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Publish security validation passed/);
});

test('publish security validation rejects partial publish controls', () => {
  const result = runSecurityValidation({
    PACKAGE_MODE: 'explicit',
    EXPLICIT_PACKAGES: '@modern-js/create',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /partial publish controls are forbidden/);
});

test('release acceptance runner exposes distinct execution and receipt verification modes', async () => {
  const { parseArgs } = await import(
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

  assert.equal(parseArgs(commonArgs).mode, 'prepublish');
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

test('publish validator rejects authority, mutable resolution, and acceptance bypass attacks', async () => {
  const { validatePublishWorkflow } = await import(pathToFileURL(scriptPath));
  const mutateCases = [
    [
      'OIDC escalation',
      parsed => {
        parsed.jobs['accept-published'].permissions = {
          contents: 'read',
          'id-token': 'write',
        };
      },
      /accept-published must inherit the read-only workflow permissions/u,
    ],
    [
      'trusted environment escalation',
      parsed => {
        parsed.jobs['accept-published'].environment = 'npm-publish';
      },
      /without an environment|inherited read-only authority/u,
    ],
    [
      'rerun artifact authentication downgrade',
      parsed => {
        delete namedStep(
          parsed.jobs.publish,
          'Download accepted release bundle',
        ).with['github-token'];
      },
      /authenticated same-run artifact API/u,
    ],
    [
      'mutable latest install',
      parsed => {
        namedStep(
          parsed.jobs['accept-published'],
          'Run published ERP-10 acceptance',
        ).run += '\nnpm install @bleedingdev/modern-js-create@latest';
      },
      /exact npm version|mutable package resolution/u,
    ],
    [
      'missing published acceptance toolchain',
      parsed => {
        parsed.jobs['accept-published'].steps = parsed.jobs[
          'accept-published'
        ].steps.filter(
          step => !String(step.uses ?? '').startsWith('jdx/mise-action@'),
        );
      },
      /must install the pinned mise toolchain/u,
    ],
    [
      'outcome bypass',
      parsed => {
        parsed.jobs['record-publish-outcome'].if = parsed.jobs[
          'record-publish-outcome'
        ].if.replace(" && needs.accept-published.result == 'success'", '');
      },
      /successful published and Tractor acceptance/u,
    ],
    [
      'Tractor outcome bypass',
      parsed => {
        parsed.jobs['record-publish-outcome'].if = parsed.jobs[
          'record-publish-outcome'
        ].if.replace(" && needs.tractor-downstream.result == 'success'", '');
      },
      /successful published and Tractor acceptance/u,
    ],
    [
      'semantic outcome bypass',
      parsed => {
        parsed.jobs['record-publish-outcome'].if += ' || true';
      },
      /without semantic bypasses/u,
    ],
    [
      'mutable Tractor baseline',
      parsed => {
        parsed.jobs['tractor-downstream'].with.tractor_ref = 'main';
      },
      /immutable Tractor baseline/u,
    ],
  ];
  for (const [label, mutate, expected] of mutateCases) {
    const parsed = workflow(publishWorkflowPath);
    mutate(parsed);
    assert.throws(() => validatePublishWorkflow(parsed), expected, label);
  }
});

test('publish delegates source-cohort rejection to the authoritative registry API', async () => {
  const prepare = workflow(publishWorkflowPath).jobs['prepare-release'];
  const gate = namedStep(prepare, 'Reject an already published source cohort');
  const { validateRegistrySourceCohortGate } = await import(
    pathToFileURL(scriptPath)
  );

  assert.ok(
    prepare.steps.indexOf(namedStep(prepare, 'Qualify release source')) <
      prepare.steps.indexOf(gate) &&
      prepare.steps.indexOf(gate) <
        prepare.steps.indexOf(namedStep(prepare, 'Build Packages')),
  );
  assert.deepEqual(gate.env, {
    PUBLISH_VERSION: githubExpression('inputs.version'),
  });
  assert.doesNotThrow(() => validateRegistrySourceCohortGate(gate));

  const regressions = [
    {
      label: 'inline registry scan',
      run: `${gate.run}\nawait fetch('https://registry.npmjs.org/example');`,
    },
    {
      label: 'inert module wrapper',
      run: gate.run.replace('node --input-type=module', 'printf'),
    },
    {
      label: 'non-authoritative provenance import',
      run: gate.run.replace(
        './scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs',
        './scripts/ultramodern-publish/lib/prepare-bleedingdev-packages/provenance.mjs',
      ),
    },
    {
      label: 'non-exact source binding',
      run: gate.run.replace('process.env.GITHUB_SHA', 'process.env.GITHUB_REF'),
    },
  ];
  for (const regression of regressions) {
    assert.throws(
      () => validateRegistrySourceCohortGate({ ...gate, run: regression.run }),
      /Publish security validation failed/u,
      regression.label,
    );
  }
});

test('trusted publisher configuration is strict and always passes npm-publish', async () => {
  const { parseArgs, readManifest, trustedPublisherArgs } = await import(
    pathToFileURL(trustedPublisherScriptPath)
  );
  const options = parseArgs(['--dry-run']);
  assert.deepEqual(
    trustedPublisherArgs('@bleedingdev/modern-js-create', options, true),
    [
      'trust',
      'github',
      '@bleedingdev/modern-js-create',
      '--repo',
      'BleedingDev/ultramodern.js',
      '--file',
      'publish-bleedingdev.yml',
      '--allow-publish',
      '--env',
      'npm-publish',
      '--dry-run',
      '--yes',
    ],
  );
  assert.throws(
    () => parseArgs(['--env', 'staging']),
    /Trusted publishing environment must be npm-publish/,
  );

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-trusted-publisher-'),
  );
  try {
    const binDir = path.join(tempDir, 'bin');
    const callLog = path.join(tempDir, 'npm-calls.log');
    const fakeNpm = path.join(binDir, 'npm');
    const manifestPath = path.join(tempDir, 'manifest.json');
    fs.mkdirSync(binDir);
    fs.writeFileSync(
      fakeNpm,
      ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$NPM_CALL_LOG"', ''].join('\n'),
    );
    fs.chmodSync(fakeNpm, 0o755);
    const legacyManifest = `${JSON.stringify(
      { packages: [{ targetName: '@bleedingdev/modern-js-create' }] },
      null,
      2,
    )}\n`;
    fs.writeFileSync(manifestPath, legacyManifest);
    fs.writeFileSync(
      path.join(tempDir, 'manifest.json.sha256'),
      `${crypto.createHash('sha256').update(legacyManifest).digest('hex')}  manifest.json\n`,
    );
    assert.throws(
      () => readManifest(manifestPath),
      /Release manifest has unknown or missing fields/,
    );
    const result = spawnSync(
      process.execPath,
      [trustedPublisherScriptPath, '--manifest', manifestPath, '--dry-run'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          NPM_CALL_LOG: callLog,
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Release manifest has unknown or missing fields/,
    );
    assert.equal(fs.existsSync(callLog), false, 'npm must not be invoked');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
