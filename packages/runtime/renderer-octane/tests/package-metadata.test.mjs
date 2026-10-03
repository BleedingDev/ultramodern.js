import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { rewritePackageJson } from '../../../../scripts/ultramodern-publish/lib/prepare-bleedingdev-packages/rewrite.mjs';

const packageRoot = new URL('../', import.meta.url);
const manifest = JSON.parse(
  fs.readFileSync(new URL('package.json', packageRoot), 'utf8'),
);

test('the published SDK consumes required application-owned native peers without exotic runtime subdependencies', () => {
  const published = structuredClone(manifest);
  rewritePackageJson(
    published,
    manifest.name,
    {
      scope: 'bleedingdev',
      prefix: 'modern-js-',
      version: '3.9.0-ultramodern.0',
      dependencyVersion: '3.9.0-ultramodern.0',
      homepage: 'https://github.com/BleedingDev/ultramodern.js',
      bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues',
      repositoryUrl: 'https://github.com/BleedingDev/ultramodern.js.git',
    },
    new Set([manifest.name, '@modern-js/renderer-core', '@modern-js/tsconfig']),
  );
  assert.equal(published.name, '@bleedingdev/modern-js-renderer-octane');
  assert.equal(
    published.dependencies['@modern-js/renderer-core'],
    'npm:@bleedingdev/modern-js-renderer-core@3.9.0-ultramodern.0',
  );
  for (const name of ['octane', '@octanejs/tanstack-router']) {
    assert.equal(typeof published.peerDependencies?.[name], 'string');
    assert.equal(
      published.peerDependencies[name],
      manifest.peerDependencies[name],
    );
    assert.equal(published.dependencies?.[name], undefined);
    assert.equal(published.optionalDependencies?.[name], undefined);
    assert.notEqual(published.peerDependenciesMeta?.[name]?.optional, true);
  }
  for (const dependencies of [
    published.dependencies,
    published.optionalDependencies,
  ]) {
    for (const specifier of Object.values(dependencies ?? {})) {
      assert.doesNotMatch(specifier, /^(?:https?:|git(?:\+|:)|file:|link:)/u);
    }
  }
});

test('SDK development retains the immutable native artifacts matching its installed peer versions', () => {
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    const nativeManifest = JSON.parse(
      fs.readFileSync(
        new URL(`node_modules/${name}/package.json`, packageRoot),
        'utf8',
      ),
    );
    assert.equal(nativeManifest.name, name);
    assert.equal(nativeManifest.version, version);
    const transport = new URL(manifest.devDependencies[name]);
    assert.equal(transport.protocol, 'https:');
    assert.equal(transport.hostname, 'github.com');
    const file = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;
    assert.equal(
      decodeURIComponent(transport.pathname),
      `/bleedingdev/octane/releases/download/${name}@${version}/${file}`,
    );
  }
});
