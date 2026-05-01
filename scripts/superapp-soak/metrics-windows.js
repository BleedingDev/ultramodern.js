const {
  createArtifactEnvelope,
} = require('../superapp-certification/artifact-schema');

const SOAK_METRICS_SCHEMA_VERSION = 'superapp-soak-metrics-v1';
const DEFAULT_WINDOW_MS = 60_000;
const SOAK_ERROR_CLASSES = [
  'timeout',
  'http-status',
  'network',
  'schema',
  'tenant-boundary',
  'reset',
  'chaos-lite',
  'unknown',
];

function createSoakMetricsTracker(options = {}) {
  const clock = options.clock || (() => Date.now());
  const startedAtMs = resolveStartMs(options) ?? clock();
  const samples = [];
  const requestEvents = [];
  const resetEvents = [];
  const errorEvents = [];

  function elapsedMs(value) {
    if (value !== undefined) {
      return toNonNegativeNumber(value);
    }
    return Math.max(0, clock() - startedAtMs);
  }

  function recordSample(sample = {}) {
    samples.push({
      ...sample,
      elapsedMs: elapsedMs(sample.elapsedMs),
    });
  }

  function recordRequest(event = {}) {
    requestEvents.push({
      ...event,
      elapsedMs: elapsedMs(event.elapsedMs),
    });
  }

  function recordReset(event = {}) {
    resetEvents.push({
      ...event,
      elapsedMs: elapsedMs(event.elapsedMs),
    });
  }

  function recordError(error, event = {}) {
    errorEvents.push({
      ...event,
      elapsedMs: elapsedMs(event.elapsedMs),
      error,
      class: classifySoakError(error),
    });
  }

  function summarize(extra = {}) {
    return createSoakWindowSummary(
      {
        samples,
        requestEvents,
        resetEvents,
        errorEvents,
      },
      {
        startedAtMs,
        windowMs: options.windowMs,
        ...extra,
      },
    );
  }

  return {
    recordError,
    recordRequest,
    recordReset,
    recordSample,
    summarize,
  };
}

function createSoakMetricsArtifact(input = {}) {
  const summary = createSoakWindowSummary(
    {
      samples: input.samples,
      requestEvents: input.requestEvents,
      resetEvents: input.resetEvents,
      errorEvents: input.errorEvents,
    },
    {
      durationMs: input.durationMs,
      startedAt: input.startedAt,
      windowMs: input.windowMs,
    },
  );

  return createArtifactEnvelope({
    suite: 'superapp-soak',
    target: input.target || 'superapp',
    profile: input.profile || 'unknown',
    status: input.status || 'unknown',
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    dimensions: ['soak', 'performance'],
    parameters: {
      windowMs: summary.windowMs,
      profileId: input.profile,
      ...input.parameters,
    },
    warnings: input.warnings,
    budgetFailures: input.budgetFailures,
    unknowns: input.unknowns,
    observations: input.observations,
    artifacts: input.artifacts,
    metrics: {
      schemaVersion: SOAK_METRICS_SCHEMA_VERSION,
      totals: summary.totals,
      windows: summary.windows,
    },
    detail: {
      schemaVersion: SOAK_METRICS_SCHEMA_VERSION,
      errorClasses: SOAK_ERROR_CLASSES,
      resetLedger: summary.resetLedger,
      ...input.detail,
    },
  });
}

function createSoakWindowSummary(input = {}, options = {}) {
  const windowMs = positiveInteger(options.windowMs || DEFAULT_WINDOW_MS);
  const samples = normalizeSamples(input.samples, options);
  const requestEvents = normalizeEvents(input.requestEvents, options);
  const resetEvents = normalizeEvents(input.resetEvents, options);
  const explicitErrorEvents = normalizeEvents(input.errorEvents, options);
  const requestErrorEvents = requestEvents
    .filter(event => !isSuccessfulRequest(event))
    .map(event => ({
      ...event,
      class: classifySoakError(event.error || event),
    }));
  const resetErrorEvents = resetEvents
    .filter(event => event.ok === false || event.success === false)
    .map(event => ({
      ...event,
      class: 'reset',
    }));
  const errorEvents = [
    ...explicitErrorEvents.map(event => ({
      ...event,
      class: normalizeErrorClass(event.class || classifySoakError(event.error)),
    })),
    ...requestErrorEvents,
    ...resetErrorEvents,
  ];
  const maxElapsedMs = maxElapsed(
    samples,
    requestEvents,
    resetEvents,
    errorEvents,
    options.durationMs,
  );
  const windowCount =
    maxElapsedMs === 0 ? 1 : Math.max(1, Math.ceil(maxElapsedMs / windowMs));
  const windows = Array.from({ length: windowCount }, (_, index) => {
    const windowStartMs = index * windowMs;
    const windowEndMs = windowStartMs + windowMs;
    const windowSamples = withinWindow(samples, windowStartMs, windowEndMs);
    const windowRequests = withinWindow(
      requestEvents,
      windowStartMs,
      windowEndMs,
    );
    const windowResets = withinWindow(resetEvents, windowStartMs, windowEndMs);
    const windowErrors = withinWindow(errorEvents, windowStartMs, windowEndMs);

    return {
      id: makeWindowId(index, windowStartMs, windowEndMs),
      index,
      startedOffsetMs: windowStartMs,
      endedOffsetMs: windowEndMs,
      sampleCount: windowSamples.length,
      memory: summarizeMemory(windowSamples),
      eventLoopDelay: summarizeEventLoopDelay(windowSamples),
      openHandles: summarizeSignal(windowSamples.map(readOpenHandleCount)),
      requests: summarizeRequests(windowRequests, windowMs),
      latency: summarizeLatency(windowRequests),
      resets: summarizeResetEvents(windowResets),
      errors: summarizeErrors(windowErrors, windowRequests.length),
    };
  });

  return {
    schemaVersion: SOAK_METRICS_SCHEMA_VERSION,
    windowMs,
    durationMs: Math.max(maxElapsedMs, windowMs),
    errorClasses: SOAK_ERROR_CLASSES,
    totals: summarizeTotals({
      samples,
      requestEvents,
      resetEvents,
      errorEvents,
      durationMs: Math.max(maxElapsedMs, windowMs),
    }),
    resetLedger: createResetLedger(resetEvents),
    windows,
  };
}

function classifySoakError(error) {
  if (!error) {
    return 'unknown';
  }
  if (typeof error === 'object') {
    const explicit = error.class || error.errorClass || error.category;
    if (explicit) {
      return normalizeErrorClass(explicit);
    }
    if (
      error.reset ||
      error.phase === 'reset' ||
      error.scenarioId === 'reset'
    ) {
      return 'reset';
    }
    if (
      error.chaosLite ||
      error.phase === 'chaos-lite' ||
      error.scenarioId === 'chaos-triggering'
    ) {
      return 'chaos-lite';
    }
    if (error.tenantBoundary || error.scenarioId === 'tenant-boundary') {
      return 'tenant-boundary';
    }
    if (Number(error.status || error.statusCode || error.httpStatus) >= 400) {
      return 'http-status';
    }
  }

  const value =
    error instanceof Error
      ? `${error.name}:${error.message}`
      : typeof error === 'object'
        ? JSON.stringify(error)
        : String(error);

  if (/tenant|cross[-\s]?tenant|boundary|authorization/i.test(value)) {
    return 'tenant-boundary';
  }
  if (/chaos|remote-down|chunk-404|clock-skew|api-timeout/i.test(value)) {
    return 'chaos-lite';
  }
  if (/timeout|timed out|AbortError|ETIMEDOUT/i.test(value)) {
    return 'timeout';
  }
  if (/schema|validation|zod|contract mismatch|invalid shape/i.test(value)) {
    return 'schema';
  }
  if (
    /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|fetch failed|network/i.test(
      value,
    )
  ) {
    return 'network';
  }
  if (/reset|restore|fixture/i.test(value)) {
    return 'reset';
  }
  if (/status\s*[=:]?\s*[4-5]\d\d|HTTP\s*[4-5]\d\d/i.test(value)) {
    return 'http-status';
  }
  return 'unknown';
}

function createResetLedger(resetEvents = []) {
  const events = normalizeEvents(resetEvents);
  const attempts = events.length;
  const succeeded = events.filter(isSuccessfulReset).length;
  const failed = attempts - succeeded;

  return {
    attempts,
    succeeded,
    failed,
    successRate: ratio(succeeded, attempts),
    firstAttemptOffsetMs:
      attempts === 0
        ? undefined
        : Math.min(...events.map(event => event.elapsedMs)),
    lastAttemptOffsetMs:
      attempts === 0
        ? undefined
        : Math.max(...events.map(event => event.elapsedMs)),
    entries: events.map((event, index) => ({
      id: event.id || `reset-${String(index + 1).padStart(4, '0')}`,
      offsetMs: event.elapsedMs,
      ok: isSuccessfulReset(event),
      durationMs: toNonNegativeNumber(event.durationMs),
      scenarioId: event.scenarioId || 'reset',
      errorClass: !isSuccessfulReset(event)
        ? classifySoakError({ ...event, class: 'reset' })
        : undefined,
    })),
  };
}

function summarizeTotals(input) {
  return {
    sampleCount: input.samples.length,
    memory: summarizeMemory(input.samples),
    eventLoopDelay: summarizeEventLoopDelay(input.samples),
    openHandles: summarizeSignal(input.samples.map(readOpenHandleCount)),
    requests: summarizeRequests(input.requestEvents, input.durationMs),
    latency: summarizeLatency(input.requestEvents),
    resets: summarizeResetEvents(input.resetEvents),
    errors: summarizeErrors(input.errorEvents, input.requestEvents.length),
  };
}

function summarizeMemory(samples) {
  return {
    rss: summarizeSignal(samples.map(sample => sample.memory?.rss)),
    heapUsed: summarizeSignal(samples.map(sample => sample.memory?.heapUsed)),
    heapTotal: summarizeSignal(samples.map(sample => sample.memory?.heapTotal)),
  };
}

function summarizeEventLoopDelay(samples) {
  const delays = samples.map(sample => sample.eventLoopDelay || {});
  return {
    minMs: min(delays.map(delay => delay.minMs)),
    maxMs: max(delays.map(delay => delay.maxMs)),
    meanMs: mean(delays.map(delay => delay.meanMs)),
    p95Ms: percentile(
      delays.map(delay => delay.p95Ms),
      95,
    ),
    p99Ms: percentile(
      delays.map(delay => delay.p99Ms),
      99,
    ),
  };
}

function summarizeRequests(events, durationMs) {
  const total = events.length;
  const failed = events.filter(event => !isSuccessfulRequest(event)).length;
  const ok = total - failed;
  return {
    total,
    ok,
    failed,
    throughputPerSecond: ratio(total, durationMs / 1000),
  };
}

function summarizeLatency(events) {
  const durations = events.map(event => event.durationMs);
  return {
    count: durations.filter(isFiniteNumber).length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: max(durations),
  };
}

function summarizeResetEvents(events) {
  const attempts = events.length;
  const succeeded = events.filter(isSuccessfulReset).length;
  const failed = attempts - succeeded;
  return {
    attempts,
    succeeded,
    failed,
    successRate: ratio(succeeded, attempts),
  };
}

function summarizeErrors(events, requestCount) {
  const byClass = Object.fromEntries(
    SOAK_ERROR_CLASSES.map(errorClass => [
      errorClass,
      {
        count: 0,
        rate: 0,
      },
    ]),
  );
  for (const event of events) {
    const errorClass = normalizeErrorClass(
      event.class || classifySoakError(event),
    );
    byClass[errorClass].count += 1;
  }
  for (const errorClass of SOAK_ERROR_CLASSES) {
    byClass[errorClass].rate = ratio(byClass[errorClass].count, requestCount);
  }
  const total = events.length;
  return {
    total,
    rate: ratio(total, requestCount),
    byClass,
  };
}

function summarizeSignal(values) {
  const normalized = values.filter(isFiniteNumber);
  if (normalized.length === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      first: 0,
      last: 0,
      delta: 0,
    };
  }
  const first = normalized[0];
  const last = normalized.at(-1);
  return {
    min: Math.min(...normalized),
    max: Math.max(...normalized),
    mean: mean(normalized),
    first,
    last,
    delta: last - first,
  };
}

function normalizeSamples(samples = [], options = {}) {
  return samples.map((sample, index) => ({
    ...sample,
    elapsedMs: resolveElapsedMs(sample, index, options),
  }));
}

function normalizeEvents(events = [], options = {}) {
  return events.map((event, index) => ({
    ...event,
    elapsedMs: resolveElapsedMs(event, index, options),
    durationMs: toNonNegativeNumber(event.durationMs),
  }));
}

function resolveElapsedMs(item, index, options = {}) {
  if (item.elapsedMs !== undefined) {
    return toNonNegativeNumber(item.elapsedMs);
  }
  const itemTime = parseTimestampMs(
    item.sampledAt || item.startedAt || item.at,
  );
  const startTime = resolveStartMs(options);
  if (itemTime !== undefined && startTime !== undefined) {
    return Math.max(0, itemTime - startTime);
  }
  return index;
}

function resolveStartMs(options = {}) {
  if (options.startedAtMs !== undefined) {
    return Number(options.startedAtMs);
  }
  return parseTimestampMs(options.startedAt);
}

function parseTimestampMs(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withinWindow(events, startMs, endMs) {
  return events.filter(
    event => event.elapsedMs >= startMs && event.elapsedMs < endMs,
  );
}

function maxElapsed(...groups) {
  const values = groups.flatMap(group => {
    if (Array.isArray(group)) {
      return group.map(item => item.elapsedMs);
    }
    return [group];
  });
  return Math.max(0, ...values.filter(isFiniteNumber));
}

function readOpenHandleCount(sample) {
  return sample.openHandles ?? sample.activeHandles;
}

function isSuccessfulRequest(event) {
  if (event.ok === false || event.success === false) {
    return false;
  }
  if (event.error) {
    return false;
  }
  const status = Number(event.status || event.statusCode || event.httpStatus);
  return !(Number.isFinite(status) && status >= 400);
}

function isSuccessfulReset(event) {
  return event.ok !== false && event.success !== false;
}

function percentile(values, percentileValue) {
  const sorted = values
    .filter(isFiniteNumber)
    .sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function min(values) {
  const normalized = values.filter(isFiniteNumber);
  return normalized.length === 0 ? 0 : Math.min(...normalized);
}

function max(values) {
  const normalized = values.filter(isFiniteNumber);
  return normalized.length === 0 ? 0 : Math.max(...normalized);
}

function mean(values) {
  const normalized = values.filter(isFiniteNumber);
  if (normalized.length === 0) {
    return 0;
  }
  return roundMetric(
    normalized.reduce((sum, value) => sum + value, 0) / normalized.length,
  );
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return roundMetric(numerator / denominator);
}

function roundMetric(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error('Soak metrics windowMs must be a positive integer');
  }
  return number;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeErrorClass(value) {
  const normalized = String(value || 'unknown')
    .trim()
    .toLowerCase();
  if (SOAK_ERROR_CLASSES.includes(normalized)) {
    return normalized;
  }
  if (normalized === 'transport') {
    return 'network';
  }
  if (normalized === 'contract-4xx' || normalized === 'server-5xx') {
    return 'http-status';
  }
  return 'unknown';
}

function makeWindowId(index, startMs, endMs) {
  return `window-${String(index).padStart(4, '0')}-${String(startMs).padStart(
    9,
    '0',
  )}-${String(endMs).padStart(9, '0')}`;
}

module.exports = {
  DEFAULT_WINDOW_MS,
  SOAK_ERROR_CLASSES,
  SOAK_METRICS_SCHEMA_VERSION,
  classifySoakError,
  createResetLedger,
  createSoakMetricsArtifact,
  createSoakMetricsTracker,
  createSoakWindowSummary,
  percentile,
};
