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
// The publish branch is intentionally hardcoded rather than derived from the
// BLEEDINGDEV_PUBLISH_BRANCH repository variable: the workflow-level if-gates
// may narrow where jobs run, but a mutable repo variable must never widen
// where packages can be published from. Changing the publish branch requires
// editing this constant in a reviewed commit.
const enforcedPublishBranch = 'main-ultramodern';

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
  console.log(
    `Enforcing publish branch refs/heads/${enforcedPublishBranch}; actual ref: ${process.env.GITHUB_REF}`,
  );
  if (process.env.GITHUB_REF !== `refs/heads/${enforcedPublishBranch}`) {
    fail(
      `publish workflow must run only from refs/heads/${enforcedPublishBranch}`,
    );
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
    'permissions:\n  contents: read',
    'publish workflow',
  );
  // OIDC mint capability must be scoped to the publish job alone, never
  // granted workflow-wide where the build/staging jobs would inherit it.
  if (workflow.includes('permissions:\n  contents: read\n  id-token: write')) {
    fail('publish workflow must not grant id-token: write at workflow level');
  }
  requireIncludes(
    workflow,
    'permissions:\n      contents: read\n      id-token: write',
    'publish workflow publish job',
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

function validatePublishScriptContract() {
  const publishScript = readPublishScriptSources();
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
