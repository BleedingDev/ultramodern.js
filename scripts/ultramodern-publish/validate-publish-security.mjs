#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTemplateRequiredFiles,
  trustedPublishRepository,
} from './lib/prepare-bleedingdev-packages/constants.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const requireFromPrebundle = createRequire(
  new URL('../prebundle/package.json', import.meta.url),
);
const publishWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/publish-bleedingdev.yml',
);
const readinessWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/ultramodern-production-readiness.yml',
);
const publishScriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs',
);
const trustedPublisherScriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/configure-bleedingdev-trusted-publishing.mjs',
);
const releaseAcceptanceScriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/run-release-acceptance.mjs',
);
const releaseManifestReaderPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/lib/source-create-proof/release-manifest.mjs',
);
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const enforcedPublishTag = 'latest';
const enforcedPublishConcurrency = '8';
const releaseBundleArtifact = 'bleedingdev-release-bundle';
const releaseAcceptanceArtifact = 'bleedingdev-release-acceptance';
const releaseIdentityArtifact = 'bleedingdev-release-identity';
const releaseManifestPath = '.modern/bleedingdev-publish/manifest.json';
const releaseManifestDigestPath =
  '.modern/bleedingdev-publish/manifest.json.sha256';
const releaseCohortDigestPath = '.modern/bleedingdev-publish/cohort.sha256';
const releaseTarballGlob = '.modern/bleedingdev-publish/tarballs/*.tgz';
const releaseAcceptanceReceiptPath =
  '.modern/bleedingdev-publish/acceptance-receipt.json';
const releaseIdentityPath = '.modern/bleedingdev-publish/release-identity.json';
const postpublishAcceptanceReceiptPath =
  '.modern/production-readiness/postpublish-acceptance-receipt.json';
const githubExpression = expression => `\${{ ${expression} }}`;
const shellInterpolation = expression => `\${${expression}}`;
const releaseArtifactEnvironmentNames = new Map([
  [releaseBundleArtifact, 'BLEEDINGDEV_RELEASE_BUNDLE_ARTIFACT'],
  [releaseAcceptanceArtifact, 'BLEEDINGDEV_RELEASE_ACCEPTANCE_ARTIFACT'],
  [releaseIdentityArtifact, 'BLEEDINGDEV_RELEASE_IDENTITY_ARTIFACT'],
]);
const qualifiedReleaseArtifactName = (artifactName, identityExpression) => {
  const environmentName = releaseArtifactEnvironmentNames.get(artifactName);
  requireCondition(
    Boolean(environmentName),
    `release artifact ${artifactName} must have a canonical environment name`,
  );
  return `${githubExpression(`env.${environmentName}`)}-${githubExpression(identityExpression)}`;
};
const qualifiedPublicationIdentityArtifactName = (
  producerIdentityExpression,
  publicationAttemptExpression,
) =>
  `${qualifiedReleaseArtifactName(
    releaseIdentityArtifact,
    producerIdentityExpression,
  )}-publication-attempt-${githubExpression(publicationAttemptExpression)}`;
const readinessConcurrencyGroup = `ultramodern-production-readiness-${githubExpression(
  'github.event.workflow_run.id || github.run_id',
)}`;
// The publish branch is intentionally hardcoded rather than derived from the
// BLEEDINGDEV_PUBLISH_BRANCH repository variable: the workflow-level if-gates
// may narrow where jobs run, but a mutable repo variable must never widen
// where packages can be published from. Changing the publish branch requires
// editing this constant in a reviewed commit.
const enforcedPublishBranch = 'main-ultramodern';
const registrySourceCohortStepName =
  'Reject an already published source cohort';
const authoritativeRegistrySourceCohortModule =
  './scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs';

function fail(message) {
  throw new Error(`Publish security validation failed: ${message}`);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function requireIncludes(content, token, context) {
  if (!content.includes(token)) {
    fail(`${context} must include ${token}`);
  }
}

function requireRecord(value, context) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${context} must be a mapping`);
  }
  return value;
}

function requireCondition(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function parseWorkflow(filePath, context) {
  let loadYaml;
  try {
    ({ load: loadYaml } = requireFromPrebundle('js-yaml'));
  } catch (error) {
    fail(
      `${context} requires js-yaml from @scripts/prebundle; run pnpm install --filter @scripts/prebundle (${error.message})`,
    );
  }

  let workflow;
  try {
    workflow = loadYaml(readText(filePath), { json: false });
  } catch (error) {
    fail(`${context} is not valid YAML: ${error.message}`);
  }
  return requireRecord(workflow, context);
}

function normalizeNeeds(job, context) {
  if (typeof job.needs === 'string') {
    return [job.needs];
  }
  if (
    Array.isArray(job.needs) &&
    job.needs.every(item => typeof item === 'string')
  ) {
    return job.needs;
  }
  fail(`${context} must declare needs as a job id or list of job ids`);
}

function stepsFor(job, context) {
  requireCondition(Array.isArray(job.steps), `${context} must declare steps`);
  return job.steps.map((step, index) =>
    requireRecord(step, `${context} step ${index + 1}`),
  );
}

function actionSteps(job, action, context) {
  return stepsFor(job, context).filter(
    step => typeof step.uses === 'string' && step.uses.startsWith(`${action}@`),
  );
}

function namedStep(job, name, context) {
  const step = stepsFor(job, context).find(
    candidate => candidate.name === name,
  );
  requireCondition(Boolean(step), `${context} must include step "${name}"`);
  return step;
}

function artifactStep(job, action, artifactName, context) {
  const step = actionSteps(job, action, context).find(candidate => {
    const withOptions = requireRecord(
      candidate.with ?? {},
      `${context} ${artifactName} action inputs`,
    );
    return withOptions.name === artifactName;
  });
  requireCondition(
    Boolean(step),
    `${context} must ${action.includes('upload') ? 'upload' : 'download'} ${artifactName}`,
  );
  return step;
}

function artifactPaths(step, context) {
  const withOptions = requireRecord(step.with, `${context} action inputs`);
  requireCondition(
    typeof withOptions.path === 'string',
    `${context} path must be a string`,
  );
  return withOptions.path
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function assertSameMembers(actual, expected, context) {
  const sortedExpected = [...expected].sort((left, right) =>
    left.localeCompare(right),
  );
  requireCondition(
    JSON.stringify(actual) === JSON.stringify(sortedExpected),
    `${context} must contain exactly ${sortedExpected.join(', ')}`,
  );
}

function requireHiddenArtifactUpload(step, context) {
  const withOptions = requireRecord(step.with, `${context} action inputs`);
  requireCondition(
    withOptions['include-hidden-files'] === true,
    `${context} must explicitly include hidden .modern files`,
  );
}

export function validateRegistrySourceCohortGate(step) {
  const context = 'prepare-release registry source-cohort gate';
  const environment = requireRecord(step.env ?? {}, `${context} environment`);
  assertSameMembers(
    Object.keys(environment).sort((left, right) => left.localeCompare(right)),
    ['PUBLISH_VERSION'],
    `${context} environment`,
  );
  requireCondition(
    environment.PUBLISH_VERSION === githubExpression('inputs.version'),
    `${context} must bind the requested version through PUBLISH_VERSION`,
  );
  requireCondition(
    typeof step.run === 'string',
    `${context} must be an inline module invocation`,
  );

  const run = step.run;
  requireCondition(
    /^\s*node\s+--input-type=module\s+<<'NODE'\n[\s\S]*\nNODE\s*$/u.test(run),
    `${context} must execute a quoted Node module heredoc`,
  );
  const requiredPatterns = [
    new RegExp(
      `import\\s*\\{\\s*assertRegistrySourceCommitUnpublished\\s*,?\\s*\\}\\s*from\\s*['"]${authoritativeRegistrySourceCohortModule.replaceAll(
        '.',
        '\\.',
      )}['"]\\s*;`,
      'u',
    ),
    /const\s+packageName\s*=\s*['"]@bleedingdev\/modern-js-create['"]\s*;/u,
    /const\s+requestedVersion\s*=\s*process\.env\.PUBLISH_VERSION\s*;/u,
    /const\s+sourceCommit\s*=\s*process\.env\.GITHUB_SHA\s*;/u,
    /const\s+sourceRepository\s*=\s*process\.env\.GITHUB_REPOSITORY\s*;/u,
    /await\s+assertRegistrySourceCommitUnpublished\s*\(\s*\{\s*packageName\s*,\s*requestedVersion\s*,\s*sourceCommit\s*,\s*sourceRepository\s*,?\s*\}\s*\)\s*;/u,
  ];
  requireCondition(
    requiredPatterns.every(pattern => pattern.test(run)),
    `${context} must invoke the authoritative API with the exact package, version, commit, and repository bindings`,
  );
  requireCondition(
    (run.match(/\bassertRegistrySourceCommitUnpublished\b/gu) ?? []).length ===
      2,
    `${context} must import and invoke the authoritative API exactly once`,
  );
  requireCondition(
    !run.includes('${{'),
    `${context} must route workflow inputs through its environment`,
  );

  const forbiddenInlineRegistryPatterns = [
    /\bfetch\s*\(/u,
    /\bmetadata\s*\.\s*versions\b/u,
    /\b(?:createRegistryProvenanceExpectation|verifyRegistryProvenance|verifySigstoreBundle)\b/u,
    /\bBuffer\s*\.\s*from\s*\(/u,
    /registry\.npmjs\.org/iu,
    /\battestations?\b/iu,
  ];
  requireCondition(
    !forbiddenInlineRegistryPatterns.some(pattern => pattern.test(run)),
    `${context} must not scan npm metadata or parse registry provenance inline`,
  );
}

function requireTriggerRunArtifactDownload(step, context) {
  const withOptions = requireRecord(step.with, `${context} action inputs`);
  requireCondition(
    withOptions['github-token'] === githubExpression('github.token') &&
      withOptions['run-id'] ===
        githubExpression('github.event.workflow_run.id'),
    `${context} must use github-token and the triggering run id`,
  );
  if (Object.hasOwn(withOptions, 'repository')) {
    requireCondition(
      withOptions.repository === githubExpression('github.repository'),
      `${context} repository must remain the triggering repository`,
    );
  }
}

function validateNoTokenEnv() {
  for (const envName of ['NPM_TOKEN', 'NODE_AUTH_TOKEN']) {
    if (process.env[envName]) {
      fail(
        `${envName} must not be present; use npm trusted publishing via OIDC`,
      );
    }
  }
}

function validateGitHubContext() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    return;
  }

  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    fail('publish workflow must run only from workflow_dispatch');
  }
  console.log(
    `Enforcing publish branch refs/heads/${enforcedPublishBranch}; actual ref: ${process.env.GITHUB_REF}`,
  );
  if (process.env.GITHUB_REF !== `refs/heads/${enforcedPublishBranch}`) {
    fail(
      `publish workflow must run only from refs/heads/${enforcedPublishBranch}`,
    );
  }
  if (process.env.GITHUB_REPOSITORY !== trustedPublishRepository) {
    fail(`publish workflow must run only in ${trustedPublishRepository}`);
  }
}

function validateInputs() {
  const version = process.env.PUBLISH_VERSION ?? '';
  const tag = process.env.PUBLISH_TAG ?? '';
  const publishConcurrency = process.env.PUBLISH_CONCURRENCY ?? '';

  if (!semverPattern.test(version)) {
    fail(`version must be a semver value, found "${version}"`);
  }
  if (tag !== enforcedPublishTag) {
    fail(`dist-tag must be ${enforcedPublishTag}, found "${tag}"`);
  }
  if (publishConcurrency !== enforcedPublishConcurrency) {
    fail(
      `publish_concurrency must be fixed at ${enforcedPublishConcurrency}, found "${publishConcurrency}"`,
    );
  }

  const forbiddenInputs = [
    'DEPENDENCY_VERSION',
    'PACKAGE_MODE',
    'EXPLICIT_PACKAGES',
    'AFFECTED_BASE',
    'AFFECTED_HEAD',
    'SKIP_EXISTING',
  ].filter(envName => process.env[envName]);
  if (forbiddenInputs.length > 0) {
    fail(
      `partial publish controls are forbidden: ${forbiddenInputs.join(', ')}`,
    );
  }
}

function validateRegistry() {
  const registry = execFileSync('npm', ['config', 'get', 'registry'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (registry !== 'https://registry.npmjs.org/') {
    fail(`npm registry must be https://registry.npmjs.org/, found ${registry}`);
  }
}

function validatePublishWorkflow(workflow) {
  const permissions = requireRecord(
    workflow.permissions,
    'publish workflow permissions',
  );
  requireCondition(
    permissions.contents === 'read',
    'publish workflow must grant only contents: read by default',
  );
  assertSameMembers(
    Object.keys(permissions).sort((left, right) => left.localeCompare(right)),
    ['contents'],
    'publish workflow permissions',
  );
  requireCondition(
    permissions['id-token'] !== 'write',
    'publish workflow must not grant id-token: write at workflow level',
  );

  const concurrency = requireRecord(
    workflow.concurrency,
    'publish workflow concurrency',
  );
  requireCondition(
    concurrency.group === 'publish-bleedingdev',
    'publish workflow must use one version-independent publish-bleedingdev mutex',
  );
  requireCondition(
    concurrency['cancel-in-progress'] === false,
    'publish workflow concurrency must not cancel an active release',
  );

  const jobs = requireRecord(workflow.jobs, 'publish workflow jobs');
  const securityJob = requireRecord(
    jobs['publish-security'],
    'publish-security job',
  );
  const prepareJob = requireRecord(
    jobs['prepare-release'],
    'prepare-release job',
  );
  const acceptanceJob = requireRecord(
    jobs['accept-release'],
    'accept-release job',
  );
  const validationJob = requireRecord(
    jobs['validate-release'],
    'validate-release job',
  );
  const publishJob = requireRecord(jobs.publish, 'publish job');

  for (const [jobId, job] of [
    ['publish-security', securityJob],
    ['prepare-release', prepareJob],
    ['accept-release', acceptanceJob],
    ['validate-release', validationJob],
  ]) {
    requireCondition(
      !Object.hasOwn(job, 'permissions'),
      `${jobId} must inherit the read-only workflow permissions`,
    );
  }
  const publishPermissions = requireRecord(
    publishJob.permissions,
    'publish job permissions',
  );
  assertSameMembers(
    Object.keys(publishPermissions).sort((left, right) =>
      left.localeCompare(right),
    ),
    ['contents', 'id-token'],
    'publish job permissions',
  );
  requireCondition(
    publishPermissions.contents === 'read' &&
      publishPermissions['id-token'] === 'write',
    'publish job permissions must be contents: read and id-token: write',
  );

  assertSameMembers(
    normalizeNeeds(publishJob, 'publish job needs').sort((left, right) =>
      left.localeCompare(right),
    ),
    ['publish-security', 'accept-release'],
    'publish job dependencies',
  );
  assertSameMembers(
    normalizeNeeds(validationJob, 'validate-release job needs').sort(
      (left, right) => left.localeCompare(right),
    ),
    ['publish-security', 'accept-release'],
    'validate-release job dependencies',
  );
  requireCondition(
    normalizeNeeds(acceptanceJob, 'accept-release job needs').includes(
      'prepare-release',
    ),
    'accept-release job must depend on prepare-release',
  );

  const oidcJobs = Object.entries(jobs)
    .filter(([, job]) => job?.permissions?.['id-token'] === 'write')
    .map(([jobId]) => jobId);
  assertSameMembers(oidcJobs, ['publish'], 'OIDC-enabled jobs');
  requireCondition(
    publishJob.environment === 'npm-publish',
    'publish job must use the npm-publish environment',
  );
  requireCondition(
    !Object.hasOwn(validationJob, 'environment') &&
      typeof validationJob.if === 'string' &&
      validationJob.if.includes('inputs.dry_run == true'),
    'validate-release must run only for dry runs without an environment',
  );
  requireCondition(
    typeof publishJob.if === 'string' &&
      publishJob.if.includes('inputs.dry_run == false'),
    'publish job must run only for non-dry releases',
  );
  for (const [jobId, job] of [
    ['publish-security', securityJob],
    ['prepare-release', prepareJob],
    ['accept-release', acceptanceJob],
    ['validate-release', validationJob],
    ['publish', publishJob],
  ]) {
    requireCondition(
      typeof job.if === 'string' &&
        job.if.includes('github.actor == github.repository_owner') &&
        job.if.includes('github.triggering_actor == github.repository_owner') &&
        job.if.includes('vars.BLEEDINGDEV_PUBLISH_BRANCH'),
      `${jobId} must restrict dispatches and reruns to the repository owner on the configured publish branch`,
    );
  }

  const prepareUploads = actionSteps(
    prepareJob,
    'actions/upload-artifact',
    'prepare-release job',
  );
  requireCondition(
    prepareUploads.length === 1,
    'prepare-release job must upload only one artifact',
  );
  const bundleUpload = artifactStep(
    prepareJob,
    'actions/upload-artifact',
    qualifiedReleaseArtifactName(
      releaseBundleArtifact,
      'steps.producer-identity.outputs.artifact_identity',
    ),
    'prepare-release job',
  );
  assertSameMembers(
    artifactPaths(bundleUpload, 'immutable release bundle'),
    [
      releaseManifestPath,
      releaseManifestDigestPath,
      releaseCohortDigestPath,
      releaseTarballGlob,
    ],
    'immutable release bundle paths',
  );
  requireHiddenArtifactUpload(bundleUpload, 'immutable release bundle');

  const prepareSteps = stepsFor(prepareJob, 'prepare-release job');
  const installStep = namedStep(
    prepareJob,
    'Install Dependencies',
    'prepare-release job',
  );
  const qualificationStep = namedStep(
    prepareJob,
    'Qualify release source',
    'prepare-release job',
  );
  const registrySourceCohortStep = namedStep(
    prepareJob,
    registrySourceCohortStepName,
    'prepare-release job',
  );
  const buildStep = namedStep(
    prepareJob,
    'Build Packages',
    'prepare-release job',
  );
  const packStep = namedStep(
    prepareJob,
    'Prepare exact release tarballs and manifest',
    'prepare-release job',
  );
  requireCondition(
    typeof installStep.run === 'string' &&
      installStep.run.includes('pnpm install --frozen-lockfile'),
    'prepare-release must use a frozen dependency install',
  );
  requireCondition(
    qualificationStep.run.includes('pnpm test:scripts') &&
      qualificationStep.run.includes('pnpm --filter @modern-js/create test'),
    'prepare-release must run the canonical release and create test suites',
  );
  validateRegistrySourceCohortGate(registrySourceCohortStep);
  requireCondition(
    prepareSteps.indexOf(installStep) <
      prepareSteps.indexOf(qualificationStep) &&
      prepareSteps.indexOf(qualificationStep) <
        prepareSteps.indexOf(registrySourceCohortStep) &&
      prepareSteps.indexOf(registrySourceCohortStep) <
        prepareSteps.indexOf(buildStep) &&
      prepareSteps.indexOf(buildStep) < prepareSteps.indexOf(packStep) &&
      prepareSteps.indexOf(packStep) < prepareSteps.indexOf(bundleUpload),
    'prepare-release source qualification and registry source-cohort gate must run after frozen install and before build, pack, and upload',
  );

  const acceptanceBundleDownload = artifactStep(
    acceptanceJob,
    'actions/download-artifact',
    qualifiedReleaseArtifactName(
      releaseBundleArtifact,
      'needs.prepare-release.outputs.producer_artifact_identity',
    ),
    'accept-release job',
  );
  const publishBundleDownload = artifactStep(
    publishJob,
    'actions/download-artifact',
    qualifiedReleaseArtifactName(
      releaseBundleArtifact,
      'needs.accept-release.outputs.producer_artifact_identity',
    ),
    'publish job',
  );
  const validationBundleDownload = artifactStep(
    validationJob,
    'actions/download-artifact',
    qualifiedReleaseArtifactName(
      releaseBundleArtifact,
      'needs.accept-release.outputs.producer_artifact_identity',
    ),
    'validate-release job',
  );
  const acceptanceUpload = artifactStep(
    acceptanceJob,
    'actions/upload-artifact',
    qualifiedReleaseArtifactName(
      releaseAcceptanceArtifact,
      'needs.prepare-release.outputs.producer_artifact_identity',
    ),
    'accept-release job',
  );
  const publishAcceptanceDownload = artifactStep(
    publishJob,
    'actions/download-artifact',
    qualifiedReleaseArtifactName(
      releaseAcceptanceArtifact,
      'needs.accept-release.outputs.producer_artifact_identity',
    ),
    'publish job',
  );
  const validationAcceptanceDownload = artifactStep(
    validationJob,
    'actions/download-artifact',
    qualifiedReleaseArtifactName(
      releaseAcceptanceArtifact,
      'needs.accept-release.outputs.producer_artifact_identity',
    ),
    'validate-release job',
  );
  assertSameMembers(
    artifactPaths(acceptanceUpload, 'release acceptance receipt'),
    [releaseAcceptanceReceiptPath],
    'release acceptance receipt paths',
  );
  requireHiddenArtifactUpload(acceptanceUpload, 'release acceptance receipt');

  const acceptanceRun = namedStep(
    acceptanceJob,
    'Run exact-artifact ERP-10 acceptance',
    'accept-release job',
  ).run;
  requireCondition(
    typeof acceptanceRun === 'string' &&
      acceptanceRun.includes(
        'scripts/ultramodern-publish/run-release-acceptance.mjs',
      ) &&
      acceptanceRun.includes('--scale-profile erp-10') &&
      acceptanceRun.includes('--manifest') &&
      acceptanceRun.includes('--receipt') &&
      !acceptanceRun.includes('--verify-receipt'),
    'accept-release job must run ERP-10 acceptance against the exact manifest',
  );

  const receiptVerificationRun = namedStep(
    publishJob,
    'Verify exact release acceptance receipt',
    'publish job',
  ).run;
  requireCondition(
    typeof receiptVerificationRun === 'string' &&
      receiptVerificationRun.includes(
        'scripts/ultramodern-publish/run-release-acceptance.mjs',
      ) &&
      receiptVerificationRun.includes('--verify-receipt') &&
      receiptVerificationRun.includes('--manifest') &&
      receiptVerificationRun.includes('--receipt'),
    'publish job must verify the exact manifest and acceptance receipt before publishing',
  );
  const validationReceiptVerificationRun = namedStep(
    validationJob,
    'Verify exact release acceptance receipt',
    'validate-release job',
  ).run;
  requireCondition(
    typeof validationReceiptVerificationRun === 'string' &&
      validationReceiptVerificationRun.includes(
        'scripts/ultramodern-publish/run-release-acceptance.mjs',
      ) &&
      validationReceiptVerificationRun.includes('--verify-receipt') &&
      validationReceiptVerificationRun.includes('--manifest') &&
      validationReceiptVerificationRun.includes('--receipt'),
    'validate-release must verify the exact manifest and acceptance receipt before dry-run validation',
  );

  const publishRun = namedStep(
    publishJob,
    'Publish only the accepted tarballs',
    'publish job',
  ).run;
  requireCondition(
    typeof publishRun === 'string' &&
      publishRun.includes(
        'scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs',
      ) &&
      publishRun.includes('--publish-existing') &&
      !publishRun.includes('--acceptance-receipt'),
    'publish job must call the supported exact-artifact publish-existing mode',
  );
  requireCondition(
    !publishRun.includes('--dry-run'),
    'publish job must never contain a dry-run path',
  );
  const validationRun = namedStep(
    validationJob,
    'Validate only the accepted tarballs',
    'validate-release job',
  ).run;
  requireCondition(
    typeof validationRun === 'string' &&
      validationRun.includes(
        'scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs',
      ) &&
      validationRun.includes('--publish-existing') &&
      validationRun.includes('--dry-run') &&
      !validationRun.includes('--acceptance-receipt'),
    'validate-release must exercise exact accepted tarballs in dry-run mode',
  );
  const publishSteps = stepsFor(publishJob, 'publish job');
  const receiptVerificationStep = namedStep(
    publishJob,
    'Verify exact release acceptance receipt',
    'publish job',
  );
  const publishStep = namedStep(
    publishJob,
    'Publish only the accepted tarballs',
    'publish job',
  );
  const validationSteps = stepsFor(validationJob, 'validate-release job');
  const validationReceiptVerificationStep = namedStep(
    validationJob,
    'Verify exact release acceptance receipt',
    'validate-release job',
  );
  const validationStep = namedStep(
    validationJob,
    'Validate only the accepted tarballs',
    'validate-release job',
  );
  requireCondition(
    publishSteps.indexOf(publishBundleDownload) <
      publishSteps.indexOf(receiptVerificationStep) &&
      publishSteps.indexOf(publishAcceptanceDownload) <
        publishSteps.indexOf(receiptVerificationStep) &&
      publishSteps.indexOf(receiptVerificationStep) <
        publishSteps.indexOf(publishStep),
    'publish must download the exact bundle and receipt, verify them, then publish',
  );
  requireCondition(
    validationSteps.indexOf(validationBundleDownload) <
      validationSteps.indexOf(validationReceiptVerificationStep) &&
      validationSteps.indexOf(validationAcceptanceDownload) <
        validationSteps.indexOf(validationReceiptVerificationStep) &&
      validationSteps.indexOf(validationReceiptVerificationStep) <
        validationSteps.indexOf(validationStep),
    'validate-release must download the exact bundle and receipt, verify them, then dry-run accepted bytes',
  );
  const acceptanceSteps = stepsFor(acceptanceJob, 'accept-release job');
  requireCondition(
    acceptanceSteps.indexOf(acceptanceBundleDownload) <
      acceptanceSteps.indexOf(
        namedStep(
          acceptanceJob,
          'Run exact-artifact ERP-10 acceptance',
          'accept-release job',
        ),
      ) &&
      acceptanceSteps.indexOf(
        namedStep(
          acceptanceJob,
          'Run exact-artifact ERP-10 acceptance',
          'accept-release job',
        ),
      ) < acceptanceSteps.indexOf(acceptanceUpload),
    'acceptance must consume the downloaded bundle before emitting its receipt',
  );
  for (const [jobId, job] of [
    ['publish', publishJob],
    ['validate-release', validationJob],
  ]) {
    for (const forbidden of [
      /\bpnpm\s+install\b/u,
      /\bnpm\s+pack\b/u,
      /\bpnpm\s+pack\b/u,
      /ultramodern:build/u,
      /\brewrite\b/iu,
      /\bdeclaration(?:s)?\b/iu,
      /\btsgo:dts\b/u,
    ]) {
      requireCondition(
        !stepsFor(job, `${jobId} job`).some(
          step => typeof step.run === 'string' && forbidden.test(step.run),
        ),
        `${jobId} job must not run post-acceptance operation ${forbidden}`,
      );
    }
    requireCondition(
      actionSteps(job, 'jdx/mise-action', `${jobId} job`).length === 0,
      `${jobId} job must not install a build toolchain after acceptance`,
    );
  }
  requireCondition(
    actionSteps(
      validationJob,
      'actions/upload-artifact',
      'validate-release job',
    ).length === 0,
    'validate-release must not emit a publication identity or any artifact',
  );

  const identityUpload = artifactStep(
    publishJob,
    'actions/upload-artifact',
    qualifiedPublicationIdentityArtifactName(
      'needs.accept-release.outputs.producer_artifact_identity',
      'github.run_attempt',
    ),
    'publish job',
  );
  requireCondition(
    !Object.hasOwn(identityUpload, 'if'),
    'published release identity upload must be unconditional inside the non-dry publish job',
  );
  assertSameMembers(
    artifactPaths(identityUpload, 'published release identity'),
    [
      releaseManifestPath,
      releaseManifestDigestPath,
      releaseCohortDigestPath,
      releaseTarballGlob,
      releaseAcceptanceReceiptPath,
      releaseIdentityPath,
    ],
    'published release identity paths',
  );
  requireHiddenArtifactUpload(identityUpload, 'published release identity');
  const identityStep = namedStep(
    publishJob,
    'Prepare non-dry-run release identity',
    'publish job',
  );
  requireCondition(
    !Object.hasOwn(identityStep, 'if'),
    'published release identity creation must be unconditional inside the non-dry publish job',
  );
  requireCondition(
    typeof identityStep.run === 'string' &&
      identityStep.run.includes(
        "manifest.schema !== 'bleedingdev.ultramodern.release-manifest'",
      ) &&
      identityStep.run.includes('manifest.schemaVersion !== 2') &&
      identityStep.run.includes("'cohortProjection'") &&
      identityStep.run.includes('manifest.release.version') &&
      identityStep.run.includes('manifest.source.commit') &&
      identityStep.run.includes('BLEEDINGDEV_RELEASE_MANIFEST_DIGEST') &&
      identityStep.run.includes('BLEEDINGDEV_RELEASE_COHORT_DIGEST') &&
      !identityStep.run.includes('manifest.version') &&
      !identityStep.run.includes('sourceRevision'),
    'published release identity must consume the strict v2 manifest and detached digests',
  );
  requireCondition(
    publishSteps.indexOf(receiptVerificationStep) <
      publishSteps.indexOf(identityStep) &&
      publishSteps.indexOf(identityStep) < publishSteps.indexOf(publishStep) &&
      publishSteps.indexOf(publishStep) < publishSteps.indexOf(identityUpload),
    'non-dry-run identity must be validated before publish and uploaded only after publish succeeds',
  );

  for (const [jobId, job] of Object.entries({
    'publish-security': securityJob,
    'prepare-release': prepareJob,
    'accept-release': acceptanceJob,
    'validate-release': validationJob,
    publish: publishJob,
  })) {
    requireCondition(
      typeof job['timeout-minutes'] === 'number',
      `${jobId} must set timeout-minutes`,
    );
  }
}

function validateReadinessWorkflow(workflow) {
  const permissions = requireRecord(
    workflow.permissions,
    'readiness workflow permissions',
  );
  requireCondition(
    permissions.contents === 'read' && permissions.actions === 'read',
    'readiness workflow must explicitly grant contents: read and actions: read',
  );
  assertSameMembers(
    Object.keys(permissions).sort((left, right) => left.localeCompare(right)),
    ['actions', 'contents'],
    'readiness workflow permissions',
  );

  const concurrency = requireRecord(
    workflow.concurrency,
    'readiness workflow concurrency',
  );
  requireCondition(
    concurrency.group === readinessConcurrencyGroup,
    'readiness concurrency must be unique to the triggering run',
  );
  requireCondition(
    concurrency['cancel-in-progress'] === false,
    'readiness workflow must not cancel an active proof',
  );

  const triggers = requireRecord(workflow.on, 'readiness workflow triggers');
  const workflowRun = requireRecord(
    triggers.workflow_run,
    'readiness workflow_run trigger',
  );
  requireCondition(
    Array.isArray(workflowRun.workflows) &&
      workflowRun.workflows.includes('Publish BleedingDev Packages'),
    'readiness workflow_run must follow Publish BleedingDev Packages',
  );
  const dispatch = requireRecord(
    triggers.workflow_dispatch,
    'readiness workflow_dispatch trigger',
  );
  const dispatchInputs = requireRecord(
    dispatch.inputs,
    'readiness workflow_dispatch inputs',
  );
  const createPackageInput = requireRecord(
    dispatchInputs.create_package,
    'readiness create_package input',
  );
  requireCondition(
    createPackageInput.required === true &&
      !Object.hasOwn(createPackageInput, 'default'),
    'manual readiness must require an exact create_package without a default',
  );

  const jobs = requireRecord(workflow.jobs, 'readiness workflow jobs');
  const identityJob = requireRecord(
    jobs['resolve-release-identity'],
    'resolve-release-identity job',
  );
  const proofJob = requireRecord(
    jobs['published-create-superapp'],
    'published-create-superapp job',
  );
  const manualJob = requireRecord(
    jobs['manual-published-create-superapp'],
    'manual-published-create-superapp job',
  );

  requireCondition(
    identityJob.if.includes(
      "github.event.workflow_run.conclusion == 'success'",
    ),
    'release identity resolution must require a successful triggering run',
  );
  const signalStep = namedStep(
    identityJob,
    'Find non-dry-run publication signal',
    'resolve-release-identity job',
  );
  requireCondition(
    signalStep.run.includes('gh api') &&
      signalStep.run.includes(releaseIdentityArtifact) &&
      signalStep.run.includes('env.TRIGGER_RUN_ATTEMPT') &&
      signalStep.run.includes('publication-attempt-') &&
      signalStep.run.includes('multiple publication identity artifacts'),
    'release identity resolution must select the non-dry-run artifact from the completed publication attempt',
  );
  const identityOutputs = requireRecord(
    identityJob.outputs,
    'resolve-release-identity outputs',
  );
  requireCondition(
    !Object.hasOwn(identityOutputs, 'artifact_name') &&
      identityOutputs.publication_artifact_name ===
        githubExpression(
          'steps.release-identity.outputs.publication_artifact_name',
        ) &&
      identityOutputs.producer_artifact_identity ===
        githubExpression(
          'steps.release-identity.outputs.producer_artifact_identity',
        ),
    'release identity resolution must expose only the verified producer and publication artifact identities',
  );

  const identityCheckouts = actionSteps(
    identityJob,
    'actions/checkout',
    'resolve-release-identity job',
  );
  requireCondition(
    identityCheckouts.length === 1,
    'resolve-release-identity must contain exactly one checkout',
  );
  const [identityCheckout] = identityCheckouts;
  const identityCheckoutInputs = requireRecord(
    identityCheckout.with,
    'trusted receipt verifier checkout inputs',
  );
  requireCondition(
    identityCheckout.if ===
      "steps.publication-signal.outputs.exists == 'true'" &&
      identityCheckoutInputs.ref ===
        githubExpression('github.event.workflow_run.head_sha') &&
      identityCheckoutInputs['fetch-depth'] === 1 &&
      identityCheckoutInputs['persist-credentials'] === false,
    'receipt verification must check out workflow_run.head_sha without persisted credentials',
  );

  const identityDownload = artifactStep(
    identityJob,
    'actions/download-artifact',
    githubExpression('steps.publication-signal.outputs.artifact_name'),
    'resolve-release-identity job',
  );
  requireTriggerRunArtifactDownload(
    identityDownload,
    'cross-run release identity download',
  );

  requireCondition(
    normalizeNeeds(proofJob, 'published-create-superapp job needs').includes(
      'resolve-release-identity',
    ),
    'published-create-superapp must depend on release identity resolution',
  );
  requireCondition(
    proofJob.if.includes(
      "needs.resolve-release-identity.outputs.publication_signal == 'true'",
    ) &&
      proofJob.if.includes(
        "needs.resolve-release-identity.outputs.authorized == 'true'",
      ) &&
      proofJob.if.includes(
        'github.event.workflow_run.head_repository.full_name == github.repository',
      ),
    'every cross-run proof step must be gated by the verified publication identity',
  );
  const proofEnv = requireRecord(
    proofJob.env,
    'published-create-superapp environment',
  );
  requireCondition(
    proofEnv.TRIGGER_HEAD_SHA ===
      githubExpression('github.event.workflow_run.head_sha'),
    'readiness checkout must be bound to workflow_run.head_sha',
  );
  requireCondition(
    proofEnv.RELEASE_MANIFEST_SHA256 ===
      githubExpression(
        'needs.resolve-release-identity.outputs.manifest_sha256',
      ) &&
      proofEnv.RELEASE_VERSION ===
        githubExpression('needs.resolve-release-identity.outputs.version') &&
      proofEnv.TRIGGER_RUN_IDENTITY ===
        githubExpression('needs.resolve-release-identity.outputs.run_identity'),
    'post-publish acceptance must consume the verified manifest, version, and triggering run identity',
  );
  const proofCheckouts = actionSteps(
    proofJob,
    'actions/checkout',
    'published-create-superapp job',
  );
  requireCondition(
    proofCheckouts.length === 1,
    'published-create-superapp must contain exactly one checkout',
  );
  const [checkout] = proofCheckouts;
  const checkoutInputs = requireRecord(
    checkout.with,
    'triggering release checkout inputs',
  );
  requireCondition(
    checkoutInputs.ref === githubExpression('env.TRIGGER_HEAD_SHA') &&
      checkoutInputs['persist-credentials'] === false,
    'readiness checkout must use workflow_run.head_sha without persisted credentials',
  );

  const receiptVerification = namedStep(
    identityJob,
    'Verify triggering release acceptance receipt',
    'resolve-release-identity job',
  );
  const receiptVerificationEnv = requireRecord(
    receiptVerification.env ?? {},
    'triggering release acceptance receipt environment',
  );
  requireCondition(
    receiptVerification.if ===
      "steps.publication-signal.outputs.exists == 'true'" &&
      Object.keys(receiptVerificationEnv).length === 0 &&
      typeof receiptVerification.run === 'string' &&
      receiptVerification.run.includes('acceptance-receipt.mjs') &&
      receiptVerification.run.includes('--verify') &&
      receiptVerification.run.includes(
        '--manifest "$BLEEDINGDEV_RELEASE_IDENTITY_DIR/manifest.json"',
      ) &&
      receiptVerification.run.includes(
        '--receipt "$BLEEDINGDEV_RELEASE_IDENTITY_DIR/acceptance-receipt.json"',
      ) &&
      receiptVerification.run.includes(
        'process.env.BLEEDINGDEV_RELEASE_IDENTITY_DIR',
      ) &&
      receiptVerification.run.includes('release-identity.json') &&
      receiptVerification.run.includes('identity.producerRunIdentity') &&
      !receiptVerification.run.includes('GITHUB_RUN_ATTEMPT'),
    'readiness must delegate the triggering receipt contract to its authoritative validator',
  );

  const identityVerificationStep = namedStep(
    identityJob,
    'Verify triggering release identity',
    'resolve-release-identity job',
  );
  const identityVerification = identityVerificationStep.run;
  requireCondition(
    identityVerification.includes('identity.manifestSha256') &&
      identityVerification.includes('identity.releaseRunId') &&
      identityVerification.includes("'cohortProjection'") &&
      identityVerification.includes(
        "manifest.schema !== 'bleedingdev.ultramodern.release-manifest'",
      ) &&
      identityVerification.includes('manifest.source.commit') &&
      identityVerification.includes('identity.producerArtifactIdentity') &&
      identityVerification.includes('identity.producerRunAttempt') &&
      identityVerification.includes('identity.producerRunIdentity') &&
      identityVerification.includes('identity.publicationRunAttempt') &&
      identityVerification.includes('TRIGGER_ARTIFACT_NAME') &&
      identityVerification.includes('manifest.json.sha256') &&
      identityVerification.includes('cohort.sha256') &&
      identityVerification.includes('path.join(root, file)') &&
      identityVerification.includes('TRIGGER_RUN_ATTEMPT') &&
      identityVerification.includes(
        `publication_artifact_name=${shellInterpolation(
          'process.env.TRIGGER_ARTIFACT_NAME',
        )}`,
      ) &&
      identityVerification.includes(
        `run_identity=${shellInterpolation('identity.producerRunIdentity')}`,
      ) &&
      identityVerification.includes(
        `producer_artifact_identity=${shellInterpolation(
          'identity.producerArtifactIdentity',
        )}`,
      ) &&
      !identityVerification.includes('receipt.schema') &&
      !identityVerification.includes('receipt.receiptType') &&
      !identityVerification.includes('binding?.sourceSha'),
    'readiness must validate the strict triggering manifest and publication identity',
  );
  const identitySteps = stepsFor(identityJob, 'resolve-release-identity job');
  requireCondition(
    identitySteps.indexOf(signalStep) <
      identitySteps.indexOf(identityCheckout) &&
      identitySteps.indexOf(identityCheckout) <
        identitySteps.indexOf(identityDownload) &&
      identitySteps.indexOf(identityDownload) <
        identitySteps.indexOf(receiptVerification) &&
      identitySteps.indexOf(receiptVerification) <
        identitySteps.indexOf(identityVerificationStep),
    'cross-run identity resolution must signal, check out, download, verify the receipt, then authorize',
  );

  const postpublishIdentityDownload = artifactStep(
    proofJob,
    'actions/download-artifact',
    githubExpression(
      'needs.resolve-release-identity.outputs.publication_artifact_name',
    ),
    'published-create-superapp job',
  );
  requireTriggerRunArtifactDownload(
    postpublishIdentityDownload,
    'post-publish release identity download',
  );
  const manifestBindingStep = namedStep(
    proofJob,
    'Bind downloaded manifest to publication identity',
    'published-create-superapp job',
  );
  requireCondition(
    manifestBindingStep.run.includes('RELEASE_MANIFEST_SHA256') &&
      manifestBindingStep.run.includes('manifest.json'),
    'post-publish acceptance must bind its downloaded manifest to the publication identity',
  );
  const postpublishAcceptanceStep = namedStep(
    proofJob,
    'Run post-publish ERP-10 acceptance',
    'published-create-superapp job',
  );
  const postpublishAcceptanceRun = postpublishAcceptanceStep.run;
  requireCondition(
    typeof postpublishAcceptanceRun === 'string' &&
      postpublishAcceptanceRun.includes(
        'scripts/ultramodern-publish/run-release-acceptance.mjs',
      ) &&
      postpublishAcceptanceRun.includes('--mode published') &&
      postpublishAcceptanceRun.includes(
        '--manifest "$BLEEDINGDEV_RELEASE_IDENTITY_DIR/manifest.json"',
      ) &&
      postpublishAcceptanceRun.includes(
        '--expected-source-revision "$TRIGGER_HEAD_SHA"',
      ) &&
      postpublishAcceptanceRun.includes(
        '--expected-version "$RELEASE_VERSION"',
      ) &&
      postpublishAcceptanceRun.includes(
        '--run-identity "$TRIGGER_RUN_IDENTITY"',
      ) &&
      postpublishAcceptanceRun.includes(
        '--registry-url https://registry.npmjs.org/',
      ) &&
      postpublishAcceptanceRun.includes(
        '--receipt "$BLEEDINGDEV_POSTPUBLISH_ACCEPTANCE_RECEIPT"',
      ) &&
      !postpublishAcceptanceRun.includes('run-published-create-proof.mjs') &&
      !postpublishAcceptanceRun.includes('--create-package'),
    'workflow_run readiness must use the shared release runner in published mode against exact npm bytes',
  );
  const readinessEnv = requireRecord(workflow.env, 'readiness workflow env');
  requireCondition(
    readinessEnv.BLEEDINGDEV_POSTPUBLISH_ACCEPTANCE_RECEIPT ===
      postpublishAcceptanceReceiptPath,
    'post-publish acceptance must emit a distinct receipt',
  );
  const proofUploads = actionSteps(
    proofJob,
    'actions/upload-artifact',
    'published-create-superapp job',
  );
  requireCondition(
    proofUploads.length === 1 &&
      artifactPaths(
        proofUploads[0],
        'post-publish acceptance evidence',
      ).includes('.modern/production-readiness/'),
    'post-publish acceptance receipt must be uploaded as readiness evidence',
  );
  const proofSteps = stepsFor(proofJob, 'published-create-superapp job');
  requireCondition(
    proofSteps.indexOf(postpublishIdentityDownload) <
      proofSteps.indexOf(manifestBindingStep) &&
      proofSteps.indexOf(manifestBindingStep) <
        proofSteps.indexOf(postpublishAcceptanceStep) &&
      proofSteps.indexOf(postpublishAcceptanceStep) <
        proofSteps.indexOf(proofUploads[0]),
    'post-publish readiness must download, bind, accept, then upload its receipt',
  );
  requireCondition(
    !proofSteps.some(
      step => step.name === 'Bind readiness evidence to the triggering release',
    ),
    'post-publish readiness must not duplicate the shared acceptance receipt',
  );

  const manualEnv = requireRecord(
    manualJob.env,
    'manual-published-create-superapp environment',
  );
  requireCondition(
    manualEnv.CREATE_PACKAGE_INPUT.includes(
      'vars.ULTRAMODERN_PRODUCTION_READINESS_CREATE_PACKAGE',
    ) && manualEnv.CREATE_PACKAGE_INPUT.includes('inputs.create_package'),
    'manual and scheduled readiness must receive an explicit package source',
  );
  namedStep(
    manualJob,
    'Validate exact create package input',
    'manual-published-create-superapp job',
  );

  requireCondition(
    !readText(readinessWorkflowPath).includes('@latest'),
    'readiness workflow must never use @latest',
  );
}

function validateWorkflowContract() {
  const publishWorkflow = parseWorkflow(
    publishWorkflowPath,
    'publish workflow',
  );
  const readinessWorkflow = parseWorkflow(
    readinessWorkflowPath,
    'readiness workflow',
  );
  validatePublishWorkflow(publishWorkflow);
  validateReadinessWorkflow(readinessWorkflow);

  const publishWorkflowSource = readText(publishWorkflowPath);
  for (const forbiddenToken of [
    'dependency_version',
    'package_mode',
    'affected_base',
    'affected_head',
    'skip_existing',
    'EXPLICIT_PACKAGES',
    'PUBLISH_PACKAGES',
    'PACKAGE_MODE',
    'AFFECTED_BASE',
    'AFFECTED_HEAD',
    'SKIP_EXISTING',
  ]) {
    if (publishWorkflowSource.includes(forbiddenToken)) {
      fail(`publish workflow must not expose ${forbiddenToken}`);
    }
  }
  if (publishWorkflowSource.includes('pull_request_target')) {
    fail('publish workflow must not use pull_request_target');
  }
  if (/\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/u.test(publishWorkflowSource)) {
    fail('publish workflow must not reference npm token environment variables');
  }
  if (/npm\s+publish\s+--dry-run/u.test(publishWorkflowSource)) {
    fail(
      'publish workflow must not represent dry-run as an npm publish command',
    );
  }
}

function readPublishScriptSources() {
  // The publish script was split into ./lib/prepare-bleedingdev-packages/*.
  // Read the entry file plus every module so the security-literal contract is
  // checked wherever the code actually lives, not just in the entry file.
  const libDir = path.join(
    repoRoot,
    'scripts/ultramodern-publish/lib/prepare-bleedingdev-packages',
  );
  const sources = [readText(publishScriptPath)];
  for (const entry of fs.readdirSync(libDir)) {
    if (entry.endsWith('.mjs')) {
      sources.push(readText(path.join(libDir, entry)));
    }
  }
  return sources.join('\n');
}

async function validateBufferPublisherContract() {
  const { publishAcceptedPackage } = await import(
    './lib/prepare-bleedingdev-packages/npm-buffer-publisher.mjs'
  );
  const { createReleaseArtifacts } = await import(
    './lib/prepare-bleedingdev-packages/release-artifacts.mjs'
  );
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-publish-security-'),
  );
  const packageDir = path.join(fixtureRoot, 'package');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        files: ['index.js', 'template-workspace'],
        name: '@bleedingdev/modern-js-create',
        publishConfig: { access: 'public' },
        version: '1.0.0',
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(packageDir, 'index.js'),
    'module.exports = true;\n',
  );
  for (const requiredPath of createTemplateRequiredFiles) {
    const requiredFile = path.join(packageDir, requiredPath);
    fs.mkdirSync(path.dirname(requiredFile), { recursive: true });
    fs.writeFileSync(requiredFile, 'publish security contract\n');
  }
  const releaseArtifacts = createReleaseArtifacts({
    aliases: {
      '@modern-js/create': '@bleedingdev/modern-js-create',
    },
    outDir: path.join(fixtureRoot, 'release'),
    packages: [
      {
        packageDir: path.relative(repoRoot, packageDir),
        sourceName: '@modern-js/create',
        targetName: '@bleedingdev/modern-js-create',
        version: '1.0.0',
      },
    ],
    source: {
      commit: 'a'.repeat(40),
      repository: trustedPublishRepository,
    },
    tag: enforcedPublishTag,
    tools: {
      node: process.version,
      npm: 'security-contract',
      pnpm: 'security-contract',
    },
    version: '1.0.0',
  });
  const item = releaseArtifacts.packages[0];
  const acceptedBytes = fs.readFileSync(item.artifactPath);
  let observedPublish;
  const observedTokenRequests = [];

  try {
    await publishAcceptedPackage(
      item,
      acceptedBytes,
      {
        acceptedTools: releaseArtifacts.manifest.tools,
        tag: enforcedPublishTag,
      },
      {
        env: {
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'security-github-request-token',
          ACTIONS_ID_TOKEN_REQUEST_URL:
            'https://pipelines.actions.githubusercontent.com/security-contract/oidc?api-version=2.0',
          GITHUB_ACTIONS: 'true',
        },
        fetchImpl: async (url, options) => {
          observedTokenRequests.push({
            options,
            url: new URL(url).href,
          });
          return observedTokenRequests.length === 1
            ? {
                ok: true,
                status: 200,
                json: async () => ({ value: 'security-github-oidc-token' }),
              }
            : {
                ok: true,
                status: 200,
                json: async () => ({ token: 'security-contract-token' }),
              };
        },
        loadRuntime: () => ({
          libnpmpublishVersion: 'security-contract',
          npmVersion: 'security-contract',
          publish: async (manifest, bytes, options) => {
            observedPublish = { bytes, manifest, options };
          },
        }),
      },
    );

    requireCondition(
      observedTokenRequests.length === 2 &&
        new URL(observedTokenRequests[0].url).hostname ===
          'pipelines.actions.githubusercontent.com' &&
        new URL(observedTokenRequests[0].url).searchParams.get('audience') ===
          'npm:registry.npmjs.org' &&
        observedTokenRequests[0].options.method === 'GET' &&
        observedTokenRequests[0].options.redirect === 'error' &&
        observedTokenRequests[0].options.headers.authorization ===
          'Bearer security-github-request-token' &&
        new URL(observedTokenRequests[1].url).origin ===
          'https://registry.npmjs.org' &&
        decodeURIComponent(new URL(observedTokenRequests[1].url).pathname) ===
          `/-/npm/v1/oidc/token/exchange/package/${item.targetName}` &&
        observedTokenRequests[1].options.method === 'POST' &&
        observedTokenRequests[1].options.redirect === 'error' &&
        observedTokenRequests[1].options.headers.authorization ===
          'Bearer security-github-oidc-token',
      'buffer publisher must execute the pinned GitHub-to-npm OIDC exchange for the exact package',
    );
    requireCondition(
      observedPublish?.bytes === acceptedBytes,
      'buffer publisher must pass the accepted in-memory bytes directly to libnpmpublish',
    );
    requireCondition(
      observedPublish?.manifest !== item.packageJson &&
        observedPublish?.manifest?.name === item.targetName &&
        observedPublish?.manifest?.version === item.version,
      'buffer publisher must clone and bind the accepted package manifest identity',
    );
    requireCondition(
      observedPublish?.options?.access === 'public' &&
        observedPublish.options.defaultTag === enforcedPublishTag &&
        observedPublish.options.provenance === true &&
        observedPublish.options.registry === 'https://registry.npmjs.org/' &&
        observedPublish.options['//registry.npmjs.org/:_authToken'] ===
          'security-contract-token',
      'buffer publisher must enable public trusted publication with provenance',
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function validatePublishScriptContract() {
  const publishScript = readPublishScriptSources();
  await validateBufferPublisherContract();
  requireIncludes(
    publishScript,
    'assertTrustedPublishContext();',
    'publish script',
  );
  requireIncludes(
    publishScript,
    'verifyReleaseArtifacts(options.out',
    'publish-existing producer verifier',
  );
  requireIncludes(
    publishScript,
    "repositoryUrl: 'git+https://github.com/BleedingDev/ultramodern.js.git'",
    'publish script',
  );
  requireIncludes(
    publishScript,
    "homepage: 'https://github.com/BleedingDev/ultramodern.js#readme'",
    'publish script',
  );
  requireIncludes(
    publishScript,
    "bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues'",
    'publish script',
  );
  requireIncludes(
    publishScript,
    'await registry.validateRegistryCohort(manifest, options',
    'publish script registry cohort gate',
  );

  const trustedPublisherScript = readText(trustedPublisherScriptPath);
  requireIncludes(
    trustedPublisherScript,
    "const trustedPublisherEnvironment = 'npm-publish';",
    'trusted publisher configuration',
  );
  requireIncludes(
    trustedPublisherScript,
    "args.push('--env', trustedPublisherEnvironment);",
    'trusted publisher configuration',
  );
  requireIncludes(
    trustedPublisherScript,
    'verifyReleaseArtifacts(path.dirname(manifestPath))',
    'trusted publisher strict release verification',
  );
  requireIncludes(
    trustedPublisherScript,
    'verified.manifestPath !== manifestPath',
    'trusted publisher verified manifest path binding',
  );

  const releaseAcceptanceScript = readText(releaseAcceptanceScriptPath);
  requireIncludes(
    releaseAcceptanceScript,
    "'--verify-receipt'",
    'release acceptance runner receipt verification mode',
  );
  requireIncludes(
    releaseAcceptanceScript,
    'readReleaseManifest',
    'release acceptance runner strict manifest reader',
  );
  requireIncludes(
    releaseAcceptanceScript,
    'assertAcceptanceReceipt',
    'release acceptance runner receipt verifier',
  );

  const releaseManifestReader = readText(releaseManifestReaderPath);
  requireIncludes(
    releaseManifestReader,
    'const verified = verifyReleaseArtifacts(artifactRoot);',
    'release acceptance producer artifact verifier',
  );
}

async function main() {
  validateNoTokenEnv();
  validateGitHubContext();
  validateInputs();
  validateRegistry();
  validateWorkflowContract();
  await validatePublishScriptContract();
  console.log('Publish security validation passed');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
