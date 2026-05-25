#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const OVERLAYS = new Set([
  'none',
  'remote-unavailable',
  'version-skew',
  'design-system-bad-release',
  'service-unavailable',
]);
const MODES = new Set(['dry-run', 'live']);
const DEFAULT_READINESS_TIMEOUT_MS = 60000;
const DEFAULT_READINESS_INTERVAL_MS = 250;
const DEFAULT_READINESS_REQUEST_TIMEOUT_MS = 2000;
const DEFAULT_TEARDOWN_TIMEOUT_MS = 10000;
const PROCESS_LOG_TAIL_LIMIT = 4000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function packageFilter(packageName) {
  return packageName ? `--filter ${packageName}` : '';
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function portFromUrl(value) {
  if (!value) {
    return undefined;
  }
  try {
    return Number(new URL(value).port) || undefined;
  } catch {
    return undefined;
  }
}

function buildOwnerMap(workspace) {
  const ownershipPath = path.join(workspace, 'topology/ownership.json');
  if (!fs.existsSync(ownershipPath)) {
    return new Map();
  }
  return new Map(
    readJson(ownershipPath).owners.map(owner => [owner.id, owner]),
  );
}

function readDevelopmentOverlay(workspace) {
  const overlayPath = path.join(
    workspace,
    'topology/local-overlays/development.json',
  );
  return fs.existsSync(overlayPath) ? readJson(overlayPath) : {};
}

function processOverlay(devOverlay, id) {
  return {
    ...(devOverlay.processes?.[id] || {}),
    command: devOverlay.commands?.[id] || devOverlay.processes?.[id]?.command,
    env: {
      ...(devOverlay.env?.[id] || {}),
      ...(devOverlay.processes?.[id]?.env || {}),
    },
  };
}

function createProcessDescriptor(input) {
  const cwd = input.path ? normalize(input.path) : '.';
  const command =
    input.command || `pnpm ${packageFilter(input.package)} dev`.trim();
  const env = {
    ULTRAMODERN_CONTROL_PLANE_PROCESS_ID: input.id,
    ULTRAMODERN_CONTROL_PLANE_PROCESS_ROLE: input.role,
    ...(input.port ? { PORT: String(input.port) } : {}),
    ...(input.env || {}),
  };
  return {
    id: input.id,
    role: input.role,
    capabilities: input.capabilities || [],
    package: input.package,
    cwd,
    command,
    port: input.port,
    healthUrl:
      input.healthUrl ||
      (input.port ? `http://localhost:${input.port}/` : undefined),
    env,
    logs: {
      stdout: `.modern/superapp-local-control-plane/${input.id}/stdout.log`,
      stderr: `.modern/superapp-local-control-plane/${input.id}/stderr.log`,
    },
    readiness: {
      status: input.disabled ? 'disabled-by-overlay' : 'planned',
      timeoutMs: input.readinessTimeoutMs || DEFAULT_READINESS_TIMEOUT_MS,
    },
    teardown: {
      status: 'not-started',
    },
  };
}

function applyOverlay(processes, overlay) {
  if (overlay === 'none') {
    return processes;
  }
  return processes.map(process => {
    const next = {
      ...process,
      env: { ...process.env },
      readiness: { ...process.readiness },
    };
    if (overlay === 'remote-unavailable' && process.role === 'remote') {
      next.readiness.status = 'disabled-by-overlay';
      next.env.ULTRAMODERN_REMOTE_UNAVAILABLE = '1';
    }
    if (
      overlay === 'version-skew' &&
      (process.role === 'shell' || process.role === 'remote')
    ) {
      next.env.ULTRAMODERN_VERSION_SKEW = '1';
    }
    if (
      overlay === 'design-system-bad-release' &&
      process.role === 'design-system-remote'
    ) {
      next.env.ULTRAMODERN_DESIGN_SYSTEM_BAD_RELEASE = '1';
      next.readiness.status = 'disabled-by-overlay';
    }
    if (
      overlay === 'service-unavailable' &&
      (process.role === 'effect-service' ||
        process.capabilities.includes('effect-bff'))
    ) {
      next.env.ULTRAMODERN_SERVICE_UNAVAILABLE = '1';
      next.readiness.status = 'disabled-by-overlay';
    }
    return next;
  });
}

function createLocalControlPlanePlan(options = {}) {
  const workspace = path.resolve(options.workspace || process.cwd());
  const topologyPath = path.resolve(
    workspace,
    options.topology || 'topology/reference-topology.json',
  );
  const overlay = options.overlay || 'none';
  const mode = options.mode || 'dry-run';
  if (!OVERLAYS.has(overlay)) {
    throw new Error(`Unsupported local control-plane overlay: ${overlay}`);
  }
  if (!MODES.has(mode)) {
    throw new Error(`Unsupported local control-plane mode: ${mode}`);
  }
  const topology = readJson(topologyPath);
  const owners = buildOwnerMap(workspace);
  const devOverlay = readDevelopmentOverlay(workspace);
  const processes = [];
  const shellOwner = owners.get(topology.shell?.id);
  const shellOverlay = processOverlay(devOverlay, topology.shell.id);
  processes.push(
    createProcessDescriptor({
      id: topology.shell.id,
      role: 'shell',
      package: topology.shell.package,
      path: shellOwner?.path,
      command: shellOverlay.command,
      port: shellOverlay.port || devOverlay.ports?.[topology.shell.id],
      healthUrl: shellOverlay.healthUrl,
      env: shellOverlay.env,
      readinessTimeoutMs: shellOverlay.readinessTimeoutMs,
    }),
  );
  for (const remote of topology.remotes || []) {
    const owner = owners.get(remote.id);
    const remoteOverlay = processOverlay(devOverlay, remote.id);
    processes.push(
      createProcessDescriptor({
        id: remote.id,
        role:
          remote.kind === 'horizontal-design-system'
            ? 'design-system-remote'
            : 'remote',
        capabilities: remote.api?.effect
          ? ['module-federation', 'effect-bff']
          : ['module-federation'],
        package: remote.package,
        path: owner?.path,
        command: remoteOverlay.command,
        port:
          remoteOverlay.port ||
          devOverlay.ports?.[remote.id] ||
          portFromUrl(remote.moduleFederation?.manifestUrl),
        healthUrl: remoteOverlay.healthUrl,
        env: remoteOverlay.env,
        readinessTimeoutMs: remoteOverlay.readinessTimeoutMs,
      }),
    );
  }
  for (const service of topology.effectServices || []) {
    const owner = owners.get(service.id);
    const serviceOverlay = processOverlay(devOverlay, service.id);
    processes.push(
      createProcessDescriptor({
        id: service.id,
        role: 'effect-service',
        capabilities: ['effect-bff'],
        package: service.package,
        path: owner?.path,
        command: serviceOverlay.command,
        port: serviceOverlay.port || devOverlay.ports?.[service.id],
        healthUrl:
          serviceOverlay.healthUrl ||
          devOverlay.services?.[service.id] ||
          (devOverlay.ports?.[service.id]
            ? `http://localhost:${devOverlay.ports[service.id]}/`
            : undefined),
        env: serviceOverlay.env,
        readinessTimeoutMs: serviceOverlay.readinessTimeoutMs,
      }),
    );
  }
  const plannedProcesses = applyOverlay(processes, overlay);
  return {
    schemaVersion: 1,
    mode,
    workspace,
    topology: normalize(path.relative(workspace, topologyPath)),
    overlay,
    processes: plannedProcesses,
    summary: {
      total: plannedProcesses.length,
      planned: plannedProcesses.filter(
        process => process.readiness.status === 'planned',
      ).length,
      disabled: plannedProcesses.filter(
        process => process.readiness.status === 'disabled-by-overlay',
      ).length,
    },
  };
}

function absoluteWorkspacePath(workspace, relativePath) {
  return path.resolve(workspace, relativePath);
}

function ensureLogCapture(workspace, descriptor) {
  const stdoutPath = absoluteWorkspacePath(workspace, descriptor.logs.stdout);
  const stderrPath = absoluteWorkspacePath(workspace, descriptor.logs.stderr);
  fs.mkdirSync(path.dirname(stdoutPath), { recursive: true });
  fs.writeFileSync(stdoutPath, '');
  fs.writeFileSync(stderrPath, '');

  const tails = {
    stdout: '',
    stderr: '',
  };
  const append = (stream, filePath, chunk) => {
    const text = String(chunk);
    fs.appendFileSync(filePath, text);
    tails[stream] = `${tails[stream]}${text}`.slice(-PROCESS_LOG_TAIL_LIMIT);
  };

  return {
    stdoutPath,
    stderrPath,
    appendStdout: chunk => append('stdout', stdoutPath, chunk),
    appendStderr: chunk => append('stderr', stderrPath, chunk),
    outputTail() {
      return { ...tails };
    },
  };
}

function createFailure(processDescriptor, classification, message, extra = {}) {
  return {
    processId: processDescriptor.id,
    role: processDescriptor.role,
    classification,
    message,
    logs: processDescriptor.logs,
    ...extra,
  };
}

function commandNeedsWorkspaceInstall(command) {
  return /^pnpm(?:\s|$)/.test(command);
}

function preflightLiveProcess(workspace, processDescriptor) {
  const cwd = absoluteWorkspacePath(workspace, processDescriptor.cwd);
  if (!fs.existsSync(cwd)) {
    return createFailure(
      processDescriptor,
      'missing-cwd',
      `Process cwd does not exist: ${normalize(path.relative(workspace, cwd))}`,
    );
  }
  if (!processDescriptor.healthUrl) {
    return createFailure(
      processDescriptor,
      'readiness-not-configured',
      `Process ${processDescriptor.id} does not have a readiness health URL.`,
    );
  }
  if (
    commandNeedsWorkspaceInstall(processDescriptor.command) &&
    !fs.existsSync(path.join(workspace, 'node_modules'))
  ) {
    return createFailure(
      processDescriptor,
      'missing-install',
      'Live mode requires package installation before running pnpm dev commands. Run pnpm install in the generated workspace, or provide explicit spawn-safe commands in topology/local-overlays/development.json.',
    );
  }
  return undefined;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHttp(url, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs || DEFAULT_READINESS_TIMEOUT_MS;
  const intervalMs = options.intervalMs || DEFAULT_READINESS_INTERVAL_MS;
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    if (options.exitInfo?.exited) {
      return {
        ok: false,
        durationMs: Date.now() - startedAt,
        classification: 'process-exited-before-ready',
        error: `Process exited before readiness with exit code ${
          options.exitInfo.exitCode ?? 'null'
        }${
          options.exitInfo.signal
            ? ` and signal ${options.exitInfo.signal}`
            : ''
        }`,
      };
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(
          options.requestTimeoutMs || DEFAULT_READINESS_REQUEST_TIMEOUT_MS,
        ),
      });
      await response.arrayBuffer();
      if (response.status >= 200 && response.status < 400) {
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
    classification: 'readiness-timeout',
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
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

function stopChildProcess(child, timeoutMs = DEFAULT_TEARDOWN_TIMEOUT_MS) {
  if (!child || child.killed || child.exitCode !== null) {
    return Promise.resolve({
      status: 'stopped',
      stopped: true,
      alreadyExited: true,
      exitCode: child?.exitCode,
      signal: child?.signalCode,
    });
  }

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      killChild(child, 'SIGKILL');
      resolve({
        status: 'stopped',
        stopped: true,
        forced: true,
      });
    }, timeoutMs);
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        status: 'stopped',
        stopped: true,
        exitCode,
        signal,
      });
    });
    killChild(child, 'SIGTERM');
  });
}

function summarizeLive(processes) {
  return {
    total: processes.length,
    planned: processes.filter(
      processDescriptor =>
        processDescriptor.readiness.status !== 'disabled-by-overlay',
    ).length,
    disabled: processes.filter(
      processDescriptor =>
        processDescriptor.readiness.status === 'disabled-by-overlay',
    ).length,
    ready: processes.filter(
      processDescriptor => processDescriptor.readiness.status === 'ready',
    ).length,
    failed: processes.filter(
      processDescriptor => processDescriptor.readiness.status === 'failed',
    ).length,
    teardownFailed: processes.filter(
      processDescriptor => processDescriptor.teardown.status === 'failed',
    ).length,
  };
}

async function runLiveLocalControlPlane(plan, options = {}) {
  const processes = plan.processes.map(processDescriptor => ({
    ...processDescriptor,
    env: { ...processDescriptor.env },
    readiness: { ...processDescriptor.readiness },
    teardown: { ...processDescriptor.teardown },
  }));
  const launched = [];
  const failures = [];
  const launchable = [];

  try {
    for (const processDescriptor of processes) {
      if (processDescriptor.readiness.status === 'disabled-by-overlay') {
        processDescriptor.teardown.status = 'skipped';
        continue;
      }

      const preconditionFailure = preflightLiveProcess(
        plan.workspace,
        processDescriptor,
      );
      if (preconditionFailure) {
        processDescriptor.readiness = {
          ...processDescriptor.readiness,
          status: 'failed',
          classification: preconditionFailure.classification,
          error: preconditionFailure.message,
        };
        processDescriptor.teardown.status = 'skipped';
        failures.push(preconditionFailure);
        continue;
      }

      launchable.push(processDescriptor);
    }

    if (failures.length > 0) {
      return {
        ...plan,
        processes,
        summary: summarizeLive(processes),
        status: 'fail',
        failures,
      };
    }

    for (const processDescriptor of launchable) {
      const cwd = absoluteWorkspacePath(plan.workspace, processDescriptor.cwd);
      const logs = ensureLogCapture(plan.workspace, processDescriptor);
      const exitInfo = { exited: false };
      const child = spawn(processDescriptor.command, {
        cwd,
        detached: process.platform !== 'win32',
        env: {
          ...global.process.env,
          ...processDescriptor.env,
        },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', logs.appendStdout);
      child.stderr?.on('data', logs.appendStderr);
      child.once('error', error => {
        logs.appendStderr(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
      child.once('exit', (exitCode, signal) => {
        exitInfo.exited = true;
        exitInfo.exitCode = exitCode;
        exitInfo.signal = signal;
      });

      processDescriptor.pid = child.pid;
      processDescriptor.logs = {
        ...processDescriptor.logs,
        stdoutPath: logs.stdoutPath,
        stderrPath: logs.stderrPath,
      };
      launched.push({ child, exitInfo, logs, processDescriptor });
    }

    const readinessResults = await Promise.all(
      launched.map(async launchedProcess => {
        const { processDescriptor } = launchedProcess;
        const readiness = await waitForHttp(processDescriptor.healthUrl, {
          timeoutMs: parseNumber(
            options.readinessTimeoutMs,
            processDescriptor.readiness.timeoutMs,
          ),
          intervalMs: parseNumber(
            options.readinessIntervalMs,
            DEFAULT_READINESS_INTERVAL_MS,
          ),
          requestTimeoutMs: parseNumber(
            options.readinessRequestTimeoutMs,
            DEFAULT_READINESS_REQUEST_TIMEOUT_MS,
          ),
          exitInfo: launchedProcess.exitInfo,
        });
        return { ...launchedProcess, readiness };
      }),
    );

    for (const { logs, processDescriptor, readiness } of readinessResults) {
      processDescriptor.readiness = {
        ...processDescriptor.readiness,
        ...readiness,
        checkedAt: new Date().toISOString(),
        healthUrl: processDescriptor.healthUrl,
        status: readiness.ok ? 'ready' : 'failed',
      };
      if (!readiness.ok) {
        const classification = readiness.classification || 'readiness-failed';
        failures.push(
          createFailure(
            processDescriptor,
            classification,
            `Process ${processDescriptor.id} did not become ready at ${
              processDescriptor.healthUrl
            }: ${readiness.error || 'unknown readiness failure'}`,
            { outputTail: logs.outputTail() },
          ),
        );
      }
    }
  } finally {
    for (const launchedProcess of launched.reverse()) {
      const teardown = await stopChildProcess(
        launchedProcess.child,
        parseNumber(options.teardownTimeoutMs, DEFAULT_TEARDOWN_TIMEOUT_MS),
      );
      launchedProcess.processDescriptor.teardown = {
        ...teardown,
        finishedAt: new Date().toISOString(),
      };
      if (!teardown.stopped) {
        launchedProcess.processDescriptor.teardown.status = 'failed';
        failures.push(
          createFailure(
            launchedProcess.processDescriptor,
            'teardown-failed',
            `Process ${launchedProcess.processDescriptor.id} did not teardown cleanly.`,
            { teardown },
          ),
        );
      }
    }
  }

  const summary = summarizeLive(processes);
  return {
    ...plan,
    processes,
    summary,
    status:
      failures.length === 0 &&
      summary.failed === 0 &&
      summary.teardownFailed === 0
        ? 'pass'
        : 'fail',
    failures,
  };
}

async function runLocalControlPlane(options = {}) {
  const plan = createLocalControlPlanePlan(options);
  if (plan.mode !== 'live') {
    return plan;
  }
  return runLiveLocalControlPlane(plan, options);
}

function parseArgs(argv) {
  const options = {
    workspace: process.cwd(),
    topology: 'topology/reference-topology.json',
    overlay: 'none',
    mode: 'dry-run',
    json: false,
    readinessTimeoutMs: DEFAULT_READINESS_TIMEOUT_MS,
    readinessIntervalMs: DEFAULT_READINESS_INTERVAL_MS,
    readinessRequestTimeoutMs: DEFAULT_READINESS_REQUEST_TIMEOUT_MS,
    teardownTimeoutMs: DEFAULT_TEARDOWN_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      options.workspace = argv[++index];
    } else if (arg === '--topology') {
      options.topology = argv[++index];
    } else if (arg === '--overlay') {
      options.overlay = argv[++index];
    } else if (arg === '--mode') {
      options.mode = argv[++index];
    } else if (arg === '--readiness-timeout-ms') {
      options.readinessTimeoutMs = parseNumber(
        argv[++index],
        DEFAULT_READINESS_TIMEOUT_MS,
      );
    } else if (arg === '--readiness-interval-ms') {
      options.readinessIntervalMs = parseNumber(
        argv[++index],
        DEFAULT_READINESS_INTERVAL_MS,
      );
    } else if (arg === '--readiness-request-timeout-ms') {
      options.readinessRequestTimeoutMs = parseNumber(
        argv[++index],
        DEFAULT_READINESS_REQUEST_TIMEOUT_MS,
      );
    } else if (arg === '--teardown-timeout-ms') {
      options.teardownTimeoutMs = parseNumber(
        argv[++index],
        DEFAULT_TEARDOWN_TIMEOUT_MS,
      );
    } else if (arg === '--json') {
      options.json = true;
    }
  }
  return options;
}

function renderHuman(plan) {
  return [
    `UltraModern local control plane: ${plan.mode}`,
    `Overlay: ${plan.overlay}`,
    `Processes: ${plan.summary.planned}/${plan.summary.total} planned`,
    ...plan.processes.map(
      process =>
        `- ${process.role} ${process.id}: ${process.command} (${process.readiness.status})`,
    ),
    ...(plan.failures || []).map(
      failure =>
        `! ${failure.processId}: ${failure.classification} - ${failure.message}`,
    ),
  ].join('\n');
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  runLocalControlPlane(options)
    .then(result => {
      process.stdout.write(
        options.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `${renderHuman(result)}\n`,
      );
      if (result.mode === 'live') {
        process.exitCode = result.status === 'pass' ? 0 : 1;
      }
    })
    .catch(error => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  OVERLAYS,
  MODES,
  createLocalControlPlanePlan,
  runLocalControlPlane,
  waitForHttp,
  renderHuman,
};
