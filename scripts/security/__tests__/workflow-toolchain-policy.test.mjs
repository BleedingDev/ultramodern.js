import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from '../../../packages/toolkit/utils/compiled/js-yaml/index.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const workflowDir = path.join(repoRoot, '.github/workflows');
const examplesDir = path.join(repoRoot, 'examples');

const setupNodeUse =
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';
const checkoutUse = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const cacheUse = 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9';
const downloadArtifactUse =
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';
const githubScriptUse =
  'actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3';
const miseActionUse =
  'jdx/mise-action@7e36c90d9ab29c415a2384db3006f3ec8a8cc654';
const miseVersion = '2026.8.3';

const supportedActionUses = new Map([
  ['actions/cache', cacheUse],
  ['actions/checkout', checkoutUse],
  ['actions/download-artifact', downloadArtifactUse],
  ['actions/github-script', githubScriptUse],
  ['actions/setup-node', setupNodeUse],
]);

const exactNode26WorkflowPaths = [
  '.github/workflows/contract-gates.yml',
  '.github/workflows/diff.yml',
  '.github/workflows/integration-test-Linux.yml',
  '.github/workflows/integration-test-Windows.yml',
  '.github/workflows/publish-bleedingdev.yml',
  '.github/workflows/superapp-certification.yml',
  '.github/workflows/ut-Windows.yml',
  '.github/workflows/ut-macOS.yml',
  'examples/modern-js-deploy-csr/.github/workflows/gh-pages-deploy.yml',
];

const readWorkflow = relativePath =>
  yaml.load(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));

const collectFiles = directory =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? collectFiles(entryPath)
      : entry.isFile()
        ? [entryPath]
        : [];
  });

const activeWorkflowPaths = () => {
  const rootWorkflowPaths = fs
    .readdirSync(workflowDir)
    .filter(file => /\.ya?ml$/u.test(file))
    .map(file => path.posix.join('.github/workflows', file));
  const nestedWorkflowPaths = collectFiles(examplesDir)
    .map(file => path.relative(repoRoot, file).split(path.sep).join('/'))
    .filter(relativePath =>
      /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/u.test(relativePath),
    );
  return [...rootWorkflowPaths, ...nestedWorkflowPaths].sort();
};

const workflowSteps = workflow =>
  Object.values(workflow.jobs ?? {}).flatMap(job => job.steps ?? []);

const actionSteps = (workflow, action) =>
  workflowSteps(workflow).filter(
    step => typeof step.uses === 'string' && step.uses.startsWith(`${action}@`),
  );

test('active workflows pin supported Node 24 action releases semantically', () => {
  const actionCounts = new Map(
    [...supportedActionUses.keys()].map(action => [action, 0]),
  );
  let miseActionCount = 0;

  for (const workflowPath of activeWorkflowPaths()) {
    const workflow = readWorkflow(workflowPath);

    for (const [action, supportedUse] of supportedActionUses) {
      for (const step of actionSteps(workflow, action)) {
        actionCounts.set(action, actionCounts.get(action) + 1);
        assert.equal(step.uses, supportedUse, workflowPath);
      }
    }

    for (const step of actionSteps(workflow, 'jdx/mise-action')) {
      miseActionCount += 1;
      assert.equal(step.uses, miseActionUse, workflowPath);
      assert.equal(String(step.with?.version), miseVersion, workflowPath);
    }
  }

  for (const [action, count] of actionCounts) {
    assert.ok(count > 0, `expected ${action} coverage`);
  }
  assert.ok(miseActionCount > 0, 'expected mise-action coverage');
});

test('release workflows use exact Node 26 while nightly remains forward-looking', () => {
  for (const workflowPath of exactNode26WorkflowPaths) {
    const setupSteps = actionSteps(
      readWorkflow(workflowPath),
      'actions/setup-node',
    );
    assert.ok(setupSteps.length > 0, `${workflowPath} must provision Node`);
    for (const step of setupSteps) {
      assert.equal(String(step.with?.['node-version']), '26.7.0', workflowPath);
    }
  }

  const nightlySetupSteps = actionSteps(
    readWorkflow('.github/workflows/ultramodern-nightly.yml'),
    'actions/setup-node',
  );
  assert.ok(nightlySetupSteps.length > 0, 'nightly must provision Node');
  for (const step of nightlySetupSteps) {
    assert.equal(
      String(step.with?.['node-version']),
      '26.x',
      'nightly should detect future Node 26 patches',
    );
  }
});

test('macOS unit tests run on the supported Apple Silicon image', () => {
  const workflow = readWorkflow('.github/workflows/ut-macOS.yml');
  assert.equal(workflow.jobs?.['ut-mac']?.['runs-on'], 'macos-26');
});

test('nightly installs the frozen workspace, then builds, then runs script tests', () => {
  const workflow = readWorkflow('.github/workflows/ultramodern-nightly.yml');
  const steps = workflow.jobs?.['script-tests']?.steps ?? [];
  const installIndex = steps.findIndex(
    step => step?.name === 'Install Dependencies',
  );
  const buildIndex = steps.findIndex(step => step?.name === 'Build Packages');
  const testIndex = steps.findIndex(
    step => step?.name === 'Run script test suites',
  );

  assert.ok(installIndex >= 0, 'nightly must install before anything runs');
  assert.ok(
    installIndex < buildIndex && buildIndex < testIndex,
    'script tests import built package dists, so the order must be install, build, test',
  );
  assert.deepEqual(steps[installIndex], {
    name: 'Install Dependencies',
    run: 'mise exec -- pnpm install --frozen-lockfile',
  });
  assert.equal(steps[buildIndex]?.run, 'mise exec -- pnpm run prepare-build');
  assert.equal(steps[testIndex]?.run, 'pnpm run test:scripts');
});
