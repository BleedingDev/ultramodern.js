import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  conditionCalls,
  evaluateJobSchedule,
  parseJobCondition,
} from '../github-job-condition.mjs';

const requireFromPrebundle = createRequire(
  new URL('../../prebundle/package.json', import.meta.url),
);
const { load: parseYaml } = requireFromPrebundle('js-yaml');
const publishWorkflow = parseYaml(
  fs.readFileSync(
    new URL(
      '../../../.github/workflows/publish-bleedingdev.yml',
      import.meta.url,
    ),
    'utf8',
  ),
);

const publishConditionWithoutAlways = `
  needs.record-publish-outcome.result == 'success' &&
  github.actor == github.repository_owner &&
  github.triggering_actor == github.repository_owner &&
  github.ref == format('refs/heads/{0}', vars.BLEEDINGDEV_PUBLISH_BRANCH || 'main-ultramodern') &&
  inputs.dry_run == false
`;

const successfulContext = {
  github: {
    actor: 'bleedingdev',
    ref: 'refs/heads/main-ultramodern',
    repository_owner: 'bleedingdev',
    triggering_actor: 'bleedingdev',
  },
  inputs: { dry_run: false },
  vars: {},
};

const resultsWithSkippedAncestor = {
  'accept-published': 'success',
  'accept-release': 'success',
  'prepare-release': 'success',
  publish: 'success',
  'publish-security': 'success',
  'record-publish-outcome': 'success',
  'tractor-downstream': 'success',
  'validate-release': 'skipped',
};

test('parses the restricted expression grammar with GitHub precedence', () => {
  const ast = parseJobCondition(
    publishWorkflow.jobs['publish-change-record'].if,
  );

  assert.equal(conditionCalls(ast, 'always'), true);
  assert.equal(conditionCalls(ast, 'format'), true);
  assert.equal(conditionCalls(ast, 'success'), false);
  assert.equal(ast.type, 'binary');
  assert.equal(ast.operator, '&&');
});

test('rejects conditions outside the restricted grammar', () => {
  assert.throws(() => parseJobCondition('!cancelled()'), SyntaxError);
  assert.throws(
    () => parseJobCondition("contains(github.ref, 'main')"),
    SyntaxError,
  );
  assert.throws(() => parseJobCondition("github.ref != 'main'"), SyntaxError);
  assert.throws(() => parseJobCondition("'unterminated"), SyntaxError);
});

test('implicit success suppresses a job with a skipped transitive ancestor', () => {
  const withoutAlways = structuredClone(publishWorkflow);
  withoutAlways.jobs['publish-change-record'].if =
    publishConditionWithoutAlways;

  assert.equal(
    evaluateJobSchedule({
      workflow: withoutAlways,
      jobId: 'publish-change-record',
      results: resultsWithSkippedAncestor,
      context: successfulContext,
    }),
    false,
  );
});

test('always plus a successful direct need survives a skipped ancestor', () => {
  assert.equal(
    evaluateJobSchedule({
      workflow: publishWorkflow,
      jobId: 'publish-change-record',
      results: resultsWithSkippedAncestor,
      context: successfulContext,
    }),
    true,
  );
});

test('dry runs and unsuccessful direct needs fail closed', () => {
  assert.equal(
    evaluateJobSchedule({
      workflow: publishWorkflow,
      jobId: 'publish-change-record',
      results: resultsWithSkippedAncestor,
      context: {
        ...successfulContext,
        inputs: { dry_run: true },
      },
    }),
    false,
  );

  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.equal(
      evaluateJobSchedule({
        workflow: publishWorkflow,
        jobId: 'publish-change-record',
        results: {
          ...resultsWithSkippedAncestor,
          'record-publish-outcome': result,
        },
        context: successfulContext,
      }),
      false,
      result,
    );
  }
});

test('unknown references, missing results, and dependency cycles fail closed', () => {
  const unknownReference = structuredClone(publishWorkflow);
  unknownReference.jobs['publish-change-record'].if =
    'always() && secrets.TOKEN';
  assert.equal(
    evaluateJobSchedule({
      workflow: unknownReference,
      jobId: 'publish-change-record',
      results: resultsWithSkippedAncestor,
      context: successfulContext,
    }),
    false,
  );

  assert.equal(
    evaluateJobSchedule({
      workflow: {
        jobs: {
          dependency: {},
          target: { needs: 'dependency', if: 'true' },
        },
      },
      jobId: 'target',
      results: {},
      context: successfulContext,
    }),
    false,
  );

  const cyclic = {
    jobs: {
      first: { needs: 'second' },
      second: { needs: 'first' },
    },
  };
  assert.equal(
    evaluateJobSchedule({
      workflow: cyclic,
      jobId: 'first',
      results: resultsWithSkippedAncestor,
      context: successfulContext,
    }),
    false,
  );
});
