const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REQUIRED_SCENARIO_IDS,
  buildK6OptionsForScenarios,
  getScenarioCatalog,
  getScenarioDefinition,
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
