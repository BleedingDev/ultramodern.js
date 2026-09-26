// A cache saved on any ref but the default branch is readable only by that
// ref, so every PR that saved its own pnpm store, mise tools and browsers
// parked ~1 GB per OS that no other run could reuse, and the repository blew
// its 10 GB cache quota. Only jobs pinned to main-ultramodern may save;
// ci-cache.yml seeds the keys everything else restores.
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

function steps(workflow) {
  return Object.entries(workflow.jobs ?? {}).flatMap(
    ([job, { if: condition = '', steps = [] }]) =>
      steps.map(step => ({ condition, job, step, uses: step.uses ?? '' })),
  );
}

const workflows = loadWorkflows();
const where = (file, job, step) => `${file}:${job}:${step.name ?? step.uses}`;

function savesCache({ step, uses }) {
  if (/^actions\/cache(\/save)?@/u.test(uses)) {
    return true;
  }
  if (uses.startsWith('jdx/mise-action@')) {
    return String(step.with?.cache_save) !== 'false';
  }
  return false;
}

// `github.ref == 'refs/heads/main-ultramodern'`, or the publish workflow's
// `github.ref == format('refs/heads/{0}', ... || 'main-ultramodern')`.
const pinnedToMain = condition =>
  /github\.ref == (?:'refs\/heads\/main-ultramodern'|format\('refs\/heads\/\{0\}', vars\.\w+ \|\| 'main-ultramodern'\))/u.test(
    condition,
  );

test('only jobs pinned to main-ultramodern save caches', () => {
  const writers = [];
  for (const { file, workflow } of workflows) {
    for (const entry of steps(workflow)) {
      if (!savesCache(entry)) {
        continue;
      }
      writers.push(file);
      assert.ok(
        pinnedToMain(entry.condition),
        `${where(file, entry.job, entry.step)} can save a cache on a branch-scoped ref; restore only (actions/cache/restore, mise cache_save: false) and let ${seedWorkflow} seed the key`,
      );
    }
  }
  assert.ok(writers.includes(seedWorkflow));
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

test(`${seedWorkflow} seeds on main-ultramodern the keys other jobs restore`, () => {
  const seed = workflows.find(({ file }) => file === seedWorkflow).workflow;
  assert.deepEqual(Object.keys(seed.on).sort(), [
    'push',
    'schedule',
    'workflow_dispatch',
  ]);
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

// Saving an immutable key that already exists neither replaces it nor
// refreshes its last access, so a quiet week let GitHub evict the seeds.
test(`${seedWorkflow} restores each key before saving it only on a miss`, () => {
  const seed = workflows.find(({ file }) => file === seedWorkflow).workflow;
  const seedSteps = steps(seed);
  const saves = seedSteps.filter(({ uses }) =>
    uses.startsWith('actions/cache/save@'),
  );
  assert.ok(saves.length > 0);
  for (const save of saves) {
    const restore = seedSteps
      .slice(0, seedSteps.indexOf(save))
      .find(
        ({ step, uses }) =>
          uses.startsWith('actions/cache/restore@') &&
          step.with?.key === save.step.with.key,
      );
    const at = where(seedWorkflow, save.job, save.step);
    assert.ok(restore?.step.id, `${at} saves a key no earlier step restores`);
    assert.equal(
      save.step.if,
      `steps.${restore.step.id}.outputs.cache-hit != 'true'`,
      `${at} must save only when ${restore.step.id} missed`,
    );
  }
});
