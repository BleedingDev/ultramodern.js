#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { parseCliArgs } = require('../lib/cli-kit');
const { repoRoot, writeJsonFile } = require('../lib/fs-kit');
const { runCommand, runCommandList } = require('../lib/process-kit');

const defaultRunId = new Date().toISOString().replace(/[:.]/g, '-');

function parseArgs(argv) {
  const options = parseCliArgs(argv, {
    defaults: {
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
    },
    ignoreTerminator: true,
    options: {
      profile: { requiredValue: false },
      'out-dir': {
        key: 'outDir',
        requiredValue: false,
      },
      'dry-run': {
        key: 'dryRun',
        type: 'boolean',
      },
      'continue-on-error': {
        key: 'continueOnError',
        type: 'boolean',
      },
      'skip-upstream-drift': {
        key: 'skipUpstreamDrift',
        type: 'boolean',
      },
      'drift-only': {
        key: 'driftOnly',
        type: 'boolean',
      },
      'drift-base': {
        key: 'driftBase',
        requiredValue: false,
      },
      'drift-remote': {
        key: 'driftRemote',
        requiredValue: false,
      },
      'drift-branch': {
        key: 'driftBranch',
        requiredValue: false,
      },
    },
  });

  if (!['smoke', 'release', 'nightly'].includes(options.profile)) {
    throw new Error(
      `Invalid --profile "${options.profile}". Use smoke, release, or nightly.`,
    );
  }

  options.outDir = path.resolve(repoRoot, options.outDir);
  return options;
}

function command(id, commandName, args, options = {}) {
  return {
    id,
    command: commandName,
    args,
    label: options.label || [commandName, ...args].join(' '),
    cwd: options.cwd || repoRoot,
    env: options.env || {},
    profile: options.profile || 'smoke',
  };
}

function artifactDir(outDir, name) {
  return path.join(outDir, 'artifacts', name);
}

function certificationCommands(profile, outDir) {
  const rstestArgs = ['exec', 'rstest', 'run', '-c', 'rstest.config.mts'];
  const smoke = [
    command(
      'superapp-portfolio-smoke',
      'pnpm',
      [...rstestArgs, 'integration/superapp-portfolio/tests/index.test.ts'],
      { cwd: path.join(repoRoot, 'tests') },
    ),
    command(
      'superapp-portfolio-security',
      'pnpm',
      [...rstestArgs, 'integration/superapp-portfolio/tests/security.test.ts'],
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
      'pnpm',
      [
        ...rstestArgs,
        'integration/routes-tanstack-mf/test/deploy-certification.test.ts',
      ],
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
      'pnpm',
      [
        ...rstestArgs,
        'integration/superapp-browser-matrix/tests/playwrightMatrix.test.ts',
      ],
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
      'superapp-portfolio-stress',
      'pnpm',
      [...rstestArgs, 'integration/superapp-portfolio/tests/stress.test.ts'],
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
      'pnpm',
      [
        ...rstestArgs,
        'integration/superapp-portfolio/tests/pilot-chaos.test.ts',
      ],
      {
        cwd: path.join(repoRoot, 'tests'),
        env: {
          SUPERAPP_PILOT_CHAOS: '1',
          SUPERAPP_PILOT_CHAOS_ARTIFACT_DIR: artifactDir(outDir, 'pilot-chaos'),
        },
        profile: 'release',
      },
    ),
  ];

  const nightly = [
    ...release,
    command(
      'superapp-browser-matrix-full',
      'pnpm',
      [
        ...rstestArgs,
        'integration/superapp-browser-matrix/tests/playwrightMatrix.test.ts',
      ],
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
      'superapp-portfolio-nightly',
      'pnpm',
      [...rstestArgs, 'integration/superapp-portfolio/tests/nightly.test.ts'],
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
  ];

  if (profile === 'smoke') {
    return smoke;
  }
  if (profile === 'release') {
    return release;
  }
  return nightly;
}

function runCommands(commands, options) {
  return runCommandList(commands, {
    continueOnError: options.continueOnError,
    dryRun: options.dryRun,
    onCommandStart: item => {
      console.log(`\n[superapp-certification] ${item.id}`);
    },
  });
}

function runGit(args, options = {}) {
  const result = runCommand('git', args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  });
  return {
    ...result,
    status: result.processStatus,
  };
}

function cleanupWorktree(worktreeDir) {
  if (fs.existsSync(worktreeDir)) {
    runGit(['merge', '--abort'], { cwd: worktreeDir });
  }
  runGit(['worktree', 'remove', '--force', worktreeDir]);
}

function runUpstreamDrift(options) {
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
  writeJsonFile(summaryPath, summary, { atomic: false });
  console.log(`\n[superapp-certification] summary: ${summaryPath}`);
  return summary;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const commands = certificationCommands(options.profile, options.outDir);
  const commandResults = options.driftOnly
    ? []
    : runCommands(commands, options);
  const upstreamDrift = runUpstreamDrift(options);
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
};
