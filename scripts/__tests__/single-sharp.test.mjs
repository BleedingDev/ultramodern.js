import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

// Two sharp copies in one process load two libvips builds that share GLib
// type registrations: image decoding logs GLib-GObject-CRITICAL and fails on
// Windows. The image path (plugin-image, the ipx sidecar, @rsbuild-image/*)
// must resolve the single sharp its published consumers get.
function sharpVersions(lockfileText) {
  return Object.keys(parse(lockfileText).packages ?? {})
    .filter(key => key.startsWith('sharp@'))
    .map(key => key.slice('sharp@'.length));
}

test('the workspace lockfile resolves exactly one sharp version', () => {
  const versions = sharpVersions(
    readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8'),
  );
  assert.equal(versions.length, 1, `sharp versions: ${versions.join(', ')}`);
});

test('a lockfile with the upstream ipx sharp beside the sidecar sharp fails', () => {
  const versions = sharpVersions(`
lockfileVersion: '9.0'
packages:
  ipx@3.1.1:
    resolution: {integrity: sha512-a}
  sharp@0.34.5:
    resolution: {integrity: sha512-b}
  sharp@0.35.4:
    resolution: {integrity: sha512-c}
`);
  assert.deepEqual(versions, ['0.34.5', '0.35.4']);
});
