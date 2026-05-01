const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REQUIRED_SCENARIO_IDS,
  buildK6OptionsForScenarios,
  getLoadThresholdProfileDefinition,
  getLoadThresholdProfiles,
  getScenarioCatalog,
  getScenarioDefinition,
  getScenarioIdsForThresholdProfile,
  getScenarioIds,
  normalizeScenarioSelection,
  selectWeightedOperation,
  validateScenarioCatalog,
} = require('../scenario-catalog');

test('catalog contains every ust-load-02 scenario with valid operation metadata', () => {
  const catalog = getScenarioCatalog();

  assert.equal(validateScenarioCatalog(catalog), true);
  assert.deepEqual(getScenarioIds(), REQUIRED_SCENARIO_IDS);

  for (const scenario of catalog.scenarios) {
    assert.ok(scenario.k6.executor, `${scenario.id} should declare executor`);
    assert.ok(
      scenario.k6.duration ||
        scenario.k6.maxDuration ||
        Array.isArray(scenario.k6.stages),
      `${scenario.id} should declare duration metadata`,
    );

    for (const operation of scenario.operations) {
      assert.match(operation.method, /^(GET|POST)$/);
      assert.match(operation.path, /^\//);
      assert.equal(typeof operation.weight, 'number');
      assert.ok(operation.artifactLinkIds.length > 0);
    }
  }
});

test('built-in k6 options expose only selected scenario execution config', () => {
  const options = buildK6OptionsForScenarios(['smoke', 'chat']);

  assert.deepEqual(Object.keys(options.scenarios), ['smoke', 'chat']);
  assert.equal(options.scenarios.smoke.exec, 'workload');
  assert.equal(options.scenarios.chat.tags.superapp_scenario, 'chat');
  assert.equal(options.thresholds, undefined);
  assert.equal(options.ext.superapp.thresholdProfile.id, 'smoke');
  assert.equal(
    options.ext.superapp.thresholdProfile.defaultPrCost
      .addsLoadToSmokeCertification,
    false,
  );
});

test('release and nightly threshold profiles add k6 thresholds without changing smoke defaults', () => {
  const profiles = getLoadThresholdProfiles();
  const release = buildK6OptionsForScenarios(
    getScenarioIdsForThresholdProfile('release'),
    'release',
  );
  const nightly = buildK6OptionsForScenarios(
    getScenarioIdsForThresholdProfile('nightly'),
    'nightly',
  );

  assert.deepEqual(
    profiles.profiles.map(profile => profile.id),
    ['smoke', 'release', 'nightly'],
  );
  assert.deepEqual(getScenarioIdsForThresholdProfile('release'), [
    'smoke',
    'ramp-up',
    'mixed-read-write',
    'tenant-boundary',
    'chat',
    'reset',
  ]);
  assert.deepEqual(getScenarioIdsForThresholdProfile('nightly'), [
    ...REQUIRED_SCENARIO_IDS,
  ]);
  assert.deepEqual(release.thresholds.http_req_failed, ['rate<0.01']);
  assert.deepEqual(nightly.thresholds.http_req_failed, ['rate<0.005']);
  assert.equal(
    getLoadThresholdProfileDefinition('release').defaultPrCost
      .addsLoadToSmokeCertification,
    false,
  );
  assert.equal(
    getLoadThresholdProfileDefinition('nightly').defaultPrCost
      .addsLoadToSmokeCertification,
    false,
  );
});

test('all selection expands deterministically in catalog order', () => {
  assert.deepEqual(normalizeScenarioSelection('all'), REQUIRED_SCENARIO_IDS);
});

test('tenant-boundary scenario carries security probes and reset seed references stay named', () => {
  const tenantBoundary = getScenarioDefinition('tenant-boundary');
  const reset = getScenarioDefinition('reset');
  const probeIds = tenantBoundary.operations.map(
    operation => operation.tenantBoundaryProbeId,
  );

  assert.ok(probeIds.includes('security-root-audit-allowed'));
  assert.ok(probeIds.includes('city-ops-to-security-denied'));
  assert.ok(probeIds.includes('acme-to-platform-denied'));
  assert.deepEqual(
    tenantBoundary.operations.find(
      operation =>
        operation.tenantBoundaryProbeId === 'security-root-audit-allowed',
    ).expectedStatus,
    [200],
  );
  assert.deepEqual(
    tenantBoundary.operations.find(
      operation =>
        operation.tenantBoundaryProbeId === 'city-ops-to-security-denied',
    ).expectedStatus,
    [200, 403, 500],
  );
  assert.equal(
    reset.operations[0].resetSeed.seed,
    'superapp-portfolio-reset-seed-v1',
  );
});

test('weighted operation selection is deterministic', () => {
  const smoke = getScenarioDefinition('smoke');

  assert.equal(selectWeightedOperation(smoke, 0).id, 'bootstrap');
  assert.equal(selectWeightedOperation(smoke, 69).id, 'bootstrap');
  assert.equal(selectWeightedOperation(smoke, 70).id, 'root-route');
  assert.equal(selectWeightedOperation(smoke, 90).id, 'smoke-workflow-marker');
});
