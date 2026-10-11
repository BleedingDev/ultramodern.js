import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt
// https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt
const execute = promisify(execFile);
const providers = new Set([
  'github-actions',
  'depot-github-actions',
  'depot-ci',
]);
const cacheStates = new Set(['cold', 'warm', 'mixed', 'unknown']);
const evidencePrefix = 'CI_BENCHMARK_EVIDENCE ';
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function timestamp(value, label, issues) {
  if (value === undefined || value === null || value === '') {
    issues.push(`${label}: missing timestamp`);
    return null;
  }
  const match =
    typeof value === 'string' &&
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  const parsed = match && Date.parse(value);
  const calendar =
    match &&
    new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    );
  if (
    !match ||
    !Number.isFinite(parsed) ||
    calendar.getUTCMonth() + 1 !== Number(match[2]) ||
    calendar.getUTCDate() !== Number(match[3])
  ) {
    issues.push(`${label}: malformed timestamp`);
    return null;
  }
  return parsed;
}

function seconds(start, end, label, issues) {
  if (start === null || end === null) return null;
  if (end < start) {
    issues.push(`${label}: negative duration`);
    return null;
  }
  return (end - start) / 1000;
}

function jobTiming(job) {
  const issues = [];
  const created = timestamp(job.created_at, 'created_at', issues);
  const started = timestamp(job.started_at, 'started_at', issues);
  const completed = timestamp(job.completed_at, 'completed_at', issues);
  const terminal = job.status === 'completed';
  const steps = (job.steps ?? []).map(step => {
    const stepIssues = [];
    const start = timestamp(
      step.started_at,
      `step ${step.number} started_at`,
      stepIssues,
    );
    const end = timestamp(
      step.completed_at,
      `step ${step.number} completed_at`,
      stepIssues,
    );
    return {
      number: step.number,
      name: step.name,
      status: step.status,
      conclusion: step.conclusion ?? null,
      startedAt: step.started_at ?? null,
      completedAt: step.completed_at ?? null,
      executionSeconds:
        step.status === 'completed'
          ? seconds(start, end, 'execution', stepIssues)
          : null,
      issues: stepIssues,
    };
  });
  if (!terminal)
    issues.push('job is incomplete; provisional timestamps are not durations');
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion ?? null,
    headSha: job.head_sha ?? null,
    attempt: job.run_attempt ?? null,
    createdAt: job.created_at ?? null,
    startedAt: job.started_at ?? null,
    completedAt: job.completed_at ?? null,
    queueSeconds: terminal ? seconds(created, started, 'queue', issues) : null,
    executionSeconds: terminal
      ? seconds(started, completed, 'execution', issues)
      : null,
    runner: {
      labels: job.labels ?? [],
      name: job.runner_name ?? null,
      id: job.runner_id ?? null,
      group: job.runner_group_name ?? null,
      groupId: job.runner_group_id ?? null,
    },
    url: job.html_url ?? null,
    steps,
    issues,
  };
}

function totals(jobs, createdAt, label) {
  const issues = [];
  const created = timestamp(createdAt, 'run.created_at', issues);
  const complete =
    jobs.length > 0 &&
    jobs.every(
      job => job.status === 'completed' && job.executionSeconds !== null,
    );
  const ends = jobs.map(job =>
    timestamp(job.completedAt, `${label} job ${job.id} completed_at`, issues),
  );
  return {
    complete,
    successful: complete && jobs.every(job => job.conclusion === 'success'),
    endToEndSeconds:
      complete && ends.every(end => end !== null)
        ? seconds(created, Math.max(...ends), 'end-to-end', issues)
        : null,
    runnerSeconds: complete
      ? jobs.reduce((sum, job) => sum + job.executionSeconds, 0)
      : null,
    observedRunnerSeconds: jobs.reduce(
      (sum, job) => sum + (job.executionSeconds ?? 0),
      0,
    ),
    jobCount: jobs.length,
    conclusions: Object.fromEntries(
      [...new Set(jobs.map(job => job.conclusion ?? 'incomplete'))].map(
        conclusion => [
          conclusion,
          jobs.filter(job => (job.conclusion ?? 'incomplete') === conclusion)
            .length,
        ],
      ),
    ),
    issues,
  };
}

export async function githubApi(endpoint) {
  let result;
  try {
    result = await execute(
      'gh',
      [
        'api',
        endpoint,
        '-H',
        'Accept: application/vnd.github+json',
        '-H',
        'X-GitHub-Api-Version: 2026-03-10',
      ],
      { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
    );
  } catch {
    throw new Error('GitHub metadata request failed');
  }
  return JSON.parse(result.stdout);
}

export async function githubJobLogs({ repository, jobId }) {
  try {
    const result = await execute(
      'gh',
      [
        'api',
        `repos/${repository}/actions/jobs/${jobId}/logs`,
        '--allow-escape-sequences',
      ],
      { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
    );
    return result.stdout;
  } catch {
    throw new Error('GitHub job logs request failed');
  }
}

function evidenceText(value) {
  assert(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 1024 &&
      !/[\u0000-\u001f\u007f-\u009f]/u.test(value),
    'Invalid runner evidence text',
  );
  return value;
}

function runnerEvidence(record, repository) {
  assert(
    record?.schema === 'ultramodern.ci.runner-evidence' &&
      record.schemaVersion === 1,
    'Unsupported runner evidence schema',
  );
  assert(
    shaPattern.test(record.checkedOutCommit),
    'Invalid runner evidence checkout SHA',
  );
  assert(
    record.github?.repository?.toLowerCase() === repository.toLowerCase(),
    'Runner evidence repository does not match',
  );
  assert(
    shaPattern.test(record.github.eventSha),
    'Invalid runner evidence event SHA',
  );
  assert(
    /^[1-9][0-9]*$/u.test(record.github.repositoryId),
    'Invalid runner evidence repository ID',
  );
  assert(
    /^\d+\.\d+\.\d+$/u.test(record.tools?.node) &&
      /^\d+\.\d+\.\d+$/u.test(record.tools?.pnpm),
    'Invalid runner evidence toolchain',
  );
  assert(
    /^[a-f0-9]{64}$/u.test(record.inputs?.lockfileSha256) &&
      /^[a-f0-9]{64}$/u.test(record.inputs?.miseSha256),
    'Invalid runner evidence input hashes',
  );
  assert(
    Number.isSafeInteger(record.runner?.cpu?.logicalCount) &&
      record.runner.cpu.logicalCount > 0 &&
      Number.isSafeInteger(record.runner.memoryBytes) &&
      record.runner.memoryBytes > 0,
    'Invalid runner evidence hardware',
  );
  assert(
    Array.isArray(record.runner.cpu.models) &&
      record.runner.cpu.models.length > 0,
    'Invalid runner evidence CPU models',
  );
  const os = Object.fromEntries(
    ['platform', 'type', 'release', 'architecture'].map(key => [
      key,
      evidenceText(record.runner.os?.[key]),
    ]),
  );
  if (record.runner.os.distribution)
    os.distribution = Object.fromEntries(
      ['id', 'versionId', 'name']
        .filter(key => record.runner.os.distribution[key] !== undefined)
        .map(key => [key, evidenceText(record.runner.os.distribution[key])]),
    );
  const image = record.runner.image
    ? Object.fromEntries(
        ['os', 'version']
          .filter(key => record.runner.image[key] !== undefined)
          .map(key => [key, evidenceText(record.runner.image[key])]),
      )
    : undefined;
  // Copy only the documented record fields, never arbitrary log JSON.
  return {
    schema: record.schema,
    schemaVersion: 1,
    checkedOutCommit: record.checkedOutCommit,
    github: {
      repository: record.github.repository,
      repositoryId: record.github.repositoryId,
      eventSha: record.github.eventSha,
      workflowRef:
        record.github.workflowRef === undefined ||
        record.github.workflowRef === null
          ? null
          : evidenceText(record.github.workflowRef),
    },
    tools: { node: record.tools.node, pnpm: record.tools.pnpm },
    runner: {
      os,
      cpu: {
        logicalCount: record.runner.cpu.logicalCount,
        models: record.runner.cpu.models.map(evidenceText),
      },
      memoryBytes: record.runner.memoryBytes,
      ...(image ? { image } : {}),
    },
    inputs: {
      lockfileSha256: record.inputs.lockfileSha256,
      miseSha256: record.inputs.miseSha256,
    },
  };
}

export function extractCiEvidence(logs, { repository }) {
  assert(
    typeof logs === 'string' && logs.length <= 32 * 1024 * 1024,
    'Invalid or oversized CI job logs',
  );
  const records = [];
  const checkoutCommits = [];
  const cacheSignals = [];
  const lines = logs
    .split('\n')
    .map(line => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s/u, '').trim());
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith(evidencePrefix)) {
      assert(line.length <= 64 * 1024, 'Oversized runner evidence record');
      let record;
      try {
        record = JSON.parse(line.slice(evidencePrefix.length));
      } catch {
        throw new Error('Malformed runner evidence JSON');
      }
      records.push(runnerEvidence(record, repository));
    }
    if (
      /\[command\].*\bgit log -1 --format=%H$/u.test(line) &&
      shaPattern.test(lines[index + 1] ?? '')
    )
      checkoutCommits.push(lines[index + 1]);
    const match =
      /^(Cache restored from key:|Cache not found for input keys:|Cache hit occurred on the primary key)\s*(.*)$/u.exec(
        line,
      );
    if (match) {
      const namespace = [
        'pnpm-store',
        'playwright-chromium',
        'test-build',
        'mise',
      ].find(value => match[2].startsWith(value));
      if (namespace)
        cacheSignals.push({
          namespace,
          result: match[1].startsWith('Cache not found') ? 'miss' : 'restored',
        });
    }
  }
  return {
    records,
    checkoutCommits: [...new Set(checkoutCommits)],
    cacheSignals,
  };
}

export async function collectCiTimings({
  repository,
  samples,
  api = githubApi,
  logs = githubJobLogs,
}) {
  assert(
    typeof repository === 'string' && /^[\w.-]+\/[\w.-]+$/u.test(repository),
    'An explicit owner/repository is required',
  );
  assert(
    Array.isArray(samples) && samples.length > 0,
    'Explicit run samples are required',
  );
  const results = [];
  for (const sample of samples) {
    assert(
      /^\d+$/u.test(String(sample.runId)) && Number(sample.runId) > 0,
      'Invalid run ID',
    );
    assert(
      Number.isSafeInteger(sample.attempt) && sample.attempt > 0,
      'An explicit run attempt is required',
    );
    assert(
      providers.has(sample.provider),
      'An explicit supported provider is required',
    );
    assert(
      cacheStates.has(sample.cacheState),
      'An explicit cache state is required',
    );
    assert(
      typeof sample.workload === 'string' && sample.workload.trim(),
      'An explicit workload label is required',
    );
    assert(
      sample.testedSha === undefined || shaPattern.test(sample.testedSha),
      'Invalid tested SHA',
    );
    assert(
      sample.jobNames === undefined ||
        (Array.isArray(sample.jobNames) &&
          sample.jobNames.length > 0 &&
          sample.jobNames.every(name => typeof name === 'string' && name)),
      'Invalid selected job names',
    );
    const base = `repos/${repository}/actions/runs/${sample.runId}/attempts/${sample.attempt}`;
    const run = await api(base);
    assert(
      String(run.id) === String(sample.runId) &&
        run.run_attempt === sample.attempt,
      'GitHub returned a different run or attempt',
    );
    assert(
      !run.repository?.full_name ||
        run.repository.full_name.toLowerCase() === repository.toLowerCase(),
      'GitHub returned a different repository',
    );
    const rawJobs = [];
    let total;
    for (let page = 1; ; page++) {
      assert(page <= 1000, 'GitHub job pagination exceeded its page limit');
      const response = await api(`${base}/jobs?per_page=100&page=${page}`);
      assert(
        Array.isArray(response.jobs) &&
          Number.isSafeInteger(response.total_count) &&
          response.total_count >= 0,
        'Malformed GitHub jobs page',
      );
      total ??= response.total_count;
      assert(
        total === response.total_count && total <= 100_000,
        'GitHub job count changed or is too large; collect again after completion',
      );
      rawJobs.push(...response.jobs);
      if (rawJobs.length >= total) break;
      assert(
        response.jobs.length > 0,
        'GitHub job pagination ended before every job was collected',
      );
    }
    assert(
      rawJobs.length === total &&
        new Set(rawJobs.map(job => job.id)).size === total,
      'GitHub job pagination has missing or duplicate jobs',
    );
    assert(
      rawJobs.every(
        job =>
          String(job.run_id) === String(sample.runId) &&
          (job.run_attempt === undefined || job.run_attempt === sample.attempt),
      ),
      'GitHub returned jobs from a different run or attempt',
    );
    const jobs = rawJobs.map(jobTiming);
    const selectedJobs = sample.jobNames
      ? jobs.filter(job => sample.jobNames.includes(job.name))
      : jobs;
    assert(
      !sample.jobNames ||
        sample.jobNames.every(name =>
          selectedJobs.some(job => job.name === name),
        ),
      'Selected benchmark jobs are missing',
    );
    const proof = [];
    if (sample.collectEvidence) {
      assert(
        sample.collectEvidence === true,
        'collectEvidence must be true when requested',
      );
      for (const job of selectedJobs) {
        const extracted = extractCiEvidence(
          await logs({
            repository,
            runId: sample.runId,
            attempt: sample.attempt,
            jobId: job.id,
          }),
          { repository },
        );
        job.runnerEvidence = extracted.records;
        proof.push({ jobId: job.id, url: job.url, ...extracted });
      }
    }
    const records = proof.flatMap(item => item.records);
    const checkoutShas = [
      ...new Set([
        ...records.map(record => record.checkedOutCommit),
        ...proof.flatMap(item => item.checkoutCommits),
      ]),
    ];
    assert(
      checkoutShas.length <= 1,
      'Selected jobs checked out different commits',
    );
    assert(
      !sample.testedSha ||
        !checkoutShas.length ||
        sample.testedSha === checkoutShas[0],
      'Explicit tested SHA conflicts with job log evidence',
    );
    const tools = [
      ...new Set(records.map(record => JSON.stringify(record.tools))),
    ];
    const inputs = [
      ...new Set(records.map(record => JSON.stringify(record.inputs))),
    ];
    assert(
      tools.length <= 1 && inputs.length <= 1,
      'Selected job runner evidence has different toolchains or inputs',
    );
    if (sample.toolchain && records.length)
      assert(
        JSON.stringify(stable(sample.toolchain)) ===
          JSON.stringify(stable(records[0].tools)),
        'Explicit toolchain conflicts with job log evidence',
      );
    const testedSha =
      checkoutShas[0] ??
      sample.testedSha ??
      (run.event === 'workflow_dispatch' || run.event === 'push'
        ? run.head_sha
        : null);
    results.push({
      runId: String(sample.runId),
      attempt: sample.attempt,
      repository,
      provider: sample.provider,
      cacheState: sample.cacheState,
      workload: sample.workload,
      cacheEvidence: sample.cacheEvidence ?? null,
      observedCacheSignals: proof.flatMap(item => item.cacheSignals),
      toolchain: records[0]?.tools ?? sample.toolchain ?? null,
      inputHashes: records[0]?.inputs ?? null,
      evidence: proof,
      evidenceRequested: sample.collectEvidence === true,
      evidenceComplete:
        proof.length === selectedJobs.length &&
        proof.every(
          item => item.records.length > 0 || item.checkoutCommits.length > 0,
        ),
      testedSha,
      testedShaSource: checkoutShas.length
        ? 'selected job logs: runner evidence or actions/checkout git log'
        : sample.testedSha
          ? 'explicit sample metadata'
          : testedSha
            ? `GitHub ${run.event} head_sha`
            : 'unavailable; PR head_sha does not prove the tested merge SHA',
      headSha: run.head_sha,
      workflowPath: run.path ?? null,
      workflowName: run.name ?? null,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion ?? null,
      createdAt: run.created_at ?? null,
      runStartedAt: run.run_started_at ?? null,
      updatedAt: run.updated_at ?? null,
      url:
        run.html_url ??
        `https://github.com/${repository}/actions/runs/${sample.runId}/attempts/${sample.attempt}`,
      timingKind:
        sample.provider === 'depot-ci'
          ? 'GitHub bridge delivery latency; native Depot execution is not measured'
          : 'GitHub Actions job timing',
      timingOrigin:
        'run.created_at; rerun attempts may retain the original run creation time',
      queueMeaning:
        'job.started_at minus job.created_at includes dependency and concurrency delays, not only runner allocation',
      workflowTotals: totals(jobs, run.created_at, 'workflow'),
      selectedTotals: totals(selectedJobs, run.created_at, 'selected'),
      selectedJobIds: selectedJobs.map(job => job.id),
      jobs,
    });
  }
  return {
    format: 1,
    repository,
    collectedAt: new Date().toISOString(),
    samples: results,
  };
}

const depotOrgId = '882f0kcw25';
const depotIdPattern = /^[a-zA-Z0-9_-]+$/u;
const depotDashboardUrl = `https://depot.dev/orgs/${depotOrgId}/workflows`;
const depotTerminal = new Set(['finished', 'failed', 'cancelled', 'skipped']);
const depotStatuses = new Set([
  'queued',
  'waiting',
  'running',
  ...depotTerminal,
]);

export async function depotTimingApi(method, body) {
  assert(
    ['GetRun', 'GetRunStatus', 'GetJob', 'GetJobAttemptLogs'].includes(method),
    'Only read-only Depot timing methods are allowed',
  );
  assert(
    process.env.DEPOT_TOKEN,
    'DEPOT_TOKEN is required for native Depot timing reads',
  );
  try {
    const response = await fetch(
      `https://api.depot.dev/depot.ci.v1.CIService/${method}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.DEPOT_TOKEN}`,
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'Connect-Timeout-Ms': '30000',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    );
    assert(response.ok, 'Depot timing HTTP request failed');
    return await response.json();
  } catch {
    throw new Error('Depot timing metadata request failed');
  }
}

async function depotEvidence(api, attemptId, repository) {
  const records = [];
  const checkoutCommits = [];
  const cacheSignals = [];
  const tokens = new Set();
  let pageToken;
  for (let page = 0; page < 1000; page++) {
    const response = await api('GetJobAttemptLogs', {
      attemptId,
      ...(pageToken ? { pageToken } : {}),
    });
    assert(
      response.lines === undefined || Array.isArray(response.lines),
      'Malformed Depot log lines',
    );
    assert(
      (response.lines ?? []).every(
        line =>
          line && (line.body === undefined || typeof line.body === 'string'),
      ),
      'Malformed Depot log body',
    );
    const extracted = extractCiEvidence(
      (response.lines ?? []).map(line => line.body ?? '').join('\n'),
      { repository },
    );
    records.push(...extracted.records);
    checkoutCommits.push(...extracted.checkoutCommits);
    cacheSignals.push(...extracted.cacheSignals);
    const next = response.nextPageToken;
    if (!next || !(response.lines ?? []).length)
      return { records, checkoutCommits, cacheSignals };
    assert(
      typeof next === 'string' && !tokens.has(next),
      'Depot log pagination repeated a token',
    );
    tokens.add(next);
    pageToken = next;
  }
  throw new Error('Depot log pagination exceeded its page limit');
}

// Native response shapes are defined by https://depot.dev/openapi/depot-ci/v1.json.
// This API has no authoritative per-step timing endpoint.
export async function collectDepotCiTimings({
  repository,
  samples,
  api = depotTimingApi,
}) {
  assert(
    typeof repository === 'string' && /^[\w.-]+\/[\w.-]+$/u.test(repository),
    'An explicit owner/repository is required',
  );
  assert(
    Array.isArray(samples) && samples.length > 0 && samples.length <= 100,
    'Explicit bounded Depot run samples are required',
  );
  const results = [];
  for (const sample of samples) {
    assert(
      typeof sample.runId === 'string' &&
        /^[a-zA-Z0-9_-]+$/u.test(sample.runId),
      'Invalid Depot run ID',
    );
    assert(
      sample.provider === 'depot-ci' &&
        cacheStates.has(sample.cacheState) &&
        typeof sample.workload === 'string' &&
        sample.workload.trim(),
      'Explicit Depot provider, cache state and workload are required',
    );
    const run = await api('GetRun', { runId: sample.runId });
    const status = await api('GetRunStatus', { runId: sample.runId });
    assert(
      depotStatuses.has(run?.status) && depotStatuses.has(status?.status),
      'Unknown Depot run status',
    );
    for (const value of [run, status])
      assert(
        value?.runId === sample.runId && value.orgId === depotOrgId,
        'Depot run or organization identity does not match',
      );
    assert(run.repo === repository, 'Depot repository does not match');
    assert(
      !sample.testedSha || !run.sha || sample.testedSha === run.sha,
      'Depot tested SHA does not match',
    );
    assert(
      status.workflows === undefined || Array.isArray(status.workflows),
      'Malformed Depot workflows',
    );
    const workflows = status.workflows ?? [];
    const jobs = [];
    const identifiers = new Set();
    for (const workflow of workflows) {
      assert(
        typeof workflow.workflowId === 'string' &&
          depotIdPattern.test(workflow.workflowId) &&
          typeof workflow.workflowPath === 'string' &&
          (workflow.jobs === undefined || Array.isArray(workflow.jobs)),
        'Malformed Depot workflow',
      );
      assert(
        !sample.workflowPath ||
          workflow.workflowPath === sample.workflowPath ||
          (sample.workflowPath.startsWith('.depot/workflows/') &&
            workflow.workflowPath === path.posix.basename(sample.workflowPath)),
        'Depot workflow path does not match',
      );
      for (const entry of workflow.jobs ?? []) {
        assert(
          typeof entry.jobId === 'string' &&
            depotIdPattern.test(entry.jobId) &&
            !identifiers.has(entry.jobId) &&
            identifiers.size < 1000,
          'Invalid, duplicate or excessive Depot job IDs',
        );
        identifiers.add(entry.jobId);
        const detail = await api('GetJob', { jobId: entry.jobId });
        assert(
          depotStatuses.has(detail?.jobStatus),
          'Unknown Depot job status',
        );
        assert(
          detail?.orgId === depotOrgId &&
            detail.runId === sample.runId &&
            detail.repo === repository &&
            detail.jobId === entry.jobId &&
            detail.workflowId === workflow.workflowId &&
            detail.workflowPath === workflow.workflowPath,
          'Depot job identity does not match',
        );
        assert(
          !run.sha || detail.sha === run.sha,
          'Depot job SHA does not match',
        );
        assert(
          detail.attempts === undefined || Array.isArray(detail.attempts),
          'Malformed Depot attempts',
        );
        const complete = depotTerminal.has(detail.jobStatus);
        assert(
          !detail.currentAttemptId ||
            (typeof detail.currentAttemptId === 'string' &&
              depotIdPattern.test(detail.currentAttemptId)),
          'Invalid Depot current attempt ID',
        );
        const jobUrl = `${depotDashboardUrl}/${workflow.workflowId}/jobs/${entry.jobId}${detail.currentAttemptId ? `?attempt=${detail.currentAttemptId}` : ''}`;
        const job = jobTiming({
          id: detail.jobId,
          name: detail.jobDisplayName || detail.jobKey,
          status: complete ? 'completed' : detail.jobStatus,
          conclusion: detail.jobConclusion || null,
          head_sha: detail.headSha || null,
          run_attempt: detail.currentAttempt,
          created_at: detail.jobCreatedAt,
          started_at: detail.jobStartedAt,
          completed_at: detail.jobFinishedAt,
          labels: detail.runsOn?.labels ?? [],
          html_url: jobUrl,
        });
        job.sourceStatus = detail.jobStatus;
        job.testedSha = shaPattern.test(detail.sha) ? detail.sha : null;
        job.workflowPath = detail.workflowPath;
        job.configuredRunner = detail.runsOn
          ? Object.fromEntries(
              ['labels', 'image', 'cpus', 'memoryGb', 'size']
                .filter(key => detail.runsOn[key] !== undefined)
                .map(key => [key, detail.runsOn[key]]),
            )
          : null;
        job.dispatchedAt = detail.jobDispatchedAt || null;
        job.attempts = (detail.attempts ?? []).map(attempt => {
          assert(
            depotStatuses.has(attempt.status),
            'Unknown Depot attempt status',
          );
          assert(
            typeof attempt.attemptId === 'string' &&
              depotIdPattern.test(attempt.attemptId) &&
              Number.isInteger(attempt.attempt) &&
              attempt.attempt > 0,
            'Malformed Depot attempt identity',
          );
          const issues = [];
          const created = timestamp(
            attempt.createdAt,
            'attempt.createdAt',
            issues,
          );
          const dispatched = timestamp(
            attempt.dispatchedAt,
            'attempt.dispatchedAt',
            issues,
          );
          const started = timestamp(
            attempt.startedAt,
            'attempt.startedAt',
            issues,
          );
          const finished = timestamp(
            attempt.finishedAt,
            'attempt.finishedAt',
            issues,
          );
          const done = depotTerminal.has(attempt.status);
          return {
            id: attempt.attemptId,
            number: attempt.attempt,
            status: attempt.status,
            conclusion: attempt.conclusion || null,
            createdAt: attempt.createdAt || null,
            dispatchedAt: attempt.dispatchedAt || null,
            startedAt: attempt.startedAt || null,
            finishedAt: attempt.finishedAt || null,
            schedulingSeconds: done
              ? seconds(created, dispatched, 'attempt scheduling', issues)
              : null,
            startupSeconds: done
              ? seconds(dispatched, started, 'attempt startup', issues)
              : null,
            executionSeconds: done
              ? seconds(started, finished, 'attempt execution', issues)
              : null,
            issues,
          };
        });
        if (job.attempts.length)
          job.executionSeconds = job.attempts.every(
            attempt => attempt.executionSeconds !== null,
          )
            ? job.attempts.reduce(
                (sum, attempt) => sum + attempt.executionSeconds,
                0,
              )
            : null;
        if (
          sample.collectEvidence &&
          detail.currentAttemptId &&
          (!sample.jobNames || sample.jobNames.includes(job.name))
        ) {
          job.runnerEvidence = (
            await depotEvidence(api, detail.currentAttemptId, repository)
          ).records;
          assert(
            job.runnerEvidence.every(
              record => record.checkedOutCommit === detail.sha,
            ),
            'Depot log checkout evidence does not match',
          );
        }
        jobs.push(job);
      }
    }
    const selectedJobs = sample.jobNames
      ? jobs.filter(job => sample.jobNames.includes(job.name))
      : jobs;
    assert(
      !sample.jobNames ||
        sample.jobNames.every(name =>
          selectedJobs.some(job => job.name === name),
        ),
      'Selected Depot jobs are missing',
    );
    const evidence = selectedJobs.flatMap(job => job.runnerEvidence ?? []);
    const testedShas = [
      ...new Set(selectedJobs.map(job => job.testedSha).filter(Boolean)),
    ];
    assert(
      testedShas.length <= 1,
      'Depot selected jobs executed different SHAs',
    );
    const testedSha = shaPattern.test(run.sha)
      ? run.sha
      : selectedJobs.length > 0 && selectedJobs.every(job => job.testedSha)
        ? testedShas[0]
        : null;
    assert(
      !sample.testedSha || sample.testedSha === testedSha,
      'Depot tested SHA does not match',
    );
    const tools = [
      ...new Set(evidence.map(record => JSON.stringify(record.tools))),
    ];
    const inputs = [
      ...new Set(evidence.map(record => JSON.stringify(record.inputs))),
    ];
    assert(
      tools.length <= 1 && inputs.length <= 1,
      'Depot runner evidence has different toolchains or inputs',
    );
    const complete = depotTerminal.has(run.status);
    results.push({
      runId: sample.runId,
      attempt: 1,
      repository,
      provider: 'depot-ci',
      source: 'native-depot-ci',
      cacheState: sample.cacheState,
      cacheEvidence: sample.cacheEvidence ?? null,
      workload: sample.workload,
      testedSha,
      testedShaSource: run.sha
        ? 'Depot GetRun.sha, corroborated by GetJob.sha when available'
        : 'Depot GetJob.sha for every selected job',
      headSha: run.headSha || null,
      toolchain: evidence[0]?.tools ?? sample.toolchain ?? null,
      inputHashes: evidence[0]?.inputs ?? null,
      workflowPath: workflows.length === 1 ? workflows[0].workflowPath : null,
      workflowName: workflows.length === 1 ? (workflows[0].name ?? null) : null,
      requestedWorkflowPath: sample.workflowPath ?? null,
      event: run.trigger,
      status: complete ? 'completed' : run.status,
      conclusion:
        run.status === 'finished'
          ? 'success'
          : run.status === 'failed'
            ? 'failure'
            : run.status === 'cancelled'
              ? 'cancelled'
              : null,
      createdAt: run.createdAt || null,
      runStartedAt: run.startedAt || null,
      finishedAt: run.finishedAt || null,
      url:
        workflows.length === 1
          ? `${depotDashboardUrl}/${workflows[0].workflowId}`
          : depotDashboardUrl,
      timingKind: 'Native Depot CI run, job and attempt timestamps',
      stepTimingAvailable: false,
      executionSelection:
        'Passive API metadata does not prove absence of workflow content, job filters or local patch overrides',
      workflowTotals: totals(jobs, run.createdAt, 'workflow'),
      selectedTotals: totals(selectedJobs, run.createdAt, 'selected'),
      selectedJobIds: selectedJobs.map(job => job.id),
      jobs,
    });
  }
  return {
    format: 1,
    repository,
    source: 'native-depot-ci',
    collectedAt: new Date().toISOString(),
    samples: results,
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stable(value[key])]),
    );
  return value;
}

export function compareCiSamples(before, after) {
  const reasons = [];
  if (before.runId === after.runId && before.attempt === after.attempt)
    reasons.push('a paired comparison requires distinct run samples');
  const coverage = sample =>
    sample.jobs
      .filter(job => sample.selectedJobIds.includes(job.id))
      .map(job => ({
        name: job.name,
        steps: job.steps.map(step => ({
          number: step.number,
          name: step.name,
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  for (const field of [
    'repository',
    'testedSha',
    'workload',
    'cacheState',
    'workflowPath',
    'event',
  ]) {
    if (!before[field] || before[field] !== after[field])
      reasons.push(`${field} is missing or different`);
  }
  if (before.cacheState === 'unknown' || before.cacheState === 'mixed')
    reasons.push('cache state is not a verified cold or warm mode');
  if (!before.cacheEvidence || !after.cacheEvidence)
    reasons.push('cache evidence is missing');
  if (
    !before.toolchain ||
    !after.toolchain ||
    JSON.stringify(stable(before.toolchain)) !==
      JSON.stringify(stable(after.toolchain))
  )
    reasons.push('toolchain metadata is missing or different');
  if (
    (before.inputHashes || after.inputHashes) &&
    JSON.stringify(stable(before.inputHashes)) !==
      JSON.stringify(stable(after.inputHashes))
  )
    reasons.push(
      'recorded lockfile or mise input hashes differ or are missing',
    );
  if (JSON.stringify(coverage(before)) !== JSON.stringify(coverage(after)))
    reasons.push('selected job or step coverage differs');
  for (const sample of [before, after]) {
    if (
      sample.status !== 'completed' ||
      sample.conclusion !== 'success' ||
      !sample.selectedTotals.successful ||
      sample.selectedTotals.endToEndSeconds === null
    )
      reasons.push('sample is incomplete or unsuccessful');
    if (sample.attempt !== 1)
      reasons.push(
        'rerun attempt timing has no independent creation timestamp',
      );
    if (sample.provider === 'depot-ci')
      reasons.push(
        sample.source === 'native-depot-ci'
          ? 'native Depot step coverage and override absence require separate evidence'
          : 'GitHub bridge timing does not measure native Depot execution',
      );
    if (sample.evidenceRequested && !sample.evidenceComplete)
      reasons.push('requested checkout log evidence is incomplete');
    if (
      sample.jobs.some(
        job => sample.selectedJobIds.includes(job.id) && job.issues.length,
      )
    )
      reasons.push('selected job timestamps are missing or invalid');
  }
  if (reasons.length)
    return { comparable: false, reasons: [...new Set(reasons)] };
  return {
    comparable: true,
    reasons: [],
    pairedRunIds: [before.runId, after.runId],
    endToEndSeconds: {
      before: before.selectedTotals.endToEndSeconds,
      after: after.selectedTotals.endToEndSeconds,
    },
    runnerSeconds: {
      before: before.selectedTotals.runnerSeconds,
      after: after.selectedTotals.runnerSeconds,
    },
    // A paired observation is not an estimate across repeated trials.
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = new Map();
    for (let index = 2; index < process.argv.length; index += 2) {
      const flag = process.argv[index];
      assert(
        ['--repo', '--samples', '--input', '--output', '--source'].includes(
          flag,
        ) &&
          process.argv[index + 1] &&
          !args.has(flag),
        'Usage: collect-ci-timings.mjs --repo owner/repo --samples <JSON array> [--output path], or --input <manifest.json>',
      );
      args.set(flag, process.argv[index + 1]);
    }
    assert(
      !(
        args.has('--input') &&
        (args.has('--repo') || args.has('--samples') || args.has('--source'))
      ),
      'Use --input with source in the manifest, or --repo with --samples and optional --source',
    );
    const input = args.has('--input')
      ? JSON.parse(await readFile(args.get('--input'), 'utf8'))
      : {
          repository: args.get('--repo'),
          source: args.get('--source'),
          samples: JSON.parse(args.get('--samples') ?? 'null'),
        };
    assert(
      !input.source || ['github-actions', 'depot-ci'].includes(input.source),
      'Invalid timing source',
    );
    const result =
      input.source === 'depot-ci'
        ? await collectDepotCiTimings(input)
        : await collectCiTimings(input);
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (args.has('--output'))
      await writeFile(args.get('--output'), json, { flag: 'wx' });
    else process.stdout.write(json);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
