const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadCiHardeningProfile,
  readJsonFile,
  validateCiHardeningProfile,
} = require('../validator');

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../__fixtures__/valid-profile.json',
);

const clone = value => JSON.parse(JSON.stringify(value));

const loadFixture = () => readJsonFile(FIXTURE_PATH);

test('loads tier budget profile and summarizes checks by tier', () => {
  const { profile, evidenceSummary } = loadCiHardeningProfile(FIXTURE_PATH);

  assert.equal(profile.schemaVersion, 1);
  assert.equal(evidenceSummary.name, 'mv-ci-tier-budgets-fixture');
  assert.equal(evidenceSummary.checkCount, 3);
  assert.deepEqual(Object.keys(evidenceSummary.tiers), [
    'golden',
    'compat',
    'experimental',
  ]);
  assert.deepEqual(evidenceSummary.checksByTier.golden, {
    checkCount: 1,
    runtimeBudgetMinutes: 40,
    flakeWaiverCount: 0,
  });
  assert.deepEqual(evidenceSummary.checksByTier.compat, {
    checkCount: 1,
    runtimeBudgetMinutes: 24,
    flakeWaiverCount: 1,
  });
});

test('default profile validates without network or package scripts', () => {
  const { evidenceSummary } = loadCiHardeningProfile();

  assert.equal(evidenceSummary.name, 'mv-ci-tier-budgets-and-flake-policy');
  assert.equal(evidenceSummary.checksByTier.golden.checkCount, 1);
  assert.equal(evidenceSummary.checksByTier.compat.flakeWaiverCount, 0);
  assert.equal(evidenceSummary.checks[1].retryAttempts, 1);
  assert.equal(evidenceSummary.checksByTier.experimental.checkCount, 1);
});

test('rejects over-budget tier runtime', () => {
  const profile = loadFixture();
  profile.checks[0].runtimeBudgetMinutes = 46;

  assert.throws(
    () => validateCiHardeningProfile(profile),
    /runtimeBudgetMinutes exceeds golden maxRuntimeMinutes 45/,
  );
});

test('rejects over-budget tier timeout', () => {
  const profile = loadFixture();
  profile.checks[2].timeoutMinutes = 13;

  assert.throws(
    () => validateCiHardeningProfile(profile),
    /timeoutMinutes exceeds experimental maxTimeoutMinutes 12/,
  );
});

test('rejects stale flake waivers', () => {
  const profile = loadFixture();
  profile.checks[1].flakeWaivers[0].expiresOn = '2026-04-27';

  assert.throws(
    () => validateCiHardeningProfile(profile),
    /flakeWaivers\[0\]\.expiresOn is stale/,
  );
});

test('rejects flake waivers older than policy duration', () => {
  const profile = loadFixture();
  profile.checks[1].flakeWaivers[0].expiresOn = '2026-05-20';

  assert.throws(
    () => validateCiHardeningProfile(profile),
    /duration 22 days exceeds maxFlakeWaiverDays 14/,
  );
});

test('rejects checks with missing owners', () => {
  const profile = loadFixture();
  profile.checks[0].owner = '';

  assert.throws(
    () => validateCiHardeningProfile(profile),
    /profile\.checks\[0\]\.owner must be a non-empty string/,
  );
});

test('rejects placeholder owners', () => {
  const profile = loadFixture();
  profile.checks[0].owner = 'TBD';

  assert.throws(
    () => validateCiHardeningProfile(profile),
    /owner must not use placeholder value/,
  );
});

test('rejects retry without tracked issue', () => {
  const profile = loadFixture();
  delete profile.checks[1].retryPolicy.issueRef;

  assert.throws(
    () => validateCiHardeningProfile(profile),
    /retryPolicy\.issueRef must be a non-empty string/,
  );
});

test('rejects retry with untracked issue reference', () => {
  const profile = loadFixture();
  profile.checks[1].retryPolicy.issueRef = 'local-note-only';

  assert.throws(
    () => validateCiHardeningProfile(profile),
    /must reference a bead or GitHub issue/,
  );
});

test('rejects golden flake waivers', () => {
  const profile = loadFixture();
  profile.checks[0].flakeWaivers = [clone(profile.checks[1].flakeWaivers[0])];
  profile.checks[0].flakeWaivers[0].owner = 'super-app-platform';

  assert.throws(
    () => validateCiHardeningProfile(profile),
    /flakeWaivers exceeds golden maxFlakeWaivers 0/,
  );
});
