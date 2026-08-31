#!/usr/bin/env node

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
  CAPPED_PATCH_LINES,
  DEFAULT_DIVERGENCE_BASE_REF,
  DEFAULT_UPSTREAM_PROVENANCE_REF,
  checkForkDivergence,
  evaluateDivergenceGovernance,
  formatDivergenceGrowth,
  formatDivergenceReport,
  getCanonicalDivergenceAllowlistPath,
  readDivergenceAllowlistAtRef,
  resolveCommitSha,
  resolveRepositoryTopLevel,
  runSelfTest,
  writeDivergenceAllowlist,
} = require('./divergence');

const MODES = Object.freeze([
  'all',
  'imports',
  'divergence',
  'allowlist-governance',
]);

const parseCliArgs = argv =>
  parseArgs({
    args: argv,
    strict: true,
    options: {
      'base-ref': { type: 'string', default: DEFAULT_BASE_REF },
      allowlist: { type: 'string', default: DEFAULT_ALLOWLIST_PATH },
      root: { type: 'string' },
      'write-allowlist': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      mode: { type: 'string', default: 'all' },
      base: { type: 'string' },
      head: { type: 'string' },
      'merge-base': { type: 'string' },
      pathspec: { type: 'string', multiple: true },
      'divergence-allowlist': { type: 'string' },
      'write-divergence-allowlist': { type: 'boolean', default: false },
      'record-growth': { type: 'boolean', default: false },
      'rebase-divergence-allowlist': { type: 'boolean', default: false },
      'self-test': { type: 'boolean', default: false },
    },
  }).values;

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

const assertNoVerificationOverrides = args => {
  const rejected = [
    ['root', '--root'],
    ['base', '--base'],
    ['pathspec', '--pathspec'],
    ['divergence-allowlist', '--divergence-allowlist'],
  ];
  for (const [key, flag] of rejected) {
    if (args[key] !== undefined) {
      throw new Error(
        `${flag} is not accepted in verification modes. Run from the repository top level and use the checked-in divergence allowlist's recorded scope.`,
      );
    }
  }
};

const printGovernance = governance => {
  const { allowlist, ledgerChanged, rule5Changes } = governance;
  if (allowlist.growth.length > 0) {
    console.log(
      `[ultramodern-divergence-governance] ${
        ledgerChanged ? 'ledger-backed' : 'unledgered'
      } allowlist growth:`,
    );
    allowlist.growth.forEach(entry => {
      console.log(
        `[ultramodern-divergence-governance] ${formatDivergenceGrowth(entry)}`,
      );
    });
  } else if (allowlist.transition) {
    console.log(
      '[ultramodern-divergence-governance] reviewed initial/base/scope allowlist transition.',
    );
  } else {
    console.log(
      '[ultramodern-divergence-governance] allowlist is shrink-only relative to the PR merge-base.',
    );
  }

  for (const change of rule5Changes) {
    const disposition = change.genuineShrink
      ? 'genuine shrink'
      : `${String(change.changedLines)} PR lines${
          change.renamed ? ', rename-governed' : ''
        }`;
    console.log(
      `[ultramodern-divergence-governance] Rule 5 ${change.file}: ${disposition}`,
    );
  }

  if (!governance.ok) {
    governance.errors.forEach(error => {
      console.error(`[ultramodern-divergence-governance] ${error}`);
    });
    process.exitCode = 1;
  }
};

const main = () => {
  const args = parseCliArgs(process.argv.slice(2));
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

  const writingDivergence = args['write-divergence-allowlist'];
  if (
    args.mode === 'allowlist-governance' &&
    (writingDivergence ||
      args['write-allowlist'] ||
      args['record-growth'] ||
      args['rebase-divergence-allowlist'])
  ) {
    throw new Error(
      '--mode allowlist-governance is verification-only and rejects every writer option.',
    );
  }
  const verificationMode =
    !writingDivergence &&
    (args.mode === 'all' ||
      args.mode === 'divergence' ||
      args.mode === 'allowlist-governance');
  if (verificationMode) {
    assertNoVerificationOverrides(args);
  }

  const requestedRoot = path.resolve(args.root ?? process.cwd());
  const rootDir = resolveRepositoryTopLevel({ rootDir: requestedRoot });
  const canonicalDivergenceAllowlistPath =
    getCanonicalDivergenceAllowlistPath(rootDir);
  const canonicalRefsAvailable = Boolean(
    resolveCommitSha({ rootDir, ref: DEFAULT_DIVERGENCE_BASE_REF }),
  );
  const expectedBaseRef = canonicalRefsAvailable
    ? DEFAULT_DIVERGENCE_BASE_REF
    : undefined;
  const expectedUpstreamRef = canonicalRefsAvailable
    ? DEFAULT_UPSTREAM_PROVENANCE_REF
    : undefined;

  if (args.mode === 'allowlist-governance') {
    if (!args['merge-base']) {
      throw new Error(
        '--mode allowlist-governance requires --merge-base <commit>',
      );
    }
    if (!args.head) {
      throw new Error('--mode allowlist-governance requires --head <commit>');
    }
    const baseAllowlist = readDivergenceAllowlistAtRef({
      rootDir,
      ref: args['merge-base'],
      allowMissing: true,
      allowLegacyProvenance: true,
    });
    const headAllowlist = readDivergenceAllowlistAtRef({
      rootDir,
      ref: args.head,
      allowMissing: false,
    });
    const governance = evaluateDivergenceGovernance({
      rootDir,
      mergeBaseRef: args['merge-base'],
      headRef: args.head,
      baseAllowlist,
      headAllowlist,
      expectedBaseRef,
      expectedUpstreamRef,
    });
    printGovernance(governance);
    return;
  }

  if (args['record-growth'] && !writingDivergence) {
    throw new Error('--record-growth requires --write-divergence-allowlist.');
  }
  if (args['rebase-divergence-allowlist'] && !writingDivergence) {
    throw new Error(
      '--rebase-divergence-allowlist requires --write-divergence-allowlist.',
    );
  }

  const allowlistPath = path.resolve(args.allowlist);
  const divergenceAllowlistPath = args['divergence-allowlist']
    ? path.resolve(args['divergence-allowlist'])
    : canonicalDivergenceAllowlistPath;

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
    if (!writingDivergence) {
      return;
    }
  }

  if (writingDivergence) {
    const report = writeDivergenceAllowlist({
      rootDir,
      baseRef: args.base,
      headRef: args.head,
      mergeBaseRef: args['merge-base'],
      pathspec: args.pathspec,
      allowlistPath: divergenceAllowlistPath,
      rebaseAllowlist: args['rebase-divergence-allowlist'],
      recordGrowth: args['record-growth'],
      expectedBaseRef,
      expectedUpstreamRef,
    });
    if (report.growth.length > 0) {
      console.warn(
        `[ultramodern-divergence] reviewed capped growth is raising ${String(
          report.growth.length,
        )} budget(s), each independently checked against the exact ${String(
          CAPPED_PATCH_LINES,
        )}-line Rule 5 cap:`,
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
      )} upstream-owned files / ${String(report.totalHunks)} hunks / ${String(
        report.totalChangedLines,
      )} changed lines`,
    );
    return;
  }

  const runImports = args.mode === 'all' || args.mode === 'imports';
  const runDivergence = args.mode === 'all' || args.mode === 'divergence';
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
        baseRef: expectedBaseRef,
        upstreamRef: expectedUpstreamRef,
        headRef: args.head,
        allowlistPath: canonicalDivergenceAllowlistPath,
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

  if (
    !(importReport ? importReport.ok : true) ||
    !(divergenceReport ? divergenceReport.ok : true)
  ) {
    process.exitCode = 1;
  }
};

try {
  main();
} catch (error) {
  console.error(`[ultramodern-boundary] ${error.message}`);
  process.exit(1);
}
