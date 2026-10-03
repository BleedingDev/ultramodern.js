// Consumer: the version-preserving sidecar staging lane after the source build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import inventory from '../../../../packages/toolkit/ultramodern-create/src/ultramodern-workspace/patch-inventory.ts';
import { verifySidecar } from '../../../ultramodern-supply/verify-sidecars.mjs';

const jitiPatchedFiles = Object.freeze(['dist/jiti.cjs', 'lib/types.d.ts']);

async function stageInstalledJiti(sidecar, packageDir, repoRoot) {
  const { recipe } = sidecar;
  const patch = inventory.find(
    item => `${item.packageName}@${item.version}` === recipe.patch.inventory,
  );
  assert.ok(
    patch?.repository,
    'Jiti sidecar requires the maintained repository patch',
  );
  assert.match(patch.path, /^patches\/[^/]+\.patch$/u);
  const registration = `  '${recipe.patch.inventory}': ${patch.path}`;
  assert.ok(
    fs
      .readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
      .split('\n')
      .includes(registration),
    'Jiti sidecar requires the maintained pnpm patch registration',
  );
  const require = createRequire(
    path.join(repoRoot, 'packages/toolkit/plugin/package.json'),
  );
  const sourceDir = path.dirname(require.resolve('jiti/package.json'));
  const source = JSON.parse(
    fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'),
  );
  assert.equal(source.name, recipe.upstream.name, 'Jiti sidecar source name');
  assert.equal(
    source.version,
    recipe.upstream.version,
    'Jiti sidecar source version',
  );
  assert.equal(source.license, recipe.license, 'Jiti sidecar source license');
  fs.cpSync(sourceDir, packageDir, {
    recursive: true,
    filter: file => !['node_modules', '.git'].includes(path.basename(file)),
  });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        ...source,
        name: recipe.fork.name,
        version: recipe.fork.version,
        publishConfig: sidecar.packageJson.publishConfig,
        repository: {
          type: 'git',
          url: 'git+https://github.com/BleedingDev/ultramodern.js.git',
          directory: 'scripts/ultramodern-supply',
        },
      },
      null,
      2,
    )}\n`,
  );
  // Authenticate the complete copied installation against the pinned upstream
  // tarball plus canonical patch. This comparison leaves installed bytes intact.
  await verifySidecar(recipe.id, { packageDir });
}

function assertPackedJitiPayload(sidecar, inspection) {
  if (!sidecar.installedPatched) return;
  for (const file of jitiPatchedFiles) {
    assert.deepEqual(
      inspection.fileContents.get(file),
      fs.readFileSync(path.join(sidecar.stagedDir, file)),
      `Packed Jiti sidecar must preserve patched ${file}`,
    );
  }
}

export { assertPackedJitiPayload, stageInstalledJiti };
