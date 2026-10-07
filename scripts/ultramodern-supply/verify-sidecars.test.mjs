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

test('unpublished parser recipe roots require the exact consumer, dependency and upstream version', () => {
  const roots = [
    [
      'packages/toolkit/utils',
      '@bleedingdev/modern-js-utils',
      'fast-glob',
      '3.3.3',
    ],
    [
      'packages/cli/builder',
      '@bleedingdev/modern-js-builder',
      '@rsbuild/plugin-source-build',
      '1.0.7',
    ],
    [
      'packages/cli/builder',
      '@bleedingdev/modern-js-builder',
      '@rsbuild/plugin-type-check',
      '1.6.0',
    ],
    [
      'packages/toolkit/ultramodern-create',
      '@bleedingdev/modern-js-ultramodern-create',
      'ultracite',
      '7.12.2',
    ],
  ];
  for (const [importer, published, dependency, version] of roots) {
    const recipe = {
      id: dependency,
      upstream: { name: dependency, version },
      fork: { name: `@bleedingdev/${dependency.split('/').pop()}`, version },
      manifestChanges: {},
    };
    for (const consumer of [importer, published]) {
      assert.equal(
        isUnpublishedForkEdge(consumer, dependency, version, recipe),
        true,
      );
      assert.equal(
        isUnpublishedForkEdge(
          consumer,
          dependency,
          `${version}(peer@1.0.0)`,
          recipe,
        ),
        true,
      );
      for (const specifier of [
        `^${version}`,
        `${version}0`,
        `${version}-next`,
        `${version}+local`,
      ])
        assert.equal(
          isUnpublishedForkEdge(consumer, dependency, specifier, recipe),
          false,
        );
      assert.equal(
        isUnpublishedForkEdge(consumer, `${dependency}-other`, version, recipe),
        false,
      );
    }
    const consumers = {
      generatorPins: [],
      publishedManifests: [
        { name: published, dependencies: { [dependency]: version } },
      ],
    };
    assertRecipeConsumers([recipe], consumers);
    consumers.publishedManifests[0].name = '@bleedingdev/modern-js-unlisted';
    assert.throws(
      () => assertRecipeConsumers([recipe], consumers),
      /declare npm:/u,
    );
    consumers.publishedManifests[0] = {
      name: published,
      devDependencies: { [dependency]: version },
    };
    assert.throws(
      () => assertRecipeConsumers([recipe], consumers),
      /has no runtime consumer/u,
    );
  }
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
    await assert.rejects(
      verifySidecar('mf-cli', { artifactsDir: directory }),
      /ENOENT/,
    );
    fs.writeFileSync(path.join(directory, 'mf-cli.tgz'), 'untrusted bytes');
    await assert.rejects(
      verifySidecar('mf-cli', { artifactsDir: directory }),
      /upstream tarball integrity/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
