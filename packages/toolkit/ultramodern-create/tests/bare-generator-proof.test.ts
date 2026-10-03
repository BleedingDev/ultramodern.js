import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertConformanceOutputRoot,
  assertConsumerRoot,
  createBareManifest,
} from './fixtures/installed-renderers/bare-generator-proof.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-generator-guards-'));
  const consumer = path.join(root, 'consumer');
  fs.mkdirSync(consumer);
  return {
    root,
    consumer,
    clean: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('bare consumer starts with only the exact released generator direct dependency', () => {
  const manifest = createBareManifest({
    tools: { pnpm: '11.27.1' },
    createPackage: {
      targetName: '@bleedingdev/modern-js-ultramodern-create',
      version: '3.8.3-ultramodern.candidate',
    },
  });
  assert.deepEqual(manifest.dependencies, {
    '@bleedingdev/modern-js-ultramodern-create': '3.8.3-ultramodern.candidate',
  });
  assert.equal(Object.hasOwn(manifest, 'devDependencies'), false);
  assert.equal(Object.hasOwn(manifest, 'optionalDependencies'), false);
  assert.equal(manifest.engines.node, '>=26.7.0');
});

test('an empty owned consumer outside the worktree has no ambient dependency ancestor', () => {
  const f = fixture();
  try {
    assert.equal(
      assertConsumerRoot(f.consumer),
      fs.realpathSync.native(f.consumer),
    );
  } finally {
    f.clean();
  }
});

test('consumer preflight rejects a symlink before creating files', () => {
  const f = fixture();
  try {
    const alias = path.join(f.root, 'alias');
    fs.symlinkSync(f.consumer, alias);
    assert.throws(
      () => assertConsumerRoot(alias),
      /ordinary leased directory/u,
    );
    assert.deepEqual(fs.readdirSync(f.consumer), []);
  } finally {
    f.clean();
  }
});

test('consumer preflight rejects an ambient node_modules ancestor', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.root, 'node_modules'));
    assert.throws(
      () => assertConsumerRoot(f.consumer),
      /Ambient node_modules ancestor/u,
    );
    assert.deepEqual(fs.readdirSync(f.consumer), []);
  } finally {
    f.clean();
  }
});

test('consumer preflight preserves and rejects an occupied leased directory', () => {
  const f = fixture();
  try {
    fs.writeFileSync(
      path.join(f.consumer, 'keep.txt'),
      'owned by another task',
    );
    assert.throws(() => assertConsumerRoot(f.consumer), /must be empty/u);
    assert.equal(
      fs.readFileSync(path.join(f.consumer, 'keep.txt'), 'utf8'),
      'owned by another task',
    );
  } finally {
    f.clean();
  }
});

test('conformance accepts an absent sibling outside the installed generator', () => {
  const f = fixture();
  try {
    const consumerRoot = fs.realpathSync.native(f.consumer);
    const bareRoot = path.join(consumerRoot, 'bare-generator');
    fs.mkdirSync(bareRoot);
    const outputRoot = path.join(consumerRoot, 'generated-solid');
    assertConformanceOutputRoot({ consumerRoot, bareRoot, outputRoot });
    assert.equal(fs.existsSync(outputRoot), false);
  } finally {
    f.clean();
  }
});

test('conformance rejects an output ancestor alias before writing outside its lease', () => {
  const f = fixture();
  try {
    const consumerRoot = fs.realpathSync.native(f.consumer);
    const bareRoot = path.join(consumerRoot, 'bare-generator');
    const externalRoot = path.join(f.root, 'outside-consumer');
    fs.mkdirSync(bareRoot);
    fs.mkdirSync(externalRoot);
    const alias = path.join(consumerRoot, 'alias');
    for (const target of [externalRoot, bareRoot]) {
      fs.symlinkSync(target, alias);
      assert.throws(
        () =>
          assertConformanceOutputRoot({
            consumerRoot,
            bareRoot,
            outputRoot: path.join(alias, 'generated-solid'),
          }),
        /direct sibling/u,
      );
      assert.deepEqual(fs.readdirSync(target), []);
      fs.unlinkSync(alias);
    }
  } finally {
    f.clean();
  }
});

test('conformance preserves and rejects a dangling output link', () => {
  const f = fixture();
  try {
    const consumerRoot = fs.realpathSync.native(f.consumer);
    const bareRoot = path.join(consumerRoot, 'bare-generator');
    fs.mkdirSync(bareRoot);
    const outputRoot = path.join(consumerRoot, 'generated-octane');
    const missingTarget = path.join(f.root, 'missing');
    fs.symlinkSync(missingTarget, outputRoot);
    assert.throws(
      () => assertConformanceOutputRoot({ consumerRoot, bareRoot, outputRoot }),
      /already exists/u,
    );
    assert.equal(fs.readlinkSync(outputRoot), missingTarget);
    assert.equal(fs.existsSync(missingTarget), false);
  } finally {
    f.clean();
  }
});
