const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ENVIRONMENT_ORDER,
  MAX_PERCENTAGE_JUMP,
  loadRolloutStrategy,
  validateRolloutStrategy,
} = require('../rollout-strategy');

const clone = value => JSON.parse(JSON.stringify(value));

test('loads progressive rollout strategy evidence by vertical and environment', () => {
  const { strategy, evidenceSummary } = loadRolloutStrategy();

  assert.equal(strategy.schemaVersion, 1);
  assert.equal(
    evidenceSummary.strategyId,
    'wave3-progressive-production-rollout',
  );
  assert.deepEqual(evidenceSummary.environmentOrder, ENVIRONMENT_ORDER);
  assert.equal(evidenceSummary.maxPercentageJump, MAX_PERCENTAGE_JUMP);
  assert.deepEqual(
    evidenceSummary.verticals.map(vertical => vertical.verticalId),
    ['remote-commerce', 'remote-identity'],
  );
  assert.deepEqual(evidenceSummary.verticals[0].environments, [
    'development',
    'staging',
    'canary',
    'production',
  ]);
  assert.deepEqual(
    evidenceSummary.verticals[0].gates.map(gate => gate.percentage),
    [10, 25, 50, 100],
  );
  assert.equal(evidenceSummary.verticals[0].finalPercentage, 100);
});

test('summary carries hold windows, SLO evidence, kill switches, and approvals', () => {
  const { evidenceSummary } = loadRolloutStrategy();
  const commerceProduction = evidenceSummary.verticals[0].gates.find(
    gate => gate.environment === 'production',
  );

  assert.equal(commerceProduction.holdWindow, 'P1D');
  assert.deepEqual(commerceProduction.sloChecks, [
    'client-error-rate',
    'checkout-p95-latency-ms',
  ]);
  assert.equal(
    commerceProduction.killSwitchFlag,
    'mv.wave3.remote-commerce.disable',
  );
  assert.deepEqual(commerceProduction.approvalOwners, [
    'commerce-experience',
    'super-app-platform',
    'production-readiness-council',
  ]);
});

test('validator rejects unsafe percentage jumps', () => {
  const { strategy } = loadRolloutStrategy();
  const broken = clone(strategy);
  broken.verticals[0].gates[2].percentage = 90;

  assert.throws(
    () => validateRolloutStrategy(broken),
    /gates\[2\]\.percentage jump from 25 to 90 exceeds 50/,
  );
});

test('validator rejects missing signed manifest enforcement', () => {
  const { strategy } = loadRolloutStrategy();
  const broken = clone(strategy);
  broken.verticals[0].gates[3].signedManifest.enforced = false;

  assert.throws(
    () => validateRolloutStrategy(broken),
    /gates\[3\]\.signedManifest\.enforced must be true/,
  );
});

test('validator rejects missing rollback trigger', () => {
  const { strategy } = loadRolloutStrategy();
  const broken = clone(strategy);
  broken.verticals[0].gates[3].rollbackTriggers = [];

  assert.throws(
    () => validateRolloutStrategy(broken),
    /gates\[3\]\.rollbackTriggers must not be empty/,
  );
});

test('validator rejects missing kill-switch availability', () => {
  const { strategy } = loadRolloutStrategy();
  const broken = clone(strategy);
  broken.verticals[0].gates[3].killSwitch.available = false;

  assert.throws(
    () => validateRolloutStrategy(broken),
    /gates\[3\]\.killSwitch\.available must be true/,
  );
});

test('validator rejects missing approval evidence', () => {
  const { strategy } = loadRolloutStrategy();
  const broken = clone(strategy);
  broken.verticals[0].gates[3].approvals = [];

  assert.throws(
    () => validateRolloutStrategy(broken),
    /gates\[3\]\.approvals must not be empty/,
  );
});

test('validator rejects missing SLO evidence', () => {
  const { strategy } = loadRolloutStrategy();
  const broken = clone(strategy);
  broken.verticals[0].gates[3].sloChecks = [];

  assert.throws(
    () => validateRolloutStrategy(broken),
    /gates\[3\]\.sloChecks must not be empty/,
  );
});
