const { Worker } = require('node:worker_threads');
const { summarizeLatencies } = require('./stats');

const CACHE_VERSION_QUERY_KEY = 'mfv';
const RELATIVE_BASE_URL = 'https://modernjs.local';

const isAbsoluteHttpUrl = entry => /^https?:\/\//i.test(entry);
const isProtocolRelativeUrl = entry => /^\/\//.test(entry);

const toVersionToken = value => encodeURIComponent(String(value).slice(0, 256));

const resolveVersionToken = (app, options) =>
  app.runtimeDigest ||
  app.runtimeMetadata?.runtimeDigest ||
  app.integrity ||
  app.runtimeMetadata?.integrity ||
  options.manifestRuntimeDigest ||
  options.globalRuntimeDigest;

const applyVersionQuery = (entry, token) => {
  let parsed;
  try {
    parsed = new URL(entry, RELATIVE_BASE_URL);
  } catch (_error) {
    return entry;
  }

  if (parsed.searchParams.get(CACHE_VERSION_QUERY_KEY) === token) {
    return entry;
  }

  parsed.searchParams.set(CACHE_VERSION_QUERY_KEY, token);

  if (isAbsoluteHttpUrl(entry)) {
    return parsed.toString();
  }

  if (isProtocolRelativeUrl(entry)) {
    return `//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  const relativePath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (entry.startsWith('/')) {
    return relativePath;
  }
  return relativePath.replace(/^\//, '');
};

const applyCachePolicyMainThread = (
  apps,
  options = {
    manifestRuntimeDigest: undefined,
    globalRuntimeDigest: undefined,
  },
) =>
  apps.map(app => {
    const version = resolveVersionToken(app, options);
    if (!version || !app.entry) {
      return app;
    }

    const pinnedEntry = applyVersionQuery(app.entry, toVersionToken(version));
    if (pinnedEntry === app.entry) {
      return app;
    }

    return {
      ...app,
      entry: pinnedEntry,
    };
  });

const buildBenchmarkApps = appCount =>
  Array.from({ length: Math.max(1, appCount) }, (_, index) => ({
    name: `benchmark-app-${String(index)}`,
    entry: `https://benchmark.example.com/remotes/app-${String(index)}/remoteEntry.js`,
    runtimeDigest: `runtime-digest-${String(index)}`,
  }));

const WORKER_SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');

const CACHE_VERSION_QUERY_KEY = 'mfv';
const RELATIVE_BASE_URL = 'https://modernjs.local';
const isAbsoluteHttpUrl = entry => /^https?:\\/\\//i.test(entry);
const isProtocolRelativeUrl = entry => /^\\/\\//.test(entry);
const toVersionToken = value => encodeURIComponent(String(value).slice(0, 256));
const resolveVersionToken = (app, options) =>
  app.runtimeDigest ||
  (app.runtimeMetadata && app.runtimeMetadata.runtimeDigest) ||
  app.integrity ||
  (app.runtimeMetadata && app.runtimeMetadata.integrity) ||
  options.manifestRuntimeDigest ||
  options.globalRuntimeDigest;
const applyVersionQuery = (entry, token) => {
  let parsed;
  try {
    parsed = new URL(entry, RELATIVE_BASE_URL);
  } catch (_error) {
    return entry;
  }
  if (parsed.searchParams.get(CACHE_VERSION_QUERY_KEY) === token) {
    return entry;
  }
  parsed.searchParams.set(CACHE_VERSION_QUERY_KEY, token);
  if (isAbsoluteHttpUrl(entry)) {
    return parsed.toString();
  }
  if (isProtocolRelativeUrl(entry)) {
    return \`//\${parsed.host}\${parsed.pathname}\${parsed.search}\${parsed.hash}\`;
  }
  const relativePath = \`\${parsed.pathname}\${parsed.search}\${parsed.hash}\`;
  if (entry.startsWith('/')) {
    return relativePath;
  }
  return relativePath.replace(/^\\//, '');
};

const applyCachePolicy = (apps, options) =>
  apps.map(app => {
    const version = resolveVersionToken(app, options);
    if (!version || !app.entry) {
      return app;
    }
    const pinnedEntry = applyVersionQuery(app.entry, toVersionToken(version));
    if (pinnedEntry === app.entry) {
      return app;
    }
    return {
      ...app,
      entry: pinnedEntry,
    };
  });

try {
  const transformed = applyCachePolicy(workerData.apps || [], workerData.options || {});
  parentPort.postMessage({ ok: true, apps: transformed });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error && error.message ? error.message : String(error),
  });
}
`;

const runWorkerTransform = ({ apps, options, timeoutMs }) =>
  new Promise(resolve => {
    let settled = false;
    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      workerData: {
        apps,
        options,
      },
    });

    const finish = result => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {
        // best-effort worker cleanup
      });
      resolve(result);
    };

    const timer = setTimeout(
      () => {
        finish({
          ok: false,
          error: 'worker_lane_timeout',
        });
      },
      Math.max(25, timeoutMs),
    );

    worker.once('message', message => {
      if (message && message.ok === true && Array.isArray(message.apps)) {
        finish({
          ok: true,
          apps: message.apps,
        });
        return;
      }
      finish({
        ok: false,
        error:
          message && typeof message === 'object' && 'error' in message
            ? String(message.error || 'worker_lane_failed')
            : 'worker_lane_failed',
      });
    });

    worker.once('error', error => {
      finish({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    worker.once('exit', code => {
      if (settled || code === 0) {
        return;
      }
      finish({
        ok: false,
        error: `worker_lane_exit_${String(code)}`,
      });
    });
  });

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

const summarizeWorkerLaneResults = (results, thresholds) => {
  const latencies = results.map(item => item.latencyMs);
  const fallbackCount = results.filter(
    item => item.fallbackToMainThread,
  ).length;
  const workerUsedCount = results.filter(item => item.workerUsed).length;
  const errorKinds = {};
  results
    .filter(item => item.error)
    .forEach(item => {
      const key = String(item.error);
      errorKinds[key] = (errorKinds[key] || 0) + 1;
    });

  const fallbackRate =
    results.length === 0 ? 0 : fallbackCount / results.length;
  const latenciesSummary = summarizeLatencies(latencies);
  const gate = {
    maxFallbackRate: thresholds.maxFallbackRate,
    maxP95Ms: thresholds.maxP95Ms,
    fallbackRate,
    p95: latenciesSummary.p95,
    passed:
      fallbackRate <= thresholds.maxFallbackRate &&
      latenciesSummary.p95 <= thresholds.maxP95Ms,
  };

  return {
    totals: {
      requests: results.length,
      ok: results.length,
      failed: 0,
      failureRate: 0,
      workerUsed: workerUsedCount,
      fallbackToMainThread: fallbackCount,
      fallbackRate,
    },
    latencies: latenciesSummary,
    errorKinds,
    gate,
  };
};

const runWorkerLaneBenchmark = async ({
  iterations,
  concurrency,
  appCount,
  timeoutMs,
  minAppCount,
  workerLaneEnabled,
  maxFallbackRate,
  maxP95Ms,
}) => {
  const apps = buildBenchmarkApps(appCount);
  const workerLaneEligible = workerLaneEnabled && apps.length >= minAppCount;

  const results = await runConcurrent({
    iterations,
    concurrency,
    worker: async () => {
      const start = performance.now();
      const options = {
        manifestRuntimeDigest: undefined,
        globalRuntimeDigest: undefined,
      };

      if (!workerLaneEligible) {
        applyCachePolicyMainThread(apps, options);
        return {
          workerUsed: false,
          fallbackToMainThread: false,
          latencyMs: performance.now() - start,
        };
      }

      const workerResult = await runWorkerTransform({
        apps,
        options,
        timeoutMs,
      });
      if (workerResult.ok) {
        return {
          workerUsed: true,
          fallbackToMainThread: false,
          latencyMs: performance.now() - start,
        };
      }

      applyCachePolicyMainThread(apps, options);
      return {
        workerUsed: false,
        fallbackToMainThread: true,
        error: workerResult.error,
        latencyMs: performance.now() - start,
      };
    },
  });

  const summary = summarizeWorkerLaneResults(results, {
    maxFallbackRate,
    maxP95Ms,
  });

  return {
    eligible: workerLaneEligible,
    ...summary,
  };
};

module.exports = {
  applyCachePolicyMainThread,
  buildBenchmarkApps,
  runWorkerLaneBenchmark,
};
