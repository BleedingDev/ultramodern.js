// Run with node --experimental-vm-modules --test scripts/ultramodern-supply/react-bridge.test.mjs.
// Set ULTRAMODERN_REACT_BRIDGE_MANIFEST to test a candidate's sidecars in memory.
// Or set ULTRAMODERN_REACT_BRIDGE_SIDECARS_MANIFEST to the producer's sidecars.json.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import {
  sidecarManifestSchema,
  sidecarManifestSchemaVersion,
  sidecarScope,
  sidecarTarballsDirectory,
} from '../ultramodern-publish/lib/prepare-bleedingdev-packages/constants.mjs';
import {
  canonicalJson,
  inspectNpmTarball,
  verifySidecarArtifacts,
} from '../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';

const baseSpecifier = '@module-federation/bridge-react/base';
const routerSpecifier = /^react-router(?:-dom)?(?:\/|$)/;
const expectedExports = [
  'CacheSize',
  'CacheTime',
  'ERROR_TYPE',
  'autoFetchDataPlugin',
  'cache',
  'callDataFetch',
  'clearStore',
  'collectSSRAssets',
  'configureCache',
  'createBridgeComponent',
  'createLazyComponent',
  'createRemoteAppComponent',
  'createRemoteComponent',
  'generateKey',
  'lazyLoadComponentPlugin',
  'prefetch',
  'revalidateTag',
  'setSSREnv',
];

function findPackageRoot(entry) {
  let directory = path.dirname(entry);
  while (!fs.existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `No package.json for ${entry}`);
    directory = parent;
  }
  return directory;
}

function readStandaloneSidecars(manifestPath) {
  const artifactRoot = path.dirname(manifestPath);
  const readRegularFile = filename => {
    assert.ok(fs.lstatSync(filename).isFile(), `Unsafe file: ${filename}`);
    return fs.readFileSync(filename);
  };
  const manifestBytes = readRegularFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(
    manifestBytes.toString('utf8'),
    `${canonicalJson(manifest, 2)}\n`,
  );
  assert.deepEqual(
    Object.keys(manifest).sort(),
    [
      'packages',
      ...(Object.hasOwn(manifest, 'publishBefore') ? ['publishBefore'] : []),
      'publishOrder',
      'schema',
      'schemaVersion',
    ].sort(),
  );
  assert.equal(manifest.schema, sidecarManifestSchema);
  assert.equal(manifest.schemaVersion, sidecarManifestSchemaVersion);
  if (Object.hasOwn(manifest, 'publishBefore')) {
    assert.equal(typeof manifest.publishBefore, 'string');
    assert.ok(manifest.publishBefore.trim());
  }
  assert.ok(Array.isArray(manifest.packages) && manifest.packages.length > 0);
  assert.ok(Array.isArray(manifest.publishOrder));
  const tarballsDir = path.join(artifactRoot, sidecarTarballsDirectory);
  assert.ok(
    fs.lstatSync(tarballsDir).isDirectory(),
    'Unsafe tarballs directory',
  );
  const names = [];
  const tarballNames = [];
  const packages = manifest.packages.map(item => {
    assert.deepEqual(Object.keys(item).sort(), [
      'fileCount',
      'fileListSha256',
      'integrity',
      'name',
      'packageJsonSha256',
      'root',
      'sha256',
      'shasum',
      'size',
      'tarballPath',
      'unpackedSize',
      'version',
    ]);
    for (const field of ['name', 'root', 'tarballPath', 'version']) {
      assert.equal(typeof item[field], 'string');
      assert.ok(item[field].trim());
    }
    assert.ok(item.name.startsWith(`${sidecarScope}/`));
    assert.match(item.version, /^\d+\.\d+\.\d+$/u);
    const segments = item.tarballPath.split('/');
    assert.equal(segments.length, 2);
    assert.equal(segments[0], sidecarTarballsDirectory);
    assert.ok(segments[1].endsWith('.tgz'));
    assert.ok(!item.tarballPath.includes('\\'));
    assert.equal(path.posix.normalize(item.tarballPath), item.tarballPath);
    for (const field of ['size', 'fileCount', 'unpackedSize']) {
      assert.ok(Number.isSafeInteger(item[field]) && item[field] > 0);
    }
    for (const field of ['sha256', 'packageJsonSha256', 'fileListSha256']) {
      assert.match(item[field], /^[a-f0-9]{64}$/u);
    }
    assert.match(item.shasum, /^[a-f0-9]{40}$/u);
    assert.match(item.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
    const bytes = readRegularFile(path.join(artifactRoot, item.tarballPath));
    const hash = (algorithm, encoding = 'hex') =>
      crypto.createHash(algorithm).update(bytes).digest(encoding);
    assert.equal(bytes.length, item.size);
    assert.equal(hash('sha256'), item.sha256);
    assert.equal(hash('sha1'), item.shasum);
    assert.equal(`sha512-${hash('sha512', 'base64')}`, item.integrity);
    const inspection = inspectNpmTarball(bytes);
    for (const field of [
      'fileCount',
      'unpackedSize',
      'packageJsonSha256',
      'fileListSha256',
    ]) {
      assert.equal(inspection[field], item[field]);
    }
    assert.equal(inspection.packageJson.name, item.name);
    assert.equal(inspection.packageJson.version, item.version);
    names.push(item.name);
    tarballNames.push(segments[1]);
    return { ...item, bytes };
  });
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(tarballNames).size, tarballNames.length);
  assert.deepEqual(manifest.publishOrder, names);
  const actualTarballs = fs.readdirSync(tarballsDir, { withFileTypes: true });
  for (const entry of actualTarballs) {
    assert.ok(entry.isFile(), `Unsafe tarball: ${entry.name}`);
  }
  assert.deepEqual(
    actualTarballs.map(entry => entry.name).sort(),
    tarballNames.sort(),
  );
  return { packages };
}

const fixtureRequire = createRequire(
  new URL(
    '../../tests/integration/routes-tanstack-mf/mf-host/package.json',
    import.meta.url,
  ),
);
const modernRoot = findPackageRoot(
  fixtureRequire.resolve('@module-federation/modern-js-v3'),
);
const modernRequire = createRequire(path.join(modernRoot, 'package.json'));
const bridgeRoot = findPackageRoot(modernRequire.resolve(baseSpecifier));
const artifacts = new Map();
const manifestPath = process.env.ULTRAMODERN_REACT_BRIDGE_MANIFEST;
const sidecarsManifestPath =
  process.env.ULTRAMODERN_REACT_BRIDGE_SIDECARS_MANIFEST;
assert.ok(
  !(manifestPath && sidecarsManifestPath),
  'Choose either a release manifest or a standalone sidecar manifest',
);

if (manifestPath || sidecarsManifestPath) {
  const inputPath = path.resolve(manifestPath ?? sidecarsManifestPath);
  const artifactRoot = path.dirname(inputPath);
  // Standalone staging has no required publication-order consumer. Full
  // release inputs retain the release verifier's strict descriptor contract.
  const sidecars = manifestPath
    ? verifySidecarArtifacts(
        artifactRoot,
        JSON.parse(fs.readFileSync(inputPath, 'utf8')).sidecars,
      )
    : readStandaloneSidecars(inputPath);
  assert.ok(
    sidecars,
    'The release manifest must declare the bridge sidecar artifacts',
  );
  for (const [root, name] of [
    [modernRoot, '@bleedingdev/mf-modern-js-v3'],
    [bridgeRoot, '@bleedingdev/mf-bridge-react'],
  ]) {
    const item = sidecars.packages.find(item => item.name === name);
    assert.ok(item, `Candidate is missing ${name}`);
    const inspection = inspectNpmTarball(item.bytes);
    artifacts.set(root, inspection.fileContents);
  }
}

function readSource(filename) {
  for (const [root, files] of artifacts) {
    const relative = path.relative(root, filename);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      continue;
    }
    const bytes = files.get(relative.split(path.sep).join('/'));
    assert.ok(bytes, `Candidate is missing ${relative}`);
    return bytes.toString('utf8');
  }
  return fs.readFileSync(filename, 'utf8');
}

const modernPackage = JSON.parse(
  readSource(path.join(modernRoot, 'package.json')),
);
const bridgePackage = JSON.parse(
  readSource(path.join(bridgeRoot, 'package.json')),
);
const baseEntries = bridgePackage.exports['./base'];
const reactEntries = modernPackage.exports['./react'];
const runtimeEntries = [
  {
    name: 'ESM public React entry',
    file: reactEntries.import ?? reactEntries.default,
    format: 'esm',
  },
  {
    name: 'ESM-node React barrel',
    file: './dist/esm-node/react/index.mjs',
    format: 'esm',
  },
  {
    name: 'CJS React barrel',
    file: './dist/cjs/react/index.js',
    format: 'cjs',
  },
];

// Execute the complete eager bridge graph and the real React dependencies.
// Only React, React DOM, relative modules, and the bridge's /base entry resolve.
// Remote loading and rendering are outside this import regression.
function createLoader(baseOverride) {
  assert.equal(
    typeof vm.SourceTextModule,
    'function',
    'Run this test with --experimental-vm-modules',
  );
  const context = vm.createContext({ console, process, URL, setTimeout });
  const cjsCache = new Map();
  const esmCache = new Map();

  function resolve(specifier, importer, format) {
    assert.doesNotMatch(
      specifier,
      routerSpecifier,
      'Optional router is absent',
    );
    if (specifier === baseSpecifier) {
      return path.resolve(bridgeRoot, baseEntries[format]);
    }
    if (specifier.startsWith('.')) {
      return path.resolve(path.dirname(importer), specifier);
    }
    assert.match(
      specifier,
      /^(?:react|react-dom)(?:\/|$)/,
      `Unexpected dependency from ${importer}`,
    );
    return createRequire(importer).resolve(specifier);
  }

  function loadCjs(filename) {
    if (cjsCache.has(filename)) {
      return cjsCache.get(filename).exports;
    }
    const module = { exports: {} };
    cjsCache.set(filename, module);
    const require = specifier =>
      specifier === baseSpecifier && baseOverride
        ? baseOverride
        : loadCjs(resolve(specifier, filename, 'require'));
    const execute = vm.runInContext(
      `(function(exports, require, module, __filename, __dirname) {\n${readSource(filename)}\n})`,
      context,
      { filename },
    );
    execute(module.exports, require, module, filename, path.dirname(filename));
    return module.exports;
  }

  function syntheticModule(key, exports) {
    if (!esmCache.has(key)) {
      const names = [...new Set(['default', ...Object.keys(exports)])];
      esmCache.set(
        key,
        new vm.SyntheticModule(
          names,
          function () {
            for (const name of names) {
              this.setExport(
                name,
                name === 'default' ? exports : exports[name],
              );
            }
          },
          { context, identifier: key },
        ),
      );
    }
    return esmCache.get(key);
  }

  function esmModule(filename) {
    if (!esmCache.has(filename)) {
      esmCache.set(
        filename,
        new vm.SourceTextModule(readSource(filename), {
          context,
          identifier: filename,
          initializeImportMeta(meta) {
            meta.url = pathToFileURL(filename).href;
          },
        }),
      );
    }
    return esmCache.get(filename);
  }

  async function loadEsm(filename) {
    const entry = esmModule(filename);
    await entry.link((specifier, importer) => {
      if (specifier === baseSpecifier && baseOverride) {
        return syntheticModule(baseSpecifier, baseOverride);
      }
      const dependency = resolve(specifier, importer.identifier, 'import');
      return specifier.startsWith('.') || specifier === baseSpecifier
        ? esmModule(dependency)
        : syntheticModule(dependency, loadCjs(dependency));
    });
    await entry.evaluate();
    return entry.namespace;
  }

  return { loadCjs, loadEsm };
}

// The 2.9.2 recipe re-exports the router-free `/base` entry unchanged. The
// distributed SSR boundary in federation-runtime owns `injectLink: false`.
for (const entry of runtimeEntries) {
  test(`${entry.name} loads without routers and preserves base exports`, async () => {
    const loader = createLoader();
    const load = entry.format === 'esm' ? loader.loadEsm : loader.loadCjs;
    const base = await load(
      path.resolve(
        bridgeRoot,
        baseEntries[entry.format === 'esm' ? 'import' : 'require'],
      ),
    );
    const actual = await load(path.resolve(modernRoot, entry.file));
    assert.deepEqual(Object.keys(base).sort(), expectedExports);
    assert.deepEqual(Object.keys(actual).sort(), expectedExports);
    for (const name of expectedExports) {
      assert.equal(actual[name], base[name], `${entry.name}: ${name}`);
    }
  });

  test(`${entry.name} re-exports the base module bindings without wrapping`, async () => {
    const base = Object.fromEntries(
      expectedExports.map(name => [name, Symbol(name)]),
    );
    const loader = createLoader(base);
    const load = entry.format === 'esm' ? loader.loadEsm : loader.loadCjs;
    const actual = await load(path.resolve(modernRoot, entry.file));
    assert.deepEqual(Object.keys(actual).sort(), expectedExports);
    for (const name of expectedExports) {
      assert.equal(actual[name], base[name], name);
    }
  });
}

test('Public declaration barrel reexports the same router-free base entry', async () => {
  const loader = createLoader();
  const base = await loader.loadEsm(
    path.resolve(bridgeRoot, baseEntries.import),
  );
  // This declaration barrel contains only export *, which is also valid ESM.
  const declarations = await loader.loadEsm(
    path.resolve(modernRoot, reactEntries.types),
  );
  assert.deepEqual(Object.keys(declarations).sort(), expectedExports);
  for (const name of expectedExports) {
    assert.equal(declarations[name], base[name], name);
  }
});
