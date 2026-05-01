const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

function reservePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Failed to reserve an available TCP port'));
        });
        return;
      }
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function runBuild(options) {
  const command = options.buildCommand || 'pnpm';
  const args = options.buildArgs || ['run', 'build'];
  const result = spawnSync(command, args, {
    cwd: options.appDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ...(options.env || {}),
    },
    encoding: 'utf8',
    stdio: options.inheritBuildStdio ? 'inherit' : 'pipe',
  });

  return {
    command,
    args,
    exitCode: result.status ?? 1,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function startServerProcess(options) {
  const command = options.serveCommand || 'pnpm';
  const args = options.serveArgs || ['run', 'serve'];
  const stdout = [];
  const stderr = [];
  const child = spawn(command, args, {
    cwd: options.appDir,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(options.port),
      ...(options.env || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', chunk => {
    stdout.push(String(chunk));
  });
  child.stderr.on('data', chunk => {
    stderr.push(String(chunk));
  });

  return {
    command,
    args,
    child,
    output() {
      return {
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      };
    },
  };
}

async function waitForHttp(url, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs || DEFAULT_STARTUP_TIMEOUT_MS;
  const intervalMs = options.intervalMs || 250;
  const expectedStatus =
    options.expectedStatus || (status => status >= 200 && status < 500);
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(options.requestTimeoutMs || 2_000),
      });
      if (expectedStatus(response.status)) {
        await response.arrayBuffer();
        return {
          ok: true,
          status: response.status,
          durationMs: Date.now() - startedAt,
        };
      }
      lastError = new Error(`Unexpected readiness status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  return {
    ok: false,
    durationMs: Date.now() - startedAt,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
}

async function launchProductionServer(options) {
  const port = options.port || (await reservePort(options.host));
  const baseUrl = `http://${options.host || '127.0.0.1'}:${port}`;
  const healthPath = options.healthPath || '/';
  const healthUrl = new URL(healthPath, baseUrl).toString();
  const build = options.skipBuild ? undefined : runBuild(options);
  if (build && build.exitCode !== 0) {
    throw new Error(
      `SuperApp build failed with exit code ${build.exitCode}\n${[
        build.stdout,
        build.stderr,
      ]
        .filter(Boolean)
        .join('\n')}`,
    );
  }

  const server = startServerProcess({
    ...options,
    port,
  });

  const readiness = await waitForHttp(healthUrl, {
    timeoutMs: options.startupTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
    expectedStatus: options.expectedHealthStatus,
  });

  if (!readiness.ok) {
    await stopProductionServer(server, {
      shutdownTimeoutMs: options.shutdownTimeoutMs,
    });
    const output = server.output();
    throw new Error(
      `SuperApp server did not become ready at ${healthUrl}: ${
        readiness.error || 'unknown readiness failure'
      }\n${[output.stdout, output.stderr].filter(Boolean).join('\n')}`,
    );
  }

  return {
    appDir: options.appDir,
    port,
    baseUrl,
    healthUrl,
    build,
    readiness,
    server,
    process: {
      pid: server.child.pid,
      command: server.command,
      args: server.args,
    },
  };
}

async function stopProductionServer(server, options = {}) {
  const child = server?.child || server?.server?.child;
  if (!child || child.killed || child.exitCode !== null) {
    return {
      stopped: true,
      alreadyExited: true,
    };
  }

  const timeoutMs = options.shutdownTimeoutMs || DEFAULT_SHUTDOWN_TIMEOUT_MS;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      killChild(child, 'SIGKILL');
      resolve({
        stopped: true,
        forced: true,
      });
    }, timeoutMs);
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        stopped: true,
        exitCode,
        signal,
      });
    });
    killChild(child, 'SIGTERM');
  });
}

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

function killChild(child, signal) {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to direct child kill.
    }
  }
  child.kill(signal);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
