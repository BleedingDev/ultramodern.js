import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ignoredSnapshotDirectories } from '../generation-result';
import { normalizePath } from '../naming';

/**
 * Transactional workspace mutation support (G1c). `captureWorkspaceBackup`
 * records the full byte content of every tracked workspace file before a
 * mutation; `restoreWorkspaceBackup` puts the tree back byte-identical when
 * the mutation fails part-way: files created by the failed run are removed
 * (with now-empty directories pruned), and files it rewrote or deleted are
 * restored from the backed-up bytes.
 *
 * The same ignore set as the generation-result snapshots applies, so build
 * output and dependency trees are never captured or touched.
 */
export type WorkspaceBackup = {
  root: string;
  files: Map<string, Buffer>;
};

function walkWorkspaceFiles(
  root: string,
  onFile: (relativePath: string, absolutePath: string) => void,
): void {
  if (!fs.existsSync(root)) {
    return;
  }
  const collect = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredSnapshotDirectories.has(entry.name)) {
        continue;
      }
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        collect(entryPath);
      } else if (entry.isFile()) {
        onFile(normalizePath(path.relative(root, entryPath)), entryPath);
      }
    }
  };
  collect(root);
}

export function captureWorkspaceBackup(root: string): WorkspaceBackup {
  const files = new Map<string, Buffer>();
  walkWorkspaceFiles(root, (relativePath, absolutePath) => {
    files.set(relativePath, fs.readFileSync(absolutePath));
  });
  return { root, files };
}

function listCurrentFiles(root: string): string[] {
  const current: string[] = [];
  walkWorkspaceFiles(root, relativePath => {
    current.push(relativePath);
  });
  return current;
}

function pruneEmptyDirectories(root: string, relativeFilePath: string): void {
  let directory = path.dirname(path.join(root, relativeFilePath));
  const stopAt = path.resolve(root);
  while (path.resolve(directory) !== stopAt) {
    let entries: string[];
    try {
      entries = fs.readdirSync(directory);
    } catch {
      return;
    }
    if (entries.length > 0) {
      return;
    }
    fs.rmdirSync(directory);
    directory = path.dirname(directory);
  }
}

export function restoreWorkspaceBackup(backup: WorkspaceBackup): void {
  // (1) Remove files created by the failed mutation.
  for (const relativePath of listCurrentFiles(backup.root)) {
    if (!backup.files.has(relativePath)) {
      fs.rmSync(path.join(backup.root, relativePath), { force: true });
      pruneEmptyDirectories(backup.root, relativePath);
    }
  }
  // (2) Restore rewritten or deleted files byte-identical.
  for (const [relativePath, content] of backup.files) {
    const absolutePath = path.join(backup.root, relativePath);
    if (
      fs.existsSync(absolutePath) &&
      fs.readFileSync(absolutePath).equals(content)
    ) {
      continue;
    }
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }
}

/* -------------------------------------------------------------------------- */
/* Exclusive mutation lock (G1c concurrency)                                    */
/* -------------------------------------------------------------------------- */

/** Directory (relative to the workspace root) holding the mutation lockfile. */
export const ULTRAMODERN_LOCK_DIRECTORY = '.modernjs';
/** Lockfile name for the workspace-wide exclusive mutation lock. */
export const ULTRAMODERN_LOCK_FILE = '.ultramodern-mutation.lock';
/**
 * Default age after which a held lock is treated as stale and taken over. A
 * mutation is a short synchronous burst; a lock older than this almost always
 * belongs to a crashed process that never released it.
 */
export const DEFAULT_STALE_LOCK_MS = 30_000;

/**
 * A typed error raised when a second mutation tries to enter a workspace that
 * is already locked by a live mutation. `code` is always `'workspace-locked'`.
 * Concurrent attempts fail immediately (no queueing).
 */
export class WorkspaceLockedError extends Error {
  readonly code = 'workspace-locked' as const;

  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceLockedError';
  }
}

type LockRecord = {
  token: string;
  pid: number;
  createdAt: number;
};

type LockObservation = {
  raw: string;
  record: LockRecord | undefined;
};

type LockHandle = { lockPath: string; token: string };

function lockFilePath(root: string): string {
  return path.join(root, ULTRAMODERN_LOCK_DIRECTORY, ULTRAMODERN_LOCK_FILE);
}

function parseLock(raw: string): LockRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.token !== 'string' ||
      typeof record.pid !== 'number' ||
      !Number.isFinite(record.pid) ||
      typeof record.createdAt !== 'number' ||
      !Number.isFinite(record.createdAt)
    ) {
      return undefined;
    }
    return {
      token: record.token,
      pid: record.pid,
      createdAt: record.createdAt,
    };
  } catch {
    return undefined;
  }
}

function readLockObservation(lockPath: string): LockObservation | undefined {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    return { raw, record: parseLock(raw) };
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean | undefined {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false;
    }
    if (code === 'EPERM') {
      return true;
    }
    return undefined;
  }
}

function writeLock(lockPath: string, record: LockRecord): boolean {
  try {
    fs.writeFileSync(lockPath, JSON.stringify(record), { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

function unlinkIfPresent(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Restore a moved lock without replacing a lock another claimant created in
 * the gap. Hard-link creation is exclusive on the destination; the copy
 * fallback preserves that no-clobber property on filesystems that reject
 * hard-links.
 */
function restoreMovedLock(movedLockPath: string, lockPath: string): void {
  try {
    fs.linkSync(movedLockPath, lockPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      unlinkIfPresent(movedLockPath);
      return;
    }
    if (code !== 'EPERM' && code !== 'EOPNOTSUPP' && code !== 'ENOTSUP') {
      throw error;
    }
    try {
      fs.copyFileSync(movedLockPath, lockPath, fs.constants.COPYFILE_EXCL);
    } catch (copyError) {
      if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') {
        unlinkIfPresent(movedLockPath);
        return;
      }
      throw copyError;
    }
  }
  unlinkIfPresent(movedLockPath);
}

function workspaceLockedError(root: string): WorkspaceLockedError {
  return new WorkspaceLockedError(
    `Workspace at ${root} is locked by another ultramodern mutation.`,
  );
}

function isStaleLock(
  observation: LockObservation,
  staleLockMs: number,
): boolean {
  if (observation.record === undefined) {
    return true;
  }
  const age = Date.now() - observation.record.createdAt;
  return age > staleLockMs || isProcessAlive(observation.record.pid) === false;
}

/**
 * Atomically claim the pathname, then verify that the bytes we moved are the
 * stale bytes observed before the claim. A mismatch means a successor won the
 * race; its lock is restored without overwriting any newer claimant.
 */
function takeOverLock(
  lockPath: string,
  observed: LockObservation,
  replacement: LockRecord,
): boolean {
  const takeoverPath = `${lockPath}.takeover.${replacement.token}`;
  try {
    fs.renameSync(lockPath, takeoverPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  try {
    const claimed = readLockObservation(takeoverPath);
    if (claimed?.raw !== observed.raw) {
      restoreMovedLock(takeoverPath, lockPath);
      return false;
    }
    return writeLock(lockPath, replacement);
  } finally {
    // The moved file is the exact stale observation or a successor that we
    // have already restored. It is never the pathname of a live successor.
    try {
      unlinkIfPresent(takeoverPath);
    } catch {
      // A best-effort cleanup failure must not mask the lock decision.
    }
  }
}

/**
 * Acquire the workspace-wide exclusive mutation lock. Atomic via an exclusive
 * (`wx`) create. If the lock already exists, its age is inspected: a lock older
 * than `staleLockMs` (or one whose timestamp can't be read) is taken over with
 * a warning; a fresh lock means a live concurrent mutation, so this throws
 * {@link WorkspaceLockedError} immediately rather than queueing.
 */
function acquireWorkspaceLock(root: string, staleLockMs: number): LockHandle {
  const lockPath = lockFilePath(root);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const record: LockRecord = {
    token: randomUUID(),
    pid: process.pid,
    createdAt: Date.now(),
  };
  if (writeLock(lockPath, record)) {
    return { lockPath, token: record.token };
  }

  const observed = readLockObservation(lockPath);
  if (observed === undefined) {
    throw workspaceLockedError(root);
  }

  const age =
    observed.record === undefined
      ? undefined
      : Date.now() - observed.record.createdAt;
  if (!isStaleLock(observed, staleLockMs)) {
    throw workspaceLockedError(root);
  }

  process.emitWarning(
    `Taking over stale ultramodern workspace lock at ${lockPath} ` +
      `(age ${age ?? 'unknown'}ms).`,
  );
  if (takeOverLock(lockPath, observed, record)) {
    return { lockPath, token: record.token };
  }
  throw workspaceLockedError(root);
}

function releaseWorkspaceLock(handle: LockHandle): void {
  const releasePath = `${handle.lockPath}.release.${handle.token}`;
  try {
    fs.renameSync(handle.lockPath, releasePath);
  } catch {
    return;
  }

  try {
    const moved = readLockObservation(releasePath);
    if (moved?.record?.token === handle.token) {
      unlinkIfPresent(releasePath);
      return;
    }
    restoreMovedLock(releasePath, handle.lockPath);
  } catch {
    // Best-effort release: a missing lock (already taken over) is not an
    // error, and an unexpected filesystem race must not mask the mutation.
  }
}

/**
 * Run a workspace mutation transactionally under an exclusive lock (G1c). The
 * whole transaction — backup, mutation, and any restore — is wrapped in a
 * workspace-wide lock so concurrent adds cannot interleave snapshot/restore and
 * erase each other; a concurrent attempt fails immediately with a typed
 * {@link WorkspaceLockedError}. On any thrown error the workspace is restored
 * byte-identical from the pre-mutation backup and the original error is
 * rethrown. The lock is released on success, failure, and restore paths.
 */
export function runWorkspaceTransaction<T>(
  root: string,
  mutate: () => T,
  options?: { staleLockMs?: number },
): T {
  const lock = acquireWorkspaceLock(
    root,
    options?.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
  );
  const backup = captureWorkspaceBackup(root);
  try {
    return mutate();
  } catch (error) {
    restoreWorkspaceBackup(backup);
    throw error;
  } finally {
    releaseWorkspaceLock(lock);
  }
}
