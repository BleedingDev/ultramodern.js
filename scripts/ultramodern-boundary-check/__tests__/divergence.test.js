const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
  DEFAULT_DIVERGENCE_BASE_REF,
  checkAllowlistGovernance,
  checkForkDivergence,
  compareDivergence,
  formatDivergenceReport,
  parseDivergenceDiff,
  runSelfTest,
  writeDivergenceAllowlist,
} = require('../divergence');

const repoRoot = path.resolve(__dirname, '../../..');
const boundaryCliPath = path.join(
  repoRoot,
  'scripts/ultramodern-boundary-check/check-fork-import-boundary.js',
);

const runGit = (rootDir, args) =>
  execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();

/**
 * Fixture with one upstream-owned source file plus one fork-added file, so the
 * "existed at the base ref" rule can be exercised without touching the repo.
 */
const makeAllowlist = ({ baseRef = 'dfcd414a', files = [] } = {}) => ({
  schemaVersion: 1,
  baseRef,
  pathspec: ['packages'],
  totalFiles: files.length,
  totalHunks: files.reduce((sum, entry) => sum + entry.hunks, 0),
  totalChangedLines: files.reduce((sum, entry) => sum + entry.changedLines, 0),
  files,
});

const writeFixtureAllowlist = (rootDir, allowlist) => {
  const allowlistPath = path.join(
    rootDir,
    'scripts/ultramodern-boundary-check/divergence-allowlist.json',
  );
  fs.mkdirSync(path.dirname(allowlistPath), { recursive: true });
  fs.writeFileSync(allowlistPath, `${JSON.stringify(allowlist, null, 2)}\n`);
  return allowlistPath;
};

const makeGovernanceFixture = ({ baseAllowlist } = {}) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-fork-governance-'),
  );
  runGit(rootDir, ['init']);
  runGit(rootDir, ['config', 'user.email', 'fixture@example.test']);
  runGit(rootDir, ['config', 'user.name', 'Fixture']);
  fs.writeFileSync(path.join(rootDir, 'FORK-DIVERGENCE.md'), '# Ledger\n');
  if (baseAllowlist !== null) {
    writeFixtureAllowlist(rootDir, baseAllowlist ?? makeAllowlist());
  }
  runGit(rootDir, ['add', '.']);
  runGit(rootDir, ['commit', '-m', 'merge base']);

  return {
    mergeBase: runGit(rootDir, ['rev-parse', 'HEAD']),
    rootDir,
  };
};

const runGovernanceCli = ({ rootDir, mergeBase, headRef, allowlistPath }) =>
  spawnSync(
    process.execPath,
    [
      boundaryCliPath,
      '--root',
      rootDir,
      '--mode',
      'allowlist-governance',
      '--merge-base',
      mergeBase,
      '--head',
      headRef,
      '--divergence-allowlist',
      allowlistPath,
    ],
    { cwd: rootDir, encoding: 'utf8' },
  );

const makeGitFixture = () => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-fork-divergence-'),
  );
  runGit(rootDir, ['init']);
  runGit(rootDir, ['config', 'user.email', 'fixture@example.test']);
  runGit(rootDir, ['config', 'user.name', 'Fixture']);

  const sourceDir = path.join(rootDir, 'packages/runtime/src');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, 'index.ts'),
    [
      'export const a = 1;',
      'export const b = 2;',
      'export const c = 3;',
      '',
    ].join('\n'),
  );

  runGit(rootDir, ['add', '.']);
  runGit(rootDir, ['commit', '-m', 'upstream base']);

  return {
    baseRef: runGit(rootDir, ['rev-parse', 'HEAD']),
    rootDir,
    sourceDir,
  };
};

test('self test covers the hunk parser and the shrink-only budget rules', () => {
  const { ok, results } = runSelfTest();
  const failed = results.filter(result => !result.pass);

  assert.equal(
    ok,
    true,
    failed.map(result => `${result.name}: ${result.detail}`).join('\n'),
  );
  assert.ok(results.length >= 8);
});

test('parser ignores diff headers and counts non-source package paths', () => {
  const parsed = parseDivergenceDiff(
    [
      'diff --git a/packages/runtime/src/index.ts b/packages/runtime/src/index.ts',
      'index aaaaaaa..bbbbbbb 100644',
      '--- a/packages/runtime/src/index.ts',
      '+++ b/packages/runtime/src/index.ts',
      '@@ -1 +1 @@',
      '-export const a = 1;',
      '+export const a = 2;',
      'diff --git a/packages/runtime/README.md b/packages/runtime/README.md',
      'index ccccccc..ddddddd 100644',
      '--- a/packages/runtime/README.md',
      '+++ b/packages/runtime/README.md',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n'),
  );

  assert.deepEqual(parsed, [
    {
      file: 'packages/runtime/README.md',
      hunks: 1,
      changedLines: 2,
      addedLines: 1,
      removedLines: 1,
    },
    {
      file: 'packages/runtime/src/index.ts',
      hunks: 1,
      changedLines: 2,
      addedLines: 1,
      removedLines: 1,
    },
  ]);
});

test('allowlist growth without a ledger co-change fails governance', () => {
  const baseAllowlist = makeAllowlist({
    files: [
      { file: 'packages/runtime/package.json', hunks: 1, changedLines: 2 },
    ],
  });
  const { rootDir, mergeBase } = makeGovernanceFixture({ baseAllowlist });

  try {
    const allowlistPath = writeFixtureAllowlist(
      rootDir,
      makeAllowlist({
        files: [
          {
            file: 'packages/runtime/package.json',
            hunks: 9,
            changedLines: 999,
          },
        ],
      }),
    );
    runGit(rootDir, ['add', '.']);
    runGit(rootDir, ['commit', '-m', 'raise budget']);
    const headRef = runGit(rootDir, ['rev-parse', 'HEAD']);
    const result = runGovernanceCli({
      rootDir,
      mergeBase,
      headRef,
      allowlistPath,
    });

    const governance = checkAllowlistGovernance({
      baseAllowlist,
      headAllowlist: JSON.parse(fs.readFileSync(allowlistPath, 'utf8')),
    });
    assert.equal(governance.growth.length, 1);
    assert.equal(governance.growth[0].file, 'packages/runtime/package.json');
    assert.notEqual(result.status, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('allowlist growth with a ledger co-change passes governance', () => {
  const baseAllowlist = makeAllowlist({
    files: [
      { file: 'packages/runtime/package.json', hunks: 1, changedLines: 2 },
    ],
  });
  const { rootDir, mergeBase } = makeGovernanceFixture({ baseAllowlist });

  try {
    const allowlistPath = writeFixtureAllowlist(
      rootDir,
      makeAllowlist({
        files: [
          { file: 'packages/runtime/package.json', hunks: 2, changedLines: 4 },
        ],
      }),
    );
    fs.appendFileSync(path.join(rootDir, 'FORK-DIVERGENCE.md'), 'growth row\n');
    runGit(rootDir, ['add', '.']);
    runGit(rootDir, ['commit', '-m', 'sanction growth']);
    const headRef = runGit(rootDir, ['rev-parse', 'HEAD']);
    const result = runGovernanceCli({
      rootDir,
      mergeBase,
      headRef,
      allowlistPath,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('pure allowlist shrink passes governance without a ledger change', () => {
  const baseAllowlist = makeAllowlist({
    files: [
      { file: 'packages/runtime/package.json', hunks: 3, changedLines: 8 },
    ],
  });
  const headAllowlist = makeAllowlist({
    files: [
      { file: 'packages/runtime/package.json', hunks: 2, changedLines: 6 },
    ],
  });

  assert.deepEqual(checkAllowlistGovernance({ baseAllowlist, headAllowlist }), {
    growth: [],
    reAnchored: false,
    ok: true,
  });

  const { rootDir, mergeBase } = makeGovernanceFixture({ baseAllowlist });
  try {
    const allowlistPath = writeFixtureAllowlist(rootDir, headAllowlist);
    runGit(rootDir, ['add', '.']);
    runGit(rootDir, ['commit', '-m', 'shrink budget']);
    const headRef = runGit(rootDir, ['rev-parse', 'HEAD']);
    const result = runGovernanceCli({
      rootDir,
      mergeBase,
      headRef,
      allowlistPath,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('allowlist absent at merge-base passes when the ledger changes', () => {
  const { rootDir, mergeBase } = makeGovernanceFixture({ baseAllowlist: null });

  try {
    const allowlistPath = writeFixtureAllowlist(
      rootDir,
      makeAllowlist({
        files: [
          { file: 'packages/runtime/package.json', hunks: 1, changedLines: 2 },
        ],
      }),
    );
    fs.appendFileSync(
      path.join(rootDir, 'FORK-DIVERGENCE.md'),
      'initial row\n',
    );
    runGit(rootDir, ['add', '.']);
    runGit(rootDir, ['commit', '-m', 'introduce governed allowlist']);
    const headRef = runGit(rootDir, ['rev-parse', 'HEAD']);
    const result = runGovernanceCli({
      rootDir,
      mergeBase,
      headRef,
      allowlistPath,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('repo divergence allowlist keeps the current tree green', () => {
  const report = checkForkDivergence({
    rootDir: repoRoot,
    baseRef: DEFAULT_DIVERGENCE_BASE_REF,
    allowlistPath: DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
  });

  assert.equal(report.violations.length, 0, formatDivergenceReport(report));
  assert.equal(report.ok, true);
});

test('a grown hunk in an upstream-owned file fails the gate', () => {
  const { rootDir, baseRef, sourceDir } = makeGitFixture();

  try {
    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        '',
      ].join('\n'),
    );

    const allowlistPath = path.join(rootDir, 'divergence-allowlist.json');
    const seeded = writeDivergenceAllowlist({
      rootDir,
      baseRef,
      allowlistPath,
      recordGrowth: true,
    });

    assert.equal(seeded.totalFiles, 1);
    assert.equal(seeded.files[0].changedLines, 2);

    assert.equal(
      checkForkDivergence({ rootDir, baseRef, allowlistPath }).ok,
      true,
    );

    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 9;',
        'export const c = 9;',
        'export const forkOnly = true;',
        '',
      ].join('\n'),
    );

    const grown = checkForkDivergence({ rootDir, baseRef, allowlistPath });

    assert.equal(grown.ok, false);
    assert.equal(grown.violations.length, 1);
    assert.equal(grown.violations[0].file, 'packages/runtime/src/index.ts');
    assert.equal(grown.violations[0].reason, 'line-budget-exceeded');
    assert.equal(grown.violations[0].budgetChangedLines, 2);
    assert.ok(grown.violations[0].measuredChangedLines > 2);
    assert.match(formatDivergenceReport(grown), /capped patch of <= ~20/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('default allowlist write refuses growth without modifying the file', () => {
  const { rootDir, baseRef, sourceDir } = makeGitFixture();

  try {
    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        '',
      ].join('\n'),
    );

    const allowlistPath = path.join(rootDir, 'divergence-allowlist.json');
    writeDivergenceAllowlist({
      rootDir,
      baseRef,
      allowlistPath,
      recordGrowth: true,
    });
    const before = fs.readFileSync(allowlistPath);

    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 9;',
        'export const c = 9;',
        'export const forkOnly = true;',
        '',
      ].join('\n'),
    );

    const result = spawnSync(
      process.execPath,
      [
        boundaryCliPath,
        '--root',
        rootDir,
        '--base',
        baseRef,
        '--divergence-allowlist',
        allowlistPath,
        '--write-divergence-allowlist',
      ],
      { cwd: rootDir, encoding: 'utf8' },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires the explicit --record-growth/);
    assert.match(result.stderr, /packages\/runtime\/src\/index\.ts/);
    assert.deepEqual(fs.readFileSync(allowlistPath), before);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('--record-growth writes and announces every grown entry', () => {
  const { rootDir, baseRef, sourceDir } = makeGitFixture();

  try {
    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        '',
      ].join('\n'),
    );

    const allowlistPath = path.join(rootDir, 'divergence-allowlist.json');
    const seeded = writeDivergenceAllowlist({
      rootDir,
      baseRef,
      allowlistPath,
      recordGrowth: true,
    });

    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 9;',
        'export const c = 9;',
        'export const forkOnly = true;',
        '',
      ].join('\n'),
    );

    const result = spawnSync(
      process.execPath,
      [
        boundaryCliPath,
        '--root',
        rootDir,
        '--base',
        baseRef,
        '--divergence-allowlist',
        allowlistPath,
        '--write-divergence-allowlist',
        '--record-growth',
      ],
      { cwd: rootDir, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /WARNING: --record-growth is raising 1/);
    assert.match(
      result.stderr,
      /GROWTH - packages\/runtime\/src\/index\.ts: budget/,
    );

    const updated = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    assert.ok(updated.files[0].hunks >= seeded.files[0].hunks);
    assert.ok(updated.files[0].changedLines > seeded.files[0].changedLines);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('new hunks with a net changed-line shrink violate the hunk budget', () => {
  const comparison = compareDivergence({
    measuredFiles: [
      { file: 'packages/runtime/src/index.ts', hunks: 8, changedLines: 38 },
    ],
    allowlistFiles: [
      { file: 'packages/runtime/src/index.ts', hunks: 3, changedLines: 39 },
    ],
  });

  assert.equal(comparison.ok, false);
  assert.equal(comparison.violations.length, 1);
  assert.equal(comparison.violations[0].reason, 'hunk-budget-exceeded');
  assert.equal(comparison.shrunk.length, 0);
});

test('an upstream-owned file with no recorded budget fails the gate', () => {
  const { rootDir, baseRef, sourceDir } = makeGitFixture();

  try {
    const allowlistPath = path.join(rootDir, 'divergence-allowlist.json');
    writeDivergenceAllowlist({ rootDir, baseRef, allowlistPath });

    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 1;',
        'export const b = 2;',
        'export const forked = 4;',
        '',
      ].join('\n'),
    );

    const report = checkForkDivergence({ rootDir, baseRef, allowlistPath });

    assert.equal(report.ok, false);
    assert.equal(report.violations[0].reason, 'unallowlisted-divergence');
    assert.equal(report.violations[0].budgetChangedLines, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('fork-added files are not upstream-owned and never enter the budget', () => {
  const { rootDir, baseRef, sourceDir } = makeGitFixture();

  try {
    const allowlistPath = path.join(rootDir, 'divergence-allowlist.json');
    writeDivergenceAllowlist({ rootDir, baseRef, allowlistPath });

    fs.writeFileSync(
      path.join(sourceDir, 'fork-only.ts'),
      'export const forkOnly = true;\n',
    );
    runGit(rootDir, ['add', '.']);

    const report = checkForkDivergence({ rootDir, baseRef, allowlistPath });

    assert.equal(report.ok, true);
    assert.equal(report.measuredFiles, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('shrinking divergence passes and reports a re-shrink hint', () => {
  const { rootDir, baseRef, sourceDir } = makeGitFixture();

  try {
    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 9;',
        'export const c = 9;',
        '',
      ].join('\n'),
    );

    const allowlistPath = path.join(rootDir, 'divergence-allowlist.json');
    writeDivergenceAllowlist({
      rootDir,
      baseRef,
      allowlistPath,
      recordGrowth: true,
    });

    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        '',
      ].join('\n'),
    );

    const report = checkForkDivergence({ rootDir, baseRef, allowlistPath });

    assert.equal(report.ok, true);
    assert.equal(report.shrunk.length, 1);
    assert.match(formatDivergenceReport(report), /Divergence shrank in 1 file/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('shrink re-record hint is absent while any violation exists', () => {
  const comparison = compareDivergence({
    measuredFiles: [
      { file: 'packages/runtime/src/grown.ts', hunks: 8, changedLines: 38 },
      { file: 'packages/runtime/src/shrunk.ts', hunks: 1, changedLines: 2 },
    ],
    allowlistFiles: [
      { file: 'packages/runtime/src/grown.ts', hunks: 3, changedLines: 39 },
      { file: 'packages/runtime/src/shrunk.ts', hunks: 2, changedLines: 4 },
    ],
  });
  const output = formatDivergenceReport({
    baseRef: 'base',
    headRef: null,
    measuredFiles: 2,
    measuredHunks: 9,
    measuredChangedLines: 40,
    allowlistFiles: 2,
    allowlistChangedLines: 43,
    violations: comparison.violations,
    shrunk: comparison.shrunk,
    cleared: comparison.cleared,
  });

  assert.equal(comparison.violations.length, 1);
  assert.equal(comparison.shrunk.length, 1);
  assert.doesNotMatch(output, /re-run with --write-divergence-allowlist/);
});

test('checking against a base other than the recorded one throws', () => {
  const { rootDir, baseRef, sourceDir } = makeGitFixture();

  try {
    const allowlistPath = path.join(rootDir, 'divergence-allowlist.json');
    writeDivergenceAllowlist({ rootDir, baseRef, allowlistPath });

    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      ['export const a = 9;', 'export const b = 2;', ''].join('\n'),
    );
    runGit(rootDir, ['add', '.']);
    runGit(rootDir, ['commit', '-m', 'fork edit']);
    const laterRef = runGit(rootDir, ['rev-parse', 'HEAD']);

    assert.notEqual(laterRef, baseRef);
    assert.throws(
      () => checkForkDivergence({ rootDir, baseRef: laterRef, allowlistPath }),
      /Divergence base mismatch/,
    );

    // A short ref that resolves to the recorded base is still accepted.
    assert.equal(
      checkForkDivergence({
        rootDir,
        baseRef: baseRef.slice(0, 8),
        allowlistPath,
      }).ok,
      false,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('re-recording at a different base needs an explicit rebase opt-in', () => {
  const { rootDir, baseRef, sourceDir } = makeGitFixture();

  try {
    const allowlistPath = path.join(rootDir, 'divergence-allowlist.json');
    writeDivergenceAllowlist({ rootDir, baseRef, allowlistPath });

    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      ['export const a = 9;', 'export const b = 2;', ''].join('\n'),
    );
    runGit(rootDir, ['add', '.']);
    runGit(rootDir, ['commit', '-m', 'fork edit']);
    const laterRef = runGit(rootDir, ['rev-parse', 'HEAD']);

    assert.throws(
      () =>
        writeDivergenceAllowlist({
          rootDir,
          baseRef: laterRef,
          allowlistPath,
        }),
      /Divergence base mismatch/,
    );

    const rebased = writeDivergenceAllowlist({
      rootDir,
      baseRef: laterRef,
      allowlistPath,
      rebaseAllowlist: true,
    });

    assert.equal(rebased.snapshot.baseRef, laterRef);
    assert.equal(
      checkForkDivergence({ rootDir, baseRef: laterRef, allowlistPath }).ok,
      true,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('--head compares a committed range instead of the worktree', () => {
  const { rootDir, baseRef, sourceDir } = makeGitFixture();

  try {
    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        '',
      ].join('\n'),
    );
    runGit(rootDir, ['add', '.']);
    runGit(rootDir, ['commit', '-m', 'fork edit']);
    const headRef = runGit(rootDir, ['rev-parse', 'HEAD']);

    const allowlistPath = path.join(rootDir, 'divergence-allowlist.json');
    writeDivergenceAllowlist({
      rootDir,
      baseRef,
      headRef,
      allowlistPath,
      recordGrowth: true,
    });

    // Dirty the worktree beyond the committed range; --head must ignore it.
    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      [
        'export const a = 9;',
        'export const b = 9;',
        'export const c = 9;',
        '',
      ].join('\n'),
    );

    assert.equal(
      checkForkDivergence({ rootDir, baseRef, headRef, allowlistPath }).ok,
      true,
    );
    assert.equal(
      checkForkDivergence({ rootDir, baseRef, allowlistPath }).ok,
      false,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
