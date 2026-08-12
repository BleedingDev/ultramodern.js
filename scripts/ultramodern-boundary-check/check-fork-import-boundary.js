#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { parseArgs } = require('node:util');

const {
  DEFAULT_ALLOWLIST_PATH,
  DEFAULT_BASE_REF,
  checkForkImportBoundary,
  formatBoundaryReport,
  writeAllowlist,
} = require('./checker');

const {
  DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
  DEFAULT_DIVERGENCE_BASE_REF,
  DEFAULT_PATHSPEC,
  checkAllowlistGovernance,
  checkForkDivergence,
  formatDivergenceGrowth,
  formatDivergenceReport,
  readDivergenceAllowlist,
  runSelfTest,
  writeDivergenceAllowlist,
} = require('./divergence');

const MODES = Object.freeze([
  'all',
  'imports',
  'divergence',
  'allowlist-governance',
]);
const DIVERGENCE_ALLOWLIST_REPO_PATH =
  'scripts/ultramodern-boundary-check/divergence-allowlist.json';
const DIVERGENCE_LEDGER_REPO_PATH = 'FORK-DIVERGENCE.md';

const parseCliArgs = argv =>
  parseArgs({
    args: argv,
    strict: true,
    options: {
      // Shared / legacy import-boundary options.
      'base-ref': {
        type: 'string',
        default: DEFAULT_BASE_REF,
      },
      allowlist: {
        type: 'string',
        default: DEFAULT_ALLOWLIST_PATH,
      },
      root: {
        type: 'string',
        default: process.cwd(),
      },
      'write-allowlist': {
        type: 'boolean',
        default: false,
      },
      json: {
        type: 'boolean',
        default: false,
      },
      // Divergence-mode options.
      mode: {
        type: 'string',
        default: 'all',
      },
      base: {
        type: 'string',
        default: DEFAULT_DIVERGENCE_BASE_REF,
      },
      head: {
        type: 'string',
      },
      'merge-base': {
        type: 'string',
      },
      pathspec: {
        type: 'string',
        multiple: true,
      },
      'divergence-allowlist': {
        type: 'string',
        default: DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
      },
      'write-divergence-allowlist': {
        type: 'boolean',
        default: false,
      },
      // Explicit opt-in for sanctioned budget growth. Without this flag,
      // writing is monotonic and refuses grown metrics or new file entries.
      'record-growth': {
        type: 'boolean',
        default: false,
      },
      // Opt-in re-anchor: only pass when the recorded upstream base itself
      // moves, never to bless new divergence at the existing base.
      'rebase-divergence-allowlist': {
        type: 'boolean',
        default: false,
      },
      'self-test': {
        type: 'boolean',
        default: false,
      },
    },
  }).values;

const runGit = ({ rootDir, args, allowFailure = false }) => {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.error) {
    throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (allowFailure) {
      return null;
    }
    const stderr = (result.stderr || '').trim();
    throw new Error(
      `git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`,
    );
  }

  return result.stdout || '';
};

const readAllowlistAtRef = ({ rootDir, ref }) => {
  const contents = runGit({
    rootDir,
    args: ['show', `${ref}:${DIVERGENCE_ALLOWLIST_REPO_PATH}`],
    allowFailure: true,
  });

  return contents === null ? null : JSON.parse(contents);
};

const checkLedgerChanged = ({ rootDir, mergeBase, headRef }) =>
  runGit({
    rootDir,
    args: [
      'diff',
      '--name-only',
      mergeBase,
      headRef,
      '--',
      DIVERGENCE_LEDGER_REPO_PATH,
    ],
  }).trim().length > 0;

const printSelfTest = () => {
  const { ok, results } = runSelfTest();

  results.forEach(result => {
    console.log(
      `[ultramodern-boundary:self-test] ${result.pass ? 'ok' : 'FAIL'} - ${
        result.name
      }${result.pass ? '' : ` :: ${result.detail}`}`,
    );
  });

  const passed = results.filter(result => result.pass).length;
  console.log(
    `[ultramodern-boundary:self-test] ${String(passed)}/${String(
      results.length,
    )} checks passed`,
  );

  return ok;
};

const main = () => {
  const args = parseCliArgs(process.argv.slice(2));
  const rootDir = path.resolve(args.root);
  const allowlistPath = path.resolve(args.allowlist);
  const divergenceAllowlistPath = path.resolve(args['divergence-allowlist']);
  const pathspec =
    args.pathspec && args.pathspec.length > 0
      ? args.pathspec
      : [...DEFAULT_PATHSPEC];

  if (!MODES.includes(args.mode)) {
    throw new Error(
      `Unknown --mode ${args.mode}; expected one of ${MODES.join(', ')}`,
    );
  }

  if (args['self-test']) {
    if (!printSelfTest()) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.mode === 'allowlist-governance') {
    if (!args['merge-base']) {
      throw new Error(
        '--mode allowlist-governance requires --merge-base <sha>',
      );
    }
    if (!args.head) {
      throw new Error('--mode allowlist-governance requires --head <sha>');
    }

    const baseAllowlist = readAllowlistAtRef({
      rootDir,
      ref: args['merge-base'],
    });
    const headAllowlist = readDivergenceAllowlist(divergenceAllowlistPath);
    const governance = checkAllowlistGovernance({
      baseAllowlist,
      headAllowlist,
    });
    const ledgerChanged = checkLedgerChanged({
      rootDir,
      mergeBase: args['merge-base'],
      headRef: args.head,
    });
    const requiresLedger =
      governance.growth.length > 0 || governance.reAnchored;

    if (requiresLedger) {
      console.log(
        `[ultramodern-divergence-governance] ${
          ledgerChanged ? 'sanctioned' : 'unsanctioned'
        } allowlist growth${governance.reAnchored ? ' / base re-anchor' : ''}:`,
      );
      governance.growth.forEach(entry => {
        console.log(
          `[ultramodern-divergence-governance] ${formatDivergenceGrowth(entry)}`,
        );
      });
    } else {
      console.log(
        '[ultramodern-divergence-governance] allowlist is shrink-only relative to the PR merge-base.',
      );
    }

    if (requiresLedger && !ledgerChanged) {
      console.error(
        `[ultramodern-divergence-governance] ${DIVERGENCE_LEDGER_REPO_PATH} must change in the same PR as allowlist growth or a base re-anchor.`,
      );
      process.exitCode = 1;
    }
    return;
  }

  const runImports = args.mode === 'all' || args.mode === 'imports';
  const runDivergence = args.mode === 'all' || args.mode === 'divergence';

  if (args['write-allowlist']) {
    const report = writeAllowlist({
      rootDir,
      baseRef: args['base-ref'],
      allowlistPath,
    });

    console.log(
      `[ultramodern-boundary] wrote ${allowlistPath} with ${String(
        report.violations.length,
      )} current violations from ${String(report.scannedFiles)} files`,
    );

    if (!args['write-divergence-allowlist']) {
      return;
    }
  }

  if (args['write-divergence-allowlist']) {
    const report = writeDivergenceAllowlist({
      rootDir,
      baseRef: args.base,
      headRef: args.head,
      pathspec,
      allowlistPath: divergenceAllowlistPath,
      rebaseAllowlist: args['rebase-divergence-allowlist'],
      recordGrowth: args['record-growth'],
    });

    if (report.growth.length > 0) {
      console.warn(
        `[ultramodern-divergence] WARNING: --record-growth is raising ${String(
          report.growth.length,
        )} divergence budget(s):`,
      );
      report.growth.forEach(entry => {
        console.warn(
          `[ultramodern-divergence] GROWTH ${formatDivergenceGrowth(entry)}`,
        );
      });
    }

    console.log(
      `[ultramodern-divergence] wrote ${divergenceAllowlistPath} with ${String(
        report.totalFiles,
      )} upstream-owned files / ${String(
        report.totalHunks,
      )} hunks / ${String(report.totalChangedLines)} changed lines`,
    );
    return;
  }

  const importReport = runImports
    ? checkForkImportBoundary({
        rootDir,
        baseRef: args['base-ref'],
        allowlistPath,
      })
    : null;

  const divergenceReport = runDivergence
    ? checkForkDivergence({
        rootDir,
        baseRef: args.base,
        headRef: args.head,
        pathspec,
        allowlistPath: divergenceAllowlistPath,
      })
    : null;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          mode: args.mode,
          imports: importReport,
          divergence: divergenceReport,
        },
        null,
        2,
      ),
    );
  } else {
    const sections = [];
    if (importReport) {
      sections.push(formatBoundaryReport(importReport));
    }
    if (divergenceReport) {
      sections.push(formatDivergenceReport(divergenceReport));
    }
    console.log(sections.join('\n\n'));
  }

  const ok =
    (importReport ? importReport.ok : true) &&
    (divergenceReport ? divergenceReport.ok : true);

  if (!ok) {
    process.exitCode = 1;
  }
};

try {
  main();
} catch (error) {
  console.error(`[ultramodern-boundary] ${error.message}`);
  process.exit(1);
}
