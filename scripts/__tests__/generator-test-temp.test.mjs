import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generatorTestTempParent } from '../../tests/utils/generatorTestTemp.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-generator-temp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repository');
  const runnerTemp = path.join(root, 'runner-temp');
  fs.mkdirSync(repository);
  fs.mkdirSync(runnerTemp);
  return { root, repository, runnerTemp };
}

test('runner temp creates isolated roots without touching sibling contents', t => {
  const { repository, runnerTemp } = fixture(t);
  const sibling = path.join(runnerTemp, 'another-owner.txt');
  fs.writeFileSync(sibling, 'keep');
  const parent = generatorTestTempParent(repository, runnerTemp);
  assert.equal(parent, fs.realpathSync(runnerTemp));
  const owned = fs.mkdtempSync(path.join(parent, 'modern-create-fixture-'));
  assert.equal(path.dirname(owned), parent);
  fs.rmSync(owned, { recursive: true, force: true });
  assert.equal(fs.readFileSync(sibling, 'utf8'), 'keep');
});

test('local execution without runner temp keeps the OS temporary directory', t => {
  const { repository } = fixture(t);
  const prior = process.env.RUNNER_TEMP;
  delete process.env.RUNNER_TEMP;
  try {
    assert.equal(
      generatorTestTempParent(repository),
      fs.realpathSync(os.tmpdir()),
    );
  } finally {
    if (prior === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = prior;
  }
});

test('explicit runner temp rejects empty, relative, missing and file paths', t => {
  const { root, repository } = fixture(t);
  for (const invalid of ['', 'relative-temp']) {
    assert.throws(
      () => generatorTestTempParent(repository, invalid),
      /RUNNER_TEMP must be an absolute directory path/u,
    );
  }
  const file = path.join(root, 'file');
  fs.writeFileSync(file, 'not a directory');
  for (const invalid of [path.join(root, 'missing'), file]) {
    assert.throws(
      () => generatorTestTempParent(repository, invalid),
      /RUNNER_TEMP must be an existing writable directory/u,
    );
  }
});

test('runner temp cannot be the repository or a source descendant', t => {
  const { repository } = fixture(t);
  const nested = path.join(repository, 'temp');
  fs.mkdirSync(nested);
  for (const invalid of [repository, nested]) {
    assert.throws(
      () => generatorTestTempParent(repository, invalid),
      /RUNNER_TEMP must be outside the source repository/u,
    );
  }
});

test('canonical paths prevent a symlink from placing installs in the source tree', t => {
  const { root, repository } = fixture(t);
  const nested = path.join(repository, 'temp');
  fs.mkdirSync(nested);
  const linked = path.join(root, 'linked-temp');
  fs.symlinkSync(
    nested,
    linked,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(
    () => generatorTestTempParent(repository, linked),
    /RUNNER_TEMP must be outside the source repository/u,
  );
});
