const { SOAK_ERROR_CLASSES } = require('./metrics-windows');

const SOAK_DRIFT_SCHEMA_VERSION = 'superapp-soak-drift-v1';
const MIB = 1024 * 1024;

const DEFAULT_DRIFT_THRESHOLDS = {
  memory: {
    minWindows: 2,
    warningDeltaBytes: 128 * MIB,
    failureDeltaBytes: 256 * MIB,
    warningPercent: 0.2,
    failurePercent: 0.5,
    warningSlopeBytesPerWindow: 64 * MIB,
    failureSlopeBytesPerWindow: 128 * MIB,
  },
  latency: {
    minWindows: 2,
    warningDeltaMs: 250,
    failureDeltaMs: 1_000,
    warningPercent: 0.25,
    failurePercent: 0.5,
    warningSlopeMsPerWindow: 100,
    failureSlopeMsPerWindow: 500,
  },
  errors: {
    minWindows: 2,
    warningRateDelta: 0.01,
    failureRateDelta: 0.05,
    warningRateMultiplier: 2,
    failureRateMultiplier: 5,
    minFinalRateForMultiplier: 0.005,
  },
  resets: {
    cadenceTolerancePercent: 0.25,
    minSuccessRateWarning: 0.98,
    minSuccessRateFailure: 0.9,
  },
  handles: {
    minWindows: 2,
    warningDelta: 5,
    failureDelta: 20,
    warningFinalCount: 50,
    failureFinalCount: 100,
    warningSlopePerWindow: 2,
    failureSlopePerWindow: 8,
  },
};

function analyzeSoakDrift(input = {}, options = {}) {
  const summary = normalizeMetricsInput(input);
  const profile = options.profile || input.profile || input.parameters?.profile;
  const thresholds = resolveDriftThresholds({
    profile,
    thresholds: options.thresholds,
  });
  const resetCadence = resolveResetCadence(
    options.resetCadence,
    profile,
    input,
  );
  const detectors = [
    ...detectMemoryGrowth(summary, thresholds.memory),
    ...detectLatencyDegradation(summary, thresholds.latency),
    ...detectErrorRateGrowth(summary, thresholds.errors),
    ...detectResetDrift(summary, thresholds.resets, resetCadence),
    detectHandleGrowth(summary, thresholds.handles),
  ];
  const status = aggregateStatus(detectors);

  return {
    schemaVersion: SOAK_DRIFT_SCHEMA_VERSION,
    status,
    summary: summarizeDetectorStatuses(detectors),
    profileId: readProfileId(profile),
    thresholds,
    detectors,
  };
}

function resolveDriftThresholds(input = {}) {
  const thresholds = clone(DEFAULT_DRIFT_THRESHOLDS);
  const profileId = readProfileId(input.profile);
  if (profileId?.startsWith('overnight-')) {
    thresholds.memory.failureDeltaBytes = 512 * MIB;
    thresholds.memory.warningDeltaBytes = 256 * MIB;
    thresholds.handles.failureFinalCount = 150;
    thresholds.handles.warningFinalCount = 75;
  }
  return mergeDeep(thresholds, input.thresholds || {});
}

function detectMemoryGrowth(summary, thresholds) {
  return ['rss', 'heapUsed', 'heapTotal'].map(signal => {
    const series = buildSeries(summary.windows, window => {
      if (window.sampleCount === 0) {
        return undefined;
      }
      const metric = window.memory?.[signal];
      return metric?.last ?? metric?.mean ?? metric?.max;
    });
    return trendDetector({
      id: `soak.memory.${signal}-growth`,
      category: 'memory',
      signal,
      series,
      minWindows: thresholds.minWindows,
      thresholds,
      statusFromTrend: trend =>
        thresholdStatus(trend, {
          warningDelta: thresholds.warningDeltaBytes,
          failureDelta: thresholds.failureDeltaBytes,
          warningPercent: thresholds.warningPercent,
          failurePercent: thresholds.failurePercent,
          warningSlope: thresholds.warningSlopeBytesPerWindow,
          failureSlope: thresholds.failureSlopeBytesPerWindow,
        }),
      remediationHint:
        'Inspect retained objects, cache eviction, and tenant/workload cleanup for monotonic memory growth during soak windows.',
    });
  });
}

function detectLatencyDegradation(summary, thresholds) {
  return ['p95Ms', 'p99Ms'].map(signal => {
    const label = signal.replace('Ms', '');
    const series = buildSeries(
      summary.windows,
      window =>
        window.latency?.count > 0 ? window.latency?.[signal] : undefined,
      {
        requirePositive: true,
      },
    );
    return trendDetector({
      id: `soak.latency.${label}-degradation`,
      category: 'latency',
      signal: label,
      series,
      minWindows: thresholds.minWindows,
      thresholds,
      statusFromTrend: trend =>
        thresholdStatus(trend, {
          warningDelta: thresholds.warningDeltaMs,
          failureDelta: thresholds.failureDeltaMs,
          warningPercent: thresholds.warningPercent,
          failurePercent: thresholds.failurePercent,
          warningSlope: thresholds.warningSlopeMsPerWindow,
          failureSlope: thresholds.failureSlopeMsPerWindow,
        }),
      remediationHint:
        'Compare late-window request mix, downstream waits, event-loop delay, and cache or connection pool saturation against early windows.',
    });
  });
}

function detectErrorRateGrowth(summary, thresholds) {
  const detectors = [
    buildErrorRateDetector({
      id: 'soak.errors.total-rate-increase',
      label: 'total',
      series: buildSeries(summary.windows, window =>
        readErrorRate(window, 'total'),
      ),
      thresholds,
    }),
  ];

  const classes = summary.errorClasses || SOAK_ERROR_CLASSES;
  for (const errorClass of classes) {
    detectors.push(
      buildErrorRateDetector({
        id: `soak.errors.${errorClass}-rate-increase`,
        label: errorClass,
        series: buildSeries(summary.windows, window =>
          readErrorRate(window, errorClass),
        ),
        thresholds,
      }),
    );
  }
  return detectors;
}

function buildErrorRateDetector(input) {
  return trendDetector({
    id: input.id,
    category: 'errors',
    signal: input.label,
    series: input.series,
    minWindows: input.thresholds.minWindows,
    thresholds: input.thresholds,
    statusFromTrend: trend =>
      errorRateStatus(trend, {
        warningRateDelta: input.thresholds.warningRateDelta,
        failureRateDelta: input.thresholds.failureRateDelta,
        warningRateMultiplier: input.thresholds.warningRateMultiplier,
        failureRateMultiplier: input.thresholds.failureRateMultiplier,
        minFinalRateForMultiplier: input.thresholds.minFinalRateForMultiplier,
      }),
    remediationHint:
      input.label === 'total'
        ? 'Inspect classified error samples and correlate late-window failures with scenario mix, resets, and chaos-lite events.'
        : `Inspect ${input.label} error samples and the scenario mix in affected windows for late-run regressions.`,
  });
}

function detectResetDrift(summary, thresholds, cadence) {
  const ledger = summary.resetLedger || {};
  const totals = summary.totals?.resets || {};
  const attempts = finiteNumber(ledger.attempts ?? totals.attempts);
  const failed = finiteNumber(ledger.failed ?? totals.failed);
  const successRate = finiteNumber(ledger.successRate ?? totals.successRate);
  const cadenceDetector = detectResetCadence(summary, thresholds, cadence);
  const status =
    attempts === 0
      ? cadence?.mode === 'none'
        ? 'passed'
        : 'unknown'
      : successRate < thresholds.minSuccessRateFailure || failed > 0
        ? 'failed'
        : successRate < thresholds.minSuccessRateWarning
          ? 'warning'
          : 'passed';

  return [
    cadenceDetector,
    {
      id: 'soak.resets.success-rate',
      category: 'resets',
      status,
      observed: {
        attempts,
        failed,
        successRate,
      },
      thresholds: {
        minSuccessRateWarning: thresholds.minSuccessRateWarning,
        minSuccessRateFailure: thresholds.minSuccessRateFailure,
      },
      affectedWindowIds: affectedResetWindows(summary.windows),
      remediationHint:
        'Investigate fixture reset endpoint failures, data cleanup races, and chaos-lite recovery before trusting soak stability.',
    },
  ];
}

function detectResetCadence(summary, thresholds, cadence) {
  if (!cadence || cadence.mode === 'none') {
    return {
      id: 'soak.resets.stalled-cadence',
      category: 'resets',
      status: 'passed',
      observed: { mode: cadence?.mode || 'none' },
      thresholds: { expectedEveryMs: undefined },
      affectedWindowIds: [],
      remediationHint:
        'No reset cadence was configured for this soak profile, so reset stall detection is not applicable.',
    };
  }

  const expectedEveryMs = finiteNumber(cadence.everyMs);
  if (expectedEveryMs <= 0) {
    return {
      id: 'soak.resets.stalled-cadence',
      category: 'resets',
      status: 'unknown',
      observed: { mode: cadence.mode, expectedEveryMs },
      thresholds: { expectedEveryMs },
      affectedWindowIds: [],
      remediationHint:
        'Pass the resolved soak profile reset cadence so stalled reset detection can evaluate expected cadence.',
    };
  }

  const toleranceMs = expectedEveryMs * thresholds.cadenceTolerancePercent;
  const windows = summary.windows || [];
  const resetWindows = windows.filter(window => window.resets?.attempts > 0);
  const gaps = resetWindows
    .slice(1)
    .map((window, index) => ({
      fromWindowId: resetWindows[index].id,
      toWindowId: window.id,
      gapMs: window.startedOffsetMs - resetWindows[index].startedOffsetMs,
    }))
    .filter(gap => gap.gapMs > expectedEveryMs + toleranceMs);
  const observedAttempts = finiteNumber(
    summary.resetLedger?.attempts ?? summary.totals?.resets?.attempts,
  );
  const durationMs = finiteNumber(summary.durationMs);
  const expectedAttempts =
    durationMs > expectedEveryMs
      ? Math.max(1, Math.floor(durationMs / expectedEveryMs))
      : 0;
  const missedAttempts = Math.max(0, expectedAttempts - observedAttempts);
  const status = gaps.length > 0 || missedAttempts > 0 ? 'failed' : 'passed';

  return {
    id: 'soak.resets.stalled-cadence',
    category: 'resets',
    status,
    observed: {
      mode: cadence.mode,
      attempts: observedAttempts,
      expectedAttempts,
      missedAttempts,
      maxGapMs: gaps.reduce((max, gap) => Math.max(max, gap.gapMs), 0),
    },
    thresholds: {
      expectedEveryMs,
      toleranceMs,
    },
    affectedWindowIds: [...new Set(gaps.map(gap => gap.toWindowId))],
    remediationHint:
      'Verify the runner reset scheduler, reset scenario selection, and reset ledger writes when expected reset windows are missing.',
  };
}

function detectHandleGrowth(summary, thresholds) {
  const series = buildSeries(summary.windows, window => {
    if (window.sampleCount === 0) {
      return undefined;
    }
    const handles = window.openHandles;
    return handles?.last ?? handles?.mean ?? handles?.max;
  });
  return trendDetector({
    id: 'soak.handles.open-handle-growth',
    category: 'handles',
    signal: 'openHandles',
    series,
    minWindows: thresholds.minWindows,
    thresholds,
    statusFromTrend: trend => {
      if (
        trend.final >= thresholds.failureFinalCount ||
        trend.delta >= thresholds.failureDelta ||
        trend.slopePerWindow >= thresholds.failureSlopePerWindow
      ) {
        return 'failed';
      }
      if (
        trend.final >= thresholds.warningFinalCount ||
        trend.delta >= thresholds.warningDelta ||
        trend.slopePerWindow >= thresholds.warningSlopePerWindow
      ) {
        return 'warning';
      }
      return 'passed';
    },
    remediationHint:
      'Look for leaked timers, sockets, file watchers, undrained fetches, or lingering server handles after workload and reset cycles.',
  });
}

function trendDetector(input) {
  const trend = summarizeTrend(input.series);
  if (input.series.length < input.minWindows || !trend) {
    return {
      id: input.id,
      category: input.category,
      status: 'unknown',
      observed: {
        windowCount: input.series.length,
      },
      thresholds: input.thresholds,
      affectedWindowIds: input.series.map(point => point.windowId),
      remediationHint:
        'Collect at least two populated soak windows before evaluating drift for this detector.',
    };
  }

  return {
    id: input.id,
    category: input.category,
    status: input.statusFromTrend(trend),
    observed: trend,
    thresholds: input.thresholds,
    affectedWindowIds: affectedTrendWindows(input.series, trend),
    remediationHint: input.remediationHint,
  };
}

function summarizeTrend(series) {
  if (series.length < 2) {
    return undefined;
  }
  const baseline = series[0].value;
  const final = series.at(-1).value;
  const delta = roundMetric(final - baseline);
  const percentChange =
    baseline > 0 ? roundMetric(delta / baseline) : final > 0 ? Infinity : 0;
  const slopePerWindow = roundMetric(delta / (series.length - 1));
  const peakPoint = series.reduce(
    (peak, point) => (point.value > peak.value ? point : peak),
    series[0],
  );

  return {
    windowCount: series.length,
    baseline,
    final,
    delta,
    percentChange,
    slopePerWindow,
    peak: peakPoint.value,
    peakWindowId: peakPoint.windowId,
  };
}

function thresholdStatus(trend, thresholds) {
  if (
    trend.delta >= thresholds.failureDelta ||
    trend.percentChange >= thresholds.failurePercent ||
    trend.slopePerWindow >= thresholds.failureSlope
  ) {
    return 'failed';
  }
  if (
    trend.delta >= thresholds.warningDelta ||
    trend.percentChange >= thresholds.warningPercent ||
    trend.slopePerWindow >= thresholds.warningSlope
  ) {
    return 'warning';
  }
  return 'passed';
}

function errorRateStatus(trend, thresholds) {
  const multiplier =
    trend.baseline > 0
      ? trend.final / trend.baseline
      : Number.POSITIVE_INFINITY;
  const multiplierTriggered =
    trend.final >= thresholds.minFinalRateForMultiplier &&
    ((trend.baseline === 0 && trend.final > 0) ||
      multiplier >= thresholds.warningRateMultiplier);
  const failureMultiplierTriggered =
    trend.final >= thresholds.minFinalRateForMultiplier &&
    ((trend.baseline === 0 && trend.final >= thresholds.failureRateDelta) ||
      multiplier >= thresholds.failureRateMultiplier);

  if (
    trend.delta >= thresholds.failureRateDelta ||
    failureMultiplierTriggered
  ) {
    return 'failed';
  }
  if (trend.delta >= thresholds.warningRateDelta || multiplierTriggered) {
    return 'warning';
  }
  return 'passed';
}

function buildSeries(windows = [], readValue, options = {}) {
  return windows
    .map(window => ({
      windowId: window.id,
      index: window.index,
      value: readMetricNumber(readValue(window)),
    }))
    .filter(point => point.value !== undefined)
    .filter(point => !options.requirePositive || point.value > 0);
}

function readErrorRate(window, errorClass) {
  if (!window.errors) {
    return undefined;
  }
  if (window.requests && window.requests.total <= 0) {
    return undefined;
  }
  if (errorClass === 'total') {
    return window.errors.rate;
  }
  return window.errors.byClass?.[errorClass]?.rate;
}

function affectedTrendWindows(series, trend) {
  const threshold = trend.baseline + Math.max(0, trend.delta) / 2;
  return series
    .filter(point => point.value >= threshold && point.value > trend.baseline)
    .map(point => point.windowId);
}

function affectedResetWindows(windows = []) {
  return windows
    .filter(
      window => window.resets?.failed > 0 || window.resets?.successRate < 1,
    )
    .map(window => window.id);
}

function normalizeMetricsInput(input = {}) {
  if (Array.isArray(input.windows)) {
    return {
      ...input,
      errorClasses: input.errorClasses || SOAK_ERROR_CLASSES,
      resetLedger: input.resetLedger,
      windows: input.windows,
    };
  }
  if (input.metrics?.windows) {
    return {
      schemaVersion: input.metrics.schemaVersion,
      durationMs: input.durationMs,
      errorClasses: input.detail?.errorClasses || SOAK_ERROR_CLASSES,
      resetLedger: input.detail?.resetLedger,
      totals: input.metrics.totals,
      windowMs: input.parameters?.windowMs,
      windows: input.metrics.windows,
    };
  }
  return {
    durationMs: 0,
    errorClasses: SOAK_ERROR_CLASSES,
    resetLedger: undefined,
    totals: undefined,
    windows: [],
  };
}

function resolveResetCadence(explicit, profile, artifact) {
  const cadence =
    explicit ||
    profile?.resetCadence ||
    artifact.parameters?.resetCadence ||
    artifact.detail?.runner?.resetCadence;
  if (!cadence) {
    return undefined;
  }
  return {
    mode: cadence.mode || 'fixed-interval',
    everyMs:
      cadence.everyMs ??
      (cadence.everySeconds !== undefined ? cadence.everySeconds * 1000 : 0),
  };
}

function aggregateStatus(detectors) {
  if (detectors.some(detector => detector.status === 'failed')) {
    return 'failed';
  }
  if (detectors.some(detector => detector.status === 'warning')) {
    return 'warning';
  }
  if (detectors.some(detector => detector.status === 'unknown')) {
    return 'unknown';
  }
  return 'passed';
}

function summarizeDetectorStatuses(detectors) {
  const statuses = {
    passed: 0,
    warning: 0,
    failed: 0,
    unknown: 0,
  };
  for (const detector of detectors) {
    statuses[detector.status] += 1;
  }
  return {
    total: detectors.length,
    ...statuses,
  };
}

function mergeDeep(target, source) {
  const merged = clone(target);
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = mergeDeep(merged[key] || {}, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readProfileId(profile) {
  if (!profile) {
    return undefined;
  }
  return typeof profile === 'string' ? profile : profile.id;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readMetricNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function roundMetric(value) {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

module.exports = {
  DEFAULT_DRIFT_THRESHOLDS,
  SOAK_DRIFT_SCHEMA_VERSION,
  analyzeSoakDrift,
  resolveDriftThresholds,
};
