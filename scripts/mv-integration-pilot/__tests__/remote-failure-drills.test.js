const test = require('node:test');
const assert = require('node:assert/strict');

const { loadReferenceTopology } = require('../reference-topology');
const {
  loadRemoteFailureDrills,
  validateRemoteFailureDrills,
} = require('../remote-failure-drills');

const clone = value => JSON.parse(JSON.stringify(value));

test('loads remote failure drills and summarizes pass-case evidence', () => {
  const { drills, topology, evidenceSummary } = loadRemoteFailureDrills();

  assert.equal(drills.schemaVersion, 1);
  assert.equal(topology.id, 'wave2-integration-pilot-reference-topology');
  assert.equal(evidenceSummary.drillSetId, 'wave2-remote-failure-drills');
  assert.equal(evidenceSummary.shellId, 'shell-super-app');
  assert.equal(evidenceSummary.passCaseCount, 3);
  assert.equal(evidenceSummary.failCaseCount, 2);
  assert.deepEqual(evidenceSummary.coveredFailureModes, [
    'remote-timeout',
    'network-failure',
    'integrity-mismatch',
  ]);
  assert.ok(
    evidenceSummary.passCases.every(
      drill =>
        drill.shellSurvives &&
        drill.fallbackTelemetryPresent &&
        drill.affectedRemoteIsolated,
    ),
  );
});

test('valid pass cases pin canonical fallback reason code and phase', () => {
  const { evidenceSummary } = loadRemoteFailureDrills();

  assert.deepEqual(
    evidenceSummary.passCases.map(drill => [
      drill.failureMode,
      drill.fallbackReason,
      drill.fallbackCode,
      drill.fallbackPhase,
    ]),
    [
      ['remote-timeout', 'timeout', 'MV_TIMEOUT', 'load'],
      ['network-failure', 'entry_load_failed', 'MV_ENTRY_LOAD_FAILED', 'load'],
      [
        'integrity-mismatch',
        'integrity_mismatch',
        'MV_INTEGRITY_MISMATCH',
        'integrity',
      ],
    ],
  );
});

test('valid pass cases prove affected remote isolation against topology', () => {
  const { evidenceSummary } = loadRemoteFailureDrills();

  assert.deepEqual(
    evidenceSummary.passCases.map(drill => [
      drill.affectedRemoteId,
      drill.affectedRemoteKind,
    ]),
    [
      ['remote-commerce', 'vertical'],
      ['remote-identity', 'vertical'],
      ['remote-design-system', 'horizontal-design-system'],
    ],
  );
  assert.ok(
    evidenceSummary.passCases.every(drill =>
      drill.evidenceRef.startsWith('evidence/wave2/remote-failure/'),
    ),
  );
  assert.ok(
    evidenceSummary.passCases.every(drill =>
      drill.remediationRef.startsWith('runbooks/wave2/'),
    ),
  );
});

test('validator rejects pass case without shell survivability proof', () => {
  const { topology } = loadReferenceTopology();
  const { drills } = loadRemoteFailureDrills();
  const broken = clone(drills);
  broken.passCases[0].expectations.shellSurvives = false;

  assert.throws(
    () => validateRemoteFailureDrills({ drills: broken, topology }),
    /must prove shell survivability/,
  );
});

test('validator rejects pass case without fallback telemetry proof', () => {
  const { topology } = loadReferenceTopology();
  const { drills } = loadRemoteFailureDrills();
  const broken = clone(drills);
  broken.passCases[1].expectations.fallbackTelemetryPresent = false;

  assert.throws(
    () => validateRemoteFailureDrills({ drills: broken, topology }),
    /must include fallback telemetry/,
  );
});

test('validator rejects pass case with missing telemetry payload', () => {
  const { topology } = loadReferenceTopology();
  const { drills } = loadRemoteFailureDrills();
  const broken = clone(drills);
  delete broken.passCases[1].telemetry;

  assert.throws(
    () => validateRemoteFailureDrills({ drills: broken, topology }),
    /telemetry must be an object/,
  );
});

test('validator rejects non-canonical fallback telemetry', () => {
  const { topology } = loadReferenceTopology();
  const { drills } = loadRemoteFailureDrills();
  const broken = clone(drills);
  broken.passCases[2].telemetry.fallback.code = 'WRONG_CODE';

  assert.throws(
    () => validateRemoteFailureDrills({ drills: broken, topology }),
    /telemetry\.fallback\.code must match canonical fallback code/,
  );
});

test('validator rejects non-canonical fallback expectation', () => {
  const { topology } = loadReferenceTopology();
  const { drills } = loadRemoteFailureDrills();
  const broken = clone(drills);
  broken.passCases[0].expectedFallback.reason = 'CUSTOM_TIMEOUT';

  assert.throws(
    () => validateRemoteFailureDrills({ drills: broken, topology }),
    /expectedFallback\.reason must match canonical reason/,
  );
});
