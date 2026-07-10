import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

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
