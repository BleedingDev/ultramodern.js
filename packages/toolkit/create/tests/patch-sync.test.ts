import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES } from '../src/ultramodern-workspace/shared-patches';

const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '../../..');
const repoPatchDir = path.join(repoRoot, 'patches');
const templatePatchDir = path.join(packageRoot, 'template-workspace/patches');

function listPatchFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter(file => file.endsWith('.patch'))
    .sort();
}

test('shared UltraModern workspace patch list matches files present in both patch directories', () => {
  const repoPatchFiles = new Set(listPatchFiles(repoPatchDir));
  const templatePatchFiles = new Set(listPatchFiles(templatePatchDir));
  const actualSharedPatchFiles = [...repoPatchFiles].filter(file =>
    templatePatchFiles.has(file),
  );

  assert.deepEqual(
    [...SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES].sort(),
    actualSharedPatchFiles.sort(),
  );
});

test('shared UltraModern workspace patches stay byte-identical', () => {
  for (const patchFile of SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES) {
    const repoPatch = fs.readFileSync(path.join(repoPatchDir, patchFile));
    const templatePatch = fs.readFileSync(
      path.join(templatePatchDir, patchFile),
    );

    assert.equal(
      Buffer.compare(repoPatch, templatePatch),
      0,
      `${patchFile} must stay byte-identical in patches/ and packages/toolkit/create/template-workspace/patches/`,
    );
  }
});
