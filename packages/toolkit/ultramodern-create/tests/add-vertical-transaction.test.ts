import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  __transactionTestHooks,
  runFreshWorkspaceTransaction,
  runWorkspaceTransaction,
  WorkspaceTransactionConflictError,
} from '../src/ultramodern-workspace/add-vertical/transaction';

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
    'failed mutation must not leave created or deleted files behind',
  );
  for (const [file, content] of before) {
    assert.ok(
      after.get(file)?.equals(content),
      `${file} must be byte-identical after rollback`,
    );
  }
}

function assertNoTransactionArtifacts(root: string) {
  const artifacts: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.name.includes('.ultramodern-')) {
        artifacts.push(entryPath);
      }
      if (entry.isDirectory()) {
        walk(entryPath);
      }
    }
  };
  walk(root);
  assert.deepEqual(artifacts, []);
}

function resetTransactionHooks() {
  __transactionTestHooks.afterPreimageCheck = undefined;
  __transactionTestHooks.beforeFreshPublish = undefined;
  __transactionTestHooks.beforePublish = undefined;
  __transactionTestHooks.beforePublishPath = undefined;
}

test('add-vertical leaves the workspace byte-identical when a late overlay fails', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    const before = snapshotAllFiles(workspaceDir);
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
    assertNoTransactionArtifacts(tempRoot);

    const result = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'payments',
      modernVersion: '3.2.1',
    });
    assert.equal(result.createdApps[0]?.id, 'payments');
    assert.equal(result.workspaceRoot, workspaceDir);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('add-vertical leaves the workspace byte-identical when a staged write fails', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
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
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('failed staged mutations never expose their partial output', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    const before = snapshotAllFiles(workspaceDir);
    assert.throws(
      () =>
        runWorkspaceTransaction(workspaceDir, stagingRoot => {
          fs.writeFileSync(
            path.join(stagingRoot, 'scratch-file.txt'),
            'partial mutation',
          );
          throw new Error('boom');
        }),
      /boom/u,
    );
    assertByteIdentical(before, snapshotAllFiles(workspaceDir));
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('concurrent unrelated files are conserved while owned changes publish', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  const concurrentPath = path.join(workspaceDir, 'consumer-notes.txt');
  try {
    __transactionTestHooks.beforePublish = ({ changedPaths }) => {
      assert.ok(changedPaths.includes('package.json'));
      fs.writeFileSync(concurrentPath, 'consumer work\n');
    };

    const result = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'payments',
      modernVersion: '3.2.1',
    });

    assert.equal(result.createdApps[0]?.id, 'payments');
    assert.equal(fs.readFileSync(concurrentPath, 'utf-8'), 'consumer work\n');
    assert.ok(
      fs.existsSync(path.join(workspaceDir, 'verticals/payments/package.json')),
    );
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    resetTransactionHooks();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('concurrent owned-target changes fail closed without erasing either edit', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  const packageJsonPath = path.join(workspaceDir, 'package.json');
  const concurrentPackageJson = '{"consumer":"concurrent"}\n';
  try {
    const before = snapshotAllFiles(workspaceDir);
    __transactionTestHooks.afterPreimageCheck = ({ relativePath }) => {
      if (relativePath === 'package.json') {
        fs.writeFileSync(packageJsonPath, concurrentPackageJson);
      }
    };

    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'payments',
          modernVersion: '3.2.1',
        }),
      (error: unknown) =>
        error instanceof WorkspaceTransactionConflictError &&
        error.code === 'workspace-transaction-conflict' &&
        /package\.json/u.test(error.message),
    );

    assert.equal(
      fs.readFileSync(packageJsonPath, 'utf-8'),
      concurrentPackageJson,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'verticals/payments')),
      false,
    );
    const after = snapshotAllFiles(workspaceDir);
    for (const [relativePath, content] of before) {
      if (relativePath !== 'package.json') {
        assert.ok(after.get(relativePath)?.equals(content), relativePath);
      }
    }
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    resetTransactionHooks();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('publication failure rolls back already-published files and owned temps', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    const before = snapshotAllFiles(workspaceDir);
    __transactionTestHooks.beforePublishPath = ({ index }) => {
      if (index === 2) {
        throw new Error('injected publication failure');
      }
    };

    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'payments',
          modernVersion: '3.2.1',
        }),
      /injected publication failure/u,
    );
    assertByteIdentical(before, snapshotAllFiles(workspaceDir));
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    resetTransactionHooks();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('fresh generation failure leaves no target or partial tree', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-fresh-fail-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    assert.throws(
      () =>
        runFreshWorkspaceTransaction(workspaceDir, stagingRoot => {
          fs.writeFileSync(path.join(stagingRoot, 'partial.txt'), 'partial');
          throw new Error('generation failed');
        }),
      /generation failed/u,
    );
    assert.equal(fs.existsSync(workspaceDir), false);
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('fresh generation publishes only after success and preserves a competing target', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-workspace-txn-'));
  const workspaceDir = path.join(tempRoot, 'fresh-workspace');
  const overlayDir = path.join(tempRoot, 'claim-target-overlay');
  try {
    fs.mkdirSync(overlayDir);
    fs.writeFileSync(
      path.join(overlayDir, 'package.json'),
      JSON.stringify({ name: 'claim-target-overlay', main: 'index.cjs' }),
    );
    fs.writeFileSync(
      path.join(overlayDir, 'index.cjs'),
      `const fs = require('node:fs');
module.exports = async () => {
  fs.mkdirSync(${JSON.stringify(workspaceDir)});
  fs.writeFileSync(${JSON.stringify(
    path.join(workspaceDir, 'consumer.txt'),
  )}, 'concurrent claimant\\n');
};
`,
    );

    assert.throws(
      () =>
        generateUltramodernWorkspace({
          targetDir: workspaceDir,
          packageName: 'fresh-workspace',
          modernVersion: '3.2.1',
          packageSource: { strategy: 'workspace' },
          overlays: [{ generator: overlayDir }],
        }),
      (error: unknown) =>
        error instanceof WorkspaceTransactionConflictError &&
        /existing workspace target|changed during generation/u.test(
          error.message,
        ),
    );
    assert.equal(
      fs.readFileSync(path.join(workspaceDir, 'consumer.txt'), 'utf-8'),
      'concurrent claimant\n',
    );
    assert.deepEqual(fs.readdirSync(workspaceDir), ['consumer.txt']);
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('fresh generation accepts an existing empty target without exposing staging paths', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-empty-workspace-txn-'),
  );
  const workspaceDir = path.join(tempRoot, 'workspace');
  fs.mkdirSync(workspaceDir);
  try {
    const result = generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'empty-workspace',
      modernVersion: '3.2.1',
      packageSource: { strategy: 'workspace' },
    });

    assert.equal(result.workspaceRoot, workspaceDir);
    assert.ok(fs.existsSync(path.join(workspaceDir, 'package.json')));
    assert.doesNotMatch(
      fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf-8'),
      /\.ultramodern-stage-/u,
    );
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('staged mutation never follows a workspace symlink outside the workspace', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  const outsideDir = path.join(tempRoot, 'outside');
  const linkedVertical = path.join(workspaceDir, 'verticals/payments');
  try {
    fs.mkdirSync(outsideDir);
    fs.mkdirSync(path.dirname(linkedVertical), { recursive: true });
    fs.symlinkSync(outsideDir, linkedVertical, 'dir');
    const before = snapshotAllFiles(workspaceDir);

    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'payments',
          modernVersion: '3.2.1',
        }),
      /parent changed type|transaction conflict/iu,
    );

    assert.deepEqual(fs.readdirSync(outsideDir), []);
    assert.equal(fs.realpathSync(linkedVertical), outsideDir);
    assertByteIdentical(before, snapshotAllFiles(workspaceDir));
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('fresh publication preserves target mode and the caller current-directory inode', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-cwd-txn-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  const transactionUrl = pathToFileURL(
    path.resolve(
      __dirname,
      '../src/ultramodern-workspace/add-vertical/transaction.ts',
    ),
  ).href;
  const tsxLoader = fs.realpathSync(
    path.resolve(__dirname, '../node_modules/tsx/dist/loader.mjs'),
  );
  try {
    fs.mkdirSync(workspaceDir, { mode: 0o711 });
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '--eval',
        `
          import fs from 'node:fs';
          import path from 'node:path';
          import { runFreshWorkspaceTransaction } from ${JSON.stringify(
            transactionUrl,
          )};
          const workspaceRoot = process.cwd();
          runFreshWorkspaceTransaction(workspaceRoot, stagingRoot => {
            fs.writeFileSync(path.join(stagingRoot, 'published.txt'), 'ready');
          });
          if (process.cwd() !== workspaceRoot) {
            throw new Error('current directory path changed during publication');
          }
          process.stdout.write(fs.readFileSync('published.txt', 'utf-8'));
        `,
      ],
      { cwd: workspaceDir, encoding: 'utf-8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'ready');
    assert.equal(fs.statSync(workspaceDir).mode & 0o777, 0o711);

    const absentTarget = path.join(tempRoot, 'absent-workspace');
    runFreshWorkspaceTransaction(absentTarget, stagingRoot => {
      fs.writeFileSync(path.join(stagingRoot, 'published.txt'), 'ready');
    });
    assert.equal(
      fs.statSync(absentTarget).mode & 0o777,
      0o777 & ~process.umask(),
    );

    const nestedTarget = path.join(tempRoot, 'missing-parent/workspace');
    runFreshWorkspaceTransaction(nestedTarget, stagingRoot => {
      fs.writeFileSync(path.join(stagingRoot, 'published.txt'), 'nested');
    });
    assert.equal(
      fs.readFileSync(path.join(nestedTarget, 'published.txt'), 'utf-8'),
      'nested',
    );
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
