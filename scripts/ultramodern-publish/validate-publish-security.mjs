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
const allowedTags = new Set(['latest', 'next', 'ultramodern-canary']);
const allowedModes = new Set(['changed', 'affected', 'explicit', 'all']);
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const refPattern = /^[A-Za-z0-9._/@:+~-]+$/;
const packageTokenPattern =
  /^(?:@modern-js\/[a-z0-9._-]+|@bleedingdev\/modern-js-[a-z0-9._-]+|[a-z0-9._-]+)$/;

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
  if (process.env.GITHUB_REF !== 'refs/heads/main-ultramodern') {
    fail('publish workflow must run only from refs/heads/main-ultramodern');
  }
  if (process.env.GITHUB_REPOSITORY !== 'BleedingDev/ultramodern.js') {
    fail('publish workflow must run only in BleedingDev/ultramodern.js');
  }
}

function validateInputs() {
  const version = process.env.PUBLISH_VERSION ?? '';
  const dependencyVersion = process.env.DEPENDENCY_VERSION ?? '';
  const mode = process.env.PACKAGE_MODE ?? '';
  const explicitPackages = process.env.EXPLICIT_PACKAGES ?? '';
  const tag = process.env.PUBLISH_TAG ?? '';
  const affectedBase = process.env.AFFECTED_BASE ?? '';
  const affectedHead = process.env.AFFECTED_HEAD ?? '';

  if (!semverPattern.test(version)) {
    fail(`version must be a semver value, found "${version}"`);
  }
  if (dependencyVersion && !semverPattern.test(dependencyVersion)) {
    fail(
      `dependency_version must be a semver value, found "${dependencyVersion}"`,
    );
  }
  if (!allowedModes.has(mode)) {
    fail(`package_mode must be one of ${Array.from(allowedModes).join(', ')}`);
  }
  if (!allowedTags.has(tag)) {
    fail(`dist-tag must be one of ${Array.from(allowedTags).join(', ')}`);
  }
  if (mode === 'explicit' && explicitPackages.trim() === '') {
    fail('package_mode=explicit requires a non-empty package list');
  }
  if (
    (mode === 'changed' || mode === 'affected') &&
    (!affectedBase || !affectedHead)
  ) {
    fail('changed and affected modes require affected_base and affected_head');
  }
  for (const ref of [affectedBase, affectedHead].filter(Boolean)) {
    if (!refPattern.test(ref)) {
      fail(`affected ref contains unsupported characters: ${ref}`);
    }
  }
  for (const packageName of explicitPackages
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)) {
    if (!packageTokenPattern.test(packageName)) {
      fail(`package selector contains unsupported characters: ${packageName}`);
    }
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
    "github.ref == 'refs/heads/main-ultramodern'",
    'publish workflow',
  );
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
    "repositoryUrl: 'git+https://github.com/BleedingDev/ultramodern.js.git'",
    'publish script',
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
