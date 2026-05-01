const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDestroyPlan, parseArgs } = require('../run-superapp-destroy');
const {
  DESTROY_READINESS_SCHEMA_VERSION,
  createDestroyReadinessReport,
  writeDestroyReadinessReport,
} = require('../readiness-report');

const fixedNow = new Date('2026-01-02T03:04:05.000Z');

function planOptions(extraArgs = []) {
  return parseArgs(
    [
      '--dry-run',
      '--run-id',
      'readiness-test',
      '--output-dir',
      '.modern/superapp-destroy/readiness-test',
      ...extraArgs,
    ],
    {},
    fixedNow,
  );
}

function createPlan(extraArgs = []) {
  return createDestroyPlan(planOptions(extraArgs));
}

function passingExecution(plan) {
  return {
    schemaVersion: 'superapp-destroy-execution-v1',
    runId: plan.runId,
    status: 'passed',
    teardownScheduled: true,
    results: plan.phases.map(phase => ({
      commands: phase.commands.map(command => ({
        exitCode: 0,
        id: command.id,
        status: 'passed',
      })),
      phaseId: phase.id,
      status: 'passed',
    })),
  };
}

function laneArtifact(lane, overrides = {}) {
  return {
    artifact: {
      schemaVersion: 1,
      suite: `synthetic-${lane}`,
      status: 'passed',
      budgetFailures: [],
      warnings: [],
      unknowns: [],
      ...overrides,
    },
    lane,
    path: `/tmp/${lane}/summary.json`,
    provenance: {
      source: 'test',
    },
  };
}

function allLaneArtifacts(overrides = {}) {
  return [
    'load',
    'chaos',
    'browser-runtime',
    'contracts',
    'runtime-matrix',
    'soak-stability',
  ].map(lane => laneArtifact(lane, overrides[lane]));
}

test('all-pass aggregation produces a pass readiness report', () => {
  const plan = createPlan(['--profile', 'release']);
  const { report } = createDestroyReadinessReport(
    {
      artifacts: allLaneArtifacts(),
      execution: passingExecution(plan),
      plan,
    },
    { generatedAt: '2026-01-02T03:04:05.000Z' },
  );

  assert.equal(report.schemaVersion, DESTROY_READINESS_SCHEMA_VERSION);
  assert.equal(report.classification, 'pass');
  assert.equal(report.profile.id, 'release');
  assert.deepEqual(report.thresholds.budget, plan.thresholdBudget);
  assert.equal(report.missingEvidence.length, 0);
  assert.ok(report.lanes.every(lane => lane.classification === 'pass'));
  assert.ok(report.phases.every(phase => phase.classification === 'pass'));
});

test('missing lane evidence becomes unknown instead of passing silently', () => {
  const plan = createPlan();
  const artifacts = allLaneArtifacts().filter(
    artifact => artifact.lane !== 'runtime-matrix',
  );
  const { report } = createDestroyReadinessReport({
    artifacts,
    execution: passingExecution(plan),
    plan,
  });

  assert.equal(report.classification, 'unknown');
  assert.equal(
    report.lanes.find(lane => lane.id === 'runtime-matrix').classification,
    'unknown',
  );
  assert.ok(
    report.missingEvidence.some(item =>
      item.includes(
        'runtime-matrix: required lane evidence artifact is missing',
      ),
    ),
  );
});

test('unreadable artifact evidence is unknown instead of fail', () => {
  const plan = createPlan();
  const { report } = createDestroyReadinessReport({
    artifacts: [
      ...allLaneArtifacts().filter(artifact => artifact.lane !== 'load'),
      {
        lane: 'load',
        path: '/tmp/missing-load-artifact.json',
      },
    ],
    execution: passingExecution(plan),
    plan,
  });

  assert.equal(report.classification, 'unknown');
  assert.equal(
    report.lanes.find(lane => lane.id === 'load').classification,
    'unknown',
  );
  assert.ok(
    report.lanes
      .find(lane => lane.id === 'load')
      .reasons.some(reason =>
        reason.includes(
          'could not read artifact /tmp/missing-load-artifact.json',
        ),
      ),
  );
});

test('failed phase and threshold breach classify readiness as fail', () => {
  const plan = createPlan();
  const execution = passingExecution(plan);
  execution.status = 'failed';
  execution.results.find(result => result.phaseId === 'load').status = 'failed';
  execution.results.find(result => result.phaseId === 'load').commands[0] = {
    exitCode: 17,
    id: 'superapp-portfolio-load',
    status: 'failed',
  };

  const { report } = createDestroyReadinessReport({
    artifacts: allLaneArtifacts({
      load: {
        budgetFailures: [
          { id: 'p95LatencyMs', observed: 1200, threshold: 1000 },
        ],
        status: 'failed',
      },
    }),
    execution,
    plan,
  });

  assert.equal(report.classification, 'fail');
  assert.equal(
    report.lanes.find(lane => lane.id === 'load').classification,
    'fail',
  );
  assert.equal(
    report.phases.find(phase => phase.id === 'load').classification,
    'fail',
  );
  assert.ok(report.failures.some(item => item.includes('threshold breach')));
  assert.ok(
    report.failures.some(item => item.includes('superapp-portfolio-load')),
  );
});

test('warnings propagate without masking failures', () => {
  const plan = createPlan();
  const { report } = createDestroyReadinessReport({
    artifacts: allLaneArtifacts({
      chaos: {
        status: 'warning',
        warnings: ['chaos recovery was slow but inside hard budget'],
      },
      contracts: {
        budgetFailures: ['contractFailures exceeded budget'],
        status: 'failed',
      },
    }),
    execution: passingExecution(plan),
    plan,
  });

  assert.equal(report.classification, 'fail');
  assert.equal(
    report.lanes.find(lane => lane.id === 'chaos').classification,
    'warning',
  );
  assert.equal(
    report.lanes.find(lane => lane.id === 'contracts').classification,
    'fail',
  );
  assert.ok(
    report.warnings.some(item =>
      item.includes('chaos recovery was slow but inside hard budget'),
    ),
  );
});

test('markdown summarizes status, lanes, thresholds, missing evidence, and failures', () => {
  const plan = createPlan();
  const { markdown } = createDestroyReadinessReport({
    artifacts: allLaneArtifacts().filter(
      artifact => artifact.lane !== 'soak-stability',
    ),
    execution: passingExecution(plan),
    plan,
  });

  assert.match(markdown, /^# SuperApp Destroy Readiness/);
  assert.match(markdown, /Overall: unknown/);
  assert.match(markdown, /Load, k6, and autocannon/);
  assert.match(markdown, /"p95LatencyMs": 1000/);
  assert.match(
    markdown,
    /soak-stability: required lane evidence artifact is missing/,
  );
  assert.match(markdown, /## Failures\n\n- none/);
});

test('writer emits JSON and markdown readiness artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'destroy-readiness-'));
  const plan = {
    ...createPlan(),
    outputDir: tempDir,
  };
  const result = writeDestroyReadinessReport(
    {
      artifacts: allLaneArtifacts(),
      execution: passingExecution(plan),
      plan,
    },
    {
      generatedAt: '2026-01-02T03:04:05.000Z',
      outputDir: tempDir,
    },
  );

  assert.equal(result.report.classification, 'pass');
  assert.ok(fs.existsSync(path.join(tempDir, 'destroy-readiness.json')));
  assert.ok(fs.existsSync(path.join(tempDir, 'destroy-readiness.md')));
  assert.equal(
    JSON.parse(fs.readFileSync(result.reportPath, 'utf8')).schemaVersion,
    DESTROY_READINESS_SCHEMA_VERSION,
  );
  assert.match(fs.readFileSync(result.markdownPath, 'utf8'), /Overall: pass/);
});
