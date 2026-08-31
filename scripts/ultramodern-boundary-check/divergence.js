/**
 * Upstream-file divergence guard.
 *
 * The cumulative allowlist keeps one immutable audited identity base and one
 * reviewed upstream provenance commit over one recorded repository-root scope.
 * Verification never accepts caller-selected source identities or a scope
 * subset: the validated allowlist and exact built-in pins are the contract.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIVERGENCE_SCHEMA_VERSION = 2;
const DIVERGENCE_FILE_PATTERN = /^packages\//;
/**
 * Fixed upstream v3.8.2 mainline release commit. The v3.8.2 tag points to a
 * patch-equivalent commit on a side branch and is not an ancestor of HEAD, so
 * the tag must never be substituted for this audited base.
 */
const DEFAULT_DIVERGENCE_BASE_REF = 'eded841256a7cffdaa622e3889fc83407debd3e4';
/**
 * Reviewed upstream source incorporated after the immutable audit point.
 * Exact bytes from this commit are resolution (1), already upstream; fork
 * divergence is measured only on top of this provenance.
 */
const DEFAULT_UPSTREAM_PROVENANCE_REF =
  '2f4d9c4559e26209a0d77f02c6757f29fe3699a2';
const DEFAULT_DIVERGENCE_ALLOWLIST_REPO_PATH =
  'scripts/ultramodern-boundary-check/divergence-allowlist.json';
const DEFAULT_DIVERGENCE_ALLOWLIST_PATH = path.join(
  __dirname,
  'divergence-allowlist.json',
);
const DEFAULT_PATHSPEC = Object.freeze(['packages']);
const FORK_OWNED_PACKAGE_ROOTS = Object.freeze([
  'packages/cli/plugin-bff-extensions',
  'packages/runtime/i18n-extensions',
  'packages/runtime/plugin-tanstack',
  'packages/server/bff-effect',
  'packages/server/runtime-extensions',
  'packages/solutions/app-tools-extensions',
  'packages/toolkit/code-tools',
]);
const DIVERGENCE_LEDGER_REPO_PATH = 'FORK-DIVERGENCE.md';
const CAPPED_PATCH_LINES = 20;
const ALLOWED_LEDGER_DISPOSITIONS = new Set([
  'upstream-PR',
  'extension-point',
  'capped-patch',
  'fixed-in-fork',
  'keep-deleted',
  'keep-[F]',
  'keep-[M]',
  'revert',
  'fix',
  'owner-decision',
]);
const MAX_DIVERGENCE_REPORT_ENTRIES = 20;
const GIT_MAX_BUFFER_BYTES = 512 * 1024 * 1024;
const TWO_BUCKET_RULE = [
  'Every change to an upstream-owned file must land in one of two buckets:',
  '  1. upstream PR - send the change to web-infra-dev/modern.js instead;',
  '  2. extension point - move the behaviour into fork-owned code behind a',
  '     plugin/hook/config seam so the upstream file stops changing.',
  `Only escape hatch: a capped patch of <= ${String(
    CAPPED_PATCH_LINES,
  )} added-plus-removed PR lines per file with a matching`,
  'FORK-DIVERGENCE.md entry explaining why neither bucket applies.',
];

const lexicalCompare = (left, right) => left.localeCompare(right, 'en');
const isPlainObject = value =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const arraysEqual = (left, right) =>
  left.length === right.length &&
  left.every((entry, index) => entry === right[index]);
const pathIsInScope = (file, scope) =>
  file === scope || file.startsWith(`${scope}/`);

const sanitizedGitEnv = () => {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) {
      env[key] = value;
    }
  }
  env.LC_ALL = 'C';
  return env;
};

const runGit = ({
  rootDir,
  args,
  allowFailure = false,
  maxBuffer = GIT_MAX_BUFFER_BYTES,
}) => {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    env: sanitizedGitEnv(),
    maxBuffer,
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

const resolveForkOwnedPackageRoots = baseTreeSet =>
  FORK_OWNED_PACKAGE_ROOTS.filter(
    root => !baseTreeSet.has(`${root}/package.json`),
  );

const sampleDivergenceEntries = entries => {
  if (entries.length <= MAX_DIVERGENCE_REPORT_ENTRIES) {
    return entries;
  }
  const leadingCount = Math.floor((MAX_DIVERGENCE_REPORT_ENTRIES - 1) / 2);
  const trailingCount = MAX_DIVERGENCE_REPORT_ENTRIES - leadingCount - 1;
  return [
    ...entries.slice(0, leadingCount),
    entries[Math.floor((entries.length - 1) / 2)],
    ...entries.slice(-trailingCount),
  ];
};

const canonicalFsPath = value => {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
};

const resolveRepositoryTopLevel = ({
  rootDir = process.cwd(),
  requireTopLevel = true,
} = {}) => {
  const requested = canonicalFsPath(rootDir);
  const output = runGit({
    rootDir: requested,
    args: ['rev-parse', '--show-toplevel'],
  }).trim();
  const topLevel = canonicalFsPath(output);

  if (requireTopLevel && requested !== topLevel) {
    throw new Error(
      `Divergence verification must run from the repository top level ${topLevel}; received nested root ${requested}.`,
    );
  }
  return topLevel;
};

const resolveCommitSha = ({ rootDir, ref }) => {
  if (typeof ref !== 'string' || ref.length === 0) {
    return null;
  }
  const output = runGit({
    rootDir,
    args: ['rev-parse', '--verify', `${ref}^{commit}`],
    allowFailure: true,
  });
  return output === null ? null : output.trim() || null;
};

const resolveRequiredCommitSha = ({ rootDir, ref, label }) => {
  const resolved = resolveCommitSha({ rootDir, ref });
  if (!resolved) {
    throw new Error(`${label} ${String(ref)} does not resolve to a commit.`);
  }
  return resolved;
};

const assertAncestor = ({ rootDir, ancestorRef, descendantRef, label }) => {
  const result = runGit({
    rootDir,
    args: ['merge-base', '--is-ancestor', ancestorRef, descendantRef],
    allowFailure: true,
  });
  if (result === null) {
    throw new Error(
      `${label}: ${ancestorRef} is not an ancestor of ${descendantRef}.`,
    );
  }
};

const getCanonicalDivergenceAllowlistPath = rootDir =>
  path.join(rootDir, ...DEFAULT_DIVERGENCE_ALLOWLIST_REPO_PATH.split('/'));

const validateCanonicalRepoPath = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (value.includes('\\')) {
    throw new Error(`${label} must use POSIX separators: ${value}`);
  }
  if (value.startsWith(':') || /[*?[]/.test(value)) {
    throw new Error(`${label} must be a literal repository path: ${value}`);
  }
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) {
    throw new Error(`${label} is not a canonical repository path: ${value}`);
  }
  const segments = value.split('/');
  if (
    segments.some(
      segment => segment.length === 0 || segment === '.' || segment === '..',
    )
  ) {
    throw new Error(`${label} is not a canonical repository path: ${value}`);
  }
  return value;
};

const validatePathspec = (pathspec, { label = 'Divergence pathspec' } = {}) => {
  if (!Array.isArray(pathspec) || pathspec.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }

  const validated = pathspec.map((entry, index) =>
    validateCanonicalRepoPath(entry, `${label}[${String(index)}]`),
  );
  const seen = new Set();
  for (let index = 0; index < validated.length; index += 1) {
    const entry = validated[index];
    if (seen.has(entry)) {
      throw new Error(`${label} contains duplicate path ${entry}.`);
    }
    seen.add(entry);
    if (index > 0 && lexicalCompare(validated[index - 1], entry) >= 0) {
      throw new Error(`${label} must be uniquely sorted in lexical order.`);
    }
  }

  for (let outer = 0; outer < validated.length; outer += 1) {
    for (let inner = outer + 1; inner < validated.length; inner += 1) {
      if (
        pathIsInScope(validated[inner], validated[outer]) ||
        pathIsInScope(validated[outer], validated[inner])
      ) {
        throw new Error(
          `${label} contains redundant overlapping paths ${validated[outer]} and ${validated[inner]}.`,
        );
      }
    }
  }

  return validated;
};

const listTreePaths = ({ rootDir, baseRef, pathspec }) => {
  const output = runGit({
    rootDir,
    args: ['ls-tree', '-r', '-z', '--name-only', baseRef, '--', ...pathspec],
  });
  return output.split('\0').filter(Boolean);
};

const assertExactKeys = ({ value, expected, label }) => {
  const actual = Object.keys(value).sort(lexicalCompare);
  const sortedExpected = [...expected].sort(lexicalCompare);
  if (!arraysEqual(actual, sortedExpected)) {
    throw new Error(
      `${label} has unsupported keys; expected ${sortedExpected.join(', ')}, received ${actual.join(', ')}.`,
    );
  }
};

const assertSafeBudget = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative safe integer.`);
  }
  return value;
};

const parseAllowlistInput = (input, source) => {
  if (typeof input !== 'string') {
    return input;
  }
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${error.message}`);
  }
};

const validateDivergenceAllowlist = (
  input,
  {
    rootDir = process.cwd(),
    source = 'divergence allowlist',
    allowLegacyProvenance = false,
    identityRef = 'HEAD',
  } = {},
) => {
  const repositoryRoot = resolveRepositoryTopLevel({ rootDir });
  const allowlist = parseAllowlistInput(input, source);
  if (!isPlainObject(allowlist)) {
    throw new Error(`${source} must contain a JSON object.`);
  }

  const legacyProvenance =
    allowLegacyProvenance && allowlist.schemaVersion === 1;
  assertExactKeys({
    value: allowlist,
    expected: [
      'schemaVersion',
      'baseRef',
      ...(legacyProvenance ? [] : ['upstreamRef']),
      'pathspec',
      'migrationGoal',
      'totalFiles',
      'totalHunks',
      'totalChangedLines',
      'files',
    ],
    label: source,
  });

  if (
    allowlist.schemaVersion !== DIVERGENCE_SCHEMA_VERSION &&
    !legacyProvenance
  ) {
    throw new Error(
      `Unsupported divergence allowlist schemaVersion ${String(
        allowlist.schemaVersion,
      )}; expected ${String(DIVERGENCE_SCHEMA_VERSION)}.`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(allowlist.baseRef)) {
    throw new Error(
      `${source} baseRef must be a full lowercase 40-hex commit OID.`,
    );
  }
  const resolvedBase = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref: allowlist.baseRef,
    label: `${source} baseRef`,
  });
  if (resolvedBase !== allowlist.baseRef) {
    throw new Error(`${source} baseRef must record the resolved commit OID.`);
  }
  const upstreamRef = legacyProvenance
    ? allowlist.baseRef
    : allowlist.upstreamRef;
  if (!/^[0-9a-f]{40}$/.test(upstreamRef)) {
    throw new Error(
      `${source} upstreamRef must be a full lowercase 40-hex commit OID.`,
    );
  }
  const resolvedUpstream = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref: upstreamRef,
    label: `${source} upstreamRef`,
  });
  if (resolvedUpstream !== upstreamRef) {
    throw new Error(
      `${source} upstreamRef must record the resolved commit OID.`,
    );
  }
  assertAncestor({
    rootDir: repositoryRoot,
    ancestorRef: resolvedBase,
    descendantRef: resolvedUpstream,
    label: `${source} provenance ancestry mismatch`,
  });
  if (
    typeof allowlist.migrationGoal !== 'string' ||
    allowlist.migrationGoal.trim().length === 0
  ) {
    throw new Error(`${source} migrationGoal must be a non-empty string.`);
  }

  const pathspec = validatePathspec(allowlist.pathspec, {
    label: `${source} pathspec`,
  });
  const baseTreePaths = listTreePaths({
    rootDir: repositoryRoot,
    baseRef: resolvedBase,
    pathspec,
  });
  const upstreamTreePaths = listTreePaths({
    rootDir: repositoryRoot,
    baseRef: resolvedUpstream,
    pathspec,
  });
  const { ownership: provenanceOwnership } = buildProvenanceOwnership({
    rootDir: repositoryRoot,
    auditedBaseRef: resolvedBase,
    upstreamRef: resolvedUpstream,
    pathspec,
  });
  const canonicalIdentities = new Set(provenanceOwnership.values());
  const forkOwnedPackageRoots = resolveForkOwnedPackageRoots(
    new Set(upstreamTreePaths),
  );
  let resolvedIdentityRef;
  const hasPostProvenanceHistory = file => {
    resolvedIdentityRef ??= resolveRequiredCommitSha({
      rootDir: repositoryRoot,
      ref: identityRef,
      label: `${source} identity target`,
    });
    assertAncestor({
      rootDir: repositoryRoot,
      ancestorRef: resolvedUpstream,
      descendantRef: resolvedIdentityRef,
      label: `${source} identity target does not incorporate reviewed provenance`,
    });
    return (
      runGit({
        rootDir: repositoryRoot,
        args: [
          'log',
          '-1',
          '--format=%H',
          `${resolvedUpstream}..${resolvedIdentityRef}`,
          '--',
          file,
        ],
      }).trim().length > 0
    );
  };
  for (const scope of pathspec) {
    if (!baseTreePaths.some(file => pathIsInScope(file, scope))) {
      throw new Error(
        `${source} pathspec entry ${scope} does not match that exact case in the audited base tree.`,
      );
    }
    if (!upstreamTreePaths.some(file => pathIsInScope(file, scope))) {
      throw new Error(
        `${source} pathspec entry ${scope} does not match that exact case in the reviewed upstream tree.`,
      );
    }
  }

  if (!Array.isArray(allowlist.files)) {
    throw new Error(`${source} files must be an array.`);
  }
  const files = [];
  const seenFiles = new Set();
  for (let index = 0; index < allowlist.files.length; index += 1) {
    const entry = allowlist.files[index];
    const label = `${source} files[${String(index)}]`;
    if (!isPlainObject(entry)) {
      throw new Error(`${label} must be an object.`);
    }
    assertExactKeys({
      value: entry,
      expected: ['file', 'hunks', 'changedLines'],
      label,
    });
    const file = validateCanonicalRepoPath(entry.file, `${label}.file`);
    if (seenFiles.has(file)) {
      throw new Error(`${source} contains duplicate file entry ${file}.`);
    }
    if (files.length > 0 && lexicalCompare(files.at(-1).file, file) >= 0) {
      throw new Error(
        `${source} files must be uniquely sorted in lexical order.`,
      );
    }
    if (!pathspec.some(scope => pathIsInScope(file, scope))) {
      throw new Error(
        `${source} file ${file} is outside the recorded pathspec.`,
      );
    }
    if (
      !canonicalIdentities.has(file) &&
      (forkOwnedPackageRoots.some(root => pathIsInScope(file, root)) ||
        !hasPostProvenanceHistory(file))
    ) {
      throw new Error(
        `${source} file ${file} is neither a canonical reviewed-upstream identity nor a governed post-provenance production path derived from audited base ${resolvedBase} and reviewed provenance ${resolvedUpstream}.`,
      );
    }
    seenFiles.add(file);
    files.push({
      file,
      hunks: assertSafeBudget(entry.hunks, `${label}.hunks`),
      changedLines: assertSafeBudget(
        entry.changedLines,
        `${label}.changedLines`,
      ),
    });
  }

  const totals = {
    totalFiles: files.length,
    totalHunks: files.reduce((sum, entry) => sum + entry.hunks, 0),
    totalChangedLines: files.reduce(
      (sum, entry) => sum + entry.changedLines,
      0,
    ),
  };
  for (const key of ['totalFiles', 'totalHunks', 'totalChangedLines']) {
    assertSafeBudget(allowlist[key], `${source} ${key}`);
    if (allowlist[key] !== totals[key]) {
      throw new Error(
        `${source} ${key} mismatch: recorded ${String(
          allowlist[key],
        )}, recomputed ${String(totals[key])}.`,
      );
    }
  }

  return {
    schemaVersion: allowlist.schemaVersion,
    baseRef: resolvedBase,
    ...(legacyProvenance ? {} : { upstreamRef: resolvedUpstream }),
    pathspec,
    migrationGoal: allowlist.migrationGoal,
    ...totals,
    files,
  };
};

const readDivergenceAllowlist = (
  allowlistPath,
  { rootDir = process.cwd() } = {},
) => {
  if (!fs.existsSync(allowlistPath)) {
    throw new Error(`Divergence allowlist does not exist: ${allowlistPath}`);
  }
  return validateDivergenceAllowlist(fs.readFileSync(allowlistPath, 'utf8'), {
    rootDir,
    source: allowlistPath,
  });
};

const readDivergenceAllowlistAtRef = ({
  rootDir,
  ref,
  allowMissing = false,
  allowLegacyProvenance = false,
}) => {
  const repositoryRoot = resolveRepositoryTopLevel({ rootDir });
  const commit = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref,
    label: 'Allowlist ref',
  });
  const objectName = `${commit}:${DEFAULT_DIVERGENCE_ALLOWLIST_REPO_PATH}`;
  const treeMatch = runGit({
    rootDir: repositoryRoot,
    args: [
      'ls-tree',
      '-z',
      '--name-only',
      commit,
      '--',
      DEFAULT_DIVERGENCE_ALLOWLIST_REPO_PATH,
    ],
  })
    .split('\0')
    .filter(Boolean);
  if (!treeMatch.includes(DEFAULT_DIVERGENCE_ALLOWLIST_REPO_PATH)) {
    if (allowMissing) {
      return null;
    }
    throw new Error(
      `${DEFAULT_DIVERGENCE_ALLOWLIST_REPO_PATH} is missing at commit ${commit}.`,
    );
  }
  const contents = runGit({
    rootDir: repositoryRoot,
    args: ['show', objectName],
  });
  return validateDivergenceAllowlist(contents, {
    rootDir: repositoryRoot,
    source: `${DEFAULT_DIVERGENCE_ALLOWLIST_REPO_PATH} at ${commit}`,
    allowLegacyProvenance,
    identityRef: commit,
  });
};

const assertAllowlistBaseMatches = ({
  rootDir,
  baseRef,
  allowlistBaseRef,
  allowlistPath,
  hint,
}) => {
  const resolvedBase = resolveRequiredCommitSha({
    rootDir,
    ref: baseRef,
    label: 'Divergence run base',
  });
  const resolvedAllowlistBase = resolveRequiredCommitSha({
    rootDir,
    ref: allowlistBaseRef,
    label: `${allowlistPath} baseRef`,
  });
  if (resolvedBase === resolvedAllowlistBase) {
    return resolvedBase;
  }
  throw new Error(
    [
      `Divergence base mismatch: run base ${baseRef} (${resolvedBase}) is not the base recorded in ${allowlistPath}: ${allowlistBaseRef} (${resolvedAllowlistBase}).`,
      'Divergence budgets are cumulative counts measured at the recorded upstream base and are meaningless against any other base.',
      hint,
    ]
      .filter(Boolean)
      .join(' '),
  );
};

const assertPathspecMatches = ({ recordedPathspec, requestedPathspec }) => {
  if (requestedPathspec === undefined) {
    return;
  }
  const validated = validatePathspec(requestedPathspec, {
    label: 'Requested divergence pathspec',
  });
  if (!arraysEqual(recordedPathspec, validated)) {
    throw new Error(
      `Divergence scope mismatch: verification must use the recorded pathspec ${JSON.stringify(
        recordedPathspec,
      )}; received ${JSON.stringify(validated)}.`,
    );
  }
};

const buildDiffArgs = ({ baseRef, headRef, pathspec }) => [
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

const buildProvenanceDiffArgs = ({ upstreamRef, headRef, pathspec }) => [
  '-c',
  'core.quotePath=false',
  '-c',
  'diff.algorithm=histogram',
  '-c',
  'diff.indentHeuristic=true',
  'diff',
  '--no-ext-diff',
  '--no-color',
  '-M',
  '--diff-filter=ACDMRT',
  '-U0',
  upstreamRef,
  ...(headRef ? [headRef] : []),
  '--',
  ...pathspec,
];

const stripDiffPathPrefix = value => {
  const trimmed = value.trim();
  if (trimmed === '/dev/null') {
    return null;
  }
  return trimmed.startsWith('a/') || trimmed.startsWith('b/')
    ? trimmed.slice(2)
    : trimmed;
};

const parseHeaderPaths = line => {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match ? { oldPath: match[1], newPath: match[2] } : null;
};

const parsePatchRecords = patchText => {
  const records = [];
  let current = null;
  let inHunk = false;

  const flush = () => {
    if (current) {
      const oldPath = current.added
        ? null
        : (current.oldPath ?? current.headerOldPath);
      const newPath = current.deleted
        ? null
        : (current.newPath ?? current.headerNewPath);
      records.push({
        oldPath,
        newPath,
        hunks: current.hunks,
        addedLines: current.addedLines,
        removedLines: current.removedLines,
        changedLines: current.addedLines + current.removedLines,
        binary: current.binary,
        added: current.added,
        deleted: current.deleted,
        renamed: Boolean(oldPath && newPath && oldPath !== newPath),
      });
    }
    current = null;
  };

  for (const rawLine of patchText.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith('diff --git ')) {
      flush();
      const header = parseHeaderPaths(line);
      current = {
        headerOldPath: header?.oldPath ?? null,
        headerNewPath: header?.newPath ?? null,
        oldPath: null,
        newPath: null,
        hunks: 0,
        addedLines: 0,
        removedLines: 0,
        binary: false,
        added: false,
        deleted: false,
      };
      inHunk = false;
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
      if (line.startsWith('new file mode ')) {
        current.added = true;
      } else if (line.startsWith('deleted file mode ')) {
        current.deleted = true;
      } else if (line.startsWith('--- ')) {
        current.oldPath = stripDiffPathPrefix(line.slice(4));
        current.added ||= current.oldPath === null;
      } else if (line.startsWith('+++ ')) {
        current.newPath = stripDiffPathPrefix(line.slice(4));
        current.deleted ||= current.newPath === null;
      } else if (line.startsWith('rename from ')) {
        current.oldPath = line.slice('rename from '.length);
      } else if (line.startsWith('rename to ')) {
        current.newPath = line.slice('rename to '.length);
      } else if (line.startsWith('Binary files ')) {
        current.binary = true;
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
  return records;
};

const parseDivergenceDiff = (
  patchText,
  { filePattern = DIVERGENCE_FILE_PATTERN, forkOwnedPackageRoots = [] } = {},
) =>
  parsePatchRecords(patchText)
    .filter(record => {
      if (!record.added) {
        return true;
      }
      const file = record.newPath;
      return (
        file !== null &&
        !forkOwnedPackageRoots.some(root => pathIsInScope(file, root))
      );
    })
    .map(record => ({
      file: record.renamed
        ? record.oldPath
        : (record.newPath ?? record.oldPath),
      hunks: record.binary ? Math.max(record.hunks, 1) : record.hunks,
      changedLines: record.binary
        ? Math.max(record.changedLines, 1)
        : record.changedLines,
      addedLines: record.binary
        ? Math.max(record.addedLines, 1)
        : record.addedLines,
      removedLines: record.removedLines,
    }))
    .filter(
      entry => entry.file && (!filePattern || filePattern.test(entry.file)),
    )
    .sort((left, right) => lexicalCompare(left.file, right.file));

const measureDivergence = ({
  rootDir = process.cwd(),
  baseRef = DEFAULT_DIVERGENCE_BASE_REF,
  upstreamRef = baseRef,
  headRef,
  pathspec = DEFAULT_PATHSPEC,
  filePattern = DIVERGENCE_FILE_PATTERN,
} = {}) => {
  const repositoryRoot = resolveRepositoryTopLevel({ rootDir });
  const validatedPathspec = validatePathspec(pathspec);
  const resolvedBase = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref: baseRef,
    label: 'Divergence base',
  });
  const resolvedUpstream = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref: upstreamRef,
    label: 'Reviewed upstream provenance',
  });
  assertAncestor({
    rootDir: repositoryRoot,
    ancestorRef: resolvedBase,
    descendantRef: resolvedUpstream,
    label: 'Reviewed upstream provenance ancestry mismatch',
  });
  const resolvedHead = headRef
    ? resolveRequiredCommitSha({
        rootDir: repositoryRoot,
        ref: headRef,
        label: 'Divergence head',
      })
    : null;
  const comparisonHead =
    resolvedHead ??
    resolveRequiredCommitSha({
      rootDir: repositoryRoot,
      ref: 'HEAD',
      label: 'Divergence worktree HEAD',
    });
  assertAncestor({
    rootDir: repositoryRoot,
    ancestorRef: resolvedUpstream,
    descendantRef: comparisonHead,
    label: 'Reviewed upstream provenance is not incorporated in the target',
  });
  const patchText = runGit({
    rootDir: repositoryRoot,
    args: buildProvenanceDiffArgs({
      upstreamRef: resolvedUpstream,
      headRef: resolvedHead,
      pathspec: validatedPathspec,
    }),
  });
  const { upstreamSet, ownership } = buildProvenanceOwnership({
    rootDir: repositoryRoot,
    auditedBaseRef: resolvedBase,
    upstreamRef: resolvedUpstream,
    pathspec: validatedPathspec,
  });
  const upstreamTreeSet = upstreamSet;
  const forkOwnedPackageRoots = resolveForkOwnedPackageRoots(upstreamTreeSet);
  const grouped = new Map();
  for (const record of parsePatchRecords(patchText)) {
    let identity =
      (record.oldPath && ownership.get(record.oldPath)) ||
      (record.newPath && ownership.get(record.newPath)) ||
      null;
    if (!identity) {
      const file = record.newPath;
      if (
        (!record.added && !record.renamed) ||
        file === null ||
        forkOwnedPackageRoots.some(root => pathIsInScope(file, root))
      ) {
        continue;
      }
      identity = file;
    }
    if (filePattern && !filePattern.test(identity)) {
      continue;
    }
    const current = grouped.get(identity) ?? {
      file: identity,
      hunks: 0,
      changedLines: 0,
      addedLines: 0,
      removedLines: 0,
    };
    current.hunks += record.binary ? Math.max(record.hunks, 1) : record.hunks;
    current.changedLines += record.binary
      ? Math.max(record.changedLines, 1)
      : record.changedLines;
    current.addedLines += record.binary
      ? Math.max(record.addedLines, 1)
      : record.addedLines;
    current.removedLines += record.removedLines;
    grouped.set(identity, current);
  }
  const files = [...grouped.values()]
    .filter(entry => entry.hunks > 0 || entry.changedLines > 0)
    .sort((left, right) => lexicalCompare(left.file, right.file));
  return {
    baseRef: resolvedBase,
    upstreamRef: resolvedUpstream,
    headRef: resolvedHead,
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
  baseRef,
  upstreamRef = baseRef,
  pathspec,
  files = [],
}) => {
  const budgets = [...files]
    .map(entry => ({
      file: entry.file,
      hunks: entry.hunks,
      changedLines: entry.changedLines,
    }))
    .sort((left, right) => lexicalCompare(left.file, right.file));
  return {
    schemaVersion: DIVERGENCE_SCHEMA_VERSION,
    baseRef,
    upstreamRef,
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
const serializeDivergenceSnapshot = snapshot => {
  const inlinePathspec = JSON.stringify(snapshot.pathspec);
  const body = JSON.stringify(
    { ...snapshot, pathspec: PATHSPEC_TOKEN },
    null,
    2,
  );
  return `  "pathspec": ${inlinePathspec},`.length > 80
    ? `${JSON.stringify(snapshot, null, 2)}\n`
    : `${body.replace(`"${PATHSPEC_TOKEN}"`, inlinePathspec)}\n`;
};

const compareDivergence = ({
  measuredFiles = [],
  allowlistFiles = [],
  completeScope = false,
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
      measured.changedLines < allowed.changedLines ||
      measured.hunks < allowed.hunks
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

  const cleared = completeScope
    ? allowlistFiles
        .filter(entry => !measuredByFile.has(entry.file))
        .map(entry => ({
          file: entry.file,
          budgetHunks: entry.hunks,
          budgetChangedLines: entry.changedLines,
          measuredHunks: 0,
          measuredChangedLines: 0,
        }))
    : [];

  return {
    violations: violations.sort(
      (left, right) =>
        right.measuredChangedLines - right.budgetChangedLines ||
        lexicalCompare(left.file, right.file),
    ),
    shrunk,
    cleared,
    ok: violations.length === 0,
  };
};

const checkAllowlistGovernance = ({ baseAllowlist, headAllowlist } = {}) => {
  const introduced = baseAllowlist === null;
  const provenanceModelMigrated =
    !introduced &&
    baseAllowlist.schemaVersion === 1 &&
    headAllowlist.schemaVersion === DIVERGENCE_SCHEMA_VERSION &&
    baseAllowlist.baseRef === DEFAULT_UPSTREAM_PROVENANCE_REF &&
    headAllowlist.baseRef === DEFAULT_DIVERGENCE_BASE_REF &&
    headAllowlist.upstreamRef === DEFAULT_UPSTREAM_PROVENANCE_REF &&
    arraysEqual(baseAllowlist.pathspec, headAllowlist.pathspec) &&
    baseAllowlist.totalFiles === headAllowlist.totalFiles &&
    baseAllowlist.totalHunks === headAllowlist.totalHunks &&
    baseAllowlist.totalChangedLines === headAllowlist.totalChangedLines &&
    JSON.stringify(baseAllowlist.files) === JSON.stringify(headAllowlist.files);
  const reAnchored =
    !introduced &&
    !provenanceModelMigrated &&
    baseAllowlist.baseRef !== headAllowlist.baseRef;
  const provenanceChanged =
    !introduced &&
    !provenanceModelMigrated &&
    baseAllowlist.upstreamRef !== headAllowlist.upstreamRef;
  const scopeChanged =
    !introduced && !arraysEqual(baseAllowlist.pathspec, headAllowlist.pathspec);
  const comparison = introduced
    ? { violations: [] }
    : compareDivergence({
        allowlistFiles: baseAllowlist.files,
        measuredFiles: headAllowlist.files,
      });
  return {
    growth: comparison.violations,
    introduced,
    provenanceModelMigrated,
    reAnchored,
    provenanceChanged,
    scopeChanged,
    transition:
      introduced ||
      provenanceModelMigrated ||
      reAnchored ||
      provenanceChanged ||
      scopeChanged,
    ok:
      comparison.violations.length === 0 &&
      !introduced &&
      !provenanceModelMigrated &&
      !reAnchored &&
      !provenanceChanged &&
      !scopeChanged,
  };
};

const parseNameStatus = output => {
  const tokens = output.split('\0').filter(Boolean);
  const records = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    const oldPath = tokens[index++];
    if (!status || !oldPath) {
      throw new Error('Unexpected truncated git --name-status -z output.');
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      const newPath = tokens[index++];
      if (!newPath) {
        throw new Error('Unexpected truncated git rename record.');
      }
      records.push({ status, oldPath, newPath });
    } else {
      records.push({ status, oldPath, newPath: oldPath });
    }
  }
  return records;
};

function buildProvenanceOwnership({
  rootDir,
  auditedBaseRef,
  upstreamRef,
  pathspec,
}) {
  const auditedPaths = listTreePaths({
    rootDir,
    baseRef: auditedBaseRef,
    pathspec,
  });
  const auditedSet = new Set(auditedPaths);
  const ownership = new Map();
  const upstreamPaths = listTreePaths({
    rootDir,
    baseRef: upstreamRef,
    pathspec,
  });
  if (auditedBaseRef !== upstreamRef) {
    const status = runGit({
      rootDir,
      args: [
        '-c',
        'core.quotePath=false',
        'diff',
        '--name-status',
        '-z',
        '-M',
        auditedBaseRef,
        upstreamRef,
        '--',
        ...pathspec,
      ],
    });
    for (const record of parseNameStatus(status)) {
      if (record.status.startsWith('R') && auditedSet.has(record.oldPath)) {
        ownership.set(record.newPath, record.oldPath);
      }
    }
  }
  for (const file of upstreamPaths) {
    if (!ownership.has(file)) {
      ownership.set(file, file);
    }
  }

  return {
    auditedSet,
    upstreamSet: new Set(upstreamPaths),
    ownership,
  };
}

const buildOwnershipMap = ({
  rootDir,
  auditedBaseRef,
  upstreamRef,
  comparisonRef,
  pathspec,
}) => {
  const { auditedSet, upstreamSet, ownership } = buildProvenanceOwnership({
    rootDir,
    auditedBaseRef,
    upstreamRef,
    pathspec,
  });

  assertAncestor({
    rootDir,
    ancestorRef: upstreamRef,
    descendantRef: comparisonRef,
    label:
      'Reviewed upstream provenance is not incorporated in the governance base',
  });
  if (upstreamRef !== comparisonRef) {
    const status = runGit({
      rootDir,
      args: [
        '-c',
        'core.quotePath=false',
        'diff',
        '--name-status',
        '-z',
        '-M',
        upstreamRef,
        comparisonRef,
        '--',
        ...pathspec,
      ],
    });
    for (const record of parseNameStatus(status)) {
      if (record.status.startsWith('R')) {
        const owner = ownership.get(record.oldPath);
        if (owner) {
          ownership.set(record.newPath, owner);
        }
      }
    }
  }
  const forkOwnedPackageRoots = resolveForkOwnedPackageRoots(upstreamSet);
  for (const file of listTreePaths({
    rootDir,
    baseRef: comparisonRef,
    pathspec,
  })) {
    if (
      !ownership.has(file) &&
      !forkOwnedPackageRoots.some(root => pathIsInScope(file, root))
    ) {
      ownership.set(file, file);
    }
  }
  return {
    upstreamOwnedSet: new Set(ownership.keys()),
    forkOwnedPackageRoots,
    ownership,
  };
};

const metricByFile = files => new Map(files.map(entry => [entry.file, entry]));
const metricByOwner = (files, ownership) => {
  const metrics = new Map();
  for (const entry of files) {
    const owner = ownership.get(entry.file) ?? entry.file;
    const current = metrics.get(owner) ?? { hunks: 0, changedLines: 0 };
    current.hunks += entry.hunks;
    current.changedLines += entry.changedLines;
    metrics.set(owner, current);
  }
  return metrics;
};
const EMPTY_METRIC = Object.freeze({ hunks: 0, changedLines: 0 });
const isGenuineShrink = (before, after) =>
  after.hunks <= before.hunks &&
  after.changedLines <= before.changedLines &&
  (after.hunks < before.hunks || after.changedLines < before.changedLines);

const measureRule5Changes = ({
  rootDir,
  auditedBaseRef,
  upstreamRef,
  mergeBaseRef,
  headRef,
  pathspec,
}) => {
  const { upstreamOwnedSet, forkOwnedPackageRoots, ownership } =
    buildOwnershipMap({
      rootDir,
      auditedBaseRef,
      upstreamRef,
      comparisonRef: mergeBaseRef,
      pathspec,
    });
  const patchText = runGit({
    rootDir,
    args: [
      '-c',
      'core.quotePath=false',
      '-c',
      'diff.algorithm=histogram',
      '-c',
      'diff.indentHeuristic=true',
      'diff',
      '--no-ext-diff',
      '--no-color',
      '-M',
      '--diff-filter=ACDMRT',
      '-U0',
      mergeBaseRef,
      headRef,
      '--',
      ...pathspec,
    ],
  });
  const grouped = new Map();
  for (const record of parsePatchRecords(patchText)) {
    let owner =
      (record.oldPath && ownership.get(record.oldPath)) ||
      (record.newPath && ownership.get(record.newPath)) ||
      (record.oldPath && upstreamOwnedSet.has(record.oldPath)
        ? record.oldPath
        : null) ||
      (record.newPath && upstreamOwnedSet.has(record.newPath)
        ? record.newPath
        : null);
    if (
      !owner &&
      (record.added || record.renamed) &&
      record.newPath &&
      !forkOwnedPackageRoots.some(root => pathIsInScope(record.newPath, root))
    ) {
      owner = record.newPath;
      ownership.set(record.newPath, owner);
    }
    if (!owner) {
      continue;
    }
    if (record.renamed && record.newPath) {
      ownership.set(record.newPath, owner);
    }
    const current = grouped.get(owner) ?? {
      file: owner,
      currentPaths: new Set(),
      addedLines: 0,
      removedLines: 0,
      renamed: false,
      binary: false,
    };
    if (record.newPath) {
      current.currentPaths.add(record.newPath);
    }
    current.addedLines += record.addedLines;
    current.removedLines += record.removedLines;
    current.renamed ||= record.renamed;
    current.binary ||= record.binary;
    grouped.set(owner, current);
  }

  const before = metricByOwner(
    measureDivergence({
      rootDir,
      baseRef: auditedBaseRef,
      upstreamRef,
      headRef: mergeBaseRef,
      pathspec,
    }).files,
    ownership,
  );
  const after = metricByOwner(
    measureDivergence({
      rootDir,
      baseRef: auditedBaseRef,
      upstreamRef,
      headRef,
      pathspec,
    }).files,
    ownership,
  );

  return [...grouped.values()]
    .map(change => {
      const beforeMetric = before.get(change.file) ?? EMPTY_METRIC;
      const afterMetric = after.get(change.file) ?? EMPTY_METRIC;
      return {
        file: change.file,
        ownedPaths: [...ownership.entries()]
          .filter(([, owner]) => owner === change.file)
          .map(([file]) => file)
          .sort(lexicalCompare),
        currentPaths: [...change.currentPaths].sort(lexicalCompare),
        addedLines: change.addedLines,
        removedLines: change.removedLines,
        changedLines: change.binary
          ? CAPPED_PATCH_LINES + 1
          : change.addedLines + change.removedLines,
        renamed: change.renamed,
        binary: change.binary,
        beforeHunks: beforeMetric.hunks,
        beforeChangedLines: beforeMetric.changedLines,
        afterHunks: afterMetric.hunks,
        afterChangedLines: afterMetric.changedLines,
        genuineShrink: isGenuineShrink(beforeMetric, afterMetric),
      };
    })
    .sort((left, right) => lexicalCompare(left.file, right.file));
};

const checkLedgerChanged = ({ rootDir, mergeBaseRef, headRef }) =>
  runGit({
    rootDir,
    args: [
      'diff',
      '--name-only',
      mergeBaseRef,
      headRef,
      '--',
      DIVERGENCE_LEDGER_REPO_PATH,
    ],
  }).trim().length > 0;

const splitMarkdownTableRow = line => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null;
  }
  const cells = [];
  let cell = '';
  let inCode = false;
  let escaped = false;
  for (const character of trimmed.slice(1, -1)) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '`') {
      inCode = !inCode;
      cell += character;
    } else if (character === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped || inCode) {
    return null;
  }
  cells.push(cell.trim());
  return cells;
};

const normalizeLedgerHeader = cell =>
  cell.replace(/[*_`]/g, '').trim().toLowerCase();

const isMarkdownSeparatorRow = cells =>
  cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));

const stripMarkdownCell = cell =>
  cell
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/gu, '')
    .replace(/[`*_]/g, '')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

const isMissingLedgerValue = value =>
  value.length === 0 || /^(?:-|—|none|n\/a)$/iu.test(value);

const parseLedgerDisposition = cell => {
  const tokens = [...cell.matchAll(/`([^`]+)`/g)].map(match => match[1]);
  const invalidTokens = tokens.filter(
    token => !ALLOWED_LEDGER_DISPOSITIONS.has(token),
  );
  const normalizedTokens = [...new Set(tokens)].sort(lexicalCompare);
  const annotationFree = cell
    .replace(/`[^`]+`/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/(?:\s+—\s+|\s+-\s+).*$/u, '')
    .trim();
  return {
    value: normalizedTokens.join(' + '),
    valid:
      tokens.length > 0 &&
      invalidTokens.length === 0 &&
      /^[+/,;\s]*$/u.test(annotationFree),
  };
};

const ledgerEvidenceKey = row =>
  JSON.stringify({
    path: row.path,
    owner: row.owner,
    reason: row.reason,
    disposition: row.disposition,
    problems: row.problems,
  });

const parseLedgerEvidenceRows = contents => {
  const lines = contents.split(/\r?\n/);
  const rows = [];
  let columns = null;
  let awaitingSeparator = false;
  const acceptedPathHeaders = new Set([
    'audited-base-owned path',
    'audited-base-owned path(s)',
    'upstream-owned path',
  ]);

  for (const line of lines) {
    const cells = splitMarkdownTableRow(line);
    if (!cells) {
      columns = null;
      awaitingSeparator = false;
      continue;
    }
    const headers = cells.map(normalizeLedgerHeader);
    const candidateColumns = {
      path: headers.findIndex(header => acceptedPathHeaders.has(header)),
      owner: headers.findIndex(header => header === 'owner'),
      reason: headers.findIndex(header => header.includes('reason')),
      disposition: headers.findIndex(header => header === 'disposition'),
    };
    if (Object.values(candidateColumns).every(index => index >= 0)) {
      columns = candidateColumns;
      awaitingSeparator = true;
      continue;
    }
    if (awaitingSeparator) {
      if (!isMarkdownSeparatorRow(cells)) {
        columns = null;
      }
      awaitingSeparator = false;
      continue;
    }
    if (!columns || isMarkdownSeparatorRow(cells)) {
      continue;
    }
    const maxColumn = Math.max(...Object.values(columns));
    if (cells.length <= maxColumn) {
      continue;
    }
    const pathCell = cells[columns.path];
    const pathMatch = /^`([^`]+)`$/u.exec(pathCell);
    const codePaths = [...pathCell.matchAll(/`([^`]+)`/g)].map(
      match => match[1],
    );
    if (!pathMatch && codePaths.length === 0) {
      continue;
    }
    const pathValue = pathMatch?.[1] ?? codePaths[0];
    const owner = stripMarkdownCell(cells[columns.owner]);
    const reason = stripMarkdownCell(cells[columns.reason]);
    const disposition = parseLedgerDisposition(cells[columns.disposition]);
    const problems = [];
    if (!pathMatch) {
      problems.push('path must be exactly one backticked canonical path');
    } else {
      try {
        validateCanonicalRepoPath(pathValue, 'ledger path');
        if (/[{}]/u.test(pathValue)) {
          problems.push('path must not use grouping syntax');
        } else if (!DIVERGENCE_FILE_PATTERN.test(pathValue)) {
          problems.push('path is outside packages/**');
        }
      } catch {
        problems.push('path is not canonical');
      }
    }
    if (isMissingLedgerValue(owner)) {
      problems.push('owner is missing');
    }
    if (isMissingLedgerValue(reason)) {
      problems.push('reason is missing');
    }
    if (!disposition.valid) {
      problems.push('disposition is missing or invalid');
    }
    const row = {
      raw: line.trimEnd(),
      path: pathValue,
      owner,
      reason,
      disposition: disposition.value,
      problems,
    };
    rows.push({ ...row, key: ledgerEvidenceKey(row) });
  }
  return rows;
};

const collectLedgerEvidence = ({ rootDir, mergeBaseRef, headRef }) => {
  const readLedgerAtRef = ref =>
    runGit({
      rootDir,
      args: ['show', `${ref}:${DIVERGENCE_LEDGER_REPO_PATH}`],
      allowFailure: true,
    }) ?? '';
  const baseRows = parseLedgerEvidenceRows(readLedgerAtRef(mergeBaseRef));
  const headRows = parseLedgerEvidenceRows(readLedgerAtRef(headRef));
  const baseKeys = new Set(baseRows.map(row => row.key));
  const rows = headRows.filter(row => !baseKeys.has(row.key));
  const byFile = new Map();
  for (const row of rows) {
    const candidates = byFile.get(row.path) ?? [];
    candidates.push(row);
    byFile.set(row.path, candidates);
  }
  return { changed: rows.length > 0, rows, byFile };
};

const validateLedgerEvidenceForFile = ({ evidence, file }) => {
  const rows = evidence.byFile.get(file) ?? [];
  if (rows.length === 0) {
    return `Non-shrink upstream-owned change ${file} requires a same-PR strict FORK-DIVERGENCE.md row with the exact path, owner, reason, and disposition.`;
  }
  const valid = rows.filter(row => row.problems.length === 0);
  if (valid.length === 1 && rows.length === 1) {
    return null;
  }
  if (valid.length > 1 || (valid.length === 1 && rows.length > 1)) {
    return `FORK-DIVERGENCE.md has ambiguous duplicate/conflicting same-PR rows for ${file}; exactly one strict row is required.`;
  }
  return `FORK-DIVERGENCE.md row for ${file} is invalid: ${rows
    .flatMap(row => row.problems)
    .filter((problem, index, all) => all.indexOf(problem) === index)
    .join(', ')}.`;
};

const evaluateDivergenceGovernance = ({
  rootDir,
  mergeBaseRef,
  headRef,
  baseAllowlist,
  headAllowlist,
  expectedBaseRef,
  expectedUpstreamRef,
}) => {
  const repositoryRoot = resolveRepositoryTopLevel({ rootDir });
  const mergeBase = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref: mergeBaseRef,
    label: 'Governance merge-base',
  });
  const head = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref: headRef,
    label: 'Governance head',
  });
  const validatedHead = validateDivergenceAllowlist(headAllowlist, {
    rootDir: repositoryRoot,
    source: 'head divergence allowlist',
    identityRef: head,
  });
  if (expectedBaseRef && validatedHead.baseRef !== expectedBaseRef) {
    throw new Error(
      `Canonical audited base mismatch: expected ${expectedBaseRef}, received ${validatedHead.baseRef}.`,
    );
  }
  if (
    expectedUpstreamRef &&
    validatedHead.upstreamRef !== expectedUpstreamRef
  ) {
    throw new Error(
      `Canonical upstream provenance mismatch: expected ${expectedUpstreamRef}, received ${validatedHead.upstreamRef}.`,
    );
  }
  const validatedBase =
    baseAllowlist === null
      ? null
      : validateDivergenceAllowlist(baseAllowlist, {
          rootDir: repositoryRoot,
          source: 'merge-base divergence allowlist',
          allowLegacyProvenance: true,
          identityRef: mergeBase,
        });
  const allowlist = checkAllowlistGovernance({
    baseAllowlist: validatedBase,
    headAllowlist: validatedHead,
  });
  const ledgerChanged = checkLedgerChanged({
    rootDir: repositoryRoot,
    mergeBaseRef: mergeBase,
    headRef: head,
  });
  const ledgerEvidence = collectLedgerEvidence({
    rootDir: repositoryRoot,
    mergeBaseRef: mergeBase,
    headRef: head,
  });
  const rule5Changes = measureRule5Changes({
    rootDir: repositoryRoot,
    auditedBaseRef: validatedHead.baseRef,
    upstreamRef: validatedHead.upstreamRef,
    mergeBaseRef: mergeBase,
    headRef: head,
    pathspec: validatedHead.pathspec,
  });
  const rule5ByFile = new Map();
  for (const change of rule5Changes) {
    for (const file of new Set([
      change.file,
      ...change.ownedPaths,
      ...change.currentPaths,
    ])) {
      rule5ByFile.set(file, change);
    }
  }
  const measuredHead = measureDivergence({
    rootDir: repositoryRoot,
    baseRef: validatedHead.baseRef,
    upstreamRef: validatedHead.upstreamRef,
    headRef: head,
    pathspec: validatedHead.pathspec,
  });
  const measuredByFile = metricByFile(measuredHead.files);
  const comparison = compareDivergence({
    measuredFiles: measuredHead.files,
    allowlistFiles: validatedHead.files,
    completeScope: true,
  });
  const errors = [];
  const ledgerEvidenceChecked = new Set();
  const requireLedgerEvidence = file => {
    if (ledgerEvidenceChecked.has(file)) {
      return;
    }
    ledgerEvidenceChecked.add(file);
    const error = validateLedgerEvidenceForFile({
      evidence: ledgerEvidence,
      file,
    });
    if (error) {
      errors.push(error);
    }
  };

  if (allowlist.reAnchored || allowlist.scopeChanged) {
    errors.push(
      'Audited-base and scope transitions cannot be authorized by unrelated per-file ledger rows; a dedicated identity-preserving transition evidence contract is required.',
    );
  }
  if (
    allowlist.introduced &&
    !rule5Changes.some(change => !change.genuineShrink)
  ) {
    errors.push(
      'Initial allowlist introduction requires an attributable non-shrink package change with its own strict ledger row; unrelated transition prose cannot authorize it.',
    );
  }
  if (allowlist.provenanceChanged) {
    errors.push(
      'Reviewed upstream provenance transitions cannot reset divergence debt; design and review an identity-preserving budget carry-forward before changing upstreamRef.',
    );
  }
  if (comparison.violations.length > 0) {
    errors.push(
      `The committed head allowlist does not cover the committed head measurement (${String(
        comparison.violations.length,
      )} violation(s)).`,
    );
  }

  const requireExactSnapshot =
    allowlist.transition && !allowlist.provenanceModelMigrated;
  if (requireExactSnapshot) {
    const expected = createDivergenceSnapshot({
      baseRef: validatedHead.baseRef,
      upstreamRef: validatedHead.upstreamRef,
      pathspec: validatedHead.pathspec,
      files: measuredHead.files,
    });
    if (
      serializeDivergenceSnapshot(expected) !==
      serializeDivergenceSnapshot(validatedHead)
    ) {
      errors.push(
        'An audited-base/provenance/scope/initial allowlist transition must record the complete committed-head snapshot exactly.',
      );
    }
  } else {
    for (const growth of allowlist.growth) {
      requireLedgerEvidence(growth.file);
      const actual = measuredByFile.get(growth.file);
      if (
        !actual ||
        actual.hunks !== growth.measuredHunks ||
        actual.changedLines !== growth.measuredChangedLines
      ) {
        errors.push(
          `Raised budget for ${growth.file} does not exactly match the committed-head measurement.`,
        );
      }
      const change = rule5ByFile.get(growth.file);
      if (!change) {
        errors.push(
          `Raised budget for ${growth.file} has no upstream-owned PR delta at the governance merge-base.`,
        );
      } else if (change.changedLines > CAPPED_PATCH_LINES) {
        errors.push(
          `Raised budget for ${growth.file} comes from ${String(
            change.changedLines,
          )} added-plus-removed PR lines, exceeding the exact ${String(
            CAPPED_PATCH_LINES,
          )}-line cap.`,
        );
      }
    }
  }

  for (const change of rule5Changes) {
    if (change.genuineShrink) {
      continue;
    }
    requireLedgerEvidence(change.file);
    if (change.changedLines > CAPPED_PATCH_LINES) {
      errors.push(
        `Non-shrink upstream-owned change ${change.file} has ${String(
          change.changedLines,
        )} added-plus-removed PR lines, exceeding the exact ${String(
          CAPPED_PATCH_LINES,
        )}-line cap.`,
      );
    }
  }

  return {
    mergeBase,
    head,
    baseAllowlist: validatedBase,
    headAllowlist: validatedHead,
    allowlist,
    ledgerChanged,
    ledgerEvidence: {
      changed: ledgerEvidence.changed,
      rows: ledgerEvidence.rows,
    },
    rule5Changes,
    measuredHead,
    comparison,
    errors,
    ok: errors.length === 0,
  };
};

const writeSnapshotAtomically = (allowlistPath, snapshot) => {
  fs.mkdirSync(path.dirname(allowlistPath), { recursive: true });
  const temporaryPath = `${allowlistPath}.tmp-${String(process.pid)}`;
  try {
    fs.writeFileSync(
      temporaryPath,
      serializeDivergenceSnapshot(snapshot),
      'utf8',
    );
    fs.renameSync(temporaryPath, allowlistPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
};

const writeDivergenceAllowlist = ({
  rootDir = process.cwd(),
  baseRef,
  upstreamRef,
  headRef,
  mergeBaseRef,
  pathspec,
  filePattern = DIVERGENCE_FILE_PATTERN,
  allowlistPath,
  rebaseAllowlist = false,
  recordGrowth = false,
  expectedBaseRef,
  expectedUpstreamRef,
} = {}) => {
  const repositoryRoot = resolveRepositoryTopLevel({ rootDir });
  const targetPath =
    allowlistPath ?? getCanonicalDivergenceAllowlistPath(repositoryRoot);
  const existingAllowlist = fs.existsSync(targetPath)
    ? readDivergenceAllowlist(targetPath, { rootDir: repositoryRoot })
    : null;

  if (!existingAllowlist && !rebaseAllowlist) {
    throw new Error(
      `Refusing to create ${targetPath} without the explicit --rebase-divergence-allowlist reviewed re-record operation.`,
    );
  }
  const requestedBaseRef =
    baseRef ?? existingAllowlist?.baseRef ?? DEFAULT_DIVERGENCE_BASE_REF;
  if (existingAllowlist && !rebaseAllowlist) {
    assertAllowlistBaseMatches({
      rootDir: repositoryRoot,
      baseRef: requestedBaseRef,
      allowlistBaseRef: existingAllowlist.baseRef,
      allowlistPath: targetPath,
      hint: 'Re-record at the recorded base, or use the reviewed --rebase-divergence-allowlist operation for a real audited-base transition.',
    });
  }

  const requestedPathspec =
    pathspec ?? existingAllowlist?.pathspec ?? DEFAULT_PATHSPEC;
  const validatedPathspec = validatePathspec(requestedPathspec);
  if (
    existingAllowlist &&
    !rebaseAllowlist &&
    !arraysEqual(existingAllowlist.pathspec, validatedPathspec)
  ) {
    throw new Error(
      `Divergence scope mismatch: plain writes must retain ${JSON.stringify(
        existingAllowlist.pathspec,
      )}; use the reviewed --rebase-divergence-allowlist operation for a real scope transition.`,
    );
  }

  const resolvedBase = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref: requestedBaseRef,
    label: 'Divergence writer base',
  });
  const requestedUpstreamRef =
    upstreamRef ??
    (rebaseAllowlist && baseRef ? requestedBaseRef : null) ??
    existingAllowlist?.upstreamRef ??
    resolvedBase;
  const resolvedUpstream = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref: requestedUpstreamRef,
    label: 'Divergence writer upstream provenance',
  });
  if (expectedBaseRef && resolvedBase !== expectedBaseRef) {
    throw new Error(
      `Canonical audited base mismatch: expected ${expectedBaseRef}, received ${resolvedBase}.`,
    );
  }
  if (expectedUpstreamRef && resolvedUpstream !== expectedUpstreamRef) {
    throw new Error(
      `Canonical upstream provenance mismatch: expected ${expectedUpstreamRef}, received ${resolvedUpstream}.`,
    );
  }
  if (existingAllowlist && resolvedUpstream !== existingAllowlist.upstreamRef) {
    throw new Error(
      `Divergence upstream provenance mismatch: writers must retain ${existingAllowlist.upstreamRef}; provenance transitions cannot reset divergence debt and need a separately reviewed identity-preserving carry-forward design.`,
    );
  }
  assertAncestor({
    rootDir: repositoryRoot,
    ancestorRef: resolvedBase,
    descendantRef: resolvedUpstream,
    label: 'Divergence writer upstream provenance ancestry mismatch',
  });
  const measured = measureDivergence({
    rootDir: repositoryRoot,
    baseRef: resolvedBase,
    upstreamRef: resolvedUpstream,
    headRef,
    pathspec: validatedPathspec,
    filePattern,
  });
  const snapshot = createDivergenceSnapshot({
    baseRef: resolvedBase,
    upstreamRef: resolvedUpstream,
    pathspec: validatedPathspec,
    files: measured.files,
  });
  const validatedSnapshot = validateDivergenceAllowlist(snapshot, {
    rootDir: repositoryRoot,
    source: 'candidate divergence allowlist',
  });
  const growth = existingAllowlist
    ? compareDivergence({
        measuredFiles: validatedSnapshot.files,
        allowlistFiles: existingAllowlist.files,
      }).violations
    : validatedSnapshot.files.map(entry => ({
        reason: 'unallowlisted-divergence',
        file: entry.file,
        budgetHunks: 0,
        budgetChangedLines: 0,
        measuredHunks: entry.hunks,
        measuredChangedLines: entry.changedLines,
      }));

  if (growth.length > 0 && !recordGrowth && !rebaseAllowlist) {
    throw new Error(
      [
        `Refusing to write ${targetPath}: divergence budget growth requires the explicit --record-growth operation.`,
        'Offending entries:',
        ...growth.map(formatDivergenceGrowth),
        `The reviewed writer also requires --merge-base, --head, a same-PR ${DIVERGENCE_LEDGER_REPO_PATH} change, and at most ${String(
          CAPPED_PATCH_LINES,
        )} added-plus-removed PR lines per raised file.`,
      ].join('\n'),
    );
  }

  let governance = null;
  if (recordGrowth || rebaseAllowlist) {
    if (
      canonicalFsPath(targetPath) !==
      canonicalFsPath(getCanonicalDivergenceAllowlistPath(repositoryRoot))
    ) {
      throw new Error(
        'Reviewed growth/re-record operations may write only the canonical repository divergence allowlist.',
      );
    }
    if (!mergeBaseRef || !headRef) {
      throw new Error(
        'Reviewed growth/re-record operations require both --merge-base <commit> and --head <commit>.',
      );
    }
    const mergeBase = resolveRequiredCommitSha({
      rootDir: repositoryRoot,
      ref: mergeBaseRef,
      label: 'Writer merge-base',
    });
    const head = resolveRequiredCommitSha({
      rootDir: repositoryRoot,
      ref: headRef,
      label: 'Writer head',
    });
    if (measured.headRef !== head) {
      throw new Error(
        'Reviewed writes must measure the exact resolved --head commit.',
      );
    }
    const baseAtMerge = readDivergenceAllowlistAtRef({
      rootDir: repositoryRoot,
      ref: mergeBase,
      allowMissing: true,
      allowLegacyProvenance: true,
    });
    governance = evaluateDivergenceGovernance({
      rootDir: repositoryRoot,
      mergeBaseRef: mergeBase,
      headRef: head,
      baseAllowlist: baseAtMerge,
      headAllowlist: validatedSnapshot,
      expectedBaseRef,
      expectedUpstreamRef,
    });
    if (!governance.ok) {
      throw new Error(
        [
          `Refusing reviewed divergence allowlist write:`,
          ...governance.errors.map(error => `- ${error}`),
        ].join('\n'),
      );
    }
  }

  writeSnapshotAtomically(targetPath, validatedSnapshot);
  return {
    ...measured,
    allowlistPath: targetPath,
    growth,
    governance,
    snapshot: validatedSnapshot,
  };
};

const checkForkDivergence = ({
  rootDir = process.cwd(),
  baseRef,
  upstreamRef,
  headRef,
  pathspec,
  allowlistPath,
} = {}) => {
  const repositoryRoot = resolveRepositoryTopLevel({ rootDir });
  const canonicalAllowlist =
    allowlistPath ?? getCanonicalDivergenceAllowlistPath(repositoryRoot);
  const allowlist = readDivergenceAllowlist(canonicalAllowlist, {
    rootDir: repositoryRoot,
  });
  assertPathspecMatches({
    recordedPathspec: allowlist.pathspec,
    requestedPathspec: pathspec,
  });
  const resolvedBase = assertAllowlistBaseMatches({
    rootDir: repositoryRoot,
    baseRef: baseRef ?? allowlist.baseRef,
    allowlistBaseRef: allowlist.baseRef,
    allowlistPath: canonicalAllowlist,
    hint: 'Use the recorded base; use --head to select a committed target tree.',
  });
  const resolvedUpstream = resolveRequiredCommitSha({
    rootDir: repositoryRoot,
    ref: upstreamRef ?? allowlist.upstreamRef,
    label: 'Divergence run upstream provenance',
  });
  if (resolvedUpstream !== allowlist.upstreamRef) {
    throw new Error(
      `Divergence upstream provenance mismatch: run provenance ${resolvedUpstream} is not the reviewed provenance recorded in ${canonicalAllowlist}: ${allowlist.upstreamRef}.`,
    );
  }
  const measured = measureDivergence({
    rootDir: repositoryRoot,
    baseRef: resolvedBase,
    upstreamRef: resolvedUpstream,
    headRef,
    pathspec: allowlist.pathspec,
    filePattern: DIVERGENCE_FILE_PATTERN,
  });
  const comparison = compareDivergence({
    measuredFiles: measured.files,
    allowlistFiles: allowlist.files,
    completeScope: true,
  });
  const violationCount = comparison.violations.length;
  const shrunkCount = comparison.shrunk.length;
  const clearedCount = comparison.cleared.length;
  return {
    baseRef: resolvedBase,
    upstreamRef: measured.upstreamRef,
    headRef: measured.headRef,
    pathspec: allowlist.pathspec,
    allowlistPath: canonicalAllowlist,
    measuredFiles: measured.totalFiles,
    measuredHunks: measured.totalHunks,
    measuredChangedLines: measured.totalChangedLines,
    allowlistFiles: allowlist.totalFiles,
    allowlistChangedLines: allowlist.totalChangedLines,
    violationCount,
    shrunkCount,
    clearedCount,
    violations: sampleDivergenceEntries(comparison.violations),
    shrunk: sampleDivergenceEntries(comparison.shrunk),
    cleared: sampleDivergenceEntries(comparison.cleared),
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
  )} hunks / ${String(violation.measuredChangedLines)} lines (${violation.reason})`;
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
    ? `${report.upstreamRef ?? report.baseRef}..${report.headRef}`
    : `${report.upstreamRef ?? report.baseRef}..worktree`;
  const lines = [
    `[ultramodern-divergence] audited ownership at ${report.baseRef}; diffed reviewed upstream provenance ${range} over recorded scope ${JSON.stringify(
      report.pathspec ?? DEFAULT_PATHSPEC,
    )}`,
    `[ultramodern-divergence] measured=${String(
      report.measuredFiles,
    )} files / ${String(report.measuredHunks)} hunks / ${String(
      report.measuredChangedLines,
    )} lines; allowlist=${String(report.allowlistFiles)} files / ${String(
      report.allowlistChangedLines,
    )} lines; violations=${String(
      report.violationCount ?? report.violations.length,
    )}`,
  ];
  const violationCount = report.violationCount ?? report.violations.length;
  if (violationCount > 0) {
    lines.push(
      '',
      'Fork divergence grew inside upstream-owned files:',
      ...report.violations.map(formatDivergenceViolation),
      ...(violationCount > report.violations.length
        ? [
            `- ... ${String(
              violationCount - report.violations.length,
            )} additional violation(s) omitted from this bounded sample`,
          ]
        : []),
      '',
      ...TWO_BUCKET_RULE,
    );
  }
  if (violationCount === 0 && report.shrunk.length > 0) {
    lines.push(
      '',
      `Divergence shrank in ${String(
        report.shrunk.length,
      )} file(s); re-run with --write-divergence-allowlist to lock in the smaller budget:`,
      ...report.shrunk.slice(0, 20).map(formatShrinkHint),
    );
  }
  if (report.cleared.length > 0) {
    lines.push(
      '',
      `${String(
        report.cleared.length,
      )} fully measured allowlisted file(s) no longer diverge; drop their entries with --write-divergence-allowlist:`,
      ...report.cleared.slice(0, 20).map(entry => `- ${entry.file}`),
    );
  }
  if (violationCount === 0) {
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

const runSelfTest = () => {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });
  const parsed = parseDivergenceDiff(SELF_TEST_PATCH);
  const byFile = new Map(parsed.map(entry => [entry.file, entry]));
  record(
    'parser: every upstream-owned package file is counted',
    parsed.length === 3 &&
      byFile.has('packages/runtime/src/kept.ts') &&
      byFile.has('packages/runtime/src/removed.ts') &&
      byFile.has('packages/runtime/src/skipped.md'),
    parsed.map(entry => entry.file).join(','),
  );
  const kept = byFile.get('packages/runtime/src/kept.ts');
  record(
    'parser: hunk and changed-line counts exclude diff headers',
    Boolean(kept) &&
      kept.hunks === 2 &&
      kept.addedLines === 3 &&
      kept.removedLines === 1 &&
      kept.changedLines === 4,
    JSON.stringify(kept),
  );
  const removed = byFile.get('packages/runtime/src/removed.ts');
  record(
    'parser: deleted upstream file resolves its old path',
    Boolean(removed) && removed.hunks === 1 && removed.changedLines === 2,
    JSON.stringify(removed),
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
    green.ok,
    JSON.stringify(green),
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
    'budget: line growth fails',
    !grown.ok && grown.violations[0]?.reason === 'line-budget-exceeded',
    JSON.stringify(grown),
  );
  const newFile = compareDivergence({
    measuredFiles: parsed,
    allowlistFiles: budget.filter(
      entry => entry.file !== 'packages/runtime/src/removed.ts',
    ),
  });
  record(
    'budget: unallowlisted upstream divergence fails',
    !newFile.ok && newFile.violations[0]?.reason === 'unallowlisted-divergence',
    JSON.stringify(newFile),
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
    'budget: equal-line hunk growth fails',
    !extraHunk.ok && extraHunk.violations[0]?.reason === 'hunk-budget-exceeded',
    JSON.stringify(extraHunk),
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
    'budget: componentwise shrink passes',
    shrunk.ok && shrunk.shrunk.length === 1,
    JSON.stringify(shrunk),
  );
  const partial = compareDivergence({
    measuredFiles: [],
    allowlistFiles: budget,
  });
  record(
    'budget: incomplete measurements never claim clears',
    partial.cleared.length === 0,
    JSON.stringify(partial),
  );
  return { ok: results.every(entry => entry.pass), results };
};

module.exports = {
  CAPPED_PATCH_LINES,
  DEFAULT_DIVERGENCE_ALLOWLIST_PATH,
  DEFAULT_DIVERGENCE_ALLOWLIST_REPO_PATH,
  DEFAULT_DIVERGENCE_BASE_REF,
  DEFAULT_UPSTREAM_PROVENANCE_REF,
  DEFAULT_PATHSPEC,
  DIVERGENCE_FILE_PATTERN,
  DIVERGENCE_LEDGER_REPO_PATH,
  DIVERGENCE_SCHEMA_VERSION,
  FORK_OWNED_PACKAGE_ROOTS,
  SELF_TEST_PATCH,
  TWO_BUCKET_RULE,
  assertAllowlistBaseMatches,
  assertPathspecMatches,
  buildDiffArgs,
  checkAllowlistGovernance,
  checkForkDivergence,
  checkLedgerChanged,
  compareDivergence,
  createDivergenceSnapshot,
  evaluateDivergenceGovernance,
  formatDivergenceGrowth,
  formatDivergenceReport,
  formatDivergenceViolation,
  getCanonicalDivergenceAllowlistPath,
  measureDivergence,
  measureRule5Changes,
  parseDivergenceDiff,
  parseLedgerEvidenceRows,
  readDivergenceAllowlist,
  readDivergenceAllowlistAtRef,
  resolveCommitSha,
  resolveRepositoryTopLevel,
  runSelfTest,
  serializeDivergenceSnapshot,
  validateDivergenceAllowlist,
  validatePathspec,
  writeDivergenceAllowlist,
};
