import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  __transactionTestHooks,
  recoverFreshWorkspaceTransactions,
  recoverWorkspaceTransactions,
  runFreshWorkspaceTransaction,
  runWorkspaceTransaction,
  WorkspaceTransactionConflictError,
} from '../src/ultramodern-workspace/add-vertical/transaction';

function fixture() {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-update-transaction-'),
  );
  const root = path.join(parent, 'workspace');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'owned.json'), 'before');
  fs.chmodSync(path.join(root, 'owned.json'), 0o640);
  return {
    parent,
    root,
    fileMode: fs.statSync(path.join(root, 'owned.json')).mode & 0o777,
    clean: () => {
      for (const key of Object.keys(__transactionTestHooks))
        delete __transactionTestHooks[
          key as keyof typeof __transactionTestHooks
        ];
      fs.rmSync(parent, { recursive: true, force: true });
    },
  };
}

test('preview inspects prepared bytes without publishing or changing file modes', async () => {
  const f = fixture();
  try {
    __transactionTestHooks.beforePublish = () => {
      throw new Error('Preview cannot publish');
    };
    let inspected = false;
    const result = await runWorkspaceTransaction(
      f.root,
      async stage => {
        fs.writeFileSync(path.join(stage, 'owned.json'), 'after');
        return 'prepared';
      },
      {
        mode: 'preview',
        inspectChanges: changes => {
          assert.equal(changes.length, 1);
          assert.equal(changes[0].before?.content.toString(), 'before');
          assert.equal(changes[0].after?.content.toString(), 'after');
          inspected = true;
        },
      },
    );
    assert.equal(result, 'prepared');
    assert.equal(inspected, true);
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'before',
    );
    assert.equal(
      fs.statSync(path.join(f.root, 'owned.json')).mode & 0o777,
      f.fileMode,
    );
    assert.deepEqual(fs.readdirSync(f.parent), ['workspace']);
  } finally {
    f.clean();
  }
});

test('async mutation and validation finish before any live publication', async () => {
  const f = fixture();
  try {
    const pending = runWorkspaceTransaction(f.root, async stage => {
      fs.writeFileSync(path.join(stage, 'owned.json'), 'after');
      await Promise.resolve();
      assert.equal(
        fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
        'before',
      );
      assert.ok(fs.existsSync(stage));
      return 0;
    });
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'before',
    );
    assert.equal(await pending, 0);
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'after',
    );
    assert.equal(
      fs.statSync(path.join(f.root, 'owned.json')).mode & 0o777,
      f.fileMode,
    );
  } finally {
    f.clean();
  }
});

test('async rejection and failed commit predicate discard the prepared tree', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      runWorkspaceTransaction(f.root, async stage => {
        fs.writeFileSync(path.join(stage, 'owned.json'), 'after');
        await Promise.resolve();
        throw new Error('target validation failed');
      }),
      /target validation failed/,
    );
    assert.equal(
      await runWorkspaceTransaction(
        f.root,
        async stage => {
          fs.writeFileSync(path.join(stage, 'owned.json'), 'after');
          return 23;
        },
        { commitWhen: status => status === 0 },
      ),
      23,
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'before',
    );
  } finally {
    f.clean();
  }
});

test('async concurrent consumer change conflicts without overwriting it', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      runWorkspaceTransaction(f.root, async stage => {
        fs.writeFileSync(path.join(stage, 'owned.json'), 'after');
        await Promise.resolve();
        fs.writeFileSync(path.join(f.root, 'owned.json'), 'consumer');
      }),
      WorkspaceTransactionConflictError,
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'consumer',
    );
  } finally {
    f.clean();
  }
});

function crashDuringPublication(root: string) {
  const transactionUrl = pathToFileURL(
    path.resolve(
      __dirname,
      '../src/ultramodern-workspace/add-vertical/transaction.ts',
    ),
  ).href;
  const loaderUrl = pathToFileURL(
    fs.realpathSync(
      path.resolve(__dirname, '../node_modules/tsx/dist/loader.mjs'),
    ),
  ).href;
  return spawnSync(
    process.execPath,
    [
      '--import',
      loaderUrl,
      '--input-type=module',
      '--eval',
      `
    import fs from 'node:fs';
    import path from 'node:path';
    import { runWorkspaceTransaction, __transactionTestHooks } from ${JSON.stringify(transactionUrl)};
    __transactionTestHooks.afterPublishPath = () => process.kill(process.pid, 'SIGKILL');
    runWorkspaceTransaction(process.cwd(), stage => {
      fs.writeFileSync(path.join(stage, 'owned.json'), 'after');
      fs.writeFileSync(path.join(stage, 'second.json'), 'after second');
    });
  `,
    ],
    { cwd: root, encoding: 'utf8' },
  );
}

function crashDuringFreshPublication(
  root: string,
  phase = 'file',
  targetPath = root,
) {
  const transactionUrl = pathToFileURL(
    path.resolve(
      __dirname,
      '../src/ultramodern-workspace/add-vertical/transaction.ts',
    ),
  ).href;
  const loaderUrl = pathToFileURL(
    fs.realpathSync(
      path.resolve(__dirname, '../node_modules/tsx/dist/loader.mjs'),
    ),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      loaderUrl,
      '--input-type=module',
      '--eval',
      `
    import fs from 'node:fs';
    import path from 'node:path';
    import { runFreshWorkspaceTransaction, __transactionTestHooks } from ${JSON.stringify(transactionUrl)};
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const phase = ${JSON.stringify(phase)};
    const rename = fs.renameSync;
    fs.renameSync = (source, target) => {
      rename(source, target);
      if (phase === 'directory' && path.basename(source).startsWith('.ultramodern-directory-')) process.kill(process.pid, 'SIGKILL');
      if (phase === 'committed' && target.endsWith('.receipt.json') && JSON.parse(fs.readFileSync(target, 'utf8')).state === 'committed') process.kill(process.pid, 'SIGKILL');
    };
    __transactionTestHooks.afterPublishPath = () => {
      if (phase === 'file') process.kill(process.pid, 'SIGKILL');
    };
    runFreshWorkspaceTransaction(${JSON.stringify(targetPath)}, stage => {
      fs.mkdirSync(path.join(stage, 'nested/deeper'), { recursive: true });
      fs.writeFileSync(path.join(stage, 'nested/deeper/first.txt'), 'first');
      fs.writeFileSync(path.join(stage, 'nested/second.txt'), 'second');
    });
  `,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    process.platform === 'win32' ? 1 : null,
    result.stderr,
  );
  assert.equal(
    result.signal,
    process.platform === 'win32' ? null : 'SIGKILL',
    result.stderr,
  );
}

test('fresh retry recovers nested files and directory ownership after hard interruption', () => {
  for (const phase of ['directory', 'file']) {
    const f = fixture();
    try {
      fs.unlinkSync(path.join(f.root, 'owned.json'));
      const identity = fs.statSync(f.root);
      crashDuringFreshPublication(f.root, phase);
      recoverWorkspaceTransactions(f.root);
      assert.ok(
        fs.readdirSync(f.parent).some(entry => entry.endsWith('.receipt.json')),
        'updater recovery must not consume fresh receipts',
      );
      runFreshWorkspaceTransaction(f.root, stage => {
        assert.equal(fs.statSync(f.root).ino, identity.ino);
        assert.deepEqual(
          fs.readdirSync(f.root),
          [],
          'fresh recovery restores the exact empty target before generation',
        );
        fs.mkdirSync(path.join(stage, 'retry'));
        fs.writeFileSync(path.join(stage, 'retry/success.txt'), 'success');
      });
      assert.equal(
        fs.readFileSync(path.join(f.root, 'retry/success.txt'), 'utf8'),
        'success',
      );
    } finally {
      f.clean();
    }
  }
});

test('fresh recovery preserves foreign bytes, replaced directories, and live-owner receipts', () => {
  for (const conflict of ['bytes', 'extra', 'directory', 'live']) {
    const f = fixture();
    try {
      fs.unlinkSync(path.join(f.root, 'owned.json'));
      crashDuringFreshPublication(f.root);
      const receiptPath = path.join(
        f.parent,
        fs
          .readdirSync(f.parent)
          .find(entry => entry.endsWith('.receipt.json'))!,
      );
      if (conflict === 'bytes')
        fs.writeFileSync(
          path.join(f.root, 'nested/deeper/first.txt'),
          'consumer',
        );
      if (conflict === 'extra')
        fs.writeFileSync(path.join(f.root, 'consumer.txt'), 'consumer');
      if (conflict === 'directory') {
        fs.renameSync(
          path.join(f.root, 'nested'),
          path.join(f.parent, 'preserved-nested'),
        );
        fs.mkdirSync(path.join(f.root, 'nested'));
      }
      if (conflict === 'live') {
        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        receipt.pid = process.pid;
        fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      }
      const snapshot = () =>
        fs
          .readdirSync(f.parent, { recursive: true, withFileTypes: true })
          .filter(entry => entry.isFile())
          .map(entry => {
            const filePath = path.join(entry.parentPath, entry.name);
            return [filePath, fs.readFileSync(filePath).toString('base64')];
          })
          .sort();
      const before = snapshot();
      if (conflict === 'live') {
        // Rstest guards calls targeting its own process. Exercise native
        // signal-zero ownership probing from a separate Node process.
        const result = spawnSync(
          process.execPath,
          [
            '--import',
            pathToFileURL(
              fs.realpathSync(
                path.resolve(__dirname, '../node_modules/tsx/dist/loader.mjs'),
              ),
            ).href,
            '--input-type=module',
            '--eval',
            `
            import assert from 'node:assert/strict';
            import { recoverFreshWorkspaceTransactions } from ${JSON.stringify(pathToFileURL(path.resolve(__dirname, '../src/ultramodern-workspace/add-vertical/transaction.ts')).href)};
            assert.throws(() => recoverFreshWorkspaceTransactions(process.cwd()), /still owned/);
          `,
          ],
          { cwd: f.root, encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.stderr);
      } else {
        assert.throws(
          () =>
            runFreshWorkspaceTransaction(f.root, () =>
              assert.fail('must not regenerate a conflicted target'),
            ),
          /newer consumer|directory changed/,
        );
      }
      assert.deepEqual(snapshot(), before);
      assert.ok(fs.existsSync(receiptPath));
    } finally {
      f.clean();
    }
  }
});

test('fresh recovery leaves committed output and ignores updater receipts', () => {
  const f = fixture();
  try {
    crashDuringPublication(f.root);
    recoverFreshWorkspaceTransactions(f.root);
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'after',
    );
    assert.ok(
      fs.readdirSync(f.parent).some(entry => entry.endsWith('.receipt.json')),
    );
    recoverWorkspaceTransactions(f.root);
    fs.unlinkSync(path.join(f.root, 'owned.json'));
    crashDuringFreshPublication(f.root, 'committed');
    const preserved = path.join(f.parent, 'preserved-committed');
    fs.renameSync(path.join(f.root, 'nested'), preserved);
    fs.mkdirSync(path.join(f.root, 'nested'));
    assert.throws(
      () => recoverFreshWorkspaceTransactions(f.root),
      /directory changed/,
    );
    assert.ok(
      fs.readdirSync(f.parent).some(entry => entry.endsWith('.receipt.json')),
    );
    fs.rmdirSync(path.join(f.root, 'nested'));
    fs.renameSync(preserved, path.join(f.root, 'nested'));
    fs.writeFileSync(
      path.join(f.root, 'consumer.txt'),
      'consumer after commit',
    );
    assert.throws(
      () =>
        runFreshWorkspaceTransaction(f.root, () =>
          assert.fail('completed output must not be replaced'),
        ),
      /Refusing to replace/,
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'nested/deeper/first.txt'), 'utf8'),
      'first',
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'nested/second.txt'), 'utf8'),
      'second',
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'consumer.txt'), 'utf8'),
      'consumer after commit',
    );
  } finally {
    f.clean();
  }
});

test('hard interruption during promotion recovers exact preimages before retry', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'second.json'), 'before second');
    const crashed = crashDuringPublication(f.root);
    assert.equal(
      crashed.status,
      process.platform === 'win32' ? 1 : null,
      crashed.stderr,
    );
    assert.equal(
      crashed.signal,
      process.platform === 'win32' ? null : 'SIGKILL',
      crashed.stderr,
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'after',
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'second.json'), 'utf8'),
      'before second',
    );
    recoverWorkspaceTransactions(f.root);
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'before',
    );
    assert.equal(
      fs.statSync(path.join(f.root, 'owned.json')).mode & 0o777,
      f.fileMode,
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'second.json'), 'utf8'),
      'before second',
    );
    assert.deepEqual(fs.readdirSync(f.root), ['owned.json', 'second.json']);
    runWorkspaceTransaction(f.root, stage =>
      fs.writeFileSync(path.join(stage, 'owned.json'), 'retry'),
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'retry',
    );
  } finally {
    f.clean();
  }
});

test('interrupted recovery preserves later consumer edits and durable preimages', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'second.json'), 'before second');
    const crashed = crashDuringPublication(f.root);
    assert.equal(
      crashed.status,
      process.platform === 'win32' ? 1 : null,
      crashed.stderr,
    );
    assert.equal(
      crashed.signal,
      process.platform === 'win32' ? null : 'SIGKILL',
      crashed.stderr,
    );
    fs.writeFileSync(path.join(f.root, 'owned.json'), 'consumer after crash');
    assert.throws(
      () => recoverWorkspaceTransactions(f.root),
      /newer consumer bytes/,
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, 'owned.json'), 'utf8'),
      'consumer after crash',
    );
    assert.ok(
      fs.readdirSync(f.parent).some(entry => entry.endsWith('.receipt.json')),
    );
    assert.ok(
      fs
        .readdirSync(f.root)
        .some(entry => entry.includes('.ultramodern-rollback-')),
    );
  } finally {
    f.clean();
  }
});

test('publication includes dist and coverage packages while excluding their generated output', () => {
  const f = fixture();
  try {
    for (const name of ['dist', 'coverage']) {
      const packageDir = path.join(f.root, 'verticals', name);
      fs.mkdirSync(path.join(packageDir, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'package.json'), 'before package');
      fs.writeFileSync(
        path.join(packageDir, 'dist/output.js'),
        'consumer output',
      );
    }
    runWorkspaceTransaction(f.root, stage => {
      for (const name of ['dist', 'coverage']) {
        const packageDir = path.join(stage, 'verticals', name);
        assert.equal(
          fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
          'before package',
        );
        assert.equal(fs.existsSync(path.join(packageDir, 'dist')), false);
        fs.writeFileSync(
          path.join(packageDir, 'package.json'),
          'after package',
        );
      }
    });
    for (const name of ['dist', 'coverage']) {
      assert.equal(
        fs.readFileSync(
          path.join(f.root, 'verticals', name, 'package.json'),
          'utf8',
        ),
        'after package',
      );
      assert.equal(
        fs.readFileSync(
          path.join(f.root, 'verticals', name, 'dist/output.js'),
          'utf8',
        ),
        'consumer output',
      );
    }
  } finally {
    f.clean();
  }
});
