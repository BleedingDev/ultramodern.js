import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const upstreamCommit = '676a4ee6db59854d6b711921f4ac808845dcdbcd';
const exactVersion = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const requiredFiles = [
  'LICENSE',
  'dist/index.js',
  'dist/node/index.js',
  'dist/cjs/index.cjs',
  'dist/index.d.ts',
  'dist/compiler/index.js',
  'dist/hydration/streamed-signals.js',
];
const routerName = '@octanejs/tanstack-router';
const routerExports = {
  '.': './src/index.ts',
  './history': './src/history.ts',
  './ssr/server': {
    types: './src/ssr/server.ts',
    default: './src/ssr/server.ts',
  },
  './ssr/client': {
    types: './src/ssr/client.ts',
    default: './src/ssr/client.ts',
  },
  './generator-plugin': {
    types: './src/generator-plugin.d.ts',
    default: './src/generator-plugin.js',
  },
  './package.json': './package.json',
};
const routerDependencies = {
  '@tanstack/history': '1.162.0',
  '@tanstack/router-core': '1.171.15',
  '@tanstack/store': '0.9.3',
  isbot: '5.2.1',
};

function digest(algorithm, bytes, encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function packageAt(require, name) {
  const entry = fs.realpathSync(require.resolve(name));
  let directory = path.dirname(entry);
  while (true) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) {
      const manifest = readJson(file);
      if (manifest.name !== undefined) {
        assert.equal(
          manifest.name,
          name,
          `Package alias is forbidden: ${name}`,
        );
        return { directory, entry, manifest };
      }
    }
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `Missing package identity for ${name}`);
    directory = parent;
  }
}

function keys(value, expected, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), label);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label);
}

function exportFiles(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value))
    value.forEach(item => exportFiles(item, result));
  else if (value && typeof value === 'object')
    Object.values(value).forEach(item => exportFiles(item, result));
  return result;
}

function installedFiles(directory, relative = '', result = new Map()) {
  for (const name of fs.readdirSync(path.join(directory, relative))) {
    if (relative === '' && name === 'node_modules') continue;
    const file = relative ? `${relative}/${name}` : name;
    const absolute = path.join(directory, ...file.split('/'));
    const stat = fs.lstatSync(absolute);
    assert.ok(
      !stat.isSymbolicLink(),
      `Installed package file is a link: ${file}`,
    );
    if (stat.isDirectory()) installedFiles(directory, file, result);
    else {
      assert.ok(stat.isFile(), `Installed package has a special file: ${file}`);
      result.set(file, fs.readFileSync(absolute));
    }
  }
  return result;
}

async function inspectArtifact(workspacePath, bytes) {
  assert.ok(
    typeof workspacePath === 'string' && path.isAbsolute(workspacePath),
    'Pass the owning workspacePath for the tarball inspector',
  );
  const { inspectNpmTarball } = await import(
    pathToFileURL(
      path.join(
        workspacePath,
        'scripts/ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs',
      ),
    )
  );
  return inspectNpmTarball(bytes);
}

function verifyInstalledArchive({ archive, expected, dependency, installed }) {
  assert.ok(
    archive.unpackedSize <= 256 * 1024 * 1024,
    'Native package exceeds the admission limit',
  );
  for (const target of exportFiles(archive.packageJson.exports)) {
    assert.ok(
      target.startsWith('./') && !target.includes('*'),
      `Native export is not an exact package file: ${target}`,
    );
    assert.ok(
      archive.fileContents.has(target.slice(2)),
      `Native export file is absent: ${target}`,
    );
  }
  const actualFiles = installedFiles(installed.directory);
  assert.deepEqual(
    [...actualFiles.keys()].sort(),
    [...archive.fileContents.keys()].sort(),
    'Installed native file set differs from the tarball',
  );
  const actualManifest = { ...installed.manifest };
  for (const field of ['_integrity', '_resolved', '_from']) {
    if (
      !Object.hasOwn(actualManifest, field) ||
      Object.hasOwn(archive.packageJson, field)
    )
      continue;
    const expectedMetadata =
      field === '_integrity' ? expected.integrity : dependency;
    assert.equal(
      actualManifest[field],
      expectedMetadata,
      `Installed native ${field} metadata`,
    );
    delete actualManifest[field];
  }
  assert.deepEqual(
    actualManifest,
    archive.packageJson,
    'Installed native package manifest differs from the tarball',
  );
  for (const field of ['exports', 'imports'])
    assert.equal(
      JSON.stringify(actualManifest[field]),
      JSON.stringify(archive.packageJson[field]),
      `Installed native ${field} conditions differ from the tarball`,
    );
  for (const [file, content] of archive.fileContents)
    if (file !== 'package.json')
      assert.ok(
        content.equals(actualFiles.get(file)),
        `Installed native bytes differ: ${file}`,
      );
  const relativeEntry = path
    .relative(installed.directory, installed.entry)
    .split(path.sep)
    .join('/');
  assert.ok(
    exportFiles(archive.packageJson.exports).includes(`./${relativeEntry}`),
    'Installed native root resolves outside the packed exports',
  );
}

function verifyDependencyURI(dependency, expected, provenance, label) {
  assert.ok(
    dependency === `file:${expected.tarball}` ||
      dependency === provenance.artifact.intendedReleaseURI,
    `${label} dependency must name the exact local tarball or verified release URI`,
  );
}

function nativePeerResolution(packages, native) {
  const peers = [];
  const nativeRequire = createRequire(
    path.join(native.directory, 'package.json'),
  );
  const runtimeSpecifiers = Object.entries(native.manifest.exports)
    .filter(([, value]) =>
      exportFiles(value).some(target => /\.[cm]?js$/u.test(target)),
    )
    .map(([subpath]) =>
      subpath === '.' ? 'octane' : `octane/${subpath.slice(2)}`,
    );
  for (const [name, installed] of packages) {
    if (
      !installed.manifest.dependencies?.octane &&
      !installed.manifest.peerDependencies?.octane &&
      !installed.manifest.optionalDependencies?.octane
    )
      continue;
    const scopedRequire = createRequire(
      path.join(installed.directory, 'package.json'),
    );
    const resolved = packageAt(scopedRequire, 'octane');
    assert.equal(
      resolved.directory,
      native.directory,
      `${name} resolves a different Octane package`,
    );
    for (const specifier of runtimeSpecifiers)
      assert.equal(
        fs.realpathSync(scopedRequire.resolve(specifier)),
        fs.realpathSync(nativeRequire.resolve(specifier)),
        `${name} resolves a different ${specifier} export`,
      );
    peers.push({
      name,
      packageRoot: resolved.directory,
      runtimeExportsVerified: runtimeSpecifiers.length,
    });
  }
  return peers;
}

function verifyProvenance(bytes, expected) {
  assert.equal(
    digest('sha256', bytes),
    expected.provenanceSha256,
    'Provenance SHA256',
  );
  const provenance = JSON.parse(bytes.toString('utf8'));
  keys(
    provenance,
    ['schemaVersion', 'package', 'upstream', 'source', 'producer', 'artifact'],
    'Native provenance fields',
  );
  assert.equal(provenance.schemaVersion, 1, 'Native provenance schema');
  assert.equal(
    bytes.toString('utf8'),
    `${JSON.stringify(provenance, null, 2)}\n`,
    'Canonical native provenance',
  );
  assert.deepEqual(provenance.package, {
    name: expected.name,
    version: expected.version,
  });
  assert.deepEqual(provenance.upstream, {
    repository: 'https://github.com/octanejs/octane',
    tag: 'octane@0.7.1',
    commit: expected.upstreamCommit,
  });
  assert.deepEqual(provenance.source, {
    repository: 'https://github.com/bleedingdev/octane',
    commit: expected.producerCommit,
    implementationCommit: expected.implementationCommit,
    runtimePatchSha256: expected.runtimePatchSha256,
    authoredSourcePatchSha256: expected.authoredSourcePatchSha256,
  });
  keys(
    provenance.producer,
    ['node', 'pnpm', 'hostLockSha256', 'sourceManifestSha256'],
    'Native producer fields',
  );
  assert.match(provenance.producer.node, /^v\d+\.\d+\.\d+$/u);
  assert.match(provenance.producer.pnpm, /^\d+\.\d+\.\d+$/u);
  assert.match(provenance.producer.hostLockSha256, sha256Pattern);
  assert.match(provenance.producer.sourceManifestSha256, sha256Pattern);
  const file = path.basename(expected.tarball);
  assert.equal(
    file,
    `octane-${expected.version}.tgz`,
    'Native artifact filename',
  );
  assert.match(provenance.artifact.publishManifestSha256, sha256Pattern);
  assert.deepEqual(provenance.artifact, {
    file,
    sha256: expected.sha256,
    integrity: expected.integrity,
    publishManifestSha256: provenance.artifact.publishManifestSha256,
    intendedReleaseURI: `https://github.com/bleedingdev/octane/releases/download/${encodeURIComponent(`octane@${expected.version}`)}/${encodeURIComponent(file)}`,
  });
  return provenance;
}

async function verifyNativeArtifact({
  workspacePath,
  expected,
  dependency,
  installed,
}) {
  assert.equal(expected.name, 'octane', 'Native package name');
  assert.equal(
    expected.upstreamCommit,
    upstreamCommit,
    'Native upstream release',
  );
  for (const field of [
    'upstreamCommit',
    'implementationCommit',
    'producerCommit',
  ])
    assert.match(expected[field], commitPattern, `Native ${field}`);
  for (const field of [
    'sha256',
    'provenanceSha256',
    'runtimePatchSha256',
    'authoredSourcePatchSha256',
  ])
    assert.match(expected[field], sha256Pattern, `Native ${field}`);
  assert.equal(
    expected.version,
    `0.7.1+ultramodern.${expected.implementationCommit.slice(0, 12)}`,
    'Native source version',
  );
  assert.ok(
    path.isAbsolute(expected.tarball),
    'Native tarball must be an absolute path',
  );
  assert.ok(
    path.isAbsolute(expected.provenancePath),
    'Native provenance must be an absolute path',
  );
  assert.equal(
    installed.manifest.version,
    expected.version,
    'Installed native version',
  );
  const bytes = fs.readFileSync(expected.tarball);
  assert.ok(
    bytes.length <= 128 * 1024 * 1024,
    'Native tarball exceeds the admission limit',
  );
  assert.equal(
    digest('sha256', bytes),
    expected.sha256,
    'Native tarball SHA256',
  );
  assert.equal(
    `sha512-${digest('sha512', bytes, 'base64')}`,
    expected.integrity,
    'Native tarball SRI',
  );
  const provenance = verifyProvenance(
    fs.readFileSync(expected.provenancePath),
    expected,
  );
  verifyDependencyURI(dependency, expected, provenance, 'Native');
  const archive = await inspectArtifact(workspacePath, bytes);
  assert.equal(
    archive.packageJson.name,
    expected.name,
    'Packed native package name',
  );
  assert.equal(
    archive.packageJson.version,
    expected.version,
    'Packed native version',
  );
  assert.deepEqual(archive.packageJson.ultramodernSource, {
    upstreamCommit: expected.upstreamCommit,
    implementationCommit: expected.implementationCommit,
    runtimePatchSha256: expected.runtimePatchSha256,
    authoredSourcePatchSha256: expected.authoredSourcePatchSha256,
  });
  assert.equal(
    digest('sha256', archive.fileContents.get('package.json')),
    provenance.artifact.publishManifestSha256,
    'Native published package manifest SHA256',
  );
  for (const file of requiredFiles)
    assert.ok(
      archive.fileContents.has(file),
      `Native tarball is missing ${file}`,
    );
  verifyInstalledArchive({ archive, expected, dependency, installed });
  return {
    name: expected.name,
    version: expected.version,
    dependencyURI: dependency,
    tarball: expected.tarball,
    sha256: expected.sha256,
    integrity: expected.integrity,
    provenancePath: expected.provenancePath,
    provenanceSha256: expected.provenanceSha256,
    upstreamCommit: expected.upstreamCommit,
    implementationCommit: expected.implementationCommit,
    producerCommit: expected.producerCommit,
    runtimePatchSha256: expected.runtimePatchSha256,
    authoredSourcePatchSha256: expected.authoredSourcePatchSha256,
    publishManifestSha256: provenance.artifact.publishManifestSha256,
    packageRoot: installed.directory,
    fileCount: archive.fileCount,
    fileListSha256: archive.fileListSha256,
    installedBytesVerified: true,
    producer: provenance.producer,
  };
}

function runtimeBinding(nativeRuntime) {
  return {
    name: nativeRuntime.name,
    version: nativeRuntime.version,
    artifactSha256: nativeRuntime.sha256,
    provenanceSha256: nativeRuntime.provenanceSha256,
  };
}

function verifyRouterProvenance(bytes, expected, nativeRuntime) {
  assert.equal(
    digest('sha256', bytes),
    expected.provenanceSha256,
    'Router provenance SHA256',
  );
  const provenance = JSON.parse(bytes.toString('utf8'));
  keys(
    provenance,
    [
      'schemaVersion',
      'package',
      'upstream',
      'source',
      'producer',
      'artifact',
      'inventory',
    ],
    'Router provenance fields',
  );
  assert.equal(provenance.schemaVersion, 1, 'Router provenance schema');
  assert.equal(
    bytes.toString('utf8'),
    `${JSON.stringify(provenance, null, 2)}\n`,
    'Canonical router provenance',
  );
  assert.deepEqual(provenance.package, {
    name: expected.name,
    version: expected.version,
  });
  assert.deepEqual(provenance.upstream, {
    repository: 'https://github.com/octanejs/octane',
    tag: 'octane@0.7.1',
    commit: expected.upstreamCommit,
    packageVersion: '0.1.60',
  });
  assert.deepEqual(provenance.source, {
    repository: 'https://github.com/bleedingdev/octane',
    commit: expected.producerCommit,
    implementationCommit: expected.implementationCommit,
    authoredSourcePatchSha256: expected.authoredSourcePatchSha256,
  });
  keys(
    provenance.producer,
    ['node', 'pnpm', 'hostLockSha256', 'sourceManifestSha256', 'nativeRuntime'],
    'Router producer fields',
  );
  assert.match(provenance.producer.node, /^v\d+\.\d+\.\d+$/u);
  assert.match(provenance.producer.pnpm, /^\d+\.\d+\.\d+$/u);
  assert.match(provenance.producer.hostLockSha256, sha256Pattern);
  assert.match(provenance.producer.sourceManifestSha256, sha256Pattern);
  assert.deepEqual(
    provenance.producer.nativeRuntime,
    runtimeBinding(nativeRuntime),
    'Router producer must bind the verified native runtime',
  );
  const file = path.basename(expected.tarball);
  assert.equal(
    file,
    `octanejs-tanstack-router-${expected.version}.tgz`,
    'Router artifact filename',
  );
  assert.match(provenance.artifact.publishManifestSha256, sha256Pattern);
  assert.match(provenance.artifact.sourceInventorySha256, sha256Pattern);
  assert.deepEqual(provenance.artifact, {
    file,
    sha256: expected.sha256,
    integrity: expected.integrity,
    publishManifestSha256: provenance.artifact.publishManifestSha256,
    sourceInventorySha256: provenance.artifact.sourceInventorySha256,
    intendedReleaseURI: `https://github.com/bleedingdev/octane/releases/download/${encodeURIComponent(`${routerName}@${expected.version}`)}/${encodeURIComponent(file)}`,
  });
  return provenance;
}

function publishedInventory(archive) {
  // The producer visits sorted directory entries recursively. Compare path
  // components so a directory precedes a sibling such as "directory.ts".
  const files = [...archive.fileContents.keys()].sort((left, right) => {
    const leftParts = left.split('/');
    const rightParts = right.split('/');
    for (
      let index = 0;
      index < Math.min(leftParts.length, rightParts.length);
      index++
    ) {
      if (leftParts[index] < rightParts[index]) return -1;
      if (leftParts[index] > rightParts[index]) return 1;
    }
    return leftParts.length - rightParts.length;
  });
  return files.map(file => ({
    file,
    sha256: digest('sha256', archive.fileContents.get(file)),
  }));
}

async function verifyNativeRouterArtifact({
  workspacePath,
  expected,
  dependency,
  installed,
  nativeRuntime,
}) {
  assert.equal(expected.name, routerName, 'Router package name');
  assert.equal(
    expected.upstreamCommit,
    upstreamCommit,
    'Router upstream release',
  );
  for (const field of [
    'upstreamCommit',
    'implementationCommit',
    'producerCommit',
  ])
    assert.match(expected[field], commitPattern, `Router ${field}`);
  for (const field of [
    'sha256',
    'provenanceSha256',
    'authoredSourcePatchSha256',
  ])
    assert.match(expected[field], sha256Pattern, `Router ${field}`);
  assert.equal(
    expected.version,
    `0.1.60+ultramodern.${expected.implementationCommit.slice(0, 12)}`,
    'Router source version',
  );
  assert.ok(
    path.isAbsolute(expected.tarball),
    'Router tarball must be an absolute path',
  );
  assert.ok(
    path.isAbsolute(expected.provenancePath),
    'Router provenance must be an absolute path',
  );
  assert.equal(
    installed.manifest.version,
    expected.version,
    'Installed router version',
  );
  const bytes = fs.readFileSync(expected.tarball);
  assert.ok(
    bytes.length <= 128 * 1024 * 1024,
    'Router tarball exceeds the admission limit',
  );
  assert.equal(
    digest('sha256', bytes),
    expected.sha256,
    'Router tarball SHA256',
  );
  assert.equal(
    `sha512-${digest('sha512', bytes, 'base64')}`,
    expected.integrity,
    'Router tarball SRI',
  );
  const provenance = verifyRouterProvenance(
    fs.readFileSync(expected.provenancePath),
    expected,
    nativeRuntime,
  );
  verifyDependencyURI(dependency, expected, provenance, 'Router');
  const archive = await inspectArtifact(workspacePath, bytes);
  const manifest = archive.packageJson;
  assert.equal(manifest.name, expected.name, 'Packed router package name');
  assert.equal(manifest.version, expected.version, 'Packed router version');
  assert.deepEqual(manifest.ultramodernSource, {
    upstreamCommit: expected.upstreamCommit,
    implementationCommit: expected.implementationCommit,
    authoredSourcePatchSha256: expected.authoredSourcePatchSha256,
    nativeRuntime: runtimeBinding(nativeRuntime),
  });
  for (const field of ['main', 'module', 'types'])
    assert.equal(manifest[field], 'src/index.ts', `Native router ${field}`);
  assert.equal(manifest.type, 'module', 'Native router module type');
  assert.equal(manifest.license, 'MIT', 'Native router license');
  assert.equal(manifest.sideEffects, false, 'Native router side effects');
  assert.deepEqual(manifest.engines, { node: '>=22.22.2' });
  assert.deepEqual(manifest.octane, { hookSlots: { manual: ['src'] } });
  assert.equal(
    JSON.stringify(manifest.exports),
    JSON.stringify(routerExports),
    'Preserve the native router source export conditions',
  );
  assert.deepEqual(
    manifest.dependencies,
    routerDependencies,
    'Native router dependency pins',
  );
  assert.deepEqual(
    manifest.peerDependencies,
    { octane: '^0.7.0' },
    'Native router peer',
  );
  for (const field of [
    'publishConfig',
    'scripts',
    'devDependencies',
    'imports',
    'optionalDependencies',
  ])
    assert.ok(
      !Object.hasOwn(manifest, field),
      `Router must not publish ${field}`,
    );
  for (const file of ['package.json', 'README.md', 'LICENSE'])
    assert.ok(
      archive.fileContents.has(file),
      `Router tarball is missing ${file}`,
    );
  for (const file of archive.fileContents.keys())
    assert.ok(
      file.startsWith('src/') ||
        ['package.json', 'README.md', 'LICENSE'].includes(file),
      `Router must publish authored native sources: ${file}`,
    );
  assert.equal(
    digest('sha256', archive.fileContents.get('package.json')),
    provenance.artifact.publishManifestSha256,
    'Router published package manifest SHA256',
  );
  const inventory = publishedInventory(archive);
  assert.deepEqual(
    provenance.inventory,
    inventory,
    'Router published source inventory',
  );
  assert.equal(
    digest('sha256', Buffer.from(`${JSON.stringify(inventory)}\n`)),
    provenance.artifact.sourceInventorySha256,
    'Router published source inventory SHA256',
  );
  verifyInstalledArchive({ archive, expected, dependency, installed });
  const routerRequire = createRequire(
    path.join(installed.directory, 'package.json'),
  );
  const dependencyVersions = {};
  for (const [name, version] of Object.entries(routerDependencies)) {
    const resolved = packageAt(routerRequire, name);
    assert.equal(
      resolved.manifest.version,
      version,
      `Native router requires exact ${name}@${version}`,
    );
    dependencyVersions[name] = resolved.manifest.version;
  }
  return {
    name: expected.name,
    version: expected.version,
    dependencyURI: dependency,
    tarball: expected.tarball,
    sha256: expected.sha256,
    integrity: expected.integrity,
    provenancePath: expected.provenancePath,
    provenanceSha256: expected.provenanceSha256,
    upstreamCommit: expected.upstreamCommit,
    implementationCommit: expected.implementationCommit,
    producerCommit: expected.producerCommit,
    authoredSourcePatchSha256: expected.authoredSourcePatchSha256,
    publishManifestSha256: provenance.artifact.publishManifestSha256,
    sourceInventorySha256: provenance.artifact.sourceInventorySha256,
    dependencyVersions,
    packageRoot: installed.directory,
    fileCount: archive.fileCount,
    fileListSha256: archive.fileListSha256,
    installedBytesVerified: true,
    producer: provenance.producer,
  };
}

/** Verify exact registry pins and explicitly qualified native source tarballs. */
export async function validateAdmissionPackages({
  root = process.cwd(),
  workspacePath,
  nativeArtifact,
  nativeRouterArtifact,
} = {}) {
  assert.ok(
    !nativeRouterArtifact || nativeArtifact,
    'A maintained router requires a qualified native runtime',
  );
  const require = createRequire(path.join(root, 'package.json'));
  const dependencies = readJson(path.join(root, 'package.json')).dependencies;
  assert.ok(
    dependencies && typeof dependencies === 'object',
    'Admission dependencies are required',
  );
  const packageVersions = {};
  const packages = new Map();
  let verifiedNativeArtifact = null;
  let verifiedNativeRouterArtifact = null;
  for (const [name, version] of Object.entries(dependencies)) {
    const installed = packageAt(require, name);
    packages.set(name, installed);
    if (name === 'octane' && nativeArtifact) {
      verifiedNativeArtifact = await verifyNativeArtifact({
        workspacePath,
        expected: nativeArtifact,
        dependency: version,
        installed,
      });
    } else if (name !== routerName || !nativeRouterArtifact) {
      assert.match(
        version,
        exactVersion,
        `Admission requires an exact numeric pin for ${name}`,
      );
      assert.equal(
        installed.manifest.version,
        version,
        `Admission requires exact ${name}@${version}`,
      );
    }
    packageVersions[name] = installed.manifest.version;
  }
  assert.ok(
    !nativeArtifact || verifiedNativeArtifact,
    'Native artifact has no octane consumer dependency',
  );
  if (nativeRouterArtifact) {
    assert.ok(
      packages.has(routerName),
      'Native router artifact has no router consumer dependency',
    );
    verifiedNativeRouterArtifact = await verifyNativeRouterArtifact({
      workspacePath,
      expected: nativeRouterArtifact,
      dependency: dependencies[routerName],
      installed: packages.get(routerName),
      nativeRuntime: verifiedNativeArtifact,
    });
  }
  if (verifiedNativeArtifact)
    verifiedNativeArtifact.peerPackageRoots = nativePeerResolution(
      packages,
      packages.get('octane'),
    );
  return {
    packageVersions,
    nativeArtifact: verifiedNativeArtifact,
    nativeRouterArtifact: verifiedNativeRouterArtifact,
  };
}
