const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const {
  launchProductionServer,
  reservePort,
  runBuild,
  startServerProcess,
  stopProductionServer,
  waitForHttp,
} = require('../lib/process-kit');

function createMetricsSampler(options = {}) {
  const eventLoopDelay = monitorEventLoopDelay({
    resolution: options.eventLoopResolutionMs || 20,
  });
  const startedAt = Date.now();
  const operations = new Map();
  const errors = new Map();
  const samples = [];
  eventLoopDelay.enable();

  function recordOperation(name, durationMs, result = {}) {
    const operation = operations.get(name) || {
      count: 0,
      ok: 0,
      failed: 0,
      totalDurationMs: 0,
      minMs: undefined,
      maxMs: 0,
    };
    operation.count += 1;
    operation.totalDurationMs += durationMs;
    operation.minMs =
      operation.minMs === undefined
        ? durationMs
        : Math.min(operation.minMs, durationMs);
    operation.maxMs = Math.max(operation.maxMs, durationMs);
    if (result.ok === false) {
      operation.failed += 1;
      recordError(result.error || result.errorClass || 'operation-failed');
    } else {
      operation.ok += 1;
    }
    operations.set(name, operation);
  }

  function recordError(error, count = 1) {
    const errorClass = classifyError(error);
    errors.set(errorClass, (errors.get(errorClass) || 0) + count);
    return errorClass;
  }

  async function timed(name, run) {
    const started = performance.now();
    try {
      const value = await run();
      recordOperation(name, performance.now() - started, { ok: true });
      return value;
    } catch (error) {
      recordOperation(name, performance.now() - started, {
        ok: false,
        error,
      });
      throw error;
    }
  }

  function snapshot(label = 'sample') {
    const sample = {
      ...sampleProcessMetrics(label),
      eventLoopDelay: readEventLoopDelay(eventLoopDelay),
      requestTotals: summarizeOperations(operations),
      errorClasses: Object.fromEntries(errors),
    };
    samples.push(sample);
    return sample;
  }

  function summary(extra = {}) {
    eventLoopDelay.disable();
    return {
      schemaVersion: 1,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      eventLoopDelay: readEventLoopDelay(eventLoopDelay),
      requestTotals: summarizeOperations(operations),
      errorClasses: Object.fromEntries(errors),
      samples,
      ...extra,
    };
  }

  return {
    recordError,
    recordOperation,
    snapshot,
    summary,
    timed,
  };
}

function sampleProcessMetrics(label = 'sample') {
  const memory = process.memoryUsage();
  return {
    label,
    sampledAt: new Date().toISOString(),
    pid: process.pid,
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
    activeHandles: process._getActiveHandles
      ? process._getActiveHandles().length
      : undefined,
    activeRequests: process._getActiveRequests
      ? process._getActiveRequests().length
      : undefined,
  };
}

function summarizeOperations(operations) {
  return Object.fromEntries(
    [...operations.entries()].map(([name, operation]) => [
      name,
      {
        count: operation.count,
        ok: operation.ok,
        failed: operation.failed,
        minMs: operation.minMs || 0,
        maxMs: operation.maxMs,
        meanMs:
          operation.count === 0
            ? 0
            : operation.totalDurationMs / operation.count,
      },
    ]),
  );
}

function readEventLoopDelay(eventLoopDelay) {
  return {
    minMs: normalizeNanoseconds(eventLoopDelay.min),
    maxMs: normalizeNanoseconds(eventLoopDelay.max),
    meanMs: normalizeNanoseconds(eventLoopDelay.mean),
    p95Ms: normalizeNanoseconds(eventLoopDelay.percentile(95)),
    p99Ms: normalizeNanoseconds(eventLoopDelay.percentile(99)),
  };
}

function normalizeNanoseconds(value) {
  if (!Number.isFinite(value) || value === Number.MAX_SAFE_INTEGER) {
    return 0;
  }
  const milliseconds = value / 1_000_000;
  return Number.isFinite(milliseconds) && milliseconds < 1_000_000_000
    ? milliseconds
    : 0;
}

function classifyError(error) {
  const value =
    error instanceof Error
      ? `${error.name}:${error.message}`
      : String(error || 'unknown-error');
  if (/timeout|aborted|AbortError/i.test(value)) {
    return 'timeout';
  }
  if (/ECONNRESET|socket|fetch failed|AggregateError/i.test(value)) {
    return 'transport';
  }
  if (/status\s*4\d\d|tenant|auth|csrf|permission/i.test(value)) {
    return 'contract-4xx';
  }
  if (/status\s*5\d\d|server/i.test(value)) {
    return 'server-5xx';
  }
  return value.slice(0, 120);
}

module.exports = {
  createMetricsSampler,
  launchProductionServer,
  reservePort,
  runBuild,
  sampleProcessMetrics,
  startServerProcess,
  stopProductionServer,
  waitForHttp,
};
