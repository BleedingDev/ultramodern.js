#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { summarizeLatencies } = require('./stats');
const { runWorkerLaneBenchmark } = require('./workerLane');

const DEFAULTS = {
  statusEndpoint: 'http://127.0.0.1:8080/_modern/runtime/status',
  fallbackEndpoint:
    'http://127.0.0.1:8080/_modern/contract-gates/runtime-fallback',
  iterations: 20,
  concurrency: 4,
  timeoutMs: 5000,
  jitterMs: 0,
  appName: 'benchmark-shell',
  entry: 'https://benchmark.local/remoteEntry.js',
  outputPath: '.modern/runtime-resilience-benchmark.json',
  mode: 'status-and-fallback',
  workerLaneEnabled: false,
  workerLaneAppCount: 256,
  workerLaneTimeoutMs: 1_000,
  workerLaneMinAppCount: 64,
  workerLaneMaxFallbackRate: 0.2,
  workerLaneMaxP95Ms: 2_500,
  failOnWorkerLaneGate: false,
};

const parseArgs = argv => {
  const parsed = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--status-endpoint':
        parsed.statusEndpoint = argv[i + 1];
        i += 1;
        break;
      case '--fallback-endpoint':
        parsed.fallbackEndpoint = argv[i + 1];
        i += 1;
        break;
      case '--iterations':
        parsed.iterations = Number.parseInt(argv[i + 1], 10);
        i += 1;
        break;
      case '--concurrency':
        parsed.concurrency = Number.parseInt(argv[i + 1], 10);
        i += 1;
        break;
      case '--timeout-ms':
        parsed.timeoutMs = Number.parseInt(argv[i + 1], 10);
        i += 1;
        break;
      case '--jitter-ms':
        parsed.jitterMs = Number.parseInt(argv[i + 1], 10);
        i += 1;
        break;
      case '--app-name':
        parsed.appName = argv[i + 1];
        i += 1;
        break;
      case '--entry':
        parsed.entry = argv[i + 1];
        i += 1;
        break;
      case '--output':
        parsed.outputPath = argv[i + 1];
        i += 1;
        break;
      case '--mode':
        parsed.mode = argv[i + 1];
        i += 1;
        break;
      case '--worker-lane-enabled':
        parsed.workerLaneEnabled = true;
        break;
      case '--worker-lane-app-count':
        parsed.workerLaneAppCount = Number.parseInt(argv[i + 1], 10);
        i += 1;
        break;
      case '--worker-lane-timeout-ms':
        parsed.workerLaneTimeoutMs = Number.parseInt(argv[i + 1], 10);
        i += 1;
        break;
      case '--worker-lane-min-app-count':
        parsed.workerLaneMinAppCount = Number.parseInt(argv[i + 1], 10);
        i += 1;
        break;
      case '--worker-lane-max-fallback-rate':
        parsed.workerLaneMaxFallbackRate = Number.parseFloat(argv[i + 1]);
        i += 1;
        break;
      case '--worker-lane-max-p95-ms':
        parsed.workerLaneMaxP95Ms = Number.parseInt(argv[i + 1], 10);
        i += 1;
        break;
      case '--fail-on-worker-lane-gate':
        parsed.failOnWorkerLaneGate = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.iterations = Number.isFinite(parsed.iterations)
    ? Math.max(1, parsed.iterations)
    : DEFAULTS.iterations;
  parsed.concurrency = Number.isFinite(parsed.concurrency)
    ? Math.max(1, parsed.concurrency)
    : DEFAULTS.concurrency;
  parsed.timeoutMs = Number.isFinite(parsed.timeoutMs)
    ? Math.max(100, parsed.timeoutMs)
    : DEFAULTS.timeoutMs;
  parsed.jitterMs = Number.isFinite(parsed.jitterMs)
    ? Math.max(0, parsed.jitterMs)
    : DEFAULTS.jitterMs;
  parsed.workerLaneAppCount = Number.isFinite(parsed.workerLaneAppCount)
    ? Math.max(1, parsed.workerLaneAppCount)
    : DEFAULTS.workerLaneAppCount;
  parsed.workerLaneTimeoutMs = Number.isFinite(parsed.workerLaneTimeoutMs)
    ? Math.max(25, parsed.workerLaneTimeoutMs)
    : DEFAULTS.workerLaneTimeoutMs;
  parsed.workerLaneMinAppCount = Number.isFinite(parsed.workerLaneMinAppCount)
    ? Math.max(1, parsed.workerLaneMinAppCount)
    : DEFAULTS.workerLaneMinAppCount;
  parsed.workerLaneMaxFallbackRate = Number.isFinite(
    parsed.workerLaneMaxFallbackRate,
  )
    ? Math.max(0, Math.min(1, parsed.workerLaneMaxFallbackRate))
    : DEFAULTS.workerLaneMaxFallbackRate;
  parsed.workerLaneMaxP95Ms = Number.isFinite(parsed.workerLaneMaxP95Ms)
    ? Math.max(1, parsed.workerLaneMaxP95Ms)
    : DEFAULTS.workerLaneMaxP95Ms;

  return parsed;
};

const sleep = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const withTimeout = async (url, init, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const requestStatus = async options => {
  const start = performance.now();
  try {
    const response = await withTimeout(
      options.statusEndpoint,
      {
        method: 'GET',
      },
      options.timeoutMs,
    );
    await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: performance.now() - start,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const requestFallbackSignal = async (options, index) => {
  const payload = {
    appName: options.appName,
    reason: `benchmark_runtime_fallback_${index}`,
    phase: 'benchmark',
    entry: options.entry,
  };
  const start = performance.now();
  try {
    const response = await withTimeout(
      options.fallbackEndpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      options.timeoutMs,
    );
    await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: performance.now() - start,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const runConcurrent = async ({ iterations, concurrency, worker }) => {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < iterations) {
      const index = cursor;
      cursor += 1;
      results.push(await worker(index));
    }
  });
  await Promise.all(workers);
  return results;
};

const summarizeResult = results => {
  const latencies = results.map(item => item.latencyMs);
  const okCount = results.filter(item => item.ok).length;
  const nonOkStatuses = results
    .filter(item => !item.ok)
    .map(item => item.status || 0);
  return {
    totals: {
      requests: results.length,
      ok: okCount,
      failed: results.length - okCount,
      failureRate:
        results.length === 0 ? 0 : (results.length - okCount) / results.length,
    },
    latencies: summarizeLatencies(latencies),
    nonOkStatuses,
  };
};

const run = async options => {
  const shouldRunStatus =
    options.mode === 'status-only' ||
    options.mode === 'status-and-fallback' ||
    options.mode === 'full';
  const shouldRunFallback =
    options.mode === 'fallback-only' ||
    options.mode === 'status-and-fallback' ||
    options.mode === 'full';
  const shouldRunWorkerLane =
    options.workerLaneEnabled === true ||
    options.mode === 'worker-lane-only' ||
    options.mode === 'full';

  const statusResults = shouldRunStatus
    ? await runConcurrent({
        iterations: options.iterations,
        concurrency: options.concurrency,
        worker: async () => {
          if (options.jitterMs > 0) {
            await sleep(Math.floor(Math.random() * options.jitterMs));
          }
          return requestStatus(options);
        },
      })
    : [];

  const fallbackResults = shouldRunFallback
    ? await runConcurrent({
        iterations: options.iterations,
        concurrency: options.concurrency,
        worker: async index => {
          if (options.jitterMs > 0) {
            await sleep(Math.floor(Math.random() * options.jitterMs));
          }
          return requestFallbackSignal(options, index);
        },
      })
    : [];

  const workerLanePhase = shouldRunWorkerLane
    ? await runWorkerLaneBenchmark({
        iterations: options.iterations,
        concurrency: options.concurrency,
        appCount: options.workerLaneAppCount,
        timeoutMs: options.workerLaneTimeoutMs,
        minAppCount: options.workerLaneMinAppCount,
        workerLaneEnabled: shouldRunWorkerLane,
        maxFallbackRate: options.workerLaneMaxFallbackRate,
        maxP95Ms: options.workerLaneMaxP95Ms,
      })
    : {
        eligible: false,
        totals: {
          requests: 0,
          ok: 0,
          failed: 0,
          failureRate: 0,
          workerUsed: 0,
          fallbackToMainThread: 0,
          fallbackRate: 0,
        },
        latencies: summarizeLatencies([]),
        errorKinds: {},
        gate: {
          maxFallbackRate: options.workerLaneMaxFallbackRate,
          maxP95Ms: options.workerLaneMaxP95Ms,
          fallbackRate: 0,
          p95: 0,
          passed: true,
        },
      };

  if (
    shouldRunWorkerLane &&
    options.failOnWorkerLaneGate &&
    workerLanePhase.gate.passed !== true
  ) {
    throw new Error(
      `worker lane benchmark gate failed: fallbackRate=${String(workerLanePhase.gate.fallbackRate)} p95=${String(workerLanePhase.gate.p95)}`,
    );
  }

  const report = {
    schemaVersion: 1,
    generatedAt: Date.now(),
    options: {
      ...options,
    },
    statusPhase: summarizeResult(statusResults),
    fallbackPhase: summarizeResult(fallbackResults),
    workerLanePhase,
  };

  const outputPath = path.resolve(options.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return {
    outputPath,
    report,
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const result = await run(options);
  console.log(
    `[runtime-resilience-benchmark] completed:\n${JSON.stringify(
      {
        outputPath: result.outputPath,
        statusPhase: result.report.statusPhase,
        fallbackPhase: result.report.fallbackPhase,
        workerLanePhase: result.report.workerLanePhase,
      },
      null,
      2,
    )}`,
  );
};

main().catch(error => {
  console.error(
    `[runtime-resilience-benchmark] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
