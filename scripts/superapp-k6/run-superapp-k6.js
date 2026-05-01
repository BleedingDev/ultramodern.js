#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const {
  createArtifactEnvelope,
  writeArtifactSummary,
} = require('../superapp-certification/artifact-schema');
const {
  buildAutocannonCliArgs,
  evaluateAutocannonThresholds,
  getAutocannonProbeCatalog,
  getAutocannonProbeDefinition,
  getAutocannonThresholdProfileDefinition,
  getAutocannonThresholdProfiles,
  normalizeAutocannonProbeSelection,
} = require('./autocannon-probes');
const {
  DEFAULT_LOAD_THRESHOLD_PROFILE,
  DEFAULT_SCENARIO_SCRIPT,
  getLoadThresholdProfileDefinition,
  getLoadThresholdProfiles,
  getScenarioCatalog,
  normalizeLoadThresholdProfile,
  normalizeScenarioSelection,
} = require('./scenario-catalog');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_OUTPUT_ROOT = '.modern/superapp-k6';
const DEFAULT_TARGET = 'superapp';
const DEFAULT_PROFILE = 'k6-runner-check';
const DEFAULT_SERVER_HOST = '127.0.0.1';
const DEFAULT_HEALTH_PATH = '/';
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const PROCESS_LOG_TAIL_LIMIT = 64_000;
const LOCAL_K6_BIN =
  process.platform === 'win32'
    ? path.join('node_modules', '.bin', 'k6.cmd')
    : path.join('node_modules', '.bin', 'k6');
const LOCAL_AUTOCANNON_BIN =
  process.platform === 'win32'
    ? path.join('node_modules', '.bin', 'autocannon.cmd')
    : path.join('node_modules', '.bin', 'autocannon');

const usage = () => `
Usage:
  node scripts/superapp-k6/run-superapp-k6.js [options] [-- k6 args]

Options:
  --script <path>          k6 script to run. Omit with --check to only verify k6.
  --scenario <id|all>      Built-in SuperApp scenario selection. Default script: ${DEFAULT_SCENARIO_SCRIPT}
  --list-scenarios         Print built-in scenario metadata and exit without probing k6.
  --autocannon-probes <id|all>
                          Run built-in multi-worker autocannon endpoint probes instead of k6.
  --list-autocannon-probes Print built-in autocannon probe metadata and exit.
  --autocannon-bin <path|command>
                          Explicit autocannon binary. Env: SUPERAPP_AUTOCANNON_BIN or AUTOCANNON_BIN.
  --autocannon-bin-arg <arg>
                          Prefix arg for --autocannon-bin; repeatable. Env: SUPERAPP_AUTOCANNON_BIN_ARGS.
  --require-autocannon     Exit 1 when autocannon is unavailable. Default is a skipped summary.
  --autocannon-workers <n> Override probe worker count.
  --autocannon-connections <n>
                          Override probe connection count.
  --autocannon-duration-seconds <n>
                          Override probe duration.
  --autocannon-timeout-seconds <n>
                          Override per-request timeout.
  --autocannon-pipelining <n>
                          Override probe pipelining.
  --check                  Resolve k6 and write a runner summary without running a script.
  --k6-bin <path|command>  Explicit k6 binary. Env: SUPERAPP_K6_BIN or K6_BIN.
  --require-k6             Exit 1 when k6 is unavailable. Default is a skipped summary.
  --base-url <url>         SuperApp origin passed to k6 env. Default: ${DEFAULT_BASE_URL}
  --app-dir <path>         Launch a SuperApp server before k6 and stop it after cooldown.
  --app-host <host>        Server bind host for --app-dir. Default: ${DEFAULT_SERVER_HOST}
  --app-port <port>        Server port for --app-dir. Default: reserve a free port.
  --health-path <path>     Server readiness path. Default: ${DEFAULT_HEALTH_PATH}
  --startup-timeout-ms <n> Server readiness timeout. Default: ${DEFAULT_STARTUP_TIMEOUT_MS}
  --health-timeout-ms <n>  Per-readiness-request timeout. Default: ${DEFAULT_HEALTH_TIMEOUT_MS}
  --warmup-ms <n>          Delay after readiness before k6 starts. Default: 0
  --cooldown-ms <n>        Delay after k6 exits before server shutdown. Default: 0
  --shutdown-timeout-ms <n> Server shutdown grace period. Default: ${DEFAULT_SHUTDOWN_TIMEOUT_MS}
  --skip-build             Skip the default app build step before serving.
  --build-command <cmd>    Build command for --app-dir. Default: pnpm
  --build-arg <arg>        Build arg; repeatable. Default: run, build
  --server-command <cmd>   Server command for --app-dir. Default: pnpm
  --server-arg <arg>       Server arg; repeatable. Default: run, serve
  --server-cpu-affinity <note>
                          Metadata-only CPU affinity note for the server process.
  --load-cpu-affinity <note>
                          Metadata-only CPU affinity note for the k6 process.
  --target <name>          Artifact target. Default: ${DEFAULT_TARGET}
  --profile <name>         Artifact profile. Default: ${DEFAULT_PROFILE}
  --threshold-profile <smoke|release|nightly>
                          Load threshold profile. Default: ${DEFAULT_LOAD_THRESHOLD_PROFILE}; release/nightly are certification-only.
  --run-id <id>            Artifact run id. Default: timestamped
  --output-dir <path>      Artifact directory. Default: ${DEFAULT_OUTPUT_ROOT}/<run-id>
  --out <path>             Artifact summary file or directory.
  --help                   Show this help.

Examples:
  node scripts/superapp-k6/run-superapp-k6.js --check
  node scripts/superapp-k6/run-superapp-k6.js --scenario smoke
  node scripts/superapp-k6/run-superapp-k6.js --autocannon-probes get-bootstrap,post-workflow --base-url http://localhost:8080
  node scripts/superapp-k6/run-superapp-k6.js --app-dir tests/integration/superapp-portfolio --scenario smoke --warmup-ms 5000 --cooldown-ms 2000
  SUPERAPP_K6_BIN=/usr/local/bin/k6 node scripts/superapp-k6/run-superapp-k6.js --scenario mixed-read-write -- --tag lane=ust-load-02
  SUPERAPP_AUTOCANNON_BIN=pnpm SUPERAPP_AUTOCANNON_BIN_ARGS="dlx autocannon" node scripts/superapp-k6/run-superapp-k6.js --autocannon-probes all
`;

function parseArgs(argv, env = process.env) {
  const envBaseUrl = env.SUPERAPP_K6_BASE_URL || env.SUPERAPP_LOAD_BASE_URL;
  const parsed = {
    baseUrl: envBaseUrl || DEFAULT_BASE_URL,
    baseUrlExplicit: Boolean(envBaseUrl),
    target: env.SUPERAPP_K6_TARGET || DEFAULT_TARGET,
    profile: env.SUPERAPP_K6_PROFILE || DEFAULT_PROFILE,
    thresholdProfile:
      env.SUPERAPP_K6_THRESHOLD_PROFILE || DEFAULT_LOAD_THRESHOLD_PROFILE,
    runId:
      env.SUPERAPP_K6_RUN_ID ||
      `superapp-k6-${new Date().toISOString()}-${process.pid}`,
    outputDir: env.SUPERAPP_K6_OUTPUT_DIR,
    outputPath: env.SUPERAPP_K6_OUT,
    scriptPath: env.SUPERAPP_K6_SCRIPT,
    scenario: env.SUPERAPP_K6_SCENARIO,
    k6Bin: env.SUPERAPP_K6_BIN || env.K6_BIN,
    requireK6: parseBooleanEnv(env.SUPERAPP_K6_REQUIRE),
    autocannonProbes: env.SUPERAPP_AUTOCANNON_PROBES,
    autocannonBin: env.SUPERAPP_AUTOCANNON_BIN || env.AUTOCANNON_BIN,
    autocannonBinArgs: parseArgsListEnv(env.SUPERAPP_AUTOCANNON_BIN_ARGS),
    requireAutocannon: parseBooleanEnv(env.SUPERAPP_AUTOCANNON_REQUIRE),
    autocannonWorkers: parseOptionalPositiveInt(
      env.SUPERAPP_AUTOCANNON_WORKERS,
    ),
    autocannonConnections: parseOptionalPositiveInt(
      env.SUPERAPP_AUTOCANNON_CONNECTIONS,
    ),
    autocannonDurationSeconds: parseOptionalPositiveInt(
      env.SUPERAPP_AUTOCANNON_DURATION_SECONDS,
    ),
    autocannonTimeoutSeconds: parseOptionalPositiveInt(
      env.SUPERAPP_AUTOCANNON_TIMEOUT_SECONDS,
    ),
    autocannonPipelining: parseOptionalPositiveInt(
      env.SUPERAPP_AUTOCANNON_PIPELINING,
    ),
    appDir: env.SUPERAPP_K6_APP_DIR,
    appHost: env.SUPERAPP_K6_APP_HOST || DEFAULT_SERVER_HOST,
    appPort: parseOptionalPositiveInt(env.SUPERAPP_K6_APP_PORT),
    healthPath: env.SUPERAPP_K6_HEALTH_PATH || DEFAULT_HEALTH_PATH,
    startupTimeoutMs:
      parseOptionalPositiveInt(env.SUPERAPP_K6_STARTUP_TIMEOUT_MS) ??
      DEFAULT_STARTUP_TIMEOUT_MS,
    healthTimeoutMs:
      parseOptionalPositiveInt(env.SUPERAPP_K6_HEALTH_TIMEOUT_MS) ??
      DEFAULT_HEALTH_TIMEOUT_MS,
    warmupMs: parseOptionalNonNegativeInt(env.SUPERAPP_K6_WARMUP_MS) ?? 0,
    cooldownMs: parseOptionalNonNegativeInt(env.SUPERAPP_K6_COOLDOWN_MS) ?? 0,
    shutdownTimeoutMs:
      parseOptionalPositiveInt(env.SUPERAPP_K6_SHUTDOWN_TIMEOUT_MS) ??
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
    skipBuild: parseBooleanEnv(env.SUPERAPP_K6_SKIP_BUILD),
    buildCommand: env.SUPERAPP_K6_BUILD_COMMAND,
    buildArgs: parseArgsListEnv(env.SUPERAPP_K6_BUILD_ARGS),
    serverCommand: env.SUPERAPP_K6_SERVER_COMMAND,
    serverArgs: parseArgsListEnv(env.SUPERAPP_K6_SERVER_ARGS),
    serverCpuAffinity: env.SUPERAPP_K6_SERVER_CPU_AFFINITY,
    loadCpuAffinity: env.SUPERAPP_K6_LOAD_CPU_AFFINITY,
    checkOnly: false,
    passThroughArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      parsed.passThroughArgs = argv.slice(index + 1);
      break;
    }

    switch (arg) {
      case '--script':
        parsed.scriptPath = requireValue(argv, ++index, arg);
        break;
      case '--scenario':
        parsed.scenario = requireValue(argv, ++index, arg);
        break;
      case '--list-scenarios':
        parsed.listScenarios = true;
        break;
      case '--autocannon-probes':
        parsed.autocannonProbes = requireValue(argv, ++index, arg);
        break;
      case '--list-autocannon-probes':
        parsed.listAutocannonProbes = true;
        break;
      case '--autocannon-bin':
        parsed.autocannonBin = requireValue(argv, ++index, arg);
        break;
      case '--autocannon-bin-arg':
        parsed.autocannonBinArgs ||= [];
        parsed.autocannonBinArgs.push(requireRawValue(argv, ++index, arg));
        break;
      case '--require-autocannon':
        parsed.requireAutocannon = true;
        break;
      case '--autocannon-workers':
        parsed.autocannonWorkers = requirePositiveInt(argv, ++index, arg);
        break;
      case '--autocannon-connections':
        parsed.autocannonConnections = requirePositiveInt(argv, ++index, arg);
        break;
      case '--autocannon-duration-seconds':
        parsed.autocannonDurationSeconds = requirePositiveInt(
          argv,
          ++index,
          arg,
        );
        break;
      case '--autocannon-timeout-seconds':
        parsed.autocannonTimeoutSeconds = requirePositiveInt(
          argv,
          ++index,
          arg,
        );
        break;
      case '--autocannon-pipelining':
        parsed.autocannonPipelining = requirePositiveInt(argv, ++index, arg);
        break;
      case '--check':
        parsed.checkOnly = true;
        break;
      case '--k6-bin':
        parsed.k6Bin = requireValue(argv, ++index, arg);
        break;
      case '--require-k6':
        parsed.requireK6 = true;
        break;
      case '--base-url':
        parsed.baseUrl = requireValue(argv, ++index, arg);
        parsed.baseUrlExplicit = true;
        break;
      case '--app-dir':
        parsed.appDir = requireValue(argv, ++index, arg);
        break;
      case '--app-host':
        parsed.appHost = requireValue(argv, ++index, arg);
        break;
      case '--app-port':
        parsed.appPort = requirePositiveInt(argv, ++index, arg);
        break;
      case '--health-path':
        parsed.healthPath = requireValue(argv, ++index, arg);
        break;
      case '--startup-timeout-ms':
        parsed.startupTimeoutMs = requirePositiveInt(argv, ++index, arg);
        break;
      case '--health-timeout-ms':
        parsed.healthTimeoutMs = requirePositiveInt(argv, ++index, arg);
        break;
      case '--warmup-ms':
        parsed.warmupMs = requireNonNegativeInt(argv, ++index, arg);
        break;
      case '--cooldown-ms':
        parsed.cooldownMs = requireNonNegativeInt(argv, ++index, arg);
        break;
      case '--shutdown-timeout-ms':
        parsed.shutdownTimeoutMs = requirePositiveInt(argv, ++index, arg);
        break;
      case '--skip-build':
        parsed.skipBuild = true;
        break;
      case '--build-command':
        parsed.buildCommand = requireValue(argv, ++index, arg);
        break;
      case '--build-arg':
        parsed.buildArgs ||= [];
        parsed.buildArgs.push(requireRawValue(argv, ++index, arg));
        break;
      case '--server-command':
        parsed.serverCommand = requireValue(argv, ++index, arg);
        break;
      case '--server-arg':
        parsed.serverArgs ||= [];
        parsed.serverArgs.push(requireRawValue(argv, ++index, arg));
        break;
      case '--server-cpu-affinity':
        parsed.serverCpuAffinity = requireValue(argv, ++index, arg);
        break;
      case '--load-cpu-affinity':
        parsed.loadCpuAffinity = requireValue(argv, ++index, arg);
        break;
      case '--target':
        parsed.target = requireValue(argv, ++index, arg);
        break;
      case '--profile':
        parsed.profile = requireValue(argv, ++index, arg);
        break;
      case '--threshold-profile':
        parsed.thresholdProfile = requireValue(argv, ++index, arg);
        break;
      case '--run-id':
        parsed.runId = requireValue(argv, ++index, arg);
        break;
      case '--output-dir':
        parsed.outputDir = requireValue(argv, ++index, arg);
        break;
      case '--out':
        parsed.outputPath = requireValue(argv, ++index, arg);
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.baseUrl = parsed.baseUrl.replace(/\/+$/, '');
  parsed.appDir = parsed.appDir ? resolveRepoPath(parsed.appDir) : undefined;
  parsed.healthPath = normalizeHealthPath(parsed.healthPath);
  parsed.buildCommand = parsed.buildCommand || 'pnpm';
  parsed.buildArgs = parsed.buildArgs || ['run', 'build'];
  parsed.serverCommand = parsed.serverCommand || 'pnpm';
  parsed.serverArgs = parsed.serverArgs || ['run', 'serve'];
  parsed.autocannonBinArgs = parsed.autocannonBinArgs || [];
  parsed.thresholdProfile = normalizeLoadThresholdProfile(
    parsed.thresholdProfile,
  );
  parsed.runId = sanitizeSegment(parsed.runId);
  if (parsed.scenario) {
    parsed.scenarioIds = normalizeScenarioSelection(parsed.scenario);
    parsed.scriptPath ||= DEFAULT_SCENARIO_SCRIPT;
  } else {
    parsed.scenarioIds = [];
  }
  if (parsed.autocannonProbes) {
    parsed.autocannonProbeIds = normalizeAutocannonProbeSelection(
      parsed.autocannonProbes,
    );
  } else {
    parsed.autocannonProbeIds = [];
  }
  parsed.loadGenerator =
    parsed.autocannonProbeIds.length > 0 ? 'autocannon' : 'k6';
  parsed.scriptPath = parsed.scriptPath
    ? resolveRepoPath(parsed.scriptPath)
    : undefined;

  const defaultOutputDir = path.join(DEFAULT_OUTPUT_ROOT, parsed.runId);
  if (parsed.outputPath) {
    const outputPath = resolveRepoPath(parsed.outputPath);
    if (path.extname(outputPath) === '.json') {
      parsed.outputFile = outputPath;
      parsed.outputDir = path.dirname(outputPath);
    } else {
      parsed.outputDir = outputPath;
      parsed.outputFile = path.join(outputPath, 'summary.json');
    }
  } else {
    parsed.outputDir = resolveRepoPath(parsed.outputDir || defaultOutputDir);
    parsed.outputFile = path.join(parsed.outputDir, 'summary.json');
  }

  parsed.k6SummaryFile = path.join(parsed.outputDir, 'k6-summary.json');
  return parsed;
}

function parseBooleanEnv(value) {
  if (value === undefined || value === '') {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseArgsListEnv(value) {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item));
    }
  } catch {
    // Fall through to whitespace splitting for simple env overrides.
  }
  return String(value).split(/\s+/).filter(Boolean);
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function requireRawValue(argv, index, name) {
  const value = argv[index];
  if (value === undefined) {
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

function normalizeHealthPath(value) {
  const healthPath = String(value || DEFAULT_HEALTH_PATH);
  return healthPath.startsWith('/') ? healthPath : `/${healthPath}`;
}

function resolveRepoPath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(REPO_ROOT, value);
}

function sanitizeSegment(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-+/g, '-');
}

function resolveExecutableValue(value) {
  if (!value) {
    return value;
  }
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (value.includes('/') || value.includes('\\') || value.startsWith('.')) {
    return resolveRepoPath(value);
  }
  return value;
}

function buildK6Candidates(options) {
  const explicitBin = options.k6Bin && resolveExecutableValue(options.k6Bin);
  if (explicitBin) {
    return [
      {
        command: explicitBin,
        source: options.k6Bin ? 'explicit' : 'environment',
      },
    ];
  }

  return [
    {
      command: resolveRepoPath(LOCAL_K6_BIN),
      source: 'local node_modules',
    },
    {
      command: 'k6',
      source: 'PATH',
    },
  ];
}

function probeK6Candidate(candidate, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(candidate.command, ['version'], {
    encoding: 'utf8',
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const output = `${stdout}${stderr}`.trim();

  if (!result.error && result.status === 0) {
    return {
      ok: true,
      command: candidate.command,
      source: candidate.source,
      version: firstLine(output) || 'version output unavailable',
      stdout,
      stderr,
    };
  }

  return {
    ok: false,
    command: candidate.command,
    source: candidate.source,
    error:
      result.error?.message ||
      firstLine(output) ||
      `k6 version exited with status ${result.status}`,
    status: result.status,
    signal: result.signal,
  };
}

function resolveK6Binary(options, spawnSyncImpl = spawnSync) {
  const attempts = [];

  for (const candidate of buildK6Candidates(options)) {
    const probe = probeK6Candidate(candidate, spawnSyncImpl);
    attempts.push(probe);
    if (probe.ok) {
      return {
        found: true,
        command: probe.command,
        source: probe.source,
        version: probe.version,
        attempts,
      };
    }
  }

  return {
    found: false,
    attempts,
  };
}

function buildAutocannonCandidates(options) {
  const explicitBin =
    options.autocannonBin && resolveExecutableValue(options.autocannonBin);
  if (explicitBin) {
    return [
      {
        command: explicitBin,
        args: options.autocannonBinArgs || [],
        source: 'explicit',
      },
    ];
  }

  return [
    {
      command: resolveRepoPath(LOCAL_AUTOCANNON_BIN),
      args: [],
      source: 'local node_modules',
    },
    {
      command: 'autocannon',
      args: [],
      source: 'PATH',
    },
  ];
}

function probeAutocannonCandidate(candidate, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(
    candidate.command,
    [...candidate.args, '--version'],
    {
      encoding: 'utf8',
    },
  );
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const output = `${stdout}${stderr}`.trim();

  if (!result.error && result.status === 0) {
    return {
      ok: true,
      command: candidate.command,
      args: candidate.args,
      source: candidate.source,
      version: firstLine(output) || 'version output unavailable',
      stdout,
      stderr,
    };
  }

  return {
    ok: false,
    command: candidate.command,
    args: candidate.args,
    source: candidate.source,
    error:
      result.error?.message ||
      firstLine(output) ||
      `autocannon --version exited with status ${result.status}`,
    status: result.status,
    signal: result.signal,
  };
}

function resolveAutocannonBinary(options, spawnSyncImpl = spawnSync) {
  const attempts = [];

  for (const candidate of buildAutocannonCandidates(options)) {
    const probe = probeAutocannonCandidate(candidate, spawnSyncImpl);
    attempts.push(probe);
    if (probe.ok) {
      return {
        found: true,
        command: probe.command,
        args: probe.args || [],
        source: probe.source,
        version: probe.version,
        attempts,
      };
    }
  }

  return {
    found: false,
    attempts,
  };
}

function firstLine(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
}

function createMissingK6Diagnostic(resolution) {
  const attempted = resolution.attempts.map(attempt => ({
    command: attempt.command,
    args: attempt.args,
    source: attempt.source,
    error: attempt.error,
  }));
  const explicitAttempt = attempted.find(
    attempt => attempt.source === 'explicit',
  );

  return {
    code: 'K6_NOT_AVAILABLE',
    message: explicitAttempt
      ? `Configured k6 binary is not executable: ${explicitAttempt.command}`
      : 'No usable k6 binary found in local node_modules or PATH.',
    actions: [
      'Install k6 and ensure it is available on PATH, for example: brew install k6.',
      'Set SUPERAPP_K6_BIN=/absolute/path/to/k6 or pass --k6-bin /absolute/path/to/k6.',
      'Use --require-k6 only in jobs where missing k6 should fail the build.',
    ],
    attempted,
  };
}

function createMissingAutocannonDiagnostic(resolution) {
  const attempted = resolution.attempts.map(attempt => ({
    command: attempt.command,
    args: attempt.args,
    source: attempt.source,
    error: attempt.error,
  }));
  const explicitAttempt = attempted.find(
    attempt => attempt.source === 'explicit',
  );

  return {
    code: 'AUTOCANNON_NOT_AVAILABLE',
    message: explicitAttempt
      ? `Configured autocannon binary is not executable: ${explicitAttempt.command}`
      : 'No usable autocannon binary found in local node_modules or PATH.',
    actions: [
      'Install autocannon or ensure it is available on PATH.',
      'Set SUPERAPP_AUTOCANNON_BIN=/absolute/path/to/autocannon or pass --autocannon-bin /absolute/path/to/autocannon.',
      'To run through pnpm dlx, set SUPERAPP_AUTOCANNON_BIN=pnpm and SUPERAPP_AUTOCANNON_BIN_ARGS="dlx autocannon".',
      'Use --require-autocannon only in jobs where missing autocannon should fail the build.',
    ],
    attempted,
  };
}

function createScriptMissingDiagnostic(scriptPath) {
  return {
    code: 'K6_SCRIPT_NOT_FOUND',
    message: `k6 script does not exist: ${scriptPath}`,
    actions: [
      'Pass an existing script with --script <path>.',
      'Use --check when only validating the local k6 execution path.',
    ],
    attempted: [],
  };
}

function createK6Env(options) {
  return {
    ...process.env,
    BASE_URL: options.baseUrl,
    SUPERAPP_K6_BASE_URL: options.baseUrl,
    SUPERAPP_K6_RUN_ID: options.runId,
    SUPERAPP_K6_OUTPUT_DIR: options.outputDir,
    SUPERAPP_K6_SUMMARY: options.k6SummaryFile,
    SUPERAPP_K6_SCENARIO: options.scenario || '',
    SUPERAPP_K6_SCENARIOS: options.scenarioIds.join(','),
    SUPERAPP_K6_TARGET: options.target,
    SUPERAPP_K6_PROFILE: options.profile,
    SUPERAPP_K6_THRESHOLD_PROFILE: options.thresholdProfile,
    SUPERAPP_K6_LOAD_CPU_AFFINITY: options.loadCpuAffinity || '',
    SUPERAPP_K6_SERVER_CPU_AFFINITY: options.serverCpuAffinity || '',
  };
}

function createAutocannonEnv(options) {
  return {
    ...process.env,
    BASE_URL: options.baseUrl,
    SUPERAPP_AUTOCANNON_BASE_URL: options.baseUrl,
    SUPERAPP_AUTOCANNON_PROBES: options.autocannonProbeIds.join(','),
    SUPERAPP_K6_BASE_URL: options.baseUrl,
    SUPERAPP_K6_RUN_ID: options.runId,
    SUPERAPP_K6_OUTPUT_DIR: options.outputDir,
    SUPERAPP_K6_TARGET: options.target,
    SUPERAPP_K6_PROFILE: options.profile,
    SUPERAPP_K6_THRESHOLD_PROFILE: options.thresholdProfile,
    SUPERAPP_AUTOCANNON_THRESHOLD_PROFILE: options.thresholdProfile,
    SUPERAPP_K6_LOAD_CPU_AFFINITY: options.loadCpuAffinity || '',
    SUPERAPP_K6_SERVER_CPU_AFFINITY: options.serverCpuAffinity || '',
  };
}

function runK6Script(options, resolution, spawnSyncImpl = spawnSync) {
  const args = [
    'run',
    '--summary-export',
    options.k6SummaryFile,
    ...options.passThroughArgs,
    options.scriptPath,
  ];
  fs.mkdirSync(options.outputDir, { recursive: true });
  const stdoutPath = path.join(options.outputDir, 'k6-stdout.log');
  const stderrPath = path.join(options.outputDir, 'k6-stderr.log');
  const result = spawnSyncImpl(resolution.command, args, {
    cwd: REPO_ROOT,
    env: createK6Env(options),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    stdio: 'pipe',
  });
  fs.writeFileSync(stdoutPath, result.stdout || '');
  fs.writeFileSync(stderrPath, result.stderr || '');

  if (result.error) {
    return {
      status: 'failed',
      diagnostic: {
        code: 'K6_SPAWN_FAILED',
        message: result.error.message,
        actions: [
          'Verify that the resolved k6 binary is executable.',
          'Set SUPERAPP_K6_BIN to a known-good k6 binary and retry.',
        ],
      },
      exitCode: 1,
      artifacts: [
        {
          path: stdoutPath,
          label: 'k6 stdout log',
        },
        {
          path: stderrPath,
          label: 'k6 stderr log',
        },
      ],
    };
  }

  const exitCode = result.status ?? 1;
  const artifacts = [
    {
      path: stdoutPath,
      label: 'k6 stdout log',
    },
    {
      path: stderrPath,
      label: 'k6 stderr log',
    },
  ];
  if (fs.existsSync(options.k6SummaryFile)) {
    artifacts.push({
      path: options.k6SummaryFile,
      label: 'k6 summary export',
    });
  }
  return {
    status: exitCode === 0 ? 'passed' : 'failed',
    diagnostic:
      exitCode === 0
        ? undefined
        : {
            code: 'K6_RUN_FAILED',
            message: `k6 exited with status ${exitCode}`,
            actions: [
              'Inspect k6 stdout/stderr and the exported k6 summary artifact.',
              'Rerun with --check to isolate binary resolution from scenario failures.',
            ],
          },
    exitCode,
    artifacts,
    loadGenerator: {
      command: resolution.command,
      args,
      stdoutPath,
      stderrPath,
    },
  };
}

function runAutocannonProbes(options, resolution, spawnSyncImpl = spawnSync) {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const probeResults = [];
  const artifacts = [];

  for (const probeId of options.autocannonProbeIds) {
    const probe = getAutocannonProbeDefinition(probeId);
    const run = buildAutocannonCliArgs(probe, {
      baseUrl: options.baseUrl,
      runId: options.runId,
      workers: options.autocannonWorkers,
      connections: options.autocannonConnections,
      durationSeconds: options.autocannonDurationSeconds,
      timeoutSeconds: options.autocannonTimeoutSeconds,
      pipelining: options.autocannonPipelining,
    });
    const artifactPrefix = `autocannon-${sanitizeSegment(probe.id)}`;
    const stdoutPath = path.join(
      options.outputDir,
      `${artifactPrefix}-stdout.json`,
    );
    const stderrPath = path.join(
      options.outputDir,
      `${artifactPrefix}-stderr.log`,
    );
    const args = [...(resolution.args || []), ...run.args];
    const result = spawnSyncImpl(resolution.command, args, {
      cwd: REPO_ROOT,
      env: createAutocannonEnv(options),
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: 'pipe',
    });
    fs.writeFileSync(stdoutPath, result.stdout || '');
    fs.writeFileSync(stderrPath, result.stderr || '');

    const parsedReport = parseAutocannonJson(result.stdout || '');
    const classification = classifyAutocannonProbeResult({
      expectedStatus: probe.endpoint.expectedStatus,
      parseError: parsedReport.error,
      report: parsedReport.report,
      result,
    });
    const probeStatus =
      result.error || result.status !== 0 || !parsedReport.ok
        ? 'failed'
        : 'passed';

    probeResults.push({
      id: probe.id,
      label: probe.label,
      role: probe.role,
      status: probeStatus,
      endpoint: probe.endpoint,
      autocannon: run.autocannon,
      request: {
        bodyBytes: run.request.bodyBytes,
        headers: Object.keys(run.request.headers).sort(),
        method: run.request.method,
        path: run.request.path,
      },
      process: {
        command: resolution.command,
        args,
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message,
        stdoutPath,
        stderrPath,
      },
      classification,
      reportSummary: parsedReport.report
        ? summarizeAutocannonReport(parsedReport.report)
        : undefined,
    });
    artifacts.push(
      {
        path: stdoutPath,
        label: `${probe.id} autocannon stdout JSON`,
      },
      {
        path: stderrPath,
        label: `${probe.id} autocannon stderr log`,
      },
    );
  }

  const finishedAt = new Date().toISOString();
  const probeArtifactPath = path.join(
    options.outputDir,
    'autocannon-probes.json',
  );
  const probeArtifact = {
    schemaVersion: 1,
    suite: 'superapp-k6-load',
    runner: 'autocannon',
    catalog: getAutocannonProbeCatalog(),
    baseUrl: options.baseUrl,
    runId: options.runId,
    startedAt,
    finishedAt,
    probes: probeResults,
    aggregateClassification: aggregateAutocannonClassifications(probeResults),
  };
  const thresholdEvaluation = evaluateAutocannonThresholds(
    probeResults,
    options.thresholdProfile,
  );
  probeArtifact.thresholdProfile = thresholdEvaluation.profile;
  probeArtifact.thresholdEvaluation = thresholdEvaluation;
  fs.writeFileSync(
    probeArtifactPath,
    `${JSON.stringify(probeArtifact, null, 2)}\n`,
  );
  artifacts.push({
    path: probeArtifactPath,
    label: 'autocannon probe classification artifact',
  });

  const failedProbes = probeResults.filter(probe => probe.status === 'failed');
  const thresholdFailures = thresholdEvaluation.failures;
  const aggregateClassification = probeArtifact.aggregateClassification;
  const observations = [
    `Autocannon ran ${probeResults.length} multi-worker endpoint probes against ${options.baseUrl}.`,
    `Autocannon classification: ${aggregateClassification.category}.`,
    `Autocannon threshold profile ${thresholdEvaluation.profile.id} is ${thresholdEvaluation.profile.defaultPrCost.selectedByDefault ? 'default metadata only' : 'certification-only'} and does not add smoke/default PR cost.`,
  ];
  if (aggregateClassification.serverFailureCount > 0) {
    observations.push(
      `${aggregateClassification.serverFailureCount} server-side HTTP failures were observed across autocannon probes.`,
    );
  }
  if (aggregateClassification.clientSocketFailureCount > 0) {
    observations.push(
      `${aggregateClassification.clientSocketFailureCount} client/socket failures were observed across autocannon probes.`,
    );
  }

  return {
    status:
      failedProbes.length > 0 || thresholdFailures.length > 0
        ? 'failed'
        : 'passed',
    diagnostic:
      failedProbes.length > 0
        ? {
            code: 'AUTOCANNON_RUN_FAILED',
            message: `${failedProbes.length} autocannon probe(s) failed before producing usable classification metadata.`,
            actions: [
              'Inspect autocannon stdout/stderr artifacts for the failed probes.',
              'Rerun with --list-autocannon-probes to verify probe ids and --check to isolate runner setup.',
            ],
          }
        : thresholdFailures.length > 0
          ? {
              code: 'AUTOCANNON_THRESHOLD_FAILED',
              message: `${thresholdFailures.length} autocannon threshold failure(s) for ${thresholdEvaluation.profile.id}: ${thresholdFailures.join(
                '; ',
              )}`,
              actions: [
                'Inspect autocannon-probes.json for per-probe latency, HTTP failure, and client/socket classification details.',
                'Compare release and nightly threshold profiles before relaxing a limit.',
              ],
            }
          : undefined,
    exitCode: failedProbes.length > 0 || thresholdFailures.length > 0 ? 1 : 0,
    artifacts,
    budgetFailures: thresholdFailures,
    budgets: {
      autocannonThresholds: thresholdEvaluation.thresholds,
    },
    observations,
    thresholds: thresholdEvaluation,
    loadGenerator: {
      kind: 'autocannon',
      command: resolution.command,
      argsPrefix: resolution.args || [],
      probes: probeResults.map(probe => ({
        id: probe.id,
        status: probe.status,
        endpoint: probe.endpoint,
        autocannon: probe.autocannon,
        classification: probe.classification,
        reportSummary: probe.reportSummary,
      })),
    },
  };
}

function parseAutocannonJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return {
      ok: false,
      error: 'autocannon produced no JSON output',
    };
  }

  try {
    return {
      ok: true,
      report: JSON.parse(text),
    };
  } catch (error) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return {
          ok: true,
          report: JSON.parse(text.slice(firstBrace, lastBrace + 1)),
        };
      } catch {
        // Fall through to the original parse error.
      }
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function classifyAutocannonProbeResult(input) {
  if (input.result.error || input.result.status !== 0 || input.parseError) {
    return {
      category: 'harness',
      harnessFailure: true,
      message:
        input.result.error?.message ||
        input.parseError ||
        `autocannon exited with status ${input.result.status}`,
    };
  }

  const report = input.report || {};
  const statusCounts = normalizeStatusCodeCounts(report.statusCodeStats);
  const expectedStatuses = normalizeExpectedStatuses(input.expectedStatus);
  const unexpectedStatusCounts = {};
  let expectedStatusCount = 0;
  let serverFailureCount = 0;

  for (const [status, count] of Object.entries(statusCounts)) {
    if (expectedStatuses.has(Number(status))) {
      expectedStatusCount += count;
    } else {
      unexpectedStatusCounts[status] = count;
      serverFailureCount += count;
    }
  }

  const non2xxCount = numberValue(report.non2xx);
  serverFailureCount = Math.max(serverFailureCount, non2xxCount);

  const timeoutCount = numberValue(report.timeouts);
  const socketErrorCount = numberValue(report.errors);
  const clientSocketFailureCount = timeoutCount + socketErrorCount;
  const hasServerFailures = serverFailureCount > 0;
  const hasClientSocketFailures = clientSocketFailureCount > 0;

  return {
    category:
      hasServerFailures && hasClientSocketFailures
        ? 'mixed'
        : hasServerFailures
          ? 'server'
          : hasClientSocketFailures
            ? 'client-socket'
            : 'none',
    serverFailureCount,
    clientSocketFailureCount,
    timeoutCount,
    socketErrorCount,
    non2xxCount,
    expectedStatusCount,
    unexpectedStatusCounts,
  };
}

function aggregateAutocannonClassifications(probeResults) {
  const aggregate = {
    category: 'none',
    serverFailureCount: 0,
    clientSocketFailureCount: 0,
    harnessFailureCount: 0,
  };

  for (const probe of probeResults) {
    const classification = probe.classification || {};
    aggregate.serverFailureCount += numberValue(
      classification.serverFailureCount,
    );
    aggregate.clientSocketFailureCount += numberValue(
      classification.clientSocketFailureCount,
    );
    if (classification.category === 'harness') {
      aggregate.harnessFailureCount += 1;
    }
  }

  if (
    aggregate.serverFailureCount > 0 &&
    aggregate.clientSocketFailureCount > 0
  ) {
    aggregate.category = 'mixed';
  } else if (aggregate.serverFailureCount > 0) {
    aggregate.category = 'server';
  } else if (aggregate.clientSocketFailureCount > 0) {
    aggregate.category = 'client-socket';
  } else if (aggregate.harnessFailureCount > 0) {
    aggregate.category = 'harness';
  }

  return aggregate;
}

function summarizeAutocannonReport(report) {
  return {
    duration: report.duration,
    errors: numberValue(report.errors),
    non2xx: numberValue(report.non2xx),
    requests: summarizeMetric(report.requests),
    latency: summarizeMetric(report.latency),
    throughput: summarizeMetric(report.throughput),
    timeouts: numberValue(report.timeouts),
    statusCodeStats: normalizeStatusCodeCounts(report.statusCodeStats),
  };
}

function summarizeMetric(metric) {
  if (!metric || typeof metric !== 'object') {
    return undefined;
  }
  return {
    average: metric.average,
    mean: metric.mean,
    p95: metric.p95,
    p99: metric.p99,
    total: metric.total,
  };
}

function normalizeStatusCodeCounts(statusCodeStats) {
  if (!statusCodeStats || typeof statusCodeStats !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(statusCodeStats).map(([status, value]) => [
      status,
      typeof value === 'number' ? value : numberValue(value?.count),
    ]),
  );
}

function normalizeExpectedStatuses(expectedStatus) {
  if (Array.isArray(expectedStatus)) {
    return new Set(expectedStatus.map(Number));
  }
  if (typeof expectedStatus === 'number') {
    return new Set([expectedStatus]);
  }
  return new Set([200]);
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createRunnerSummary(
  options,
  runnerResult,
  resolution,
  startedAt,
  orchestration,
) {
  const finishedAt = new Date().toISOString();
  const isSkipped = runnerResult.status === 'skipped';
  const isFailed = runnerResult.status === 'failed';
  const diagnostic = runnerResult.diagnostic;
  const budgetFailures =
    isFailed && runnerResult.budgetFailures?.length > 0
      ? runnerResult.budgetFailures
      : isFailed && diagnostic
        ? [diagnostic.message]
        : [];
  const observations = [
    ...cpuAffinityObservations(options),
    ...(runnerResult.observations || []),
  ];
  const summary = createArtifactEnvelope({
    suite: 'superapp-k6-load',
    target: options.target,
    profile: options.profile,
    status: isSkipped ? 'unknown' : runnerResult.status,
    startedAt,
    finishedAt,
    dimensions: ['performance'],
    parameters: {
      baseUrl: options.baseUrl,
      checkOnly:
        options.loadGenerator === 'k6'
          ? options.checkOnly || !options.scriptPath
          : options.checkOnly || options.autocannonProbeIds.length === 0,
      requireK6: options.requireK6,
      scenario: options.scenario,
      scenarioIds: options.scenarioIds,
      scriptPath: options.scriptPath,
      passThroughArgs: options.passThroughArgs,
      k6Bin: options.k6Bin,
      appDir: options.appDir,
      appHost: options.appHost,
      appPort: options.appPort,
      healthPath: options.healthPath,
      startupTimeoutMs: options.startupTimeoutMs,
      healthTimeoutMs: options.healthTimeoutMs,
      warmupMs: options.warmupMs,
      cooldownMs: options.cooldownMs,
      shutdownTimeoutMs: options.shutdownTimeoutMs,
      skipBuild: options.skipBuild,
      serverCommand: options.serverCommand,
      serverArgs: options.serverArgs,
      buildCommand: options.skipBuild ? undefined : options.buildCommand,
      buildArgs: options.skipBuild ? undefined : options.buildArgs,
      serverCpuAffinity: options.serverCpuAffinity,
      loadCpuAffinity: options.loadCpuAffinity,
      loadGenerator: options.loadGenerator,
      thresholdProfile: options.thresholdProfile,
      autocannonProbes: options.autocannonProbes,
      autocannonProbeIds: options.autocannonProbeIds,
      autocannonBin: options.autocannonBin,
      autocannonBinArgs: options.autocannonBinArgs,
      requireAutocannon: options.requireAutocannon,
      autocannonWorkers: options.autocannonWorkers,
      autocannonConnections: options.autocannonConnections,
      autocannonDurationSeconds: options.autocannonDurationSeconds,
      autocannonTimeoutSeconds: options.autocannonTimeoutSeconds,
      autocannonPipelining: options.autocannonPipelining,
      outputDir: options.outputDir,
    },
    budgets: runnerResult.budgets || {},
    budgetFailures,
    unknowns: isSkipped && diagnostic ? [diagnostic.message] : [],
    observations,
    artifacts: runnerResult.artifacts || [],
    detail: {
      runner: {
        status: runnerResult.status,
        exitCode: runnerResult.exitCode,
        diagnostic,
        k6:
          options.loadGenerator === 'k6' && resolution.found
            ? {
                command: resolution.command,
                source: resolution.source,
                version: resolution.version,
              }
            : undefined,
        autocannon:
          options.loadGenerator === 'autocannon' && resolution.found
            ? {
                command: resolution.command,
                argsPrefix: resolution.args || [],
                source: resolution.source,
                version: resolution.version,
              }
            : undefined,
        attempts: resolution.attempts,
        loadGenerator: runnerResult.loadGenerator,
        thresholdProfile: createThresholdProfileSummary(options),
      },
      thresholds:
        runnerResult.thresholds || createThresholdProfileSummary(options),
      orchestration,
    },
  });

  return {
    runId: options.runId,
    ...summary,
  };
}

function cpuAffinityObservations(options) {
  if (!options.serverCpuAffinity && !options.loadCpuAffinity) {
    return [];
  }
  const observations = [
    `CPU affinity is recorded as metadata only by this Node runner on ${process.platform}. Use an external launcher such as taskset on Linux when hard binding is required.`,
  ];
  if (options.serverCpuAffinity) {
    observations.push(`Server CPU affinity note: ${options.serverCpuAffinity}`);
  }
  if (options.loadCpuAffinity) {
    observations.push(`Load CPU affinity note: ${options.loadCpuAffinity}`);
  }
  return observations;
}

function printResult(options, summary) {
  const runner = summary.detail.runner;
  console.log(
    JSON.stringify(
      {
        status: runner.status,
        artifactStatus: summary.status,
        summaryPath: options.outputFile,
        loadGenerator: options.loadGenerator,
        thresholdProfile: options.thresholdProfile,
        scenario: options.scenario,
        scenarioIds: options.scenarioIds,
        autocannonProbeIds: options.autocannonProbeIds,
        k6: runner.k6,
        autocannon: runner.autocannon,
        orchestration: summary.detail.orchestration,
        diagnostic: runner.diagnostic,
      },
      null,
      2,
    ),
  );
}

function createPreflightRunnerResult(options, resolution) {
  if (options.loadGenerator === 'autocannon') {
    return createAutocannonPreflightRunnerResult(options, resolution);
  }

  if (!resolution.found) {
    return {
      status: options.requireK6 ? 'failed' : 'skipped',
      exitCode: options.requireK6 ? 1 : 0,
      diagnostic: createMissingK6Diagnostic(resolution),
    };
  }

  if (options.checkOnly || !options.scriptPath) {
    return {
      status: 'passed',
      exitCode: 0,
      observations: options.scriptPath
        ? ['k6 binary resolved; --check skipped script execution.']
        : ['k6 binary resolved; no script was supplied, so no load ran.'],
    };
  }

  if (!fs.existsSync(options.scriptPath)) {
    return {
      status: 'failed',
      exitCode: 1,
      diagnostic: createScriptMissingDiagnostic(options.scriptPath),
    };
  }

  return undefined;
}

function createAutocannonPreflightRunnerResult(options, resolution) {
  if (!resolution.found) {
    return {
      status: options.requireAutocannon ? 'failed' : 'skipped',
      exitCode: options.requireAutocannon ? 1 : 0,
      diagnostic: createMissingAutocannonDiagnostic(resolution),
    };
  }

  if (options.checkOnly) {
    return {
      status: 'passed',
      exitCode: 0,
      observations: [
        'autocannon binary resolved; --check skipped probe execution.',
      ],
    };
  }

  if (options.autocannonProbeIds.length === 0) {
    return {
      status: 'passed',
      exitCode: 0,
      observations: [
        'autocannon binary resolved; no probes were selected, so no load ran.',
      ],
    };
  }

  return undefined;
}

function createThresholdProfileSummary(options) {
  const profile =
    options.loadGenerator === 'autocannon'
      ? getAutocannonThresholdProfileDefinition(options.thresholdProfile)
      : getLoadThresholdProfileDefinition(options.thresholdProfile);
  return {
    id: profile.id,
    label: profile.label,
    description: profile.description,
    defaultPrCost: profile.defaultPrCost,
    certification: profile.certification,
    thresholds: profile.thresholds,
  };
}

function resolveLoadGeneratorBinary(options, spawnSyncImpl = spawnSync) {
  if (options.loadGenerator === 'autocannon') {
    return resolveAutocannonBinary(options, spawnSyncImpl);
  }
  return resolveK6Binary(options, spawnSyncImpl);
}

function runLoadGenerator(options, resolution, spawnSyncImpl = spawnSync) {
  if (options.loadGenerator === 'autocannon') {
    return runAutocannonProbes(options, resolution, spawnSyncImpl);
  }
  return runK6Script(options, resolution, spawnSyncImpl);
}

function execute(options, spawnSyncImpl = spawnSync) {
  const startedAt = new Date().toISOString();
  const resolution = resolveLoadGeneratorBinary(options, spawnSyncImpl);
  let runnerResult = createPreflightRunnerResult(options, resolution);

  if (!runnerResult) {
    fs.mkdirSync(options.outputDir, { recursive: true });
    runnerResult = runLoadGenerator(options, resolution, spawnSyncImpl);
  }

  const summary = createRunnerSummary(
    options,
    runnerResult,
    resolution,
    startedAt,
  );
  writeArtifactSummary(options.outputFile, summary);
  return {
    summary,
    exitCode: runnerResult.exitCode,
  };
}

async function executeOrchestrated(options, spawnSyncImpl = spawnSync) {
  const startedAt = new Date().toISOString();
  const resolution = resolveLoadGeneratorBinary(options, spawnSyncImpl);
  const artifacts = [];
  const orchestration = createOrchestrationMetadata(options);
  let runnerResult = createPreflightRunnerResult(options, resolution);
  let launched;

  fs.mkdirSync(options.outputDir, { recursive: true });

  if (runnerResult) {
    orchestration.skippedReason = orchestrationSkipReason(runnerResult);
    if (orchestration.skippedReason) {
      runnerResult = {
        ...runnerResult,
        observations: [
          ...(runnerResult.observations || []),
          `SuperApp server was not launched: ${orchestration.skippedReason}`,
        ],
      };
    }
  } else {
    try {
      launched = await launchAppServer(options);
      artifacts.push(...launched.artifacts);
      orchestration.server = launched.metadata;
      if (!options.baseUrlExplicit) {
        options.baseUrl = launched.baseUrl;
      } else if (options.baseUrl !== launched.baseUrl) {
        orchestration.baseUrlOverride = {
          serverBaseUrl: launched.baseUrl,
          loadBaseUrl: options.baseUrl,
        };
      }

      if (options.warmupMs > 0) {
        orchestration.warmup = await timedSleep('warmup', options.warmupMs);
      }

      runnerResult = runLoadGenerator(options, resolution, spawnSyncImpl);

      if (options.cooldownMs > 0) {
        orchestration.cooldown = await timedSleep(
          'cooldown',
          options.cooldownMs,
        );
      }
    } catch (error) {
      const diagnostic = diagnosticFromError(error);
      runnerResult = {
        status: 'failed',
        exitCode: 1,
        diagnostic,
      };
      if (
        error &&
        typeof error === 'object' &&
        Array.isArray(error.artifacts)
      ) {
        artifacts.push(...error.artifacts);
      }
      if (
        error &&
        typeof error === 'object' &&
        error.orchestration &&
        typeof error.orchestration === 'object'
      ) {
        Object.assign(orchestration, error.orchestration);
      }
    } finally {
      if (launched) {
        const stop = await stopAppServer(launched, {
          shutdownTimeoutMs: options.shutdownTimeoutMs,
        });
        orchestration.server = {
          ...orchestration.server,
          stoppedAt: new Date().toISOString(),
          stop,
          outputTail: launched.logs.output(),
        };
      }
    }
  }

  const orchestrationArtifact = writeOrchestrationArtifact(
    options,
    orchestration,
  );
  runnerResult.artifacts = [
    ...(runnerResult.artifacts || []),
    ...artifacts,
    orchestrationArtifact,
  ];

  const summary = createRunnerSummary(
    options,
    runnerResult,
    resolution,
    startedAt,
    orchestration,
  );
  writeArtifactSummary(options.outputFile, summary);
  return {
    summary,
    exitCode: runnerResult.exitCode,
  };
}

function createOrchestrationMetadata(options) {
  return {
    enabled: true,
    mode:
      options.loadGenerator === 'autocannon'
        ? 'app-server-and-autocannon'
        : 'app-server-and-k6',
    platform: process.platform,
    appDir: options.appDir,
    warmupMs: options.warmupMs,
    cooldownMs: options.cooldownMs,
    cpuAffinity: {
      enforcement: 'metadata-only',
      server: options.serverCpuAffinity,
      load: options.loadCpuAffinity,
      note: 'Node does not expose portable CPU affinity binding; use an external launcher for hard binding and keep the requested placement here as artifact metadata.',
    },
  };
}

function orchestrationSkipReason(runnerResult) {
  if (runnerResult.diagnostic?.code === 'K6_NOT_AVAILABLE') {
    return 'k6 is unavailable, so the CI-safe fallback skipped load generation before starting the app server.';
  }
  if (runnerResult.diagnostic?.code === 'AUTOCANNON_NOT_AVAILABLE') {
    return 'autocannon is unavailable, so the CI-safe fallback skipped load generation before starting the app server.';
  }
  if (runnerResult.diagnostic?.code === 'K6_SCRIPT_NOT_FOUND') {
    return 'the selected k6 script is missing.';
  }
  if (runnerResult.status === 'passed') {
    return 'the runner was invoked in check-only mode or without a script.';
  }
  return undefined;
}

function writeOrchestrationArtifact(options, orchestration) {
  const artifactPath = path.join(options.outputDir, 'orchestration.json');
  fs.writeFileSync(artifactPath, `${JSON.stringify(orchestration, null, 2)}\n`);
  return {
    path: artifactPath,
    label: 'process orchestration metadata',
  };
}

async function launchAppServer(options) {
  const port = options.appPort || (await reservePort(options.appHost));
  const baseUrl = createAppBaseUrl(options.appHost, port);
  const healthUrl = new URL(options.healthPath, baseUrl).toString();
  const artifacts = [];
  let build;

  if (!options.skipBuild) {
    build = runAppBuild(options);
    artifacts.push(...build.artifacts);
    if (build.exitCode !== 0) {
      throw createDiagnosticError(
        'APP_BUILD_FAILED',
        `SuperApp build failed with exit code ${build.exitCode}`,
        [
          'Inspect app-build-stdout.log and app-build-stderr.log in the k6 artifact directory.',
          'Rerun with --skip-build only when the app has already been built.',
        ],
        {
          artifacts,
          orchestration: {
            build: build.metadata,
          },
        },
      );
    }
  }

  const logs = createProcessLogCapture(options.outputDir, 'app-server');
  const child = spawn(options.serverCommand, options.serverArgs, {
    cwd: options.appDir,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      HOST: options.appHost,
      NODE_ENV: 'production',
      PORT: String(port),
      SUPERAPP_K6_SERVER_CPU_AFFINITY: options.serverCpuAffinity || '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', logs.appendStdout);
  child.stderr.on('data', logs.appendStderr);
  child.once('error', error => {
    logs.appendStderr(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
  });

  const serverMetadata = {
    appDir: options.appDir,
    baseUrl,
    healthUrl,
    host: options.appHost,
    port,
    process: {
      pid: child.pid,
      command: options.serverCommand,
      args: options.serverArgs,
    },
    logs: {
      stdoutPath: logs.stdoutPath,
      stderrPath: logs.stderrPath,
    },
    build: build?.metadata,
    startedAt: new Date().toISOString(),
  };

  const readiness = await waitForHttp(healthUrl, {
    timeoutMs: options.startupTimeoutMs,
    requestTimeoutMs: options.healthTimeoutMs,
  });
  serverMetadata.readiness = readiness;
  artifacts.push(...logs.artifacts());

  if (!readiness.ok) {
    const stop = await stopChildProcess(child, options.shutdownTimeoutMs);
    throw createDiagnosticError(
      'APP_SERVER_NOT_READY',
      `SuperApp server did not become ready at ${healthUrl}: ${
        readiness.error || 'unknown readiness failure'
      }`,
      [
        'Inspect app-server-stdout.log and app-server-stderr.log in the k6 artifact directory.',
        'Increase --startup-timeout-ms if the production server needs more time to boot.',
      ],
      {
        artifacts,
        orchestration: {
          server: {
            ...serverMetadata,
            stop,
            outputTail: logs.output(),
          },
        },
      },
    );
  }

  return {
    artifacts,
    baseUrl,
    logs,
    metadata: serverMetadata,
    server: {
      child,
    },
  };
}

function runAppBuild(options) {
  const stdoutPath = path.join(options.outputDir, 'app-build-stdout.log');
  const stderrPath = path.join(options.outputDir, 'app-build-stderr.log');
  const startedAt = new Date().toISOString();
  const result = spawnSync(options.buildCommand, options.buildArgs, {
    cwd: options.appDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
    maxBuffer: 50 * 1024 * 1024,
    stdio: 'pipe',
  });
  fs.writeFileSync(stdoutPath, result.stdout || '');
  fs.writeFileSync(stderrPath, result.stderr || '');
  const exitCode = result.status ?? 1;
  const metadata = {
    command: options.buildCommand,
    args: options.buildArgs,
    exitCode,
    signal: result.signal,
    startedAt,
    finishedAt: new Date().toISOString(),
    stdoutPath,
    stderrPath,
  };
  return {
    artifacts: [
      {
        path: stdoutPath,
        label: 'app build stdout log',
      },
      {
        path: stderrPath,
        label: 'app build stderr log',
      },
    ],
    exitCode,
    metadata,
  };
}

function createProcessLogCapture(outputDir, prefix) {
  const stdoutPath = path.join(outputDir, `${prefix}-stdout.log`);
  const stderrPath = path.join(outputDir, `${prefix}-stderr.log`);
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
    stderrPath,
    stdoutPath,
    appendStderr: chunk => append('stderr', stderrPath, chunk),
    appendStdout: chunk => append('stdout', stdoutPath, chunk),
    artifacts() {
      return [
        {
          path: stdoutPath,
          label: `${prefix} stdout log`,
        },
        {
          path: stderrPath,
          label: `${prefix} stderr log`,
        },
      ];
    },
    output() {
      return tails;
    },
  };
}

function reservePort(host = DEFAULT_SERVER_HOST) {
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

function createAppBaseUrl(host, port) {
  const urlHost =
    host === '0.0.0.0' || host === '::'
      ? DEFAULT_SERVER_HOST
      : host.includes(':')
        ? `[${host}]`
        : host;
  return `http://${urlHost}:${port}`;
}

async function waitForHttp(url, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs || DEFAULT_STARTUP_TIMEOUT_MS;
  const intervalMs = options.intervalMs || 250;
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(
          options.requestTimeoutMs || DEFAULT_HEALTH_TIMEOUT_MS,
        ),
      });
      await response.arrayBuffer();
      if (response.status >= 200 && response.status < 500) {
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

async function stopAppServer(launched, options) {
  return stopChildProcess(launched.server.child, options.shutdownTimeoutMs);
}

function stopChildProcess(child, timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS) {
  if (!child || child.killed || child.exitCode !== null) {
    return Promise.resolve({
      stopped: true,
      alreadyExited: true,
    });
  }

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

async function timedSleep(label, durationMs) {
  const startedAt = new Date().toISOString();
  await sleep(durationMs);
  return {
    label,
    requestedMs: durationMs,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createDiagnosticError(code, message, actions, extra = {}) {
  const error = new Error(message);
  error.diagnostic = {
    code,
    message,
    actions,
  };
  Object.assign(error, extra);
  return error;
}

function diagnosticFromError(error) {
  if (error && typeof error === 'object' && error.diagnostic) {
    return error.diagnostic;
  }
  return {
    code: 'APP_ORCHESTRATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    actions: [
      'Inspect process orchestration metadata and captured server/load logs.',
      'Rerun with --check to isolate load-generator binary resolution from server startup.',
    ],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.listScenarios) {
    console.log(JSON.stringify(createScenarioList(), null, 2));
    return;
  }
  if (options.listAutocannonProbes) {
    console.log(JSON.stringify(createAutocannonProbeList(), null, 2));
    return;
  }

  if (options.appDir) {
    executeOrchestrated(options)
      .then(result => {
        printResult(options, result.summary);
        process.exitCode = result.exitCode;
      })
      .catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
    return;
  }

  const result = execute(options);
  printResult(options, result.summary);
  process.exitCode = result.exitCode;
}

function createScenarioList() {
  const catalog = getScenarioCatalog();
  return {
    catalogId: catalog.catalogId,
    defaultScenarioScript: catalog.defaultScenarioScript,
    thresholdProfiles: getLoadThresholdProfiles(),
    scenarios: catalog.scenarios.map(scenario => ({
      id: scenario.id,
      label: scenario.label,
      description: scenario.description,
      k6: scenario.k6,
      operationMix: scenario.operationMix,
      operations: scenario.operations.map(operation => ({
        id: operation.id,
        kind: operation.kind,
        method: operation.method,
        path: operation.path,
        weight: operation.weight,
      })),
    })),
  };
}

function createAutocannonProbeList() {
  const catalog = getAutocannonProbeCatalog();
  return {
    catalogId: catalog.catalogId,
    workerModel: catalog.workerModel,
    thresholdProfiles: getAutocannonThresholdProfiles(),
    probes: catalog.probes.map(probe => ({
      id: probe.id,
      label: probe.label,
      role: probe.role,
      scenarioId: probe.scenarioId,
      operationId: probe.operationId,
      endpoint: probe.endpoint,
      autocannon: probe.autocannon,
      classificationHint: probe.classificationHint,
    })),
  };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  buildAutocannonCandidates,
  buildK6Candidates,
  classifyAutocannonProbeResult,
  createAutocannonProbeList,
  createScenarioList,
  createMissingK6Diagnostic,
  execute,
  executeOrchestrated,
  parseArgs,
  resolveAutocannonBinary,
  reservePort,
  resolveExecutableValue,
  resolveK6Binary,
};
