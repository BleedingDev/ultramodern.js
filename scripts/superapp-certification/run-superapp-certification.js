#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  getScenarioIdsForThresholdProfile,
} = require('../superapp-k6/scenario-catalog');
const {
  getAutocannonThresholdProfileDefinition,
} = require('../superapp-k6/autocannon-probes');

const repoRoot = path.resolve(__dirname, '../..');
const defaultRunId = new Date().toISOString().replace(/[:.]/g, '-');

function parseArgs(argv) {
  const options = {
    profile: process.env.SUPERAPP_CERTIFICATION_PROFILE || 'smoke',
    outDir:
      process.env.SUPERAPP_CERTIFICATION_OUT_DIR ||
      path.join('.modern', 'superapp-certification', defaultRunId),
    dryRun: false,
    continueOnError: false,
    skipUpstreamDrift: false,
    driftOnly: false,
    driftBase: process.env.SUPERAPP_CERTIFICATION_DRIFT_BASE || 'origin/main',
    driftRemote: process.env.SUPERAPP_CERTIFICATION_DRIFT_REMOTE || 'origin',
    driftBranch: process.env.SUPERAPP_CERTIFICATION_DRIFT_BRANCH || 'main',
    driftGates: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--profile') {
      options.profile = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length);
    } else if (arg === '--out-dir') {
      options.outDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--out-dir=')) {
      options.outDir = arg.slice('--out-dir='.length);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--continue-on-error') {
      options.continueOnError = true;
    } else if (arg === '--skip-upstream-drift') {
      options.skipUpstreamDrift = true;
    } else if (arg === '--drift-only') {
      options.driftOnly = true;
    } else if (arg === '--drift-base') {
      options.driftBase = argv[index + 1];
      index += 1;
    } else if (arg === '--drift-remote') {
      options.driftRemote = argv[index + 1];
      index += 1;
    } else if (arg === '--drift-branch') {
      options.driftBranch = argv[index + 1];
      index += 1;
    } else if (arg === '--drift-gates') {
      options.driftGates = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['smoke', 'release', 'nightly'].includes(options.profile)) {
    throw new Error(
      `Invalid --profile "${options.profile}". Use smoke, release, or nightly.`,
    );
  }

  options.outDir = path.resolve(repoRoot, options.outDir);
  return options;
}

function command(id, commandLine, options = {}) {
  return {
    id,
    command: commandLine,
    cwd: options.cwd || repoRoot,
    env: options.env || {},
    profile: options.profile || 'smoke',
  };
}

function artifactDir(outDir, name) {
  return path.join(outDir, 'artifacts', name);
}

function shellArg(value) {
  return JSON.stringify(String(value));
}

function autocannonRuntimeArgs(runtime) {
  return [
    runtime.workers && `--autocannon-workers ${runtime.workers}`,
    runtime.connections && `--autocannon-connections ${runtime.connections}`,
    runtime.durationSeconds &&
      `--autocannon-duration-seconds ${runtime.durationSeconds}`,
    runtime.timeoutSeconds &&
      `--autocannon-timeout-seconds ${runtime.timeoutSeconds}`,
    runtime.pipelining && `--autocannon-pipelining ${runtime.pipelining}`,
  ].filter(Boolean);
}

function superappLoadThresholdCommands(thresholdProfile, outDir) {
  const scenarioIds = getScenarioIdsForThresholdProfile(thresholdProfile);
  const autocannonProfile =
    getAutocannonThresholdProfileDefinition(thresholdProfile);
  const commonEnv = {
    SUPERAPP_K6_CERTIFICATION: '1',
    SUPERAPP_K6_THRESHOLD_PROFILE: thresholdProfile,
  };

  return [
    command(
      `superapp-k6-${thresholdProfile}-thresholds`,
      [
        'node scripts/superapp-k6/run-superapp-k6.js',
        `--profile ${thresholdProfile}`,
        `--threshold-profile ${thresholdProfile}`,
        `--scenario ${scenarioIds.join(',')}`,
        `--output-dir ${shellArg(
          artifactDir(outDir, `k6-${thresholdProfile}-thresholds`),
        )}`,
      ].join(' '),
      {
        env: commonEnv,
        profile: thresholdProfile,
      },
    ),
    command(
      `superapp-autocannon-${thresholdProfile}-thresholds`,
      [
        'node scripts/superapp-k6/run-superapp-k6.js',
        `--profile ${thresholdProfile}`,
        `--threshold-profile ${thresholdProfile}`,
        `--autocannon-probes ${autocannonProfile.probeIds.join(',')}`,
        ...autocannonRuntimeArgs(autocannonProfile.runtime),
        `--output-dir ${shellArg(
          artifactDir(outDir, `autocannon-${thresholdProfile}-thresholds`),
        )}`,
      ].join(' '),
      {
        env: commonEnv,
        profile: thresholdProfile,
      },
    ),
  ];
}

function certificationCommands(profile, outDir) {
  const rstest = 'pnpm exec rstest run -c rstest.config.mts';
  const smoke = [
    command('lint', 'pnpm run lint'),
    command('changeset', 'pnpm run check-changeset'),
    command('package-json', 'pnpm run lint:package-json'),
    command('dependencies', 'pnpm check-dependencies'),
    command(
      'superapp-erp-smoke',
      `${rstest} integration/superapp-erp/tests/index.test.ts`,
      { cwd: path.join(repoRoot, 'tests') },
    ),
    command(
      'superapp-portfolio-smoke',
      `${rstest} integration/superapp-portfolio/tests/index.test.ts`,
      { cwd: path.join(repoRoot, 'tests') },
    ),
    command(
      'superapp-portfolio-security',
      `${rstest} integration/superapp-portfolio/tests/security.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_PORTFOLIO_SECURITY: '1',
          SUPERAPP_PORTFOLIO_SECURITY_ARTIFACT_DIR: artifactDir(
            outDir,
            'portfolio-security',
          ),
        },
      },
    ),
    command(
      'superapp-mf-certification',
      `${rstest} integration/routes-tanstack-mf/test/deploy-certification.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_MF_CERTIFICATION: '1',
          SUPERAPP_MF_CERTIFICATION_ARTIFACT_DIR: artifactDir(
            outDir,
            'mf-certification',
          ),
        },
      },
    ),
  ];

  const release = [
    ...smoke,
    command(
      'superapp-browser-matrix-smoke',
      `${rstest} integration/superapp-browser-matrix/tests/playwrightMatrix.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_BROWSER_MATRIX_ARTIFACT_DIR: artifactDir(
            outDir,
            'browser-matrix-smoke',
          ),
        },
        profile: 'release',
      },
    ),
    command(
      'superapp-erp-stress',
      `${rstest} integration/superapp-erp/tests/stress.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_ERP_STRESS: '1',
          SUPERAPP_ERP_STRESS_ROUNDS: '4',
          SUPERAPP_ERP_STRESS_BATCH: '8',
          SUPERAPP_ERP_STRESS_ROUTE_CYCLES: '4',
          SUPERAPP_ERP_ARTIFACT_DIR: artifactDir(outDir, 'erp-stress'),
        },
        profile: 'release',
      },
    ),
    command(
      'superapp-portfolio-stress',
      `${rstest} integration/superapp-portfolio/tests/stress.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_PORTFOLIO_STRESS: '1',
          SUPERAPP_PORTFOLIO_STRESS_CYCLES: '6',
          SUPERAPP_PORTFOLIO_STRESS_ARTIFACT_DIR: artifactDir(
            outDir,
            'portfolio-stress',
          ),
        },
        profile: 'release',
      },
    ),
    command(
      'superapp-pilot-chaos',
      `${rstest} integration/superapp-portfolio/tests/pilot-chaos.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_PILOT_CHAOS: '1',
          SUPERAPP_PILOT_CHAOS_ARTIFACT_DIR: artifactDir(outDir, 'pilot-chaos'),
        },
        profile: 'release',
      },
    ),
    command(
      'superapp-portfolio-load',
      `${rstest} integration/superapp-portfolio/tests/load.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_PORTFOLIO_LOAD: '1',
          SUPERAPP_PORTFOLIO_LOAD_DURATION_MS: '12000',
          SUPERAPP_PORTFOLIO_LOAD_CONCURRENCY: '24',
          SUPERAPP_PORTFOLIO_LOAD_ARTIFACT_DIR: artifactDir(
            outDir,
            'portfolio-load',
          ),
        },
        profile: 'release',
      },
    ),
    ...superappLoadThresholdCommands('release', outDir),
    command(
      'superapp-torture-harness-contract',
      `node scripts/superapp-certification/validate-harness-contract.js --out-dir "${artifactDir(
        outDir,
        'torture-harness',
      )}"`,
      {
        profile: 'release',
      },
    ),
  ];

  const nightly = [
    ...release,
    command(
      'superapp-browser-matrix-full',
      `${rstest} integration/superapp-browser-matrix/tests/playwrightMatrix.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_BROWSER_MATRIX: '1',
          SUPERAPP_BROWSER_MATRIX_ARTIFACT_DIR: artifactDir(
            outDir,
            'browser-matrix-full',
          ),
        },
        profile: 'nightly',
      },
    ),
    command(
      'superapp-erp-soak',
      `${rstest} integration/superapp-erp/tests/soak.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_ERP_SOAK: '1',
          SUPERAPP_ERP_SOAK_MS: '300000',
          SUPERAPP_ERP_ARTIFACT_DIR: artifactDir(outDir, 'erp-soak'),
        },
        profile: 'nightly',
      },
    ),
    command(
      'superapp-portfolio-nightly',
      `${rstest} integration/superapp-portfolio/tests/nightly.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_PORTFOLIO_NIGHTLY: '1',
          SUPERAPP_PORTFOLIO_NIGHTLY_CYCLES: '30',
          SUPERAPP_PORTFOLIO_NIGHTLY_ARTIFACT_DIR: artifactDir(
            outDir,
            'portfolio-nightly',
          ),
        },
        profile: 'nightly',
      },
    ),
    command(
      'superapp-portfolio-load-boundary',
      `${rstest} integration/superapp-portfolio/tests/load.test.ts`,
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_PORTFOLIO_LOAD: '1',
          SUPERAPP_PORTFOLIO_LOAD_DURATION_MS: '30000',
          SUPERAPP_PORTFOLIO_LOAD_CONCURRENCY: '384',
          SUPERAPP_PORTFOLIO_LOAD_P95_MS: '5000',
          SUPERAPP_PORTFOLIO_LOAD_MAX_MS: '15000',
          SUPERAPP_PORTFOLIO_LOAD_ARTIFACT_DIR: artifactDir(
            outDir,
            'portfolio-load-boundary',
          ),
        },
        profile: 'nightly',
      },
    ),
    ...superappLoadThresholdCommands('nightly', outDir),
  ];

  if (profile === 'smoke') {
    return smoke;
  }
  if (profile === 'release') {
    return release;
  }
  return nightly;
}

function runShell(commandLine, options) {
  const startedAt = Date.now();
  const result = spawnSync(commandLine, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    shell: true,
    stdio: 'inherit',
  });

  return {
    exitCode: result.status ?? 1,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
  };
}

function runCommands(commands, options) {
  const results = [];
  for (const item of commands) {
    if (options.dryRun) {
      results.push({
        ...item,
        status: 'planned',
        exitCode: 0,
        durationMs: 0,
      });
      continue;
    }

    console.log(`\n[superapp-certification] ${item.id}`);
    const result = runShell(item.command, {
      cwd: item.cwd,
      env: item.env,
    });
    results.push({
      ...item,
      status: result.exitCode === 0 ? 'passed' : 'failed',
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
    });

    if (result.exitCode !== 0 && !options.continueOnError) {
      break;
    }
  }

  return results;
}

function runGit(args, options = {}) {
  return spawnSync('git', args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  });
}

function cleanupWorktree(worktreeDir) {
  if (fs.existsSync(worktreeDir)) {
    runGit(['merge', '--abort'], { cwd: worktreeDir });
  }
  runGit(['worktree', 'remove', '--force', worktreeDir]);
}

function runUpstreamDrift(options, commands) {
  const startedAt = Date.now();
  const worktreeDir = path.join(options.outDir, 'upstream-drift-worktree');
  const result = {
    status: 'skipped',
    base: options.driftBase,
    remote: options.driftRemote,
    branch: options.driftBranch,
    worktreeDir,
    conflicts: [],
    commandResults: [],
    durationMs: 0,
  };

  if (options.skipUpstreamDrift) {
    result.reason = 'skip-upstream-drift';
    return result;
  }

  if (options.dryRun) {
    result.status = 'planned';
    result.reason = 'dry-run';
    result.commandResults = options.driftGates
      ? commands.slice(0, 4).map(item => ({
          ...item,
          status: 'planned',
          exitCode: 0,
          durationMs: 0,
        }))
      : [];
    return result;
  }

  fs.mkdirSync(options.outDir, { recursive: true });
  cleanupWorktree(worktreeDir);

  const fetch = runGit(['fetch', options.driftRemote, options.driftBranch], {
    stdio: 'inherit',
  });
  if (fetch.status !== 0) {
    return {
      ...result,
      status: 'failed',
      reason: 'fetch-failed',
      durationMs: Date.now() - startedAt,
    };
  }

  const add = runGit(['worktree', 'add', '--detach', worktreeDir, 'HEAD'], {
    stdio: 'inherit',
  });
  if (add.status !== 0) {
    return {
      ...result,
      status: 'failed',
      reason: 'worktree-add-failed',
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const merge = runGit(
      ['merge', '--no-commit', '--no-ff', options.driftBase],
      {
        cwd: worktreeDir,
        stdio: 'inherit',
      },
    );
    if (merge.status !== 0) {
      const conflicts = runGit(['diff', '--name-only', '--diff-filter=U'], {
        cwd: worktreeDir,
      });
      return {
        ...result,
        status: 'conflict',
        conflicts: conflicts.stdout.trim().split('\n').filter(Boolean),
        durationMs: Date.now() - startedAt,
      };
    }

    result.status = 'merged';
    if (options.driftGates) {
      const driftGateCommands = commands.slice(0, 4).map(item => ({
        ...item,
        cwd: worktreeDir,
      }));
      result.commandResults = runCommands(driftGateCommands, {
        ...options,
        dryRun: false,
      });
      if (result.commandResults.some(item => item.exitCode !== 0)) {
        result.status = 'gate-failed';
      }
    }
    return {
      ...result,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    cleanupWorktree(worktreeDir);
  }
}

function writeSummary(options, commands, commandResults, upstreamDrift) {
  fs.mkdirSync(options.outDir, { recursive: true });
  const summary = {
    schemaVersion: 1,
    suite: 'superapp-certification',
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    dryRun: options.dryRun,
    driftOnly: options.driftOnly,
    commandCount: commands.length,
    failedCommandCount: commandResults.filter(item => item.exitCode !== 0)
      .length,
    commands: commandResults,
    upstreamDrift,
  };
  const summaryPath = path.join(options.outDir, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n[superapp-certification] summary: ${summaryPath}`);
  return summary;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const commands = certificationCommands(options.profile, options.outDir);
  const commandResults = options.driftOnly
    ? []
    : runCommands(commands, options);
  const upstreamDrift = runUpstreamDrift(options, commands);
  const summary = writeSummary(
    options,
    commands,
    commandResults,
    upstreamDrift,
  );
  const hasCommandFailure = summary.failedCommandCount > 0;
  const hasDriftFailure = ['failed', 'conflict', 'gate-failed'].includes(
    upstreamDrift.status,
  );

  if (hasCommandFailure || hasDriftFailure) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  certificationCommands,
  parseArgs,
  superappLoadThresholdCommands,
};
