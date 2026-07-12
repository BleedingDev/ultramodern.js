import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  __releaseTestHooks,
  runWorkspaceTransaction,
  ULTRAMODERN_LOCK_DIRECTORY,
  ULTRAMODERN_LOCK_FILE,
  WorkspaceLockedError,
  WorkspaceLockIntegrityError,
} from '../src/ultramodern-workspace/add-vertical/transaction';

function lockPath(workspaceDir: string): string {
  return path.join(
    workspaceDir,
    ULTRAMODERN_LOCK_DIRECTORY,
    ULTRAMODERN_LOCK_FILE,
  );
}

function runConcurrentClaimant(options: {
  workspaceDir: string;
  readyPath: string;
  otherReadyPath: string;
  winnerPath: string;
}): Promise<{ status: number | null; stderr: string }> {
  const transactionModulePath = path.resolve(
    __dirname,
    '../dist/cjs/ultramodern-workspace/add-vertical/transaction.cjs',
  );
  const script = `
const fs = require('node:fs');
const { runWorkspaceTransaction } = require(${JSON.stringify(transactionModulePath)});
const [workspaceDir, readyPath, otherReadyPath, winnerPath] = process.argv.slice(1);
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

try {
  fs.writeFileSync(readyPath, 'ready');
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(otherReadyPath) && Date.now() < deadline) {
    Atomics.wait(waitBuffer, 0, 0, 10);
  }
  if (!fs.existsSync(otherReadyPath)) {
    throw new Error('concurrent claimant barrier timed out');
  }
  runWorkspaceTransaction(
    workspaceDir,
    () => {
      fs.writeFileSync(winnerPath, String(process.pid));
      Atomics.wait(waitBuffer, 0, 0, 750);
    },
    { staleLockMs: 10000 },
  );
  process.stdout.write('won');
} catch (error) {
  process.stderr.write(error?.code || String(error));
  process.exitCode = error?.code === 'workspace-locked' ? 2 : 1;
}
`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '-e',
      script,
      options.workspaceDir,
      options.readyPath,
      options.otherReadyPath,
      options.winnerPath,
    ]);
    let stderr = '';
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stderr }));
  });
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

test('concurrent stale-lock takeovers have exactly one winner (G1c)', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-txn-'));
  const ITERATIONS = 25;
  try {
    // Loop the two-process race so a rare interleaving that double-grants (or
    // starves) the lock is caught rather than passing on a lucky schedule.
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const workspaceDir = path.join(tempRoot, `race-workspace-${iteration}`);
      const readyOne = path.join(tempRoot, `claimant-one-${iteration}.ready`);
      const readyTwo = path.join(tempRoot, `claimant-two-${iteration}.ready`);
      const winnerOne = path.join(tempRoot, `claimant-one-${iteration}.winner`);
      const winnerTwo = path.join(tempRoot, `claimant-two-${iteration}.winner`);
      fs.mkdirSync(path.dirname(lockPath(workspaceDir)), { recursive: true });
      fs.writeFileSync(
        lockPath(workspaceDir),
        JSON.stringify({
          token: 'stale-race-token',
          pid: 999999999,
          createdAt: 0,
        }),
      );

      const results = await Promise.all([
        runConcurrentClaimant({
          workspaceDir,
          readyPath: readyOne,
          otherReadyPath: readyTwo,
          winnerPath: winnerOne,
        }),
        runConcurrentClaimant({
          workspaceDir,
          readyPath: readyTwo,
          otherReadyPath: readyOne,
          winnerPath: winnerTwo,
        }),
      ]);
      assert.equal(
        results.filter(result => result.status === 0).length,
        1,
        `iteration ${iteration}: exactly one claimant must win: ${JSON.stringify(results)}`,
      );
      assert.equal(
        results.filter(result => result.status === 2).length,
        1,
        `iteration ${iteration}: the losing claimant must receive WorkspaceLockedError: ${JSON.stringify(results)}`,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('a fresh lock with a dead PID is taken over before staleLockMs (G1c)', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    fs.mkdirSync(path.dirname(lockPath(workspaceDir)), { recursive: true });
    fs.writeFileSync(
      lockPath(workspaceDir),
      JSON.stringify({
        token: 'dead-pid-token',
        pid: 999999999,
        createdAt: Date.now(),
      }),
    );

    const result = runWorkspaceTransaction(workspaceDir, () => 'ran', {
      staleLockMs: 60_000,
    });
    assert.equal(result, 'ran');
    assert.ok(!fs.existsSync(lockPath(workspaceDir)));
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

test('release restores a successor that slips into the read->rename window intact (G1c)', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-txn-'));
  const workspaceDir = path.join(tempRoot, 'window-workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const successorRaw = JSON.stringify({
    token: 'window-successor',
    pid: process.pid + 1,
    createdAt: Date.now(),
  });
  try {
    // Ownership reads as ours in place, but a successor takes over the pathname
    // *after* that read and *before* the rename. Release must move the
    // successor's bytes back out no-clobber and leave them intact — never
    // discard a live lock.
    __releaseTestHooks.afterOwnershipRead = handle => {
      fs.writeFileSync(handle.lockPath, successorRaw);
    };
    runWorkspaceTransaction(workspaceDir, () => 'ran');

    assert.deepEqual(
      JSON.parse(fs.readFileSync(lockPath(workspaceDir), 'utf-8')),
      JSON.parse(successorRaw),
      'the successor lock must survive release byte-identical',
    );
    assert.ok(
      !fs.existsSync(`${lockPath(workspaceDir)}.release.${'window-successor'}`),
      'no orphaned .release temp is left behind',
    );
  } finally {
    __releaseTestHooks.afterOwnershipRead = undefined;
    __releaseTestHooks.beforeRestore = undefined;
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('release throws WorkspaceLockIntegrityError rather than discarding a lock when restore cannot succeed (G1c)', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-txn-'));
  const workspaceDir = path.join(tempRoot, 'integrity-workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const successorRaw = JSON.stringify({
    token: 'integrity-successor',
    pid: process.pid + 1,
    createdAt: Date.now(),
  });
  const claimantRaw = JSON.stringify({
    token: 'integrity-claimant',
    pid: process.pid + 2,
    createdAt: Date.now(),
  });
  let releasePath: string | undefined;
  try {
    // Successor slips into the read->rename window (so release moves *their*
    // bytes), then a brand-new claimant seizes the vacated pathname before the
    // restore. Restore must fail closed: throw loudly and keep the moved bytes.
    __releaseTestHooks.afterOwnershipRead = handle => {
      fs.writeFileSync(handle.lockPath, successorRaw);
    };
    __releaseTestHooks.beforeRestore = handle => {
      releasePath = `${handle.lockPath}.release.${handle.token}`;
      fs.writeFileSync(handle.lockPath, claimantRaw);
    };

    assert.throws(
      () => runWorkspaceTransaction(workspaceDir, () => 'ran'),
      (error: unknown) =>
        error instanceof WorkspaceLockIntegrityError &&
        error.code === 'workspace-lock-integrity',
      'release must surface an integrity error, not swallow it',
    );

    assert.ok(releasePath, 'restore window was reached');
    assert.deepEqual(
      JSON.parse(fs.readFileSync(releasePath as string, 'utf-8')),
      JSON.parse(successorRaw),
      'the moved successor lock must be preserved, never discarded',
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(lockPath(workspaceDir), 'utf-8')),
      JSON.parse(claimantRaw),
      'the newer claimant that seized the pathname is left untouched',
    );
  } finally {
    __releaseTestHooks.afterOwnershipRead = undefined;
    __releaseTestHooks.beforeRestore = undefined;
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
