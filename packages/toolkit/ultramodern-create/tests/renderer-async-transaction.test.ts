import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  __transactionTestHooks,
  runFreshWorkspaceTransaction,
} from '../src/ultramodern-workspace/add-vertical/transaction';

test('fresh publication waits for asynchronous config work and keeps staged output private', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-async-fresh-'));
  const target = path.join(root, 'workspace');
  let release!: () => void;
  const ready = new Promise<void>(resolve => {
    release = resolve;
  });
  try {
    const generation = runFreshWorkspaceTransaction(target, async stage => {
      fs.writeFileSync(path.join(stage, 'before-config.txt'), 'staged');
      await ready;
      fs.writeFileSync(path.join(stage, 'after-config.txt'), 'validated');
      return 'complete';
    });
    assert.equal(fs.existsSync(target), false);
    release();
    assert.equal(await generation, 'complete');
    assert.equal(
      fs.readFileSync(path.join(target, 'after-config.txt'), 'utf8'),
      'validated',
    );
    assert.deepEqual(fs.readdirSync(root), ['workspace']);
  } finally {
    release();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('asynchronous config rejection preserves an existing empty target and cleans its owned stage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-async-reject-'));
  const target = path.join(root, 'workspace');
  fs.mkdirSync(target);
  const original = fs.statSync(target);
  try {
    await assert.rejects(
      runFreshWorkspaceTransaction(target, async stage => {
        fs.writeFileSync(path.join(stage, 'partial.txt'), 'private');
        await Promise.resolve();
        throw new Error('renderer config conflicts');
      }),
      /renderer config conflicts/u,
    );
    const remaining = fs.statSync(target);
    assert.equal(remaining.ino, original.ino);
    assert.equal(remaining.dev, original.dev);
    assert.deepEqual(fs.readdirSync(target), []);
    assert.deepEqual(fs.readdirSync(root), ['workspace']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fresh publication rejects a post-validation staged source edit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-fresh-source-'));
  const target = path.join(root, 'workspace');
  let stagedConfig = '';
  try {
    __transactionTestHooks.beforeFreshPublish = () => {
      fs.writeFileSync(stagedConfig, 'renderer: octane');
    };
    await assert.rejects(
      runFreshWorkspaceTransaction(target, async stage => {
        stagedConfig = path.join(stage, 'modern.config.ts');
        fs.writeFileSync(stagedConfig, 'renderer: solid');
        return 'validated';
      }),
      /Staged workspace changed after generation validation/u,
    );
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    __transactionTestHooks.beforeFreshPublish = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
