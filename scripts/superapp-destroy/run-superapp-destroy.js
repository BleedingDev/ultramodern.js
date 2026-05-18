#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  stopProductionServer,
  waitForHttp,
} = require('../superapp-certification/production-server-controller');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_APP_DIR = 'tests/integration/superapp-portfolio';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;
const DEFAULT_HEALTH_PATH = '/';
const DEFAULT_PROFILE = 'smoke';
const DEFAULT_OUTPUT_ROOT = '.modern/superapp-destroy';
const DEFAULT_WARMUP_MS = 5_000;
const DEFAULT_LOAD_DURATION_MS = 30_000;
const DEFAULT_LOAD_CONCURRENCY = 16;
const DEFAULT_SOAK_PROFILE = 'local-15m';
const REQUIRED_THRESHOLD_KEYS = [
  'p95LatencyMs',
  'p99LatencyMs',
  'maxLatencyMs',
  'errorRate',
  'eventLoopDelayMs',
  'memoryDriftMb',
  'browserErrors',
  'contractFailures',
];
const DESTROY_PROFILES = Object.freeze({
  smoke: freezeProfile({
    id: 'smoke',
    label: 'Smoke',
    usage: 'pr',
    cost: 'cheap',
    defaultPrBlocker: true,
    description: 'Cheap default plan shape and local orchestration check.',
    thresholds: {
      p95LatencyMs: 1_000,
      p99LatencyMs: 2_000,
      maxLatencyMs: 5_000,
      errorRate: 0.02,
      eventLoopDelayMs: 150,
      memoryDriftMb: 128,
      browserErrors: 0,
      contractFailures: 0,
    },
  }),
  release: freezeProfile({
    id: 'release',
    label: 'Release',
    usage: 'release',
    cost: 'moderate',
    defaultPrBlocker: false,
    description: 'Pre-release gate with strict budgets and bounded runtime.',
    thresholds: {
      p95LatencyMs: 450,
      p99LatencyMs: 900,
      maxLatencyMs: 2_000,
      errorRate: 0.005,
      eventLoopDelayMs: 75,
      memoryDriftMb: 96,
      browserErrors: 0,
      contractFailures: 0,
    },
  }),
  nightly: freezeProfile({
    id: 'nightly',
    label: 'Nightly',
    usage: 'nightly',
    cost: 'scheduled',
    defaultPrBlocker: false,
    description:
      'Scheduled destroy run with tighter latency and drift budgets.',
    thresholds: {
      p95LatencyMs: 400,
      p99LatencyMs: 800,
      maxLatencyMs: 1_800,
      errorRate: 0.003,
      eventLoopDelayMs: 60,
      memoryDriftMb: 80,
      browserErrors: 0,
      contractFailures: 0,
    },
  }),
  'manual-torture': freezeProfile({
    id: 'manual-torture',
    label: 'Manual torture',
    usage: 'manual',
    cost: 'expensive',
    defaultPrBlocker: false,
    description:
      'Operator-triggered expensive destroy run; never a default PR blocker.',
    thresholds: {
      p95LatencyMs: 350,
      p99LatencyMs: 700,
      maxLatencyMs: 1_500,
      errorRate: 0.001,
      eventLoopDelayMs: 50,
      memoryDriftMb: 64,
      browserErrors: 0,
      contractFailures: 0,
    },
  }),
});

const usage = () => `
Usage:
  node scripts/superapp-destroy/run-superapp-destroy.js [options]

Options:
  --plan, --dry-run              Print the machine-readable destroy plan. Default.
  --execute                      Execute the planned command phases. Intended for later full-run validation.
  --profile <smoke|release|nightly|manual-torture>
                                 Destroy-run profile label. Default: ${DEFAULT_PROFILE}
  --run-id <id>                  Artifact run id. Default: deterministic timestamp.
  --output-dir <path>            Artifact directory. Default: ${DEFAULT_OUTPUT_ROOT}/<run-id>
  --app-dir <path>               SuperApp app directory. Default: ${DEFAULT_APP_DIR}
  --host <host>                  Server host. Default: ${DEFAULT_HOST}
  --port <n>                     Server port. Default: ${DEFAULT_PORT}
  --base-url <url>               SuperApp origin. Default: http://${DEFAULT_HOST}:${DEFAULT_PORT}
  --health-path <path>           Readiness path. Default: ${DEFAULT_HEALTH_PATH}
  --warmup-ms <n>                Warmup delay budget. Default: ${DEFAULT_WARMUP_MS}
  --load-duration-ms <n>         HTTP load duration. Default: ${DEFAULT_LOAD_DURATION_MS}
  --load-concurrency <n>         HTTP load concurrency. Default: ${DEFAULT_LOAD_CONCURRENCY}
  --soak-profile <id>            Soak evidence profile. Default: ${DEFAULT_SOAK_PROFILE}
  --no-soak                      Skip the soak/stability evidence check phase.
  --help                         Show this help.
`;

function parseArgs(argv, env = process.env, now = new Date()) {
  const runId =
    env.SUPERAPP_DESTROY_RUN_ID ||
    `superapp-destroy-${now.toISOString()}-${process.pid}`;
  const options = {
    mode: 'plan',
    profile: env.SUPERAPP_DESTROY_PROFILE || DEFAULT_PROFILE,
    runId,
    outputDir: env.SUPERAPP_DESTROY_OUTPUT_DIR,
    appDir: env.SUPERAPP_DESTROY_APP_DIR || DEFAULT_APP_DIR,
    host: env.SUPERAPP_DESTROY_HOST || DEFAULT_HOST,
    port: parseOptionalPositiveInt(env.SUPERAPP_DESTROY_PORT) ?? DEFAULT_PORT,
    baseUrl: env.SUPERAPP_DESTROY_BASE_URL,
    healthPath: env.SUPERAPP_DESTROY_HEALTH_PATH || DEFAULT_HEALTH_PATH,
    warmupMs:
      parseOptionalNonNegativeInt(env.SUPERAPP_DESTROY_WARMUP_MS) ??
      DEFAULT_WARMUP_MS,
    loadDurationMs:
      parseOptionalPositiveInt(env.SUPERAPP_DESTROY_LOAD_DURATION_MS) ??
      DEFAULT_LOAD_DURATION_MS,
    loadConcurrency:
      parseOptionalPositiveInt(env.SUPERAPP_DESTROY_LOAD_CONCURRENCY) ??
      DEFAULT_LOAD_CONCURRENCY,
    soakProfile: env.SUPERAPP_DESTROY_SOAK_PROFILE || DEFAULT_SOAK_PROFILE,
    includeSoak: !parseBoolean(env.SUPERAPP_DESTROY_NO_SOAK),
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--plan':
      case '--dry-run':
        options.mode = 'plan';
        break;
      case '--execute':
        options.mode = 'execute';
        break;
      case '--profile':
        options.profile = requireValue(argv, ++index, arg);
        break;
      case '--run-id':
        options.runId = requireValue(argv, ++index, arg);
        break;
      case '--output-dir':
        options.outputDir = requireValue(argv, ++index, arg);
        break;
      case '--app-dir':
        options.appDir = requireValue(argv, ++index, arg);
        break;
      case '--host':
        options.host = requireValue(argv, ++index, arg);
        break;
      case '--port':
        options.port = requirePositiveInt(argv, ++index, arg);
        break;
      case '--base-url':
        options.baseUrl = requireValue(argv, ++index, arg);
        break;
      case '--health-path':
        options.healthPath = requireValue(argv, ++index, arg);
        break;
      case '--warmup-ms':
        options.warmupMs = requireNonNegativeInt(argv, ++index, arg);
        break;
      case '--load-duration-ms':
        options.loadDurationMs = requirePositiveInt(argv, ++index, arg);
        break;
      case '--load-concurrency':
        options.loadConcurrency = requirePositiveInt(argv, ++index, arg);
        break;
      case '--soak-profile':
        options.soakProfile = requireValue(argv, ++index, arg);
        break;
      case '--no-soak':
        options.includeSoak = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.profileDefinition = resolveDestroyProfile(options.profile);
  if (!options.profileDefinition) {
    throw new Error(
      `Invalid --profile "${options.profile}". Use ${Object.keys(
        DESTROY_PROFILES,
      ).join(', ')}.`,
    );
  }

  options.runId = sanitizeSegment(options.runId);
  options.appDir = resolveRepoPath(options.appDir);
  options.outputDir = resolveRepoPath(
    options.outputDir || path.join(DEFAULT_OUTPUT_ROOT, options.runId),
  );
  options.healthPath = normalizeHealthPath(options.healthPath);
  options.baseUrl =
    options.baseUrl || `http://${options.host}:${String(options.port)}`;
  options.baseUrl = options.baseUrl.replace(/\/+$/, '');
  return options;
}

function createDestroyPlan(options) {
  const artifactRoot = path.join(options.outputDir, 'artifacts');
  const testsCwd = path.join(REPO_ROOT, 'tests');
  const rstest = 'pnpm exec rstest run -c rstest.config.mts';
  const profileDefinition =
    options.profileDefinition || resolveDestroyProfile(options.profile);
  if (!profileDefinition) {
    throw new Error(`Unknown destroy profile: ${options.profile}`);
  }
  const env = {
    SUPERAPP_DESTROY_RUN_ID: options.runId,
    SUPERAPP_DESTROY_ARTIFACT_DIR: options.outputDir,
    SUPERAPP_DESTROY_PROFILE: profileDefinition.id,
    SUPERAPP_DESTROY_PROFILE_USAGE: profileDefinition.usage,
    SUPERAPP_DESTROY_THRESHOLD_BUDGET_JSON: JSON.stringify(
      profileDefinition.thresholds,
    ),
  };
  const command = phaseCommandFactory({
    artifactRoot,
    env,
    options,
    profileDefinition,
    testsCwd,
  });
  const phases = [
    {
      id: 'build',
      label: 'Build production SuperApp',
      kind: 'command',
      commands: [
        command('build-superapp-portfolio', 'pnpm run build', {
          artifactDir: artifactDir(artifactRoot, 'build'),
          cwd: options.appDir,
          env: {
            NODE_ENV: 'production',
          },
        }),
      ],
    },
    {
      id: 'serve',
      label: 'Serve production SuperApp',
      kind: 'lifecycle',
      lifecycle: 'start-server',
      commands: [
        command('serve-superapp-portfolio', 'pnpm run serve', {
          artifactDir: artifactDir(artifactRoot, 'serve'),
          cwd: options.appDir,
          env: {
            NODE_ENV: 'production',
            PORT: String(options.port),
          },
          metadata: {
            healthUrl: new URL(options.healthPath, options.baseUrl).toString(),
            host: options.host,
            port: options.port,
          },
        }),
      ],
    },
    {
      id: 'warmup',
      label: 'Warm up served SuperApp',
      kind: 'command',
      commands: [
        command(
          'warmup-superapp',
          [
            'node scripts/superapp-load/run-superapp-load.js',
            `--base-url ${shellArg(options.baseUrl)}`,
            '--target portfolio',
            '--scenario bootstrap',
            `--duration-ms ${Math.max(options.warmupMs, 1)}`,
            '--concurrency 1',
            `--run-id ${shellArg(`${options.runId}-warmup`)}`,
            `--output-dir ${shellArg(artifactDir(artifactRoot, 'warmup'))}`,
          ].join(' '),
          {
            artifactDir: artifactDir(artifactRoot, 'warmup'),
          },
        ),
      ],
    },
    {
      id: 'load',
      label: 'Run deterministic HTTP load',
      kind: 'command',
      concurrencyGroup: 'load-and-browser-smoke',
      commands: [
        command(
          'superapp-portfolio-load',
          [
            'node scripts/superapp-load/run-superapp-load.js',
            `--base-url ${shellArg(options.baseUrl)}`,
            '--target portfolio',
            '--scenario mixed',
            `--duration-ms ${options.loadDurationMs}`,
            `--concurrency ${options.loadConcurrency}`,
            `--run-id ${shellArg(`${options.runId}-portfolio-load`)}`,
            `--output-dir ${shellArg(artifactDir(artifactRoot, 'portfolio-load'))}`,
          ].join(' '),
          {
            artifactDir: artifactDir(artifactRoot, 'portfolio-load'),
          },
        ),
      ],
    },
    {
      id: 'browser-smoke-during-load',
      label: 'Run browser smoke while load is active',
      kind: 'command',
      concurrencyGroup: 'load-and-browser-smoke',
      runsDuring: ['load'],
      commands: [
        command(
          'superapp-browser-runtime-smoke',
          `${rstest} integration/superapp-portfolio/tests/browser-runtime.test.ts`,
          {
            artifactDir: artifactDir(artifactRoot, 'browser-runtime-smoke'),
            cwd: testsCwd,
            env: {
              SUPERAPP_PORTFOLIO_BROWSER_RUNTIME_ARTIFACT_DIR: artifactDir(
                artifactRoot,
                'browser-runtime-smoke',
              ),
            },
          },
        ),
      ],
    },
    {
      id: 'chaos',
      label: 'Run chaos and recovery checks',
      kind: 'command',
      commands: [
        command(
          'superapp-pilot-chaos',
          `${rstest} integration/superapp-portfolio/tests/pilot-chaos.test.ts`,
          {
            artifactDir: artifactDir(artifactRoot, 'pilot-chaos'),
            cwd: testsCwd,
            env: {
              SUPERAPP_PILOT_CHAOS: '1',
              SUPERAPP_PILOT_CHAOS_ARTIFACT_DIR: artifactDir(
                artifactRoot,
                'pilot-chaos',
              ),
              SUPERAPP_PILOT_CHAOS_BASE_URL: options.baseUrl,
            },
          },
        ),
        command(
          'superapp-chaos-triggering-load',
          [
            'node scripts/superapp-load/run-superapp-load.js',
            `--base-url ${shellArg(options.baseUrl)}`,
            '--target portfolio',
            '--scenario chaos',
            `--duration-ms ${options.loadDurationMs}`,
            `--concurrency ${options.loadConcurrency}`,
            `--run-id ${shellArg(`${options.runId}-chaos-triggering`)}`,
            `--output-dir ${shellArg(artifactDir(artifactRoot, 'chaos-triggering-load'))}`,
          ].join(' '),
          {
            artifactDir: artifactDir(artifactRoot, 'chaos-triggering-load'),
          },
        ),
      ],
    },
    {
      id: 'contracts',
      label: 'Run Effect, TanStack, BFF, and harness contracts',
      kind: 'command',
      commands: [
        command(
          'superapp-effect-bff-contracts',
          `${rstest} integration/superapp-portfolio/tests/effect-bff-contracts.test.ts integration/superapp-portfolio/tests/effect-tanstack-contract-behavior.test.ts integration/superapp-portfolio/tests/effect-tanstack-contract-coverage-artifact.test.ts`,
          {
            artifactDir: artifactDir(artifactRoot, 'contracts'),
            cwd: testsCwd,
          },
        ),
        command(
          'superapp-torture-harness-contract',
          [
            'node scripts/superapp-certification/validate-harness-contract.js',
            `--out-dir ${shellArg(artifactDir(artifactRoot, 'torture-harness'))}`,
          ].join(' '),
          {
            artifactDir: artifactDir(artifactRoot, 'torture-harness'),
          },
        ),
      ],
    },
    {
      id: 'runtime-matrix',
      label: 'Run browser runtime matrix checks',
      kind: 'command',
      commands: [
        command(
          'superapp-browser-runtime-matrix',
          `${rstest} integration/superapp-portfolio/tests/browser-runtime-matrix.test.ts`,
          {
            artifactDir: artifactDir(artifactRoot, 'browser-runtime-matrix'),
            cwd: testsCwd,
            env: {
              SUPERAPP_PORTFOLIO_BROWSER_RUNTIME_ARTIFACT_DIR: artifactDir(
                artifactRoot,
                'browser-runtime-matrix',
              ),
            },
          },
        ),
      ],
    },
    ...(options.includeSoak
      ? [
          {
            id: 'soak-stability-evidence',
            label: 'Run bounded soak and stability evidence',
            kind: 'command',
            commands: [
              command(
                'superapp-soak-plan',
                [
                  'node scripts/superapp-soak/run-superapp-soak.js',
                  `--profile ${shellArg(options.soakProfile)}`,
                  `--base-url ${shellArg(options.baseUrl)}`,
                  '--duration-seconds 3',
                  '--warmup-seconds 0',
                  '--cooldown-seconds 0',
                  '--concurrency 1',
                  '--max-operations 18',
                  '--operation-interval-ms 0',
                  '--window-ms 1000',
                  `--run-id ${shellArg(`${options.runId}-soak`)}`,
                  `--output-dir ${shellArg(artifactDir(artifactRoot, 'soak'))}`,
                ].join(' '),
                {
                  artifactDir: artifactDir(artifactRoot, 'soak'),
                },
              ),
              command(
                'superapp-soak-stability-report',
                [
                  'node scripts/superapp-soak/stability-report.js',
                  `--summary ${shellArg(
                    path.join(
                      artifactDir(artifactRoot, 'soak'),
                      'summary.json',
                    ),
                  )}`,
                  `--output-dir ${shellArg(
                    artifactDir(artifactRoot, 'soak-stability'),
                  )}`,
                  `--json ${shellArg(
                    path.join(
                      artifactDir(artifactRoot, 'soak-stability'),
                      'soak-stability.json',
                    ),
                  )}`,
                ].join(' '),
                {
                  artifactDir: artifactDir(artifactRoot, 'soak-stability'),
                  expectedInput: path.join(
                    artifactDir(artifactRoot, 'soak'),
                    'summary.json',
                  ),
                },
              ),
            ],
          },
        ]
      : []),
    {
      id: 'teardown',
      label: 'Tear down server and collect process logs',
      kind: 'lifecycle',
      lifecycle: 'stop-server',
      alwaysRun: true,
      scheduledAfterFailure: true,
      commands: [
        command('teardown-superapp-server', 'stop tracked SuperApp server', {
          artifactDir: artifactDir(artifactRoot, 'teardown'),
          metadata: {
            serverPhase: 'serve',
          },
        }),
      ],
    },
  ];

  return {
    schemaVersion: 'superapp-destroy-plan-v1',
    mode: options.mode,
    runId: options.runId,
    profile: options.profile,
    profileDefinition,
    thresholdBudget: profileDefinition.thresholds,
    appDir: options.appDir,
    baseUrl: options.baseUrl,
    healthPath: options.healthPath,
    artifactRoot,
    outputDir: options.outputDir,
    phaseOrder: phases.map(phase => phase.id),
    executionModel: {
      defaultMode: 'plan',
      expensiveWorkRequires: '--execute',
      selectedProfile: {
        id: profileDefinition.id,
        usage: profileDefinition.usage,
        cost: profileDefinition.cost,
        defaultPrBlocker: profileDefinition.defaultPrBlocker,
      },
      teardownPolicy:
        'The teardown phase is always scheduled after the last attempted phase, including failed phases.',
      concurrencyGroups: [
        {
          id: 'load-and-browser-smoke',
          phases: ['load', 'browser-smoke-during-load'],
          note: 'The browser smoke phase must run while HTTP load is active in the full executor.',
        },
      ],
    },
    phases,
  };
}

function phaseCommandFactory(input) {
  return (id, commandLine, options = {}) => ({
    id,
    command: commandLine,
    artifactDir: options.artifactDir,
    cwd: options.cwd || REPO_ROOT,
    env: {
      ...input.env,
      ...(options.env || {}),
    },
    metadata: {
      profile: {
        id: input.profileDefinition.id,
        usage: input.profileDefinition.usage,
        cost: input.profileDefinition.cost,
        defaultPrBlocker: input.profileDefinition.defaultPrBlocker,
      },
      thresholdBudget: input.profileDefinition.thresholds,
      ...(options.metadata || {}),
    },
    expectedInput: options.expectedInput,
  });
}

async function runDestroyPlan(plan, options = {}) {
  const executeCommand = options.executeCommand || defaultExecuteCommand;
  const results = [];
  const context = {
    servers: new Map(),
  };
  let failed = false;

  for (let index = 0; index < plan.phases.length; index += 1) {
    const phase = plan.phases[index];
    if (failed && !phase.alwaysRun) {
      results.push({
        phaseId: phase.id,
        status: 'skipped',
        reason: 'previous-phase-failed',
      });
      continue;
    }

    const concurrentPhases = collectConcurrentPhases(plan.phases, index);
    const phaseResults = await Promise.all(
      concurrentPhases.map(groupPhase =>
        executePhase(groupPhase, plan, executeCommand, context),
      ),
    );

    for (const phaseResult of phaseResults) {
      if (phaseResult.status === 'passed' && phaseResult.alwaysRun && failed) {
        phaseResult.status = 'teardown-after-failure';
      }
      delete phaseResult.alwaysRun;
      results.push(phaseResult);
      if (phaseResult.status === 'failed') {
        failed = true;
      }
    }

    index += concurrentPhases.length - 1;
  }

  return {
    schemaVersion: 'superapp-destroy-execution-v1',
    runId: plan.runId,
    status: failed ? 'failed' : 'passed',
    results,
    teardownScheduled: results.some(result => result.phaseId === 'teardown'),
  };
}

function collectConcurrentPhases(phases, startIndex) {
  const phase = phases[startIndex];
  if (!phase.concurrencyGroup) {
    return [phase];
  }

  const group = [phase];
  for (let index = startIndex + 1; index < phases.length; index += 1) {
    const candidate = phases[index];
    if (candidate.concurrencyGroup !== phase.concurrencyGroup) {
      break;
    }
    group.push(candidate);
  }
  return group;
}

async function executePhase(phase, plan, executeCommand, context) {
  const startedAt = Date.now();
  const phaseResult = {
    phaseId: phase.id,
    status: 'passed',
    commands: [],
    alwaysRun: phase.alwaysRun,
  };

  for (const item of phase.commands) {
    const result = await executeCommand(item, phase, plan, context);
    phaseResult.commands.push(
      pruneUndefined({
        id: item.id,
        status: result.status,
        exitCode: result.exitCode,
        signal: result.signal,
        error: result.error,
        durationMs: result.durationMs,
        artifacts: result.artifacts,
      }),
    );

    if (result.status === 'failed' || result.exitCode !== 0) {
      phaseResult.status = 'failed';
      break;
    }
  }

  phaseResult.durationMs = Date.now() - startedAt;
  return phaseResult;
}

async function defaultExecuteCommand(item, phase, plan, context = {}) {
  if (phase.kind === 'lifecycle') {
    if (phase.lifecycle === 'start-server') {
      return startLifecycleServer(item, plan, context);
    }
    if (phase.lifecycle === 'stop-server') {
      return stopLifecycleServer(item, context);
    }
  }

  return executeShellCommand(item);
}

async function startLifecycleServer(item, plan, context) {
  const startedAt = Date.now();
  const artifactPaths = prepareCommandArtifacts(item);
  const child = spawn(item.command, {
    cwd: item.cwd,
    env: {
      ...process.env,
      ...item.env,
    },
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = captureChildOutput(child, artifactPaths);
  const healthUrl =
    item.metadata?.healthUrl ||
    new URL(plan.healthPath || '/', plan.baseUrl).toString();
  const readiness = await waitForHttp(healthUrl, {
    timeoutMs: 60_000,
    requestTimeoutMs: 2_000,
  });
  const metadata = pruneUndefined({
    command: item.command,
    cwd: item.cwd,
    healthUrl,
    pid: child.pid,
    readiness,
  });

  if (!readiness.ok) {
    const stop = await stopProductionServer({ child });
    capture.close();
    writeJsonArtifact(path.join(item.artifactDir, 'server-lifecycle.json'), {
      ...metadata,
      stop,
      status: 'failed',
    });
    return {
      status: 'failed',
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      error: `SuperApp server did not become ready at ${healthUrl}: ${
        readiness.error || 'unknown readiness failure'
      }`,
      artifacts: artifactPaths,
    };
  }

  context.servers ||= new Map();
  context.servers.set(item.id, {
    artifactDir: item.artifactDir,
    artifactPaths,
    child,
    metadata,
    phaseId: phaseIdFromServerItem(item),
    capture,
  });
  writeJsonArtifact(path.join(item.artifactDir, 'server-lifecycle.json'), {
    ...metadata,
    status: 'passed',
  });

  return {
    status: 'passed',
    exitCode: 0,
    durationMs: Date.now() - startedAt,
    artifacts: [
      ...artifactPaths,
      path.join(item.artifactDir, 'server-lifecycle.json'),
    ],
  };
}

async function stopLifecycleServer(item, context) {
  const startedAt = Date.now();
  const server =
    context.servers?.get('serve-superapp-portfolio') ||
    [...(context.servers?.values() || [])][0];
  fs.mkdirSync(item.artifactDir, { recursive: true });

  if (!server) {
    const lifecyclePath = path.join(item.artifactDir, 'server-teardown.json');
    writeJsonArtifact(lifecyclePath, {
      status: 'passed',
      alreadyExited: true,
      reason: 'no tracked server process',
    });
    return {
      status: 'passed',
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      artifacts: [lifecyclePath],
    };
  }

  const stop = await stopProductionServer({ child: server.child });
  server.capture?.close();
  const finalOutput = {
    ...server.metadata,
    stop,
    status: stop.stopped ? 'passed' : 'failed',
  };
  const lifecyclePath = path.join(item.artifactDir, 'server-teardown.json');
  writeJsonArtifact(lifecyclePath, finalOutput);
  context.servers?.delete('serve-superapp-portfolio');

  return {
    status: stop.stopped ? 'passed' : 'failed',
    exitCode: stop.stopped ? 0 : 1,
    signal: stop.signal,
    durationMs: Date.now() - startedAt,
    artifacts: [lifecyclePath, ...(server.artifactPaths || [])],
  };
}

function executeShellCommand(item) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const artifactPaths = prepareCommandArtifacts(item);
    const child = spawn(item.command, {
      cwd: item.cwd,
      env: {
        ...process.env,
        ...item.env,
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const capture = captureChildOutput(child, artifactPaths);

    child.once('error', error => {
      capture.close();
      resolve({
        status: 'failed',
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        artifacts: artifactPaths,
      });
    });
    child.once('exit', (exitCode, signal) => {
      capture.close();
      resolve({
        status: exitCode === 0 ? 'passed' : 'failed',
        exitCode: exitCode ?? 1,
        signal,
        durationMs: Date.now() - startedAt,
        artifacts: artifactPaths,
      });
    });
  });
}

function prepareCommandArtifacts(item) {
  fs.mkdirSync(item.artifactDir, { recursive: true });
  return [
    path.join(item.artifactDir, `${item.id}.stdout.log`),
    path.join(item.artifactDir, `${item.id}.stderr.log`),
  ];
}

function captureChildOutput(child, artifactPaths) {
  const [stdoutPath, stderrPath] = artifactPaths;
  const stdout = fs.createWriteStream(stdoutPath);
  const stderr = fs.createWriteStream(stderrPath);
  child.stdout?.on('data', chunk => {
    stdout.write(chunk);
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', chunk => {
    stderr.write(chunk);
    process.stderr.write(chunk);
  });
  return {
    close() {
      stdout.end();
      stderr.end();
    },
  };
}

function phaseIdFromServerItem(item) {
  return item.metadata?.serverPhase || 'serve';
}

function writePlan(plan) {
  fs.mkdirSync(plan.outputDir, { recursive: true });
  const planPath = path.join(plan.outputDir, 'destroy-plan.json');
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return planPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const plan = createDestroyPlan(options);
  const planPath = writePlan(plan);

  if (options.mode === 'plan') {
    console.log(JSON.stringify({ ...plan, planPath }, null, 2));
    return;
  }

  const execution = await runDestroyPlan(plan);
  const executionPath = path.join(plan.outputDir, 'destroy-execution.json');
  fs.writeFileSync(executionPath, `${JSON.stringify(execution, null, 2)}\n`);
  const observed = writeObservedDestroySummary(plan, execution, {
    executionPath,
    planPath,
  });
  const readiness = writeDestroyReadinessArtifacts(plan, execution, {
    executionPath,
    laneEvidenceEntries: observed.laneEvidenceEntries,
    planPath,
  });
  console.log(
    JSON.stringify(
      {
        ...execution,
        executionPath,
        observedLimitsPath: observed.observedLimitsPath,
        planPath,
        readiness,
      },
      null,
      2,
    ),
  );
  if (execution.status !== 'passed') {
    process.exitCode = 1;
  }
}

function writeObservedDestroySummary(plan, execution, provenance) {
  const evidenceEntries = createDestroyEvidenceCatalog(plan);
  const laneEvidenceRoot = path.join(plan.outputDir, 'lane-evidence');
  const laneEvidenceEntries = [];
  const laneGroups = groupBy(evidenceEntries, entry => entry.lane);
  const lanes = {};

  for (const lane of Object.keys(laneGroups).sort()) {
    const entries = laneGroups[lane];
    const artifacts = entries.map(entry => readEvidenceArtifact(entry));
    const unknowns = artifacts
      .filter(artifact => !artifact.value)
      .map(artifact => `${artifact.path}: ${artifact.error}`)
      .concat(
        artifacts.flatMap(artifact =>
          artifact.value ? summarizeArtifactUnknowns(artifact.value) : [],
        ),
      );
    const failures = artifacts.flatMap(artifact =>
      artifact.value ? summarizeArtifactFailures(artifact.value) : [],
    );
    const warnings = artifacts.flatMap(artifact =>
      artifact.value ? normalizeList(artifact.value.warnings).map(String) : [],
    );
    const observations = artifacts
      .filter(artifact => artifact.value)
      .map(artifact => summarizeArtifactSignals(artifact.value, artifact));
    const status =
      failures.length > 0
        ? 'failed'
        : unknowns.length > 0
          ? 'unknown'
          : 'passed';
    const laneEvidence = pruneUndefined({
      schemaVersion: 'superapp-destroy-lane-evidence-v1',
      suite: `superapp-destroy-${lane}`,
      lane,
      status,
      classification:
        status === 'passed' ? 'pass' : status === 'failed' ? 'fail' : 'unknown',
      budgetFailures: failures,
      unknowns,
      warnings,
      observations,
      artifacts: artifacts.map(artifact => ({
        path: artifact.path,
        present: Boolean(artifact.value),
        provenance: artifact.provenance,
        schemaVersion: artifact.value?.schemaVersion,
        suite: artifact.value?.suite,
      })),
    });
    const lanePath = path.join(laneEvidenceRoot, `${lane}.json`);
    writeJsonArtifact(lanePath, laneEvidence);
    laneEvidenceEntries.push({
      lane,
      path: lanePath,
      provenance: {
        source: 'destroy-runner',
      },
    });
    lanes[lane] = laneEvidence;
  }

  const observedLimits = pruneUndefined({
    schemaVersion: 'superapp-destroy-observed-limits-v1',
    runId: plan.runId,
    status: execution.status,
    profile: plan.profile,
    thresholds: plan.thresholdBudget,
    generatedAt: new Date(0).toISOString(),
    provenance,
    phases: execution.results,
    lanes,
  });
  const observedLimitsPath = path.join(
    plan.outputDir,
    'destroy-observed-limits.json',
  );
  writeJsonArtifact(observedLimitsPath, observedLimits);
  return {
    laneEvidenceEntries,
    observedLimits,
    observedLimitsPath,
  };
}

function writeDestroyReadinessArtifacts(plan, execution, options) {
  const { writeDestroyReadinessReport } = require('./readiness-report');
  const result = writeDestroyReadinessReport(
    {
      artifacts: options.laneEvidenceEntries,
      execution,
      plan,
    },
    {
      executionPath: options.executionPath,
      generatedAt: new Date(0).toISOString(),
      outputDir: plan.outputDir,
      planPath: options.planPath,
    },
  );

  return {
    classification: result.report.classification,
    markdownPath: result.markdownPath,
    reportPath: result.reportPath,
  };
}

function createDestroyEvidenceCatalog(plan) {
  const artifactRoot = plan.artifactRoot;
  const entry = (lane, relativePath, provenance = {}) => ({
    lane,
    path: path.join(artifactRoot, relativePath),
    provenance,
  });

  return [
    entry('load', 'warmup/summary.json', { phaseId: 'warmup' }),
    entry('load', 'portfolio-load/summary.json', { phaseId: 'load' }),
    entry(
      'browser-runtime',
      'browser-runtime-smoke/production-shell-smoke/summary.json',
      {
        phaseId: 'browser-smoke-during-load',
      },
    ),
    entry(
      'browser-runtime',
      'browser-runtime-smoke/production-shell-smoke-under-moderate-load/summary.json',
      { phaseId: 'browser-smoke-during-load' },
    ),
    entry('chaos', 'pilot-chaos/summary.json', { phaseId: 'chaos' }),
    entry('chaos', 'chaos-triggering-load/summary.json', {
      phaseId: 'chaos',
    }),
    entry('contracts', 'torture-harness/summary.json', {
      phaseId: 'contracts',
    }),
    entry(
      'runtime-matrix',
      'browser-runtime-matrix/dev-cold-start-summary/summary.json',
      { phaseId: 'runtime-matrix' },
    ),
    entry(
      'runtime-matrix',
      'browser-runtime-matrix/production-ssr-csr-summary/summary.json',
      { phaseId: 'runtime-matrix' },
    ),
    entry(
      'runtime-matrix',
      'browser-runtime-matrix/asset-prefix-production-summary/summary.json',
      { phaseId: 'runtime-matrix' },
    ),
    entry(
      'runtime-matrix',
      'browser-runtime-matrix/simulated-mf-fallback-summary/summary.json',
      { phaseId: 'runtime-matrix' },
    ),
    ...(plan.phaseOrder.includes('soak-stability-evidence')
      ? [
          entry('soak-stability', 'soak-stability/soak-stability.json', {
            phaseId: 'soak-stability-evidence',
          }),
        ]
      : []),
  ];
}

function readEvidenceArtifact(entry) {
  try {
    return {
      ...entry,
      value: JSON.parse(fs.readFileSync(entry.path, 'utf8')),
    };
  } catch (error) {
    return {
      ...entry,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeArtifactFailures(artifact) {
  const failures = [
    ...normalizeList(artifact.budgetFailures),
    ...normalizeList(artifact.thresholdFailures),
  ];
  const failedCount =
    Number(artifact.failedCount || 0) +
    Number(artifact.failedCommandCount || 0);
  if (failedCount > 0) {
    failures.push(`${failedCount} failed check(s)`);
  }
  if (Number(artifact.unexpectedErrorCount || 0) > 0) {
    failures.push(`${artifact.unexpectedErrorCount} unexpected error(s)`);
  }
  return failures.map(String);
}

function summarizeArtifactUnknowns(artifact) {
  const unknowns = normalizeList(artifact.unknowns).map(String);
  const normalizedStatus = String(
    artifact.classification || artifact.status || '',
  ).toLowerCase();
  if (
    ['unknown', 'missing', 'planned', 'skipped', 'incomplete'].includes(
      normalizedStatus,
    )
  ) {
    unknowns.push(
      `artifact status is ${String(
        artifact.status || artifact.classification,
      )}`,
    );
  }
  return unknowns;
}

function summarizeArtifactSignals(artifact, entry) {
  return pruneUndefined({
    path: entry.path,
    suite: artifact.suite,
    status: artifact.status,
    classification: artifact.classification,
    requestCount: artifact.requestCount,
    errorRate: artifact.unexpectedErrorRate,
    latency: artifact.durations
      ? {
          p95Ms: artifact.durations.p95Ms,
          p99Ms: artifact.durations.p99Ms,
          maxMs: artifact.durations.maxMs,
        }
      : undefined,
    eventLoopDelay: artifact.eventLoopDelay,
    memory: artifact.observedStabilityEnvelope?.memory,
  });
}

function normalizeList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function groupBy(values, key) {
  return values.reduce((groups, value) => {
    const groupKey = key(value);
    groups[groupKey] ||= [];
    groups[groupKey].push(value);
    return groups;
  }, {});
}

function writeJsonArtifact(outputPath, value) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function pruneUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(pruneUndefined);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, pruneUndefined(entryValue)]),
  );
}

function artifactDir(root, name) {
  return path.join(root, name);
}

function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    thresholds: Object.freeze({ ...profile.thresholds }),
  });
}

function resolveDestroyProfile(profileId) {
  const profile = DESTROY_PROFILES[profileId];
  if (!profile) {
    return undefined;
  }
  assertCompleteThresholdBudget(profile);
  return profile;
}

function assertCompleteThresholdBudget(profile) {
  const missing = REQUIRED_THRESHOLD_KEYS.filter(
    key => !Object.hasOwn(profile.thresholds, key),
  );
  if (missing.length > 0) {
    throw new Error(
      `Destroy profile "${profile.id}" is missing thresholds: ${missing.join(
        ', ',
      )}`,
    );
  }
}

function shellArg(value) {
  return JSON.stringify(String(value));
}

function normalizeHealthPath(value) {
  const normalized = String(value || DEFAULT_HEALTH_PATH);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function resolveRepoPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value);
}

function sanitizeSegment(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-+/g, '-');
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function requirePositiveInt(argv, index, name) {
  const parsed = parseOptionalPositiveInt(requireValue(argv, index, name));
  if (parsed === undefined) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requireNonNegativeInt(argv, index, name) {
  const parsed = parseOptionalNonNegativeInt(requireValue(argv, index, name));
  if (parsed === undefined) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalPositiveInt(value) {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalNonNegativeInt(value) {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseBoolean(value) {
  if (value === undefined || value === '') {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  createDestroyPlan,
  DESTROY_PROFILES,
  parseArgs,
  REQUIRED_THRESHOLD_KEYS,
  resolveDestroyProfile,
  runDestroyPlan,
  usage,
  writeObservedDestroySummary,
};
