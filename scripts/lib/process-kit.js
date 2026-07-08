/**
 * Shared process and server lifecycle helpers for fork-owned script runners.
 */
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

function createProcessEnv(overrides = {}) {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    ...overrides,
  };
}

function writeStream(stream, message) {
  return new Promise((resolve, reject) => {
    stream.write(message, error => (error ? reject(error) : resolve()));
  });
}

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

function runCommand(command, args = [], options = {}) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new Error('Command must be a non-empty string');
  }
  if (!Array.isArray(args)) {
    throw new Error('Command args must be an array');
  }

  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || 'inherit',
  });

  return {
    command,
    args,
    processStatus: result.status,
    exitCode: result.status ?? 1,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    durationMs: Date.now() - startedAt,
  };
}

function runShellCommand(command, options = {}) {
  // Compatibility export name only: this intentionally does not invoke a shell.
  return runCommand(command, [], options);
}

function normalizeCommandEntry(entry, fallbackCwd) {
  const item = Array.isArray(entry)
    ? { command: entry[0], args: entry.slice(1) }
    : entry;
  if (!item || typeof item.command !== 'string' || item.command.length === 0) {
    throw new Error('Command entry must include a command string');
  }
  if (item.args !== undefined && !Array.isArray(item.args)) {
    throw new Error('Command entry args must be an array');
  }
  return {
    ...item,
    args: item.args || [],
    cwd: item.cwd || fallbackCwd || process.cwd(),
  };
}

function runCommandList(commands, options = {}) {
  const results = [];
  for (const entry of commands) {
    const item = normalizeCommandEntry(entry, options.cwd);
    if (options.dryRun) {
      results.push({
        ...item,
        status: 'planned',
        exitCode: 0,
        durationMs: 0,
      });
      continue;
    }

    if (typeof options.onCommandStart === 'function') {
      options.onCommandStart(item);
    }

    const result = runCommand(item.command, item.args, {
      cwd: item.cwd,
      env: item.env,
      stdio: options.stdio,
    });
    const passed = result.exitCode === 0 && !result.error;
    const itemResult = {
      ...item,
      status: passed ? 'passed' : 'failed',
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
    };
    if (options.includeProcessStatus) {
      itemResult.processStatus = result.processStatus;
    }
    if (options.includeErrors && result.error) {
      itemResult.error = result.error;
    }
    results.push(itemResult);

    if (!passed && !options.continueOnError) {
      break;
    }
  }
  return results;
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
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_STARTUP_TIMEOUT_MS,
  createProcessEnv,
  killChild,
  launchProductionServer,
  reservePort,
  runBuild,
  runCommand,
  runCommandList,
  runShellCommand,
  sleep,
  startServerProcess,
  stopProductionServer,
  waitForHttp,
  writeStream,
};
