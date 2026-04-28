const test = require('node:test');
const assert = require('node:assert/strict');

const { loadReferenceTopology } = require('../reference-topology');
const {
  FALLBACK_ORDER,
  loadRollbackKillSwitchDrill,
  validateRollbackKillSwitchDrill,
} = require('../rollback-kill-switch-drill');

const clone = value => JSON.parse(JSON.stringify(value));

test('loads rollback kill-switch drill with SLO evidence summary', () => {
  const { drill, topology, evidenceSummary } = loadRollbackKillSwitchDrill();

  assert.equal(drill.schemaVersion, 1);
  assert.equal(topology.id, 'wave2-integration-pilot-reference-topology');
  assert.equal(evidenceSummary.drillId, 'uw2-05-rollback-kill-switch-slo');
  assert.equal(evidenceSummary.targetComponentId, 'remote-commerce');
  assert.equal(evidenceSummary.targetKind, 'vertical');
  assert.deepEqual(evidenceSummary.fallbackOrder, FALLBACK_ORDER);
  assert.equal(evidenceSummary.selectedStage, 'lkg');
  assert.equal(
    evidenceSummary.selectedArtifactId,
    'artifact-remote-commerce-2026-04-15-007',
  );
  assert.equal(evidenceSummary.killSwitchTargetId, 'remote-commerce');
  assert.equal(
    evidenceSummary.replacementArtifactId,
    'artifact-remote-commerce-2026-04-15-007',
  );
});

test('valid rollback kill-switch drill stays within incident SLO budgets', () => {
  const { evidenceSummary } = loadRollbackKillSwitchDrill();

  assert.equal(evidenceSummary.incidentSlo.detectBudgetMs, 120000);
  assert.equal(evidenceSummary.incidentSlo.mitigateBudgetMs, 300000);
  assert.equal(evidenceSummary.incidentSlo.totalBudgetMs, 420000);
  assert.ok(
    evidenceSummary.incidentSlo.detectedInMs <=
      evidenceSummary.incidentSlo.detectBudgetMs,
  );
  assert.ok(
    evidenceSummary.incidentSlo.mitigatedInMs <=
      evidenceSummary.incidentSlo.mitigateBudgetMs,
  );
  assert.ok(
    evidenceSummary.incidentSlo.totalElapsedMs <=
      evidenceSummary.incidentSlo.totalBudgetMs,
  );
});

test('summary carries telemetry and related drill report references', () => {
  const { evidenceSummary } = loadRollbackKillSwitchDrill();

  assert.equal(
    evidenceSummary.telemetryRef,
    'evidence/wave2/rollback-kill-switch/telemetry.jsonl',
  );
  assert.deepEqual(
    evidenceSummary.relatedDrillReports.map(report => report.id),
    [
      'wave2-remote-failure-drills',
      'uw2-03-design-system-bad-release',
      'uw2-04-vertical-extraction-drill',
    ],
  );
  assert.match(
    evidenceSummary.evidenceRefs.rollbackRunbookRef,
    /remote-commerce\.md#rollback-to-lkg$/,
  );
});

test('validator rejects bad fallback order', () => {
  const { topology } = loadReferenceTopology();
  const { drill } = loadRollbackKillSwitchDrill();
  const broken = clone(drill);
  broken.fallbackPlan.order = [
    'current',
    'lkg',
    'environment-overlay',
    'csr-fallback',
  ];

  assert.throws(
    () => validateRollbackKillSwitchDrill({ drill: broken, topology }),
    /fallbackPlan\.order must be current -> environment-overlay -> lkg -> csr-fallback/,
  );
});

test('validator rejects unknown kill-switch target', () => {
  const { topology } = loadReferenceTopology();
  const { drill } = loadRollbackKillSwitchDrill();
  const broken = clone(drill);
  broken.killSwitch.targetId = 'remote-unknown';

  assert.throws(
    () => validateRollbackKillSwitchDrill({ drill: broken, topology }),
    /killSwitch\.targetId must match target component "remote-commerce"/,
  );
});

test('validator rejects revoked selected artifact', () => {
  const { topology } = loadReferenceTopology();
  const { drill } = loadRollbackKillSwitchDrill();
  const broken = clone(drill);
  broken.revocation.revokedArtifactIds.push(
    'artifact-remote-commerce-2026-04-15-007',
  );

  assert.throws(
    () => validateRollbackKillSwitchDrill({ drill: broken, topology }),
    /fallbackPlan\.selectedArtifactId "artifact-remote-commerce-2026-04-15-007" is revoked/,
  );
});

test('validator rejects revoked kill-switch replacement artifact', () => {
  const { topology } = loadReferenceTopology();
  const { drill } = loadRollbackKillSwitchDrill();
  const broken = clone(drill);
  broken.killSwitch.replacementArtifactId =
    'artifact-shell-commerce-csr-fallback-2026-04-15-001';
  broken.revocation.revokedArtifactIds.push(
    'artifact-shell-commerce-csr-fallback-2026-04-15-001',
  );

  assert.throws(
    () => validateRollbackKillSwitchDrill({ drill: broken, topology }),
    /killSwitch\.replacementArtifactId "artifact-shell-commerce-csr-fallback-2026-04-15-001" is revoked/,
  );
});

test('validator rejects SLO breach', () => {
  const { topology } = loadReferenceTopology();
  const { drill } = loadRollbackKillSwitchDrill();
  const broken = clone(drill);
  broken.incidentSlo.totalElapsedMs = 420001;

  assert.throws(
    () => validateRollbackKillSwitchDrill({ drill: broken, topology }),
    /incidentSlo totalElapsedMs breaches totalBudgetMs/,
  );
});
