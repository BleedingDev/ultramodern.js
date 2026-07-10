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

type LockHandle = { lockPath: string };

function lockFilePath(root: string): string {
  return path.join(root, ULTRAMODERN_LOCK_DIRECTORY, ULTRAMODERN_LOCK_FILE);
}

/** Age of the lock at `lockPath` in ms, or `undefined` if it can't be read. */
function lockAgeMs(lockPath: string): number | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as {
      timestamp?: unknown;
    };
    if (typeof parsed.timestamp !== 'number') {
      return undefined;
    }
    return Date.now() - parsed.timestamp;
  } catch {
    return undefined;
  }
}

function writeLock(lockPath: string): boolean {
  const payload = JSON.stringify({
    pid: process.pid,
    timestamp: Date.now(),
  });
  try {
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
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

  if (writeLock(lockPath)) {
    return { lockPath };
  }

  const age = lockAgeMs(lockPath);
  if (age === undefined || age > staleLockMs) {
    process.emitWarning(
      `Taking over stale ultramodern workspace lock at ${lockPath} ` +
        `(age ${age ?? 'unknown'}ms).`,
    );
    fs.rmSync(lockPath, { force: true });
    if (writeLock(lockPath)) {
      return { lockPath };
    }
  }

  throw new WorkspaceLockedError(
    `Workspace at ${root} is locked by another ultramodern mutation.`,
  );
}

function releaseWorkspaceLock(handle: LockHandle): void {
  try {
    fs.rmSync(handle.lockPath, { force: true });
  } catch {
    // Best-effort release: a missing lock (already taken over) is not an error.
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
