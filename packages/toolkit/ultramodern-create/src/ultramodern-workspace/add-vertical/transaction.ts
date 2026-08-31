import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ignoredSnapshotDirectories } from '../generation-result';
import { normalizePath } from '../naming';

type WorkspaceFile = {
  content: Buffer;
  mode: number;
};

type WorkspaceSnapshot = Map<string, WorkspaceFile>;

type WorkspaceChange = {
  relativePath: string;
  before?: WorkspaceFile;
  after?: WorkspaceFile;
};

type PreparedChange = WorkspaceChange & {
  preserveRollback?: boolean;
  preservedPaths?: string[];
  published: boolean;
  publishPath?: string;
  rollbackPath?: string;
};

type FreshWorkspaceTarget =
  | { kind: 'absent'; mode: number }
  | { kind: 'empty'; dev: number; ino: number; mode: number };

export class WorkspaceTransactionConflictError extends Error {
  readonly code = 'workspace-transaction-conflict' as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkspaceTransactionConflictError';
  }
}

/** Deterministic fault/concurrency seams used only by focused tests. */
export const __transactionTestHooks: {
  beforePublish?: (details: {
    workspaceRoot: string;
    stagingRoot: string;
    changedPaths: readonly string[];
  }) => void;
  beforePublishPath?: (details: {
    workspaceRoot: string;
    relativePath: string;
    index: number;
  }) => void;
  afterPreimageCheck?: (details: {
    workspaceRoot: string;
    relativePath: string;
  }) => void;
  beforeFreshPublish?: (details: { workspaceRoot: string }) => void;
} = {};

function isIgnoredRelativePath(relativePath: string): boolean {
  return normalizePath(relativePath)
    .split('/')
    .some(segment => ignoredSnapshotDirectories.has(segment));
}

function walkWorkspaceFiles(
  root: string,
  onFile: (relativePath: string, absolutePath: string) => void,
): void {
  if (!fs.existsSync(root)) {
    return;
  }

  const collect = (currentDir: string) => {
    for (const entry of fs
      .readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(currentDir, entry.name);
      const relativePath = normalizePath(path.relative(root, entryPath));
      if (isIgnoredRelativePath(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        collect(entryPath);
      } else if (entry.isFile()) {
        onFile(relativePath, entryPath);
      } else {
        throw new WorkspaceTransactionConflictError(
          `Staged workspace contains an unsupported link or special file: ${relativePath}`,
        );
      }
    }
  };

  collect(root);
}

function captureWorkspace(root: string): WorkspaceSnapshot {
  const files: WorkspaceSnapshot = new Map();
  walkWorkspaceFiles(root, (relativePath, absolutePath) => {
    const stat = fs.statSync(absolutePath);
    files.set(relativePath, {
      content: fs.readFileSync(absolutePath),
      mode: stat.mode & 0o777,
    });
  });
  return files;
}

function sameFile(
  left: WorkspaceFile | undefined,
  right: WorkspaceFile | undefined,
) {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.mode === right.mode && left.content.equals(right.content);
}

function buildChangePlan(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): WorkspaceChange[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap(relativePath => {
      const previous = before.get(relativePath);
      const next = after.get(relativePath);
      return sameFile(previous, next)
        ? []
        : [{ relativePath, before: previous, after: next }];
    });
}

function createTemporarySibling(root: string): string {
  const absoluteRoot = path.resolve(root);
  const parent = path.dirname(absoluteRoot);
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(
    path.join(parent, `.${path.basename(absoluteRoot)}.ultramodern-stage-`),
  );
}

function removeOwnedTemporaryDirectory(
  temporaryRoot: string,
  identity: { dev: number; ino: number },
): void {
  let current: fs.Stats;
  try {
    current = fs.lstatSync(temporaryRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new WorkspaceTransactionConflictError(
      `Owned staging path was replaced before cleanup: ${temporaryRoot}`,
    );
  }
  fs.rmSync(temporaryRoot, { force: true, recursive: true });
}

function cleanOwnedTemporaryDirectory(
  temporaryRoot: string,
  identity: { dev: number; ino: number },
): void {
  try {
    removeOwnedTemporaryDirectory(temporaryRoot, identity);
  } catch (error) {
    // Publication already has its own success/failure result. A best-effort
    // cleanup failure must not invalidate valid output or replace that error.
    process.emitWarning(
      `UltraModern temporary workspace cleanup failed for ${temporaryRoot}: ${String(
        error,
      )}`,
      { code: 'ULTRAMODERN_TEMP_CLEANUP_FAILED' },
    );
  }
}

function inspectFreshTarget(targetDir: string): FreshWorkspaceTarget {
  try {
    const stat = fs.lstatSync(targetDir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      fs.readdirSync(targetDir).length > 0
    ) {
      throw new WorkspaceTransactionConflictError(
        `Refusing to replace existing workspace target: ${targetDir}`,
      );
    }
    return {
      kind: 'empty',
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode & 0o777,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'absent', mode: 0o777 & ~process.umask() };
    }
    throw error;
  }
}

function assertFreshTarget(
  targetDir: string,
  expected: FreshWorkspaceTarget,
): void {
  const current = inspectFreshTarget(targetDir);
  if (expected.kind === 'absent') {
    if (current.kind !== 'absent') {
      throw new WorkspaceTransactionConflictError(
        `Workspace target appeared during generation: ${targetDir}`,
      );
    }
    return;
  }
  if (
    current.kind !== 'empty' ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw new WorkspaceTransactionConflictError(
      `Workspace target changed during generation: ${targetDir}`,
    );
  }
}

function publishFileExclusive(sourcePath: string, targetPath: string): void {
  try {
    fs.linkSync(sourcePath, targetPath);
  } catch (error) {
    if (
      !['EPERM', 'EOPNOTSUPP', 'ENOTSUP', 'EXDEV'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    ) {
      throw error;
    }
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  }
}

function copyWorkspaceToStage(root: string, stagingRoot: string): void {
  fs.cpSync(root, stagingRoot, {
    mode: fs.constants.COPYFILE_FICLONE,
    recursive: true,
    filter(sourcePath) {
      const relativePath = path.relative(root, sourcePath);
      if (relativePath === '') {
        return true;
      }
      if (isIgnoredRelativePath(relativePath)) {
        return false;
      }
      // A preserved symlink would still point outside the private stage. Any
      // generator write through it could mutate the live workspace (or an
      // external tree) before publication. Leave links out of the stage; an
      // owned output beneath one then fails at the live-parent check.
      return !fs.lstatSync(sourcePath).isSymbolicLink();
    },
  });
}

function replaceBuffer(
  content: Buffer,
  search: Buffer,
  replacement: Buffer,
): Buffer {
  const chunks: Buffer[] = [];
  let from = 0;
  let index = content.indexOf(search, from);
  while (index !== -1) {
    chunks.push(content.subarray(from, index), replacement);
    from = index + search.length;
    index = content.indexOf(search, from);
  }
  chunks.push(content.subarray(from));
  return Buffer.concat(chunks);
}

/**
 * Overlays may persist their physical workspace root. The staged directory is
 * moved after they finish, so relocate those exact references before planning
 * or publishing; leaving a private temporary path in generated output would be
 * observably wrong after a successful transaction.
 */
export function relocateStagedWorkspaceReferences(
  stagingRoot: string,
  workspaceRoot: string,
): void {
  const stagedPath = Buffer.from(stagingRoot);
  const publishedPath = Buffer.from(workspaceRoot);
  walkWorkspaceFiles(stagingRoot, (_relativePath, absolutePath) => {
    const content = fs.readFileSync(absolutePath);
    if (!content.includes(stagedPath)) {
      return;
    }
    fs.writeFileSync(
      absolutePath,
      replaceBuffer(content, stagedPath, publishedPath),
    );
  });
}

function readWorkspaceFile(
  root: string,
  relativePath: string,
): WorkspaceFile | undefined {
  return readFilePath(path.join(root, relativePath), relativePath);
}

function readFilePath(
  absolutePath: string,
  displayPath: string,
): WorkspaceFile | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new WorkspaceTransactionConflictError(
      `Workspace target changed type during generation: ${displayPath}`,
    );
  }
  return {
    content: fs.readFileSync(absolutePath),
    mode: stat.mode & 0o777,
  };
}

function assertPreimage(root: string, change: WorkspaceChange): void {
  if (!sameFile(readWorkspaceFile(root, change.relativePath), change.before)) {
    throw new WorkspaceTransactionConflictError(
      `Workspace target changed during generation: ${change.relativePath}`,
    );
  }
}

function ensureOwnedParentDirectories(
  root: string,
  relativePath: string,
  createdDirectories: string[],
): void {
  const segments = relativePath.split('/').slice(0, -1);
  let currentPath = root;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    try {
      const stat = fs.lstatSync(currentPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new WorkspaceTransactionConflictError(
          `Workspace parent changed type during generation: ${normalizePath(
            path.relative(root, currentPath),
          )}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      try {
        fs.mkdirSync(currentPath);
        createdDirectories.push(currentPath);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw mkdirError;
        }
        const stat = fs.lstatSync(currentPath);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new WorkspaceTransactionConflictError(
            `Workspace parent changed type during generation: ${normalizePath(
              path.relative(root, currentPath),
            )}`,
          );
        }
      }
    }
  }
}

function temporaryFilePath(root: string, relativePath: string, role: string) {
  const targetPath = path.join(root, relativePath);
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.ultramodern-${role}-${randomUUID()}.tmp`,
  );
}

function writeTemporaryFile(filePath: string, file: WorkspaceFile): void {
  fs.writeFileSync(filePath, file.content, {
    flag: 'wx',
    mode: file.mode,
  });
}

function removeIfPresent(filePath: string | undefined): void {
  if (!filePath) {
    return;
  }
  try {
    fs.rmSync(filePath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function prepareChanges(
  root: string,
  changes: WorkspaceChange[],
  createdDirectories: string[],
  preparedChanges: PreparedChange[],
): void {
  for (const change of changes) {
    ensureOwnedParentDirectories(root, change.relativePath, createdDirectories);
    const prepared: PreparedChange = { ...change, published: false };
    preparedChanges.push(prepared);
    if (change.after) {
      prepared.publishPath = temporaryFilePath(
        root,
        change.relativePath,
        'publish',
      );
      writeTemporaryFile(prepared.publishPath, change.after);
    }
    if (change.before) {
      prepared.rollbackPath = temporaryFilePath(
        root,
        change.relativePath,
        change.after ? 'rollback' : 'removed',
      );
    }
  }
}

function assertPublishedState(root: string, change: WorkspaceChange): void {
  if (!sameFile(readWorkspaceFile(root, change.relativePath), change.after)) {
    throw new WorkspaceTransactionConflictError(
      `Workspace target changed while rolling back generation: ${change.relativePath}`,
    );
  }
}

function rollbackPublishedChanges(
  root: string,
  preparedChanges: PreparedChange[],
): void {
  for (const change of [...preparedChanges].reverse()) {
    if (!change.published) {
      continue;
    }
    if (change.rollbackPath) {
      // From this point on the rollback temp is the only durable preimage.
      // Never let generic cleanup discard it unless restoration succeeds.
      change.preserveRollback = true;
    }
    assertPublishedState(root, change);
    const targetPath = path.join(root, change.relativePath);
    if (change.before === undefined) {
      const discardedPath = quarantinePublishedFile(root, change, targetPath);
      removeIfPresent(discardedPath);
      if (fs.existsSync(targetPath)) {
        throw new WorkspaceTransactionConflictError(
          `Workspace target changed while rolling back generation: ${change.relativePath}`,
        );
      }
    } else if (change.after === undefined) {
      if (!change.rollbackPath) {
        throw new WorkspaceTransactionConflictError(
          `Workspace deletion could not be rolled back: ${change.relativePath}`,
        );
      }
      try {
        publishFileExclusive(change.rollbackPath, targetPath);
      } catch (error) {
        throw new WorkspaceTransactionConflictError(
          `Workspace deletion could not be rolled back; prior bytes are preserved at ${change.rollbackPath}`,
          { cause: error },
        );
      }
      removeIfPresent(change.rollbackPath);
      change.rollbackPath = undefined;
      change.preserveRollback = false;
    } else {
      if (!change.rollbackPath) {
        throw new WorkspaceTransactionConflictError(
          `Workspace replacement could not be rolled back: ${change.relativePath}`,
        );
      }
      const discardedPath = quarantinePublishedFile(root, change, targetPath);
      try {
        publishFileExclusive(change.rollbackPath, targetPath);
      } catch (error) {
        removeIfPresent(discardedPath);
        throw new WorkspaceTransactionConflictError(
          `Workspace replacement could not be rolled back; prior bytes are preserved at ${change.rollbackPath}`,
          { cause: error },
        );
      }
      removeIfPresent(discardedPath);
      removeIfPresent(change.rollbackPath);
      change.rollbackPath = undefined;
      change.preserveRollback = false;
    }
  }
}

function preservePath(change: PreparedChange, filePath: string): void {
  change.preservedPaths ??= [];
  change.preservedPaths.push(filePath);
}

function quarantinePublishedFile(
  root: string,
  change: PreparedChange,
  targetPath: string,
): string {
  const discardedPath = temporaryFilePath(root, change.relativePath, 'discard');
  fs.renameSync(targetPath, discardedPath);
  let matches = false;
  try {
    matches = sameFile(
      readFilePath(discardedPath, change.relativePath),
      change.after,
    );
  } catch {
    matches = false;
  }
  if (matches) {
    return discardedPath;
  }
  if (!restoreQuarantinedPath(discardedPath, targetPath)) {
    preservePath(change, discardedPath);
    throw new WorkspaceTransactionConflictError(
      `Workspace target changed while rolling back generation; moved bytes are preserved at ${discardedPath}`,
    );
  }
  throw new WorkspaceTransactionConflictError(
    `Workspace target changed while rolling back generation: ${change.relativePath}`,
  );
}

function cleanupPreparedChanges(
  preparedChanges: PreparedChange[],
  createdDirectories: string[],
): void {
  for (const change of preparedChanges) {
    removeIfPresent(change.publishPath);
    if (!change.preserveRollback) {
      removeIfPresent(change.rollbackPath);
    }
  }
  for (const directory of [...createdDirectories].reverse()) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      // Keep non-empty directories: they contain either published output or a
      // concurrent unrelated file and therefore are not transaction garbage.
      if (
        !['ENOENT', 'ENOTEMPTY'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      ) {
        throw error;
      }
    }
  }
}

function cleanPreparedChanges(
  preparedChanges: PreparedChange[],
  createdDirectories: string[],
): void {
  try {
    cleanupPreparedChanges(preparedChanges, createdDirectories);
  } catch {
    // Cleanup cannot overturn an already-determined semantic result.
  }
}

function restoreQuarantinedPath(
  quarantinePath: string,
  targetPath: string,
): boolean {
  try {
    const moved = fs.lstatSync(quarantinePath);
    if (moved.isFile()) {
      // The quarantine and target live on the same filesystem. A hard link is
      // an exclusive restore for regular files: it never overwrites a path a
      // concurrent writer created after we moved the target aside.
      fs.linkSync(quarantinePath, targetPath);
    } else if (moved.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(quarantinePath), targetPath);
    } else {
      return false;
    }
    removeIfPresent(quarantinePath);
    return true;
  } catch {
    return false;
  }
}

function restoreQuarantinedPreimage(
  change: PreparedChange,
  targetPath: string,
): boolean {
  if (
    !change.rollbackPath ||
    !restoreQuarantinedPath(change.rollbackPath, targetPath)
  ) {
    change.preserveRollback = true;
    return false;
  }
  change.rollbackPath = undefined;
  return true;
}

function publishChange(root: string, change: PreparedChange): void {
  assertPreimage(root, change);
  __transactionTestHooks.afterPreimageCheck?.({
    workspaceRoot: root,
    relativePath: change.relativePath,
  });
  const targetPath = path.join(root, change.relativePath);
  if (change.before === undefined) {
    if (!change.publishPath) {
      throw new Error(`Missing staged output for ${change.relativePath}`);
    }
    // Hard-linking is an atomic no-clobber publication for newly-created files.
    publishFileExclusive(change.publishPath, targetPath);
    removeIfPresent(change.publishPath);
    change.publishPath = undefined;
  } else {
    if (!change.rollbackPath) {
      throw new Error(`Missing rollback path for ${change.relativePath}`);
    }
    fs.renameSync(targetPath, change.rollbackPath);
    let quarantinedFile: WorkspaceFile | undefined;
    try {
      quarantinedFile = readFilePath(change.rollbackPath, change.relativePath);
    } catch {
      const quarantinePath = change.rollbackPath;
      const restored = restoreQuarantinedPreimage(change, targetPath);
      throw new WorkspaceTransactionConflictError(
        restored
          ? `Workspace target changed type during generation: ${change.relativePath}`
          : `Workspace target changed type during generation; moved bytes are preserved at ${quarantinePath}`,
      );
    }
    if (!sameFile(quarantinedFile, change.before)) {
      const quarantinePath = change.rollbackPath;
      const restored = restoreQuarantinedPreimage(change, targetPath);
      throw new WorkspaceTransactionConflictError(
        restored
          ? `Workspace target changed during generation: ${change.relativePath}`
          : `Workspace target changed during generation; concurrent bytes are preserved at ${quarantinePath}`,
      );
    }
    if (change.after) {
      if (!change.publishPath) {
        throw new Error(`Missing staged output for ${change.relativePath}`);
      }
      try {
        // Publish without replacing a path a concurrent writer created after
        // the exact preimage was moved aside and verified.
        publishFileExclusive(change.publishPath, targetPath);
      } catch (error) {
        const quarantinePath = change.rollbackPath;
        const restored = restoreQuarantinedPreimage(change, targetPath);
        throw new WorkspaceTransactionConflictError(
          restored
            ? `Workspace target changed during generation: ${change.relativePath}`
            : `Workspace target changed during generation; prior bytes are preserved at ${quarantinePath}`,
          { cause: error },
        );
      }
      removeIfPresent(change.publishPath);
      change.publishPath = undefined;
    }
  }
  change.published = true;
}

function publishChangePlan(
  root: string,
  stagingRoot: string,
  changes: WorkspaceChange[],
) {
  __transactionTestHooks.beforePublish?.({
    workspaceRoot: root,
    stagingRoot,
    changedPaths: changes.map(change => change.relativePath),
  });

  for (const change of changes) {
    assertPreimage(root, change);
  }

  const createdDirectories: string[] = [];
  const preparedChanges: PreparedChange[] = [];
  try {
    prepareChanges(root, changes, createdDirectories, preparedChanges);
    for (const change of preparedChanges) {
      assertPreimage(root, change);
    }
    preparedChanges.forEach((change, index) => {
      __transactionTestHooks.beforePublishPath?.({
        workspaceRoot: root,
        relativePath: change.relativePath,
        index,
      });
      publishChange(root, change);
    });
  } catch (error) {
    try {
      rollbackPublishedChanges(root, preparedChanges);
    } catch (rollbackError) {
      throw new WorkspaceTransactionConflictError(
        'Workspace transaction failed and concurrent target changes prevented a safe rollback.',
        { cause: rollbackError },
      );
    } finally {
      cleanPreparedChanges(preparedChanges, createdDirectories);
    }
    throw error;
  }
  cleanPreparedChanges(preparedChanges, []);
}

/**
 * Run an existing-workspace mutation against a private sibling. Only the
 * semantic file changes produced there are published, and every owned target
 * must still match its exact preimage. Unrelated workspace files are never
 * copied back, so concurrent consumer work is conserved without a lock.
 */
export function runWorkspaceTransaction<T>(
  root: string,
  mutate: (stagingRoot: string) => T,
): T {
  const workspaceRoot = fs.realpathSync.native(path.resolve(root));
  if (!fs.statSync(workspaceRoot).isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${root}`);
  }
  const stagingRoot = createTemporarySibling(workspaceRoot);
  const stagingIdentity = fs.lstatSync(stagingRoot);
  try {
    copyWorkspaceToStage(workspaceRoot, stagingRoot);
    // Diff the private stage against its own pre-mutation state. A consumer
    // edit that lands while the stage is being copied is either part of both
    // snapshots or neither; it can never be mistaken for generator output.
    const before = captureWorkspace(stagingRoot);
    const result = mutate(stagingRoot);
    relocateStagedWorkspaceReferences(stagingRoot, root);
    const changes = buildChangePlan(before, captureWorkspace(stagingRoot));
    publishChangePlan(workspaceRoot, stagingRoot, changes);
    return result;
  } finally {
    cleanOwnedTemporaryDirectory(stagingRoot, stagingIdentity);
  }
}

function sameIdentity(
  stat: fs.Stats,
  identity: { dev: number; ino: number },
): boolean {
  return stat.dev === identity.dev && stat.ino === identity.ino;
}

function currentDirectoryIs(targetDir: string): boolean {
  try {
    return sameIdentity(fs.statSync('.'), fs.statSync(targetDir));
  } catch {
    return false;
  }
}

function restoreEmptyTarget(rollbackPath: string, targetDir: string): boolean {
  try {
    fs.lstatSync(targetDir);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return false;
    }
  }
  try {
    fs.renameSync(rollbackPath, targetDir);
    return true;
  } catch {
    return false;
  }
}

function cleanEmptyTargetRollback(
  rollbackPath: string,
  expected: Extract<FreshWorkspaceTarget, { kind: 'empty' }>,
): void {
  try {
    const current = fs.lstatSync(rollbackPath);
    if (
      !sameIdentity(current, expected) ||
      !current.isDirectory() ||
      fs.readdirSync(rollbackPath).length > 0
    ) {
      throw new WorkspaceTransactionConflictError(
        `Preserving changed empty-target rollback at ${rollbackPath}`,
      );
    }
    fs.rmdirSync(rollbackPath);
  } catch (error) {
    process.emitWarning(
      `UltraModern empty-target cleanup failed for ${rollbackPath}: ${String(
        error,
      )}`,
      { code: 'ULTRAMODERN_TEMP_CLEANUP_FAILED' },
    );
  }
}

function publishFreshWorkspace(
  stagingRoot: string,
  workspaceRoot: string,
  target: FreshWorkspaceTarget,
): void {
  assertFreshTarget(workspaceRoot, target);
  if (target.kind === 'absent') {
    fs.renameSync(stagingRoot, workspaceRoot);
    return;
  }

  const rollbackPath = path.join(
    path.dirname(workspaceRoot),
    `.${path.basename(workspaceRoot)}.ultramodern-empty-${randomUUID()}.tmp`,
  );
  const restoreCwd = currentDirectoryIs(workspaceRoot);
  fs.renameSync(workspaceRoot, rollbackPath);
  let committed = false;
  try {
    const moved = fs.lstatSync(rollbackPath);
    if (
      !sameIdentity(moved, target) ||
      !moved.isDirectory() ||
      fs.readdirSync(rollbackPath).length > 0
    ) {
      throw new WorkspaceTransactionConflictError(
        `Workspace target changed during generation: ${workspaceRoot}`,
      );
    }
    fs.renameSync(stagingRoot, workspaceRoot);
    committed = true;
  } catch (error) {
    if (!committed && !restoreEmptyTarget(rollbackPath, workspaceRoot)) {
      throw new WorkspaceTransactionConflictError(
        `Fresh workspace publication failed; the original empty target is preserved at ${rollbackPath}`,
        { cause: error },
      );
    }
    throw error;
  }

  let cwdRestored = !restoreCwd;
  if (restoreCwd) {
    try {
      process.chdir(workspaceRoot);
      cwdRestored = true;
    } catch (error) {
      process.emitWarning(
        `UltraModern published ${workspaceRoot}, but could not restore the caller current directory: ${String(
          error,
        )}`,
        { code: 'ULTRAMODERN_CWD_RESTORE_FAILED' },
      );
    }
  }
  if (cwdRestored) {
    cleanEmptyTargetRollback(rollbackPath, target);
  }
}

/**
 * Fully stage a fresh workspace beside its resolved target and publish the
 * complete tree with one directory rename. An already-empty target needs a
 * narrow empty-directory swap (the canonical path is briefly absent) so CLI
 * generation in an empty cwd retains its contract without exposing a partial
 * tree. Node has no portable no-replace directory rename, so an external
 * process can still win the narrow final preflight-to-rename race.
 */
export function runFreshWorkspaceTransaction<T>(
  targetDir: string,
  generate: (stagingRoot: string) => T,
): T {
  const workspaceRoot = path.resolve(targetDir);
  const target = inspectFreshTarget(workspaceRoot);
  const stagingRoot = createTemporarySibling(workspaceRoot);
  const stagingIdentity = fs.lstatSync(stagingRoot);
  fs.chmodSync(stagingRoot, target.mode);
  try {
    const result = generate(stagingRoot);
    relocateStagedWorkspaceReferences(stagingRoot, targetDir);
    __transactionTestHooks.beforeFreshPublish?.({
      workspaceRoot,
    });
    publishFreshWorkspace(stagingRoot, workspaceRoot, target);
    return result;
  } finally {
    cleanOwnedTemporaryDirectory(stagingRoot, stagingIdentity);
  }
}
