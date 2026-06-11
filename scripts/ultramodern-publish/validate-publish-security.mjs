#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const publishWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/publish-bleedingdev.yml',
);
const publishScriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs',
);
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const enforcedPublishTag = 'latest';
const enforcedPublishConcurrency = '8';
const defaultPublishBranch = 'main-ultramodern';
const publishBranch =
  process.env.BLEEDINGDEV_PUBLISH_BRANCH || defaultPublishBranch;

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

function validateNoTokenEnv() {
  for (const envName of ['NPM_TOKEN']) {
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
  if (process.env.GITHUB_REF !== `refs/heads/${publishBranch}`) {
    fail(`publish workflow must run only from refs/heads/${publishBranch}`);
  }
  if (process.env.GITHUB_REPOSITORY !== 'BleedingDev/ultramodern.js') {
    fail('publish workflow must run only in BleedingDev/ultramodern.js');
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

function validateWorkflowContract() {
  const workflow = readText(publishWorkflowPath);
  requireIncludes(
    workflow,
    'permissions:\n  contents: read\n  id-token: write',
    'publish workflow',
  );
  requireIncludes(workflow, 'environment: npm-publish', 'publish workflow');
  requireIncludes(workflow, 'timeout-minutes:', 'publish workflow');
  requireIncludes(
    workflow,
    'persist-credentials: false',
    'publish workflow checkout',
  );
  requireIncludes(
    workflow,
    'egress-policy: audit',
    'publish workflow harden-runner',
  );
  requireIncludes(
    workflow,
    "github.ref == format('refs/heads/{0}', vars.BLEEDINGDEV_PUBLISH_BRANCH || 'main-ultramodern')",
    'publish workflow',
  );
  requireIncludes(
    workflow,
    'ultramodern:prepare-bleedingdev-publish',
    'publish workflow pre-publish package preparation',
  );
  requireIncludes(
    workflow,
    'ultramodern:source-create-proof',
    'publish workflow pre-publish source proof',
  );
  requireIncludes(
    workflow,
    '.modern/prepublish-release-gates/source-create-proof.json',
    'publish workflow source proof artifact upload',
  );
  requireIncludes(
    workflow,
    '--publish-concurrency "$PUBLISH_CONCURRENCY"',
    'publish workflow package concurrency',
  );
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
    if (workflow.includes(forbiddenToken)) {
      fail(`publish workflow must not expose ${forbiddenToken}`);
    }
  }
  if (workflow.includes('pull_request_target')) {
    fail('publish workflow must not use pull_request_target');
  }
  if (/\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/.test(workflow)) {
    fail('publish workflow must not reference npm token environment variables');
  }
}

function validatePublishScriptContract() {
  const publishScript = readText(publishScriptPath);
  requireIncludes(publishScript, "args.push('--provenance')", 'publish script');
  requireIncludes(publishScript, "'--access',\n    'public'", 'publish script');
  requireIncludes(
    publishScript,
    'assertTrustedPublishContext();',
    'publish script',
  );
  requireIncludes(
    publishScript,
    "process.env.GITHUB_REPOSITORY !== 'BleedingDev/ultramodern.js'",
    'publish script',
  );
  requireIncludes(
    publishScript,
    'process.env.BLEEDINGDEV_REPOSITORY_URL ||',
    'publish script',
  );
  requireIncludes(
    publishScript,
    "'git+https://github.com/BleedingDev/ultramodern.js.git'",
    'publish script',
  );
  requireIncludes(
    publishScript,
    'await validateRegistryCohort(manifest, options);',
    'publish script registry cohort gate',
  );
}

function main() {
  validateNoTokenEnv();
  validateGitHubContext();
  validateInputs();
  validateRegistry();
  validateWorkflowContract();
  validatePublishScriptContract();
  console.log('Publish security validation passed');
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
