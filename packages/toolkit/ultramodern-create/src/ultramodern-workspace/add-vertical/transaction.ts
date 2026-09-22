import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ignoredSnapshotDirectories } from '../generation-result';
import { normalizePath } from '../naming';

type WorkspaceFile = {
  content: Buffer;
  mode: number;
  symlink?: true;
};

type WorkspaceSnapshot = Map<string, WorkspaceFile>;

export type WorkspaceChange = {
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
  afterPublishPath?: (details: {
    workspaceRoot: string;
    relativePath: string;
    index: number;
  }) => void;
  beforeFreshPublish?: (details: { workspaceRoot: string }) => void;
} = {};

function isIgnoredRelativePath(relativePath: string): boolean {
  const segments = normalizePath(relativePath).split('/');
  return segments.some((segment, index) => {
    // These names are valid workspace packages, not generated output. Keep
    // so dry-run and publication see the same tree.
    if (
      index === 1 &&
      ['apps', 'verticals', 'packages'].includes(segments[0]) &&
      ['dist', 'coverage'].includes(segment)
    )
      return false;
    return ignoredSnapshotDirectories.has(segment);
  });
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
      } else if (entry.isFile() || entry.isSymbolicLink()) {
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

function captureWorkspace(
  root: string,
  publishedRoot = root,
): WorkspaceSnapshot {
  const files: WorkspaceSnapshot = new Map();
  walkWorkspaceFiles(root, (relativePath, absolutePath) => {
    const stat = fs.lstatSync(absolutePath);
    const target = stat.isSymbolicLink()
      ? fs.readlinkSync(absolutePath)
      : undefined;
    files.set(relativePath, {
      content:
        target === undefined
          ? fs.readFileSync(absolutePath)
          : Buffer.from(
              path.isAbsolute(target) && isInside(root, target)
                ? path.join(publishedRoot, path.relative(root, target))
                : target,
            ),
      mode: stat.mode & 0o7777,
      ...(target === undefined ? {} : { symlink: true as const }),
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
  return (
    left.symlink === right.symlink &&
    left.mode === right.mode &&
    left.content.equals(right.content)
  );
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
  // Recovery resolves receipt paths natively. Persist the same representation
  // when the caller uses a Windows short path or an aliased parent directory.
  return fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(parent, `.${path.basename(absoluteRoot)}.ultramodern-stage-`),
    ),
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
  if (fs.lstatSync(sourcePath).isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
    return;
  }
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

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function copyWorkspaceToStage(root: string, stagingRoot: string): void {
  // Validate links before copying anything: no staged operation may follow an
  // external target. Descendant links are copied as links, never dereferenced.
  walkWorkspaceFiles(root, (relativePath, absolutePath) => {
    if (!fs.lstatSync(absolutePath).isSymbolicLink()) return;
    let target: string;
    try {
      target = fs.realpathSync.native(absolutePath);
    } catch (cause) {
      throw new WorkspaceTransactionConflictError(
        `Unsupported dangling or cyclic workspace link: ${relativePath}`,
        { cause },
      );
    }
    if (
      !isInside(root, target) ||
      isIgnoredRelativePath(path.relative(root, target))
    ) {
      throw new WorkspaceTransactionConflictError(
        `Workspace transaction conflict: link escapes the staged input: ${relativePath}`,
      );
    }
  });
  fs.cpSync(root, stagingRoot, {
    mode: fs.constants.COPYFILE_FICLONE,
    recursive: true,
    verbatimSymlinks: true,
    filter: sourcePath =>
      !isIgnoredRelativePath(path.relative(root, sourcePath)),
  });
  walkWorkspaceFiles(stagingRoot, (_relativePath, absolutePath) => {
    if (!fs.lstatSync(absolutePath).isSymbolicLink()) return;
    const target = fs.readlinkSync(absolutePath);
    if (path.isAbsolute(target)) {
      const realTarget = fs.realpathSync.native(target);
      fs.unlinkSync(absolutePath);
      fs.symlinkSync(
        path.join(stagingRoot, path.relative(root, realTarget)),
        absolutePath,
      );
    }
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
    if (fs.lstatSync(absolutePath).isSymbolicLink()) return;
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
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw new WorkspaceTransactionConflictError(
      `Workspace target changed type during generation: ${displayPath}`,
    );
  }
  return {
    content: stat.isSymbolicLink()
      ? Buffer.from(fs.readlinkSync(absolutePath))
      : fs.readFileSync(absolutePath),
    mode: stat.mode & 0o7777,
    ...(stat.isSymbolicLink() ? { symlink: true as const } : {}),
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
  if (file.symlink) {
    fs.symlinkSync(file.content.toString(), filePath);
    return;
  }
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
  preparedChanges: PreparedChange[],
  createdDirectories: string[],
): void {
  for (const prepared of preparedChanges) {
    ensureOwnedParentDirectories(
      root,
      prepared.relativePath,
      createdDirectories,
    );
    if (prepared.after && prepared.publishPath) {
      writeTemporaryFile(prepared.publishPath, prepared.after);
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

const receiptSuffix = '.receipt.json';

type FreshDirectory = {
  relativePath: string;
  temporaryPath: string;
  dev: number;
  ino: number;
};

type TransactionReceipt = {
  schema: 'ultramodern-workspace-transaction-v1';
  root: string;
  rootIdentity: { dev: number; ino: number };
  stagingIdentity: { dev: number; ino: number };
  pid: number;
  state: 'publishing' | 'committed';
  purpose?: 'fresh-empty';
  directories?: FreshDirectory[];
  changes: Array<
    Omit<PreparedChange, 'before' | 'after'> & {
      before?: { content: string; mode: number; symlink?: true };
      after?: { content: string; mode: number; symlink?: true };
    }
  >;
};

function persistReceipt(receiptPath: string, receipt: TransactionReceipt) {
  const temporary = `${receiptPath}.next`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(receipt));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, receiptPath);
  // Windows libuv fsync calls FlushFileBuffers, which requires a writable
  // handle. Node's read-only directory handle cannot provide a directory
  // durability barrier there. Keep the receipt file flush and atomic rename;
  // Windows recovery does not promise the receipt rename survives power loss.
  if (process.platform === 'win32') return;
  const directory = fs.openSync(path.dirname(receiptPath), 'r');
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}

function encodedReceipt(
  root: string,
  stagingRoot: string,
  changes: PreparedChange[],
  directories?: FreshDirectory[],
): TransactionReceipt {
  const encode = (file: WorkspaceFile | undefined) =>
    file
      ? {
          ...file,
          content: file.content.toString('base64'),
        }
      : undefined;
  const identity = (filePath: string) => {
    const { dev, ino } = fs.lstatSync(filePath);
    return { dev, ino };
  };
  return {
    schema: 'ultramodern-workspace-transaction-v1',
    root,
    rootIdentity: identity(root),
    stagingIdentity: identity(stagingRoot),
    pid: process.pid,
    state: 'publishing',
    ...(directories ? { purpose: 'fresh-empty' as const, directories } : {}),
    changes: changes.map(change => ({
      ...change,
      before: encode(change.before),
      after: encode(change.after),
    })),
  };
}

function decodeReceipt(
  receiptPath: string,
  root: string,
): { receipt: TransactionReceipt; changes: PreparedChange[] } {
  const stat = fs.lstatSync(receiptPath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    throw new WorkspaceTransactionConflictError(
      `Unsafe interrupted transaction receipt: ${receiptPath}`,
    );
  }
  const receipt = JSON.parse(
    fs.readFileSync(receiptPath, 'utf8'),
  ) as TransactionReceipt;
  const stagingRoot = receiptPath.slice(0, -receiptSuffix.length);
  if (
    receipt.schema !== 'ultramodern-workspace-transaction-v1' ||
    receipt.root !== root ||
    !['publishing', 'committed'].includes(receipt.state) ||
    !Number.isSafeInteger(receipt.pid) ||
    receipt.pid <= 0 ||
    !sameIdentity(fs.lstatSync(root), receipt.rootIdentity) ||
    !sameIdentity(fs.lstatSync(stagingRoot), receipt.stagingIdentity) ||
    !Array.isArray(receipt.changes)
  ) {
    throw new WorkspaceTransactionConflictError(
      `Unrecognized interrupted transaction receipt: ${receiptPath}`,
    );
  }
  const paths = new Set<string>();
  const decode = (
    file: TransactionReceipt['changes'][number]['before'],
  ): WorkspaceFile | undefined => {
    if (file === undefined) return undefined;
    if (
      !file ||
      typeof file.content !== 'string' ||
      !Number.isInteger(file.mode) ||
      file.mode < 0 ||
      file.mode > 0o7777 ||
      (file.symlink !== undefined && file.symlink !== true) ||
      Buffer.from(file.content, 'base64').toString('base64') !== file.content
    ) {
      throw new WorkspaceTransactionConflictError(
        `Malformed interrupted transaction preimage: ${receiptPath}`,
      );
    }
    return { ...file, content: Buffer.from(file.content, 'base64') };
  };
  const changes = receipt.changes.map(change => {
    const relative = change.relativePath;
    if (
      typeof relative !== 'string' ||
      !relative ||
      path.isAbsolute(relative) ||
      normalizePath(path.normalize(relative)) !== relative ||
      !isInside(root, path.resolve(root, relative)) ||
      isIgnoredRelativePath(relative) ||
      paths.has(relative)
    ) {
      throw new WorkspaceTransactionConflictError(
        `Unsafe interrupted transaction target: ${String(relative)}`,
      );
    }
    paths.add(relative);
    for (const temporary of [change.publishPath, change.rollbackPath]) {
      if (
        temporary !== undefined &&
        (typeof temporary !== 'string' ||
          path.dirname(temporary) !== path.dirname(path.join(root, relative)) ||
          !path
            .basename(temporary)
            .startsWith(`.${path.basename(relative)}.ultramodern-`) ||
          !temporary.endsWith('.tmp'))
      ) {
        throw new WorkspaceTransactionConflictError(
          `Unsafe interrupted transaction temporary: ${String(temporary)}`,
        );
      }
    }
    return {
      relativePath: relative,
      before: decode(change.before),
      after: decode(change.after),
      publishPath: change.publishPath,
      rollbackPath: change.rollbackPath,
      published: false,
    };
  });
  if (receipt.purpose !== undefined && receipt.purpose !== 'fresh-empty') {
    throw new WorkspaceTransactionConflictError(
      `Unknown transaction purpose: ${receiptPath}`,
    );
  }
  if (receipt.purpose === 'fresh-empty') {
    const expected = freshParentPaths(changes);
    if (
      !Array.isArray(receipt.directories) ||
      receipt.directories.length !== expected.length ||
      changes.some(
        change => change.before !== undefined || change.after === undefined,
      ) ||
      receipt.directories.some(
        (directory, index) =>
          !directory ||
          directory.relativePath !== expected[index] ||
          typeof directory.temporaryPath !== 'string' ||
          path.dirname(directory.temporaryPath) !== stagingRoot ||
          !/^\.ultramodern-directory-[\da-f-]+\.tmp$/u.test(
            path.basename(directory.temporaryPath),
          ) ||
          !Number.isInteger(directory.dev) ||
          !Number.isInteger(directory.ino),
      ) ||
      new Set(receipt.directories.map(directory => directory.temporaryPath))
        .size !== expected.length
    ) {
      throw new WorkspaceTransactionConflictError(
        `Unsafe fresh transaction directories: ${receiptPath}`,
      );
    }
  } else if (receipt.directories !== undefined) {
    throw new WorkspaceTransactionConflictError(
      `Unexpected transaction directories: ${receiptPath}`,
    );
  }
  return { receipt, changes };
}

function freshParentPaths(changes: WorkspaceChange[]): string[] {
  const parents = new Set<string>();
  for (const change of changes) {
    const segments = change.relativePath.split('/');
    for (let length = 1; length < segments.length; length++)
      parents.add(segments.slice(0, length).join('/'));
  }
  return [...parents].sort(
    (left, right) =>
      left.split('/').length - right.split('/').length ||
      left.localeCompare(right),
  );
}

function stageFreshDirectories(
  stagingRoot: string,
  changes: WorkspaceChange[],
): FreshDirectory[] {
  return freshParentPaths(changes).map(relativePath => {
    const temporaryPath = path.join(
      stagingRoot,
      `.ultramodern-directory-${randomUUID()}.tmp`,
    );
    fs.mkdirSync(temporaryPath, {
      mode: fs.statSync(path.join(stagingRoot, relativePath)).mode & 0o777,
    });
    const { dev, ino } = fs.lstatSync(temporaryPath);
    return { relativePath, temporaryPath, dev, ino };
  });
}

function assertFreshDirectoryAncestors(
  root: string,
  receipt: TransactionReceipt,
  relativePath: string,
): void {
  const ancestors = relativePath.split('/').slice(0, -1);
  for (let length = 0; length <= ancestors.length; length++) {
    const relative = ancestors.slice(0, length).join('/');
    const expected =
      length === 0
        ? receipt.rootIdentity
        : receipt.directories!.find(
            directory => directory.relativePath === relative,
          )!;
    const candidate = path.join(root, relative);
    const stat = fs.lstatSync(candidate);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameIdentity(stat, expected)
    )
      throw new WorkspaceTransactionConflictError(
        `Fresh transaction parent changed; preserved at ${candidate}`,
      );
  }
}

function publishFreshDirectory(
  root: string,
  receipt: TransactionReceipt,
  directory: FreshDirectory,
): void {
  const target = path.join(root, directory.relativePath);
  assertFreshDirectoryAncestors(root, receipt, directory.relativePath);
  const staged = fs.lstatSync(directory.temporaryPath);
  const stagingRoot = path.dirname(directory.temporaryPath);
  if (
    !staged.isDirectory() ||
    staged.isSymbolicLink() ||
    !sameIdentity(staged, directory) ||
    !sameIdentity(fs.lstatSync(stagingRoot), receipt.stagingIdentity)
  )
    throw new WorkspaceTransactionConflictError(
      `Fresh transaction staged directory changed: ${directory.temporaryPath}`,
    );
  if (fs.existsSync(target))
    throw new WorkspaceTransactionConflictError(
      `Fresh transaction directory appeared: ${target}`,
    );
  fs.renameSync(directory.temporaryPath, target);
  try {
    assertFreshDirectoryAncestors(root, receipt, directory.relativePath);
    const published = fs.lstatSync(target);
    if (
      !published.isDirectory() ||
      published.isSymbolicLink() ||
      !sameIdentity(published, directory)
    )
      throw new WorkspaceTransactionConflictError(
        `Fresh transaction directory changed; preserved at ${target}`,
      );
  } catch (error) {
    // Node has no portable directory-relative no-follow rename. An ancestor
    // replacement during the syscall may leave a newly created empty directory
    // outside the root. Never reclaim through that now-untrusted path: another
    // checked-then-rename could relocate foreign consumer data. Retain evidence.
    throw new WorkspaceTransactionConflictError(
      `Fresh directory publication could not validate ownership at ${target}; no cleanup attempted through this path`,
      { cause: error },
    );
  }
}

function validateFreshDirectories(
  root: string,
  receipt: TransactionReceipt,
  changes: PreparedChange[],
): void {
  const directories = receipt.directories!;
  const allowed = new Set(
    directories.map(directory => path.join(root, directory.relativePath)),
  );
  for (const change of changes) {
    allowed.add(path.join(root, change.relativePath));
    if (change.publishPath) allowed.add(change.publishPath);
  }
  const liveDirectories = [root];
  for (const directory of directories) {
    for (const candidate of [
      path.join(root, directory.relativePath),
      directory.temporaryPath,
    ]) {
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        !sameIdentity(stat, directory)
      )
        throw new WorkspaceTransactionConflictError(
          `Fresh transaction directory changed; preserved at ${candidate}`,
        );
      if (candidate !== directory.temporaryPath)
        liveDirectories.push(candidate);
    }
  }
  if (receipt.state === 'committed') return;
  for (const directory of liveDirectories) {
    for (const entry of fs.readdirSync(directory)) {
      if (!allowed.has(path.join(directory, entry)))
        throw new WorkspaceTransactionConflictError(
          `Fresh transaction conflicts with newer consumer path: ${path.join(directory, entry)}`,
        );
    }
  }
}

function removeFreshDirectories(
  root: string,
  directories: FreshDirectory[],
): void {
  for (const directory of [...directories].reverse()) {
    const target = path.join(root, directory.relativePath);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameIdentity(stat, directory)
    )
      throw new WorkspaceTransactionConflictError(
        `Fresh transaction directory changed; preserved at ${target}`,
      );
    fs.rmdirSync(target);
  }
}

/** Creation only recovers receipts from an interrupted empty-target creation. */
export function recoverFreshWorkspaceTransactions(root: string): void {
  try {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  recoverWorkspaceTransactions(root, 'fresh-empty');
}

/** Recover only our validated durable publication receipts, never unknown stages. */
export function recoverWorkspaceTransactions(
  root: string,
  purpose: 'update' | 'fresh-empty' = 'update',
): void {
  const workspaceRoot = fs.realpathSync.native(root);
  const parent = path.dirname(workspaceRoot);
  const prefix = `.${path.basename(workspaceRoot)}.ultramodern-stage-`;
  for (const entry of fs.readdirSync(parent).sort()) {
    if (!entry.startsWith(prefix) || !entry.endsWith(receiptSuffix)) continue;
    const receiptPath = path.join(parent, entry);
    const { receipt, changes } = decodeReceipt(receiptPath, workspaceRoot);
    if ((receipt.purpose ?? 'update') !== purpose) continue;
    try {
      process.kill(receipt.pid, 0);
      throw new WorkspaceTransactionConflictError(
        `Workspace publication is still owned by process ${receipt.pid}: ${receiptPath}`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    if (receipt.purpose === 'fresh-empty')
      validateFreshDirectories(workspaceRoot, receipt, changes);
    // Validate every target and owned temporary before restoring any path.
    for (const change of changes) {
      if (receipt.purpose !== 'fresh-empty')
        ensureOwnedParentDirectories(workspaceRoot, change.relativePath, []);
      for (const [temporary, expected] of [
        [change.publishPath, change.after],
        [change.rollbackPath, change.before],
      ] as const) {
        if (
          temporary &&
          fs.existsSync(temporary) &&
          !sameFile(readFilePath(temporary, temporary), expected)
        ) {
          throw new WorkspaceTransactionConflictError(
            `Interrupted transaction temporary changed; preserved at ${temporary}`,
          );
        }
      }
      if (receipt.state === 'committed') continue;
      const current = readWorkspaceFile(workspaceRoot, change.relativePath);
      if (sameFile(current, change.before)) continue;
      if (sameFile(current, change.after)) {
        change.published = true;
        if (
          change.before &&
          change.rollbackPath &&
          !fs.existsSync(change.rollbackPath)
        )
          writeTemporaryFile(change.rollbackPath, change.before);
      } else if (
        current === undefined &&
        change.before &&
        change.rollbackPath &&
        fs.existsSync(change.rollbackPath)
      ) {
        // The process stopped after quarantining the exact preimage but before
        // publishing its replacement. Exclusive restore cannot clobber a writer.
        if (
          !restoreQuarantinedPreimage(
            change,
            path.join(workspaceRoot, change.relativePath),
          )
        ) {
          throw new WorkspaceTransactionConflictError(
            `Interrupted preimage cannot be restored: ${change.relativePath}`,
          );
        }
      } else {
        throw new WorkspaceTransactionConflictError(
          `Interrupted transaction conflicts with newer consumer bytes: ${change.relativePath}; receipt ${receiptPath}`,
        );
      }
    }
    if (receipt.state === 'publishing')
      rollbackPublishedChanges(workspaceRoot, changes);
    cleanupPreparedChanges(changes, []);
    if (receipt.purpose === 'fresh-empty' && receipt.state === 'publishing')
      removeFreshDirectories(workspaceRoot, receipt.directories!);
    removeOwnedTemporaryDirectory(
      receiptPath.slice(0, -receiptSuffix.length),
      receipt.stagingIdentity,
    );
    removeIfPresent(receiptPath);
  }
}

function publishChangePlan(
  root: string,
  stagingRoot: string,
  changes: WorkspaceChange[],
  emptyTarget?: FreshWorkspaceTarget,
) {
  __transactionTestHooks.beforePublish?.({
    workspaceRoot: root,
    stagingRoot,
    changedPaths: changes.map(change => change.relativePath),
  });
  if (emptyTarget) assertFreshTarget(root, emptyTarget);
  for (const change of changes) assertPreimage(root, change);
  if (changes.length === 0) return;
  const createdDirectories: string[] = [];
  const preparedChanges: PreparedChange[] = changes.map(change => ({
    ...change,
    published: false,
    ...(change.after
      ? { publishPath: temporaryFilePath(root, change.relativePath, 'publish') }
      : {}),
    ...(change.before
      ? {
          rollbackPath: temporaryFilePath(
            root,
            change.relativePath,
            'rollback',
          ),
        }
      : {}),
  }));
  const receiptPath = `${stagingRoot}${receiptSuffix}`;
  const directories = emptyTarget
    ? stageFreshDirectories(stagingRoot, changes)
    : undefined;
  const receipt = encodedReceipt(
    root,
    stagingRoot,
    preparedChanges,
    directories,
  );
  persistReceipt(receiptPath, receipt);
  try {
    for (const directory of directories ?? [])
      publishFreshDirectory(root, receipt, directory);
    prepareChanges(root, preparedChanges, createdDirectories);
    for (const change of preparedChanges) assertPreimage(root, change);
    preparedChanges.forEach((change, index) => {
      __transactionTestHooks.beforePublishPath?.({
        workspaceRoot: root,
        relativePath: change.relativePath,
        index,
      });
      publishChange(root, change);
      __transactionTestHooks.afterPublishPath?.({
        workspaceRoot: root,
        relativePath: change.relativePath,
        index,
      });
    });
    persistReceipt(receiptPath, { ...receipt, state: 'committed' });
  } catch (error) {
    try {
      if (directories) validateFreshDirectories(root, receipt, preparedChanges);
      rollbackPublishedChanges(root, preparedChanges);
      if (directories) {
        cleanupPreparedChanges(preparedChanges, []);
        removeFreshDirectories(root, directories);
      }
    } catch (rollbackError) {
      throw new WorkspaceTransactionConflictError(
        `Workspace transaction failed and concurrent target changes prevented a safe rollback; recovery receipt ${receiptPath}.`,
        {
          cause: directories
            ? new AggregateError(
                [error, rollbackError],
                'Fresh publication and rollback conflicts',
              )
            : rollbackError,
        },
      );
    }
    cleanPreparedChanges(preparedChanges, createdDirectories);
    if (
      !preparedChanges.some(
        change => change.preserveRollback || change.preservedPaths?.length,
      )
    )
      removeIfPresent(receiptPath);
    throw error;
  }
  cleanPreparedChanges(preparedChanges, []);
  removeIfPresent(receiptPath);
}

/**
 * Run an existing-workspace mutation against a private sibling. Only the
 * semantic file changes produced there are published, and every owned target
 * must still match its exact preimage. Unrelated workspace files are never
 * copied back, so concurrent consumer work is conserved without a lock.
 * Preview prepares and inspects the same change set, then discards its stage;
 * it never publishes or recovers an earlier transaction into the live tree.
 */
export function runWorkspaceTransaction<T>(
  root: string,
  mutate: (stagingRoot: string) => T,
  options: {
    mode?: 'publish' | 'preview';
    commitWhen?: (result: Awaited<T>) => boolean;
    inspectChanges?: (changes: readonly WorkspaceChange[]) => void;
  } = {},
): T {
  const workspaceRoot = fs.realpathSync.native(path.resolve(root));
  if (!fs.statSync(workspaceRoot).isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${root}`);
  }
  if (options.mode !== 'preview') recoverWorkspaceTransactions(workspaceRoot);
  const stagingRoot = createTemporarySibling(workspaceRoot);
  const stagingIdentity = fs.lstatSync(stagingRoot);
  const cleanup = () => {
    // A failed rollback retains both the durable receipt and its owned stage.
    if (!fs.existsSync(`${stagingRoot}${receiptSuffix}`))
      cleanOwnedTemporaryDirectory(stagingRoot, stagingIdentity);
  };
  try {
    copyWorkspaceToStage(workspaceRoot, stagingRoot);
    const before = captureWorkspace(stagingRoot, workspaceRoot);
    const finish = (result: Awaited<T>) => {
      if (options.commitWhen && !options.commitWhen(result)) return result;
      relocateStagedWorkspaceReferences(stagingRoot, root);
      const changes = buildChangePlan(
        before,
        captureWorkspace(stagingRoot, workspaceRoot),
      );
      options.inspectChanges?.(changes);
      if (options.mode !== 'preview')
        publishChangePlan(workspaceRoot, stagingRoot, changes);
      return result;
    };
    const result = mutate(stagingRoot);
    if (
      result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      typeof (result as unknown as PromiseLike<unknown>).then === 'function'
    ) {
      return Promise.resolve(result).then(finish).finally(cleanup) as T;
    }
    const completed = finish(result as Awaited<T>);
    cleanup();
    return completed as T;
  } catch (error) {
    cleanup();
    throw error;
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

  if (process.platform === 'win32' && currentDirectoryIs(workspaceRoot)) {
    // The calling shell can retain its own cwd handle, so moving our process
    // cwd cannot make a directory swap reliable. Preserve this root's inode
    // and use the existing recoverable, per-file publisher after full staging.
    // This has the updater's multi-file publication semantics, not an atomic
    // whole-directory rename or a Windows power-loss durability guarantee.
    publishChangePlan(
      fs.realpathSync.native(workspaceRoot),
      stagingRoot,
      buildChangePlan(new Map(), captureWorkspace(stagingRoot, workspaceRoot)),
      target,
    );
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
 * complete tree with one directory rename, except for an empty Windows cwd,
 * whose held directory is retained by the recoverable per-file publisher.
 * Other already-empty targets use a narrow empty-directory swap (the canonical
 * path is briefly absent). Node has no portable no-replace directory rename,
 * so an external process can still win the final preflight-to-rename race.
 */
export function runFreshWorkspaceTransaction<T>(
  targetDir: string,
  generate: (stagingRoot: string) => T,
): T {
  const workspaceRoot = path.resolve(targetDir);
  recoverFreshWorkspaceTransactions(workspaceRoot);
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
    if (!fs.existsSync(`${stagingRoot}${receiptSuffix}`)) {
      cleanOwnedTemporaryDirectory(stagingRoot, stagingIdentity);
    }
  }
}
