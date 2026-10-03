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

async function scaffoldWorkspace(): Promise<{
  tempRoot: string;
  workspaceDir: string;
}> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-txn-'));
  const workspaceDir = path.join(tempRoot, 'txn-workspace');
  await generateUltramodernWorkspace({
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

test('add-vertical leaves the workspace byte-identical when a late overlay fails', async () => {
  const { tempRoot, workspaceDir } = await scaffoldWorkspace();
  try {
    const before = snapshotAllFiles(workspaceDir);
    await assert.rejects(
      async () =>
        await addUltramodernVertical({
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

    const result = await addUltramodernVertical({
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

test('add-vertical leaves the workspace byte-identical when a staged write fails', async () => {
  const { tempRoot, workspaceDir } = await scaffoldWorkspace();
  try {
    fs.mkdirSync(path.join(workspaceDir, 'verticals/payments/package.json'), {
      recursive: true,
    });
    const before = snapshotAllFiles(workspaceDir);

    await assert.rejects(
      async () =>
        await addUltramodernVertical({
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

test('concurrent unrelated files are conserved while owned changes publish', async () => {
  const { tempRoot, workspaceDir } = await scaffoldWorkspace();
  const concurrentPath = path.join(workspaceDir, 'consumer-notes.txt');
  try {
    __transactionTestHooks.beforePublish = ({ changedPaths }) => {
      assert.ok(changedPaths.includes('package.json'));
      fs.writeFileSync(concurrentPath, 'consumer work\n');
    };

    const result = await addUltramodernVertical({
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

test('concurrent owned-target changes fail closed without erasing either edit', async () => {
  const { tempRoot, workspaceDir } = await scaffoldWorkspace();
  const packageJsonPath = path.join(workspaceDir, 'package.json');
  const concurrentPackageJson = '{"consumer":"concurrent"}\n';
  try {
    const before = snapshotAllFiles(workspaceDir);
    __transactionTestHooks.afterPreimageCheck = ({ relativePath }) => {
      if (relativePath === 'package.json') {
        fs.writeFileSync(packageJsonPath, concurrentPackageJson);
      }
    };

    await assert.rejects(
      async () =>
        await addUltramodernVertical({
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

test('fresh generation publishes only after success and preserves a competing target', async () => {
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

    await assert.rejects(
      async () =>
        await generateUltramodernWorkspace({
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

test('staged mutation never follows a workspace symlink outside the workspace', async () => {
  const { tempRoot, workspaceDir } = await scaffoldWorkspace();
  const outsideDir = path.join(tempRoot, 'outside');
  const linkedVertical = path.join(workspaceDir, 'verticals/payments');
  try {
    fs.mkdirSync(outsideDir);
    fs.mkdirSync(path.dirname(linkedVertical), { recursive: true });
    fs.symlinkSync(outsideDir, linkedVertical, 'dir');
    const before = snapshotAllFiles(workspaceDir);

    await assert.rejects(
      async () =>
        await addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'payments',
          modernVersion: '3.2.1',
        }),
      /Config source snapshot symlink escapes captured coverage:/u,
    );

    assert.deepEqual(fs.readdirSync(outsideDir), []);
    assert.equal(fs.realpathSync(linkedVertical), fs.realpathSync(outsideDir));
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
  const tsxLoader = pathToFileURL(
    fs.realpathSync(
      path.resolve(__dirname, '../node_modules/tsx/dist/loader.mjs'),
    ),
  ).href;
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
