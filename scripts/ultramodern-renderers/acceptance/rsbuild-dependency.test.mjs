import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveRsbuildDependency,
  rsbuildSpecifierFromRelease,
} from './rsbuild-dependency.mjs';

// These records test projection policy. The production intake obtains them
// only from readReleaseManifest, which checks the actual packed bytes.
function binding() {
  return {
    packages: [
      {
        sourceName: '@modern-js/ultramodern-app-tools',
        packageJson: {
          dependencies: {
            '@rsbuild/core': 'npm:@bleedingdev/rsbuild-core@2.2.11',
          },
        },
      },
    ],
    sidecars: {
      packages: [
        {
          name: '@bleedingdev/rsbuild-core',
          version: '2.2.11',
          packageJson: { name: '@bleedingdev/rsbuild-core', version: '2.2.11' },
        },
      ],
    },
  };
}

test('source authoring keeps its canonical patched dependency and rejects unbound aliases', () => {
  assert.equal(resolveRsbuildDependency(), '2.2.11');
  assert.equal(resolveRsbuildDependency({ specifier: '2.2.11' }), '2.2.11');
  for (const specifier of [
    'npm:@bleedingdev/rsbuild-core@2.2.11',
    'npm:@other/rsbuild-core@2.2.11',
    '^2.2.11',
    '2.2.10',
    'file:rsbuild.tgz',
  ])
    assert.throws(
      () => resolveRsbuildDependency({ specifier }),
      /exact source or manifest-bound/u,
    );
  assert.throws(
    () => resolveRsbuildDependency({ releaseManifest: 'manifest.json' }),
    /absolute release manifest/u,
  );
});

test('candidate authoring requires agreement between the owning dependency and packed maintained sidecar', () => {
  assert.equal(
    rsbuildSpecifierFromRelease(binding()),
    'npm:@bleedingdev/rsbuild-core@2.2.11',
  );
  for (const specifier of [
    '2.2.11',
    'npm:@bleedingdev/rsbuild-core@^2.2.11',
    'npm:@other/core@2.2.11',
  ]) {
    const release = binding();
    release.packages[0].packageJson.dependencies['@rsbuild/core'] = specifier;
    assert.throws(
      () => rsbuildSpecifierFromRelease(release),
      /exact verified Rsbuild sidecar/u,
    );
  }
  for (const mutate of [
    release => {
      release.sidecars.packages = [];
    },
    release => {
      release.sidecars.packages[0].version = '2.2.10';
    },
    release => {
      release.sidecars.packages[0].packageJson.name = '@rsbuild/core';
    },
    release => {
      release.sidecars.packages[0].packageJson.version = '2.2.10';
    },
  ]) {
    const release = binding();
    mutate(release);
    assert.throws(
      () => rsbuildSpecifierFromRelease(release),
      /maintained Rsbuild/u,
    );
  }
});
