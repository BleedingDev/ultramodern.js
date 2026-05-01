const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SOAK_ERROR_CLASSES,
  classifySoakError,
  createResetLedger,
  createSoakMetricsArtifact,
  createSoakMetricsTracker,
  createSoakWindowSummary,
  percentile,
} = require('../metrics-windows');

const kib = 1024;
const mib = 1024 * kib;

function resourceSample(elapsedMs, multiplier) {
  return {
    elapsedMs,
    memory: {
      rss: 100 * mib + multiplier * mib,
      heapUsed: 40 * mib + multiplier * mib,
      heapTotal: 80 * mib + multiplier * mib,
    },
    eventLoopDelay: {
      minMs: 1 + multiplier,
      maxMs: 20 + multiplier,
      meanMs: 5 + multiplier,
      p95Ms: 12 + multiplier,
      p99Ms: 18 + multiplier,
    },
    openHandles: 10 + multiplier,
  };
}

test('window summaries aggregate memory, handles, event-loop delay, throughput, latency, resets, and errors', () => {
  const summary = createSoakWindowSummary(
    {
      samples: [
        resourceSample(0, 0),
        resourceSample(30_000, 2),
        resourceSample(65_000, 8),
      ],
      requestEvents: [
        { elapsedMs: 1_000, durationMs: 10, ok: true },
        { elapsedMs: 2_000, durationMs: 20, ok: true },
        { elapsedMs: 3_000, durationMs: 30, status: 503 },
        { elapsedMs: 4_000, durationMs: 40, ok: true },
        { elapsedMs: 70_000, durationMs: 100, ok: true },
        { elapsedMs: 71_000, durationMs: 200, ok: true },
        { elapsedMs: 72_000, durationMs: 300, error: 'request timeout' },
      ],
      resetEvents: [
        { elapsedMs: 10_000, durationMs: 500, ok: true },
        { elapsedMs: 20_000, durationMs: 700, ok: false },
        { elapsedMs: 80_000, durationMs: 400, ok: true },
      ],
      errorEvents: [
        { elapsedMs: 5_000, error: 'schema validation failed' },
        { elapsedMs: 75_000, error: 'tenant boundary leaked' },
      ],
    },
    { durationMs: 120_000, windowMs: 60_000 },
  );

  assert.equal(summary.schemaVersion, 'superapp-soak-metrics-v1');
  assert.equal(summary.windows.length, 2);
  assert.equal(summary.windows[0].id, 'window-0000-000000000-000060000');
  assert.equal(summary.windows[1].id, 'window-0001-000060000-000120000');

  assert.deepEqual(summary.windows[0].memory.rss, {
    min: 100 * mib,
    max: 102 * mib,
    mean: 101 * mib,
    first: 100 * mib,
    last: 102 * mib,
    delta: 2 * mib,
  });
  assert.deepEqual(summary.windows[0].openHandles, {
    min: 10,
    max: 12,
    mean: 11,
    first: 10,
    last: 12,
    delta: 2,
  });
  assert.deepEqual(summary.windows[0].eventLoopDelay, {
    minMs: 1,
    maxMs: 22,
    meanMs: 6,
    p95Ms: 14,
    p99Ms: 20,
  });

  assert.deepEqual(summary.windows[0].requests, {
    total: 4,
    ok: 3,
    failed: 1,
    throughputPerSecond: 0.066667,
  });
  assert.deepEqual(summary.windows[0].latency, {
    count: 4,
    p50Ms: 20,
    p95Ms: 40,
    p99Ms: 40,
    maxMs: 40,
  });
  assert.deepEqual(summary.windows[0].resets, {
    attempts: 2,
    succeeded: 1,
    failed: 1,
    successRate: 0.5,
  });
  assert.equal(summary.windows[0].errors.total, 3);
  assert.equal(summary.windows[0].errors.rate, 0.75);
  assert.equal(summary.windows[0].errors.byClass['http-status'].count, 1);
  assert.equal(summary.windows[0].errors.byClass.schema.count, 1);
  assert.equal(summary.windows[0].errors.byClass.reset.count, 1);

  assert.deepEqual(summary.windows[1].requests, {
    total: 3,
    ok: 2,
    failed: 1,
    throughputPerSecond: 0.05,
  });
  assert.deepEqual(summary.windows[1].latency, {
    count: 3,
    p50Ms: 200,
    p95Ms: 300,
    p99Ms: 300,
    maxMs: 300,
  });
  assert.equal(summary.windows[1].errors.byClass.timeout.count, 1);
  assert.equal(summary.windows[1].errors.byClass['tenant-boundary'].count, 1);
  assert.equal(summary.totals.requests.total, 7);
  assert.equal(summary.totals.resets.successRate, 0.666667);
});

test('classifier returns stable soak categories', () => {
  assert.deepEqual(SOAK_ERROR_CLASSES, [
    'timeout',
    'http-status',
    'network',
    'schema',
    'tenant-boundary',
    'reset',
    'chaos-lite',
    'unknown',
  ]);

  assert.equal(classifySoakError(new Error('AbortError timeout')), 'timeout');
  assert.equal(classifySoakError({ status: 502 }), 'http-status');
  assert.equal(classifySoakError('ECONNRESET socket hang up'), 'network');
  assert.equal(classifySoakError('schema validation failed'), 'schema');
  assert.equal(
    classifySoakError('cross-tenant boundary violation'),
    'tenant-boundary',
  );
  assert.equal(classifySoakError({ phase: 'reset' }), 'reset');
  assert.equal(
    classifySoakError({ scenarioId: 'chaos-triggering' }),
    'chaos-lite',
  );
  assert.equal(classifySoakError('unexpected failure'), 'unknown');
});

test('reset ledger preserves deterministic ids, offsets, success rate, and failures', () => {
  const ledger = createResetLedger([
    { elapsedMs: 5_000, durationMs: 120, ok: true },
    { id: 'manual-reset', elapsedMs: 15_000, durationMs: 250, ok: false },
  ]);

  assert.equal(ledger.attempts, 2);
  assert.equal(ledger.succeeded, 1);
  assert.equal(ledger.failed, 1);
  assert.equal(ledger.successRate, 0.5);
  assert.equal(ledger.firstAttemptOffsetMs, 5_000);
  assert.equal(ledger.lastAttemptOffsetMs, 15_000);
  assert.deepEqual(ledger.entries, [
    {
      id: 'reset-0001',
      offsetMs: 5_000,
      ok: true,
      durationMs: 120,
      scenarioId: 'reset',
      errorClass: undefined,
    },
    {
      id: 'manual-reset',
      offsetMs: 15_000,
      ok: false,
      durationMs: 250,
      scenarioId: 'reset',
      errorClass: 'reset',
    },
  ]);
});

test('artifact builder returns a certification-style envelope without modifying certification schema', () => {
  const artifact = createSoakMetricsArtifact({
    startedAt: '2026-05-01T00:00:00.000Z',
    finishedAt: '2026-05-01T00:02:00.000Z',
    durationMs: 120_000,
    profile: 'local-15m',
    windowMs: 60_000,
    samples: [resourceSample(0, 0), resourceSample(60_000, 4)],
    requestEvents: [{ elapsedMs: 10_000, durationMs: 25, ok: true }],
    resetEvents: [{ elapsedMs: 30_000, durationMs: 50, ok: true }],
  });

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.suite, 'superapp-soak');
  assert.equal(artifact.target, 'superapp');
  assert.equal(artifact.profile, 'local-15m');
  assert.deepEqual(artifact.dimensions, ['soak', 'performance']);
  assert.equal(artifact.metrics.schemaVersion, 'superapp-soak-metrics-v1');
  assert.equal(artifact.metrics.windows.length, 2);
  assert.equal(artifact.detail.resetLedger.successRate, 1);
});

test('tracker records deterministic synthetic observations into the same summary path', () => {
  let now = 1_000;
  const tracker = createSoakMetricsTracker({
    startedAtMs: 1_000,
    windowMs: 60_000,
    clock: () => now,
  });

  tracker.recordSample(resourceSample(0, 0));
  now = 2_000;
  tracker.recordRequest({ durationMs: 33, ok: true });
  now = 3_000;
  tracker.recordError('api-timeout during chaos-lite');
  now = 61_000;
  tracker.recordReset({ durationMs: 44, ok: true });

  const summary = tracker.summarize({ durationMs: 120_000 });

  assert.equal(summary.windows[0].requests.total, 1);
  assert.equal(summary.windows[0].latency.p99Ms, 33);
  assert.equal(summary.windows[0].errors.byClass['chaos-lite'].count, 1);
  assert.equal(summary.windows[1].resets.successRate, 1);
});

test('tracker defaults start time to the current clock when no explicit start is provided', () => {
  let now = 10_000;
  const tracker = createSoakMetricsTracker({
    windowMs: 60_000,
    clock: () => now,
  });

  now = 10_050;
  tracker.recordReset({ durationMs: 12, ok: true });

  const summary = tracker.summarize({ durationMs: 60_000 });

  assert.equal(summary.resetLedger.entries[0].offsetMs, 50);
  assert.equal(Number.isFinite(summary.resetLedger.entries[0].offsetMs), true);
});

test('percentile uses nearest-rank behavior for stable latency windows', () => {
  assert.equal(percentile([40, 10, 20, 30], 50), 20);
  assert.equal(percentile([40, 10, 20, 30], 95), 40);
  assert.equal(percentile([], 99), 0);
});
