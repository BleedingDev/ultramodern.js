import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveSourceFederationDependencies } from './native-federation-source-dependencies.mjs';

assert(
  process.env.OWNED_TEMP_DIR,
  'Run these filesystem tests through owned-temp-dir',
);

function declaredGraph(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(process.env.OWNED_TEMP_DIR, 'source-mf-graph-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const owner = path.join(root, 'packages/solutions/app-tools-extensions');
  const manifests = {
    owner: path.join(owner, 'package.json'),
  };
  const expected = {};
  const roots = {};
  const links = {};
  fs.mkdirSync(owner, { recursive: true });
  fs.writeFileSync(
    manifests.owner,
    JSON.stringify({
      name: '@modern-js/app-tools-extensions',
      devDependencies: { '@module-federation/modern-js-v3': '2.9.2' },
    }),
  );
  const packages = {
    plugin: {
      name: '@module-federation/modern-js-v3',
      version: '2.9.2',
      dependencies: {
        '@module-federation/enhanced': '2.9.2',
        '@module-federation/node': '2.7.52',
      },
    },
    enhanced: { name: '@module-federation/enhanced', version: '2.9.2' },
    node: { name: '@module-federation/node', version: '2.7.52' },
  };
  for (const [key, manifest] of Object.entries(packages)) {
    const directory = path.join(root, 'physical-packages', key);
    const entry = path.join(directory, 'dist/index.cjs');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    manifests[key] = path.join(directory, 'package.json');
    fs.writeFileSync(
      manifests[key],
      JSON.stringify({ ...manifest, main: './dist/index.cjs' }),
    );
    fs.writeFileSync(
      path.join(directory, 'dist/package.json'),
      JSON.stringify({ type: 'commonjs' }),
    );
    fs.writeFileSync(
      entry,
      "throw new Error('Dependency resolution must not execute package code');\n",
    );
    roots[key] = directory;
    if (key !== 'plugin')
      expected[key] = { root: directory, version: manifest.version, entry };
  }
  for (const [key, manifest] of Object.entries(packages)) {
    const consumer = key === 'plugin' ? owner : roots.plugin;
    const link = path.join(consumer, 'node_modules', manifest.name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(roots[key], link, 'dir');
    links[key] = link;
  }
  for (const [name, version] of [
    ['@module-federation/enhanced', '2.9.1'],
    ['@module-federation/node', '2.7.50'],
  ]) {
    const directory = path.join(
      root,
      'node_modules/.pnpm',
      `${name.replace('/', '+')}@${version}`,
      'node_modules',
      name,
    );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ name, version, main: './index.cjs' }),
    );
    fs.writeFileSync(
      path.join(directory, 'index.cjs'),
      'module.exports = {};\n',
    );
  }
  return { root, roots, links, manifests, expected };
}

function changeManifest(supplied, key, change) {
  const filename = supplied.manifests[key];
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  change(manifest);
  fs.writeFileSync(filename, JSON.stringify(manifest));
}

test('resolves the declared plugin graph instead of stale virtual-store entries', async t => {
  const supplied = declaredGraph(t);
  assert.deepEqual(
    await resolveSourceFederationDependencies(supplied.root),
    supplied.expected,
  );
});

test('requires the owner to declare its installed federation plugin', async t => {
  const supplied = declaredGraph(t);
  changeManifest(supplied, 'owner', manifest => {
    delete manifest.devDependencies['@module-federation/modern-js-v3'];
  });
  await assert.rejects(resolveSourceFederationDependencies(supplied.root), {
    code: 'ERR_ASSERTION',
    message: /must declare @module-federation\/modern-js-v3/u,
  });
});

test('requires the declared graph to belong to app-tools-extensions', async t => {
  const supplied = declaredGraph(t);
  changeManifest(supplied, 'owner', manifest => {
    manifest.name = '@unowned/source-owner';
  });
  await assert.rejects(resolveSourceFederationDependencies(supplied.root), {
    code: 'ERR_ASSERTION',
  });
});

for (const name of ['@module-federation/enhanced', '@module-federation/node']) {
  test(`requires the installed plugin to declare ${name}`, async t => {
    const supplied = declaredGraph(t);
    changeManifest(supplied, 'plugin', manifest => {
      delete manifest.dependencies[name];
    });
    await assert.rejects(resolveSourceFederationDependencies(supplied.root), {
      code: 'ERR_ASSERTION',
      message: new RegExp(`must declare ${name}`, 'u'),
    });
  });
}

for (const key of ['plugin', 'enhanced', 'node']) {
  test(`rejects a resolved ${key} package with a foreign identity`, async t => {
    const supplied = declaredGraph(t);
    changeManifest(supplied, key, manifest => {
      manifest.name = '@unowned/federation-package';
    });
    await assert.rejects(resolveSourceFederationDependencies(supplied.root), {
      code: 'ERR_ASSERTION',
      message: /resolved to another package/u,
    });
  });
}

for (const [key, declaration, version] of [
  ['owner', '@module-federation/modern-js-v3', '2.9.1'],
  ['plugin', '@module-federation/enhanced', '2.9.1'],
  ['plugin', '@module-federation/node', '2.7.50'],
]) {
  test(`rejects ${declaration} metadata that differs from its exact declared pin`, async t => {
    const supplied = declaredGraph(t);
    changeManifest(supplied, key, manifest => {
      (manifest.dependencies ?? manifest.devDependencies)[declaration] =
        version;
    });
    await assert.rejects(resolveSourceFederationDependencies(supplied.root), {
      code: 'ERR_ASSERTION',
      message: /differs from its owner's exact dependency pin/u,
    });
  });
}

test('rejects a named foreign manifest above the resolved dependency entry', async t => {
  const supplied = declaredGraph(t);
  fs.writeFileSync(
    path.join(supplied.roots.enhanced, 'dist/package.json'),
    JSON.stringify({ name: '@unowned/entry', version: '2.9.2' }),
  );
  await assert.rejects(resolveSourceFederationDependencies(supplied.root), {
    code: 'ERR_ASSERTION',
    message: /resolved to another package/u,
  });
});

test('rejects resolved dependency metadata without a version', async t => {
  const supplied = declaredGraph(t);
  changeManifest(supplied, 'node', manifest => {
    delete manifest.version;
  });
  await assert.rejects(resolveSourceFederationDependencies(supplied.root), {
    code: 'ERR_ASSERTION',
    message: /omitted its installed version/u,
  });
});

test('requires a resolvable declared dependency even when its stale copy exists', async t => {
  const supplied = declaredGraph(t);
  fs.unlinkSync(supplied.links.enhanced);
  await assert.rejects(resolveSourceFederationDependencies(supplied.root), {
    code: 'MODULE_NOT_FOUND',
    message: /Cannot find module '@module-federation\/enhanced'/u,
  });
});
