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

/**
 * Run a workspace mutation transactionally: on any thrown error the workspace
 * is restored byte-identical from the pre-mutation backup and the original
 * error is rethrown.
 */
export function runWorkspaceTransaction<T>(root: string, mutate: () => T): T {
  const backup = captureWorkspaceBackup(root);
  try {
    return mutate();
  } catch (error) {
    restoreWorkspaceBackup(backup);
    throw error;
  }
}
