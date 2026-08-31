const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CAPPED_PATCH_LINES,
  DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
  DEFAULT_DIVERGENCE_BASE_REF,
  checkAllowlistGovernance,
  checkForkDivergence,
  compareDivergence,
  createDivergenceSnapshot,
  evaluateDivergenceGovernance,
  formatDivergenceReport,
  getCanonicalDivergenceAllowlistPath,
  measureDivergence,
  parseDivergenceDiff,
  readDivergenceAllowlist,
  readDivergenceAllowlistAtRef,
  runSelfTest,
  serializeDivergenceSnapshot,
  validateDivergenceAllowlist,
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

const writeRepoFile = (rootDir, repoPath, contents) => {
  const filePath = path.join(rootDir, ...repoPath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
};

const commitAll = (rootDir, message) => {
  runGit(rootDir, ['add', '.']);
  runGit(rootDir, ['commit', '-m', message]);
  return runGit(rootDir, ['rev-parse', 'HEAD']);
};

const makeGitFixture = ({
  files = {
    'packages/runtime/src/index.ts': [
      'export const a = 1;',
      'export const b = 2;',
      'export const c = 3;',
      '',
    ].join('\n'),
  },
} = {}) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-fork-divergence-'),
  );
  runGit(rootDir, ['init']);
  runGit(rootDir, ['config', 'user.email', 'fixture@example.test']);
  runGit(rootDir, ['config', 'user.name', 'Fixture']);
  writeRepoFile(rootDir, 'FORK-DIVERGENCE.md', '# Ledger\n');
  for (const [repoPath, contents] of Object.entries(files)) {
    writeRepoFile(rootDir, repoPath, contents);
  }
  const upstreamBase = commitAll(rootDir, 'upstream base');
  return { rootDir, upstreamBase };
};

const writeSnapshot = ({
  rootDir,
  baseRef,
  headRef,
  pathspec = ['packages'],
}) => {
  const measured = measureDivergence({
    rootDir,
    baseRef,
    headRef,
    pathspec,
  });
  const snapshot = createDivergenceSnapshot({
    baseRef: measured.baseRef,
    pathspec,
    files: measured.files,
  });
  const allowlistPath = getCanonicalDivergenceAllowlistPath(rootDir);
  fs.mkdirSync(path.dirname(allowlistPath), { recursive: true });
  fs.writeFileSync(allowlistPath, serializeDivergenceSnapshot(snapshot));
  return { allowlistPath, measured, snapshot };
};

const makeLegacyFixture = ({
  baseContents,
  legacyContents = [
    'export const a = 9;',
    'export const b = 2;',
    'export const c = 3;',
    '',
  ].join('\n'),
  pathspec = ['packages'],
} = {}) => {
  const fixture = makeGitFixture({
    files: baseContents
      ? { 'packages/runtime/src/index.ts': baseContents }
      : undefined,
  });
  writeRepoFile(
    fixture.rootDir,
    'packages/runtime/src/index.ts',
    legacyContents,
  );
  const { allowlistPath, snapshot } = writeSnapshot({
    rootDir: fixture.rootDir,
    baseRef: fixture.upstreamBase,
    pathspec,
  });
  const mergeBase = commitAll(fixture.rootDir, 'legacy fork baseline');
  return { ...fixture, allowlistPath, baseSnapshot: snapshot, mergeBase };
};

const runCli = (rootDir, args, options = {}) =>
  spawnSync(process.execPath, [boundaryCliPath, ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    ...options,
  });

const runGovernanceCli = ({ rootDir, mergeBase, headRef, extraArgs = [] }) =>
  runCli(rootDir, [
    '--mode',
    'allowlist-governance',
    '--merge-base',
    mergeBase,
    '--head',
    headRef,
    ...extraArgs,
  ]);

const readFixtureAllowlist = fixture =>
  readDivergenceAllowlist(fixture.allowlistPath, {
    rootDir: fixture.rootDir,
  });

const loadGovernance = ({ rootDir, mergeBase, headRef }) =>
  evaluateDivergenceGovernance({
    rootDir,
    mergeBaseRef: mergeBase,
    headRef,
    baseAllowlist: readDivergenceAllowlistAtRef({
      rootDir,
      ref: mergeBase,
      allowMissing: true,
    }),
    headAllowlist: readDivergenceAllowlistAtRef({
      rootDir,
      ref: headRef,
    }),
  });

const cleanup = rootDir => fs.rmSync(rootDir, { recursive: true, force: true });

const replacementLines = count =>
  `${Array.from(
    { length: count },
    (_, index) => `export const v${String(index)} = ${String(index)};`,
  ).join('\n')}\n`;

const changedReplacementLines = count =>
  `${Array.from(
    { length: count },
    (_, index) => `export const v${String(index)} = ${String(index + 100)};`,
  ).join('\n')}\n`;

test('self test covers parser, shrink-only budgets, and incomplete-scope clears', () => {
  const { ok, results } = runSelfTest();
  const failed = results.filter(result => !result.pass);
  assert.equal(
    ok,
    true,
    failed.map(result => `${result.name}: ${result.detail}`).join('\n'),
  );
  assert.ok(results.length >= 8);
});

test('parser ignores headers and counts every package file shape', () => {
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

test('incomplete comparison never reports unmeasured entries as cleared', () => {
  const comparison = compareDivergence({
    measuredFiles: [
      { file: 'packages/server/a.ts', hunks: 1, changedLines: 2 },
    ],
    allowlistFiles: [
      { file: 'packages/runtime/a.ts', hunks: 1, changedLines: 2 },
      { file: 'packages/server/a.ts', hunks: 1, changedLines: 2 },
    ],
  });
  assert.equal(comparison.ok, true);
  assert.deepEqual(comparison.cleared, []);
});

test('the exact packages/server CLI bypass fails closed without false clears', () => {
  const result = runCli(repoRoot, [
    '--mode',
    'divergence',
    '--pathspec',
    'packages/server',
    '--json',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--pathspec is not accepted|scope mismatch/);
  assert.doesNotMatch(result.stdout, /"cleared"/);
});

test('mode all rejects the same caller-controlled scope override', () => {
  const result = runCli(repoRoot, ['--pathspec', 'packages/server', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--pathspec is not accepted/);
});

test('full recorded repository scope remains green and fully measured', () => {
  assert.equal(
    DEFAULT_DIVERGENCE_BASE_REF,
    '2f4d9c4559e26209a0d77f02c6757f29fe3699a2',
  );
  const report = checkForkDivergence({
    rootDir: repoRoot,
    allowlistPath: DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
  });
  assert.equal(report.ok, true, formatDivergenceReport(report));
  assert.equal(report.measuredFiles, 613);
  assert.equal(report.allowlistFiles, 613);
  assert.equal(report.cleared.length, 0);
});

test('direct verifier rejects narrower, broader, empty, duplicate, and normalized scopes', () => {
  const fixture = makeLegacyFixture();
  try {
    const invalidScopes = [
      ['packages/runtime'],
      ['packages', 'scripts'],
      [],
      ['packages', 'packages'],
      ['./packages'],
      ['packages/runtime/../runtime'],
      ['packages\\runtime'],
      ['Packages'],
    ];
    for (const pathspec of invalidScopes) {
      assert.throws(
        () =>
          checkForkDivergence({
            rootDir: fixture.rootDir,
            pathspec,
            allowlistPath: fixture.allowlistPath,
          }),
        /pathspec|scope|canonical|separator|duplicate|lexical|case/i,
        JSON.stringify(pathspec),
      );
    }
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('direct verifier rejects reordered recorded scope', () => {
  const fixture = makeGitFixture({
    files: {
      'packages/cli/a.ts': 'export const a = 1;\n',
      'packages/runtime/b.ts': 'export const b = 1;\n',
    },
  });
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/cli/a.ts',
      'export const a = 2;\n',
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/b.ts',
      'export const b = 2;\n',
    );
    const { allowlistPath } = writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      pathspec: ['packages/cli', 'packages/runtime'],
    });
    assert.throws(
      () =>
        checkForkDivergence({
          rootDir: fixture.rootDir,
          pathspec: ['packages/runtime', 'packages/cli'],
          allowlistPath,
        }),
      /lexical|scope mismatch/,
    );
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('nested cwd and --root probes fail with no cleared report', () => {
  const nested = path.join(repoRoot, 'packages/server');
  const fromNested = runCli(nested, ['--mode', 'divergence', '--json']);
  assert.notEqual(fromNested.status, 0);
  assert.match(fromNested.stderr, /repository top level|nested root/);
  assert.doesNotMatch(fromNested.stdout, /"cleared"/);

  const rootOverride = runCli(repoRoot, [
    '--root',
    nested,
    '--mode',
    'divergence',
    '--json',
  ]);
  assert.notEqual(rootOverride.status, 0);
  assert.match(rootOverride.stderr, /--root is not accepted|top level/);
  assert.doesNotMatch(rootOverride.stdout, /"cleared"/);
});

test('verification rejects an alternate divergence allowlist path', () => {
  const result = runCli(repoRoot, [
    '--mode',
    'divergence',
    '--divergence-allowlist',
    DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--divergence-allowlist is not accepted/);
});

test('allowlist governance rejects writer options instead of silently ignoring them', () => {
  const result = runCli(repoRoot, [
    '--mode',
    'allowlist-governance',
    '--merge-base',
    'HEAD',
    '--head',
    'HEAD',
    '--write-divergence-allowlist',
    '--record-growth',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verification-only.*writer option/);
});

test('inherited Git context variables cannot narrow verification', () => {
  const fixture = makeLegacyFixture();
  try {
    const result = runCli(fixture.rootDir, ['--mode', 'divergence', '--json'], {
      env: {
        ...process.env,
        GIT_DIR: path.join(fixture.rootDir, 'missing-git-dir'),
        GIT_WORK_TREE: path.join(fixture.rootDir, 'packages/runtime'),
        GIT_PREFIX: 'packages/runtime/',
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.divergence.measuredFiles, 1);
    assert.equal(output.divergence.allowlistFiles, 1);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('strict parser rejects aggregate total mismatches', () => {
  const fixture = makeLegacyFixture();
  try {
    const valid = readFixtureAllowlist(fixture);
    for (const key of ['totalFiles', 'totalHunks', 'totalChangedLines']) {
      const invalid = structuredClone(valid);
      invalid[key] += 1;
      assert.throws(
        () =>
          validateDivergenceAllowlist(invalid, {
            rootDir: fixture.rootDir,
          }),
        new RegExp(`${key} mismatch`),
      );
    }
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('strict parser rejects duplicate and unsorted file entries', () => {
  const fixture = makeLegacyFixture();
  try {
    const valid = readFixtureAllowlist(fixture);
    const duplicate = structuredClone(valid);
    duplicate.files.push(structuredClone(duplicate.files[0]));
    duplicate.totalFiles += 1;
    duplicate.totalHunks += duplicate.files[0].hunks;
    duplicate.totalChangedLines += duplicate.files[0].changedLines;
    assert.throws(
      () =>
        validateDivergenceAllowlist(duplicate, {
          rootDir: fixture.rootDir,
        }),
      /duplicate file entry|uniquely sorted/,
    );

    const twoFileFixture = makeGitFixture({
      files: {
        'packages/runtime/a.ts': 'export const a = 1;\n',
        'packages/runtime/b.ts': 'export const b = 1;\n',
      },
    });
    try {
      writeRepoFile(
        twoFileFixture.rootDir,
        'packages/runtime/a.ts',
        'export const a = 2;\n',
      );
      writeRepoFile(
        twoFileFixture.rootDir,
        'packages/runtime/b.ts',
        'export const b = 2;\n',
      );
      const { snapshot } = writeSnapshot({
        rootDir: twoFileFixture.rootDir,
        baseRef: twoFileFixture.upstreamBase,
      });
      snapshot.files.reverse();
      assert.throws(
        () =>
          validateDivergenceAllowlist(snapshot, {
            rootDir: twoFileFixture.rootDir,
          }),
        /lexical order/,
      );
    } finally {
      cleanup(twoFileFixture.rootDir);
    }
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('strict parser rejects coercible, non-finite, fractional, and negative budgets', () => {
  const fixture = makeLegacyFixture();
  try {
    const valid = readFixtureAllowlist(fixture);
    const invalidBudgets = [
      '2',
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      -1,
    ];
    for (const value of invalidBudgets) {
      for (const key of ['hunks', 'changedLines']) {
        const invalid = structuredClone(valid);
        invalid.files[0][key] = value;
        assert.throws(
          () =>
            validateDivergenceAllowlist(invalid, {
              rootDir: fixture.rootDir,
            }),
          /finite nonnegative safe integer/,
          `${key}=${String(value)}`,
        );
      }
    }
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('strict parser rejects missing, short, and unresolvable base identity', () => {
  const fixture = makeLegacyFixture();
  try {
    const valid = readFixtureAllowlist(fixture);
    const missing = structuredClone(valid);
    delete missing.baseRef;
    assert.throws(
      () => validateDivergenceAllowlist(missing, { rootDir: fixture.rootDir }),
      /unsupported keys|baseRef/,
    );
    for (const baseRef of ['deadbeef', 'f'.repeat(40)]) {
      const invalid = structuredClone(valid);
      invalid.baseRef = baseRef;
      assert.throws(
        () =>
          validateDivergenceAllowlist(invalid, {
            rootDir: fixture.rootDir,
          }),
        /full lowercase 40-hex|does not resolve/,
      );
    }
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('strict parser rejects noncanonical, case-mismatched, outside, and base-missing files', () => {
  const fixture = makeLegacyFixture();
  try {
    const valid = readFixtureAllowlist(fixture);
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/new.ts',
      'export const newFile = true;\n',
    );
    const invalidPaths = [
      './packages/runtime/src/index.ts',
      'packages/runtime/src/../src/index.ts',
      'packages\\runtime\\src\\index.ts',
      'Packages/runtime/src/index.ts',
      'scripts/index.ts',
      'packages/runtime/src/new.ts',
    ];
    for (const file of invalidPaths) {
      const invalid = structuredClone(valid);
      invalid.files[0].file = file;
      assert.throws(
        () =>
          validateDivergenceAllowlist(invalid, {
            rootDir: fixture.rootDir,
          }),
        /canonical|separators|outside|does not exist|exact path and case/i,
        file,
      );
    }
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('strict parser rejects invalid, duplicate, reordered, and case-mismatched recorded scope', () => {
  const fixture = makeLegacyFixture();
  try {
    const valid = readFixtureAllowlist(fixture);
    const invalidScopes = [
      [],
      ['packages', 'packages'],
      ['./packages'],
      ['packages/runtime/../runtime'],
      ['packages\\runtime'],
      ['Packages'],
    ];
    for (const pathspec of invalidScopes) {
      const invalid = structuredClone(valid);
      invalid.pathspec = pathspec;
      assert.throws(
        () =>
          validateDivergenceAllowlist(invalid, {
            rootDir: fixture.rootDir,
          }),
        /pathspec|canonical|separator|duplicate|case/i,
        JSON.stringify(pathspec),
      );
    }
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('an upstream-owned file with no recorded budget fails the gate', () => {
  const fixture = makeGitFixture();
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 1;',
        'export const b = 2;',
        'export const forked = 4;',
        '',
      ].join('\n'),
    );
    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(report.ok, false);
    assert.equal(report.violations[0].reason, 'unallowlisted-divergence');
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('added production source inside an upstream-owned package fails the gate', () => {
  const fixture = makeGitFixture();
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/fork-only.ts',
      'export const forkOnly = true;\n',
    );
    runGit(fixture.rootDir, ['add', 'packages/runtime/src/fork-only.ts']);
    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(report.ok, false);
    assert.equal(report.violationCount, 1);
    assert.equal(
      report.violations[0].file,
      'packages/runtime/src/fork-only.ts',
    );
    assert.equal(report.violations[0].reason, 'unallowlisted-divergence');
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('added production source inside an explicit fork-owned package passes', () => {
  const fixture = makeGitFixture();
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    writeRepoFile(
      fixture.rootDir,
      'packages/server/runtime-extensions/package.json',
      `${JSON.stringify({ name: '@modern-js/server-runtime-extensions' })}\n`,
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/server/runtime-extensions/src/index.ts',
      'export const extension = true;\n',
    );
    runGit(fixture.rootDir, [
      'add',
      'packages/server/runtime-extensions/package.json',
      'packages/server/runtime-extensions/src/index.ts',
    ]);
    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(report.ok, true);
    assert.equal(report.violationCount, 0);
    assert.equal(report.measuredFiles, 0);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('app-tools extensions are excluded while neighboring app-tools stays audited', () => {
  const fixture = makeGitFixture({
    files: {
      'packages/solutions/app-tools/package.json': `${JSON.stringify({ name: '@modern-js/app-tools' })}\n`,
      'packages/solutions/app-tools/src/index.ts':
        'export const appTools = true;\n',
    },
  });
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    writeRepoFile(
      fixture.rootDir,
      'packages/solutions/app-tools-extensions/package.json',
      `${JSON.stringify({ name: '@modern-js/app-tools-extensions' })}\n`,
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/solutions/app-tools-extensions/src/index.ts',
      'export const extension = true;\n',
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/solutions/app-tools/src/index.ts',
      'export const appTools = false;\n',
    );
    runGit(fixture.rootDir, [
      'add',
      'packages/solutions/app-tools-extensions/package.json',
      'packages/solutions/app-tools-extensions/src/index.ts',
      'packages/solutions/app-tools/src/index.ts',
    ]);
    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(report.ok, false);
    assert.equal(report.violationCount, 1);
    assert.equal(report.measuredFiles, 1);
    assert.equal(
      report.violations[0].file,
      'packages/solutions/app-tools/src/index.ts',
    );
    assert.equal(report.violations[0].reason, 'unallowlisted-divergence');
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('BFF extension packages are excluded while neighboring upstream packages stay audited', () => {
  const fixture = makeGitFixture({
    files: {
      'packages/cli/plugin-bff/package.json': `${JSON.stringify({ name: '@modern-js/plugin-bff' })}\n`,
      'packages/cli/plugin-bff/src/index.ts':
        'export const pluginBff = true;\n',
      'packages/server/bff-core/package.json': `${JSON.stringify({ name: '@modern-js/bff-core' })}\n`,
      'packages/server/bff-core/src/index.ts': 'export const bffCore = true;\n',
    },
  });
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    writeRepoFile(
      fixture.rootDir,
      'packages/cli/plugin-bff-extensions/package.json',
      `${JSON.stringify({ name: '@modern-js/plugin-bff-extensions' })}\n`,
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/cli/plugin-bff-extensions/src/index.ts',
      'export const pluginBffExtension = true;\n',
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/server/bff-effect/package.json',
      `${JSON.stringify({ name: '@modern-js/bff-effect' })}\n`,
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/server/bff-effect/src/index.ts',
      'export const bffEffect = true;\n',
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/cli/plugin-bff/src/index.ts',
      'export const pluginBff = false;\n',
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/server/bff-core/src/index.ts',
      'export const bffCore = false;\n',
    );
    runGit(fixture.rootDir, [
      'add',
      'packages/cli/plugin-bff-extensions/package.json',
      'packages/cli/plugin-bff-extensions/src/index.ts',
      'packages/server/bff-effect/package.json',
      'packages/server/bff-effect/src/index.ts',
      'packages/cli/plugin-bff/src/index.ts',
      'packages/server/bff-core/src/index.ts',
    ]);

    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(report.ok, false);
    assert.equal(report.violationCount, 2);
    assert.equal(report.measuredFiles, 2);
    assert.deepEqual(
      report.violations.map(violation => ({
        file: violation.file,
        reason: violation.reason,
      })),
      [
        {
          file: 'packages/cli/plugin-bff/src/index.ts',
          reason: 'unallowlisted-divergence',
        },
        {
          file: 'packages/server/bff-core/src/index.ts',
          reason: 'unallowlisted-divergence',
        },
      ],
    );
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('added i18n extension source inside its fork-owned package passes', () => {
  const fixture = makeGitFixture();
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/i18n-extensions/package.json',
      `${JSON.stringify({ name: '@modern-js/i18n-runtime-extensions' })}\n`,
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/i18n-extensions/src/index.ts',
      'export const i18nExtension = true;\n',
    );
    runGit(fixture.rootDir, [
      'add',
      'packages/runtime/i18n-extensions/package.json',
      'packages/runtime/i18n-extensions/src/index.ts',
    ]);
    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(report.ok, true);
    assert.equal(report.violationCount, 0);
    assert.equal(report.measuredFiles, 0);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('added-source diagnostics keep exact counts and bounded deterministic samples', () => {
  const fixture = makeGitFixture();
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    const addedFiles = Array.from(
      { length: 25 },
      (_, index) =>
        `packages/runtime/src/fork-only-${String(index).padStart(2, '0')}.ts`,
    );
    for (const file of addedFiles) {
      writeRepoFile(fixture.rootDir, file, 'export const forkOnly = true;\n');
    }
    runGit(fixture.rootDir, ['add', ...addedFiles]);

    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    const sampledFiles = report.violations.map(violation => violation.file);
    assert.equal(report.ok, false);
    assert.equal(report.violationCount, 25);
    assert.equal(report.violations.length, 20);
    assert.ok(sampledFiles.includes(addedFiles[0]));
    assert.ok(sampledFiles.includes(addedFiles[12]));
    assert.ok(sampledFiles.includes(addedFiles[24]));
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('checking against a different or unresolvable base fails closed', () => {
  const fixture = makeLegacyFixture();
  try {
    runGit(fixture.rootDir, ['commit', '--allow-empty', '-m', 'later commit']);
    const laterRef = runGit(fixture.rootDir, ['rev-parse', 'HEAD']);
    assert.throws(
      () =>
        checkForkDivergence({
          rootDir: fixture.rootDir,
          baseRef: laterRef,
          allowlistPath: fixture.allowlistPath,
        }),
      /Divergence base mismatch/,
    );
    assert.throws(
      () =>
        checkForkDivergence({
          rootDir: fixture.rootDir,
          baseRef: 'deadbeef',
          allowlistPath: fixture.allowlistPath,
        }),
      /does not resolve/,
    );
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('--head measures the committed tree rather than a dirtier worktree', () => {
  const fixture = makeGitFixture();
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        '',
      ].join('\n'),
    );
    const headRef = commitAll(fixture.rootDir, 'fork edit');
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      headRef,
    });
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 9;',
        'export const b = 9;',
        'export const c = 9;',
        '',
      ].join('\n'),
    );
    assert.equal(
      checkForkDivergence({ rootDir: fixture.rootDir, headRef }).ok,
      true,
    );
    assert.equal(checkForkDivergence({ rootDir: fixture.rootDir }).ok, false);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('allowlist comparison distinguishes shrink, growth, and contract transitions', () => {
  const fixture = makeLegacyFixture();
  try {
    const base = readFixtureAllowlist(fixture);
    const shrink = structuredClone(base);
    shrink.files[0].changedLines -= 1;
    shrink.totalChangedLines -= 1;
    assert.deepEqual(
      checkAllowlistGovernance({ baseAllowlist: base, headAllowlist: shrink }),
      {
        growth: [],
        introduced: false,
        reAnchored: false,
        scopeChanged: false,
        transition: false,
        ok: true,
      },
    );
    const growth = structuredClone(base);
    growth.files[0].changedLines += 1;
    growth.totalChangedLines += 1;
    assert.equal(
      checkAllowlistGovernance({ baseAllowlist: base, headAllowlist: growth })
        .growth.length,
      1,
    );
    assert.equal(
      checkAllowlistGovernance({ baseAllowlist: null, headAllowlist: base })
        .transition,
      true,
    );
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('unresolvable governance merge-base and head refs fail closed', () => {
  const fixture = makeLegacyFixture();
  try {
    fs.appendFileSync(
      path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
      'ledger row\n',
    );
    const headRef = commitAll(fixture.rootDir, 'ledger edit');
    const badBase = runGovernanceCli({
      rootDir: fixture.rootDir,
      mergeBase: 'deadbeef',
      headRef,
    });
    assert.notEqual(badBase.status, 0);
    assert.match(badBase.stderr, /does not resolve to a commit/);

    const badHead = runGovernanceCli({
      rootDir: fixture.rootDir,
      mergeBase: fixture.mergeBase,
      headRef: 'deadbeef',
    });
    assert.notEqual(badHead.status, 0);
    assert.match(badHead.stderr, /does not resolve to a commit/);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('initial allowlist introduction requires a real base tree, exact snapshot, ledger, and capped PR delta', () => {
  const fixture = makeGitFixture();
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        '',
      ].join('\n'),
    );
    fs.appendFileSync(
      path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
      'initial capped row\n',
    );
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    const headRef = commitAll(fixture.rootDir, 'introduce governed allowlist');
    const result = runGovernanceCli({
      rootDir: fixture.rootDir,
      mergeBase: fixture.upstreamBase,
      headRef,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(
      loadGovernance({
        rootDir: fixture.rootDir,
        mergeBase: fixture.upstreamBase,
        headRef,
      }).allowlist.introduced,
      true,
    );
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('capped allowlist growth passes only with a same-PR ledger change', () => {
  for (const ledgerChanged of [false, true]) {
    const fixture = makeLegacyFixture();
    try {
      writeRepoFile(
        fixture.rootDir,
        'packages/runtime/src/index.ts',
        [
          'export const a = 9;',
          'export const b = 2;',
          'export const c = 3;',
          'export const forkOnly = true;',
          '',
        ].join('\n'),
      );
      if (ledgerChanged) {
        fs.appendFileSync(
          path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
          'capped growth row\n',
        );
      }
      writeSnapshot({
        rootDir: fixture.rootDir,
        baseRef: fixture.upstreamBase,
      });
      const headRef = commitAll(fixture.rootDir, 'candidate capped growth');
      const result = runGovernanceCli({
        rootDir: fixture.rootDir,
        mergeBase: fixture.mergeBase,
        headRef,
      });
      assert.equal(
        result.status,
        ledgerChanged ? 0 : 1,
        `${result.stdout}\n${result.stderr}`,
      );
      if (!ledgerChanged) {
        assert.match(result.stderr, /FORK-DIVERGENCE\.md/);
      }
    } finally {
      cleanup(fixture.rootDir);
    }
  }
});

test('exactly 20 PR lines is allowed but an over-cap patch fails even with ledger', () => {
  for (const replacements of [10, 11]) {
    const baseContents = replacementLines(12);
    const fixture = makeLegacyFixture({
      baseContents,
      legacyContents: baseContents,
    });
    try {
      writeRepoFile(
        fixture.rootDir,
        'packages/runtime/src/index.ts',
        `${changedReplacementLines(replacements)}${replacementLines(12)
          .split('\n')
          .slice(replacements, -1)
          .join('\n')}\n`,
      );
      fs.appendFileSync(
        path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
        `replacement ${String(replacements)}\n`,
      );
      writeSnapshot({
        rootDir: fixture.rootDir,
        baseRef: fixture.upstreamBase,
      });
      const headRef = commitAll(fixture.rootDir, 'replace upstream lines');
      const governance = loadGovernance({
        rootDir: fixture.rootDir,
        mergeBase: fixture.mergeBase,
        headRef,
      });
      assert.equal(governance.rule5Changes[0].changedLines, replacements * 2);
      assert.equal(
        governance.ok,
        replacements === 10,
        governance.errors.join('\n'),
      );
    } finally {
      cleanup(fixture.rootDir);
    }
  }
  assert.equal(CAPPED_PATCH_LINES, 20);
});

test('same-count semantic replacement is a governed non-shrink change', () => {
  for (const ledgerChanged of [false, true]) {
    const fixture = makeLegacyFixture();
    try {
      writeRepoFile(
        fixture.rootDir,
        'packages/runtime/src/index.ts',
        [
          'export const a = 8;',
          'export const b = 2;',
          'export const c = 3;',
          '',
        ].join('\n'),
      );
      if (ledgerChanged) {
        fs.appendFileSync(
          path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
          'semantic replacement row\n',
        );
      }
      const headRef = commitAll(fixture.rootDir, 'same-count replacement');
      const governance = loadGovernance({
        rootDir: fixture.rootDir,
        mergeBase: fixture.mergeBase,
        headRef,
      });
      assert.equal(governance.rule5Changes[0].genuineShrink, false);
      assert.equal(governance.rule5Changes[0].changedLines, 2);
      assert.equal(governance.ok, ledgerChanged, governance.errors.join('\n'));
    } finally {
      cleanup(fixture.rootDir);
    }
  }
});

test('componentwise genuine shrink passes without ledger ceremony', () => {
  const fixture = makeLegacyFixture({
    legacyContents: [
      'export const a = 9;',
      'export const b = 9;',
      'export const c = 3;',
      '',
    ].join('\n'),
  });
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        '',
      ].join('\n'),
    );
    const headRef = commitAll(fixture.rootDir, 'shrink legacy divergence');
    const governance = loadGovernance({
      rootDir: fixture.rootDir,
      mergeBase: fixture.mergeBase,
      headRef,
    });
    assert.equal(governance.ledgerChanged, false);
    assert.equal(governance.rule5Changes[0].genuineShrink, true);
    assert.equal(governance.ok, true, governance.errors.join('\n'));
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('hand-raised budget cannot exceed the committed-head measurement', () => {
  const fixture = makeLegacyFixture();
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        'export const forkOnly = true;',
        '',
      ].join('\n'),
    );
    fs.appendFileSync(
      path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
      'real capped row\n',
    );
    const { snapshot } = writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    snapshot.files[0].changedLines += 10;
    snapshot.totalChangedLines += 10;
    fs.writeFileSync(
      fixture.allowlistPath,
      serializeDivergenceSnapshot(snapshot),
    );
    const headRef = commitAll(fixture.rootDir, 'hand raise budget');
    const governance = loadGovernance({
      rootDir: fixture.rootDir,
      mergeBase: fixture.mergeBase,
      headRef,
    });
    assert.equal(governance.ok, false);
    assert.match(governance.errors.join('\n'), /does not exactly match/);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('governance reads the committed head allowlist, not a repaired worktree file', () => {
  const fixture = makeLegacyFixture();
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        'export const forkOnly = true;',
        '',
      ].join('\n'),
    );
    fs.appendFileSync(
      path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
      'row\n',
    );
    const { snapshot } = writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    snapshot.files[0].changedLines += 5;
    snapshot.totalChangedLines += 5;
    fs.writeFileSync(
      fixture.allowlistPath,
      serializeDivergenceSnapshot(snapshot),
    );
    const headRef = commitAll(fixture.rootDir, 'commit dishonest allowlist');

    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      headRef,
    });
    const result = runGovernanceCli({
      rootDir: fixture.rootDir,
      mergeBase: fixture.mergeBase,
      headRef,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not exactly match/);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('pure upstream-owned rename is keyed by its audited old path and needs ledger', () => {
  for (const ledgerChanged of [false, true]) {
    const fixture = makeGitFixture({
      files: {
        'packages/runtime/src/old.ts': 'export const oldName = true;\n',
      },
    });
    try {
      writeSnapshot({
        rootDir: fixture.rootDir,
        baseRef: fixture.upstreamBase,
      });
      const mergeBase = commitAll(fixture.rootDir, 'baseline allowlist');
      fs.renameSync(
        path.join(fixture.rootDir, 'packages/runtime/src/old.ts'),
        path.join(fixture.rootDir, 'packages/runtime/src/new.ts'),
      );
      if (ledgerChanged) {
        fs.appendFileSync(
          path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
          'rename row\n',
        );
      }
      writeSnapshot({
        rootDir: fixture.rootDir,
        baseRef: fixture.upstreamBase,
      });
      const headRef = commitAll(fixture.rootDir, 'rename upstream file');
      const governance = loadGovernance({
        rootDir: fixture.rootDir,
        mergeBase,
        headRef,
      });
      assert.equal(
        governance.rule5Changes[0].file,
        'packages/runtime/src/old.ts',
      );
      assert.equal(governance.rule5Changes[0].renamed, true);
      assert.equal(governance.rule5Changes[0].changedLines, 0);
      assert.equal(governance.ok, ledgerChanged, governance.errors.join('\n'));
    } finally {
      cleanup(fixture.rootDir);
    }
  }
});

test('a historically renamed upstream file retains audited ownership', () => {
  const fixture = makeGitFixture({
    files: {
      'packages/runtime/src/old.ts': 'export const value = 1;\n',
    },
  });
  try {
    fs.renameSync(
      path.join(fixture.rootDir, 'packages/runtime/src/old.ts'),
      path.join(fixture.rootDir, 'packages/runtime/src/new.ts'),
    );
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    const mergeBase = commitAll(fixture.rootDir, 'historical rename baseline');
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/new.ts',
      'export const value = 2;\n',
    );
    const headRef = commitAll(fixture.rootDir, 'modify renamed file');
    const governance = loadGovernance({
      rootDir: fixture.rootDir,
      mergeBase,
      headRef,
    });
    assert.equal(
      governance.rule5Changes[0].file,
      'packages/runtime/src/old.ts',
    );
    assert.equal(governance.rule5Changes[0].genuineShrink, false);
    assert.equal(governance.ok, false);
    assert.match(governance.errors.join('\n'), /FORK-DIVERGENCE\.md/);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('plain writer locks in genuine shrink but refuses growth atomically', () => {
  const fixture = makeLegacyFixture({
    legacyContents: [
      'export const a = 9;',
      'export const b = 9;',
      'export const c = 3;',
      '',
    ].join('\n'),
  });
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        '',
      ].join('\n'),
    );
    const shrunk = writeDivergenceAllowlist({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      allowlistPath: fixture.allowlistPath,
    });
    assert.equal(shrunk.growth.length, 0);
    const afterShrink = fs.readFileSync(fixture.allowlistPath);

    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 9;',
        'export const b = 9;',
        'export const c = 9;',
        'export const forkOnly = true;',
        '',
      ].join('\n'),
    );
    assert.throws(
      () =>
        writeDivergenceAllowlist({
          rootDir: fixture.rootDir,
          baseRef: fixture.upstreamBase,
          allowlistPath: fixture.allowlistPath,
        }),
      /explicit --record-growth/,
    );
    assert.deepEqual(fs.readFileSync(fixture.allowlistPath), afterShrink);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('reviewed growth writer independently enforces refs, ledger, exact cap, and canonical path', () => {
  const fixture = makeLegacyFixture();
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      [
        'export const a = 9;',
        'export const b = 2;',
        'export const c = 3;',
        'export const forkOnly = true;',
        '',
      ].join('\n'),
    );
    fs.appendFileSync(
      path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
      'writer capped row\n',
    );
    const headRef = commitAll(
      fixture.rootDir,
      'source and ledger before writer',
    );
    const report = writeDivergenceAllowlist({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      headRef,
      mergeBaseRef: fixture.mergeBase,
      allowlistPath: fixture.allowlistPath,
      recordGrowth: true,
    });
    assert.equal(report.growth.length, 1);
    assert.equal(report.governance.ok, true);
    assert.equal(
      checkForkDivergence({ rootDir: fixture.rootDir, headRef }).ok,
      true,
    );
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('reviewed growth writer rejects absent ledger and over-cap growth without modifying the file', () => {
  for (const scenario of ['no-ledger', 'over-cap']) {
    const baseContents =
      scenario === 'over-cap' ? replacementLines(12) : undefined;
    const fixture = makeLegacyFixture({
      baseContents,
      legacyContents: scenario === 'over-cap' ? baseContents : undefined,
    });
    try {
      if (scenario === 'over-cap') {
        writeRepoFile(
          fixture.rootDir,
          'packages/runtime/src/index.ts',
          changedReplacementLines(12),
        );
        fs.appendFileSync(
          path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
          'over-cap row\n',
        );
      } else {
        writeRepoFile(
          fixture.rootDir,
          'packages/runtime/src/index.ts',
          [
            'export const a = 9;',
            'export const b = 2;',
            'export const c = 3;',
            'export const forkOnly = true;',
            '',
          ].join('\n'),
        );
      }
      const headRef = commitAll(fixture.rootDir, scenario);
      const before = fs.readFileSync(fixture.allowlistPath);
      assert.throws(
        () =>
          writeDivergenceAllowlist({
            rootDir: fixture.rootDir,
            baseRef: fixture.upstreamBase,
            headRef,
            mergeBaseRef: fixture.mergeBase,
            allowlistPath: fixture.allowlistPath,
            recordGrowth: true,
          }),
        scenario === 'over-cap'
          ? /exceeding the exact 20-line cap/
          : /FORK-DIVERGENCE\.md/,
      );
      assert.deepEqual(fs.readFileSync(fixture.allowlistPath), before);
    } finally {
      cleanup(fixture.rootDir);
    }
  }
});

test('base re-anchor requires the reviewed re-record operation and ledger evidence', () => {
  const fixture = makeLegacyFixture();
  try {
    fs.appendFileSync(
      path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
      'base migration row\n',
    );
    const headRef = commitAll(fixture.rootDir, 'authorize base migration');
    assert.throws(
      () =>
        writeDivergenceAllowlist({
          rootDir: fixture.rootDir,
          baseRef: fixture.mergeBase,
          headRef,
          allowlistPath: fixture.allowlistPath,
        }),
      /Divergence base mismatch/,
    );
    const report = writeDivergenceAllowlist({
      rootDir: fixture.rootDir,
      baseRef: fixture.mergeBase,
      headRef,
      mergeBaseRef: fixture.mergeBase,
      allowlistPath: fixture.allowlistPath,
      rebaseAllowlist: true,
    });
    assert.equal(report.snapshot.baseRef, fixture.mergeBase);
    assert.equal(report.governance.allowlist.reAnchored, true);
    const repeated = writeDivergenceAllowlist({
      rootDir: fixture.rootDir,
      headRef,
      allowlistPath: fixture.allowlistPath,
    });
    assert.equal(repeated.snapshot.baseRef, fixture.mergeBase);
    assert.equal(
      checkForkDivergence({
        rootDir: fixture.rootDir,
        baseRef: fixture.mergeBase,
        headRef,
      }).ok,
      true,
    );
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('scope transition is governance-significant and cannot be hidden by reordering', () => {
  const fixture = makeGitFixture({
    files: {
      'packages/cli/a.ts': 'export const a = 1;\n',
      'packages/runtime/b.ts': 'export const b = 1;\n',
    },
  });
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      pathspec: ['packages'],
    });
    const mergeBase = commitAll(fixture.rootDir, 'full scope baseline');
    const baseAllowlist = readDivergenceAllowlistAtRef({
      rootDir: fixture.rootDir,
      ref: mergeBase,
    });
    const narrowed = createDivergenceSnapshot({
      baseRef: fixture.upstreamBase,
      pathspec: ['packages/runtime'],
      files: [],
    });
    const comparison = checkAllowlistGovernance({
      baseAllowlist,
      headAllowlist: narrowed,
    });
    assert.equal(comparison.scopeChanged, true);
    assert.equal(comparison.ok, false);
  } finally {
    cleanup(fixture.rootDir);
  }
});
