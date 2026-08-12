/**
 * Upstream-file divergence guard.
 *
 * The sibling `checker.js` guard only sees one shape of boundary violation:
 * an upstream-owned file that *imports* fork-only code. It is blind to the far
 * larger surface where fork code is written directly *into* upstream-owned
 * files. This module widens the gate to "any diff hunk in an upstream-owned
 * file", budgeted per file and shrink-only.
 *
 * A file is upstream-owned when it is under `packages/` and already existed at
 * the upstream base ref (`--diff-filter=MD` keeps modified + deleted paths, so
 * fork-new files are excluded exactly like `pathExistsAtRef` excludes them).
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIVERGENCE_SCHEMA_VERSION = 1;
const DIVERGENCE_FILE_PATTERN = /^packages\//;

/**
 * Upstream tip that HEAD forked from: `git merge-base HEAD v3.8.1`.
 * v3.8.1 itself (95676449) is not an ancestor of this fork, its parent is.
 */
const DEFAULT_DIVERGENCE_BASE_REF = 'dfcd414a050d4455851ff76f861822fca0d4bcf4';
const DEFAULT_DIVERGENCE_ALLOWLIST_PATH = path.join(
  __dirname,
  'divergence-allowlist.json',
);
const DEFAULT_PATHSPEC = Object.freeze(['packages']);

/** Ceiling for the "capped patch" escape hatch in the two-bucket rule. */
const CAPPED_PATCH_LINES = 20;

/** The 1.5MB `-U0` patch for this fork does not fit in the 1MB spawn default. */
const GIT_MAX_BUFFER_BYTES = 512 * 1024 * 1024;

const TWO_BUCKET_RULE = [
  'Every change to an upstream-owned file must land in one of two buckets:',
  '  1. upstream PR - send the change to web-infra-dev/modern.js instead;',
  '  2. extension point - move the behaviour into fork-owned code behind a',
  '     plugin/hook/config seam so the upstream file stops changing.',
  `Only escape hatch: a capped patch of <= ~${String(
    CAPPED_PATCH_LINES,
  )} changed lines with a matching`,
  'FORK-DIVERGENCE.md entry explaining why neither bucket applies.',
];

const toPosixPath = value => value.split(path.sep).join('/');

const runGitDiff = ({ rootDir, args }) => {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    stdio: 'pipe',
  });

  if (result.error) {
    throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const suffix = stderr ? `: ${stderr}` : '';
    throw new Error(`git ${args.join(' ')} failed${suffix}`);
  }

  return result.stdout || '';
};

/**
 * Builds the single `git diff` invocation the whole check runs on.
 *
 * `-U0` keeps the patch small while still emitting one `@@` header per changed
 * region, which is what the hunk budget counts. The diff algorithm and indent
 * heuristic are pinned so hunk counts match the committed allowlist on every
 * machine regardless of user/CI git config or git-version defaults (an
 * unpinned run under myers measures 2923 hunks where histogram measures the
 * recorded 2835, failing 39 budgets that were never exceeded).
 */
const buildDiffArgs = ({
  baseRef = DEFAULT_DIVERGENCE_BASE_REF,
  headRef,
  pathspec = DEFAULT_PATHSPEC,
} = {}) => [
  '-c',
  'core.quotePath=false',
  '-c',
  'diff.algorithm=histogram',
  '-c',
  'diff.indentHeuristic=true',
  'diff',
  '--no-ext-diff',
  '--no-color',
  '--no-renames',
  '--diff-filter=MD',
  '-U0',
  baseRef,
  ...(headRef ? [headRef] : []),
  '--',
  ...pathspec,
];

/**
 * Resolves a ref to a full commit SHA so a short ref, a tag and a full SHA all
 * compare equal. Returns null when the ref is not resolvable in `rootDir`.
 */
const resolveCommitSha = ({ rootDir, ref }) => {
  if (!ref) {
    return null;
  }

  const result = spawnSync(
    'git',
    ['rev-parse', '--verify', `${ref}^{commit}`],
    {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  return (result.stdout || '').trim() || null;
};

/**
 * The budgets are cumulative counts taken at the allowlist's recorded base, so
 * they are only meaningful when the run uses that same base. Comparing a
 * per-range delta (a PR merge-base, `HEAD~1`, a push `before` SHA) against them
 * fails both open and closed, so refuse instead of reporting a wrong verdict.
 */
const assertAllowlistBaseMatches = ({
  rootDir,
  baseRef,
  allowlistBaseRef,
  allowlistPath,
  hint,
}) => {
  if (!allowlistBaseRef || allowlistBaseRef === baseRef) {
    return;
  }

  const resolvedBase = resolveCommitSha({ rootDir, ref: baseRef });
  const resolvedAllowlistBase = resolveCommitSha({
    rootDir,
    ref: allowlistBaseRef,
  });

  if (
    resolvedBase &&
    resolvedAllowlistBase &&
    resolvedBase === resolvedAllowlistBase
  ) {
    return;
  }

  throw new Error(
    [
      `Divergence base mismatch: run base ${baseRef}${
        resolvedBase ? ` (${resolvedBase})` : ' (unresolvable)'
      } is not the base recorded in ${allowlistPath}: ${allowlistBaseRef}${
        resolvedAllowlistBase
          ? ` (${resolvedAllowlistBase})`
          : ' (unresolvable)'
      }.`,
      'Divergence budgets are cumulative counts measured at the recorded upstream base and are meaningless against any other base.',
      hint,
    ]
      .filter(Boolean)
      .join(' '),
  );
};

const stripDiffPathPrefix = value => {
  const trimmed = value.trim();
  if (trimmed === '/dev/null') {
    return null;
  }
  if (trimmed.startsWith('a/') || trimmed.startsWith('b/')) {
    return trimmed.slice(2);
  }
  return trimmed;
};

const parseHeaderPaths = line => {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (!match) {
    return null;
  }
  const [, left, right] = match;
  return left === right ? left : right;
};

/**
 * Parses a `git diff -U0` patch into per-file hunk and changed-line counts.
 *
 * Only lines inside a hunk are counted, so the `---`/`+++`/`index`/`new file`
 * header lines never leak into the line budget.
 */
const parseDivergenceDiff = (
  patchText,
  { filePattern = DIVERGENCE_FILE_PATTERN } = {},
) => {
  const files = [];
  let current = null;
  let inHunk = false;

  const flush = () => {
    if (!current) {
      return;
    }
    const file = current.newPath ?? current.oldPath ?? current.headerPath;
    if (file && (!filePattern || filePattern.test(file))) {
      files.push({
        file,
        hunks: current.hunks,
        changedLines: current.addedLines + current.removedLines,
        addedLines: current.addedLines,
        removedLines: current.removedLines,
      });
    }
    current = null;
  };

  for (const rawLine of patchText.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line.startsWith('diff --git ')) {
      flush();
      inHunk = false;
      current = {
        headerPath: parseHeaderPaths(line),
        oldPath: null,
        newPath: null,
        hunks: 0,
        addedLines: 0,
        removedLines: 0,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('@@')) {
      current.hunks += 1;
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      if (line.startsWith('--- ')) {
        current.oldPath = stripDiffPathPrefix(line.slice(4));
        continue;
      }
      if (line.startsWith('+++ ')) {
        current.newPath = stripDiffPathPrefix(line.slice(4));
        continue;
      }
      if (line.startsWith('Binary files ')) {
        // No hunks are emitted for binaries; record a minimal non-zero budget
        // so the file still has to be allowlisted.
        current.hunks = Math.max(current.hunks, 1);
        current.addedLines = Math.max(current.addedLines, 1);
      }
      continue;
    }

    if (line.startsWith('+')) {
      current.addedLines += 1;
    } else if (line.startsWith('-')) {
      current.removedLines += 1;
    }
  }

  flush();

  return files
    .map(entry => ({ ...entry, file: toPosixPath(entry.file) }))
    .sort((left, right) => left.file.localeCompare(right.file));
};

const measureDivergence = ({
  rootDir = process.cwd(),
  baseRef = DEFAULT_DIVERGENCE_BASE_REF,
  headRef,
  pathspec = DEFAULT_PATHSPEC,
  filePattern = DIVERGENCE_FILE_PATTERN,
} = {}) => {
  const args = buildDiffArgs({ baseRef, headRef, pathspec });
  const patchText = runGitDiff({ rootDir, args });
  const files = parseDivergenceDiff(patchText, { filePattern });

  return {
    baseRef,
    headRef: headRef ?? null,
    files,
    totalFiles: files.length,
    totalHunks: files.reduce((sum, entry) => sum + entry.hunks, 0),
    totalChangedLines: files.reduce(
      (sum, entry) => sum + entry.changedLines,
      0,
    ),
  };
};

const createDivergenceSnapshot = ({
  baseRef = DEFAULT_DIVERGENCE_BASE_REF,
  pathspec = DEFAULT_PATHSPEC,
  files = [],
} = {}) => {
  const budgets = [...files]
    .map(entry => ({
      file: entry.file,
      hunks: entry.hunks,
      changedLines: entry.changedLines,
    }))
    .sort((left, right) => left.file.localeCompare(right.file));

  return {
    schemaVersion: DIVERGENCE_SCHEMA_VERSION,
    baseRef,
    pathspec: [...pathspec],
    migrationGoal:
      'Shrink-only budget of fork edits inside upstream-owned files. Every entry is debt: move it upstream or behind an extension point, then re-run --write-divergence-allowlist.',
    totalFiles: budgets.length,
    totalHunks: budgets.reduce((sum, entry) => sum + entry.hunks, 0),
    totalChangedLines: budgets.reduce(
      (sum, entry) => sum + entry.changedLines,
      0,
    ),
    files: budgets,
  };
};

const PATHSPEC_TOKEN = '__ULTRAMODERN_PATHSPEC__';

/**
 * Serializes the snapshot the way the repo formatter would, so a regenerated
 * allowlist never shows up as a formatting diff. Short arrays are printed
 * inline; `files` stays expanded because it never fits on one line.
 */
const serializeDivergenceSnapshot = snapshot => {
  const inlinePathspec = JSON.stringify(snapshot.pathspec);
  const body = JSON.stringify(
    { ...snapshot, pathspec: PATHSPEC_TOKEN },
    null,
    2,
  );

  if (`  "pathspec": ${inlinePathspec},`.length > 80) {
    return `${JSON.stringify(snapshot, null, 2)}\n`;
  }

  return `${body.replace(`"${PATHSPEC_TOKEN}"`, inlinePathspec)}\n`;
};

const readDivergenceAllowlist = allowlistPath => {
  if (!fs.existsSync(allowlistPath)) {
    throw new Error(`Divergence allowlist does not exist: ${allowlistPath}`);
  }

  const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));

  if (allowlist.schemaVersion !== DIVERGENCE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported divergence allowlist schemaVersion ${String(
        allowlist.schemaVersion,
      )}; expected ${String(DIVERGENCE_SCHEMA_VERSION)}`,
    );
  }

  if (!Array.isArray(allowlist.files)) {
    throw new Error('Divergence allowlist files must be an array');
  }

  return {
    ...allowlist,
    files: [...allowlist.files]
      .map(entry => ({
        file: toPosixPath(String(entry.file)),
        hunks: Number(entry.hunks) || 0,
        changedLines: Number(entry.changedLines) || 0,
      }))
      .sort((left, right) => left.file.localeCompare(right.file)),
  };
};

const writeDivergenceAllowlist = ({
  rootDir = process.cwd(),
  baseRef = DEFAULT_DIVERGENCE_BASE_REF,
  headRef,
  pathspec = DEFAULT_PATHSPEC,
  filePattern = DIVERGENCE_FILE_PATTERN,
  allowlistPath = DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
  rebaseAllowlist = false,
  recordGrowth = false,
} = {}) => {
  const existingAllowlist = fs.existsSync(allowlistPath)
    ? readDivergenceAllowlist(allowlistPath)
    : null;

  if (!rebaseAllowlist && existingAllowlist) {
    assertAllowlistBaseMatches({
      rootDir,
      baseRef,
      allowlistBaseRef: existingAllowlist.baseRef,
      allowlistPath,
      hint: 'Re-record at the recorded base, or pass --rebase-divergence-allowlist to deliberately re-anchor the baseline to a new upstream base.',
    });
  }

  const measured = measureDivergence({
    rootDir,
    baseRef,
    headRef,
    pathspec,
    filePattern,
  });
  const growth = compareDivergence({
    measuredFiles: measured.files,
    allowlistFiles: existingAllowlist?.files ?? [],
  }).violations;

  if (growth.length > 0 && !recordGrowth) {
    throw new Error(
      [
        `Refusing to write ${allowlistPath}: divergence budget growth requires the explicit --record-growth flag.`,
        'Offending entries:',
        ...growth.map(formatDivergenceGrowth),
        'Land every sanctioned budget increase with its matching FORK-DIVERGENCE.md row, then re-run with --write-divergence-allowlist --record-growth.',
      ].join('\n'),
    );
  }

  const snapshot = createDivergenceSnapshot({
    baseRef,
    pathspec,
    files: measured.files,
  });

  fs.mkdirSync(path.dirname(allowlistPath), { recursive: true });
  fs.writeFileSync(
    allowlistPath,
    serializeDivergenceSnapshot(snapshot),
    'utf8',
  );

  return { ...measured, allowlistPath, growth, snapshot };
};

/**
 * Shrink-only comparison.
 *
 * Fails when a file's changed-line or hunk budget grows, or when a file
 * diverges without any recorded budget. A shrink is componentwise monotonic:
 * neither metric may grow, and at least one must strictly decrease.
 */
const compareDivergence = ({
  measuredFiles = [],
  allowlistFiles = [],
} = {}) => {
  const allowedByFile = new Map(
    allowlistFiles.map(entry => [entry.file, entry]),
  );
  const measuredByFile = new Map(
    measuredFiles.map(entry => [entry.file, entry]),
  );

  const violations = [];
  const shrunk = [];

  for (const measured of measuredFiles) {
    const allowed = allowedByFile.get(measured.file);

    if (!allowed) {
      violations.push({
        reason: 'unallowlisted-divergence',
        file: measured.file,
        budgetHunks: 0,
        budgetChangedLines: 0,
        measuredHunks: measured.hunks,
        measuredChangedLines: measured.changedLines,
      });
      continue;
    }

    const lineGrowth = measured.changedLines > allowed.changedLines;
    const hunkGrowth = measured.hunks > allowed.hunks;

    if (lineGrowth || hunkGrowth) {
      violations.push({
        reason: lineGrowth ? 'line-budget-exceeded' : 'hunk-budget-exceeded',
        file: measured.file,
        budgetHunks: allowed.hunks,
        budgetChangedLines: allowed.changedLines,
        measuredHunks: measured.hunks,
        measuredChangedLines: measured.changedLines,
      });
      continue;
    }

    if (
      measured.changedLines <= allowed.changedLines &&
      measured.hunks <= allowed.hunks &&
      (measured.changedLines < allowed.changedLines ||
        measured.hunks < allowed.hunks)
    ) {
      shrunk.push({
        file: measured.file,
        budgetHunks: allowed.hunks,
        budgetChangedLines: allowed.changedLines,
        measuredHunks: measured.hunks,
        measuredChangedLines: measured.changedLines,
      });
    }
  }

  const cleared = allowlistFiles
    .filter(entry => !measuredByFile.has(entry.file))
    .map(entry => ({
      file: entry.file,
      budgetHunks: entry.hunks,
      budgetChangedLines: entry.changedLines,
      measuredHunks: 0,
      measuredChangedLines: 0,
    }));

  return {
    violations: violations.sort(
      (left, right) =>
        right.measuredChangedLines - right.budgetChangedLines ||
        left.file.localeCompare(right.file),
    ),
    shrunk,
    cleared,
    ok: violations.length === 0,
  };
};

const checkAllowlistGovernance = ({ baseAllowlist, headAllowlist } = {}) => {
  const reAnchored =
    baseAllowlist !== null && baseAllowlist.baseRef !== headAllowlist.baseRef;
  const comparison = compareDivergence({
    allowlistFiles: baseAllowlist?.files ?? [],
    measuredFiles: headAllowlist.files,
  });

  return {
    growth: comparison.violations,
    reAnchored,
    ok: comparison.violations.length === 0 && !reAnchored,
  };
};

const checkForkDivergence = ({
  rootDir = process.cwd(),
  baseRef = DEFAULT_DIVERGENCE_BASE_REF,
  headRef,
  pathspec = DEFAULT_PATHSPEC,
  filePattern = DIVERGENCE_FILE_PATTERN,
  allowlistPath = DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
} = {}) => {
  const allowlist = readDivergenceAllowlist(allowlistPath);

  assertAllowlistBaseMatches({
    rootDir,
    baseRef,
    allowlistBaseRef: allowlist.baseRef,
    allowlistPath,
    hint: 'Re-run without --base (or with the recorded base) instead; use --head to point at a different tree.',
  });

  const measured = measureDivergence({
    rootDir,
    baseRef,
    headRef,
    pathspec,
    filePattern,
  });
  const comparison = compareDivergence({
    measuredFiles: measured.files,
    allowlistFiles: allowlist.files,
  });

  return {
    baseRef,
    headRef: headRef ?? null,
    allowlistPath,
    measuredFiles: measured.totalFiles,
    measuredHunks: measured.totalHunks,
    measuredChangedLines: measured.totalChangedLines,
    allowlistFiles: allowlist.files.length,
    allowlistChangedLines: allowlist.files.reduce(
      (sum, entry) => sum + entry.changedLines,
      0,
    ),
    violations: comparison.violations,
    shrunk: comparison.shrunk,
    cleared: comparison.cleared,
    ok: comparison.ok,
  };
};

const formatDivergenceViolation = violation => {
  const label =
    violation.reason === 'unallowlisted-divergence'
      ? 'no recorded budget'
      : `budget ${String(violation.budgetHunks)} hunks / ${String(
          violation.budgetChangedLines,
        )} lines`;

  return `- ${violation.file}: ${label}, measured ${String(
    violation.measuredHunks,
  )} hunks / ${String(violation.measuredChangedLines)} lines (${
    violation.reason
  })`;
};

const formatDivergenceGrowth = entry =>
  entry.reason === 'unallowlisted-divergence'
    ? `- ${entry.file}: added at ${String(entry.measuredHunks)} hunks / ${String(
        entry.measuredChangedLines,
      )} lines`
    : `- ${entry.file}: budget ${String(entry.budgetHunks)} hunks / ${String(
        entry.budgetChangedLines,
      )} lines -> ${String(entry.measuredHunks)} hunks / ${String(
        entry.measuredChangedLines,
      )} lines (${entry.reason})`;

const formatShrinkHint = entry =>
  `- ${entry.file}: budget ${String(entry.budgetHunks)} hunks / ${String(
    entry.budgetChangedLines,
  )} lines -> now ${String(entry.measuredHunks)} hunks / ${String(
    entry.measuredChangedLines,
  )} lines`;

const formatDivergenceReport = report => {
  const range = report.headRef
    ? `${report.baseRef}..${report.headRef}`
    : `${report.baseRef}..worktree`;

  const lines = [
    `[ultramodern-divergence] diffed ${range} over upstream-owned files`,
    `[ultramodern-divergence] measured=${String(
      report.measuredFiles,
    )} files / ${String(report.measuredHunks)} hunks / ${String(
      report.measuredChangedLines,
    )} lines; allowlist=${String(report.allowlistFiles)} files / ${String(
      report.allowlistChangedLines,
    )} lines; violations=${String(report.violations.length)}`,
  ];

  if (report.violations.length > 0) {
    lines.push(
      '',
      'Fork divergence grew inside upstream-owned files:',
      ...report.violations.map(formatDivergenceViolation),
      '',
      ...TWO_BUCKET_RULE,
    );
  }

  if (report.violations.length === 0 && report.shrunk.length > 0) {
    lines.push(
      '',
      `Divergence shrank in ${String(
        report.shrunk.length,
      )} file(s); re-run with --write-divergence-allowlist to lock in the smaller budget:`,
      ...report.shrunk.slice(0, 20).map(formatShrinkHint),
    );
    if (report.shrunk.length > 20) {
      lines.push(`- ... and ${String(report.shrunk.length - 20)} more`);
    }
  }

  if (report.cleared.length > 0) {
    lines.push(
      '',
      `${String(
        report.cleared.length,
      )} allowlisted file(s) no longer diverge; drop their entries with --write-divergence-allowlist:`,
      ...report.cleared.slice(0, 20).map(entry => `- ${entry.file}`),
    );
    if (report.cleared.length > 20) {
      lines.push(`- ... and ${String(report.cleared.length - 20)} more`);
    }
  }

  if (report.violations.length === 0) {
    lines.push('', 'No new fork divergence inside upstream-owned files.');
  }

  return lines.join('\n');
};

const SELF_TEST_PATCH = [
  'diff --git a/packages/runtime/src/kept.ts b/packages/runtime/src/kept.ts',
  'index 1111111..2222222 100644',
  '--- a/packages/runtime/src/kept.ts',
  '+++ b/packages/runtime/src/kept.ts',
  '@@ -1 +1 @@',
  '-export const value = 1;',
  '+export const value = 2;',
  '@@ -10,0 +11,2 @@',
  '+// fork note',
  '+export const extra = 3;',
  'diff --git a/packages/runtime/src/skipped.md b/packages/runtime/src/skipped.md',
  'index 3333333..4444444 100644',
  '--- a/packages/runtime/src/skipped.md',
  '+++ b/packages/runtime/src/skipped.md',
  '@@ -1 +1 @@',
  '-docs',
  '+docs changed',
  'diff --git a/packages/runtime/src/removed.ts b/packages/runtime/src/removed.ts',
  'deleted file mode 100644',
  'index 5555555..0000000',
  '--- a/packages/runtime/src/removed.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-export const gone = 1;',
  '-export const alsoGone = 2;',
  '',
].join('\n');

/**
 * Git-free self test: exercises the hunk parser and the shrink-only budget
 * comparison on a synthetic patch. Returns { ok, results }.
 */
const runSelfTest = () => {
  const results = [];
  const record = (name, pass, detail) => {
    results.push({ name, pass, detail });
  };

  const parsed = parseDivergenceDiff(SELF_TEST_PATCH);
  const byFile = new Map(parsed.map(entry => [entry.file, entry]));

  record(
    'parser: every upstream-owned package file is counted',
    parsed.length === 3 &&
      byFile.has('packages/runtime/src/kept.ts') &&
      byFile.has('packages/runtime/src/removed.ts') &&
      byFile.has('packages/runtime/src/skipped.md'),
    `files=${parsed.map(entry => entry.file).join(',')}`,
  );

  const kept = byFile.get('packages/runtime/src/kept.ts');
  record(
    'parser: hunk and changed-line counts exclude diff headers',
    Boolean(kept) &&
      kept.hunks === 2 &&
      kept.addedLines === 3 &&
      kept.removedLines === 1 &&
      kept.changedLines === 4,
    kept ? JSON.stringify(kept) : 'missing',
  );

  const removed = byFile.get('packages/runtime/src/removed.ts');
  record(
    'parser: deleted upstream file resolves its path from --- a/',
    Boolean(removed) && removed.hunks === 1 && removed.changedLines === 2,
    removed ? JSON.stringify(removed) : 'missing',
  );

  const budget = [
    { file: 'packages/runtime/src/kept.ts', hunks: 2, changedLines: 4 },
    { file: 'packages/runtime/src/removed.ts', hunks: 1, changedLines: 2 },
    { file: 'packages/runtime/src/skipped.md', hunks: 1, changedLines: 2 },
  ];

  const green = compareDivergence({
    measuredFiles: parsed,
    allowlistFiles: budget,
  });
  record(
    'budget: unchanged divergence passes',
    green.ok && green.violations.length === 0,
    JSON.stringify(green.violations),
  );

  const grown = compareDivergence({
    measuredFiles: parsed.map(entry =>
      entry.file === 'packages/runtime/src/kept.ts'
        ? { ...entry, changedLines: entry.changedLines + 6 }
        : entry,
    ),
    allowlistFiles: budget,
  });
  record(
    'budget: a grown hunk fails with line-budget-exceeded',
    !grown.ok &&
      grown.violations.length === 1 &&
      grown.violations[0].reason === 'line-budget-exceeded' &&
      grown.violations[0].file === 'packages/runtime/src/kept.ts' &&
      grown.violations[0].budgetChangedLines === 4 &&
      grown.violations[0].measuredChangedLines === 10,
    JSON.stringify(grown.violations),
  );

  const newFile = compareDivergence({
    measuredFiles: parsed,
    allowlistFiles: budget.filter(
      entry => entry.file !== 'packages/runtime/src/removed.ts',
    ),
  });
  record(
    'budget: an upstream file with no recorded budget fails',
    !newFile.ok &&
      newFile.violations.length === 1 &&
      newFile.violations[0].reason === 'unallowlisted-divergence',
    JSON.stringify(newFile.violations),
  );

  const extraHunk = compareDivergence({
    measuredFiles: [
      { file: 'packages/runtime/src/kept.ts', hunks: 3, changedLines: 4 },
    ],
    allowlistFiles: [
      { file: 'packages/runtime/src/kept.ts', hunks: 2, changedLines: 4 },
    ],
  });
  record(
    'budget: a new hunk region fails even at equal line count',
    !extraHunk.ok && extraHunk.violations[0].reason === 'hunk-budget-exceeded',
    JSON.stringify(extraHunk.violations),
  );

  const launderedHunks = compareDivergence({
    measuredFiles: [
      { file: 'packages/runtime/src/kept.ts', hunks: 8, changedLines: 38 },
    ],
    allowlistFiles: [
      { file: 'packages/runtime/src/kept.ts', hunks: 3, changedLines: 39 },
    ],
  });
  record(
    'budget: new hunks fail even when total changed lines shrink',
    !launderedHunks.ok &&
      launderedHunks.violations[0].reason === 'hunk-budget-exceeded' &&
      launderedHunks.shrunk.length === 0,
    JSON.stringify(launderedHunks),
  );

  const shrunk = compareDivergence({
    measuredFiles: [
      { file: 'packages/runtime/src/kept.ts', hunks: 1, changedLines: 2 },
    ],
    allowlistFiles: [
      { file: 'packages/runtime/src/kept.ts', hunks: 2, changedLines: 4 },
    ],
  });
  record(
    'budget: shrinking passes and reports a re-shrink hint',
    shrunk.ok && shrunk.shrunk.length === 1,
    JSON.stringify(shrunk.shrunk),
  );

  return { ok: results.every(entry => entry.pass), results };
};

module.exports = {
  CAPPED_PATCH_LINES,
  DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
  DEFAULT_DIVERGENCE_BASE_REF,
  DEFAULT_PATHSPEC,
  DIVERGENCE_FILE_PATTERN,
  DIVERGENCE_SCHEMA_VERSION,
  SELF_TEST_PATCH,
  TWO_BUCKET_RULE,
  assertAllowlistBaseMatches,
  buildDiffArgs,
  checkAllowlistGovernance,
  checkForkDivergence,
  compareDivergence,
  createDivergenceSnapshot,
  formatDivergenceGrowth,
  formatDivergenceReport,
  formatDivergenceViolation,
  measureDivergence,
  parseDivergenceDiff,
  readDivergenceAllowlist,
  runSelfTest,
  serializeDivergenceSnapshot,
  writeDivergenceAllowlist,
};
