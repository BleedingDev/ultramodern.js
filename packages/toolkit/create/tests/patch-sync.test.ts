import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRpcContractFile } from '../src/ultramodern-workspace/api/rpc';
import { SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES } from '../src/ultramodern-workspace/shared-patches';
import {
  EFFECT_VERSION,
  MODULE_FEDERATION_VERSION,
  TYPES_NODE_VERSION,
} from '../src/ultramodern-workspace/versions';

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

function assertPatchReversesAndReapplies(packageName: string): void {
  const patchFile = `@module-federation__${packageName}@${MODULE_FEDERATION_VERSION}.patch`;
  const patchPath = path.join(repoPatchDir, patchFile);
  const pnpmModulesDir = path.join(repoRoot, 'node_modules/.pnpm');
  const packageStoreEntry = fs
    .readdirSync(pnpmModulesDir)
    .find(entry =>
      entry.startsWith(
        `@module-federation+${packageName}@${MODULE_FEDERATION_VERSION}_patch_hash=`,
      ),
    );

  assert.ok(
    packageStoreEntry,
    `@module-federation/${packageName}@${MODULE_FEDERATION_VERSION} must be installed for patch validation`,
  );

  const installedPackageDir = path.join(
    pnpmModulesDir,
    packageStoreEntry,
    `node_modules/@module-federation/${packageName}`,
  );
  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `modern-js-mf-${packageName}-patch-`),
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
}

function assertEffectPatchAppliesAndPublicSurfaceCompiles(): void {
  const patchPath = path.join(
    templatePatchDir,
    'effect-schema-error-type-id.patch',
  );
  const pnpmModulesDir = path.join(repoRoot, 'node_modules/.pnpm');
  const packageStoreEntry = fs
    .readdirSync(pnpmModulesDir)
    .find(entry => entry.startsWith(`effect@${EFFECT_VERSION}`));

  assert.ok(
    packageStoreEntry,
    `effect@${EFFECT_VERSION} must be installed for patch validation`,
  );

  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-js-effect-public-patch-proof-'),
  );
  try {
    const installedPackageDir = path.join(
      pnpmModulesDir,
      packageStoreEntry,
      'node_modules/effect',
    );
    const temporaryPackageDir = path.join(temporaryDir, 'node_modules/effect');
    fs.mkdirSync(path.dirname(temporaryPackageDir), { recursive: true });
    fs.cpSync(installedPackageDir, temporaryPackageDir, { recursive: true });
    const effectPackageJson = JSON.parse(
      fs.readFileSync(path.join(installedPackageDir, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    for (const dependencyName of Object.keys(
      effectPackageJson.dependencies ?? {},
    )) {
      const installedDependencyPath = path.join(
        pnpmModulesDir,
        packageStoreEntry,
        'node_modules',
        dependencyName,
      );
      const temporaryDependencyPath = path.join(
        temporaryDir,
        'node_modules',
        dependencyName,
      );
      fs.mkdirSync(path.dirname(temporaryDependencyPath), { recursive: true });
      fs.symlinkSync(
        fs.realpathSync(installedDependencyPath),
        temporaryDependencyPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }

    const typesNodeVersion = TYPES_NODE_VERSION.replace(/^\^/, '');
    const typesNodeStoreEntry = fs
      .readdirSync(pnpmModulesDir)
      .find(entry => entry.startsWith(`@types+node@${typesNodeVersion}`));
    assert.ok(
      typesNodeStoreEntry,
      `@types/node@${typesNodeVersion} must be installed for Effect public compile validation`,
    );
    const typesNodeModulesDir = path.join(
      pnpmModulesDir,
      typesNodeStoreEntry,
      'node_modules',
    );
    for (const dependencyName of ['@types/node', 'undici-types']) {
      const installedDependencyPath = path.join(
        typesNodeModulesDir,
        dependencyName,
      );
      const temporaryDependencyPath = path.join(
        temporaryDir,
        'node_modules',
        dependencyName,
      );
      fs.mkdirSync(path.dirname(temporaryDependencyPath), { recursive: true });
      fs.symlinkSync(
        fs.realpathSync(installedDependencyPath),
        temporaryDependencyPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }

    const pluginBffStubDir = path.join(
      temporaryDir,
      'node_modules/@modern-js/plugin-bff',
    );
    fs.mkdirSync(pluginBffStubDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginBffStubDir, 'package.json'),
      `${JSON.stringify(
        {
          name: '@modern-js/plugin-bff',
          exports: {
            './effect-client': {
              types: './effect-client.d.ts',
              default: './effect-client.js',
            },
          },
          type: 'module',
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(pluginBffStubDir, 'effect-client.d.ts'),
      "export * as Schema from 'effect/Schema';\n",
    );
    fs.writeFileSync(path.join(pluginBffStubDir, 'effect-client.js'), '');
    execFileSync('git', ['apply', '--check', patchPath], {
      cwd: temporaryPackageDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['apply', patchPath], {
      cwd: temporaryPackageDir,
      stdio: 'pipe',
    });
    assert.equal(
      fs
        .readFileSync(
          path.join(temporaryPackageDir, 'dist/Schema.d.ts'),
          'utf8',
        )
        .includes('SchemaAST.Sentinel'),
      false,
      'Effect patch must repair the dangling public SchemaAST.Sentinel type',
    );

    const proofPath = path.join(temporaryDir, 'public-effect-proof.ts');
    fs.writeFileSync(
      proofPath,
      createRpcContractFile({
        id: 'public-proof',
        api: {
          stem: 'public-proof',
          prefix: '/public-proof-api',
          consumedBy: ['shell-super-app'],
          protocol: 'rpc',
        },
      }),
    );
    execFileSync(
      path.join(
        repoRoot,
        `node_modules/.bin/${process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo'}`,
      ),
      [
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        '--lib',
        'ES2022,DOM,DOM.Iterable,ESNext.Disposable',
        '--types',
        'node',
        proofPath,
      ],
      { cwd: temporaryDir, stdio: 'inherit' },
    );
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
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

for (const packageName of [
  'bridge-react',
  'manifest',
  'modern-js-v3',
  'rspack',
]) {
  test(`Module Federation ${packageName} patch reverses and reapplies cleanly`, () => {
    assertPatchReversesAndReapplies(packageName);
  });
}

test('Effect patch applies and the generated RPC public surface compiles', () => {
  assertEffectPatchAppliesAndPublicSurfaceCompiles();
});
