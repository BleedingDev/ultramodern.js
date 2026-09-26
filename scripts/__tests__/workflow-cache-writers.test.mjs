// A cache saved on a PR or merge-queue ref is readable only by that ref, so
// every PR that saved its own pnpm store, mise tools and browsers parked
// ~1 GB per OS that no other run could reuse, and the repository blew its
// 10 GB cache quota. Only main-ultramodern writes; ci-cache.yml seeds the
// keys PR jobs restore. This pins that edge for every workflow.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from '../../packages/toolkit/utils/compiled/js-yaml/index.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const workflowsDir = path.join(repoRoot, '.github/workflows');
const seedWorkflow = 'ci-cache.yml';
const prEvents = ['pull_request', 'pull_request_target', 'merge_group'];

function loadWorkflows() {
  return fs
    .readdirSync(workflowsDir)
    .filter(file => /\.ya?ml$/u.test(file))
    .map(file => ({
      file,
      workflow: yaml.load(
        fs.readFileSync(path.join(workflowsDir, file), 'utf8'),
      ),
    }));
}

function triggers(workflow) {
  const { on } = workflow;
  if (typeof on === 'string') {
    return [on];
  }
  return Array.isArray(on) ? on : Object.keys(on ?? {});
}

function steps(workflow) {
  return Object.entries(workflow.jobs ?? {}).flatMap(([job, { steps = [] }]) =>
    steps.map(step => ({ job, step, uses: step.uses ?? '' })),
  );
}

const workflows = loadWorkflows();
const where = (file, job, step) => `${file}:${job}:${step.name ?? step.uses}`;

test('PR and merge-queue workflows restore caches but never save them', () => {
  const prWorkflows = workflows.filter(({ workflow }) =>
    triggers(workflow).some(event => prEvents.includes(event)),
  );
  assert.ok(prWorkflows.some(({ file }) => file === 'ut-Windows.yml'));
  for (const { file, workflow } of prWorkflows) {
    for (const { job, step, uses } of steps(workflow)) {
      assert.doesNotMatch(
        uses,
        /^actions\/cache(\/save)?@/u,
        `${where(file, job, step)} saves a cache on a PR ref; use actions/cache/restore and let ${seedWorkflow} seed the key`,
      );
      if (uses.startsWith('jdx/mise-action@')) {
        assert.equal(
          String(step.with?.cache_save),
          'false',
          `${where(file, job, step)} must set cache_save: false; ${seedWorkflow} seeds the mise cache`,
        );
      }
    }
  }
});

test('setup-node never owns the pnpm store cache', () => {
  for (const { file, workflow } of workflows) {
    for (const { job, step, uses } of steps(workflow)) {
      if (uses.startsWith('actions/setup-node@')) {
        assert.equal(
          step.with?.cache,
          undefined,
          `${where(file, job, step)} caches the pnpm store under its own key on every ref; restore pnpm-store-* instead`,
        );
      }
    }
  }
});

test(`${seedWorkflow} seeds on main-ultramodern the keys PR jobs restore`, () => {
  const seed = workflows.find(({ file }) => file === seedWorkflow).workflow;
  const seedTriggers = triggers(seed);
  assert.deepEqual(
    seedTriggers.filter(event => prEvents.includes(event)),
    [],
  );
  assert.deepEqual(seed.on.push.branches, ['main-ultramodern']);

  const saved = new Set(
    steps(seed)
      .filter(({ uses }) => uses.startsWith('actions/cache/save@'))
      .map(({ step }) => step.with.key),
  );
  const restored = workflows
    .filter(({ file }) => file !== seedWorkflow)
    .flatMap(({ file, workflow }) =>
      steps(workflow)
        .filter(({ uses }) => uses.startsWith('actions/cache/restore@'))
        .map(({ job, step }) => ({
          at: where(file, job, step),
          key: step.with.key,
        })),
    )
    .filter(({ key }) => /pnpm-store|browser-runtime/u.test(key));
  assert.ok(restored.length > 0);
  for (const { at, key } of restored) {
    assert.ok(
      saved.has(key),
      `${at} restores ${key}, which ${seedWorkflow} never saves`,
    );
  }
});
