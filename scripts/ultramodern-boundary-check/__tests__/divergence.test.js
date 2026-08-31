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
  DEFAULT_UPSTREAM_PROVENANCE_REF,
  checkAllowlistGovernance,
  checkForkDivergence,
  compareDivergence,
  createDivergenceSnapshot,
  evaluateDivergenceGovernance,
  formatDivergenceReport,
  getCanonicalDivergenceAllowlistPath,
  measureDivergence,
  parseDivergenceDiff,
  parseLedgerEvidenceRows,
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
const boundaryWorkflowPath = path.join(
  repoRoot,
  '.github/workflows/boundary-anti-patterns.yml',
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
  upstreamRef = baseRef,
  headRef,
  pathspec = ['packages'],
}) => {
  const measured = measureDivergence({
    rootDir,
    baseRef,
    upstreamRef,
    headRef,
    pathspec,
  });
  const snapshot = createDivergenceSnapshot({
    baseRef: measured.baseRef,
    upstreamRef: measured.upstreamRef,
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

const appendLedgerRow = (
  rootDir,
  file,
  {
    owner = 'bleedingdev',
    reason = 'Focused fixture reason',
    disposition = 'capped-patch',
  } = {},
) => {
  const dispositionCell = Array.isArray(disposition)
    ? disposition.map(token => `\`${token}\``).join(' + ')
    : `\`${disposition}\``;
  fs.appendFileSync(
    path.join(rootDir, 'FORK-DIVERGENCE.md'),
    [
      '',
      '| Audited-base-owned path | Owner | Reason | Disposition |',
      '| --- | --- | --- | --- |',
      `| \`${file}\` | ${owner} | ${reason} | ${dispositionCell} |`,
      '',
    ].join('\n'),
  );
};

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

test('strict ledger parser requires exact path-first rows and full disposition tokens', () => {
  const table = rows =>
    [
      '| Audited-base-owned path | Owner | Reason | Disposition |',
      '| --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
  const valid = parseLedgerEvidenceRows(
    table([
      '| `packages/runtime/src/index.ts` | bleedingdev | Need A \\| B | `capped-patch` + `fixed-in-fork` (paired fix) |',
    ]),
  );
  assert.equal(valid.length, 1);
  assert.equal(valid[0].reason, 'Need A | B');
  assert.equal(valid[0].disposition, 'capped-patch + fixed-in-fork');
  assert.deepEqual(valid[0].problems, []);

  const invalidRows = parseLedgerEvidenceRows(
    table([
      '| `packages/runtime/src/index.ts` |   | Reason | `capped-patch` |',
      '| `packages/runtime/src/missing-reason.ts` | bleedingdev |   | `capped-patch` |',
      '| `packages/runtime/src/bad-disposition.ts` | bleedingdev | Reason | `not-capped-patch` |',
      '| `packages/runtime/{a,b}.ts` | bleedingdev | Reason | `capped-patch` |',
      '| `packages/runtime/a.ts`, `packages/runtime/b.ts` | bleedingdev | Reason | `capped-patch` |',
      '| `packages/runtime/src/html-empty.ts` | <!-- --> | <span></span> | `capped-patch` |',
      '| `packages/runtime/src/zero-width.ts` | ​ | ​ | `capped-patch` |',
    ]),
  );
  assert.match(invalidRows[0].problems.join('\n'), /owner is missing/);
  assert.match(invalidRows[1].problems.join('\n'), /reason is missing/);
  assert.match(
    invalidRows[2].problems.join('\n'),
    /disposition is missing or invalid/,
  );
  assert.match(invalidRows[3].problems.join('\n'), /grouping syntax/);
  assert.match(
    invalidRows[4].problems.join('\n'),
    /exactly one backticked canonical path/,
  );
  for (const row of invalidRows.slice(5)) {
    assert.match(row.problems.join('\n'), /owner is missing/);
    assert.match(row.problems.join('\n'), /reason is missing/);
  }
  const reordered = parseLedgerEvidenceRows(
    table([
      '| `packages/runtime/src/index.ts` | bleedingdev | Need A \\| B | `fixed-in-fork` + `capped-patch` + `capped-patch` |',
    ]),
  );
  assert.equal(reordered[0].key, valid[0].key);
  assert.deepEqual(
    parseLedgerEvidenceRows(
      [
        '| ID | What diverged | Owner | Reason | Disposition |',
        '| --- | --- | --- | --- | --- |',
        '| RT-1 | `packages/runtime/src/index.ts` | bleedingdev | unrelated | `capped-patch` |',
      ].join('\n'),
    ),
    [],
  );
});

test('boundary workflow validates external forks on hosted Linux and governs direct push ranges', () => {
  const workflow = fs.readFileSync(boundaryWorkflowPath, 'utf8');
  assert.match(workflow, /^\s*pull_request_target:/mu);
  assert.doesNotMatch(workflow, /^\s*pull_request:/mu);
  assert.match(
    workflow,
    /head\.repo\.full_name != github\.repository && '"ubuntu-latest"'/,
  );
  assert.doesNotMatch(
    workflow,
    /^\s*if:\s*github\.event_name != 'pull_request'/mu,
  );
  assert.match(
    workflow,
    /repository: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}/,
  );
  assert.match(
    workflow,
    /github\.event_name == 'pull_request_target' \|\| github\.event_name == 'push'/,
  );
  assert.match(workflow, /PUSH_BEFORE_SHA: \$\{\{ github\.event\.before \}\}/);
  assert.match(workflow, /GOVERNANCE_BASE_SHA="\$PUSH_BEFORE_SHA"/);
  assert.match(
    workflow,
    /--mode allowlist-governance --merge-base "\$GOVERNANCE_BASE_SHA"/,
  );
});

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

test('verification rejects a caller-selected divergence base', () => {
  const result = runCli(repoRoot, ['--mode', 'divergence', '--base', 'HEAD']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--base is not accepted/);
});

test('canonical snapshot pins the fixed audited base identity', () => {
  const snapshot = readDivergenceAllowlist(DEFAULT_DIVERGENCE_ALLOWLIST_PATH, {
    rootDir: repoRoot,
  });
  assert.equal(
    DEFAULT_DIVERGENCE_BASE_REF,
    'eded841256a7cffdaa622e3889fc83407debd3e4',
  );
  assert.equal(snapshot.baseRef, DEFAULT_DIVERGENCE_BASE_REF);
  assert.equal(
    DEFAULT_UPSTREAM_PROVENANCE_REF,
    '2f4d9c4559e26209a0d77f02c6757f29fe3699a2',
  );
  assert.equal(snapshot.upstreamRef, DEFAULT_UPSTREAM_PROVENANCE_REF);
  assert.equal(snapshot.totalFiles, 613);
  assert.equal(snapshot.totalHunks, 2782);
  assert.equal(snapshot.totalChangedLines, 34329);
});

test('canonical verification rejects substituting HEAD for reviewed provenance', () => {
  assert.throws(
    () =>
      checkForkDivergence({
        rootDir: repoRoot,
        upstreamRef: 'HEAD',
        headRef: 'HEAD',
        allowlistPath: DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
      }),
    /upstream provenance mismatch/,
  );
});

test('full recorded repository scope remains green and fully measured', () => {
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

test('strict parser rejects missing, short, and unresolvable source identities', () => {
  const fixture = makeLegacyFixture();
  try {
    const valid = readFixtureAllowlist(fixture);
    const missing = structuredClone(valid);
    delete missing.baseRef;
    assert.throws(
      () => validateDivergenceAllowlist(missing, { rootDir: fixture.rootDir }),
      /unsupported keys|baseRef/,
    );
    const missingUpstream = structuredClone(valid);
    delete missingUpstream.upstreamRef;
    assert.throws(
      () =>
        validateDivergenceAllowlist(missingUpstream, {
          rootDir: fixture.rootDir,
        }),
      /unsupported keys|upstreamRef/,
    );
    for (const key of ['baseRef', 'upstreamRef']) {
      for (const ref of ['deadbeef', 'f'.repeat(40)]) {
        const invalid = structuredClone(valid);
        invalid[key] = ref;
        assert.throws(
          () =>
            validateDivergenceAllowlist(invalid, {
              rootDir: fixture.rootDir,
            }),
          /full lowercase 40-hex|does not resolve/,
        );
      }
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

test('reviewed upstream changes pass while fork edits on top are measured', () => {
  const fixture = makeGitFixture();
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      'export const reviewedUpstream = true;\n',
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/upstream-added.ts',
      'export const upstreamAdded = true;\n',
    );
    const upstreamRef = commitAll(fixture.rootDir, 'reviewed upstream sync');
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      upstreamRef,
    });

    const upstreamOnly = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(upstreamOnly.ok, true);
    assert.equal(upstreamOnly.measuredFiles, 0);

    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/index.ts',
      'export const forkEdit = true;\n',
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/upstream-added.ts',
      'export const arbitraryForkSubsystem = true;\n',
    );
    const forked = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(forked.ok, false);
    assert.deepEqual(
      forked.violations.map(({ file, reason }) => ({ file, reason })),
      [
        {
          file: 'packages/runtime/src/index.ts',
          reason: 'unallowlisted-divergence',
        },
        {
          file: 'packages/runtime/src/upstream-added.ts',
          reason: 'unallowlisted-divergence',
        },
      ],
    );
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('post-provenance subsystem files in upstream packages cannot escape the gate', () => {
  const fixture = makeGitFixture();
  try {
    const upstreamRef = fixture.upstreamBase;
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      upstreamRef,
    });
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/arbitrary-subsystem.ts',
      'export const arbitrarySubsystem = true;\n',
    );
    runGit(fixture.rootDir, [
      'add',
      'packages/runtime/src/arbitrary-subsystem.ts',
    ]);
    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(report.ok, false);
    assert.equal(
      report.violations[0].file,
      'packages/runtime/src/arbitrary-subsystem.ts',
    );
    assert.equal(report.violations[0].reason, 'unallowlisted-divergence');
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('lexical test, fixture, example, docs, and test-file names do not exempt package additions', () => {
  const fixture = makeGitFixture();
  const addedPaths = [
    'packages/runtime/tests/escape.ts',
    'packages/runtime/fixtures/escape.ts',
    'packages/runtime/examples/escape.ts',
    'packages/runtime/docs/escape.mdx',
    'packages/runtime/src/escape.test.ts',
    'packages/runtime/tests/fixtures/runner.mjs',
  ];
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    for (const file of addedPaths) {
      writeRepoFile(
        fixture.rootDir,
        file,
        `export const governed = ${JSON.stringify(file)};\n`,
      );
    }
    runGit(fixture.rootDir, ['add', ...addedPaths]);
    const measured = measureDivergence({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      upstreamRef: fixture.upstreamBase,
      pathspec: ['packages'],
    });
    assert.deepEqual(
      measured.files.map(entry => entry.file),
      addedPaths.toSorted(),
    );
    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(report.violationCount, addedPaths.length);
    assert.ok(
      report.violations.every(
        violation => violation.reason === 'unallowlisted-divergence',
      ),
    );
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('post-provenance subsystem ownership survives into the PR merge-base', () => {
  const fixture = makeGitFixture();
  try {
    const upstreamRef = fixture.upstreamBase;
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/tests/fixtures/post-provenance-subsystem.mjs',
      'export const subsystem = 1;\n',
    );
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      upstreamRef,
    });
    const mergeBase = commitAll(
      fixture.rootDir,
      'fork subsystem present before PR',
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/tests/fixtures/post-provenance-subsystem.mjs',
      'export const subsystem = 2;\n',
    );
    appendLedgerRow(
      fixture.rootDir,
      'packages/runtime/tests/fixtures/post-provenance-subsystem.mjs',
    );
    const changedHead = commitAll(fixture.rootDir, 'edit fork subsystem');
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      upstreamRef,
      headRef: changedHead,
    });
    const headRef = commitAll(fixture.rootDir, 'record subsystem budget');
    const governance = loadGovernance({
      rootDir: fixture.rootDir,
      mergeBase,
      headRef,
    });
    assert.equal(governance.ok, true, governance.errors.join('\n'));
    assert.equal(
      governance.rule5Changes[0].file,
      'packages/runtime/tests/fixtures/post-provenance-subsystem.mjs',
    );
    assert.equal(governance.rule5Changes[0].changedLines, 2);
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('pre-provenance renames retain the immutable audited identity', () => {
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
    const upstreamRef = commitAll(fixture.rootDir, 'reviewed upstream rename');
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
      upstreamRef,
    });
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/new.ts',
      'export const value = 2;\n',
    );
    const report = checkForkDivergence({ rootDir: fixture.rootDir });
    assert.equal(report.ok, false);
    assert.equal(report.violations[0].file, 'packages/runtime/src/old.ts');
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('owned renames into fork roots and copies remain governed', () => {
  for (const operation of ['rename', 'copy']) {
    const fixture = makeGitFixture({
      files: {
        'packages/runtime/src/owned.ts': 'export const owned = true;\n',
      },
    });
    try {
      const upstreamRef = fixture.upstreamBase;
      writeSnapshot({
        rootDir: fixture.rootDir,
        baseRef: fixture.upstreamBase,
        upstreamRef,
      });
      const destination =
        operation === 'rename'
          ? 'packages/runtime/i18n-extensions/src/escaped.ts'
          : 'packages/runtime/src/copied.ts';
      const destinationPath = path.join(fixture.rootDir, destination);
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      if (operation === 'rename') {
        fs.renameSync(
          path.join(fixture.rootDir, 'packages/runtime/src/owned.ts'),
          destinationPath,
        );
        fs.writeFileSync(destinationPath, 'export const owned = false;\n');
      } else {
        fs.copyFileSync(
          path.join(fixture.rootDir, 'packages/runtime/src/owned.ts'),
          destinationPath,
        );
      }
      runGit(fixture.rootDir, ['add', '-A']);
      const report = checkForkDivergence({ rootDir: fixture.rootDir });
      assert.equal(report.ok, false, operation);
      assert.equal(
        report.violations[0].file,
        operation === 'rename'
          ? 'packages/runtime/src/owned.ts'
          : 'packages/runtime/src/copied.ts',
      );
    } finally {
      cleanup(fixture.rootDir);
    }
  }
});

test('moving a fork-owned subsystem into an upstream package creates governed ownership', () => {
  const fixture = makeGitFixture();
  try {
    writeRepoFile(
      fixture.rootDir,
      'packages/server/runtime-extensions/package.json',
      `${JSON.stringify({ name: '@modern-js/server-runtime-extensions' })}\n`,
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/server/runtime-extensions/src/subsystem.ts',
      'export const subsystem = true;\n',
    );
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    const mergeBase = commitAll(fixture.rootDir, 'fork-owned subsystem');
    fs.renameSync(
      path.join(
        fixture.rootDir,
        'packages/server/runtime-extensions/src/subsystem.ts',
      ),
      path.join(fixture.rootDir, 'packages/runtime/src/escaped-subsystem.ts'),
    );
    const headRef = commitAll(fixture.rootDir, 'move subsystem upstream');
    const governance = loadGovernance({
      rootDir: fixture.rootDir,
      mergeBase,
      headRef,
    });
    assert.equal(governance.ok, false);
    assert.equal(
      governance.rule5Changes[0].file,
      'packages/runtime/src/escaped-subsystem.ts',
    );
    assert.equal(governance.rule5Changes[0].renamed, true);
    assert.match(governance.errors.join('\n'), /requires a same-PR/);
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
      'packages/server/runtime-extensions/tests/fixtures/index.test.ts',
      'export const extension = true;\n',
    );
    runGit(fixture.rootDir, [
      'add',
      'packages/server/runtime-extensions/package.json',
      'packages/server/runtime-extensions/tests/fixtures/index.test.ts',
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

test('checking against different or unresolvable source refs fails closed', () => {
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
    assert.throws(
      () =>
        checkForkDivergence({
          rootDir: fixture.rootDir,
          upstreamRef: laterRef,
          allowlistPath: fixture.allowlistPath,
        }),
      /upstream provenance mismatch/,
    );
    assert.throws(
      () =>
        checkForkDivergence({
          rootDir: fixture.rootDir,
          upstreamRef: 'deadbeef',
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
        provenanceModelMigrated: false,
        reAnchored: false,
        provenanceChanged: false,
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

test('legacy provenance migration accepts only the exact budget-preserving identity transition', () => {
  const modern = readDivergenceAllowlist(DEFAULT_DIVERGENCE_ALLOWLIST_PATH, {
    rootDir: repoRoot,
  });
  const legacyInput = structuredClone(modern);
  legacyInput.schemaVersion = 1;
  legacyInput.baseRef = DEFAULT_UPSTREAM_PROVENANCE_REF;
  delete legacyInput.upstreamRef;
  const legacy = validateDivergenceAllowlist(legacyInput, {
    rootDir: repoRoot,
    source: 'canonical legacy migration fixture',
    allowLegacyProvenance: true,
  });
  assert.equal(
    checkAllowlistGovernance({
      baseAllowlist: legacy,
      headAllowlist: modern,
    }).provenanceModelMigrated,
    true,
  );

  for (const invalidLegacy of [
    { ...legacy, baseRef: DEFAULT_DIVERGENCE_BASE_REF },
    {
      ...legacy,
      files: [
        { ...legacy.files[0], changedLines: legacy.files[0].changedLines - 1 },
        ...legacy.files.slice(1),
      ],
      totalChangedLines: legacy.totalChangedLines - 1,
    },
  ]) {
    assert.equal(
      checkAllowlistGovernance({
        baseAllowlist: invalidLegacy,
        headAllowlist: modern,
      }).provenanceModelMigrated,
      false,
    );
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
    appendLedgerRow(fixture.rootDir, 'packages/runtime/src/index.ts');
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
        appendLedgerRow(fixture.rootDir, 'packages/runtime/src/index.ts');
      }
      runGit(fixture.rootDir, ['add', '-A']);
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

test('ledger whitespace, unrelated rows, missing fields, and invalid dispositions cannot authorize a non-shrink', () => {
  const fixture = makeLegacyFixture();
  const sourcePath = 'packages/runtime/src/index.ts';
  const ledgerPath = path.join(fixture.rootDir, 'FORK-DIVERGENCE.md');
  const scenarios = [
    {
      name: 'whitespace-only',
      mutate: () => fs.appendFileSync(ledgerPath, '\n   \n'),
      error: /requires a same-PR strict/,
    },
    {
      name: 'arbitrary prose',
      mutate: () => fs.appendFileSync(ledgerPath, '\nunrelated ledger prose\n'),
      error: /requires a same-PR strict/,
    },
    {
      name: 'unrelated identity',
      mutate: () =>
        appendLedgerRow(fixture.rootDir, 'packages/runtime/src/other.ts'),
      error: /requires a same-PR strict/,
    },
    {
      name: 'missing owner',
      mutate: () =>
        appendLedgerRow(fixture.rootDir, sourcePath, { owner: ' ' }),
      error: /owner is missing/,
    },
    {
      name: 'missing reason',
      mutate: () =>
        appendLedgerRow(fixture.rootDir, sourcePath, { reason: ' ' }),
      error: /reason is missing/,
    },
    {
      name: 'invalid disposition',
      mutate: () =>
        appendLedgerRow(fixture.rootDir, sourcePath, {
          disposition: 'not-capped-patch',
        }),
      error: /disposition is missing or invalid/,
    },
    {
      name: 'grouped path',
      mutate: () =>
        appendLedgerRow(
          fixture.rootDir,
          'packages/runtime/src/{index,other}.ts',
        ),
      error: /requires a same-PR strict/,
    },
    {
      name: 'duplicate rows',
      mutate: () => {
        appendLedgerRow(fixture.rootDir, sourcePath);
        appendLedgerRow(fixture.rootDir, sourcePath, {
          reason: 'Conflicting second reason',
        });
      },
      error: /ambiguous duplicate\/conflicting/,
    },
  ];
  try {
    for (const scenario of scenarios) {
      runGit(fixture.rootDir, ['switch', '--detach', fixture.mergeBase]);
      writeRepoFile(
        fixture.rootDir,
        sourcePath,
        [
          'export const a = 8;',
          'export const b = 2;',
          'export const c = 3;',
          '',
        ].join('\n'),
      );
      scenario.mutate();
      const headRef = commitAll(fixture.rootDir, scenario.name);
      const governance = loadGovernance({
        rootDir: fixture.rootDir,
        mergeBase: fixture.mergeBase,
        headRef,
      });
      assert.equal(governance.ok, false, scenario.name);
      assert.match(governance.errors.join('\n'), scenario.error, scenario.name);
    }
  } finally {
    cleanup(fixture.rootDir);
  }
});

test('an unchanged historical matching row plus an unrelated ledger edit is not same-PR evidence', () => {
  const fixture = makeLegacyFixture();
  try {
    appendLedgerRow(fixture.rootDir, 'packages/runtime/src/index.ts');
    const mergeBase = commitAll(fixture.rootDir, 'historical ledger evidence');
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
    fs.appendFileSync(
      path.join(fixture.rootDir, 'FORK-DIVERGENCE.md'),
      '\nunrelated same-PR prose\n',
    );
    const headRef = commitAll(fixture.rootDir, 'unrelated ledger edit');
    const governance = loadGovernance({
      rootDir: fixture.rootDir,
      mergeBase,
      headRef,
    });
    assert.equal(governance.ok, false);
    assert.match(governance.errors.join('\n'), /requires a same-PR strict/);
    assert.equal(governance.ledgerChanged, true);
    assert.equal(governance.ledgerEvidence.changed, false);
  } finally {
    cleanup(fixture.rootDir);
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
      appendLedgerRow(fixture.rootDir, 'packages/runtime/src/index.ts');
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
        appendLedgerRow(fixture.rootDir, 'packages/runtime/src/index.ts');
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

test('each changed immutable identity needs its own strict ledger row', () => {
  const fixture = makeGitFixture({
    files: {
      'packages/runtime/src/a.ts': 'export const a = 1;\n',
      'packages/runtime/src/b.ts': 'export const b = 1;\n',
    },
  });
  try {
    writeSnapshot({
      rootDir: fixture.rootDir,
      baseRef: fixture.upstreamBase,
    });
    const mergeBase = commitAll(fixture.rootDir, 'empty divergence baseline');
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/a.ts',
      'export const a = 2;\n',
    );
    writeRepoFile(
      fixture.rootDir,
      'packages/runtime/src/b.ts',
      'export const b = 2;\n',
    );
    appendLedgerRow(fixture.rootDir, 'packages/runtime/src/a.ts');
    const headRef = commitAll(fixture.rootDir, 'change two identities');
    const governance = loadGovernance({
      rootDir: fixture.rootDir,
      mergeBase,
      headRef,
    });
    assert.equal(governance.ok, false);
    assert.match(
      governance.errors.join('\n'),
      /packages\/runtime\/src\/b\.ts requires a same-PR strict/,
    );
    assert.doesNotMatch(
      governance.errors.join('\n'),
      /packages\/runtime\/src\/a\.ts requires a same-PR strict/,
    );
  } finally {
    cleanup(fixture.rootDir);
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
    appendLedgerRow(fixture.rootDir, 'packages/runtime/src/index.ts');
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
    appendLedgerRow(fixture.rootDir, 'packages/runtime/src/index.ts');
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

test('upstream docs identity survives rename and needs ledger on its audited old path', () => {
  for (const evidencePath of [
    null,
    'packages/runtime/docs/old.mdx',
    'packages/runtime/docs/new.mdx',
  ]) {
    const fixture = makeGitFixture({
      files: {
        'packages/runtime/docs/old.mdx': '# Old heading\n',
      },
    });
    try {
      writeSnapshot({
        rootDir: fixture.rootDir,
        baseRef: fixture.upstreamBase,
      });
      const mergeBase = commitAll(fixture.rootDir, 'baseline allowlist');
      fs.renameSync(
        path.join(fixture.rootDir, 'packages/runtime/docs/old.mdx'),
        path.join(fixture.rootDir, 'packages/runtime/docs/new.mdx'),
      );
      if (evidencePath) {
        appendLedgerRow(fixture.rootDir, evidencePath);
      }
      const renamedHead = commitAll(fixture.rootDir, 'rename upstream file');
      writeSnapshot({
        rootDir: fixture.rootDir,
        baseRef: fixture.upstreamBase,
        headRef: renamedHead,
      });
      const governance = loadGovernance({
        rootDir: fixture.rootDir,
        mergeBase,
        headRef: renamedHead,
      });
      assert.equal(
        governance.rule5Changes[0].file,
        'packages/runtime/docs/old.mdx',
      );
      assert.equal(governance.rule5Changes[0].renamed, true);
      assert.equal(governance.rule5Changes[0].changedLines, 0);
      assert.equal(
        governance.ok,
        evidencePath === 'packages/runtime/docs/old.mdx',
        governance.errors.join('\n'),
      );
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
    appendLedgerRow(fixture.rootDir, 'packages/runtime/src/index.ts');
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
        appendLedgerRow(fixture.rootDir, 'packages/runtime/src/index.ts');
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

test('base re-anchor cannot silently replace the fixed provenance model', () => {
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
    assert.throws(
      () =>
        writeDivergenceAllowlist({
          rootDir: fixture.rootDir,
          baseRef: fixture.mergeBase,
          headRef,
          mergeBaseRef: fixture.mergeBase,
          allowlistPath: fixture.allowlistPath,
          rebaseAllowlist: true,
        }),
      /provenance transitions cannot reset divergence debt/,
    );
    assert.equal(
      checkForkDivergence({
        rootDir: fixture.rootDir,
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
