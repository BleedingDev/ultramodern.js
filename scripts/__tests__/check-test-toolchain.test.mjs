import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyTestToolchain } from '../ci/check-test-toolchain.mjs';

const toolchain = {
  nodeVersion: '26.10.0',
  pnpmVersion: '12.8.1',
  miseConfig: '[tools]\nnode = "26.10.0"\npnpm = "12.8.1"\n',
  packageManager: 'pnpm@12.8.1',
};

test('accepts the exact configured toolchain and Windows command line endings', () => {
  assert.deepEqual(
    verifyTestToolchain({ ...toolchain, pnpmVersion: '12.8.1\r\n' }),
    {
      node: '26.10.0',
      pnpm: '12.8.1',
    },
  );
});

test('rejects runner Node and pnpm versions that differ from mise', () => {
  assert.throws(
    () => verifyTestToolchain({ ...toolchain, nodeVersion: '26.9.0' }),
    /Node.js version/,
  );
  assert.throws(
    () => verifyTestToolchain({ ...toolchain, pnpmVersion: '12.8.0' }),
    /pnpm version/,
  );
  assert.throws(
    () => verifyTestToolchain({ ...toolchain, pnpmVersion: undefined }),
    /pnpm version/,
  );
});

test('rejects packageManager drift and missing or unpinned tools', () => {
  assert.throws(
    () => verifyTestToolchain({ ...toolchain, packageManager: 'pnpm@12.8.0' }),
    /must agree/,
  );
  assert.throws(
    () =>
      verifyTestToolchain({
        ...toolchain,
        miseConfig: '[env]\nnode = "26.10.0"\n',
      }),
    /Missing mise tools/,
  );
  assert.throws(
    () =>
      verifyTestToolchain({
        ...toolchain,
        miseConfig: '[tools]\nnode = "latest"\npnpm = "12.8.1"\n',
      }),
    /exact mise node/,
  );
});

test('an empty pnpm command result fails the real verification process', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../ci/check-test-toolchain.mjs', import.meta.url)),
      '',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pnpm version|Node.js version/);
});
