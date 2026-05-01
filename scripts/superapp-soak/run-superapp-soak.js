#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

const {
  getScenarioDefinition,
  selectWeightedOperation,
} = require('../superapp-k6/scenario-catalog');
const {
  writeArtifactSummary,
} = require('../superapp-certification/artifact-schema');
const {
  DEFAULT_WINDOW_MS,
  classifySoakError,
  createSoakMetricsArtifact,
  createSoakWindowSummary,
} = require('./metrics-windows');
const { analyzeSoakDrift } = require('./drift-detectors');
const {
  DEFAULT_PROFILE_ID,
  ENV_NAMES,
  parseScenarioMix,
  resolveSoakProfile,
} = require('./profile-catalog');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_OUTPUT_ROOT = '.modern/superapp-soak';
const DEFAULT_TARGET = 'superapp';
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_OPERATION_INTERVAL_MS = 1_000;
const DEFAULT_MAX_ERROR_SAMPLES = 100;
const REQUIRED_WORKLOAD_CLASSES = [
  'normal-read',
  'write-heavy',
  'chat',
  'reset',
  'chaos-lite',
  'tenant-boundary',
];

const usage = () => `
Usage:
  node scripts/superapp-soak/run-superapp-soak.js [options]

Options:
  --dry-run, --plan                 Materialize the selected soak plan without network.
  --profile <id>                    Soak profile. Env: ${ENV_NAMES.profile}. Default: ${DEFAULT_PROFILE_ID}
  --allow-overnight                 Permit overnight profiles. Env: ${ENV_NAMES.allowOvernight}=true
  --base-url <url>                  SuperApp origin. Env: SUPERAPP_SOAK_BASE_URL. Default: ${DEFAULT_BASE_URL}
  --duration-seconds <n>            Runner duration override for short deterministic runs.
  --warmup-seconds <n>              Runner warmup override. Use 0 for short tests.
  --cooldown-seconds <n>            Runner cooldown override. Use 0 for short tests.
  --concurrency <n>                 Runner concurrency override.
  --scenario-mix <id=weight,...>    Scenario mix override. Env: ${ENV_NAMES.scenarioMix}
  --reset-cadence-seconds <n>       Reset cadence override.
  --chaos-lite <true|false>         Enable or disable chaos-lite participation.
  --max-operations <n>              Cap total operations for smoke/mock validation.
  --operation-interval-ms <n>       Delay between worker operations. Default: ${DEFAULT_OPERATION_INTERVAL_MS}
  --request-timeout-ms <n>          Per-request timeout. Default: ${DEFAULT_REQUEST_TIMEOUT_MS}
  --window-ms <n>                   Metrics window size. Default: ${DEFAULT_WINDOW_MS}
  --run-id <id>                     Artifact run id.
  --output-dir <path>               Artifact directory. Default: ${DEFAULT_OUTPUT_ROOT}/<run-id>
  --target <name>                   Artifact target. Default: ${DEFAULT_TARGET}
  --help                            Show this help.

Examples:
  node scripts/superapp-soak/run-superapp-soak.js --dry-run --profile local-15m
  node scripts/superapp-soak/run-superapp-soak.js --base-url http://localhost:8080 --duration-seconds 10 --warmup-seconds 0 --cooldown-seconds 0 --concurrency 2 --max-operations 24
`;

function parseArgs(argv, env = process.env) {
  const parsed = {
    dryRun: false,
    profileId: env[ENV_NAMES.profile] || DEFAULT_PROFILE_ID,
    allowManualProfile: parseBoolean(env[ENV_NAMES.allowOvernight]) || false,
    baseUrl: env.SUPERAPP_SOAK_BASE_URL || DEFAULT_BASE_URL,
    durationSeconds: parseOptionalPositiveInt(env[ENV_NAMES.durationSeconds]),
    warmupSeconds: parseOptionalNonNegativeInt(env[ENV_NAMES.warmupSeconds]),
    cooldownSeconds: parseOptionalNonNegativeInt(
      env[ENV_NAMES.cooldownSeconds],
    ),
    concurrency: parseOptionalPositiveInt(env[ENV_NAMES.concurrency]),
    scenarioMix: parseScenarioMix(env[ENV_NAMES.scenarioMix]),
    resetCadenceSeconds: parseOptionalPositiveInt(
      env[ENV_NAMES.resetCadenceSeconds],
    ),
    chaosLite: parseBoolean(env[ENV_NAMES.chaosLite]),
    maxOperations: parseOptionalPositiveInt(env.SUPERAPP_SOAK_MAX_OPERATIONS),
    operationIntervalMs:
      parseOptionalNonNegativeInt(env.SUPERAPP_SOAK_OPERATION_INTERVAL_MS) ??
      DEFAULT_OPERATION_INTERVAL_MS,
    requestTimeoutMs:
      parseOptionalPositiveInt(env.SUPERAPP_SOAK_REQUEST_TIMEOUT_MS) ??
      DEFAULT_REQUEST_TIMEOUT_MS,
    windowMs:
      parseOptionalPositiveInt(env.SUPERAPP_SOAK_WINDOW_MS) ??
      DEFAULT_WINDOW_MS,
    runId:
      env.SUPERAPP_SOAK_RUN_ID ||
      `superapp-soak-${new Date().toISOString()}-${process.pid}`,
    outputDir: env.SUPERAPP_SOAK_OUTPUT_DIR,
    target: env.SUPERAPP_SOAK_TARGET || DEFAULT_TARGET,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--dry-run':
      case '--plan':
        parsed.dryRun = true;
        break;
      case '--profile':
        parsed.profileId = requireValue(argv, ++index, arg);
        break;
      case '--allow-overnight':
        parsed.allowManualProfile = true;
        break;
      case '--base-url':
        parsed.baseUrl = requireValue(argv, ++index, arg);
        break;
      case '--duration-seconds':
        parsed.durationSeconds = requirePositiveInt(argv, ++index, arg);
        break;
      case '--warmup-seconds':
        parsed.warmupSeconds = requireNonNegativeInt(argv, ++index, arg);
        break;
      case '--cooldown-seconds':
        parsed.cooldownSeconds = requireNonNegativeInt(argv, ++index, arg);
        break;
      case '--concurrency':
        parsed.concurrency = requirePositiveInt(argv, ++index, arg);
        break;
      case '--scenario-mix':
        parsed.scenarioMix = parseScenarioMix(requireValue(argv, ++index, arg));
        break;
      case '--reset-cadence-seconds':
        parsed.resetCadenceSeconds = requirePositiveInt(argv, ++index, arg);
        break;
      case '--chaos-lite':
        parsed.chaosLite = requireBoolean(argv, ++index, arg);
        break;
      case '--max-operations':
        parsed.maxOperations = requirePositiveInt(argv, ++index, arg);
        break;
      case '--operation-interval-ms':
        parsed.operationIntervalMs = requireNonNegativeInt(argv, ++index, arg);
        break;
      case '--request-timeout-ms':
        parsed.requestTimeoutMs = requirePositiveInt(argv, ++index, arg);
        break;
      case '--window-ms':
        parsed.windowMs = requirePositiveInt(argv, ++index, arg);
        break;
      case '--run-id':
        parsed.runId = requireValue(argv, ++index, arg);
        break;
      case '--output-dir':
        parsed.outputDir = requireValue(argv, ++index, arg);
        break;
      case '--target':
        parsed.target = requireValue(argv, ++index, arg);
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown SuperApp soak runner option: ${arg}`);
    }
  }

  parsed.baseUrl = normalizeBaseUrl(parsed.baseUrl);
  parsed.outputDir = path.resolve(
    REPO_ROOT,
    parsed.outputDir || path.join(DEFAULT_OUTPUT_ROOT, parsed.runId),
  );
  return parsed;
}

function resolveRunnerProfile(options) {
  const profileOverrides = {};
  if (options.concurrency !== undefined) {
    profileOverrides.concurrency = { default: options.concurrency };
  }
  if (options.scenarioMix !== undefined) {
    profileOverrides.scenarioMix = options.scenarioMix;
  }
  if (options.chaosLite !== undefined) {
    profileOverrides.chaosLite = { enabled: options.chaosLite };
  }

  const profile = resolveSoakProfile(options.profileId, {
    allowManualProfile: options.allowManualProfile,
    overrides: profileOverrides,
  });

  if (options.durationSeconds !== undefined) {
    profile.durationSeconds = options.durationSeconds;
  }
  if (options.warmupSeconds !== undefined) {
    profile.warmupSeconds = options.warmupSeconds;
  }
  if (options.cooldownSeconds !== undefined) {
    profile.cooldownSeconds = options.cooldownSeconds;
  }
  if (options.resetCadenceSeconds !== undefined) {
    profile.resetCadence.everySeconds = options.resetCadenceSeconds;
  }
  if (
    profile.warmupSeconds + profile.cooldownSeconds >=
    profile.durationSeconds
  ) {
    throw new Error(
      `${profile.id} runner warmup and cooldown must be shorter than duration`,
    );
  }
  return profile;
}

function buildSoakPlan(options) {
  const profile = resolveRunnerProfile(options);
  const artifactPaths = buildArtifactPaths(options.outputDir);
  const scenarioPlans = profile.scenarioMix.map((entry, scenarioIndex) => {
    const scenario = getScenarioDefinition(entry.scenarioId);
    return {
      id: scenario.id,
      label: scenario.label,
      weight: entry.weight,
      operationMix: scenario.operationMix,
      operations: scenario.operations.map((operation, operationIndex) =>
        materializeOperation({
          baseUrl: options.baseUrl,
          operation,
          operationIndex,
          scenarioId: scenario.id,
          iteration: scenarioIndex * 100 + operationIndex,
          profileId: profile.id,
          runId: options.runId,
        }),
      ),
    };
  });
  const expectedOperationClasses = [
    ...new Set(
      scenarioPlans.flatMap(scenario =>
        scenario.operations.flatMap(operation => operation.workloadClasses),
      ),
    ),
  ].sort();
  const missingWorkloadClasses = REQUIRED_WORKLOAD_CLASSES.filter(
    workloadClass => !expectedOperationClasses.includes(workloadClass),
  );

  return {
    schemaVersion: 'superapp-soak-plan-v1',
    runId: options.runId,
    target: options.target,
    baseUrl: options.baseUrl,
    mode: options.dryRun ? 'dry-run' : 'run',
    profile: {
      id: profile.id,
      label: profile.label,
      durationSeconds: profile.durationSeconds,
      warmupSeconds: profile.warmupSeconds,
      cooldownSeconds: profile.cooldownSeconds,
      concurrency: profile.concurrency.default,
      manual: profile.manual,
      defaultPrCost: profile.defaultPrCost,
    },
    scenarioMix: profile.scenarioMix,
    selectedScenarios: profile.scenarioMix.map(entry => entry.scenarioId),
    expectedOperationClasses,
    missingWorkloadClasses,
    resetCadence: profile.resetCadence,
    chaosLite: profile.chaosLite,
    tenantBoundaryCoverage: profile.tenantBoundaryCoverage,
    artifactPaths,
    scenarioPlans,
  };
}

function materializeOperation(input) {
  const requestId = [
    input.runId,
    input.scenarioId,
    input.operation.id,
    String(input.iteration).padStart(6, '0'),
  ].join(':');
  const headers = {
    ...(input.operation.headers || {}),
    'x-superapp-soak-run-id': input.runId,
    'x-superapp-soak-profile': input.profileId,
    'x-superapp-soak-scenario': input.scenarioId,
    'x-superapp-soak-operation': input.operation.id,
    'x-superapp-soak-request-id': requestId,
  };
  const body = buildBody(input.operation, requestId);

  return {
    id: input.operation.id,
    scenarioId: input.scenarioId,
    kind: input.operation.kind || 'read',
    method: input.operation.method,
    path: input.operation.path,
    url: new URL(input.operation.path, input.baseUrl).toString(),
    headers,
    body,
    expectedStatus: input.operation.expectedStatus || [200],
    workloadProfileId: input.operation.workloadProfileId,
    workloadClasses: classifyWorkloadClasses(input.scenarioId, input.operation),
    tenantBoundaryProbeId: input.operation.tenantBoundaryProbeId,
    expectedAllowed: input.operation.expectedAllowed,
    chaosMode: input.operation.chaosMode || body?.chaos,
    requestId,
  };
}

async function runSoak(options = {}) {
  const plan = buildSoakPlan(options);
  fs.mkdirSync(options.outputDir, { recursive: true });
  writeJson(plan.artifactPaths.plan, plan);
  if (options.dryRun) {
    return {
      status: 'planned',
      plan,
      artifactPaths: plan.artifactPaths,
    };
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const profile = resolveRunnerProfile(options);
  const events = {
    samples: [],
    requestEvents: [],
    resetEvents: [],
    errorEvents: [],
  };
  const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
  eventLoopMonitor.enable();

  try {
    await delay(profile.warmupSeconds * 1000);
    events.samples.push(collectResourceSample(startedAtMs, eventLoopMonitor));
    await runWorkers({
      events,
      eventLoopMonitor,
      options,
      plan,
      profile,
      startedAtMs,
    });
    await delay(profile.cooldownSeconds * 1000);
    events.samples.push(collectResourceSample(startedAtMs, eventLoopMonitor));
  } finally {
    eventLoopMonitor.disable();
  }

  const finishedAtMs = Date.now();
  const finishedAt = new Date(finishedAtMs).toISOString();
  const durationMs = Math.max(0, finishedAtMs - startedAtMs);
  const metricsEvents = {
    samples: events.samples,
    requestEvents: events.requestEvents,
    resetEvents: events.resetEvents,
    errorEvents: events.errorEvents,
  };
  const summary = createSoakWindowSummary(metricsEvents, {
    durationMs,
    startedAt,
    windowMs: options.windowMs,
  });
  const errorSamples = collectErrorSamples(events).slice(
    0,
    DEFAULT_MAX_ERROR_SAMPLES,
  );
  const drift = analyzeSoakDrift(summary, { profile });
  const status = deriveRunStatus(errorSamples);
  const artifact = createSoakMetricsArtifact({
    ...metricsEvents,
    artifacts: [
      { path: plan.artifactPaths.plan, kind: 'plan' },
      { path: plan.artifactPaths.windowSummary, kind: 'window-summary' },
      { path: plan.artifactPaths.errorSamples, kind: 'error-samples' },
      { path: plan.artifactPaths.resetLedger, kind: 'reset-ledger' },
    ],
    detail: {
      runner: {
        status,
        baseUrl: options.baseUrl,
        maxOperations: options.maxOperations,
        operationIntervalMs: options.operationIntervalMs,
        requestTimeoutMs: options.requestTimeoutMs,
        expectedOperationClasses: plan.expectedOperationClasses,
        missingWorkloadClasses: plan.missingWorkloadClasses,
      },
      drift,
    },
    durationMs,
    finishedAt,
    parameters: {
      baseUrl: options.baseUrl,
      concurrency: profile.concurrency.default,
      durationSeconds: profile.durationSeconds,
      scenarioMix: profile.scenarioMix,
      chaosLite: profile.chaosLite,
      resetCadence: profile.resetCadence,
    },
    profile: profile.id,
    startedAt,
    status,
    target: options.target,
    windowMs: options.windowMs,
    warnings:
      status === 'warning'
        ? ['Chaos-lite requests produced classified failures.']
        : [],
    budgetFailures:
      status === 'failed'
        ? ['One or more non-chaos soak requests failed.']
        : [],
  });

  writeJson(plan.artifactPaths.windowSummary, summary);
  writeJson(plan.artifactPaths.errorSamples, {
    schemaVersion: 'superapp-soak-error-samples-v1',
    maxSamples: DEFAULT_MAX_ERROR_SAMPLES,
    samples: errorSamples,
  });
  writeJson(plan.artifactPaths.resetLedger, summary.resetLedger);
  writeArtifactSummary(plan.artifactPaths.summary, artifact);

  return {
    artifact,
    artifactPaths: plan.artifactPaths,
    plan,
    status,
    summary,
  };
}

async function runWorkers(input) {
  let operationIndex = 0;
  let nextResetAtMs =
    input.profile.resetCadence.mode === 'none'
      ? Number.POSITIVE_INFINITY
      : input.startedAtMs + input.profile.resetCadence.everySeconds * 1000;
  const activeDurationMs =
    (input.profile.durationSeconds -
      input.profile.warmupSeconds -
      input.profile.cooldownSeconds) *
    1000;
  const deadlineMs = Date.now() + activeDurationMs;

  async function worker(workerId) {
    while (Date.now() < deadlineMs) {
      const currentIndex = operationIndex;
      if (
        input.options.maxOperations !== undefined &&
        currentIndex >= input.options.maxOperations
      ) {
        break;
      }
      operationIndex += 1;

      let scenarioId;
      if (Date.now() >= nextResetAtMs) {
        scenarioId = selectResetScenario(input.profile);
        nextResetAtMs += input.profile.resetCadence.everySeconds * 1000;
      } else {
        scenarioId = selectWeightedScenarioId(input.profile, currentIndex);
      }
      const scenario = getScenarioDefinition(scenarioId);
      const operation = selectWeightedOperation(scenario, currentIndex * 17);
      const materialized = materializeOperation({
        baseUrl: input.options.baseUrl,
        operation,
        operationIndex: currentIndex,
        scenarioId,
        iteration: currentIndex,
        profileId: input.profile.id,
        runId: input.options.runId,
      });

      await executeOperation({
        events: input.events,
        materialized,
        requestTimeoutMs: input.options.requestTimeoutMs,
        startedAtMs: input.startedAtMs,
      });

      input.events.samples.push(
        collectResourceSample(input.startedAtMs, input.eventLoopMonitor),
      );
      if (input.options.operationIntervalMs > 0) {
        await delay(input.options.operationIntervalMs);
      }
    }
  }

  await Promise.all(
    Array.from({ length: input.profile.concurrency.default }, (_, workerId) =>
      worker(workerId),
    ),
  );
}

async function executeOperation(input) {
  const started = performance.now();
  const requestInit = {
    headers: input.materialized.headers,
    method: input.materialized.method,
    signal: AbortSignal.timeout(input.requestTimeoutMs),
  };
  if (
    input.materialized.body !== undefined &&
    input.materialized.method !== 'GET'
  ) {
    requestInit.body = JSON.stringify(input.materialized.body);
  }

  let event;
  try {
    const response = await fetch(input.materialized.url, requestInit);
    await response.arrayBuffer();
    const durationMs = Math.round(performance.now() - started);
    const ok = input.materialized.expectedStatus.includes(response.status);
    event = {
      elapsedMs: Date.now() - input.startedAtMs,
      durationMs,
      method: input.materialized.method,
      operationId: input.materialized.id,
      path: input.materialized.path,
      scenarioId: input.materialized.scenarioId,
      status: response.status,
      ok,
      workloadClasses: input.materialized.workloadClasses,
    };
    if (!ok) {
      event.error = {
        class: classifyOperationErrorClass(input.materialized, response.status),
        status: response.status,
        scenarioId: input.materialized.scenarioId,
      };
    }
  } catch (error) {
    event = {
      elapsedMs: Date.now() - input.startedAtMs,
      durationMs: Math.round(performance.now() - started),
      method: input.materialized.method,
      operationId: input.materialized.id,
      path: input.materialized.path,
      scenarioId: input.materialized.scenarioId,
      ok: false,
      error: {
        class: classifyOperationErrorClass(input.materialized),
        message: error.message,
        scenarioId: input.materialized.scenarioId,
      },
      workloadClasses: input.materialized.workloadClasses,
    };
  }

  input.events.requestEvents.push(event);
  if (input.materialized.kind === 'reset') {
    input.events.resetEvents.push({
      durationMs: event.durationMs,
      elapsedMs: event.elapsedMs,
      id: input.materialized.requestId,
      ok: event.ok,
      scenarioId: input.materialized.scenarioId,
    });
  }
}

function collectErrorSamples(events) {
  return [
    ...events.errorEvents.map(event => ({
      ...event,
      class: classifySoakError(event.error || event),
      source: event.source || 'runner',
    })),
    ...events.requestEvents
      .filter(event => !event.ok)
      .map(event => ({
        ...event,
        class: classifySoakError(event.error || event),
        source: 'request',
      })),
  ];
}

function selectWeightedScenarioId(profile, iteration) {
  const totalWeight = profile.scenarioMix.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );
  const cursor = ((Math.abs(iteration) * 37) % totalWeight) + 1;
  let floor = 0;
  for (const entry of profile.scenarioMix) {
    floor += entry.weight;
    if (cursor <= floor) {
      return entry.scenarioId;
    }
  }
  return profile.scenarioMix.at(-1).scenarioId;
}

function selectResetScenario(profile) {
  const target = profile.resetCadence.targetScenarioIds.find(scenarioId =>
    profile.scenarioMix.some(entry => entry.scenarioId === scenarioId),
  );
  return target || 'reset';
}

function buildBody(operation, requestId) {
  if (operation.bodyTemplate) {
    return replaceTemplateValues(operation.bodyTemplate, { requestId });
  }
  if (operation.resetSeed) {
    return {
      requestId,
      resetSeed: operation.resetSeed,
    };
  }
  if (operation.method !== 'GET') {
    return { requestId };
  }
  return undefined;
}

function replaceTemplateValues(value, replacements) {
  if (Array.isArray(value)) {
    return value.map(item => replaceTemplateValues(item, replacements));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceTemplateValues(item, replacements),
      ]),
    );
  }
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => replacements[key] || '');
  }
  return value;
}

function classifyWorkloadClasses(scenarioId, operation) {
  const classes = new Set();
  if (operation.kind === 'read' || operation.method === 'GET') {
    classes.add('normal-read');
  }
  if (
    operation.kind === 'write' ||
    operation.workloadProfileId === 'write-heavy-order-ledger'
  ) {
    classes.add('write-heavy');
  }
  if (
    scenarioId === 'chat' ||
    operation.workloadProfileId === 'chat-pagination-history'
  ) {
    classes.add('chat');
  }
  if (operation.kind === 'reset' || scenarioId === 'reset') {
    classes.add('reset');
  }
  if (operation.kind === 'chaos' || scenarioId === 'chaos-triggering') {
    classes.add('chaos-lite');
  }
  if (operation.kind === 'tenant-probe' || scenarioId === 'tenant-boundary') {
    classes.add('tenant-boundary');
  }
  return [...classes].sort();
}

function classifyOperationErrorClass(operation, status) {
  if (operation.workloadClasses.includes('chaos-lite')) {
    return 'chaos-lite';
  }
  if (operation.workloadClasses.includes('tenant-boundary')) {
    return 'tenant-boundary';
  }
  if (operation.workloadClasses.includes('reset')) {
    return 'reset';
  }
  if (Number(status) >= 400) {
    return 'http-status';
  }
  return 'network';
}

function collectResourceSample(startedAtMs, eventLoopMonitor) {
  const memory = process.memoryUsage();
  return {
    elapsedMs: Date.now() - startedAtMs,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
    },
    eventLoopDelay: {
      minMs: nanosecondsToMilliseconds(eventLoopMonitor.min),
      maxMs: nanosecondsToMilliseconds(eventLoopMonitor.max),
      meanMs: nanosecondsToMilliseconds(eventLoopMonitor.mean),
      p95Ms: nanosecondsToMilliseconds(eventLoopMonitor.percentile(95)),
      p99Ms: nanosecondsToMilliseconds(eventLoopMonitor.percentile(99)),
    },
    openHandles:
      typeof process._getActiveHandles === 'function'
        ? process._getActiveHandles().length
        : undefined,
  };
}

function deriveRunStatus(errorEvents) {
  if (errorEvents.length === 0) {
    return 'passed';
  }
  if (
    errorEvents.every(
      event => classifySoakError(event.error || event) === 'chaos-lite',
    )
  ) {
    return 'warning';
  }
  return 'failed';
}

function buildArtifactPaths(outputDir) {
  return {
    plan: path.join(outputDir, 'soak-plan.json'),
    summary: path.join(outputDir, 'summary.json'),
    windowSummary: path.join(outputDir, 'soak-window-summary.json'),
    errorSamples: path.join(outputDir, 'soak-error-samples.json'),
    resetLedger: path.join(outputDir, 'soak-reset-ledger.json'),
  };
}

function writeJson(outputPath, value) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function delay(ms) {
  if (!ms) {
    return Promise.resolve();
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function nanosecondsToMilliseconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.round((number / 1_000_000) * 1_000_000) / 1_000_000;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requirePositiveInt(argv, index, flag) {
  return parsePositiveInt(flag, requireValue(argv, index, flag));
}

function requireNonNegativeInt(argv, index, flag) {
  return parseNonNegativeInt(flag, requireValue(argv, index, flag));
}

function requireBoolean(argv, index, flag) {
  const parsed = parseBoolean(requireValue(argv, index, flag));
  if (parsed === undefined) {
    throw new Error(`${flag} requires true or false`);
  }
  return parsed;
}

function parseOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return parsePositiveInt('value', value);
}

function parseOptionalNonNegativeInt(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return parseNonNegativeInt('value', value);
}

function parsePositiveInt(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseBoolean(value) {
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
  throw new Error(`Expected boolean value, received ${value}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const result = await runSoak(options);
  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPaths: result.artifactPaths,
        mode: options.dryRun ? 'dry-run' : 'run',
        profile: result.plan.profile.id,
        runId: options.runId,
        status: result.status,
      },
      null,
      2,
    )}\n`,
  );
  if (result.status === 'failed') {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  REQUIRED_WORKLOAD_CLASSES,
  buildSoakPlan,
  classifyWorkloadClasses,
  materializeOperation,
  parseArgs,
  resolveRunnerProfile,
  runSoak,
};
