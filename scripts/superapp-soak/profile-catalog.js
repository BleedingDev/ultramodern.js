(function registerSuperAppSoakProfiles(root) {
  const { getScenarioIds } = require('../superapp-k6/scenario-catalog');

  const PROFILE_VERSION = 'superapp-soak-profiles-v1';
  const DEFAULT_PROFILE_ID = 'local-15m';
  const PROFILE_IDS = [
    'local-15m',
    'extended-60m',
    'overnight-2h',
    'overnight-6h',
  ];
  const ENV_NAMES = {
    profile: 'SUPERAPP_SOAK_PROFILE',
    allowOvernight: 'SUPERAPP_SOAK_ALLOW_OVERNIGHT',
    concurrency: 'SUPERAPP_SOAK_CONCURRENCY',
    durationSeconds: 'SUPERAPP_SOAK_DURATION_SECONDS',
    warmupSeconds: 'SUPERAPP_SOAK_WARMUP_SECONDS',
    cooldownSeconds: 'SUPERAPP_SOAK_COOLDOWN_SECONDS',
    scenarioMix: 'SUPERAPP_SOAK_SCENARIO_MIX',
    resetCadenceSeconds: 'SUPERAPP_SOAK_RESET_CADENCE_SECONDS',
    chaosLite: 'SUPERAPP_SOAK_CHAOS_LITE',
  };
  const DURATION_BOUNDS = {
    localMinSeconds: 5 * 60,
    extendedMaxSeconds: 90 * 60,
    overnightMinSeconds: 2 * 60 * 60,
    overnightMaxSeconds: 6 * 60 * 60,
  };
  const VALID_RESET_MODES = new Set([
    'fixed-interval',
    'bounded-cycle',
    'none',
  ]);

  function scenarioMix(entries) {
    return entries.map(([scenarioId, weight]) => ({ scenarioId, weight }));
  }

  function artifactIntent(kind, retention, extraEvidence = []) {
    return {
      kind,
      retention,
      requiredArtifacts: [
        'soak-window-summary.json',
        'soak-error-samples.json',
        'soak-reset-ledger.json',
        ...extraEvidence,
      ],
      summary:
        kind === 'overnight-drift'
          ? 'Long-run stability evidence for memory, latency, handles, resets, chaos-lite recovery, and tenant-boundary drift.'
          : 'Manual soak triage evidence for latency, classified errors, reset success, and tenant-boundary coverage.',
    };
  }

  function resetCadence(mode, everySeconds, jitterPercent, targetScenarioIds) {
    return {
      mode,
      everySeconds,
      jitterPercent,
      targetScenarioIds,
      expectedArtifact: 'soak-reset-ledger.json',
    };
  }

  function tenantBoundaryCoverage(minWeightPercent, sampleStrategy) {
    return {
      required: true,
      scenarioIds: ['tenant-boundary'],
      workloadProfileId: 'tenant-boundary-probes',
      minWeightPercent,
      sampleStrategy,
      expectedProbeCoverage: [
        'security-root-audit-allowed',
        'city-ops-to-security-denied',
        'acme-to-platform-denied',
      ],
    };
  }

  function chaosLite(enabled, maxWeightPercent, targetScenarioIds) {
    return {
      enabled,
      targetScenarioIds,
      maxWeightPercent,
      failureModes: enabled
        ? ['remote-down', 'api-timeout', 'chunk-404', 'clock-skew']
        : [],
      resetAfterChaos: enabled,
      artifactTag: enabled ? 'chaos-lite' : 'chaos-disabled',
    };
  }

  const PROFILES = [
    {
      id: 'local-15m',
      label: 'Local 15 Minute Soak',
      durationSeconds: 15 * 60,
      warmupSeconds: 2 * 60,
      cooldownSeconds: 60,
      manual: false,
      requiresManualOptIn: false,
      defaultPrCost: {
        selectedByDefault: false,
        blocksPullRequest: false,
        reason:
          'Local soak profiles are manually selected and do not run in default PR validation.',
      },
      concurrency: {
        default: 8,
        min: 1,
        max: 16,
      },
      scenarioMix: scenarioMix([
        ['smoke', 10],
        ['mixed-read-write', 35],
        ['chat', 20],
        ['tenant-boundary', 20],
        ['reset', 10],
        ['chaos-triggering', 5],
      ]),
      resetCadence: resetCadence('fixed-interval', 5 * 60, 10, ['reset']),
      chaosLite: chaosLite(true, 5, ['chaos-triggering']),
      tenantBoundaryCoverage: tenantBoundaryCoverage(20, 'all-probes-once'),
      artifactIntent: artifactIntent('local-triage', 'latest-local-run'),
    },
    {
      id: 'extended-60m',
      label: 'Extended 60 Minute Soak',
      durationSeconds: 60 * 60,
      warmupSeconds: 5 * 60,
      cooldownSeconds: 3 * 60,
      manual: false,
      requiresManualOptIn: false,
      defaultPrCost: {
        selectedByDefault: false,
        blocksPullRequest: false,
        reason:
          'Extended soak is an explicit release-candidate/manual profile, not a default PR cost.',
      },
      concurrency: {
        default: 24,
        min: 4,
        max: 64,
      },
      scenarioMix: scenarioMix([
        ['ramp-up', 5],
        ['mixed-read-write', 40],
        ['chat', 20],
        ['tenant-boundary', 20],
        ['reset', 10],
        ['chaos-triggering', 5],
      ]),
      resetCadence: resetCadence('fixed-interval', 10 * 60, 10, ['reset']),
      chaosLite: chaosLite(true, 5, ['chaos-triggering']),
      tenantBoundaryCoverage: tenantBoundaryCoverage(
        20,
        'all-probes-per-window',
      ),
      artifactIntent: artifactIntent('release-candidate', '30-days', [
        'soak-latency-windows.json',
      ]),
    },
    {
      id: 'overnight-2h',
      label: 'Overnight 2 Hour Soak',
      durationSeconds: 2 * 60 * 60,
      warmupSeconds: 10 * 60,
      cooldownSeconds: 5 * 60,
      manual: true,
      requiresManualOptIn: true,
      defaultPrCost: {
        selectedByDefault: false,
        blocksPullRequest: false,
        reason:
          'Overnight soak profiles require SUPERAPP_SOAK_ALLOW_OVERNIGHT=true or an equivalent explicit opt-in.',
      },
      concurrency: {
        default: 32,
        min: 8,
        max: 96,
      },
      scenarioMix: scenarioMix([
        ['ramp-up', 5],
        ['mixed-read-write', 35],
        ['chat', 20],
        ['tenant-boundary', 20],
        ['reset', 10],
        ['chaos-triggering', 10],
      ]),
      resetCadence: resetCadence('bounded-cycle', 15 * 60, 15, ['reset']),
      chaosLite: chaosLite(true, 10, ['chaos-triggering']),
      tenantBoundaryCoverage: tenantBoundaryCoverage(
        20,
        'all-probes-per-reset-cycle',
      ),
      artifactIntent: artifactIntent('overnight-drift', '90-days', [
        'soak-latency-windows.json',
        'soak-resource-windows.json',
      ]),
    },
    {
      id: 'overnight-6h',
      label: 'Overnight 6 Hour Soak',
      durationSeconds: 6 * 60 * 60,
      warmupSeconds: 15 * 60,
      cooldownSeconds: 10 * 60,
      manual: true,
      requiresManualOptIn: true,
      defaultPrCost: {
        selectedByDefault: false,
        blocksPullRequest: false,
        reason:
          'The six-hour soak is reserved for nightly/manual stability proof and never selected by default.',
      },
      concurrency: {
        default: 48,
        min: 8,
        max: 128,
      },
      scenarioMix: scenarioMix([
        ['ramp-up', 5],
        ['spike', 5],
        ['mixed-read-write', 30],
        ['chat', 20],
        ['tenant-boundary', 20],
        ['reset', 10],
        ['chaos-triggering', 10],
      ]),
      resetCadence: resetCadence('bounded-cycle', 20 * 60, 20, ['reset']),
      chaosLite: chaosLite(true, 10, ['chaos-triggering']),
      tenantBoundaryCoverage: tenantBoundaryCoverage(
        20,
        'all-probes-per-reset-cycle',
      ),
      artifactIntent: artifactIntent('overnight-drift', '90-days', [
        'soak-latency-windows.json',
        'soak-resource-windows.json',
        'soak-handle-windows.json',
      ]),
    },
  ];

  const profileById = new Map(PROFILES.map(profile => [profile.id, profile]));

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeProfileId(id) {
    const normalized = String(id || DEFAULT_PROFILE_ID)
      .trim()
      .toLowerCase();
    if (!profileById.has(normalized)) {
      throw new Error(
        `Unknown SuperApp soak profile "${id}". Use one of: ${PROFILE_IDS.join(
          ', ',
        )}`,
      );
    }
    return normalized;
  }

  function parsePositiveInteger(name, value, options = {}) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const parsed = Number(value);
    const minimum = options.min ?? 1;
    if (!Number.isInteger(parsed) || parsed < minimum) {
      throw new Error(`${name} must be an integer >= ${minimum}`);
    }
    if (options.max !== undefined && parsed > options.max) {
      throw new Error(`${name} must be at most ${options.max}`);
    }
    return parsed;
  }

  function parseBoolean(name, value) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
    throw new Error(`${name} must be true or false`);
  }

  function parseScenarioMix(value) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return String(value)
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => {
        const [scenarioId, rawWeight, ...extra] = item.split('=');
        if (!scenarioId || !rawWeight || extra.length > 0) {
          throw new Error(
            `${ENV_NAMES.scenarioMix} entries must use scenario-id=weight`,
          );
        }
        return {
          scenarioId: scenarioId.trim(),
          weight: parsePositiveInteger(ENV_NAMES.scenarioMix, rawWeight),
        };
      });
  }

  function parseSoakProfileEnv(env = process.env) {
    const profileId = normalizeProfileId(env[ENV_NAMES.profile]);
    const allowManualProfile =
      parseBoolean(ENV_NAMES.allowOvernight, env[ENV_NAMES.allowOvernight]) ||
      false;
    const overrides = {};
    const concurrency = parsePositiveInteger(
      ENV_NAMES.concurrency,
      env[ENV_NAMES.concurrency],
    );
    const durationSeconds = parsePositiveInteger(
      ENV_NAMES.durationSeconds,
      env[ENV_NAMES.durationSeconds],
    );
    const warmupSeconds = parsePositiveInteger(
      ENV_NAMES.warmupSeconds,
      env[ENV_NAMES.warmupSeconds],
      { min: 0 },
    );
    const cooldownSeconds = parsePositiveInteger(
      ENV_NAMES.cooldownSeconds,
      env[ENV_NAMES.cooldownSeconds],
      { min: 0 },
    );
    const resetCadenceSeconds = parsePositiveInteger(
      ENV_NAMES.resetCadenceSeconds,
      env[ENV_NAMES.resetCadenceSeconds],
    );
    const scenarioMixOverride = parseScenarioMix(env[ENV_NAMES.scenarioMix]);
    const chaosLiteEnabled = parseBoolean(
      ENV_NAMES.chaosLite,
      env[ENV_NAMES.chaosLite],
    );

    if (concurrency !== undefined) {
      overrides.concurrency = { default: concurrency };
    }
    if (durationSeconds !== undefined) {
      overrides.durationSeconds = durationSeconds;
    }
    if (warmupSeconds !== undefined) {
      overrides.warmupSeconds = warmupSeconds;
    }
    if (cooldownSeconds !== undefined) {
      overrides.cooldownSeconds = cooldownSeconds;
    }
    if (scenarioMixOverride) {
      overrides.scenarioMix = scenarioMixOverride;
    }
    if (resetCadenceSeconds !== undefined) {
      overrides.resetCadence = { everySeconds: resetCadenceSeconds };
    }
    if (chaosLiteEnabled !== undefined) {
      overrides.chaosLite = { enabled: chaosLiteEnabled };
    }

    return {
      profileId,
      allowManualProfile,
      overrides,
    };
  }

  function mergeProfile(profile, overrides = {}) {
    const merged = clone(profile);
    for (const key of [
      'durationSeconds',
      'warmupSeconds',
      'cooldownSeconds',
      'scenarioMix',
    ]) {
      if (overrides[key] !== undefined) {
        merged[key] = clone(overrides[key]);
      }
    }
    if (overrides.concurrency) {
      merged.concurrency = {
        ...merged.concurrency,
        ...clone(overrides.concurrency),
      };
    }
    if (overrides.resetCadence) {
      merged.resetCadence = {
        ...merged.resetCadence,
        ...clone(overrides.resetCadence),
      };
    }
    if (overrides.chaosLite) {
      merged.chaosLite = {
        ...merged.chaosLite,
        ...clone(overrides.chaosLite),
      };
      if (!merged.chaosLite.enabled) {
        merged.chaosLite.failureModes = [];
        merged.chaosLite.resetAfterChaos = false;
        merged.chaosLite.artifactTag = 'chaos-disabled';
      }
    }
    return merged;
  }

  function scenarioWeight(profile, scenarioId) {
    return profile.scenarioMix
      .filter(item => item.scenarioId === scenarioId)
      .reduce((sum, item) => sum + item.weight, 0);
  }

  function validateProfile(profile, availableScenarioIds = getScenarioIds()) {
    const errors = [];
    const scenarioIds = new Set(availableScenarioIds);
    const mixIds = new Set();
    const scenarioTotal = profile.scenarioMix.reduce(
      (sum, entry) => sum + entry.weight,
      0,
    );

    if (!PROFILE_IDS.includes(profile.id)) {
      errors.push(`${profile.id} is not listed in PROFILE_IDS`);
    }
    if (
      !Number.isInteger(profile.durationSeconds) ||
      profile.durationSeconds < DURATION_BOUNDS.localMinSeconds
    ) {
      errors.push(`${profile.id} duration must be at least 5 minutes`);
    }
    if (profile.manual) {
      if (
        profile.durationSeconds < DURATION_BOUNDS.overnightMinSeconds ||
        profile.durationSeconds > DURATION_BOUNDS.overnightMaxSeconds
      ) {
        errors.push(
          `${profile.id} overnight duration must be between 2 and 6 hours`,
        );
      }
      if (profile.requiresManualOptIn !== true) {
        errors.push(`${profile.id} overnight profile must require opt-in`);
      }
    } else if (profile.durationSeconds > DURATION_BOUNDS.extendedMaxSeconds) {
      errors.push(`${profile.id} non-overnight duration is too expensive`);
    }
    if (
      !Number.isInteger(profile.warmupSeconds) ||
      profile.warmupSeconds < 0 ||
      !Number.isInteger(profile.cooldownSeconds) ||
      profile.cooldownSeconds < 0 ||
      profile.warmupSeconds + profile.cooldownSeconds >= profile.durationSeconds
    ) {
      errors.push(
        `${profile.id} warmup and cooldown must be non-negative and shorter than duration`,
      );
    }
    if (
      !Number.isInteger(profile.concurrency.default) ||
      profile.concurrency.default <= 0 ||
      !Number.isInteger(profile.concurrency.min) ||
      profile.concurrency.min <= 0 ||
      !Number.isInteger(profile.concurrency.max) ||
      profile.concurrency.max < profile.concurrency.min ||
      profile.concurrency.default < profile.concurrency.min ||
      profile.concurrency.default > profile.concurrency.max
    ) {
      errors.push(`${profile.id} concurrency bounds are invalid`);
    }
    if (scenarioTotal !== 100) {
      errors.push(`${profile.id} scenario weights must sum to 100`);
    }
    for (const entry of profile.scenarioMix) {
      if (mixIds.has(entry.scenarioId)) {
        errors.push(`${profile.id} has duplicate scenario ${entry.scenarioId}`);
      }
      mixIds.add(entry.scenarioId);
      if (!scenarioIds.has(entry.scenarioId)) {
        errors.push(
          `${profile.id} references unknown scenario ${entry.scenarioId}`,
        );
      }
      if (!Number.isInteger(entry.weight) || entry.weight <= 0) {
        errors.push(
          `${profile.id}:${entry.scenarioId} must have a positive integer weight`,
        );
      }
    }
    if (!VALID_RESET_MODES.has(profile.resetCadence.mode)) {
      errors.push(`${profile.id} reset cadence mode is invalid`);
    }
    if (
      profile.resetCadence.mode !== 'none' &&
      (!Number.isInteger(profile.resetCadence.everySeconds) ||
        profile.resetCadence.everySeconds <= 0 ||
        profile.resetCadence.everySeconds >= profile.durationSeconds)
    ) {
      errors.push(`${profile.id} reset cadence must be within duration`);
    }
    if (
      !Number.isInteger(profile.resetCadence.jitterPercent) ||
      profile.resetCadence.jitterPercent < 0 ||
      profile.resetCadence.jitterPercent > 50
    ) {
      errors.push(`${profile.id} reset cadence jitter must be 0-50 percent`);
    }
    for (const scenarioId of profile.resetCadence.targetScenarioIds) {
      if (!mixIds.has(scenarioId)) {
        errors.push(
          `${profile.id} reset cadence references scenario outside mix: ${scenarioId}`,
        );
      }
    }
    if (profile.chaosLite.enabled) {
      const chaosWeight = profile.chaosLite.targetScenarioIds.reduce(
        (sum, scenarioId) => sum + scenarioWeight(profile, scenarioId),
        0,
      );
      if (chaosWeight <= 0) {
        errors.push(`${profile.id} chaos-lite must participate in the mix`);
      }
      if (chaosWeight > profile.chaosLite.maxWeightPercent) {
        errors.push(`${profile.id} chaos-lite exceeds configured max weight`);
      }
    }
    if (profile.tenantBoundaryCoverage.required) {
      const tenantWeight = profile.tenantBoundaryCoverage.scenarioIds.reduce(
        (sum, scenarioId) => sum + scenarioWeight(profile, scenarioId),
        0,
      );
      if (tenantWeight < profile.tenantBoundaryCoverage.minWeightPercent) {
        errors.push(`${profile.id} tenant-boundary coverage is too low`);
      }
    }
    if (
      !profile.artifactIntent ||
      !Array.isArray(profile.artifactIntent.requiredArtifacts) ||
      profile.artifactIntent.requiredArtifacts.length === 0
    ) {
      errors.push(`${profile.id} must declare artifact intent`);
    }
    if (errors.length > 0) {
      throw new Error(
        `Invalid SuperApp soak profile ${profile.id}:\n${errors.join('\n')}`,
      );
    }
    return true;
  }

  function validateSoakProfileCatalog(profiles = PROFILES) {
    const ids = profiles.map(profile => profile.id);
    const errors = [];
    if (ids.length !== new Set(ids).size) {
      errors.push('SuperApp soak profile ids must be unique');
    }
    if (PROFILE_IDS.length !== profiles.length) {
      errors.push('PROFILE_IDS must cover every SuperApp soak profile');
    }
    for (const id of PROFILE_IDS) {
      if (!ids.includes(id)) {
        errors.push(`Missing SuperApp soak profile ${id}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `Invalid SuperApp soak profile catalog:\n${errors.join('\n')}`,
      );
    }
    for (const profile of profiles) {
      validateProfile(profile);
    }
    return true;
  }

  function getSoakProfileCatalog() {
    return clone({
      profileVersion: PROFILE_VERSION,
      defaultProfileId: DEFAULT_PROFILE_ID,
      profileIds: PROFILE_IDS,
      env: ENV_NAMES,
      durationBounds: DURATION_BOUNDS,
      profiles: PROFILES,
    });
  }

  function getSoakProfileDefinition(id) {
    return clone(profileById.get(normalizeProfileId(id)));
  }

  function resolveSoakProfile(id = DEFAULT_PROFILE_ID, options = {}) {
    const profile = mergeProfile(
      profileById.get(normalizeProfileId(id)),
      options.overrides,
    );
    if (profile.requiresManualOptIn && options.allowManualProfile !== true) {
      throw new Error(
        `${profile.id} is an overnight soak profile and requires explicit manual opt-in`,
      );
    }
    validateProfile(profile);
    return profile;
  }

  function resolveSoakProfileFromEnv(env = process.env) {
    const selection = parseSoakProfileEnv(env);
    return resolveSoakProfile(selection.profileId, {
      allowManualProfile: selection.allowManualProfile,
      overrides: selection.overrides,
    });
  }

  const api = {
    DEFAULT_PROFILE_ID,
    DURATION_BOUNDS,
    ENV_NAMES,
    PROFILE_IDS,
    PROFILE_VERSION,
    getSoakProfileCatalog,
    getSoakProfileDefinition,
    normalizeProfileId,
    parseScenarioMix,
    parseSoakProfileEnv,
    resolveSoakProfile,
    resolveSoakProfileFromEnv,
    validateProfile,
    validateSoakProfileCatalog,
  };

  root.SUPERAPP_SOAK_PROFILE_CATALOG = getSoakProfileCatalog();
  root.SUPERAPP_SOAK_PROFILE_API = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
