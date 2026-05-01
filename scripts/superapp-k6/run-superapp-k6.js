#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createArtifactEnvelope,
  writeArtifactSummary,
} = require('../superapp-certification/artifact-schema');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_OUTPUT_ROOT = '.modern/superapp-k6';
const DEFAULT_TARGET = 'superapp';
const DEFAULT_PROFILE = 'k6-runner-check';
const LOCAL_K6_BIN =
  process.platform === 'win32'
    ? path.join('node_modules', '.bin', 'k6.cmd')
    : path.join('node_modules', '.bin', 'k6');

const usage = () => `
Usage:
  node scripts/superapp-k6/run-superapp-k6.js [options] [-- k6 args]

Options:
  --script <path>          k6 script to run. Omit with --check to only verify k6.
  --check                  Resolve k6 and write a runner summary without running a script.
  --k6-bin <path|command>  Explicit k6 binary. Env: SUPERAPP_K6_BIN or K6_BIN.
  --require-k6             Exit 1 when k6 is unavailable. Default is a skipped summary.
  --base-url <url>         SuperApp origin passed to k6 env. Default: ${DEFAULT_BASE_URL}
  --target <name>          Artifact target. Default: ${DEFAULT_TARGET}
  --profile <name>         Artifact profile. Default: ${DEFAULT_PROFILE}
  --run-id <id>            Artifact run id. Default: timestamped
  --output-dir <path>      Artifact directory. Default: ${DEFAULT_OUTPUT_ROOT}/<run-id>
  --out <path>             Artifact summary file or directory.
  --help                   Show this help.

Examples:
  node scripts/superapp-k6/run-superapp-k6.js --check
  SUPERAPP_K6_BIN=/usr/local/bin/k6 node scripts/superapp-k6/run-superapp-k6.js --script scripts/superapp-k6/smoke.js -- --vus 4 --duration 30s
`;

function parseArgs(argv, env = process.env) {
  const parsed = {
    baseUrl:
      env.SUPERAPP_K6_BASE_URL ||
      env.SUPERAPP_LOAD_BASE_URL ||
      DEFAULT_BASE_URL,
    target: env.SUPERAPP_K6_TARGET || DEFAULT_TARGET,
    profile: env.SUPERAPP_K6_PROFILE || DEFAULT_PROFILE,
    runId:
      env.SUPERAPP_K6_RUN_ID ||
      `superapp-k6-${new Date().toISOString()}-${process.pid}`,
    outputDir: env.SUPERAPP_K6_OUTPUT_DIR,
    outputPath: env.SUPERAPP_K6_OUT,
    scriptPath: env.SUPERAPP_K6_SCRIPT,
    k6Bin: env.SUPERAPP_K6_BIN || env.K6_BIN,
    requireK6: parseBooleanEnv(env.SUPERAPP_K6_REQUIRE),
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
        break;
      case '--target':
        parsed.target = requireValue(argv, ++index, arg);
        break;
      case '--profile':
        parsed.profile = requireValue(argv, ++index, arg);
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
  parsed.runId = sanitizeSegment(parsed.runId);
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

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
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

function firstLine(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
}

function createMissingK6Diagnostic(resolution) {
  const attempted = resolution.attempts.map(attempt => ({
    command: attempt.command,
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
    SUPERAPP_K6_TARGET: options.target,
    SUPERAPP_K6_PROFILE: options.profile,
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
  const result = spawnSyncImpl(resolution.command, args, {
    cwd: REPO_ROOT,
    env: createK6Env(options),
    stdio: 'inherit',
  });

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
    };
  }

  const exitCode = result.status ?? 1;
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
    artifacts: fs.existsSync(options.k6SummaryFile)
      ? [
          {
            path: options.k6SummaryFile,
            label: 'k6 summary export',
          },
        ]
      : [],
  };
}

function createRunnerSummary(options, runnerResult, resolution, startedAt) {
  const finishedAt = new Date().toISOString();
  const isSkipped = runnerResult.status === 'skipped';
  const isFailed = runnerResult.status === 'failed';
  const diagnostic = runnerResult.diagnostic;
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
      checkOnly: options.checkOnly || !options.scriptPath,
      requireK6: options.requireK6,
      scriptPath: options.scriptPath,
      passThroughArgs: options.passThroughArgs,
      k6Bin: options.k6Bin,
      outputDir: options.outputDir,
    },
    budgetFailures: isFailed && diagnostic ? [diagnostic.message] : [],
    unknowns: isSkipped && diagnostic ? [diagnostic.message] : [],
    observations: runnerResult.observations || [],
    artifacts: runnerResult.artifacts || [],
    detail: {
      runner: {
        status: runnerResult.status,
        exitCode: runnerResult.exitCode,
        diagnostic,
        k6: resolution.found
          ? {
              command: resolution.command,
              source: resolution.source,
              version: resolution.version,
            }
          : undefined,
        attempts: resolution.attempts,
      },
    },
  });

  return {
    runId: options.runId,
    ...summary,
  };
}

function printResult(options, summary) {
  const runner = summary.detail.runner;
  console.log(
    JSON.stringify(
      {
        status: runner.status,
        artifactStatus: summary.status,
        summaryPath: options.outputFile,
        k6: runner.k6,
        diagnostic: runner.diagnostic,
      },
      null,
      2,
    ),
  );
}

function execute(options, spawnSyncImpl = spawnSync) {
  const startedAt = new Date().toISOString();
  const resolution = resolveK6Binary(options, spawnSyncImpl);
  let runnerResult;

  if (!resolution.found) {
    runnerResult = {
      status: options.requireK6 ? 'failed' : 'skipped',
      exitCode: options.requireK6 ? 1 : 0,
      diagnostic: createMissingK6Diagnostic(resolution),
    };
  } else if (options.checkOnly || !options.scriptPath) {
    runnerResult = {
      status: 'passed',
      exitCode: 0,
      observations: options.scriptPath
        ? ['k6 binary resolved; --check skipped script execution.']
        : ['k6 binary resolved; no script was supplied, so no load ran.'],
    };
  } else if (!fs.existsSync(options.scriptPath)) {
    runnerResult = {
      status: 'failed',
      exitCode: 1,
      diagnostic: createScriptMissingDiagnostic(options.scriptPath),
    };
  } else {
    fs.mkdirSync(options.outputDir, { recursive: true });
    runnerResult = runK6Script(options, resolution, spawnSyncImpl);
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = execute(options);
  printResult(options, result.summary);
  process.exitCode = result.exitCode;
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
  buildK6Candidates,
  createMissingK6Diagnostic,
  execute,
  parseArgs,
  resolveExecutableValue,
  resolveK6Binary,
};
