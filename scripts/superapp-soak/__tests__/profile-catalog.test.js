const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_PROFILE_ID,
  ENV_NAMES,
  PROFILE_IDS,
  getSoakProfileCatalog,
  getSoakProfileDefinition,
  parseScenarioMix,
  parseSoakProfileEnv,
  resolveSoakProfile,
  resolveSoakProfileFromEnv,
  validateProfile,
  validateSoakProfileCatalog,
} = require('../profile-catalog');

test('catalog exposes deterministic soak profile coverage', () => {
  const catalog = getSoakProfileCatalog();

  assert.equal(validateSoakProfileCatalog(catalog.profiles), true);
  assert.equal(catalog.defaultProfileId, DEFAULT_PROFILE_ID);
  assert.deepEqual(catalog.profileIds, [
    'local-15m',
    'extended-60m',
    'overnight-2h',
    'overnight-6h',
  ]);
  assert.deepEqual(PROFILE_IDS, catalog.profileIds);

  for (const profile of catalog.profiles) {
    assert.ok(profile.durationSeconds > 0);
    assert.ok(profile.concurrency.default > 0);
    assert.equal(
      profile.scenarioMix.reduce((sum, item) => sum + item.weight, 0),
      100,
    );
    assert.ok(profile.tenantBoundaryCoverage.required);
    assert.ok(profile.artifactIntent.requiredArtifacts.length > 0);
  }
});

test('local and extended profiles are explicit but not overnight gated', () => {
  const local = resolveSoakProfile('local-15m');
  const extended = resolveSoakProfile('extended-60m');

  assert.equal(local.durationSeconds, 15 * 60);
  assert.equal(local.concurrency.default, 8);
  assert.equal(local.requiresManualOptIn, false);
  assert.equal(extended.durationSeconds, 60 * 60);
  assert.equal(extended.concurrency.default, 24);
  assert.equal(extended.requiresManualOptIn, false);
});

test('overnight profiles require manual opt-in and cover two-to-six hour bounds', () => {
  assert.throws(
    () => resolveSoakProfile('overnight-2h'),
    /requires explicit manual opt-in/,
  );
  assert.throws(
    () => resolveSoakProfile('overnight-6h'),
    /requires explicit manual opt-in/,
  );

  const twoHour = resolveSoakProfile('overnight-2h', {
    allowManualProfile: true,
  });
  const sixHour = resolveSoakProfile('overnight-6h', {
    allowManualProfile: true,
  });

  assert.equal(twoHour.durationSeconds, 2 * 60 * 60);
  assert.equal(sixHour.durationSeconds, 6 * 60 * 60);
  assert.equal(twoHour.manual, true);
  assert.equal(sixHour.manual, true);
});

test('overrides can tune concurrency, duration, reset cadence, chaos-lite, and mix', () => {
  const resolved = resolveSoakProfile('local-15m', {
    overrides: {
      concurrency: { default: 4 },
      durationSeconds: 20 * 60,
      resetCadence: { everySeconds: 4 * 60 },
      chaosLite: { enabled: false },
      scenarioMix: [
        { scenarioId: 'smoke', weight: 20 },
        { scenarioId: 'mixed-read-write', weight: 30 },
        { scenarioId: 'chat', weight: 20 },
        { scenarioId: 'tenant-boundary', weight: 20 },
        { scenarioId: 'reset', weight: 10 },
      ],
    },
  });

  assert.equal(resolved.concurrency.default, 4);
  assert.equal(resolved.durationSeconds, 20 * 60);
  assert.equal(resolved.resetCadence.everySeconds, 4 * 60);
  assert.equal(resolved.chaosLite.enabled, false);
  assert.deepEqual(resolved.chaosLite.failureModes, []);
});

test('environment parsing resolves manual overnight profiles only with opt-in', () => {
  const selection = parseSoakProfileEnv({
    [ENV_NAMES.profile]: 'extended-60m',
    [ENV_NAMES.concurrency]: '12',
    [ENV_NAMES.durationSeconds]: '3600',
    [ENV_NAMES.warmupSeconds]: '0',
    [ENV_NAMES.cooldownSeconds]: '0',
    [ENV_NAMES.scenarioMix]:
      'smoke=10,mixed-read-write=35,chat=20,tenant-boundary=20,reset=10,chaos-triggering=5',
  });

  assert.equal(selection.profileId, 'extended-60m');
  assert.equal(selection.overrides.concurrency.default, 12);
  assert.equal(selection.overrides.durationSeconds, 3600);
  assert.equal(selection.overrides.warmupSeconds, 0);
  assert.equal(selection.overrides.cooldownSeconds, 0);
  assert.equal(selection.overrides.scenarioMix.length, 6);

  assert.throws(
    () =>
      resolveSoakProfileFromEnv({
        [ENV_NAMES.profile]: 'overnight-2h',
      }),
    /requires explicit manual opt-in/,
  );

  assert.equal(
    resolveSoakProfileFromEnv({
      [ENV_NAMES.profile]: 'overnight-2h',
      [ENV_NAMES.allowOvernight]: 'true',
    }).id,
    'overnight-2h',
  );
});

test('validation rejects duplicate ids, invalid weights, bad concurrency, and unsafe overnight profiles', () => {
  assert.throws(
    () => validateSoakProfileCatalog([getSoakProfileDefinition('local-15m')]),
    /PROFILE_IDS must cover every SuperApp soak profile/,
  );

  const badWeights = getSoakProfileDefinition('local-15m');
  badWeights.scenarioMix[0].weight = 11;
  assert.throws(
    () => validateProfile(badWeights),
    /scenario weights must sum to 100/,
  );

  const badConcurrency = getSoakProfileDefinition('local-15m');
  badConcurrency.concurrency.default = 0;
  assert.throws(
    () => validateProfile(badConcurrency),
    /concurrency bounds are invalid/,
  );

  const badOvernight = getSoakProfileDefinition('overnight-2h');
  badOvernight.requiresManualOptIn = false;
  assert.throws(
    () => validateProfile(badOvernight),
    /overnight profile must require opt-in/,
  );
});

test('scenario mix parser requires explicit scenario-id equals weight entries', () => {
  assert.deepEqual(parseScenarioMix('smoke=25,tenant-boundary=75'), [
    { scenarioId: 'smoke', weight: 25 },
    { scenarioId: 'tenant-boundary', weight: 75 },
  ]);

  assert.throws(
    () => parseScenarioMix('smoke:25'),
    /entries must use scenario-id=weight/,
  );
});
