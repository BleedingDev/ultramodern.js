import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const exactVersion =
  /^(?:\d+\.){2}\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function declaredRequest(manifest, name) {
  const request =
    manifest.dependencies?.[name] ??
    manifest.devDependencies?.[name] ??
    manifest.peerDependencies?.[name];
  assert(
    typeof request === 'string' && request.length > 0,
    `${manifest.name} must declare ${name}`,
  );
  return request;
}

async function resolveDependency(owner, manifest, name) {
  const request = declaredRequest(manifest, name);
  const entry = await fs.realpath(createRequire(owner).resolve(name));
  let directory = path.dirname(entry);
  for (;;) {
    let metadata;
    try {
      metadata = JSON.parse(
        await fs.readFile(path.join(directory, 'package.json'), 'utf8'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (metadata?.name) {
      assert.equal(metadata.name, name, `${name} resolved to another package`);
      assert(
        typeof metadata.version === 'string' && metadata.version.length > 0,
        `${name} omitted its installed version`,
      );
      if (exactVersion.test(request))
        assert.equal(
          metadata.version,
          request,
          `${name} differs from its owner's exact dependency pin`,
        );
      return { root: directory, version: metadata.version, entry, metadata };
    }
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `Cannot find ${name} package metadata`);
    directory = parent;
  }
}

/** Follow the workspace plugin's declared graph instead of scanning the store. */
export async function resolveSourceFederationDependencies(root) {
  const owner = path.join(
    root,
    'packages/solutions/app-tools-extensions/package.json',
  );
  const ownerManifest = JSON.parse(await fs.readFile(owner, 'utf8'));
  assert.equal(ownerManifest.name, '@modern-js/app-tools-extensions');
  const plugin = await resolveDependency(
    owner,
    ownerManifest,
    '@module-federation/modern-js-v3',
  );
  const [enhanced, node] = await Promise.all([
    resolveDependency(
      plugin.entry,
      plugin.metadata,
      '@module-federation/enhanced',
    ),
    resolveDependency(plugin.entry, plugin.metadata, '@module-federation/node'),
  ]);
  const evidence = dependency => ({
    root: dependency.root,
    version: dependency.version,
    entry: dependency.entry,
  });
  return { enhanced: evidence(enhanced), node: evidence(node) };
}
