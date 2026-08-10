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
const tractorWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/ultramodern-tractor-downstream.yml',
);
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const enforcedPublishTag = 'latest';
const enforcedPublishConcurrency = '8';
const releaseBundleArtifact = 'bleedingdev-release-bundle';
const releaseAcceptanceArtifact = 'bleedingdev-release-acceptance';
const publishedAcceptanceArtifact = 'bleedingdev-published-acceptance';
const releaseIdentityArtifact = 'bleedingdev-release-identity';
const tractorAcceptanceWorkflow =
  './.github/workflows/ultramodern-tractor-downstream.yml';
const tractorAcceptanceRef = '3a9ac349f8f52662d451030aa86ba142ca01973d';
const releaseManifestPath = '.modern/bleedingdev-publish/manifest.json';
const releaseManifestDigestPath =
  '.modern/bleedingdev-publish/manifest.json.sha256';
const releaseCohortDigestPath = '.modern/bleedingdev-publish/cohort.sha256';
const releaseTarballGlob = '.modern/bleedingdev-publish/tarballs/*.tgz';
const releaseAcceptanceReceiptPath =
  '.modern/bleedingdev-publish/acceptance-receipt.json';
const releaseOperationalIndependenceEvidencePath =
  '.modern/bleedingdev-publish/acceptance-receipt.operational-independence.json';
const publishedAcceptanceReceiptPath =
  '.modern/bleedingdev-publish/published-acceptance-receipt.json';
const publishedOperationalIndependenceEvidencePath =
  '.modern/bleedingdev-publish/published-acceptance-receipt.operational-independence.json';
const tractorAcceptanceReportPath =
  '.modern/bleedingdev-publish/tractor-downstream-acceptance.json';
const releaseIdentityPath = '.modern/bleedingdev-publish/release-identity.json';
const postpublishAcceptanceReceiptPath =
  '.modern/production-readiness/postpublish-acceptance-receipt.json';
const githubExpression = expression => `\${{ ${expression} }}`;
const shellInterpolation = expression => `\${${expression}}`;
const releaseArtifactEnvironmentNames = new Map([
  [releaseBundleArtifact, 'BLEEDINGDEV_RELEASE_BUNDLE_ARTIFACT'],
  [releaseAcceptanceArtifact, 'BLEEDINGDEV_RELEASE_ACCEPTANCE_ARTIFACT'],
  [publishedAcceptanceArtifact, 'BLEEDINGDEV_PUBLISHED_ACCEPTANCE_ARTIFACT'],
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

function requireRecord(value, context) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${context} must be a mapping`);
  }
  return value;
}

function normalizeWorkflowCondition(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
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

function requireSameRunArtifactDownload(step, context) {
  const withOptions = requireRecord(step.with, `${context} action inputs`);
  requireCondition(
    withOptions['github-token'] === githubExpression('github.token') &&
      withOptions.repository === githubExpression('github.repository') &&
      withOptions['run-id'] === githubExpression('github.run_id'),
    `${context} must use the authenticated same-run artifact API`,
  );
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
    permissions.actions === 'read' && permissions.contents === 'read',
    'publish workflow must grant only actions: read and contents: read by default',
  );
  assertSameMembers(
    Object.keys(permissions).sort((left, right) => left.localeCompare(right)),
    ['actions', 'contents'],
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
  const publishedAcceptanceJob = requireRecord(
    jobs['accept-published'],
    'accept-published job',
  );
  const tractorAcceptanceJob = requireRecord(
    jobs['tractor-downstream'],
    'tractor-downstream job',
  );
  const outcomeJob = requireRecord(
    jobs['record-publish-outcome'],
    'record-publish-outcome job',
  );
  const changeRecordJob = requireRecord(
    jobs['publish-change-record'],
    'publish-change-record job',
  );

  // FORK: closed set. Without this a NEW job could be added to the publish
  // workflow and never be reached by any assertion below (which all enumerate
  // job ids by name). Adding a job must be a deliberate edit here.
  assertSameMembers(
    Object.keys(jobs).sort((left, right) => left.localeCompare(right)),
    [
      'accept-published',
      'accept-release',
      'prepare-release',
      'publish',
      'publish-change-record',
      'publish-security',
      'record-publish-outcome',
      'tractor-downstream',
      'validate-release',
    ],
    'publish workflow jobs',
  );

  for (const [jobId, job] of [
    ['publish-security', securityJob],
    ['prepare-release', prepareJob],
    ['accept-release', acceptanceJob],
    ['validate-release', validationJob],
    ['accept-published', publishedAcceptanceJob],
    ['tractor-downstream', tractorAcceptanceJob],
    ['record-publish-outcome', outcomeJob],
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
  const publishOutputs = requireRecord(
    publishJob.outputs,
    'publish job outputs',
  );
  requireCondition(
    publishOutputs.publication_run_attempt ===
      githubExpression(
        'steps.release-identity.outputs.publication_run_attempt',
      ),
    'publish job must expose the immutable publication attempt for retry-safe evidence lookup',
  );
  assertSameMembers(
    Object.keys(publishPermissions).sort((left, right) =>
      left.localeCompare(right),
    ),
    ['actions', 'contents', 'id-token'],
    'publish job permissions',
  );
  assertSameMembers(
    normalizeNeeds(publishedAcceptanceJob, 'accept-published job needs').sort(
      (left, right) => left.localeCompare(right),
    ),
    ['accept-release', 'publish'],
    'accept-published job dependencies',
  );
  assertSameMembers(
    normalizeNeeds(tractorAcceptanceJob, 'tractor-downstream job needs').sort(
      (left, right) => left.localeCompare(right),
    ),
    ['accept-published', 'accept-release'],
    'tractor-downstream job dependencies',
  );
  assertSameMembers(
    normalizeNeeds(outcomeJob, 'record-publish-outcome job needs').sort(
      (left, right) => left.localeCompare(right),
    ),
    [
      'accept-published',
      'accept-release',
      'publish',
      'publish-security',
      'tractor-downstream',
      'validate-release',
    ],
    'record-publish-outcome job dependencies',
  );
  requireCondition(
    publishPermissions.actions === 'read' &&
      publishPermissions.contents === 'read' &&
      publishPermissions['id-token'] === 'write',
    'publish job permissions must be actions: read, contents: read, and id-token: write',
  );
  for (const [jobId, job] of [
    ['accept-release', acceptanceJob],
    ['validate-release', validationJob],
    ['publish', publishJob],
    ['accept-published', publishedAcceptanceJob],
    ['record-publish-outcome', outcomeJob],
  ]) {
    for (const download of actionSteps(
      job,
      'actions/download-artifact',
      `${jobId} job`,
    )) {
      requireSameRunArtifactDownload(download, `${jobId} artifact download`);
    }
  }
  requireCondition(
    !Object.hasOwn(publishedAcceptanceJob, 'environment') &&
      !Object.hasOwn(publishedAcceptanceJob, 'permissions') &&
      typeof publishedAcceptanceJob.if === 'string' &&
      publishedAcceptanceJob.if.includes('inputs.dry_run == false'),
    'accept-published must run only for non-dry releases with inherited read-only authority',
  );
  const expectedOutcomeCondition = [
    'always() &&',
    'github.actor == github.repository_owner &&',
    'github.triggering_actor == github.repository_owner &&',
    "github.ref == format('refs/heads/{0}', vars.BLEEDINGDEV_PUBLISH_BRANCH || 'main-ultramodern') &&",
    '(',
    "(inputs.dry_run == true && needs.validate-release.result == 'success' && needs.publish.result == 'skipped') ||",
    "(inputs.dry_run == false && needs.publish.result == 'success' && needs.accept-published.result == 'success' && needs.tractor-downstream.result == 'success' && needs.validate-release.result == 'skipped')",
    ')',
  ].join(' ');
  requireCondition(
    normalizeWorkflowCondition(outcomeJob.if) === expectedOutcomeCondition,
    'non-dry publish outcome must exactly require successful published and Tractor acceptance without semantic bypasses',
  );
  const tractorInputs = requireRecord(
    tractorAcceptanceJob.with,
    'tractor-downstream job inputs',
  );
  requireCondition(
    tractorAcceptanceJob.uses === tractorAcceptanceWorkflow &&
      tractorInputs.release_bundle_artifact ===
        `${releaseBundleArtifact}-${githubExpression(
          'needs.accept-release.outputs.producer_artifact_identity',
        )}` &&
      tractorInputs.tractor_ref === tractorAcceptanceRef &&
      !Object.hasOwn(tractorAcceptanceJob, 'environment') &&
      !Object.hasOwn(tractorAcceptanceJob, 'permissions') &&
      !Object.hasOwn(tractorAcceptanceJob, 'secrets') &&
      typeof tractorAcceptanceJob.if === 'string' &&
      tractorAcceptanceJob.if.includes('inputs.dry_run == false'),
    'tractor-downstream must call the reviewed reusable workflow with the exact bundle and immutable Tractor baseline under inherited read-only authority',
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

  // FORK: publish-change-record is the ONLY job allowed to write to the
  // repository (it creates the GitHub release carrying the cohort change
  // record). Mirror of the OIDC closed set above.
  const repoWriteJobs = Object.entries(jobs)
    .filter(([, job]) => job?.permissions?.contents === 'write')
    .map(([jobId]) => jobId);
  assertSameMembers(
    repoWriteJobs,
    ['publish-change-record'],
    'contents: write jobs',
  );
  assertSameMembers(
    Object.keys(
      requireRecord(
        changeRecordJob.permissions,
        'publish-change-record job permissions',
      ),
    ).sort((left, right) => left.localeCompare(right)),
    ['contents'],
    'publish-change-record job permissions',
  );
  assertSameMembers(
    normalizeNeeds(changeRecordJob, 'publish-change-record job needs').sort(
      (left, right) => left.localeCompare(right),
    ),
    ['record-publish-outcome'],
    'publish-change-record job dependencies',
  );
  requireCondition(
    !Object.hasOwn(changeRecordJob, 'environment') &&
      !Object.hasOwn(changeRecordJob, 'secrets') &&
      typeof changeRecordJob.if === 'string' &&
      changeRecordJob.if.includes('inputs.dry_run == false'),
    'publish-change-record must run only for non-dry releases without an environment or inherited secrets',
  );
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
    ['accept-published', publishedAcceptanceJob],
    ['tractor-downstream', tractorAcceptanceJob],
    ['record-publish-outcome', outcomeJob],
    ['publish-change-record', changeRecordJob],
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
  // FORK: the publish workflow is dispatch-triggered and does NOT require a
  // green commit status from the push-triggered ut-* / lint-Linux workflows.
  // Without these the behavioural surface of the published runtime packages is
  // ungated and a red commit still publishes to npm at dist-tag latest.
  for (const required of [
    'pnpm lint',
    'pnpm run check-changeset',
    '--project plugin-runtime-node',
    '--project plugin-runtime-client',
    '--project plugin-i18n-node',
    '--project plugin-i18n-client',
    '--project @modern-js/plugin-bff',
    '--project @modern-js/bff-core',
  ]) {
    requireCondition(
      qualificationStep.run.includes(required),
      `prepare-release source qualification must run "${required}"`,
    );
  }
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
    [releaseAcceptanceReceiptPath, releaseOperationalIndependenceEvidencePath],
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

  const publishedIdentityDownload = artifactStep(
    publishedAcceptanceJob,
    'actions/download-artifact',
    qualifiedPublicationIdentityArtifactName(
      'needs.accept-release.outputs.producer_artifact_identity',
      'needs.publish.outputs.publication_run_attempt',
    ),
    'accept-published job',
  );
  const publishedIdentityVerification = namedStep(
    publishedAcceptanceJob,
    'Verify exact published release identity',
    'accept-published job',
  );
  const publishedIdentityVerificationEnv = requireRecord(
    publishedIdentityVerification.env,
    'published identity verification environment',
  );
  requireCondition(
    publishedIdentityVerificationEnv.PUBLICATION_RUN_ATTEMPT ===
      githubExpression('needs.publish.outputs.publication_run_attempt') &&
      publishedIdentityVerification.run.includes(
        'process.env.PUBLICATION_RUN_ATTEMPT',
      ) &&
      !publishedIdentityVerification.run.includes(
        'process.env.GITHUB_RUN_ATTEMPT',
      ),
    'accept-published must verify and reuse the publication attempt that emitted the exact identity artifact',
  );
  const publishedProducerReceiptVerification = namedStep(
    publishedAcceptanceJob,
    'Verify accepted producer receipt for published acceptance',
    'accept-published job',
  );
  requireCondition(
    publishedProducerReceiptVerification.run.includes('--verify-receipt') &&
      publishedProducerReceiptVerification.run.includes(
        '--expected-mode source',
      ) &&
      publishedProducerReceiptVerification.run.includes(
        '--run-identity "$PRODUCER_RUN_IDENTITY"',
      ) &&
      !publishedProducerReceiptVerification.run.includes('GITHUB_RUN_ATTEMPT'),
    'accept-published must verify the accepted producer receipt without rebinding it to a retry attempt',
  );
  const registryWait = namedStep(
    publishedAcceptanceJob,
    'Wait for the exact registry cohort',
    'accept-published job',
  );
  const publishedAcceptanceRun = namedStep(
    publishedAcceptanceJob,
    'Run published ERP-10 acceptance',
    'accept-published job',
  );
  const publishedMiseSteps = actionSteps(
    publishedAcceptanceJob,
    'jdx/mise-action',
    'accept-published job',
  );
  requireCondition(
    publishedMiseSteps.length === 1,
    'accept-published must install the pinned mise toolchain before running ERP-10',
  );
  const publishedMise = publishedMiseSteps[0];
  const publishedAcceptanceUpload = artifactStep(
    publishedAcceptanceJob,
    'actions/upload-artifact',
    `${qualifiedReleaseArtifactName(
      publishedAcceptanceArtifact,
      'needs.accept-release.outputs.producer_artifact_identity',
    )}-publication-attempt-${githubExpression(
      'needs.publish.outputs.publication_run_attempt',
    )}`,
    'accept-published job',
  );
  requireHiddenArtifactUpload(
    publishedAcceptanceUpload,
    'published acceptance evidence',
  );
  requireCondition(
    publishedAcceptanceUpload.if === 'always()',
    'published acceptance evidence must be uploaded even when ERP-10 fails',
  );
  assertSameMembers(
    artifactPaths(publishedAcceptanceUpload, 'published acceptance evidence'),
    [
      publishedAcceptanceReceiptPath,
      publishedOperationalIndependenceEvidencePath,
    ],
    'published acceptance evidence paths',
  );
  requireCondition(
    typeof registryWait.run === 'string' &&
      registryWait.run.includes('--publish-existing') &&
      registryWait.run.includes('--dry-run') &&
      registryWait.run.includes('--version "$PUBLISH_VERSION"') &&
      registryWait.run.includes('--tag "$PUBLISH_TAG"') &&
      /for\s+attempt\s+in\s+\{1\.\.12\}/u.test(registryWait.run),
    'accept-published must retry exact-artifact registry bytes, provenance, and cohort tag verification',
  );
  requireCondition(
    typeof publishedAcceptanceRun.run === 'string' &&
      publishedAcceptanceRun.run.includes(
        'scripts/ultramodern-publish/run-release-acceptance.mjs',
      ) &&
      publishedAcceptanceRun.run.includes('--mode published') &&
      publishedAcceptanceRun.run.includes('--scale-profile erp-10') &&
      publishedAcceptanceRun.run.includes(
        '--expected-version "$PUBLISH_VERSION"',
      ) &&
      publishedAcceptanceRun.run.includes(
        '--registry-url https://registry.npmjs.org/',
      ) &&
      publishedAcceptanceRun.run.includes(
        '--receipt "$BLEEDINGDEV_PUBLISHED_ACCEPTANCE_RECEIPT"',
      ) &&
      !publishedAcceptanceRun.run.includes('@latest'),
    'accept-published must run the shared full ERP-10 profile against an exact npm version',
  );
  const publishedJobSource = JSON.stringify(publishedAcceptanceJob);
  for (const forbidden of [
    '"environment"',
    '"permissions"',
    'id-token',
    'NPM_TOKEN',
    'NODE_AUTH_TOKEN',
    'ACTIONS_ID_TOKEN',
    'secrets.',
    '@latest',
    'npm publish',
    'pnpm publish',
  ]) {
    requireCondition(
      !publishedJobSource.includes(forbidden),
      `accept-published must not contain authority or mutable package resolution: ${forbidden}`,
    );
  }
  const publishedSteps = stepsFor(
    publishedAcceptanceJob,
    'accept-published job',
  );
  requireCondition(
    publishedSteps.indexOf(publishedMise) <
      publishedSteps.indexOf(publishedIdentityDownload) &&
      publishedSteps.indexOf(publishedIdentityDownload) <
        publishedSteps.indexOf(publishedProducerReceiptVerification) &&
      publishedSteps.indexOf(publishedProducerReceiptVerification) <
        publishedSteps.indexOf(publishedIdentityVerification) &&
      publishedSteps.indexOf(publishedIdentityVerification) <
        publishedSteps.indexOf(registryWait) &&
      publishedSteps.indexOf(registryWait) <
        publishedSteps.indexOf(publishedAcceptanceRun) &&
      publishedSteps.indexOf(publishedAcceptanceRun) <
        publishedSteps.indexOf(publishedAcceptanceUpload),
    'accept-published must install its toolchain, download, authenticate, verify the registry, run ERP-10, then upload evidence',
  );

  const outcomePublishedDownload = artifactStep(
    outcomeJob,
    'actions/download-artifact',
    `${qualifiedReleaseArtifactName(
      publishedAcceptanceArtifact,
      'needs.accept-release.outputs.producer_artifact_identity',
    )}-publication-attempt-${githubExpression(
      'needs.publish.outputs.publication_run_attempt',
    )}`,
    'record-publish-outcome job',
  );
  requireCondition(
    outcomePublishedDownload.if === 'inputs.dry_run == false',
    'publish outcome must download published evidence only for a real publication',
  );
  const outcomeTractorDownload = artifactStep(
    outcomeJob,
    'actions/download-artifact',
    githubExpression('needs.tractor-downstream.outputs.evidence_artifact_name'),
    'record-publish-outcome job',
  );
  const outcomeTractorDownloadWith = requireRecord(
    outcomeTractorDownload.with,
    'publish outcome Tractor evidence download',
  );
  requireCondition(
    outcomeTractorDownload.if === 'inputs.dry_run == false' &&
      outcomeTractorDownloadWith.path === '.modern/bleedingdev-publish',
    'publish outcome must download exact Tractor evidence only for a real publication',
  );
  const outcomePublishedVerification = namedStep(
    outcomeJob,
    'Verify published receipt for the outcome',
    'record-publish-outcome job',
  );
  requireCondition(
    outcomePublishedVerification.if === 'inputs.dry_run == false' &&
      outcomePublishedVerification.run.includes('--expected-mode published') &&
      outcomePublishedVerification.run.includes(
        '--receipt "$BLEEDINGDEV_PUBLISHED_ACCEPTANCE_RECEIPT"',
      ),
    'publish outcome must authoritatively verify the published receipt in published mode',
  );
  const createOutcome = namedStep(
    outcomeJob,
    'Create publish outcome',
    'record-publish-outcome job',
  );
  requireCondition(
    createOutcome.run.includes('--operational-evidence') &&
      createOutcome.run.includes('--published-receipt') &&
      createOutcome.run.includes('--published-operational-evidence') &&
      createOutcome.run.includes('--tractor-report') &&
      createOutcome.run.includes('--tractor-report-sha256') &&
      createOutcome.run.includes('--tractor-baseline-revision') &&
      createOutcome.run.includes('--publication-run-attempt') &&
      createOutcome.run.includes(
        'needs.publish.outputs.publication_run_attempt',
      ) &&
      createOutcome.run.includes(
        'needs.tractor-downstream.outputs.report_sha256',
      ) &&
      createOutcome.run.includes(
        'needs.tractor-downstream.outputs.baseline_revision',
      ),
    'publish outcome schema must bind source, published, operational, and Tractor evidence',
  );
  const outcomeUpload = actionSteps(
    outcomeJob,
    'actions/upload-artifact',
    'record-publish-outcome job',
  ).find(step =>
    artifactPaths(step, 'publish outcome upload').includes(
      '.modern/bleedingdev-publish/publish-outcome.json',
    ),
  );
  requireCondition(
    Boolean(outcomeUpload),
    'record-publish-outcome must upload the canonical outcome artifact',
  );
  const outcomePaths = artifactPaths(outcomeUpload, 'publish outcome upload');
  for (const requiredPath of [
    releaseAcceptanceReceiptPath,
    releaseOperationalIndependenceEvidencePath,
    publishedAcceptanceReceiptPath,
    publishedOperationalIndependenceEvidencePath,
    tractorAcceptanceReportPath,
  ]) {
    requireCondition(
      outcomePaths.includes(requiredPath),
      `publish outcome artifact must carry ${requiredPath}`,
    );
  }

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
      releaseOperationalIndependenceEvidencePath,
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
    identityStep.id === 'release-identity' &&
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
      identityStep.run.includes('publication_run_attempt=') &&
      identityStep.run.includes('GITHUB_OUTPUT') &&
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
    'accept-published': publishedAcceptanceJob,
    'record-publish-outcome': outcomeJob,
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
  const artifactListingStep = namedStep(
    identityJob,
    'List triggering run artifacts',
    'resolve-release-identity job',
  );
  const signalStep = namedStep(
    identityJob,
    'Find authenticated publication identity',
    'resolve-release-identity job',
  );
  requireCondition(
    artifactListingStep.run.includes('gh api') &&
      artifactListingStep.run.includes(
        'BLEEDINGDEV_PUBLISH_OUTCOME_ARTIFACTS',
      ) &&
      signalStep.run.includes(releaseIdentityArtifact) &&
      signalStep.run.includes('AUTHENTICATED_PUBLICATION_RUN_ATTEMPT') &&
      signalStep.run.includes('AUTHENTICATED_PRODUCER_ARTIFACT_IDENTITY') &&
      signalStep.run.includes('publication-attempt-') &&
      signalStep.run.includes(
        'Expected exactly one live publication identity artifact',
      ) &&
      !signalStep.run.includes('TRIGGER_RUN_ATTEMPT'),
    'release identity resolution must select the exact publication identity authenticated by the current-attempt outcome',
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
    identityCheckout.if === undefined &&
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
  const outcomeVerification = namedStep(
    identityJob,
    'Verify triggering publish outcome',
    'resolve-release-identity job',
  );
  requireCondition(
    typeof outcomeVerification.run === 'string' &&
      outcomeVerification.run.includes('publish-outcome.mjs verify') &&
      outcomeVerification.run.includes('--operational-evidence') &&
      outcomeVerification.run.includes('--published-receipt') &&
      outcomeVerification.run.includes('--published-operational-evidence') &&
      outcomeVerification.run.includes('--tractor-report') &&
      outcomeVerification.run.includes('tractor-downstream-acceptance.json'),
    'readiness must verify the v4 publish outcome binding for source, published, Tractor, and publication-attempt evidence',
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
      receiptVerification.run.includes('--expected-mode published') &&
      receiptVerification.run.includes(
        '$BLEEDINGDEV_PUBLISH_OUTCOME_DIR/published-acceptance-receipt.json',
      ) &&
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
      identityVerification.includes('AUTHENTICATED_PUBLICATION_RUN_ATTEMPT') &&
      !identityVerification.includes('TRIGGER_RUN_ATTEMPT') &&
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
  const outcomeSelectionStep = namedStep(
    identityJob,
    'Select the triggering publish outcome',
    'resolve-release-identity job',
  );
  const outcomeDownloadStep = namedStep(
    identityJob,
    'Download triggering publish outcome',
    'resolve-release-identity job',
  );
  requireCondition(
    identitySteps.indexOf(artifactListingStep) <
      identitySteps.indexOf(identityCheckout) &&
      identitySteps.indexOf(identityCheckout) <
        identitySteps.indexOf(outcomeSelectionStep) &&
      identitySteps.indexOf(outcomeSelectionStep) <
        identitySteps.indexOf(outcomeDownloadStep) &&
      identitySteps.indexOf(outcomeDownloadStep) <
        identitySteps.indexOf(outcomeVerification) &&
      identitySteps.indexOf(outcomeVerification) <
        identitySteps.indexOf(signalStep) &&
      identitySteps.indexOf(signalStep) <
        identitySteps.indexOf(identityDownload) &&
      identitySteps.indexOf(identityDownload) <
        identitySteps.indexOf(receiptVerification) &&
      identitySteps.indexOf(receiptVerification) <
        identitySteps.indexOf(identityVerificationStep),
    'cross-run identity resolution must authenticate the retry outcome before selecting, downloading, and authorizing the original publication identity',
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

function validateTractorWorkflow(workflow) {
  const triggers = requireRecord(
    workflow.on,
    'Tractor acceptance workflow triggers',
  );
  assertSameMembers(
    Object.keys(triggers),
    ['workflow_call'],
    'Tractor acceptance workflow triggers',
  );
  const workflowCall = requireRecord(
    triggers.workflow_call,
    'Tractor acceptance workflow_call',
  );
  const inputs = requireRecord(
    workflowCall.inputs,
    'Tractor acceptance workflow inputs',
  );
  assertSameMembers(
    Object.keys(inputs).sort((left, right) => left.localeCompare(right)),
    ['release_bundle_artifact', 'tractor_ref'],
    'Tractor acceptance workflow inputs',
  );
  for (const inputName of ['release_bundle_artifact', 'tractor_ref']) {
    const input = requireRecord(
      inputs[inputName],
      `Tractor acceptance ${inputName} input`,
    );
    requireCondition(
      input.required === true && input.type === 'string',
      `Tractor acceptance ${inputName} input must be a required string`,
    );
  }
  const outputs = requireRecord(
    workflowCall.outputs,
    'Tractor acceptance workflow outputs',
  );
  assertSameMembers(
    Object.keys(outputs).sort((left, right) => left.localeCompare(right)),
    ['baseline_revision', 'evidence_artifact_name', 'report_sha256'],
    'Tractor acceptance workflow outputs',
  );
  for (const outputName of Object.keys(outputs)) {
    const output = requireRecord(
      outputs[outputName],
      `Tractor acceptance ${outputName} output`,
    );
    requireCondition(
      output.value ===
        githubExpression(`jobs.tractor-downstream.outputs.${outputName}`),
      `Tractor acceptance ${outputName} must expose the bound job output`,
    );
  }

  const permissions = requireRecord(
    workflow.permissions,
    'Tractor acceptance workflow permissions',
  );
  assertSameMembers(
    Object.keys(permissions),
    ['actions', 'contents'],
    'Tractor acceptance workflow permissions',
  );
  requireCondition(
    permissions.actions === 'read' && permissions.contents === 'read',
    'Tractor acceptance workflow must be read-only',
  );

  const jobs = requireRecord(workflow.jobs, 'Tractor acceptance workflow jobs');
  assertSameMembers(
    Object.keys(jobs),
    ['tractor-downstream'],
    'Tractor acceptance workflow jobs',
  );
  const job = requireRecord(
    jobs['tractor-downstream'],
    'Tractor acceptance workflow job',
  );
  for (const download of actionSteps(
    job,
    'actions/download-artifact',
    'Tractor acceptance workflow job',
  )) {
    requireSameRunArtifactDownload(
      download,
      'Tractor acceptance artifact download',
    );
  }
  requireCondition(
    job['timeout-minutes'] === 45 &&
      !Object.hasOwn(job, 'permissions') &&
      !Object.hasOwn(job, 'environment'),
    'Tractor acceptance workflow job must be bounded and inherit read-only authority',
  );
  const jobOutputs = requireRecord(
    job.outputs,
    'Tractor acceptance job outputs',
  );
  requireCondition(
    jobOutputs.baseline_revision ===
      githubExpression('steps.evidence.outputs.baseline_revision') &&
      jobOutputs.evidence_artifact_name ===
        githubExpression('steps.evidence.outputs.artifact_name') &&
      jobOutputs.report_sha256 ===
        githubExpression('steps.evidence.outputs.report_sha256'),
    'Tractor acceptance job must expose the evidence artifact, baseline, and report digest',
  );

  const runnerCheckout = namedStep(
    job,
    'Checkout acceptance runner',
    'Tractor acceptance workflow job',
  );
  const runnerCheckoutWith = requireRecord(
    runnerCheckout.with,
    'Tractor acceptance runner checkout',
  );
  requireCondition(
    runnerCheckoutWith['fetch-depth'] === 1 &&
      runnerCheckoutWith.path === 'modernjs' &&
      runnerCheckoutWith['persist-credentials'] === false,
    'Tractor acceptance must check out the exact caller source without credentials',
  );

  const tractorCheckout = namedStep(
    job,
    'Checkout immutable Tractor baseline',
    'Tractor acceptance workflow job',
  );
  const tractorCheckoutWith = requireRecord(
    tractorCheckout.with,
    'Tractor baseline checkout',
  );
  requireCondition(
    tractorCheckoutWith['fetch-depth'] === 1 &&
      tractorCheckoutWith.repository ===
        'BleedingDev/tractor-store-vertical-demo' &&
      tractorCheckoutWith.ref === githubExpression('inputs.tractor_ref') &&
      tractorCheckoutWith.path === 'tractor' &&
      tractorCheckoutWith['persist-credentials'] === false,
    'Tractor acceptance must use the reviewed immutable downstream checkout without credentials',
  );

  const bundleDownload = namedStep(
    job,
    'Download exact release bundle',
    'Tractor acceptance workflow job',
  );
  const bundleDownloadWith = requireRecord(
    bundleDownload.with,
    'Tractor release bundle download',
  );
  requireCondition(
    bundleDownloadWith.name ===
      githubExpression('inputs.release_bundle_artifact') &&
      bundleDownloadWith.path === 'modernjs/.modern/bleedingdev-publish',
    'Tractor acceptance must download the exact caller release bundle',
  );

  const pnpmProvision = namedStep(
    job,
    'Provision manifest-pinned pnpm',
    'Tractor acceptance workflow job',
  );
  requireCondition(
    pnpmProvision['working-directory'] === 'modernjs' &&
      typeof pnpmProvision.run === 'string' &&
      pnpmProvision.run.includes('manifest.tools?.pnpm') &&
      pnpmProvision.run.includes('mise install "pnpm@$pnpm_version"') &&
      pnpmProvision.run.includes('mise where "pnpm@$pnpm_version"') &&
      pnpmProvision.run.includes('ULTRAMODERN_PNPM_EXECUTABLE') &&
      pnpmProvision.run.includes('test "$actual_version" = "$pnpm_version"'),
    'Tractor acceptance must provision and verify the exact manifest-bound pnpm executable',
  );

  const acceptanceRun = namedStep(
    job,
    'Run exact-cohort Tractor acceptance',
    'Tractor acceptance workflow job',
  );
  requireCondition(
    acceptanceRun['working-directory'] === 'tractor' &&
      typeof acceptanceRun.run === 'string' &&
      acceptanceRun.run.includes('run-tractor-downstream-acceptance.mjs') &&
      acceptanceRun.run.includes(
        '--manifest ../modernjs/.modern/bleedingdev-publish/manifest.json',
      ) &&
      acceptanceRun.run.includes('--workspace .') &&
      acceptanceRun.run.includes(
        '--registry-url https://registry.npmjs.org/',
      ) &&
      !acceptanceRun.run.includes('@latest') &&
      !acceptanceRun.run.includes('--skip'),
    'Tractor acceptance must run the exact manifest-bound Node, workerd, and browser contract without bypasses',
  );

  const upload = namedStep(
    job,
    'Upload Tractor acceptance evidence',
    'Tractor acceptance workflow job',
  );
  const uploadWith = requireRecord(
    upload.with,
    'Tractor acceptance evidence upload',
  );
  const evidenceBinding = namedStep(
    job,
    'Bind Tractor acceptance evidence',
    'Tractor acceptance workflow job',
  );
  requireCondition(
    evidenceBinding.id === 'evidence' &&
      evidenceBinding.if === 'always()' &&
      typeof evidenceBinding.run === 'string' &&
      evidenceBinding.run.includes('tractor-downstream-acceptance.json') &&
      evidenceBinding.run.includes('createHash') &&
      evidenceBinding.run.includes('GITHUB_OUTPUT') &&
      evidenceBinding.run.includes('baseline_revision=') &&
      evidenceBinding.run.includes('report_sha256=') &&
      upload.if === 'always()' &&
      uploadWith['if-no-files-found'] === 'error' &&
      uploadWith['include-hidden-files'] === true &&
      uploadWith.path ===
        'modernjs/.modern/production-readiness/tractor-downstream-acceptance.json' &&
      uploadWith.name ===
        githubExpression('steps.evidence.outputs.artifact_name'),
    'Tractor acceptance must always upload uniquely bound evidence and fail when it is absent',
  );
  const steps = stepsFor(job, 'Tractor acceptance workflow job');
  requireCondition(
    steps.indexOf(bundleDownload) < steps.indexOf(pnpmProvision) &&
      steps.indexOf(pnpmProvision) < steps.indexOf(acceptanceRun) &&
      steps.indexOf(acceptanceRun) < steps.indexOf(evidenceBinding) &&
      steps.indexOf(evidenceBinding) < steps.indexOf(upload),
    'Tractor acceptance must download, provision pnpm, execute, bind, then upload its report',
  );

  const source = JSON.stringify(workflow);
  for (const forbidden of [
    'id-token',
    'NPM_TOKEN',
    'NODE_AUTH_TOKEN',
    'secrets.',
    '@latest',
    'npm publish',
    'pnpm publish',
  ]) {
    requireCondition(
      !source.includes(forbidden),
      `Tractor acceptance workflow must not contain authority or mutable package resolution: ${forbidden}`,
    );
  }
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
  const tractorWorkflow = parseWorkflow(
    tractorWorkflowPath,
    'Tractor acceptance workflow',
  );
  validatePublishWorkflow(publishWorkflow);
  validateReadinessWorkflow(readinessWorkflow);
  validateTractorWorkflow(tractorWorkflow);
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
  await validateBufferPublisherContract();
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

export {
  validatePublishWorkflow,
  validateReadinessWorkflow,
  validateTractorWorkflow,
};
