import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertNoUpstreamedPatches,
  assertRecipeConsumers,
  assertRecipeGraph,
  findUpstreamedPatches,
  isUnpublishedForkEdge,
  verifySidecar,
} from './verify-sidecars.mjs';

test('a recipe consumed only through devDependencies or an unaliased edge is rejected', () => {
  const orphan = {
    id: 'orphan',
    upstream: { name: 'orphan', version: '1.0.0' },
    fork: { name: '@bleedingdev/orphan', version: '1.0.0' },
    manifestChanges: {},
  };
  const manifest = {
    name: '@bleedingdev/modern-js-fixture',
    devDependencies: { orphan: 'npm:@bleedingdev/orphan@1.0.0' },
    dependencies: { orphan: '1.0.0' },
  };
  const consumers = {
    generatorPins: [],
    publishedManifests: [manifest],
  };
  assert.throws(
    () => assertRecipeConsumers([orphan], consumers),
    /@bleedingdev\/modern-js-fixture dependencies\.orphan is 1\.0\.0; declare npm:@bleedingdev\/orphan@1\.0\.0 in source/,
  );
  delete manifest.dependencies;
  assert.throws(
    () => assertRecipeConsumers([orphan], consumers),
    /sidecar orphan has no runtime consumer; delete the recipe or wire a consumer/,
  );
  manifest.peerDependencies = { orphan: 'npm:@bleedingdev/orphan@1.0.0' };
  assertRecipeConsumers([orphan], consumers);
});

test('a listed unpublished fork edge at the exact upstream version consumes its recipe', () => {
  const recipe = {
    id: 'rsbuild-core',
    upstream: { name: '@rsbuild/core', version: '2.2.11' },
    fork: { name: '@bleedingdev/rsbuild-core', version: '2.2.11' },
    manifestChanges: {},
  };
  const consumers = (name, specifier) => ({
    generatorPins: [],
    publishedManifests: [
      { name, dependencies: { '@rsbuild/core': specifier } },
    ],
  });
  assertRecipeConsumers(
    [recipe],
    consumers('@bleedingdev/modern-js-ultramodern-app-tools', '2.2.11'),
  );
  assert.throws(
    () =>
      assertRecipeConsumers(
        [recipe],
        consumers('@bleedingdev/modern-js-ultramodern-app-tools', '^2.2.11'),
      ),
    /declare npm:@bleedingdev\/rsbuild-core@2\.2\.11 in source/,
  );
  assert.throws(
    () =>
      assertRecipeConsumers(
        [recipe],
        consumers('@bleedingdev/modern-js-server', '2.2.11'),
      ),
    /declare npm:@bleedingdev\/rsbuild-core@2\.2\.11 in source/,
  );
  assert.equal(
    isUnpublishedForkEdge(
      'packages/cli/builder',
      '@rsbuild/core',
      '2.2.11(core-js@3.50.0)',
      recipe,
    ),
    true,
  );
});

test('recipes reached only through a reachable recipe alias edge are consumed', () => {
  const child = {
    id: 'child',
    upstream: { name: 'child', version: '1.0.0' },
    fork: { name: '@bleedingdev/child', version: '1.0.0' },
    manifestChanges: {},
  };
  const parent = {
    id: 'parent',
    upstream: { name: 'parent', version: '1.0.0' },
    fork: { name: '@bleedingdev/parent', version: '1.0.0' },
    manifestChanges: {
      devDependencies: { child: 'npm:@bleedingdev/child@1.0.0' },
    },
  };
  const consumers = {
    generatorPins: [{ parent: 'npm:@bleedingdev/parent@1.0.0' }],
    publishedManifests: [],
  };
  assert.throws(
    () => assertRecipeConsumers([parent, child], consumers),
    /sidecar child has no runtime consumer/,
  );
  parent.manifestChanges = {
    dependencies: { child: 'npm:@bleedingdev/child@1.0.0' },
  };
  assertRecipeConsumers([parent, child], consumers);
});

test('only exact generator runtime pins of the recipe fork version are consumers', () => {
  const recipe = {
    id: 'pinned',
    upstream: { name: 'pinned', version: '1.0.0' },
    fork: { name: '@bleedingdev/pinned', version: '1.0.1' },
    manifestChanges: {},
  };
  const consumers = generatorPins => ({
    generatorPins,
    publishedManifests: [],
  });
  for (const pins of [
    [{ pinned: 'npm:@bleedingdev/pinned@1.0.0' }],
    [{ pinned: 'npm:@bleedingdev/pinned@^1.0.1' }],
    [{ pinned: '// npm:@bleedingdev/pinned@1.0.1' }],
  ])
    assert.throws(
      () => assertRecipeConsumers([recipe], consumers(pins)),
      /sidecar pinned has no runtime consumer/,
    );
  assertRecipeConsumers(
    [recipe],
    consumers([{ pinned: 'npm:@bleedingdev/pinned@1.0.1' }]),
  );
});

const graphRecipe = (id, { patch = null, manifestChanges = {} } = {}) => ({
  id,
  upstream: { name: id, version: '1.0.0' },
  fork: { name: `@bleedingdev/${id}`, version: '1.0.0' },
  patch,
  manifestChanges,
});
const aliasOf = id => ({
  dependencies: { [id]: `npm:@bleedingdev/${id}@1.0.0` },
});

test('a patch:null parent whose patched child was removed is rejected', () => {
  const child = graphRecipe('child', { patch: { path: 'child.patch' } });
  const parent = graphRecipe('parent', { manifestChanges: aliasOf('child') });
  assertRecipeGraph([parent, child]);
  assert.throws(
    () => assertRecipeGraph([parent]),
    /sidecar parent dependencies.child aliases npm:@bleedingdev\/child@1.0.0, which no sidecar recipe publishes; restore the recipe or drop the alias/,
  );
  assert.throws(
    () =>
      assertRecipeGraph([parent, child], {
        generatorPins: [{ gone: 'npm:@bleedingdev/gone@1.0.0' }],
      }),
    /generator pin gone aliases npm:@bleedingdev\/gone@1.0.0, which no sidecar recipe publishes/,
  );
  parent.manifestChanges = {};
  assert.throws(
    () => assertRecipeGraph([parent]),
    /sidecar parent has no patched descendant; delete recipe/,
  );
  // A dev-only alias does not rewire what consumers run.
  parent.manifestChanges = { devDependencies: aliasOf('child').dependencies };
  assert.throws(
    () => assertRecipeGraph([parent, child]),
    /sidecar parent has no patched descendant; delete recipe/,
  );
  // A non-alias manifest change is a correction the recipe carries itself.
  parent.manifestChanges = { dependencies: { child: '^2.0.3' } };
  assertRecipeGraph([parent]);
});

test('a patch already present upstream reports the recipe and its ancestors as retirable', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-retire-'));
  try {
    const patchBytes = Buffer.from(
      [
        '--- a/index.js',
        '+++ b/index.js',
        '@@ -1 +1 @@',
        '-export const fixed = false;',
        '+export const fixed = true;',
        '',
      ].join('\n'),
    );
    const patchPath = path.join(directory, 'child.patch');
    fs.writeFileSync(patchPath, patchBytes);
    const child = graphRecipe('child', {
      patch: {
        path: patchPath,
        sha256: createHash('sha256').update(patchBytes).digest('hex'),
      },
    });
    const parent = graphRecipe('parent', { manifestChanges: aliasOf('child') });
    const grandparent = graphRecipe('grandparent', {
      manifestChanges: aliasOf('parent'),
    });
    const sibling = graphRecipe('sibling', { patch: child.patch });
    const patchedParent = graphRecipe('patched-parent', {
      patch: { path: 'unused.patch' },
      manifestChanges: aliasOf('parent'),
    });
    const recipeList = [grandparent, parent, child, patchedParent];
    const release = source => {
      const packageDir = path.join(directory, 'package');
      fs.rmSync(packageDir, { recursive: true, force: true });
      fs.mkdirSync(packageDir);
      fs.writeFileSync(path.join(packageDir, 'index.js'), `${source}\n`);
      const tarball = path.join(directory, 'latest.tgz');
      execFileSync('tar', ['-czf', tarball, '-C', directory, 'package']);
      return { bytes: fs.readFileSync(tarball), version: '1.0.1' };
    };

    const unfixed = release('export const fixed = false;');
    assert.equal(
      (
        await findUpstreamedPatches([child], {
          latestTarball: async () => unfixed,
        })
      ).size,
      0,
    );

    const fixed = release('export const fixed = true;');
    const upstreamed = await findUpstreamedPatches([child, sibling], {
      latestTarball: async () => fixed,
    });
    assert.deepEqual(
      [...upstreamed],
      [
        [child, '1.0.1'],
        [sibling, '1.0.1'],
      ],
    );
    upstreamed.delete(sibling);
    assert.throws(
      () => assertNoUpstreamedPatches(recipeList, upstreamed),
      error => {
        assert.equal(
          error.message,
          [
            'sidecar child patch is already present in child@1.0.1',
            'retirable sidecars: grandparent, parent, child; delete these recipes and move their consumers to the upstream release',
            'sidecar patched-parent must drop dependencies.parent npm:@bleedingdev/parent@1.0.0 when parent is retired',
          ].join('\n'),
        );
        return true;
      },
    );
    assertNoUpstreamedPatches(recipeList, new Map());
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('explicit offline provenance fails closed on missing or tampered tarballs', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sidecar-integrity-'),
  );
  try {
    for (const id of ['mf-cli', 'jiti', 'rsbuild-core']) {
      await assert.rejects(
        verifySidecar(id, { artifactsDir: directory }),
        /ENOENT/,
      );
      fs.writeFileSync(path.join(directory, `${id}.tgz`), 'untrusted bytes');
      await assert.rejects(
        verifySidecar(id, { artifactsDir: directory }),
        /upstream tarball integrity/,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('reconstruction drops node_modules the upstream tarball shipped but pnpm never installs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-node-'));
  try {
    const recipe = JSON.parse(
      fs.readFileSync(new URL('./sidecars.json', import.meta.url), 'utf8'),
    ).find(item => item.id === 'mf-node');
    const response = await fetch(recipe.upstream.tarball, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok);
    const tarball = path.join(directory, 'mf-node.tgz');
    fs.writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
    const shipped = execFileSync('tar', ['-tzf', tarball], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(entry => entry.split('/').includes('node_modules'));
    assert.ok(shipped.length > 0, 'upstream fixture still ships node_modules');
    const packageDir = path.join(directory, 'reconstructed');
    await verifySidecar('mf-node', {
      artifactsDir: directory,
      materializeTo: packageDir,
    });
    const stack = [packageDir];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        assert.notEqual(entry.name, 'node_modules', current);
        if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      }
    }
    assert.ok(fs.statSync(path.join(packageDir, 'dist/src/index.js')).isFile());
    await verifySidecar('mf-node', { artifactsDir: directory, packageDir });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Rsbuild reconstruction preserves the complete public package and rejects unpatched, modified, missing and mode drift', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rsbuild-reconstruction-'),
  );
  try {
    const recipe = JSON.parse(
      fs.readFileSync(new URL('./sidecars.json', import.meta.url), 'utf8'),
    ).find(item => item.id === 'rsbuild-core');
    const response = await fetch(recipe.upstream.tarball, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok);
    fs.writeFileSync(
      path.join(directory, 'rsbuild-core.tgz'),
      Buffer.from(await response.arrayBuffer()),
    );
    const packageDir = path.join(directory, 'maintained');
    const upstream = await verifySidecar('rsbuild-core', {
      artifactsDir: directory,
      materializeTo: packageDir,
    });
    const packedManifest = JSON.parse(
      fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
    );
    for (const field of [
      'exports',
      'types',
      'bin',
      'dependencies',
      'peerDependencies',
      'license',
    ])
      assert.deepEqual(
        packedManifest[field],
        upstream[field],
        `Rsbuild public ${field}`,
      );
    const options = { artifactsDir: directory, packageDir };
    await verifySidecar('rsbuild-core', options);
    const runtime = path.join(packageDir, 'dist/m.js');
    const original = fs.readFileSync(runtime);
    fs.writeFileSync(
      runtime,
      execFileSync(
        'tar',
        ['-xOf', path.join(directory, 'rsbuild-core.tgz'), 'package/dist/m.js'],
        { maxBuffer: 16 * 1024 * 1024 },
      ),
    );
    await assert.rejects(verifySidecar('rsbuild-core', options), /dist\/m.js/u);
    fs.writeFileSync(runtime, original);
    fs.appendFileSync(runtime, '\n// unreviewed runtime change\n');
    await assert.rejects(verifySidecar('rsbuild-core', options), /dist\/m.js/u);
    fs.writeFileSync(runtime, original);
    const mode = fs.statSync(runtime).mode & 0o777;
    fs.chmodSync(runtime, mode ^ 0o100);
    await assert.rejects(
      verifySidecar('rsbuild-core', options),
      /executable mode dist\/m.js/u,
    );
    fs.chmodSync(runtime, mode);
    fs.unlinkSync(runtime);
    await assert.rejects(
      verifySidecar('rsbuild-core', options),
      /complete artifact set/u,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
