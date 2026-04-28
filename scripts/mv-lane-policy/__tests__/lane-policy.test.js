const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_POLICY_PATH,
  loadLanePolicy,
  readJsonFile,
  validateLaneDefinitionsAgainstPolicy,
  validateLanePolicy,
  validatePolicyShape,
} = require('../validator');

const fixturesDir = path.resolve(__dirname, '../__fixtures__');
const readFixture = name =>
  readJsonFile(path.join(fixturesDir, `${name}.json`)).laneDefinitions;

const clone = value => JSON.parse(JSON.stringify(value));

test('lane policy validates its embedded lane definitions', () => {
  const { policy, summary } = loadLanePolicy();

  assert.equal(policy.name, 'mv-golden-compat-experimental-lane-policy');
  assert.equal(summary.laneCount, 3);
  assert.equal(summary.productionDefaultLane, 'golden-mf-tanstack-effect');
  assert.deepEqual(
    summary.lanes.map(lane => `${lane.tier}:${lane.id}`),
    [
      'golden:golden-mf-tanstack-effect',
      'compat:compat-garfish-react-router-hono',
      'experimental:experimental-mf-react-router-effect',
    ],
  );
});

test('fixture lane definitions validate against the policy', () => {
  const policy = readJsonFile(DEFAULT_POLICY_PATH);
  const summary = validateLaneDefinitionsAgainstPolicy({
    policy,
    lanes: readFixture('valid-lanes'),
  });

  assert.equal(summary.laneCount, 3);
  assert.equal(summary.productionDefaultLane, 'golden-mf-tanstack-effect');
});

test('validator rejects unsupported runtime/router/service combinations', () => {
  const policy = readJsonFile(DEFAULT_POLICY_PATH);

  assert.throws(
    () =>
      validateLaneDefinitionsAgainstPolicy({
        policy,
        lanes: readFixture('unsupported-combination'),
      }),
    /unsupported golden combination garfish\/react-router\/hono/,
  );
});

test('validator rejects under-gated golden lanes', () => {
  const policy = readJsonFile(DEFAULT_POLICY_PATH);

  assert.throws(
    () =>
      validateLaneDefinitionsAgainstPolicy({
        policy,
        lanes: readFixture('under-gated-golden'),
      }),
    /missing required gate "production-rollout"/,
  );
});

test('validator rejects under-evidenced lanes before production default checks', () => {
  const policy = readJsonFile(DEFAULT_POLICY_PATH);

  assert.throws(
    () =>
      validateLaneDefinitionsAgainstPolicy({
        policy,
        lanes: readFixture('under-evidenced-experimental'),
      }),
    /missing required evidence "fallback-telemetry-sample"/,
  );
});

test('validator rejects an experimental lane without explicit opt-in', () => {
  const policy = readJsonFile(DEFAULT_POLICY_PATH);
  const lanes = readFixture('valid-lanes');
  lanes[2].explicitOptIn = false;

  assert.throws(
    () => validateLaneDefinitionsAgainstPolicy({ policy, lanes }),
    /explicitOptIn must be true for experimental/,
  );
});

test('validator rejects more than one production default lane', () => {
  const policy = readJsonFile(DEFAULT_POLICY_PATH);
  const lanes = readFixture('valid-lanes');
  const secondGolden = clone(lanes[0]);
  secondGolden.id = 'golden-mf-tanstack-effect-secondary';
  lanes.push(secondGolden);

  assert.throws(
    () => validateLaneDefinitionsAgainstPolicy({ policy, lanes }),
    /exactly one production default lane/,
  );
});

test('policy promotion and demotion rules reference known catalogs', () => {
  const policy = readJsonFile(DEFAULT_POLICY_PATH);
  const brokenPromotion = clone(policy);
  brokenPromotion.promotionRules[0].requiredSignals.push('unknown-signal');

  assert.throws(
    () => validatePolicyShape(brokenPromotion),
    /unknown promotion signal "unknown-signal"/,
  );

  const brokenDemotion = clone(policy);
  brokenDemotion.demotionRules[0].triggers.push('unknown-trigger');

  assert.throws(
    () => validatePolicyShape(brokenDemotion),
    /unknown demotion trigger "unknown-trigger"/,
  );
});

test('validator rejects duplicate embedded lane IDs', () => {
  const policy = readJsonFile(DEFAULT_POLICY_PATH);
  const broken = clone(policy);
  broken.laneDefinitions[1].id = broken.laneDefinitions[0].id;

  assert.throws(
    () => validateLanePolicy(broken),
    /duplicate id "golden-mf-tanstack-effect"/,
  );
});

test('policy file remains valid JSON', () => {
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(DEFAULT_POLICY_PATH)));
});
