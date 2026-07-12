const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

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
  const env = {
    ...process.env,
    PUBLISH_VERSION: '3.2.0-ultramodern.45',
    PUBLISH_TAG: 'latest',
    PUBLISH_CONCURRENCY: '8',
    DRY_RUN: 'false',
    ...extra,
  };
  delete env.NPM_TOKEN;
  delete env.NODE_AUTH_TOKEN;
  return env;
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
  return job.steps.filter(
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
  for (const id of receiptApi.requiredAcceptanceResultIds) {
    await receiptApi.recordAcceptanceResult(receipt, id, async () => ({ id }));
  }
  receiptApi.finalizeAcceptanceReceipt(receipt);
  const receiptPath = path.join(releaseDir, 'acceptance-receipt.json');
  writeFixtureJson(receiptPath, receipt);
  return { manifestPath, producerRunIdentity, receiptPath, source };
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
  assert.throws(
    () => parseArgs([...commonArgs, '--acceptance-receipt', 'legacy.json']),
    /Unknown argument: --acceptance-receipt/,
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
    packages: [{ targetName: '@bleedingdev/modern-js-create' }],
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
  for (const id of receiptApi.requiredAcceptanceResultIds) {
    await receiptApi.recordAcceptanceResult(receipt, id, async () => ({ id }));
  }
  receiptApi.finalizeAcceptanceReceipt(receipt);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-runner-'));
  try {
    const receiptPath = path.join(root, 'acceptance-receipt.json');
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
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('publish workflow uses one global non-cancelling mutex and hard dependencies', () => {
  const parsed = workflow(publishWorkflowPath);

  assert.deepEqual(parsed.concurrency, {
    group: 'publish-bleedingdev',
    'cancel-in-progress': false,
  });
  assert.deepEqual(normalizeNeeds(parsed.jobs.publish).sort(), [
    'accept-release',
    'publish-security',
  ]);
  assert.deepEqual(normalizeNeeds(parsed.jobs['validate-release']).sort(), [
    'accept-release',
    'publish-security',
  ]);
  assert.deepEqual(normalizeNeeds(parsed.jobs['accept-release']), [
    'prepare-release',
  ]);
});

test('OIDC and the trusted publishing environment are confined to publish', () => {
  const parsed = workflow(publishWorkflowPath);
  const dryRun = parsed.jobs['validate-release'];
  const publish = parsed.jobs.publish;
  const oidcJobs = Object.entries(parsed.jobs)
    .filter(([, job]) => job.permissions?.['id-token'] === 'write')
    .map(([jobId]) => jobId);

  assert.equal(parsed.permissions.contents, 'read');
  assert.equal(parsed.permissions['id-token'], undefined);
  assert.deepEqual(parsed.permissions, { contents: 'read' });
  assert.deepEqual(oidcJobs, ['publish']);
  assert.equal(Object.hasOwn(dryRun, 'environment'), false);
  assert.equal(Object.hasOwn(dryRun, 'permissions'), false);
  assert.match(dryRun.if, /inputs\.dry_run == true/u);
  assert.equal(publish.environment, 'npm-publish');
  assert.match(publish.if, /inputs\.dry_run == false/u);
  assert.deepEqual(publish.permissions, {
    contents: 'read',
    'id-token': 'write',
  });
  for (const jobId of [
    'publish-security',
    'prepare-release',
    'accept-release',
    'validate-release',
    'publish',
  ]) {
    assert.match(
      parsed.jobs[jobId].if,
      /github\.actor == github\.repository_owner/u,
    );
    assert.match(
      parsed.jobs[jobId].if,
      /github\.triggering_actor == github\.repository_owner/u,
    );
    assert.match(parsed.jobs[jobId].if, /vars\.BLEEDINGDEV_PUBLISH_BRANCH/u);
  }
});

test('dry-run validation consumes accepted bytes without publish authority', () => {
  const parsed = workflow(publishWorkflowPath);
  const dryRun = parsed.jobs['validate-release'];
  const verifier = namedStep(dryRun, 'Verify exact release acceptance receipt');
  const validate = namedStep(dryRun, 'Validate only the accepted tarballs');

  artifactStep(
    dryRun,
    'actions/download-artifact',
    qualifiedArtifactName(
      'bleedingdev-release-bundle',
      'needs.accept-release.outputs.producer_artifact_identity',
    ),
  );
  artifactStep(
    dryRun,
    'actions/download-artifact',
    qualifiedArtifactName(
      'bleedingdev-release-acceptance',
      'needs.accept-release.outputs.producer_artifact_identity',
    ),
  );
  assert.ok(dryRun.steps.indexOf(verifier) < dryRun.steps.indexOf(validate));
  assert.match(verifier.run, /--verify-receipt/u);
  assert.match(validate.run, /--publish-existing/u);
  assert.match(validate.run, /--dry-run/u);
  assert.equal(actionSteps(dryRun, 'actions/upload-artifact').length, 0);
  assert.doesNotMatch(
    dryRun.steps.map(step => step.run ?? '').join('\n'),
    /(?:pnpm install|npm pack|pnpm pack|ultramodern:build|tsgo:dts)/u,
  );
});

test('dry-run and real publication converge on one authenticated outcome artifact', () => {
  const parsed = workflow(publishWorkflowPath);
  const outcomeJob = parsed.jobs['record-publish-outcome'];
  const createOutcome = namedStep(outcomeJob, 'Create publish outcome');
  const verifyReceipt = namedStep(
    outcomeJob,
    'Verify accepted producer receipt for the outcome',
  );
  const upload = artifactStep(
    outcomeJob,
    'actions/upload-artifact',
    githubExpression('steps.publish-outcome.outputs.artifact_name'),
  );

  assert.deepEqual(normalizeNeeds(outcomeJob).sort(), [
    'accept-release',
    'publish',
    'publish-security',
    'validate-release',
  ]);
  assert.match(outcomeJob.if, /always\(\)/u);
  assert.match(
    outcomeJob.if,
    /inputs\.dry_run == true[\s\S]*needs\.validate-release\.result == 'success'[\s\S]*needs\.publish\.result == 'skipped'/u,
  );
  assert.match(
    outcomeJob.if,
    /inputs\.dry_run == false[\s\S]*needs\.publish\.result == 'success'[\s\S]*needs\.validate-release\.result == 'skipped'/u,
  );
  assert.equal(actionSteps(outcomeJob, 'actions/upload-artifact').length, 1);
  assert.ok(
    outcomeJob.steps.indexOf(verifyReceipt) <
      outcomeJob.steps.indexOf(createOutcome) &&
      outcomeJob.steps.indexOf(createOutcome) <
        outcomeJob.steps.indexOf(upload),
  );
  assert.match(verifyReceipt.run, /--verify-receipt/u);
  assert.match(verifyReceipt.run, /--run-identity "\$PRODUCER_RUN_IDENTITY"/u);
  assert.match(createOutcome.run, /publish-outcome\.mjs create/u);
  assert.match(createOutcome.run, /--dry-run "\$DRY_RUN"/u);
  assert.match(
    createOutcome.run,
    /--producer-run-identity "\$PRODUCER_RUN_IDENTITY"/u,
  );
  assert.deepEqual(artifactPaths(upload), [
    '.modern/bleedingdev-publish/acceptance-receipt.json',
    '.modern/bleedingdev-publish/cohort.sha256',
    '.modern/bleedingdev-publish/manifest.json',
    '.modern/bleedingdev-publish/manifest.json.sha256',
    '.modern/bleedingdev-publish/publish-outcome.json',
    '.modern/bleedingdev-publish/tarballs/*.tgz',
  ]);

  const outcomeUploads = Object.values(parsed.jobs)
    .flatMap(job => actionSteps(job, 'actions/upload-artifact'))
    .filter(step =>
      artifactPaths(step).includes(
        '.modern/bleedingdev-publish/publish-outcome.json',
      ),
    );
  assert.deepEqual(outcomeUploads, [upload]);

  for (const job of Object.values(parsed.jobs)) {
    for (const step of job.steps ?? []) {
      if (step.run?.includes('--verify-receipt')) {
        assert.match(step.run, /--run-identity/u, step.name);
        assert.doesNotMatch(step.run, /GITHUB_RUN_ATTEMPT/u, step.name);
      }
    }
  }
});

test('prepare, acceptance, and publish transfer one exact immutable bundle', () => {
  const parsed = workflow(publishWorkflowPath);
  const prepare = parsed.jobs['prepare-release'];
  const acceptance = parsed.jobs['accept-release'];
  const publish = parsed.jobs.publish;
  const bundleUpload = artifactStep(
    prepare,
    'actions/upload-artifact',
    qualifiedArtifactName(
      'bleedingdev-release-bundle',
      'steps.producer-identity.outputs.artifact_identity',
    ),
  );

  assert.equal(actionSteps(prepare, 'actions/upload-artifact').length, 1);
  assert.deepEqual(artifactPaths(bundleUpload), [
    '.modern/bleedingdev-publish/cohort.sha256',
    '.modern/bleedingdev-publish/manifest.json',
    '.modern/bleedingdev-publish/manifest.json.sha256',
    '.modern/bleedingdev-publish/tarballs/*.tgz',
  ]);
  assert.equal(bundleUpload.with['include-hidden-files'], true);
  const install = namedStep(prepare, 'Install Dependencies');
  const qualification = namedStep(prepare, 'Qualify release source');
  const build = namedStep(prepare, 'Build Packages');
  const pack = namedStep(
    prepare,
    'Prepare exact release tarballs and manifest',
  );
  assert.match(install.run, /pnpm install --frozen-lockfile/);
  assert.match(qualification.run, /pnpm test:scripts/);
  assert.match(qualification.run, /pnpm --filter @modern-js\/create test/);
  assert.ok(
    prepare.steps.indexOf(install) < prepare.steps.indexOf(qualification),
  );
  assert.ok(
    prepare.steps.indexOf(qualification) < prepare.steps.indexOf(build),
  );
  assert.ok(prepare.steps.indexOf(build) < prepare.steps.indexOf(pack));
  assert.ok(prepare.steps.indexOf(pack) < prepare.steps.indexOf(bundleUpload));
  artifactStep(
    acceptance,
    'actions/download-artifact',
    qualifiedArtifactName(
      'bleedingdev-release-bundle',
      'needs.prepare-release.outputs.producer_artifact_identity',
    ),
  );
  artifactStep(
    publish,
    'actions/download-artifact',
    qualifiedArtifactName(
      'bleedingdev-release-bundle',
      'needs.accept-release.outputs.producer_artifact_identity',
    ),
  );
  const acceptanceUpload = artifactStep(
    acceptance,
    'actions/upload-artifact',
    qualifiedArtifactName(
      'bleedingdev-release-acceptance',
      'needs.prepare-release.outputs.producer_artifact_identity',
    ),
  );
  artifactStep(
    publish,
    'actions/download-artifact',
    qualifiedArtifactName(
      'bleedingdev-release-acceptance',
      'needs.accept-release.outputs.producer_artifact_identity',
    ),
  );
  assert.equal(acceptanceUpload.with['include-hidden-files'], true);
  assert.equal(
    bundleUpload.with.name,
    `${githubExpression('env.BLEEDINGDEV_RELEASE_BUNDLE_ARTIFACT')}-${githubExpression('steps.producer-identity.outputs.artifact_identity')}`,
  );
  assert.equal(
    acceptanceUpload.with.name,
    `${githubExpression('env.BLEEDINGDEV_RELEASE_ACCEPTANCE_ARTIFACT')}-${githubExpression('needs.prepare-release.outputs.producer_artifact_identity')}`,
  );
  assert.deepEqual(prepare.outputs, {
    producer_artifact_identity: githubExpression(
      'steps.producer-identity.outputs.artifact_identity',
    ),
    producer_run_attempt: githubExpression(
      'steps.producer-identity.outputs.run_attempt',
    ),
    producer_run_identity: githubExpression(
      'steps.producer-identity.outputs.run_identity',
    ),
  });
  assert.deepEqual(acceptance.outputs, {
    producer_artifact_identity: githubExpression(
      'needs.prepare-release.outputs.producer_artifact_identity',
    ),
    producer_run_attempt: githubExpression(
      'needs.prepare-release.outputs.producer_run_attempt',
    ),
    producer_run_identity: githubExpression(
      'needs.prepare-release.outputs.producer_run_identity',
    ),
  });

  const verifier = namedStep(
    publish,
    'Verify exact release acceptance receipt',
  );
  const publisher = namedStep(publish, 'Publish only the accepted tarballs');
  assert.ok(publish.steps.indexOf(verifier) < publish.steps.indexOf(publisher));
  assert.match(verifier.run, /run-release-acceptance\.mjs/);
  assert.match(verifier.run, /--verify-receipt/);
  assert.match(verifier.run, /--manifest/);
  assert.match(verifier.run, /--receipt/);
  assert.match(verifier.run, /acceptance-receipt\.mjs/);
  assert.match(verifier.run, /--verify/);
  assert.match(verifier.run, /--run-identity/);
  assert.match(
    verifier.run,
    /needs\.accept-release\.outputs\.producer_run_identity/,
  );
  assert.doesNotMatch(verifier.run, /GITHUB_RUN_ATTEMPT/);
  assert.doesNotMatch(
    namedStep(acceptance, 'Run exact-artifact ERP-10 acceptance').run,
    /--verify-receipt/,
  );
  assert.match(publisher.run, /--publish-existing/);
  assert.doesNotMatch(publisher.run, /--acceptance-receipt/);
  assert.doesNotMatch(
    publish.steps.map(step => step.run ?? '').join('\n'),
    /(?:pnpm install|npm pack|pnpm pack|ultramodern:build|tsgo:dts)/,
  );
});

test('non-dry publish uses the strict v2 manifest and emits its identity', () => {
  const parsed = workflow(publishWorkflowPath);
  const publish = parsed.jobs.publish;
  const identityStep = namedStep(
    publish,
    'Prepare non-dry-run release identity',
  );
  const identityUpload = artifactStep(
    publish,
    'actions/upload-artifact',
    qualifiedPublicationIdentityArtifactName(
      'needs.accept-release.outputs.producer_artifact_identity',
      'github.run_attempt',
    ),
  );
  const publishStep = namedStep(publish, 'Publish only the accepted tarballs');

  assert.match(publish.if, /inputs\.dry_run == false/u);
  assert.equal(Object.hasOwn(identityStep, 'if'), false);
  assert.equal(Object.hasOwn(identityUpload, 'if'), false);
  assert.ok(
    publish.steps.indexOf(identityStep) < publish.steps.indexOf(publishStep),
  );
  assert.ok(
    publish.steps.indexOf(publishStep) < publish.steps.indexOf(identityUpload),
  );
  assert.match(identityStep.run, /bleedingdev\.ultramodern\.release-manifest/);
  assert.match(identityStep.run, /manifest\.schemaVersion !== 2/);
  assert.match(identityStep.run, /['"]cohortProjection['"]/);
  assert.match(identityStep.run, /manifest\.release\.version/);
  assert.match(identityStep.run, /manifest\.source\.commit/);
  assert.match(identityStep.run, /PRODUCER_ARTIFACT_IDENTITY/);
  assert.match(identityStep.run, /PRODUCER_RUN_ATTEMPT/);
  assert.match(identityStep.run, /PRODUCER_RUN_IDENTITY/);
  assert.match(identityStep.run, /PUBLICATION_RUN_ATTEMPT/);
  assert.match(identityStep.run, /schemaVersion: 2/);
  assert.match(identityStep.run, /producerArtifactIdentity/);
  assert.match(identityStep.run, /producerRunAttempt/);
  assert.match(identityStep.run, /producerRunIdentity/);
  assert.match(identityStep.run, /publicationRunAttempt/);
  assert.doesNotMatch(identityStep.run, /releaseRunAttempt|releaseRunIdentity/);
  assert.doesNotMatch(identityStep.run, /acceptance-receipt/);
  assert.doesNotMatch(identityStep.run, /receiptType|binding\?\.sourceSha/);
  assert.match(
    identityStep.run,
    /manifest\.json\.sha256|BLEEDINGDEV_RELEASE_MANIFEST_DIGEST/,
  );
  assert.doesNotMatch(identityStep.run, /manifest\.version|sourceRevision/);
  assert.deepEqual(artifactPaths(identityUpload), [
    '.modern/bleedingdev-publish/acceptance-receipt.json',
    '.modern/bleedingdev-publish/cohort.sha256',
    '.modern/bleedingdev-publish/manifest.json',
    '.modern/bleedingdev-publish/manifest.json.sha256',
    '.modern/bleedingdev-publish/release-identity.json',
    '.modern/bleedingdev-publish/tarballs/*.tgz',
  ]);
  assert.equal(identityUpload.with['include-hidden-files'], true);
  assert.equal(
    identityUpload.with.name,
    qualifiedPublicationIdentityArtifactName(
      'needs.accept-release.outputs.producer_artifact_identity',
      'github.run_attempt',
    ),
  );
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

  for (const pattern of [
    /from '\.\/scripts\/ultramodern-publish\/prepare-bleedingdev-packages\.mjs'/u,
    /const requestedVersion = process\.env\.PUBLISH_VERSION;/u,
    /const sourceCommit = process\.env\.GITHUB_SHA;/u,
    /const sourceRepository = process\.env\.GITHUB_REPOSITORY;/u,
    /await assertRegistrySourceCommitUnpublished\(\{[\s\S]*packageName,[\s\S]*requestedVersion,[\s\S]*sourceCommit,[\s\S]*sourceRepository,[\s\S]*\}\);/u,
  ]) {
    assert.match(gate.run, pattern);
  }
  assert.doesNotMatch(
    gate.run,
    /\bfetch\s*\(|metadata\.versions|registry\.npmjs\.org|createRegistryProvenanceExpectation|verifyRegistryProvenance|verifySigstoreBundle|Buffer\.from|\battestations?\b/iu,
  );

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

test('workflow_run readiness downloads and verifies the triggering release identity', () => {
  const parsed = workflow(readinessWorkflowPath);
  const resolver = parsed.jobs['resolve-release-identity'];
  const proof = parsed.jobs['published-create-superapp'];
  const signal = namedStep(resolver, 'Find non-dry-run publication signal');
  const selectOutcome = namedStep(
    resolver,
    'Select the triggering publish outcome',
  );
  const verifyOutcome = namedStep(
    resolver,
    'Verify triggering publish outcome',
  );
  const outcomeDownload = artifactStep(
    resolver,
    'actions/download-artifact',
    githubExpression('steps.publish-outcome-artifact.outputs.artifact_name'),
  );
  const download = artifactStep(
    resolver,
    'actions/download-artifact',
    githubExpression('steps.publication-signal.outputs.artifact_name'),
  );
  const postpublishDownload = artifactStep(
    proof,
    'actions/download-artifact',
    githubExpression(
      'needs.resolve-release-identity.outputs.publication_artifact_name',
    ),
  );
  const resolverCheckouts = actionSteps(resolver, 'actions/checkout');
  const proofCheckouts = actionSteps(proof, 'actions/checkout');
  const [resolverCheckout] = resolverCheckouts;
  const verifyReceipt = namedStep(
    resolver,
    'Verify triggering release acceptance receipt',
  );
  const verifyIdentity = namedStep(
    resolver,
    'Verify triggering release identity',
  );
  const [checkout] = proofCheckouts;

  assert.equal(parsed.permissions.contents, 'read');
  assert.equal(parsed.permissions.actions, 'read');
  assert.deepEqual(parsed.permissions, { contents: 'read', actions: 'read' });
  assert.deepEqual(parsed.concurrency, {
    group: `ultramodern-production-readiness-${githubExpression(
      'github.event.workflow_run.id || github.run_id',
    )}`,
    'cancel-in-progress': false,
  });
  assert.equal(download.with['github-token'], githubExpression('github.token'));
  assert.equal(
    download.with['run-id'],
    githubExpression('github.event.workflow_run.id'),
  );
  assert.equal(
    download.with.name,
    githubExpression('steps.publication-signal.outputs.artifact_name'),
  );
  assert.equal(Object.hasOwn(resolver.outputs, 'artifact_name'), false);
  assert.equal(
    resolver.outputs.publication_artifact_name,
    githubExpression(
      'steps.release-identity.outputs.publication_artifact_name',
    ),
  );
  assert.equal(
    resolver.outputs.producer_artifact_identity,
    githubExpression(
      'steps.release-identity.outputs.producer_artifact_identity',
    ),
  );
  assert.equal(
    resolver.outputs.dry_run,
    githubExpression('steps.publish-outcome.outputs.dry_run'),
  );
  assert.equal(resolverCheckouts.length, 1);
  assert.equal(proofCheckouts.length, 1);
  assert.equal(
    resolverCheckout.with.ref,
    githubExpression('github.event.workflow_run.head_sha'),
  );
  assert.equal(resolverCheckout.with['fetch-depth'], 1);
  assert.equal(resolverCheckout.with['persist-credentials'], false);
  assert.ok(
    resolver.steps.indexOf(signal) < resolver.steps.indexOf(resolverCheckout) &&
      resolver.steps.indexOf(resolverCheckout) <
        resolver.steps.indexOf(selectOutcome) &&
      resolver.steps.indexOf(selectOutcome) <
        resolver.steps.indexOf(outcomeDownload) &&
      resolver.steps.indexOf(outcomeDownload) <
        resolver.steps.indexOf(verifyOutcome) &&
      resolver.steps.indexOf(verifyOutcome) <
        resolver.steps.indexOf(download) &&
      resolver.steps.indexOf(download) < resolver.steps.indexOf(verifyReceipt),
  );
  assert.ok(
    resolver.steps.indexOf(verifyReceipt) <
      resolver.steps.indexOf(verifyIdentity),
  );
  assert.equal(
    postpublishDownload.with['github-token'],
    githubExpression('github.token'),
  );
  assert.equal(
    postpublishDownload.with['run-id'],
    githubExpression('github.event.workflow_run.id'),
  );
  assert.equal(
    proof.env.TRIGGER_HEAD_SHA,
    githubExpression('github.event.workflow_run.head_sha'),
  );
  assert.equal(checkout.with.ref, githubExpression('env.TRIGGER_HEAD_SHA'));
  assert.equal(checkout.with['persist-credentials'], false);
  assert.ok(normalizeNeeds(proof).includes('resolve-release-identity'));
  assert.match(
    proof.if,
    /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(proof.if, /publication_signal == 'true'/);
  assert.match(proof.if, /dry_run == 'false'/);
  assert.match(proof.if, /authorized == 'true'/);
  assert.equal(
    postpublishDownload.with.name,
    githubExpression(
      'needs.resolve-release-identity.outputs.publication_artifact_name',
    ),
  );
  for (const condition of [
    "github.event.workflow_run.event == 'workflow_dispatch'",
    'github.event.workflow_run.repository.full_name == github.repository',
    'github.event.workflow_run.head_repository.full_name == github.repository',
    'github.event.workflow_run.actor.login == github.repository_owner',
    'github.event.workflow_run.triggering_actor.login == github.repository_owner',
  ]) {
    assert.ok(resolver.if.includes(condition), condition);
  }
  assert.match(signal.run, /gh api --paginate --slurp/u);
  assert.doesNotMatch(
    signal.run,
    /--jq|exists=false|skipping release readiness/iu,
  );
  assert.match(selectOutcome.run, /publish-outcome\.mjs select-artifact/u);
  assert.match(selectOutcome.run, /--completed-at/u);
  assert.match(verifyOutcome.run, /publish-outcome\.mjs verify/u);
  assert.match(verifyOutcome.run, /--source-commit/u);
  assert.match(verifyOutcome.run, /--run-attempt/u);
  assert.match(
    verifyReceipt.run,
    /steps\.publish-outcome\.outputs\.producer_run_identity/u,
  );
  assert.doesNotMatch(verifyReceipt.run, /GITHUB_RUN_ATTEMPT/u);
});

test('readiness uses the shared runner for exact post-publish acceptance', () => {
  const source = fs.readFileSync(readinessWorkflowPath, 'utf8');
  const parsed = workflow(readinessWorkflowPath);
  const resolver = parsed.jobs['resolve-release-identity'];
  const proof = parsed.jobs['published-create-superapp'];
  const verifyIdentity = namedStep(
    resolver,
    'Verify triggering release identity',
  );
  const verifyReceipt = namedStep(
    resolver,
    'Verify triggering release acceptance receipt',
  );
  const bindManifest = namedStep(
    proof,
    'Bind downloaded manifest to publication identity',
  );
  const postpublishAcceptance = namedStep(
    proof,
    'Run post-publish ERP-10 acceptance',
  );

  assert.doesNotMatch(source, /@latest/);
  assert.equal(
    Object.hasOwn(parsed.on.workflow_dispatch.inputs.create_package, 'default'),
    false,
  );
  assert.match(verifyIdentity.run, /manifest\.json\.sha256/);
  assert.match(verifyIdentity.run, /cohort\.sha256/);
  assert.match(verifyIdentity.run, /['"]cohortProjection['"]/);
  assert.match(verifyIdentity.run, /path\.join\(root, file\)/);
  assert.match(verifyIdentity.run, /manifest\.source\.commit/);
  assert.match(verifyIdentity.run, /producerArtifactIdentity/);
  assert.match(verifyIdentity.run, /producerRunAttempt/);
  assert.match(verifyIdentity.run, /producerRunIdentity/);
  assert.match(verifyIdentity.run, /publicationRunAttempt/);
  assert.doesNotMatch(
    verifyIdentity.run,
    /releaseRunAttempt|releaseRunIdentity/,
  );
  assert.match(verifyReceipt.run, /acceptance-receipt\.mjs/);
  assert.match(verifyReceipt.run, /--verify/);
  assert.match(verifyReceipt.run, /--manifest/);
  assert.match(verifyReceipt.run, /--receipt/);
  assert.match(verifyReceipt.run, /--run-identity/);
  assert.doesNotMatch(verifyIdentity.run, /receiptType|binding\?\.sourceSha/);
  assert.equal(
    namedStep(resolver, 'Verify triggering release identity').env
      .TRIGGER_RUN_ATTEMPT,
    githubExpression('github.event.workflow_run.run_attempt'),
  );
  assert.match(bindManifest.run, /RELEASE_MANIFEST_SHA256/);
  assert.ok(
    postpublishAcceptance.run.includes(
      'scripts/ultramodern-publish/run-release-acceptance.mjs',
    ),
  );
  for (const argument of [
    '--mode published',
    '--manifest "$BLEEDINGDEV_RELEASE_IDENTITY_DIR/manifest.json"',
    '--expected-source-revision "$TRIGGER_HEAD_SHA"',
    '--expected-version "$RELEASE_VERSION"',
    '--run-identity "$TRIGGER_RUN_IDENTITY"',
    '--scale-profile erp-10',
    '--registry-url https://registry.npmjs.org/',
    '--receipt "$BLEEDINGDEV_POSTPUBLISH_ACCEPTANCE_RECEIPT"',
  ]) {
    assert.ok(postpublishAcceptance.run.includes(argument), argument);
  }
  assert.doesNotMatch(
    postpublishAcceptance.run,
    /run-published-create-proof\.mjs|--create-package/,
  );
  assert.equal(
    parsed.env.BLEEDINGDEV_POSTPUBLISH_ACCEPTANCE_RECEIPT,
    '.modern/production-readiness/postpublish-acceptance-receipt.json',
  );
  assert.equal(
    proof.steps.some(
      step => step.name === 'Bind readiness evidence to the triggering release',
    ),
    false,
  );
});

test('workflows delegate the acceptance receipt contract to its validator', () => {
  for (const workflowPath of [publishWorkflowPath, readinessWorkflowPath]) {
    const source = fs.readFileSync(workflowPath, 'utf8');

    assert.doesNotMatch(
      source,
      /bleedingdev\.ultramodern\.release-acceptance-receipt/,
    );
    assert.doesNotMatch(source, /receipt\.schemaVersion\s*!==\s*\d+/);
    assert.doesNotMatch(source, /receipt\.profile\?\.version\s*!==\s*\d+/);
    assert.doesNotMatch(
      source,
      /receipt\.binding\?\.profile\?\.version\s*!==\s*\d+/,
    );
  }
});

test('workflow security gates every receipt implementation change', () => {
  const parsed = workflow(workflowSecurityPath);
  const job = parsed.jobs['workflow-security'];
  const tests = namedStep(job, 'Run validator unit tests').run;

  for (const trigger of [parsed.on.pull_request, parsed.on.push]) {
    assert.ok(
      trigger.paths.includes('scripts/ultramodern-production-readiness/**'),
    );
  }
  assert.match(
    tests,
    /scripts\/ultramodern-production-readiness\/__tests__\/\*\.test\.js/,
  );
  assert.match(
    tests,
    /scripts\/ultramodern-publish\/__tests__\/build-bleedingdev-packages\.test\.js/,
  );
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
