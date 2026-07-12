import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type PathSnapshot =
  | { content: Buffer; mode: number; type: 'file' }
  | {
      entries: Map<string, PathSnapshot>;
      mode: number;
      type: 'directory';
    }
  | { mode: number; target: string; type: 'symlink' };

type MigrationTransaction = {
  order: string[];
  snapshots: Map<string, PathSnapshot | undefined>;
};

type MigrationTransactionOptions<T> = {
  commitWhen?: (result: T) => boolean;
};

export type MigrationIo = {
  workspaceRoot: string;
  dryRun: boolean;
  plan: string[];
  write(filePath: string, content: string): boolean;
  remove(filePath: string): boolean;
  log(message: string): void;
  transaction<T>(
    operation: () => T,
    options?: MigrationTransactionOptions<Awaited<T>>,
  ): T;
  withStagedWorkspace<T>(operation: (stagedWorkspaceRoot: string) => T): T;
};

const stagingExcludedEntries = new Set([
  '.git',
  '.nx',
  '.output',
  'coverage',
  'dist',
  'node_modules',
]);

function lstatIfExists(filePath: string) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function capturePath(filePath: string): PathSnapshot | undefined {
  const stat = lstatIfExists(filePath);
  if (!stat) {
    return undefined;
  }
  const mode = stat.mode & 0o7777;
  if (stat.isFile()) {
    return {
      content: fs.readFileSync(filePath),
      mode,
      type: 'file',
    };
  }
  if (stat.isDirectory()) {
    const entries = new Map<string, PathSnapshot>();
    for (const entry of fs
      .readdirSync(filePath)
      .sort((left, right) => left.localeCompare(right))) {
      const snapshot = capturePath(path.join(filePath, entry));
      if (snapshot) {
        entries.set(entry, snapshot);
      }
    }
    return { entries, mode, type: 'directory' };
  }
  if (stat.isSymbolicLink()) {
    return {
      mode,
      target: fs.readlinkSync(filePath),
      type: 'symlink',
    };
  }
  throw new Error(`Unsupported migration transaction path: ${filePath}`);
}

function removePath(filePath: string) {
  fs.rmSync(filePath, { force: true, recursive: true });
}

function chmodSymlinkIfSupported(filePath: string, mode: number) {
  if (typeof fs.lchmodSync === 'function') {
    fs.lchmodSync(filePath, mode);
  }
}

function restorePath(filePath: string, snapshot: PathSnapshot | undefined) {
  if (!snapshot) {
    removePath(filePath);
    return;
  }

  const current = lstatIfExists(filePath);
  if (snapshot.type === 'file') {
    if (!current?.isFile() || current.isSymbolicLink()) {
      removePath(filePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(filePath, snapshot.content);
    fs.chmodSync(filePath, snapshot.mode);
    return;
  }

  if (snapshot.type === 'symlink') {
    if (
      !current?.isSymbolicLink() ||
      fs.readlinkSync(filePath) !== snapshot.target
    ) {
      removePath(filePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.symlinkSync(snapshot.target, filePath);
    }
    chmodSymlinkIfSupported(filePath, snapshot.mode);
    return;
  }

  if (!current?.isDirectory() || current.isSymbolicLink()) {
    removePath(filePath);
    fs.mkdirSync(filePath, { recursive: true });
  }
  for (const entry of fs.readdirSync(filePath)) {
    if (!snapshot.entries.has(entry)) {
      removePath(path.join(filePath, entry));
    }
  }
  for (const [entry, childSnapshot] of snapshot.entries) {
    restorePath(path.join(filePath, entry), childSnapshot);
  }
  fs.chmodSync(filePath, snapshot.mode);
}

function copyWorkspaceEntry(sourcePath: string, destinationPath: string) {
  const stat = fs.lstatSync(sourcePath);
  if (stat.isDirectory()) {
    fs.mkdirSync(destinationPath, { mode: stat.mode & 0o7777 });
    for (const entry of fs.readdirSync(sourcePath)) {
      if (stagingExcludedEntries.has(entry)) {
        continue;
      }
      copyWorkspaceEntry(
        path.join(sourcePath, entry),
        path.join(destinationPath, entry),
      );
    }
    fs.chmodSync(destinationPath, stat.mode & 0o7777);
    return;
  }
  if (stat.isFile()) {
    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(destinationPath, stat.mode & 0o7777);
    return;
  }
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(sourcePath), destinationPath);
    chmodSymlinkIfSupported(destinationPath, stat.mode & 0o7777);
    return;
  }
  throw new Error(`Unsupported migration staging path: ${sourcePath}`);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

export function createMigrationIo(
  workspaceRoot: string,
  dryRun: boolean,
): MigrationIo {
  const absoluteWorkspaceRoot = path.resolve(workspaceRoot);
  const plan: string[] = [];
  let activeTransaction: MigrationTransaction | undefined;
  const rel = (p: string) =>
    (path.relative(absoluteWorkspaceRoot, p) || path.basename(p))
      .split(path.sep)
      .join('/');

  const assertWorkspacePath = (filePath: string) => {
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(absoluteWorkspaceRoot, absolutePath);
    if (
      relativePath === '' ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Refusing to mutate outside workspace: ${filePath}`);
    }
    return absolutePath;
  };

  const captureForRollback = (filePath: string) => {
    if (!activeTransaction || activeTransaction.snapshots.has(filePath)) {
      return;
    }
    activeTransaction.snapshots.set(filePath, capturePath(filePath));
    activeTransaction.order.push(filePath);
  };

  const captureMissingParents = (filePath: string) => {
    const missing: string[] = [];
    let current = path.dirname(filePath);
    while (current !== absoluteWorkspaceRoot && !lstatIfExists(current)) {
      missing.push(current);
      current = path.dirname(current);
    }
    for (const missingDirectory of missing.reverse()) {
      captureForRollback(missingDirectory);
    }
  };

  const rollback = (transaction: MigrationTransaction) => {
    for (const filePath of [...transaction.order].reverse()) {
      restorePath(filePath, transaction.snapshots.get(filePath));
    }
  };

  const finishWithError = (
    transaction: MigrationTransaction,
    error: unknown,
  ): never => {
    try {
      rollback(transaction);
    } catch (rollbackError) {
      throw new Error(
        `Migration failed (${String(error)}) and rollback failed (${String(
          rollbackError,
        )}).`,
      );
    } finally {
      activeTransaction = undefined;
    }
    throw error;
  };

  const io: MigrationIo = {
    workspaceRoot: absoluteWorkspaceRoot,
    dryRun,
    plan,
    write(filePath, content) {
      const absolutePath = assertWorkspacePath(filePath);
      if (
        fs.existsSync(absolutePath) &&
        fs.readFileSync(absolutePath, 'utf-8') === content
      ) {
        return false;
      }
      if (dryRun) {
        plan.push(`[dry-run] would write ${rel(absolutePath)}`);
        return true;
      }
      captureMissingParents(absolutePath);
      captureForRollback(absolutePath);
      const current = lstatIfExists(absolutePath);
      if (current?.isSymbolicLink()) {
        const linkedPath = path.resolve(
          path.dirname(absolutePath),
          fs.readlinkSync(absolutePath),
        );
        let targetPath = linkedPath;
        try {
          targetPath = fs.realpathSync.native(absolutePath);
        } catch {
          // A dangling link can still create its immediate target on write.
        }
        const absoluteTargetPath = assertWorkspacePath(targetPath);
        captureMissingParents(absoluteTargetPath);
        captureForRollback(absoluteTargetPath);
      }
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, 'utf-8');
      return true;
    },
    remove(filePath) {
      const absolutePath = assertWorkspacePath(filePath);
      if (!lstatIfExists(absolutePath)) {
        return false;
      }
      if (dryRun) {
        plan.push(`[dry-run] would delete ${rel(absolutePath)}`);
        return true;
      }
      captureForRollback(absolutePath);
      fs.rmSync(absolutePath);
      return true;
    },
    log(message) {
      if (dryRun) {
        plan.push(`[dry-run] ${message}`);
      } else {
        process.stdout.write(`[ultramodern] ${message}\n`);
      }
    },
    transaction(operation, options) {
      if (activeTransaction) {
        throw new Error('Nested migration transactions are not supported.');
      }
      const transaction: MigrationTransaction = {
        order: [],
        snapshots: new Map(),
      };
      activeTransaction = transaction;

      const finish = (result: Awaited<ReturnType<typeof operation>>) => {
        try {
          if (options?.commitWhen && !options.commitWhen(result)) {
            rollback(transaction);
          }
          return result;
        } finally {
          activeTransaction = undefined;
        }
      };

      try {
        const result = operation();
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            value => finish(value as Awaited<typeof result>),
            error => finishWithError(transaction, error),
          ) as ReturnType<typeof operation>;
        }
        return finish(result as Awaited<typeof result>) as ReturnType<
          typeof operation
        >;
      } catch (error) {
        return finishWithError(transaction, error);
      }
    },
    withStagedWorkspace(operation) {
      const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ultramodern-migration-'),
      );
      const stagedWorkspaceRoot = path.join(temporaryRoot, 'workspace');
      try {
        copyWorkspaceEntry(absoluteWorkspaceRoot, stagedWorkspaceRoot);
        const result = operation(stagedWorkspaceRoot);
        if (isPromiseLike(result)) {
          return Promise.resolve(result).finally(() => {
            fs.rmSync(temporaryRoot, { force: true, recursive: true });
          }) as ReturnType<typeof operation>;
        }
        fs.rmSync(temporaryRoot, { force: true, recursive: true });
        return result;
      } catch (error) {
        fs.rmSync(temporaryRoot, { force: true, recursive: true });
        throw error;
      }
    },
  };

  return io;
}

export function readJsonFile(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function writeJsonFile(
  io: MigrationIo,
  filePath: string,
  value: unknown,
) {
  return io.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonIfChanged(
  io: MigrationIo,
  filePath: string,
  value: unknown,
) {
  return io.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextIfChanged(
  io: MigrationIo,
  filePath: string,
  value: string,
) {
  return io.write(filePath, value);
}

export function listWorkspacePackageFiles(workspaceRoot: string) {
  const packageFiles = ['package.json'];

  for (const directory of ['apps', 'verticals', 'packages']) {
    const absoluteDirectory = path.join(workspaceRoot, directory);
    if (!fs.existsSync(absoluteDirectory)) {
      continue;
    }

    for (const entry of fs.readdirSync(absoluteDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageFile = `${directory}/${entry.name}/package.json`;
      if (fs.existsSync(path.join(workspaceRoot, packageFile))) {
        packageFiles.push(packageFile);
      }
    }
  }

  return packageFiles;
}
