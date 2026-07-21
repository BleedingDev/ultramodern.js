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

test('Module Federation adapter patch reverses and reapplies cleanly', () => {
  const patchFile = '@module-federation__modern-js-v3@2.8.0.patch';
  const patchPath = path.join(repoPatchDir, patchFile);
  const pnpmModulesDir = path.join(repoRoot, 'node_modules/.pnpm');
  const packageStoreEntry = fs.readdirSync(pnpmModulesDir).find(entry => {
    if (
      !entry.startsWith('@module-federation+modern-js-v3@2.8.0_patch_hash=')
    ) {
      return false;
    }

    const configPluginPath = path.join(
      pnpmModulesDir,
      entry,
      'node_modules/@module-federation/modern-js-v3/dist/cjs/cli/configPlugin.js',
    );
    return (
      fs.existsSync(configPluginPath) &&
      fs
        .readFileSync(configPluginPath, 'utf8')
        .includes('resolveManifestRecoveryPlugin')
    );
  });

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
  const packageStoreEntry = fs.readdirSync(pnpmModulesDir).find(entry => {
    if (
      !entry.startsWith('@module-federation+bridge-react@2.8.0_patch_hash=')
    ) {
      return false;
    }

    const packageDistDir = path.join(
      pnpmModulesDir,
      entry,
      'node_modules/@module-federation/bridge-react/dist',
    );
    if (!fs.existsSync(packageDistDir)) {
      return false;
    }

    return fs.readdirSync(packageDistDir).some(file => {
      if (!file.startsWith('lazy-load-component-plugin-')) {
        return false;
      }
      const contents = fs.readFileSync(path.join(packageDistDir, file), 'utf8');
      return (
        contents.includes('function StylesheetAsset({ href })') &&
        !contents.includes('precedence: "default"')
      );
    });
  });

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
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
});

test('Module Federation adapter delegates stylesheet injection to the Modern runtime by default', () => {
  const patch = fs.readFileSync(
    path.join(repoPatchDir, '@module-federation__modern-js-v3@2.8.0.patch'),
    'utf8',
  );

  for (const entrypoint of [
    'data-fetch.mjs',
    'index.mjs',
    'v18.mjs',
    'v19.mjs',
  ]) {
    const diffHeader = `diff --git a/dist/esm/react/${entrypoint} b/dist/esm/react/${entrypoint}`;
    const diffStart = patch.indexOf(diffHeader);
    const nextDiffStart = patch.indexOf('diff --git ', diffStart + 1);

    assert.notEqual(
      diffStart,
      -1,
      `${entrypoint} must be covered by the adapter patch`,
    );
    assert.match(
      patch.slice(diffStart, nextDiffStart === -1 ? undefined : nextDiffStart),
      /createBridgeLazyComponent\(\{\n\+\s*injectLink: false,/u,
      `${entrypoint} must delegate stylesheet injection to the Modern.js runtime`,
    );
  }

  assert.equal(
    patch.match(/injectLink: false,/gu)?.length,
    4,
    'all and only the four public React adapter entrypoints must default bridge link injection off',
  );
});

test('Module Federation bridge stylesheet dedupe stays removable in React 19', () => {
  const patch = fs.readFileSync(
    path.join(repoPatchDir, '@module-federation__bridge-react@2.8.0.patch'),
    'utf8',
  );

  assert.match(
    patch,
    /function StylesheetAsset\(\{ href \}\)/u,
    'the bridge patch must keep the client-side duplicate detector',
  );
  assert.doesNotMatch(
    patch,
    /precedence: "default"/u,
    'a React 19 precedence resource is hoisted and cannot be reliably removed when the duplicate detector settles',
  );
});
