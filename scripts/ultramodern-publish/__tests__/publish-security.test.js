const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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
const requireFromPrebundle = createRequire(
  path.join(repoRoot, 'scripts/prebundle/package.json'),
);
const { load: parseYaml } = requireFromPrebundle('js-yaml');
const githubExpression = expression => `\${{ ${expression} }}`;

function workflow(filePath) {
  return parseYaml(fs.readFileSync(filePath, 'utf8'));
}

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
    'bleedingdev-release-bundle',
  );
  artifactStep(
    dryRun,
    'actions/download-artifact',
    'bleedingdev-release-acceptance',
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

test('prepare, acceptance, and publish transfer one exact immutable bundle', () => {
  const parsed = workflow(publishWorkflowPath);
  const prepare = parsed.jobs['prepare-release'];
  const acceptance = parsed.jobs['accept-release'];
  const publish = parsed.jobs.publish;
  const bundleUpload = artifactStep(
    prepare,
    'actions/upload-artifact',
    'bleedingdev-release-bundle',
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
    'bleedingdev-release-bundle',
  );
  artifactStep(
    publish,
    'actions/download-artifact',
    'bleedingdev-release-bundle',
  );
  const acceptanceUpload = artifactStep(
    acceptance,
    'actions/upload-artifact',
    'bleedingdev-release-acceptance',
  );
  artifactStep(
    publish,
    'actions/download-artifact',
    'bleedingdev-release-acceptance',
  );
  assert.equal(acceptanceUpload.with['include-hidden-files'], true);

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
    'bleedingdev-release-identity',
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
});

test('workflow_run readiness downloads and verifies the triggering release identity', () => {
  const parsed = workflow(readinessWorkflowPath);
  const resolver = parsed.jobs['resolve-release-identity'];
  const proof = parsed.jobs['published-create-superapp'];
  const download = artifactStep(
    resolver,
    'actions/download-artifact',
    'bleedingdev-release-identity',
  );
  const postpublishDownload = artifactStep(
    proof,
    'actions/download-artifact',
    'bleedingdev-release-identity',
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
  assert.equal(resolverCheckouts.length, 1);
  assert.equal(proofCheckouts.length, 1);
  assert.equal(
    resolverCheckout.with.ref,
    githubExpression('github.event.workflow_run.head_sha'),
  );
  assert.equal(resolverCheckout.with['fetch-depth'], 1);
  assert.equal(resolverCheckout.with['persist-credentials'], false);
  assert.ok(
    resolver.steps.indexOf(resolverCheckout) < resolver.steps.indexOf(download),
  );
  assert.ok(
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
  assert.match(proof.if, /publication_signal == 'true'/);
  assert.match(proof.if, /authorized == 'true'/);
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
