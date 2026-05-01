const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SOAK_ERROR_CLASSES,
  createSoakMetricsArtifact,
} = require('../metrics-windows');
const {
  SOAK_DRIFT_SCHEMA_VERSION,
  analyzeSoakDrift,
  resolveDriftThresholds,
} = require('../drift-detectors');

const mib = 1024 * 1024;

test('stable soak windows pass memory, latency, error, reset, and handle detectors', () => {
  const drift = analyzeSoakDrift(stableSummary(), {
    profile: stableProfile(),
  });

  assert.equal(drift.schemaVersion, SOAK_DRIFT_SCHEMA_VERSION);
  assert.equal(drift.status, 'passed');
  assert.equal(drift.summary.failed, 0);
  assert.equal(drift.summary.warning, 0);
  assert.equal(drift.summary.unknown, 0);
  assert.equal(
    detector(drift, 'soak.memory.rss-growth').observed.delta,
    2 * mib,
  );
  assert.equal(
    detector(drift, 'soak.latency.p95-degradation').observed.final,
    106,
  );
  assert.equal(detector(drift, 'soak.resets.stalled-cadence').status, 'passed');
  assert.equal(
    detector(drift, 'soak.handles.open-handle-growth').status,
    'passed',
  );
});

test('memory growth fails on rss, heapUsed, and heapTotal delta and percent drift', () => {
  const summary = stableSummary({
    memoryValues: [
      { rss: 100 * mib, heapUsed: 50 * mib, heapTotal: 90 * mib },
      { rss: 180 * mib, heapUsed: 95 * mib, heapTotal: 130 * mib },
      { rss: 420 * mib, heapUsed: 210 * mib, heapTotal: 300 * mib },
    ],
  });

  const drift = analyzeSoakDrift(summary, { profile: stableProfile() });

  assert.equal(detector(drift, 'soak.memory.rss-growth').status, 'failed');
  assert.equal(detector(drift, 'soak.memory.heapUsed-growth').status, 'failed');
  assert.equal(
    detector(drift, 'soak.memory.heapTotal-growth').status,
    'failed',
  );
  assert.deepEqual(
    detector(drift, 'soak.memory.rss-growth').affectedWindowIds,
    ['window-0002'],
  );
});

test('latency degradation warns or fails on p95 and p99 trend growth', () => {
  const summary = stableSummary({
    latencies: [
      { p95Ms: 100, p99Ms: 150 },
      { p95Ms: 175, p99Ms: 300 },
      { p95Ms: 420, p99Ms: 1_800 },
    ],
  });

  const drift = analyzeSoakDrift(summary, { profile: stableProfile() });

  assert.equal(
    detector(drift, 'soak.latency.p95-degradation').status,
    'failed',
  );
  assert.equal(
    detector(drift, 'soak.latency.p99-degradation').status,
    'failed',
  );
  assert.equal(
    detector(drift, 'soak.latency.p99-degradation').observed.slopePerWindow,
    825,
  );
});

test('error-rate detectors classify total and per-class late-run increases', () => {
  const summary = stableSummary({
    errorRates: [
      { total: 0, timeout: 0 },
      { total: 0.005, timeout: 0.005 },
      { total: 0.08, timeout: 0.06 },
    ],
  });

  const drift = analyzeSoakDrift(summary, { profile: stableProfile() });

  assert.equal(
    detector(drift, 'soak.errors.total-rate-increase').status,
    'failed',
  );
  assert.equal(
    detector(drift, 'soak.errors.timeout-rate-increase').status,
    'failed',
  );
  assert.equal(
    detector(drift, 'soak.errors.network-rate-increase').status,
    'passed',
  );
});

test('reset detectors fail for missed cadence and failed reset attempts', () => {
  const summary = stableSummary({
    resetAttempts: [1, 0, 1, 0],
    resetFailures: [0, 0, 1, 0],
  });
  summary.durationMs = 240_000;
  summary.resetLedger = {
    attempts: 2,
    succeeded: 1,
    failed: 1,
    successRate: 0.5,
  };
  summary.totals.resets = {
    attempts: 2,
    succeeded: 1,
    failed: 1,
    successRate: 0.5,
  };

  const drift = analyzeSoakDrift(summary, { profile: stableProfile() });

  assert.equal(detector(drift, 'soak.resets.stalled-cadence').status, 'failed');
  assert.equal(detector(drift, 'soak.resets.success-rate').status, 'failed');
  assert.deepEqual(detector(drift, 'soak.resets.success-rate').observed, {
    attempts: 2,
    failed: 1,
    successRate: 0.5,
  });
});

test('reset cadence detector uses resolved cadence tolerance overrides', () => {
  const summary = stableSummary({
    resetAttempts: [1, 0, 1],
  });
  summary.durationMs = 120_000;
  summary.resetLedger = {
    attempts: 2,
    succeeded: 2,
    failed: 0,
    successRate: 1,
  };

  const strictDrift = analyzeSoakDrift(summary, { profile: stableProfile() });
  const tolerantDrift = analyzeSoakDrift(summary, {
    profile: stableProfile(),
    thresholds: {
      resets: {
        cadenceTolerancePercent: 1.1,
      },
    },
  });

  assert.equal(
    detector(strictDrift, 'soak.resets.stalled-cadence').status,
    'failed',
  );
  assert.equal(
    detector(tolerantDrift, 'soak.resets.stalled-cadence').status,
    'passed',
  );
  assert.equal(
    detector(tolerantDrift, 'soak.resets.stalled-cadence').thresholds
      .toleranceMs,
    66_000,
  );
});

test('open handle detector fails on unreleased handle growth and final budget', () => {
  const summary = stableSummary({
    handles: [12, 20, 125],
  });

  const drift = analyzeSoakDrift(summary, { profile: stableProfile() });

  assert.equal(
    detector(drift, 'soak.handles.open-handle-growth').status,
    'failed',
  );
  assert.equal(
    detector(drift, 'soak.handles.open-handle-growth').observed.final,
    125,
  );
});

test('detectors accept metrics artifacts and threshold overrides', () => {
  const artifact = createSoakMetricsArtifact({
    durationMs: 180_000,
    profile: 'local-15m',
    requestEvents: [
      { elapsedMs: 1_000, durationMs: 100, ok: true },
      { elapsedMs: 61_000, durationMs: 350, ok: true },
      { elapsedMs: 121_000, durationMs: 500, ok: true },
    ],
    resetEvents: [
      { elapsedMs: 5_000, durationMs: 20, ok: true },
      { elapsedMs: 65_000, durationMs: 20, ok: true },
      { elapsedMs: 125_000, durationMs: 20, ok: true },
    ],
    samples: [
      resourceSample(0, 100, 50, 90, 10),
      resourceSample(60_000, 101, 51, 91, 10),
      resourceSample(120_000, 102, 52, 92, 11),
    ],
    windowMs: 60_000,
  });

  artifact.parameters.resetCadence = {
    mode: 'fixed-interval',
    everySeconds: 60,
  };

  const drift = analyzeSoakDrift(artifact, {
    thresholds: {
      latency: {
        failureDeltaMs: 300,
      },
    },
  });

  assert.equal(
    detector(drift, 'soak.latency.p95-degradation').status,
    'failed',
  );
  assert.equal(resolveDriftThresholds().memory.failureDeltaBytes, 256 * mib);
});

test('missing metric fields produce unknown detectors instead of zero-valued passes', () => {
  const summary = stableSummary();
  summary.windows = summary.windows.map(window => ({
    id: window.id,
    index: window.index,
    startedOffsetMs: window.startedOffsetMs,
    endedOffsetMs: window.endedOffsetMs,
    resets: window.resets,
  }));

  const drift = analyzeSoakDrift(summary, { profile: stableProfile() });

  assert.equal(drift.status, 'unknown');
  assert.equal(detector(drift, 'soak.memory.rss-growth').status, 'unknown');
  assert.equal(
    detector(drift, 'soak.latency.p95-degradation').status,
    'unknown',
  );
  assert.equal(
    detector(drift, 'soak.errors.total-rate-increase').status,
    'unknown',
  );
  assert.equal(
    detector(drift, 'soak.handles.open-handle-growth').status,
    'unknown',
  );
  assert.equal(detector(drift, 'soak.resets.success-rate').status, 'passed');
});

function stableProfile() {
  return {
    id: 'local-15m',
    resetCadence: {
      mode: 'fixed-interval',
      everySeconds: 60,
    },
  };
}

function stableSummary(overrides = {}) {
  const memoryValues =
    overrides.memoryValues ||
    [100, 101, 102].map(value => ({
      rss: value * mib,
      heapUsed: (value - 50) * mib,
      heapTotal: (value - 10) * mib,
    }));
  const latencies =
    overrides.latencies ||
    [100, 104, 106].map(value => ({
      p95Ms: value,
      p99Ms: value + 40,
    }));
  const errorRates =
    overrides.errorRates ||
    [0, 0, 0].map(rate => ({
      total: rate,
    }));
  const handles = overrides.handles || [10, 11, 12];
  const resetAttempts = overrides.resetAttempts || [1, 1, 1];
  const resetFailures = overrides.resetFailures || [0, 0, 0];
  const windows = memoryValues.map((memory, index) =>
    summaryWindow({
      errorRates: errorRates[index] || { total: 0 },
      handles: handles[index],
      index,
      latency: latencies[index],
      memory,
      resetAttempts: resetAttempts[index] || 0,
      resetFailures: resetFailures[index] || 0,
    }),
  );
  const attempts = resetAttempts.reduce((sum, value) => sum + value, 0);
  const failed = resetFailures.reduce((sum, value) => sum + value, 0);
  return {
    schemaVersion: 'superapp-soak-metrics-v1',
    durationMs: windows.length * 60_000,
    errorClasses: SOAK_ERROR_CLASSES,
    resetLedger: {
      attempts,
      succeeded: attempts - failed,
      failed,
      successRate: attempts === 0 ? 0 : (attempts - failed) / attempts,
    },
    totals: {
      resets: {
        attempts,
        succeeded: attempts - failed,
        failed,
        successRate: attempts === 0 ? 0 : (attempts - failed) / attempts,
      },
    },
    windowMs: 60_000,
    windows,
  };
}

function summaryWindow(input) {
  const errorClasses = Object.fromEntries(
    SOAK_ERROR_CLASSES.map(errorClass => [
      errorClass,
      {
        count: 0,
        rate: input.errorRates[errorClass] || 0,
      },
    ]),
  );
  return {
    id: `window-${String(input.index).padStart(4, '0')}`,
    index: input.index,
    startedOffsetMs: input.index * 60_000,
    endedOffsetMs: (input.index + 1) * 60_000,
    sampleCount: 1,
    memory: {
      rss: signal(input.memory.rss),
      heapUsed: signal(input.memory.heapUsed),
      heapTotal: signal(input.memory.heapTotal),
    },
    latency: {
      count: 10,
      p50Ms: Math.floor(input.latency.p95Ms / 2),
      p95Ms: input.latency.p95Ms,
      p99Ms: input.latency.p99Ms,
      maxMs: input.latency.p99Ms,
    },
    errors: {
      total: 0,
      rate: input.errorRates.total || 0,
      byClass: errorClasses,
    },
    requests: {
      total: 100,
      ok: 100,
      failed: 0,
      throughputPerSecond: 1.666667,
    },
    resets: {
      attempts: input.resetAttempts,
      succeeded: input.resetAttempts - input.resetFailures,
      failed: input.resetFailures,
      successRate:
        input.resetAttempts === 0
          ? 0
          : (input.resetAttempts - input.resetFailures) / input.resetAttempts,
    },
    openHandles: signal(input.handles),
  };
}

function resourceSample(elapsedMs, rss, heapUsed, heapTotal, handles) {
  return {
    elapsedMs,
    memory: {
      rss: rss * mib,
      heapUsed: heapUsed * mib,
      heapTotal: heapTotal * mib,
    },
    openHandles: handles,
  };
}

function signal(value) {
  return {
    min: value,
    max: value,
    mean: value,
    first: value,
    last: value,
    delta: 0,
  };
}

function detector(drift, id) {
  const result = drift.detectors.find(item => item.id === id);
  assert.ok(result, `Expected detector ${id}`);
  return result;
}
