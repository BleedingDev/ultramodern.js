const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  SOAK_STABILITY_REPORT_SCHEMA_VERSION,
  createSoakStabilityReport,
  writeSoakStabilityReport,
} = require('../stability-report');

const mib = 1024 * 1024;

test('all-pass report classifies soak stability and preserves envelope', () => {
  const { report } = createSoakStabilityReport(
    summaryArtifact(stableSummary()),
  );

  assert.equal(report.schemaVersion, SOAK_STABILITY_REPORT_SCHEMA_VERSION);
  assert.equal(report.status, 'passed');
  assert.equal(report.classification, 'pass');
  assert.equal(report.detectorSummary.failed, 0);
  assert.equal(report.detectorSummary.warning, 0);
  assert.equal(report.detectorSummary.unknown, 0);
  assert.deepEqual(report.recommendations, []);
  assert.equal(report.observedStabilityEnvelope.windowCount, 3);
  assert.equal(report.observedStabilityEnvelope.memory.rss.delta, 2 * mib);
  assert.equal(report.observedStabilityEnvelope.latency.p95Ms.last, 106);
  assert.equal(report.observedStabilityEnvelope.resets.ledger.successRate, 1);
});

test('failure report emits detector remediation recommendations', () => {
  const { report } = createSoakStabilityReport(
    summaryArtifact(
      stableSummary({
        memoryValues: [
          { rss: 100 * mib, heapUsed: 50 * mib, heapTotal: 90 * mib },
          { rss: 190 * mib, heapUsed: 95 * mib, heapTotal: 130 * mib },
          { rss: 420 * mib, heapUsed: 210 * mib, heapTotal: 300 * mib },
        ],
      }),
    ),
  );

  assert.equal(report.status, 'failed');
  assert.equal(report.classification, 'fail');
  assert.ok(
    report.recommendations.some(
      item =>
        item.detectorId === 'soak.memory.rss-growth' &&
        item.recommendation.includes('retained objects'),
    ),
  );
  assert.equal(
    report.detectorResults.find(
      detector => detector.id === 'soak.memory.rss-growth',
    ).classification,
    'fail',
  );
});

test('warning and unknown states are classified with actionable fixes', () => {
  const warning = createSoakStabilityReport(
    summaryArtifact(
      stableSummary({
        latencies: [
          { p95Ms: 100, p99Ms: 140 },
          { p95Ms: 180, p99Ms: 220 },
          { p95Ms: 260, p99Ms: 320 },
        ],
      }),
    ),
    {
      thresholds: {
        latency: {
          failureDeltaMs: 1_000,
          failurePercent: 10,
          failureSlopeMsPerWindow: 1_000,
          warningDeltaMs: 100,
        },
      },
    },
  ).report;
  const unknown = createSoakStabilityReport(
    summaryArtifact(stableSummary({ omitMetricEvidence: true })),
  ).report;

  assert.equal(warning.status, 'warning');
  assert.equal(warning.classification, 'warning');
  assert.ok(
    warning.recommendations.some(item =>
      item.recommendation.includes('late-window request mix'),
    ),
  );
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.classification, 'unknown');
  assert.ok(
    unknown.recommendations.some(item => item.classification === 'unknown'),
  );
});

test('markdown appendix includes envelope, thresholds, detectors, and fixes', () => {
  const { markdown, report } = createSoakStabilityReport(
    summaryArtifact(
      stableSummary({
        handles: [10, 20, 125],
      }),
    ),
  );

  assert.equal(report.status, 'failed');
  assert.match(markdown, /## SuperApp Soak Stability Appendix/);
  assert.match(markdown, /### Observed Stability Envelope/);
  assert.match(markdown, /### Thresholds Used/);
  assert.match(markdown, /soak\.handles\.open-handle-growth/);
  assert.match(markdown, /leaked timers/);
  assert.match(markdown, /### Artifacts And Provenance/);
});

test('writer emits deterministic JSON and markdown artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-report-'));

  try {
    const result = writeSoakStabilityReport(summaryArtifact(stableSummary()), {
      outputDir: tempDir,
      sourcePath: path.join(tempDir, 'summary.json'),
    });

    assert.equal(
      path.basename(result.reportPath),
      'soak-stability-report.json',
    );
    assert.equal(
      path.basename(result.markdownPath),
      'soak-stability-appendix.md',
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(result.reportPath, 'utf8')),
      result.report,
    );
    assert.equal(fs.readFileSync(result.markdownPath, 'utf8'), result.markdown);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('threshold and profile envelope propagation remain machine readable', () => {
  const { report } = createSoakStabilityReport(
    summaryArtifact(stableSummary(), {
      parameters: {
        concurrency: 12,
        scenarioMix: [{ scenarioId: 'chat', weight: 1 }],
      },
    }),
    {
      thresholds: {
        memory: {
          failureDeltaBytes: 42 * mib,
          warningDeltaBytes: 21 * mib,
        },
      },
    },
  );

  assert.equal(report.thresholds.memory.failureDeltaBytes, 42 * mib);
  assert.equal(report.thresholds.memory.warningDeltaBytes, 21 * mib);
  assert.equal(report.observedStabilityEnvelope.concurrency, 12);
  assert.deepEqual(report.observedStabilityEnvelope.scenarioMix, [
    { scenarioId: 'chat', weight: 1 },
  ]);
  assert.equal(report.provenance.artifactPaths[0].kind, 'error-samples');
});

function summaryArtifact(summary, overrides = {}) {
  return {
    suite: 'superapp-soak',
    target: 'superapp',
    profile: 'local-15m',
    status: overrides.status,
    startedAt: '2026-04-30T00:00:00.000Z',
    finishedAt: '2026-04-30T00:03:00.000Z',
    durationMs: summary.durationMs,
    parameters: {
      concurrency: 8,
      resetCadence: {
        mode: 'fixed-interval',
        everySeconds: 60,
      },
      scenarioMix: [{ scenarioId: 'smoke', weight: 1 }],
      windowMs: summary.windowMs,
      ...overrides.parameters,
    },
    artifacts: [
      { path: '/tmp/soak-error-samples.json', kind: 'error-samples' },
      { path: '/tmp/soak-reset-ledger.json', kind: 'reset-ledger' },
      { path: '/tmp/soak-window-summary.json', kind: 'window-summary' },
    ],
    metrics: {
      schemaVersion: summary.schemaVersion,
      totals: summary.totals,
      windows: summary.windows,
    },
    detail: {
      errorClasses: summary.errorClasses,
      resetLedger: summary.resetLedger,
    },
  };
}

function stableSummary(overrides = {}) {
  const errorClasses = [
    'timeout',
    'http-status',
    'network',
    'schema',
    'tenant-boundary',
    'reset',
    'chaos-lite',
    'unknown',
  ];
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
  const handles = overrides.handles || [10, 11, 12];
  const windows = memoryValues.map((memory, index) =>
    summaryWindow({
      errorClasses,
      handles: handles[index],
      index,
      latency: latencies[index],
      memory,
      omitMetricEvidence: overrides.omitMetricEvidence,
    }),
  );
  return {
    schemaVersion: 'superapp-soak-metrics-v1',
    durationMs: windows.length * 60_000,
    errorClasses,
    resetLedger: {
      attempts: 3,
      failed: 0,
      succeeded: 3,
      successRate: 1,
    },
    totals: {
      resets: {
        attempts: 3,
        failed: 0,
        succeeded: 3,
        successRate: 1,
      },
    },
    windowMs: 60_000,
    windows,
  };
}

function summaryWindow(input) {
  const base = {
    id: `window-${String(input.index).padStart(4, '0')}`,
    index: input.index,
    resets: {
      attempts: 1,
      failed: 0,
      succeeded: 1,
      successRate: 1,
    },
    startedOffsetMs: input.index * 60_000,
    endedOffsetMs: (input.index + 1) * 60_000,
  };
  if (input.omitMetricEvidence) {
    return base;
  }
  return {
    ...base,
    errors: {
      byClass: Object.fromEntries(
        input.errorClasses.map(errorClass => [
          errorClass,
          {
            count: 0,
            rate: 0,
          },
        ]),
      ),
      rate: 0,
      total: 0,
    },
    latency: {
      count: 10,
      p95Ms: input.latency.p95Ms,
      p99Ms: input.latency.p99Ms,
    },
    memory: {
      heapTotal: signal(input.memory.heapTotal),
      heapUsed: signal(input.memory.heapUsed),
      rss: signal(input.memory.rss),
    },
    openHandles: signal(input.handles),
    requests: {
      failed: 0,
      ok: 10,
      throughputPerSecond: 1,
      total: 10,
    },
    sampleCount: 1,
  };
}

function signal(value) {
  return {
    delta: 0,
    first: value,
    last: value,
    max: value,
    mean: value,
    min: value,
  };
}
