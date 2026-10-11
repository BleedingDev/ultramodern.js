import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePnpmLockfile } from '../lib/parse-pnpm-lockfile.mjs';
import { mergePnpmLockfileDocuments } from '../lib/pnpm-lockfile-documents.mjs';

test('pnpm toolchain and workspace graphs are both inspected', () => {
  const lockfile = parsePnpmLockfile(`---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm: {specifier: 12.8.1, version: 12.8.1}
packages:
  pnpm@12.8.1: {resolution: {integrity: manager}}
snapshots:
  pnpm@12.8.1: {}
---
lockfileVersion: '9.0'
settings: {autoInstallPeers: false}
importers:
  .:
    dependencies:
      effect: {specifier: 4.0.0, version: 4.0.0}
packages:
  effect@4.0.0: {resolution: {integrity: runtime}}
snapshots:
  effect@4.0.0: {}
`);
  assert.deepEqual(Object.keys(lockfile.packages), [
    'pnpm@12.8.1',
    'effect@4.0.0',
  ]);
  assert.deepEqual(Object.keys(lockfile.snapshots), [
    'pnpm@12.8.1',
    'effect@4.0.0',
  ]);
  assert.equal(
    lockfile.importers['.'].packageManagerDependencies.pnpm.version,
    '12.8.1',
  );
  assert.equal(lockfile.importers['.'].dependencies.effect.version, '4.0.0');
  assert.equal(lockfile.settings.autoInstallPeers, false);
});

test('single-document parser results retain their shape', () => {
  const lockfile = { lockfileVersion: '9.0', packages: {} };
  assert.equal(mergePnpmLockfileDocuments(lockfile), lockfile);
});

test('malformed or mismatched lockfile documents fail', () => {
  assert.throws(() => parsePnpmLockfile('a: [invalid'));
  assert.throws(() => mergePnpmLockfileDocuments([{}, {}]), /Expected pnpm/);
  assert.throws(
    () =>
      mergePnpmLockfileDocuments([
        { lockfileVersion: '9.0' },
        { lockfileVersion: '8.0' },
      ]),
    /Conflicting/,
  );
});
