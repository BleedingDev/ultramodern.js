import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertAuthenticatedRegistryInvocation,
  assertTrustedOutcomeArtifact,
  assertTrustedWorkflowRun,
  executeBackfill,
  normalizedGithubRepository,
  parseArgs,
  trustedRepository,
  validateOutcomeArchiveEntries,
  verifyAuthenticatedRegistryProvenance,
  verifyBackfillEvidence,
} from '../backfill-change-record.mjs';

const version = '3.5.0-ultramodern.102';
const commit = 'ea21b8ba12e3e68ce529622b8b93b63fd4345018';
const runId = '31386576796';
const runAttempt = 2;

function options(overrides = {}) {
  return {
    commit,
    dryRun: false,
    repo: trustedRepository,
    runAttempt,
    runId,
    version,
    ...overrides,
  };
}

function workflowRun(overrides = {}) {
  return {
    actor: { login: 'BleedingDev' },
    conclusion: 'success',
    event: 'workflow_dispatch',
    head_branch: 'main-ultramodern',
    head_repository: {
      full_name: trustedRepository,
      id: 1_151_231_350,
    },
    head_sha: commit,
    id: Number(runId),
    path: '.github/workflows/publish-bleedingdev.yml',
    repository: { full_name: trustedRepository, id: 1_151_231_350 },
    run_attempt: runAttempt,
    status: 'completed',
    triggering_actor: { login: 'BleedingDev' },
    updated_at: '2026-08-10T14:35:03Z',
    ...overrides,
  };
}

function outcomeArtifact(overrides = {}) {
  return {
    created_at: '2026-08-10T14:34:54Z',
    digest: `sha256:${'a'.repeat(64)}`,
    expired: false,
    id: 9_066_779_115,
    name: `bleedingdev-publish-outcome-run-${runId}-attempt-${runAttempt}`,
    size_in_bytes: 5_091_063,
    workflow_run: {
      head_branch: 'main-ultramodern',
      head_repository_id: 1_151_231_350,
      head_sha: commit,
      id: Number(runId),
      repository_id: 1_151_231_350,
    },
    ...overrides,
  };
}

function provenanceDocument(attempt) {
  const statement = {
    predicate: {
      runDetails: {
        metadata: {
          invocationId: `https://github.com/${trustedRepository}/actions/runs/${runId}/attempts/${attempt}`,
        },
      },
    },
  };
  return {
    attestations: [
      {
        bundle: {
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
            payloadType: 'application/vnd.in-toto+json',
          },
        },
        predicateType: 'https://slsa.dev/provenance/v1',
      },
    ],
  };
}

const requiredArchiveEntries = [
  'acceptance-receipt.json',
  'acceptance-receipt.operational-independence.json',
  'cohort.sha256',
  'manifest.json',
  'manifest.json.sha256',
  'publish-outcome.json',
  'published-acceptance-receipt.json',
  'published-acceptance-receipt.operational-independence.json',
  'tarballs/bleedingdev-modern-js-create-3.5.0-ultramodern.102.tgz',
  'tractor-downstream-acceptance.json',
];

test('backfill arguments require exact immutable publication identity', () => {
  assert.deepEqual(
    parseArgs([
      '--version',
      version,
      '--commit',
      commit,
      '--run-id',
      runId,
      '--run-attempt',
      String(runAttempt),
      '--repo',
      trustedRepository,
      '--dry-run',
    ]),
    options({ dryRun: true }),
  );

  for (const [argv, expected] of [
    [['--version', version, '--commit', commit], /--run-id is required/u],
    [
      [
        '--version',
        '3.5.0-ultramodern.103',
        '--commit',
        commit,
        '--run-id',
        runId,
        '--run-attempt',
        '0',
      ],
      /--run-attempt must be a canonical positive integer/u,
    ],
    [
      [
        '--version',
        '3.5.0-ultramodern.latest',
        '--commit',
        commit,
        '--run-id',
        runId,
        '--run-attempt',
        '2',
      ],
      /exact x\.y\.z-ultramodern\.N/u,
    ],
    [
      [
        '--version',
        version,
        '--commit',
        commit.slice(0, 12),
        '--run-id',
        runId,
        '--run-attempt',
        '2',
      ],
      /full lowercase 40-character Git SHA/u,
    ],
    [
      [
        '--version',
        version,
        '--commit',
        commit,
        '--run-id',
        runId,
        '--run-attempt',
        '2',
        '--repo',
        'web-infra-dev/modern.js',
      ],
      /trusted publish repository/u,
    ],
    [
      [
        '--version',
        version,
        '--version',
        version,
        '--commit',
        commit,
        '--run-id',
        runId,
        '--run-attempt',
        '2',
      ],
      /duplicate argument: --version/u,
    ],
  ]) {
    assert.throws(() => parseArgs(argv), expected);
  }
});

test('trusted workflow attempt requires successful owner-dispatched publish metadata', () => {
  assert.equal(
    assertTrustedWorkflowRun(workflowRun(), options()).id,
    31386576796,
  );

  for (const [mutation, expected] of [
    [run => (run.run_attempt = 1), /required run attempt/u],
    [run => (run.conclusion = 'failure'), /did not complete successfully/u],
    [
      run => (run.repository.full_name = 'attacker/fork'),
      /trusted repository/u,
    ],
    [
      run => (run.head_repository.full_name = 'attacker/fork'),
      /trusted repository/u,
    ],
    [run => (run.head_branch = 'main'), /trusted branch and source commit/u],
    [
      run => (run.head_sha = '1'.repeat(40)),
      /trusted branch and source commit/u,
    ],
    [
      run => (run.path = '.github/workflows/other.yml'),
      /trusted publish workflow/u,
    ],
    [run => (run.event = 'pull_request'), /trusted publish workflow/u],
    [run => (run.actor.login = 'attacker'), /repository owner/u],
    [run => (run.triggering_actor.login = 'attacker'), /repository owner/u],
  ]) {
    const candidate = structuredClone(workflowRun());
    mutation(candidate);
    assert.throws(
      () => assertTrustedWorkflowRun(candidate, options()),
      expected,
    );
  }
});

test('publish outcome artifact is bound to the exact trusted attempt', () => {
  assert.equal(
    assertTrustedOutcomeArtifact(outcomeArtifact(), workflowRun(), options())
      .id,
    9_066_779_115,
  );

  for (const [mutation, expected] of [
    [
      artifact => (artifact.expired = true),
      /does not belong to the trusted workflow run/u,
    ],
    [
      artifact => (artifact.digest = `sha256:${'b'.repeat(63)}`),
      /does not belong to the trusted workflow run/u,
    ],
    [
      artifact => (artifact.size_in_bytes = 0),
      /does not belong to the trusted workflow run/u,
    ],
    [
      artifact => (artifact.name += '-copy'),
      /does not belong to the trusted workflow run/u,
    ],
    [
      artifact => (artifact.created_at = '2026-08-10T14:36:00Z'),
      /does not belong to the trusted workflow run/u,
    ],
    [
      artifact => (artifact.workflow_run.id = 1),
      /does not belong to the trusted workflow run/u,
    ],
    [
      artifact => (artifact.workflow_run.head_branch = 'main'),
      /does not belong to the trusted workflow run/u,
    ],
    [
      artifact => (artifact.workflow_run.head_sha = '2'.repeat(40)),
      /does not belong to the trusted workflow run/u,
    ],
  ]) {
    const candidate = structuredClone(outcomeArtifact());
    mutation(candidate);
    assert.throws(
      () => assertTrustedOutcomeArtifact(candidate, workflowRun(), options()),
      expected,
    );
  }
});

test('publish outcome archive accepts only the complete immutable evidence bundle', () => {
  assert.deepEqual(
    validateOutcomeArchiveEntries(requiredArchiveEntries),
    requiredArchiveEntries,
  );
  for (const [entries, expected] of [
    [
      requiredArchiveEntries.filter(entry => entry !== 'publish-outcome.json'),
      /missing publish-outcome\.json/u,
    ],
    [
      [...requiredArchiveEntries, 'notes.txt'],
      /Unexpected publish outcome archive entry/u,
    ],
    [
      [...requiredArchiveEntries, '../manifest.json'],
      /Unexpected publish outcome archive entry|Unsafe publish outcome archive entry/u,
    ],
    [
      [...requiredArchiveEntries, requiredArchiveEntries[0]],
      /Unsafe publish outcome archive entry/u,
    ],
    [
      requiredArchiveEntries.filter(entry => !entry.endsWith('.tgz')),
      /contains no package tarballs/u,
    ],
  ]) {
    assert.throws(() => validateOutcomeArchiveEntries(entries), expected);
  }
});

test('GitHub remote normalization recognizes only repository identities', () => {
  assert.equal(
    normalizedGithubRepository(
      'https://github.com/BleedingDev/ultramodern.js.git',
    ),
    trustedRepository,
  );
  assert.equal(
    normalizedGithubRepository('git@github.com:BleedingDev/ultramodern.js.git'),
    trustedRepository,
  );
  assert.equal(
    normalizedGithubRepository('https://example.com/fork.git'),
    null,
  );
});

test('registry provenance must stay within the authenticated retry window', async () => {
  const expectation = {
    invocation: { runAttempt: '2', runId },
  };
  const invocationWindow = {
    producerRunAttempt: 1,
    publicationRunAttempt: 2,
    runId,
  };
  assert.equal(
    assertAuthenticatedRegistryInvocation(
      provenanceDocument(1),
      invocationWindow,
    ),
    `https://github.com/${trustedRepository}/actions/runs/${runId}/attempts/1`,
  );
  assert.equal(
    assertAuthenticatedRegistryInvocation(
      provenanceDocument(2),
      invocationWindow,
    ),
    `https://github.com/${trustedRepository}/actions/runs/${runId}/attempts/2`,
  );
  assert.throws(
    () =>
      assertAuthenticatedRegistryInvocation(
        provenanceDocument(3),
        invocationWindow,
      ),
    /outside authenticated publication run/u,
  );

  const verifyWith = document =>
    verifyAuthenticatedRegistryProvenance(
      { targetName: '@bleedingdev/modern-js-create', version },
      {},
      expectation,
      invocationWindow,
      {
        async fetch() {
          return {
            clone() {
              return {
                async json() {
                  return document;
                },
              };
            },
          };
        },
        async verifyRegistryProvenance(item, dist, expected, fetchImpl) {
          await fetchImpl('https://registry.npmjs.org/attestations');
          return { item, dist, expected };
        },
      },
    );
  await verifyWith(provenanceDocument(2));
  await assert.rejects(
    verifyWith(provenanceDocument(3)),
    /outside authenticated publication run/u,
  );
});

test('published evidence verification delegates bytes, receipts, and exact-run provenance to production validators', async t => {
  const artifactDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'backfill-evidence-'),
  );
  t.after(() => fs.rmSync(artifactDir, { force: true, recursive: true }));
  const manifest = {
    packages: [
      {
        targetName: '@bleedingdev/modern-js-create',
        version,
      },
    ],
    release: { tag: 'latest', version },
    source: { commit, repository: trustedRepository },
  };
  const outcome = {
    dryRun: false,
    publication: { runAttempt: 1 },
    producer: { runAttempt: 1 },
    release: { tag: 'latest', version },
    source: { commit, repository: trustedRepository },
  };
  fs.writeFileSync(
    path.join(artifactDir, 'publish-outcome.json'),
    `${JSON.stringify(outcome)}\n`,
  );
  const calls = [];
  const validators = {
    createRegistryProvenanceExpectation(value, env) {
      calls.push(['provenance', value, env]);
      return {
        invocation: { runAttempt: Number(env.GITHUB_RUN_ATTEMPT), runId },
      };
    },
    async validateRegistryCohort(value, publishOptions, registry) {
      calls.push(['cohort', value, publishOptions]);
      await registry.verifyRegistryPackage(value.packages[0]);
      await registry.verifyRegistryDistTag(
        value.packages[0].targetName,
        publishOptions.tag,
        value.release.version,
      );
    },
    async verifyRegistryDistTag(packageName, tag, packageVersion) {
      calls.push(['dist-tag', packageName, tag, packageVersion]);
    },
    async verifyRegistryPackage(item, expectation, invocationWindow) {
      calls.push(['package', item, expectation, invocationWindow]);
    },
    verifyPublishOutcome(value, directory, artifact, expected) {
      calls.push(['outcome', value, directory, artifact, expected]);
      return value;
    },
    verifyReleaseArtifacts(directory, expected) {
      calls.push(['artifacts', directory, expected]);
      return { manifest };
    },
  };

  await verifyBackfillEvidence(
    artifactDir,
    outcomeArtifact(),
    options(),
    validators,
  );

  assert.deepEqual(
    calls.map(([name]) => name),
    ['artifacts', 'outcome', 'provenance', 'cohort', 'package', 'dist-tag'],
  );
  assert.deepEqual(calls[2][2], {
    GITHUB_REF: 'refs/heads/main-ultramodern',
    GITHUB_REPOSITORY: trustedRepository,
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_RUN_ID: runId,
  });
  assert.deepEqual(calls[4][2], {
    invocation: { runAttempt: 1, runId },
  });
  assert.deepEqual(calls[4][3], {
    producerRunAttempt: 1,
    publicationRunAttempt: 1,
    runId,
  });
});

test('published evidence fails before registry acceptance on version or outcome mismatch', async t => {
  const artifactDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'backfill-mismatch-'),
  );
  t.after(() => fs.rmSync(artifactDir, { force: true, recursive: true }));
  const baseOutcome = {
    dryRun: false,
    publication: { runAttempt },
    producer: { runAttempt: 1 },
    release: { tag: 'latest', version },
    source: { commit, repository: trustedRepository },
  };
  let registryCalled = false;
  const validators = {
    createRegistryProvenanceExpectation() {
      return {};
    },
    async validateRegistryCohort() {
      registryCalled = true;
    },
    async verifyRegistryDistTag() {},
    async verifyRegistryPackage() {},
    verifyPublishOutcome() {},
    verifyReleaseArtifacts() {
      return {
        manifest: {
          packages: [],
          release: { tag: 'latest', version },
          source: { commit, repository: trustedRepository },
        },
      };
    },
  };
  for (const mutation of [
    outcome => (outcome.release.version = '3.5.0-ultramodern.999'),
    outcome => (outcome.dryRun = true),
    outcome => (outcome.publication = null),
    outcome => (outcome.source.commit = '3'.repeat(40)),
  ]) {
    const candidate = structuredClone(baseOutcome);
    mutation(candidate);
    fs.writeFileSync(
      path.join(artifactDir, 'publish-outcome.json'),
      `${JSON.stringify(candidate)}\n`,
    );
    await assert.rejects(
      verifyBackfillEvidence(
        artifactDir,
        outcomeArtifact(),
        options(),
        validators,
      ),
      /not a completed publication for the requested release/u,
    );
  }
  assert.equal(registryCalled, false);
});

function createOperations(overrides = {}) {
  const events = [];
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'backfill-orchestrator-'),
  );
  const operations = {
    async assertCommitReachable() {
      events.push('reachability');
      return commit;
    },
    async createRelease() {
      events.push('release');
      return 'created';
    },
    createTemporaryDirectory() {
      events.push('temporary-directory');
      return temporaryDirectory;
    },
    async downloadOutcomeArtifact() {
      events.push('download');
      return temporaryDirectory;
    },
    async existingTagCommit() {
      events.push('tag');
      return null;
    },
    async fetchTags() {
      events.push('fetch-tags');
    },
    async generateChangeRecord() {
      events.push('change-record');
    },
    async loadOutcomeArtifact() {
      events.push('artifact');
      return outcomeArtifact();
    },
    async loadWorkflowRun() {
      events.push('workflow');
      return workflowRun();
    },
    removeTemporaryDirectory(directory) {
      events.push('cleanup');
      fs.rmSync(directory, { force: true, recursive: true });
    },
    async verifyEvidence() {
      events.push('evidence');
    },
    ...overrides,
  };
  return { events, operations, temporaryDirectory };
}

test('backfill creates a release only after all authenticated publication proofs pass', async () => {
  const { events, operations } = createOperations();
  const result = await executeBackfill(options(), operations);
  assert.equal(result.released, true);
  assert.deepEqual(events, [
    'workflow',
    'reachability',
    'artifact',
    'temporary-directory',
    'download',
    'evidence',
    'tag',
    'fetch-tags',
    'change-record',
    'release',
    'cleanup',
  ]);
});

test('backfill never mutates GitHub after failed or mismatched proof', async () => {
  for (const [override, expected] of [
    [
      {
        async loadWorkflowRun() {
          return workflowRun({ conclusion: 'failure' });
        },
      },
      /did not complete successfully/u,
    ],
    [
      {
        async assertCommitReachable() {
          throw new Error('commit is not reachable');
        },
      },
      /not reachable/u,
    ],
    [
      {
        async loadOutcomeArtifact() {
          throw new Error('Expected exactly one publish outcome artifact');
        },
      },
      /Expected exactly one publish outcome artifact/u,
    ],
    [
      {
        async verifyEvidence() {
          throw new Error(
            'Publish outcome does not match the triggering workflow run',
          );
        },
      },
      /does not match the triggering workflow run/u,
    ],
    [
      {
        async verifyEvidence() {
          throw new Error('Registry cohort validation failed');
        },
      },
      /Registry cohort validation failed/u,
    ],
  ]) {
    let released = false;
    const { operations, temporaryDirectory } = createOperations({
      ...override,
      async createRelease() {
        released = true;
      },
    });
    await assert.rejects(executeBackfill(options(), operations), expected);
    assert.equal(released, false);
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('dry-run performs every proof but does not create a release', async () => {
  let released = false;
  const { events, operations } = createOperations({
    async createRelease() {
      released = true;
    },
  });
  const result = await executeBackfill(options({ dryRun: true }), operations);
  assert.equal(result.released, false);
  assert.equal(released, false);
  assert.ok(events.includes('evidence'));
  assert.ok(events.includes('change-record'));
  assert.ok(events.includes('cleanup'));
});
