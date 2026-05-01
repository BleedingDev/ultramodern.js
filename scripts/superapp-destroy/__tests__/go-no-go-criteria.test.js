const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DECISIONS,
  GO_NO_GO_SCHEMA_VERSION,
  createGoNoGoCriteria,
} = require('../go-no-go-criteria');

const repoRoot = path.resolve(__dirname, '../../..');
const destroyPlanPath = path.join(
  repoRoot,
  '.codex/plans/ultramodern-superapp-torture-destroy-readiness.plan.md',
);

test('current evidence is go for development and release certification', () => {
  const { report } = createGoNoGoCriteria(
    {},
    { generatedAt: '2026-05-01T00:00:00.000Z' },
  );

  assert.equal(report.schemaVersion, GO_NO_GO_SCHEMA_VERSION);
  assert.equal(report.decision, DECISIONS.GO_FOR_DEVELOPMENT);
  assert.equal(report.releaseDecision, DECISIONS.GO_FOR_RELEASE);
  assert.equal(report.summary.canBeginSuperAppDevelopment, true);
  assert.equal(report.summary.canCertifyRelease, true);
  assert.equal(report.summary.canRunNightlyManualTortureAsGate, true);
  assert.deepEqual(report.blockers, []);
  assert.ok(
    report.gates.developmentStart.every(gate => gate.status === 'pass'),
  );
  assert.ok(
    report.gates.releaseCertification.every(gate => gate.status === 'pass'),
  );
});

test('hard load or teardown failures block development start', () => {
  const { report } = createGoNoGoCriteria({
    observedLoad: {
      requests: 786,
      p95LatencyMs: 1200,
      p99LatencyMs: 2200,
      maxLatencyMs: 7000,
      errorRate: 0.03,
      budgetFailures: ['p95LatencyMs exceeded'],
    },
    smokeRun: {
      teardownPassed: false,
    },
  });

  assert.equal(report.decision, DECISIONS.NO_GO_FOR_DEVELOPMENT);
  assert.equal(report.summary.canBeginSuperAppDevelopment, false);
  assert.ok(
    report.gates.developmentStart.some(
      gate => gate.id === 'load-budget-clean' && gate.status === 'blocked',
    ),
  );
  assert.ok(
    report.gates.developmentStart.some(
      gate => gate.id === 'teardown-clean' && gate.status === 'blocked',
    ),
  );
});

test('closed residual blockers and pass evidence promote release certification', () => {
  const { report } = createGoNoGoCriteria({
    blockers: [
      { id: 'modernjs-b9f', status: 'closed', title: 'closed chaos' },
      { id: 'modernjs-fdl', status: 'closed', title: 'closed k6' },
    ],
    productionRolloutEvidence: 'pass',
    releaseReadinessClassification: 'pass',
  });

  assert.equal(report.decision, DECISIONS.GO_FOR_DEVELOPMENT);
  assert.equal(report.releaseDecision, DECISIONS.GO_FOR_RELEASE);
  assert.equal(report.summary.canCertifyRelease, true);
  assert.equal(report.summary.canRunNightlyManualTortureAsGate, true);
  assert.equal(report.summary.canStartProductionRollout, true);
  assert.deepEqual(report.blockers, []);
});

test('markdown includes residual blockers, owner action, evidence, and commands', () => {
  const { markdown } = createGoNoGoCriteria({
    blockers: [
      {
        id: 'modernjs-b9f',
        title: 'Stabilize SuperApp destroy chaos lane port allocation',
        status: 'open',
        owner: 'Petr Glaser',
        action: 'Fix port allocation.',
        requiredEvidence: 'Chaos passes without EADDRINUSE.',
      },
      {
        id: 'modernjs-fdl',
        title:
          'Provide k6 prerequisite or fallback for SuperApp destroy smoke evidence',
        status: 'open',
        owner: 'Petr Glaser',
        action: 'Provide a fallback.',
        requiredEvidence: 'No K6_NOT_AVAILABLE evidence remains.',
      },
    ],
  });

  assert.match(markdown, /^# SuperApp Go\/No-Go Criteria/);
  assert.match(markdown, /Development start: go-for-development/);
  assert.match(markdown, /Release certification: not-go-for-release/);
  assert.match(markdown, /modernjs-b9f/);
  assert.match(markdown, /EADDRINUSE/);
  assert.match(markdown, /modernjs-fdl/);
  assert.match(markdown, /K6_NOT_AVAILABLE/);
  assert.match(markdown, /--profile smoke/);
  assert.match(markdown, /--profile release/);
  assert.match(markdown, /--profile nightly/);
  assert.match(markdown, /--profile manual-torture/);
});

test('current markdown reports no residual blockers or legacy failure signatures', () => {
  const { markdown } = createGoNoGoCriteria();

  assert.match(markdown, /Release certification: go-for-release/);
  assert.match(markdown, /Smoke failure: none/);
  assert.match(markdown, /Residual Blockers\n\n- none/);
  assert.doesNotMatch(markdown, /EADDRINUSE/);
  assert.doesNotMatch(markdown, /K6_NOT_AVAILABLE/);
});

test('destroy plan status scope only marks ust-destroy-05 in this lane', () => {
  const plan = fs.readFileSync(destroyPlanPath, 'utf8');

  assert.match(
    plan,
    /id: ust-destroy-05\n {4}content: "Document the final go\/no-go criteria for starting a large ERP or Uber\/Grab-style SuperApp on the fork\."\n {4}status: completed/,
  );
  for (const id of [
    'ust-destroy-01',
    'ust-destroy-02',
    'ust-destroy-03',
    'ust-destroy-04',
  ]) {
    assert.match(
      plan,
      new RegExp(`id: ${id}\\n    content: .*\\n    status: completed`),
    );
  }
});
