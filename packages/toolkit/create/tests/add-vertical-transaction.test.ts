import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  runWorkspaceTransaction,
  ULTRAMODERN_LOCK_DIRECTORY,
  ULTRAMODERN_LOCK_FILE,
  WorkspaceLockedError,
} from '../src/ultramodern-workspace/add-vertical/transaction';

function lockPath(workspaceDir: string): string {
  return path.join(
    workspaceDir,
    ULTRAMODERN_LOCK_DIRECTORY,
    ULTRAMODERN_LOCK_FILE,
  );
}

function snapshotAllFiles(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') {
          continue;
        }
        walk(absolute);
      } else if (entry.isFile()) {
        files.set(
          path.relative(root, absolute).split(path.sep).join('/'),
          fs.readFileSync(absolute),
        );
      }
    }
  };
  walk(root);
  return files;
}

function scaffoldWorkspace(): { tempRoot: string; workspaceDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-txn-'));
  const workspaceDir = path.join(tempRoot, 'txn-workspace');
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'txn-workspace',
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
  return { tempRoot, workspaceDir };
}

function assertByteIdentical(
  before: Map<string, Buffer>,
  after: Map<string, Buffer>,
) {
  const beforeKeys = [...before.keys()].sort();
  const afterKeys = [...after.keys()].sort();
  assert.deepEqual(
    afterKeys,
    beforeKeys,
    'failed add-vertical must not leave created or deleted files behind',
  );
  for (const [file, content] of before) {
    assert.ok(
      after.get(file)?.equals(content),
      `${file} must be byte-identical after rollback`,
    );
  }
}

test('add-vertical rolls back byte-identical when a late overlay fails (G1c)', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    const before = snapshotAllFiles(workspaceDir);

    // Fault injection: the overlay generator path does not exist, so the
    // overlay child process fails AFTER the full core write-set has been
    // applied — the deepest failure point of the mutation.
    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'payments',
          modernVersion: '3.2.1',
          overlays: [
            { generator: path.join(tempRoot, 'no-such-overlay-generator') },
          ],
        }),
      /overlay failed|no-such-overlay-generator/iu,
    );

    assertByteIdentical(before, snapshotAllFiles(workspaceDir));

    // The workspace must still be fully usable: the same add succeeds cleanly.
    const result = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'payments',
      modernVersion: '3.2.1',
    });
    assert.equal(result.createdApps[0]?.id, 'payments');
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('add-vertical rolls back byte-identical when a mid-set write fails (G1c)', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    // Fault injection: a directory squats on a file path the write-set must
    // create, forcing an EISDIR part-way through the mutation.
    fs.mkdirSync(path.join(workspaceDir, 'verticals/payments/package.json'), {
      recursive: true,
    });
    const before = snapshotAllFiles(workspaceDir);

    assert.throws(() =>
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name: 'payments',
        modernVersion: '3.2.1',
      }),
    );

    assertByteIdentical(before, snapshotAllFiles(workspaceDir));
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

/* -------------------------------------------------------------------------- */
/* Exclusive mutation lock (G1c concurrency)                                   */
/* -------------------------------------------------------------------------- */

test('a second mutation is rejected while the first holds a fresh lock (G1c)', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    let observed: unknown;
    // While the outer transaction holds the lock, a nested attempt on the same
    // workspace must fail immediately with a typed lock error (no queueing).
    runWorkspaceTransaction(workspaceDir, () => {
      assert.ok(fs.existsSync(lockPath(workspaceDir)), 'lock is held');
      try {
        runWorkspaceTransaction(workspaceDir, () => 'should not run', {
          staleLockMs: 60_000,
        });
      } catch (error) {
        observed = error;
      }
    });

    assert.ok(
      observed instanceof WorkspaceLockedError &&
        observed.code === 'workspace-locked',
      'concurrent attempt rejects with WorkspaceLockedError',
    );
    // Lock released after the outer transaction completes.
    assert.ok(
      !fs.existsSync(lockPath(workspaceDir)),
      'lock released on success',
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('a stale lock is taken over (G1c)', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    // Plant a lock with a long-past timestamp: a crashed mutation that never
    // released. With a tiny stale threshold it must be taken over, not blocked.
    fs.mkdirSync(path.dirname(lockPath(workspaceDir)), { recursive: true });
    fs.writeFileSync(
      lockPath(workspaceDir),
      JSON.stringify({ token: 'stale-token', pid: 999999, createdAt: 0 }),
    );

    let acquiredToken: string | undefined;
    const result = runWorkspaceTransaction(
      workspaceDir,
      () => {
        acquiredToken = JSON.parse(
          fs.readFileSync(lockPath(workspaceDir), 'utf-8'),
        ).token;
        return 'ran';
      },
      { staleLockMs: 1 },
    );
    assert.equal(result, 'ran', 'transaction runs after stale-lock takeover');
    assert.notEqual(acquiredToken, 'stale-token', 'takeover gets a new token');
    assert.match(acquiredToken ?? '', /^[0-9a-f-]{36}$/u);
    assert.ok(
      !fs.existsSync(lockPath(workspaceDir)),
      'lock released after takeover',
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('release leaves a successor lock when its ownership token changed (G1c)', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-txn-'));
  const workspaceDir = path.join(tempRoot, 'successor-workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  try {
    const successor = {
      token: 'successor-token',
      pid: process.pid + 1,
      createdAt: Date.now(),
    };
    runWorkspaceTransaction(workspaceDir, () => {
      fs.writeFileSync(lockPath(workspaceDir), JSON.stringify(successor));
    });

    assert.deepEqual(
      JSON.parse(fs.readFileSync(lockPath(workspaceDir), 'utf-8')),
      successor,
      'a transaction must not release a successor-owned lock',
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('the lock is released after a failed transaction, leaving the tree byte-identical (G1c)', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    const before = snapshotAllFiles(workspaceDir);

    assert.throws(
      () =>
        runWorkspaceTransaction(workspaceDir, () => {
          fs.writeFileSync(
            path.join(workspaceDir, 'scratch-file.txt'),
            'partial mutation',
          );
          throw new Error('boom');
        }),
      /boom/,
    );

    // Restore is byte-identical AND the lock is gone, so the workspace is
    // immediately usable by the next mutation.
    assert.ok(
      !fs.existsSync(lockPath(workspaceDir)),
      'lock released on the failure/restore path',
    );
    assertByteIdentical(before, snapshotAllFiles(workspaceDir));

    const result = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'payments',
      modernVersion: '3.2.1',
    });
    assert.equal(result.createdApps[0]?.id, 'payments');
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
