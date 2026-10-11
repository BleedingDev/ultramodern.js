import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectCiTimings,
  collectDepotCiTimings,
  compareCiSamples,
  extractCiEvidence,
} from '../collect-ci-timings.mjs';

const repository = 'ultramodernjs/ultramodern.js';
const sha = 'a'.repeat(40);
const sample = {
  runId: 101,
  attempt: 1,
  provider: 'github-actions',
  cacheState: 'cold',
  workload: 'Linux unit tests',
  toolchain: { node: '24.11.1', pnpm: '10.21.0' },
  cacheEvidence: {
    mode: 'all project caches disabled',
    logs: 'https://github.com/example/log',
  },
};

function fixture({ runChanges = {}, jobs, sampleChanges = {}, logs } = {}) {
  const calls = [];
  const run = {
    id: 101,
    run_attempt: 1,
    repository: { full_name: repository },
    head_sha: sha,
    path: '.github/workflows/ut-Linux.yml',
    name: 'Unit tests',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-10-11T00:00:00Z',
    run_started_at: '2026-10-11T00:00:00Z',
    updated_at: '2099-01-01T00:00:00Z',
    html_url: `https://github.com/${repository}/actions/runs/101`,
    ...runChanges,
  };
  const makeJob = (id = 1) => ({
    id,
    run_id: 101,
    run_attempt: 1,
    head_sha: sha,
    name: `job-${id}`,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-10-11T00:00:01Z',
    started_at: '2026-10-11T00:00:11Z',
    completed_at: '2026-10-11T00:00:31Z',
    labels: ['ubuntu-24.04'],
    runner_name: 'GitHub Actions 1',
    runner_group_name: 'Default',
    html_url: `https://github.com/${repository}/actions/runs/101/job/${id}`,
    steps: [
      {
        number: 1,
        name: 'Tests',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-10-11T00:00:12Z',
        completed_at: '2026-10-11T00:00:30Z',
      },
    ],
  });
  const rawJobs = jobs ?? [makeJob()];
  const api = async endpoint => {
    calls.push(endpoint);
    if (!endpoint.includes('/jobs?')) return run;
    const page = Number(
      new URL(`https://api.github.com/${endpoint}`).searchParams.get('page'),
    );
    return {
      total_count: rawJobs.length,
      jobs: rawJobs.slice((page - 1) * 100, page * 100),
    };
  };
  return {
    calls,
    run,
    rawJobs,
    makeJob,
    collect: changes =>
      collectCiTimings({
        repository,
        samples: [{ ...sample, ...sampleChanges, ...changes }],
        api,
        logs,
      }),
  };
}

test('keeps public sources and raw metadata and computes wall clock from actual final job completion', async () => {
  const api = fixture();
  const result = (await api.collect()).samples[0];
  assert.equal(result.workflowTotals.endToEndSeconds, 31);
  assert.equal(result.workflowTotals.runnerSeconds, 20);
  assert.equal(result.jobs[0].queueSeconds, 10);
  assert.equal(result.jobs[0].steps[0].executionSeconds, 18);
  assert.equal(result.updatedAt, '2099-01-01T00:00:00Z');
  assert.deepEqual(result.jobs[0].runner.labels, ['ubuntu-24.04']);
  assert.equal(result.jobs[0].runner.name, 'GitHub Actions 1');
  assert.match(result.jobs[0].url, /\/job\/1$/u);
  assert.equal(result.testedSha, sha);
});

function recordedEvidence() {
  return {
    schema: 'ultramodern.ci.runner-evidence',
    schemaVersion: 1,
    checkedOutCommit: 'b'.repeat(40),
    github: {
      repository,
      repositoryId: '1151231350',
      eventSha: 'b'.repeat(40),
      workflowRef: `${repository}/.github/workflows/ut-Linux.yml@refs/heads/benchmark`,
    },
    tools: sample.toolchain,
    runner: {
      os: {
        platform: 'linux',
        type: 'Linux',
        release: '6.8.0',
        architecture: 'x64',
      },
      cpu: { logicalCount: 4, models: ['Example CPU'] },
      memoryBytes: 16 * 1024 ** 3,
    },
    inputs: { lockfileSha256: 'c'.repeat(64), miseSha256: 'd'.repeat(64) },
  };
}

test('extracts bounded runner evidence without returning full logs or unknown JSON fields', () => {
  const evidence = recordedEvidence();
  evidence.secret = 'do-not-print-this';
  evidence.runner.secret = 'do-not-print-this';
  const parsed = extractCiEvidence(
    `unrelated secret log\n2026-10-11T00:00:00Z CI_BENCHMARK_EVIDENCE ${JSON.stringify(evidence)}\n`,
    { repository },
  );
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].runner.cpu.logicalCount, 4);
  assert.equal(JSON.stringify(parsed).includes('do-not-print-this'), false);
  assert.equal(JSON.stringify(parsed).includes('unrelated secret log'), false);
  assert.throws(
    () =>
      extractCiEvidence('CI_BENCHMARK_EVIDENCE {invalid secret', {
        repository,
      }),
    /Malformed runner evidence JSON/u,
  );
  evidence.github.repository = 'wrong/repo';
  assert.throws(
    () =>
      extractCiEvidence(`CI_BENCHMARK_EVIDENCE ${JSON.stringify(evidence)}`, {
        repository,
      }),
    /repository does not match/u,
  );
});

test('job logs prove PR checkout, toolchain and input hashes without guessing the cache mode', async () => {
  const evidence = recordedEvidence();
  const api = fixture({
    runChanges: { event: 'pull_request' },
    logs: async () =>
      `CI_BENCHMARK_EVIDENCE ${JSON.stringify(evidence)}\nCache restored from key: pnpm-store-Linux-key\n`,
  });
  const result = (
    await api.collect({ collectEvidence: true, cacheState: 'unknown' })
  ).samples[0];
  assert.equal(result.testedSha, evidence.checkedOutCommit);
  assert.equal(result.headSha, sha);
  assert.deepEqual(result.toolchain, evidence.tools);
  assert.deepEqual(result.inputHashes, evidence.inputs);
  assert.equal(result.cacheState, 'unknown');
  assert.deepEqual(result.observedCacheSignals, [
    { namespace: 'pnpm-store', result: 'restored' },
  ]);
  assert.equal(result.evidenceComplete, true);
  await assert.rejects(
    api.collect({ collectEvidence: true, testedSha: sha }),
    /conflicts with job log evidence/u,
  );
});

test('historical checkout logs can prove merge SHA without inventing missing instrumentation', async () => {
  const commit = 'b'.repeat(40);
  const api = fixture({
    runChanges: { event: 'pull_request' },
    logs: async () =>
      `2026-10-11T00:00:00Z [command]/usr/bin/git log -1 --format=%H\n2026-10-11T00:00:01Z ${commit}\n`,
  });
  const result = (
    await api.collect({ collectEvidence: true, toolchain: undefined })
  ).samples[0];
  assert.equal(result.testedSha, commit);
  assert.equal(result.toolchain, null);
  assert.equal(result.inputHashes, null);
});

test('partial log evidence cannot validate all selected benchmark jobs', async () => {
  const api = fixture({
    runChanges: { event: 'pull_request' },
    logs: async ({ jobId }) =>
      jobId === 1
        ? `CI_BENCHMARK_EVIDENCE ${JSON.stringify(recordedEvidence())}`
        : 'no evidence',
  });
  api.rawJobs.push(api.makeJob(2));
  const result = (await api.collect({ collectEvidence: true })).samples[0];
  assert.equal(result.evidenceComplete, false);
  assert.match(
    compareCiSamples(result, result).reasons.join(';'),
    /checkout log evidence is incomplete/u,
  );
});

function nativeFixture() {
  const runId = 'native-run';
  const calls = [];
  const run = {
    orgId: '882f0kcw25',
    runId,
    repo: repository,
    sha,
    headSha: sha,
    trigger: 'api',
    status: 'finished',
    createdAt: '2026-10-11T00:00:00Z',
    startedAt: '2026-10-11T00:00:01Z',
    finishedAt: '2026-10-11T00:00:31Z',
  };
  const detail = {
    ...run,
    jobId: 'native-job',
    workflowId: 'native-workflow',
    workflowPath: 'type-check.yml',
    jobKey: 'type-check.yml:type-check',
    jobDisplayName: 'type-check',
    jobStatus: 'finished',
    jobConclusion: 'success',
    jobCreatedAt: '2026-10-11T00:00:01Z',
    jobDispatchedAt: '2026-10-11T00:00:08Z',
    jobStartedAt: '2026-10-11T00:00:11Z',
    jobFinishedAt: '2026-10-11T00:00:31Z',
    currentAttempt: 1,
    currentAttemptId: 'attempt-1',
    runsOn: { labels: ['depot-ubuntu-24.04-8'] },
    attempts: [
      {
        attemptId: 'attempt-1',
        attempt: 1,
        status: 'finished',
        conclusion: 'success',
        createdAt: '2026-10-11T00:00:02Z',
        dispatchedAt: '2026-10-11T00:00:08Z',
        startedAt: '2026-10-11T00:00:11Z',
        finishedAt: '2026-10-11T00:00:31Z',
      },
    ],
  };
  const status = {
    orgId: run.orgId,
    runId,
    status: 'finished',
    workflows: [
      {
        workflowId: detail.workflowId,
        workflowPath: detail.workflowPath,
        status: 'finished',
        jobs: [{ jobId: detail.jobId }],
      },
    ],
  };
  let pages = [];
  const api = async (method, body) => {
    calls.push({ method, body });
    if (method === 'GetRun') return run;
    if (method === 'GetRunStatus') return status;
    if (method === 'GetJob') return detail;
    if (method === 'GetJobAttemptLogs') return pages.shift() ?? { lines: [] };
    throw new Error('Unexpected native API method');
  };
  return {
    calls,
    run,
    detail,
    status,
    setPages: value => {
      pages = value;
    },
    collect: extra =>
      collectDepotCiTimings({
        repository,
        samples: [
          {
            runId,
            provider: 'depot-ci',
            cacheState: 'unknown',
            workload: 'type-check pilot',
            workflowPath: '.depot/workflows/type-check.yml',
            ...extra,
          },
        ],
        api,
      }),
  };
}

test('native Depot timestamps distinguish scheduling, startup and execution without inventing hardware or step times', async () => {
  const api = nativeFixture();
  const result = (await api.collect()).samples[0];
  assert.equal(result.source, 'native-depot-ci');
  assert.equal(result.workflowPath, 'type-check.yml');
  assert.equal(result.requestedWorkflowPath, '.depot/workflows/type-check.yml');
  assert.equal(result.workflowTotals.endToEndSeconds, 31);
  assert.equal(result.workflowTotals.runnerSeconds, 20);
  assert.equal(result.jobs[0].attempts[0].schedulingSeconds, 6);
  assert.equal(result.jobs[0].attempts[0].startupSeconds, 3);
  assert.equal(result.jobs[0].configuredRunner.cpus, undefined);
  assert.equal(result.stepTimingAvailable, false);
  assert.equal(
    result.url,
    'https://depot.dev/orgs/882f0kcw25/workflows/native-workflow',
  );
  assert.equal(
    result.jobs[0].url,
    'https://depot.dev/orgs/882f0kcw25/workflows/native-workflow/jobs/native-job?attempt=attempt-1',
  );
  assert.equal(JSON.stringify(result).includes('/ci/runs/'), false);
  assert.equal(compareCiSamples(result, result).comparable, false);
  assert.deepEqual(
    api.calls.map(call => call.method),
    ['GetRun', 'GetRunStatus', 'GetJob'],
  );
});

test('native links reject invalid workflow, job and attempt IDs', async () => {
  for (const mutate of [
    api => {
      api.status.workflows[0].workflowId = '../injected';
    },
    api => {
      api.status.workflows[0].jobs[0].jobId = 'injected?secret';
    },
    api => {
      api.detail.currentAttemptId = 'injected&secret';
    },
  ]) {
    const api = nativeFixture();
    mutate(api);
    await assert.rejects(
      api.collect(),
      /Malformed Depot workflow|Invalid, duplicate|Invalid Depot current attempt/u,
    );
  }
});

test('native runs with multiple workflows use the validated dashboard link', async () => {
  const api = nativeFixture();
  api.status.workflows.push({
    workflowId: 'another-workflow',
    workflowPath: 'type-check.yml',
    jobs: [],
  });
  const result = (await api.collect()).samples[0];
  assert.equal(result.url, 'https://depot.dev/orgs/882f0kcw25/workflows');
});

test('CLI rejects a source flag beside an input manifest instead of silently ignoring it', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../collect-ci-timings.mjs', import.meta.url)),
      '--input',
      'not-read.json',
      '--source',
      'depot-ci',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source in the manifest/u);
  assert.equal(result.stdout, '');
});

test('native collection rejects mismatched organization, repository, job identity and SHA', async () => {
  for (const mutate of [
    api => {
      api.run.orgId = 'wrong-org';
    },
    api => {
      api.run.repo = 'wrong/repo';
    },
    api => {
      api.detail.jobId = 'wrong-job';
    },
    api => {
      api.detail.sha = 'b'.repeat(40);
    },
  ]) {
    const api = nativeFixture();
    mutate(api);
    await assert.rejects(api.collect(), /does not match/u);
  }
});

test('native runner seconds sum retry attempts rather than including the gap between attempts', async () => {
  const api = nativeFixture();
  api.detail.currentAttempt = 2;
  api.detail.attempts[0].attempt = 2;
  api.detail.attempts.unshift({
    ...api.detail.attempts[0],
    attemptId: 'attempt-old',
    attempt: 1,
    status: 'failed',
    conclusion: 'failure',
    startedAt: '2026-10-11T00:00:02Z',
    finishedAt: '2026-10-11T00:00:07Z',
  });
  const result = (await api.collect()).samples[0];
  assert.equal(result.jobs[0].executionSeconds, 25);
  assert.equal(result.workflowTotals.runnerSeconds, 25);
});

test('native log pages extract evidence using pinned attempt IDs and never return full log bodies', async () => {
  const api = nativeFixture();
  const record = recordedEvidence();
  record.checkedOutCommit = sha;
  api.setPages([
    { lines: [{ body: 'unrelated private log' }, {}], nextPageToken: 'page-2' },
    { lines: [{ body: `CI_BENCHMARK_EVIDENCE ${JSON.stringify(record)}` }] },
  ]);
  const result = (await api.collect({ collectEvidence: true })).samples[0];
  assert.deepEqual(result.toolchain, record.tools);
  assert.deepEqual(result.inputHashes, record.inputs);
  assert.equal(JSON.stringify(result).includes('unrelated private log'), false);
  assert.deepEqual(
    api.calls
      .filter(call => call.method === 'GetJobAttemptLogs')
      .map(call => call.body),
    [
      { attemptId: 'attempt-1' },
      { attemptId: 'attempt-1', pageToken: 'page-2' },
    ],
  );
});

test('native cancelled samples retain their conclusion and cannot be compared as successes', async () => {
  const api = nativeFixture();
  api.run.status = 'cancelled';
  api.detail.jobStatus = 'cancelled';
  api.detail.jobConclusion = 'cancelled';
  const result = (await api.collect()).samples[0];
  assert.equal(result.conclusion, 'cancelled');
  assert.equal(result.workflowTotals.successful, false);
  assert.equal(compareCiSamples(result, result).comparable, false);
});

test('fetches every attempt-specific jobs page and sums parallel runner seconds separately from wall clock', async () => {
  const api = fixture();
  for (let id = 2; id <= 101; id++) api.rawJobs.push(api.makeJob(id));
  const result = (await api.collect()).samples[0];
  assert.equal(result.jobs.length, 101);
  assert.equal(result.workflowTotals.runnerSeconds, 2020);
  assert.equal(result.workflowTotals.endToEndSeconds, 31);
  assert.deepEqual(api.calls.slice(1), [
    `repos/${repository}/actions/runs/101/attempts/1/jobs?per_page=100&page=1`,
    `repos/${repository}/actions/runs/101/attempts/1/jobs?per_page=100&page=2`,
  ]);
});

test('reruns explicitly select their own attempt and are ineligible for first-run latency claims', async () => {
  const api = fixture({
    runChanges: { run_attempt: 2 },
    sampleChanges: { attempt: 2 },
  });
  api.rawJobs[0].run_attempt = 2;
  const result = (await api.collect()).samples[0];
  assert.equal(result.attempt, 2);
  assert.match(api.calls[0], /\/attempts\/2$/u);
  assert.match(
    compareCiSamples(result, result).reasons.join(';'),
    /rerun attempt/u,
  );
});

test('rejects mismatched run identities, attempt identities and duplicate job pagination', async () => {
  for (const changes of [
    { id: 102 },
    { run_attempt: 2 },
    { repository: { full_name: 'other/repo' } },
  ]) {
    await assert.rejects(
      fixture({ runChanges: changes }).collect(),
      /different/u,
    );
  }
  const api = fixture();
  api.rawJobs[0].run_attempt = 2;
  await assert.rejects(api.collect(), /different run or attempt/u);
  api.rawJobs[0].run_attempt = 1;
  api.rawJobs.push(api.makeJob(1));
  await assert.rejects(api.collect(), /missing or duplicate/u);
});

test('missing, malformed and negative timestamps produce null durations with explicit issues', async () => {
  const api = fixture();
  const job = api.rawJobs[0];
  job.created_at = '2026-02-31T00:00:00Z';
  job.started_at = 'not-a-date';
  job.completed_at = null;
  let result = (await api.collect()).samples[0];
  assert.equal(result.jobs[0].queueSeconds, null);
  assert.equal(result.jobs[0].executionSeconds, null);
  assert.match(result.jobs[0].issues.join(';'), /malformed/u);
  assert.match(result.jobs[0].issues.join(';'), /missing/u);
  assert.equal(result.workflowTotals.runnerSeconds, null);
  job.created_at = '2026-10-11T00:00:21Z';
  job.started_at = '2026-10-11T00:00:11Z';
  job.completed_at = '2026-10-11T00:00:01Z';
  result = (await api.collect()).samples[0];
  assert.match(result.jobs[0].issues.join(';'), /negative/u);
  assert.equal(result.jobs[0].executionSeconds, null);
});

test('incomplete jobs do not use provisional start timestamps as measured waits', async () => {
  const api = fixture({
    runChanges: { status: 'in_progress', conclusion: null },
  });
  Object.assign(api.rawJobs[0], {
    status: 'queued',
    conclusion: null,
    started_at: api.rawJobs[0].created_at,
    completed_at: null,
  });
  const result = (await api.collect()).samples[0];
  assert.equal(result.jobs[0].queueSeconds, null);
  assert.equal(result.jobs[0].executionSeconds, null);
  assert.equal(result.workflowTotals.complete, false);
  assert.equal(result.workflowTotals.endToEndSeconds, null);
  assert.match(
    compareCiSamples(result, result).reasons.join(';'),
    /incomplete/u,
  );
});

for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out']) {
  test(`${conclusion} jobs retain their result and cannot support speedup claims`, async () => {
    const api = fixture({ runChanges: { conclusion } });
    api.rawJobs[0].conclusion = conclusion;
    const result = (await api.collect()).samples[0];
    assert.equal(result.workflowTotals.conclusions[conclusion], 1);
    assert.equal(result.workflowTotals.successful, false);
    assert.equal(compareCiSamples(result, result).comparable, false);
  });
}

test('PR source head SHA is distinct from the tested merge SHA', async () => {
  const api = fixture({ runChanges: { event: 'pull_request' } });
  const unknown = (await api.collect()).samples[0];
  assert.equal(unknown.headSha, sha);
  assert.equal(unknown.testedSha, null);
  assert.equal(compareCiSamples(unknown, unknown).comparable, false);
  const testedSha = 'b'.repeat(40);
  const explicit = (await api.collect({ testedSha })).samples[0];
  assert.equal(explicit.testedSha, testedSha);
  assert.equal(explicit.headSha, sha);
});

test('paired comparison requires identical tested SHA, job and step coverage and metadata', async () => {
  const before = (await fixture().collect()).samples[0];
  const after = structuredClone(before);
  after.runId = '102';
  after.provider = 'depot-github-actions';
  assert.equal(compareCiSamples(before, after).comparable, true);
  for (const mutate of [
    value => {
      value.testedSha = 'b'.repeat(40);
    },
    value => {
      value.cacheState = 'warm';
    },
    value => {
      value.cacheEvidence = null;
    },
    value => {
      value.toolchain = null;
    },
    value => {
      value.jobs[0].name = 'different test suite';
    },
    value => {
      value.jobs[0].steps[0].name = 'different test command';
    },
    value => {
      value.jobs[0].issues.push('missing queue timestamp');
    },
  ]) {
    const changed = structuredClone(after);
    mutate(changed);
    assert.equal(compareCiSamples(before, changed).comparable, false);
  }
  assert.equal('speedup' in compareCiSamples(before, after), false);
});

test('Linux subset timing retains the complete workflow separately', async () => {
  const api = fixture();
  const windows = api.makeJob(2);
  windows.name = 'Windows suite';
  windows.completed_at = '2026-10-11T00:02:00Z';
  api.rawJobs.push(windows);
  const result = (await api.collect({ jobNames: ['job-1'] })).samples[0];
  assert.equal(result.jobs.length, 2);
  assert.equal(result.workflowTotals.endToEndSeconds, 120);
  assert.equal(result.selectedTotals.endToEndSeconds, 31);
  assert.deepEqual(result.selectedJobIds, [1]);
  await assert.rejects(api.collect({ jobNames: ['absent'] }), /missing/u);
});

test('GitHub bridge delivery timing cannot be claimed as native Depot execution', async () => {
  const result = (await fixture().collect({ provider: 'depot-ci' })).samples[0];
  assert.match(result.timingKind, /native Depot execution is not measured/u);
  assert.equal(compareCiSamples(result, result).comparable, false);
});

test('provider and cache state must be supplied instead of guessed from timings', async () => {
  await assert.rejects(fixture().collect({ provider: undefined }), /provider/u);
  await assert.rejects(
    fixture().collect({ cacheState: undefined }),
    /cache state/u,
  );
  await assert.rejects(fixture().collect({ attempt: undefined }), /attempt/u);
});

test('uncontrolled pilot samples remain collectable without becoming comparisons', async () => {
  const api = fixture({ runChanges: { event: 'pull_request' } });
  const result = (
    await api.collect({
      cacheState: 'unknown',
      cacheEvidence: undefined,
      toolchain: undefined,
    })
  ).samples[0];
  assert.equal(result.cacheState, 'unknown');
  assert.equal(result.toolchain, null);
  assert.equal(result.cacheEvidence, null);
  assert.equal(result.testedSha, null);
  assert.equal(compareCiSamples(result, result).comparable, false);
});
