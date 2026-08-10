import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

test('Module Federation adapter patch reverses and reapplies cleanly', () => {
  const patchFile = '@module-federation__modern-js-v3@2.8.0.patch';
  const patchPath = path.join(repoPatchDir, patchFile);
  const pnpmModulesDir = path.join(repoRoot, 'node_modules/.pnpm');
  const packageStoreEntry = fs
    .readdirSync(pnpmModulesDir)
    .find(entry =>
      entry.startsWith('@module-federation+modern-js-v3@2.8.0_patch_hash='),
    );

  assert.ok(
    packageStoreEntry,
    '@module-federation/modern-js-v3@2.8.0 must be installed for patch validation',
  );

  const installedPackageDir = path.join(
    pnpmModulesDir,
    packageStoreEntry,
    'node_modules/@module-federation/modern-js-v3',
  );
  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-js-mf-patch-'),
  );

  try {
    fs.cpSync(installedPackageDir, temporaryDir, { recursive: true });
    execFileSync('git', ['apply', '--reverse', '--check', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', '--reverse', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', '--check', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
});

test('Module Federation bridge patch reverses and reapplies cleanly', () => {
  const patchFile = '@module-federation__bridge-react@2.8.0.patch';
  const patchPath = path.join(repoPatchDir, patchFile);
  const pnpmModulesDir = path.join(repoRoot, 'node_modules/.pnpm');
  const packageStoreEntry = fs
    .readdirSync(pnpmModulesDir)
    .find(entry =>
      entry.startsWith('@module-federation+bridge-react@2.8.0_patch_hash='),
    );

  assert.ok(
    packageStoreEntry,
    '@module-federation/bridge-react@2.8.0 must be installed for patch validation',
  );

  const installedPackageDir = path.join(
    pnpmModulesDir,
    packageStoreEntry,
    'node_modules/@module-federation/bridge-react',
  );
  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-js-mf-bridge-patch-'),
  );

  try {
    fs.cpSync(installedPackageDir, temporaryDir, { recursive: true });
    execFileSync('git', ['apply', '--reverse', '--check', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', '--reverse', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', '--check', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', patchPath], {
      cwd: temporaryDir,
      stdio: 'pipe',
    });
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
});
