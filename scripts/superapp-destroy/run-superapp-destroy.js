#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

const usage = () => `
Usage:
  node scripts/superapp-destroy/run-superapp-destroy.js [options]

Options:
  --plan, --dry-run              Print the machine-readable destroy plan. Default.
  --execute                      Execute the planned command phases. Intended for later full-run validation.
  --profile <smoke|release|nightly>
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

  if (!['smoke', 'release', 'nightly'].includes(options.profile)) {
    throw new Error(
      `Invalid --profile "${options.profile}". Use smoke, release, or nightly.`,
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
  const vitest = 'pnpm vitest run -c vitest.framework.config.mjs';
  const env = {
    SUPERAPP_DESTROY_RUN_ID: options.runId,
    SUPERAPP_DESTROY_ARTIFACT_DIR: options.outputDir,
  };
  const command = phaseCommandFactory({ artifactRoot, env, options, testsCwd });
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
            'node scripts/superapp-k6/run-superapp-k6.js',
            '--check',
            `--base-url ${shellArg(options.baseUrl)}`,
            `--warmup-ms ${options.warmupMs}`,
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
          `${vitest} integration/superapp-portfolio/tests/browser-runtime.test.ts`,
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
          `${vitest} integration/superapp-portfolio/tests/pilot-chaos.test.ts`,
          {
            artifactDir: artifactDir(artifactRoot, 'pilot-chaos'),
            cwd: testsCwd,
            env: {
              SUPERAPP_PILOT_CHAOS: '1',
              SUPERAPP_PILOT_CHAOS_ARTIFACT_DIR: artifactDir(
                artifactRoot,
                'pilot-chaos',
              ),
            },
          },
        ),
        command(
          'superapp-k6-chaos-triggering',
          [
            'node scripts/superapp-k6/run-superapp-k6.js',
            '--scenario chaos-triggering',
            `--base-url ${shellArg(options.baseUrl)}`,
            `--profile ${shellArg(options.profile)}`,
            `--output-dir ${shellArg(artifactDir(artifactRoot, 'k6-chaos-triggering'))}`,
          ].join(' '),
          {
            artifactDir: artifactDir(artifactRoot, 'k6-chaos-triggering'),
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
          `${vitest} integration/superapp-portfolio/tests/effect-bff-contracts.test.ts integration/superapp-portfolio/tests/effect-tanstack-contract-behavior.test.ts integration/superapp-portfolio/tests/effect-tanstack-contract-coverage-artifact.test.ts`,
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
          `${vitest} integration/superapp-portfolio/tests/browser-runtime-matrix.test.ts`,
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
            label: 'Check soak and stability evidence plan',
            kind: 'command',
            commands: [
              command(
                'superapp-soak-plan',
                [
                  'node scripts/superapp-soak/run-superapp-soak.js',
                  '--dry-run',
                  `--profile ${shellArg(options.soakProfile)}`,
                  `--base-url ${shellArg(options.baseUrl)}`,
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
    appDir: options.appDir,
    baseUrl: options.baseUrl,
    healthPath: options.healthPath,
    artifactRoot,
    outputDir: options.outputDir,
    phaseOrder: phases.map(phase => phase.id),
    executionModel: {
      defaultMode: 'plan',
      expensiveWorkRequires: '--execute',
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
    metadata: options.metadata || undefined,
    expectedInput: options.expectedInput,
  });
}

async function runDestroyPlan(plan, options = {}) {
  const executeCommand = options.executeCommand || defaultExecuteCommand;
  const results = [];
  let failed = false;

  for (const phase of plan.phases) {
    if (failed && !phase.alwaysRun) {
      results.push({
        phaseId: phase.id,
        status: 'skipped',
        reason: 'previous-phase-failed',
      });
      continue;
    }

    const phaseResult = {
      phaseId: phase.id,
      status: 'passed',
      commands: [],
    };

    for (const item of phase.commands) {
      const result = await executeCommand(item, phase, plan);
      phaseResult.commands.push({
        id: item.id,
        status: result.status,
        exitCode: result.exitCode,
        signal: result.signal,
        error: result.error,
      });

      if (result.status === 'failed' || result.exitCode !== 0) {
        phaseResult.status = 'failed';
        failed = true;
        break;
      }
    }

    if (phaseResult.status === 'passed' && phase.alwaysRun && failed) {
      phaseResult.status = 'teardown-after-failure';
    }

    results.push(phaseResult);
  }

  return {
    schemaVersion: 'superapp-destroy-execution-v1',
    runId: plan.runId,
    status: failed ? 'failed' : 'passed',
    results,
    teardownScheduled: results.some(result => result.phaseId === 'teardown'),
  };
}

function defaultExecuteCommand(item, phase) {
  if (phase.kind === 'lifecycle') {
    return {
      status: phase.alwaysRun ? 'passed' : 'failed',
      exitCode: phase.alwaysRun ? 0 : 1,
      error: phase.alwaysRun
        ? undefined
        : 'Lifecycle execution is reserved for ust-destroy-04 full-run validation.',
    };
  }

  const startedAt = Date.now();
  const result = spawnSync(item.command, {
    cwd: item.cwd,
    env: {
      ...process.env,
      ...item.env,
    },
    shell: true,
    stdio: 'inherit',
  });
  return {
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status ?? 1,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
  };
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
  console.log(
    JSON.stringify({ ...execution, executionPath, planPath }, null, 2),
  );
  if (execution.status !== 'passed') {
    process.exitCode = 1;
  }
}

function artifactDir(root, name) {
  return path.join(root, name);
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
  parseArgs,
  runDestroyPlan,
  usage,
};
