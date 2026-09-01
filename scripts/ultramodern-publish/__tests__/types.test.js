import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateStagedTypeFiles } from '../lib/prepare-bleedingdev-packages/types.mjs';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-types-'));
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('staged type validation accepts wildcard exports with emitted declarations', () => {
  const packageDir = makeTempDir();
  try {
    const declarationDir = path.join(packageDir, 'dist/types/feature');
    fs.mkdirSync(declarationDir, { recursive: true });
    fs.writeFileSync(path.join(declarationDir, 'entry.d.ts'), 'export {};\n');

    assert.doesNotThrow(() =>
      validateStagedTypeFiles(packageDir, {
        name: '@bleedingdev/type-fixture',
        version: '1.0.0',
        exports: {
          './feature/*': {
            types: './dist/types/feature/*.d.ts',
          },
        },
      }),
    );
  } finally {
    removeDir(packageDir);
  }
});

test('staged type validation rejects unmatched and escaping wildcard exports', () => {
  const packageDir = makeTempDir();
  const outsideDir = makeTempDir();
  try {
    fs.writeFileSync(path.join(outsideDir, 'outside.d.ts'), 'export {};\n');

    for (const typePath of [
      './dist/types/missing/*.d.ts',
      `../${path.basename(outsideDir)}/*.d.ts`,
    ]) {
      assert.throws(
        () =>
          validateStagedTypeFiles(packageDir, {
            name: '@bleedingdev/type-fixture',
            version: '1.0.0',
            exports: {
              './feature/*': { types: typePath },
            },
          }),
        /declares missing type files/,
      );
    }
  } finally {
    removeDir(packageDir);
    removeDir(outsideDir);
  }
});
