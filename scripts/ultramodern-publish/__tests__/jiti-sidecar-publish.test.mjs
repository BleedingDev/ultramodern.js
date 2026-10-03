import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import inventory from '../../../packages/toolkit/ultramodern-create/src/ultramodern-workspace/patch-inventory.ts';
import {
  inspectNpmTarball,
  verifySidecarArtifacts,
} from '../lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import {
  assertSidecarStagingManifest,
  sidecarContentProjection,
  sidecarRegistryDecision,
} from '../lib/prepare-bleedingdev-packages/sidecar-publication.mjs';
import {
  collectSidecarPackages,
  packStagedSidecar,
  rewriteSidecarConsumerAliases,
  stageSidecarPackage,
  validateAliasConsistency,
  writeSidecarStagingManifest,
} from '../lib/prepare-bleedingdev-packages/sidecars.mjs';

const repoRoot = path.resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
);
const require = createRequire(
  path.join(repoRoot, 'packages/toolkit/plugin/package.json'),
);
const sourceDir = path.dirname(require.resolve('jiti/package.json'));
const jitiRoot = 'packages/sidecar/jiti';

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'jiti-sidecar-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const patch = inventory.find(
    item => item.packageName === 'jiti' && item.version === '2.7.0',
  );
  assert.ok(patch, 'Maintained Jiti patch must be registered');
  const patchBytes = fs.readFileSync(path.join(repoRoot, patch.path));
  fs.mkdirSync(path.join(root, 'patches'), { recursive: true });
  fs.writeFileSync(path.join(root, patch.path), patchBytes);
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    `patchedDependencies:\n  'jiti@2.7.0': ${patch.path}\n`,
  );
  const installedDir = path.join(
    root,
    'packages/toolkit/plugin/node_modules/jiti',
  );
  fs.mkdirSync(path.dirname(installedDir), { recursive: true });
  fs.cpSync(sourceDir, installedDir, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'packages/toolkit/plugin/package.json'),
    '{"name":"@fixture/plugin"}\n',
  );
  const [sidecar] = collectSidecarPackages(repoRoot, { roots: [jitiRoot] });
  return { installedDir, patchBytes, root, sidecar };
}

test('Jiti aliases retain canonical keys and peer contracts', () => {
  const [sidecar] = collectSidecarPackages(repoRoot, {
    roots: [jitiRoot],
  });
  const manifest = {
    name: '@bleedingdev/modern-js-plugin',
    dependencies: { jiti: '^2.7.0' },
    devDependencies: { jiti: '2.7.0' },
    optionalDependencies: { jiti: '^2.7.0' },
    peerDependencies: { jiti: '>=2.7.0' },
  };
  rewriteSidecarConsumerAliases(manifest, [sidecar]);
  for (const block of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ]) {
    assert.deepEqual(manifest[block], { jiti: 'npm:@bleedingdev/jiti@2.7.0' });
  }
  assert.deepEqual(manifest.peerDependencies, { jiti: '>=2.7.0' });
  validateAliasConsistency([manifest], [sidecar]);
  assert.throws(
    () =>
      rewriteSidecarConsumerAliases(
        { name: manifest.name, dependencies: { jiti: '^2.7.0' } },
        [],
      ),
    /staged sidecar @bleedingdev\/jiti is missing/u,
  );
});

test('actual patched Jiti package survives sidecar packing and native consumer resolution', async t => {
  const { root, sidecar } = fixture(t);
  const staged = await stageSidecarPackage(
    sidecar,
    path.join(root, 'sidecars'),
    { repoRoot: root },
  );
  const upstreamManifest = JSON.parse(
    fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'),
  );
  const { name, publishConfig, repository, ...stagedContract } =
    staged.packageJson;
  const {
    name: sourceName,
    publishConfig: sourcePublishConfig,
    repository: sourceRepository,
    ...upstreamContract
  } = upstreamManifest;
  assert.deepEqual(stagedContract, upstreamContract);
  assert.equal(name, '@bleedingdev/jiti');
  assert.deepEqual(staged.bin, { jiti: 'lib/jiti-cli.mjs' });
  sidecarContentProjection(staged.packageJson, name);
  assert.throws(
    () =>
      sidecarContentProjection(
        { ...staged.packageJson, unclassified: true },
        name,
      ),
    /does not classify: unclassified/u,
  );

  const { descriptor, manifest } = writeSidecarStagingManifest(root, [staged], {
    publishBefore: '@bleedingdev/modern-js-image',
  });
  assertSidecarStagingManifest(manifest);
  const accepted = verifySidecarArtifacts(root, descriptor);
  const [artifact] = accepted.packages;
  const inspection = inspectNpmTarball(artifact.bytes);
  for (const file of [
    'dist/jiti.cjs',
    'lib/types.d.ts',
    'lib/jiti.cjs',
    'lib/jiti.mjs',
  ]) {
    assert.deepEqual(
      inspection.fileContents.get(file),
      fs.readFileSync(path.join(sourceDir, file)),
      file,
    );
  }
  assert.match(
    inspection.fileContents.get('lib/types.d.ts').toString(),
    /packageMetadataRead\?:/u,
  );
  const packument = {
    name,
    'dist-tags': { latest: '2.7.0' },
    versions: {
      '2.7.0': {
        ...artifact.packageJson,
        dist: { integrity: artifact.integrity, shasum: artifact.shasum },
      },
    },
  };
  assert.equal(sidecarRegistryDecision(artifact, packument).action, 'reuse');
  const wrongExports = structuredClone(packument);
  wrongExports.versions['2.7.0'].exports['.'].require.default = './missing.cjs';
  assert.throws(
    () => sidecarRegistryDecision(artifact, wrongExports),
    /different content[\s\S]*exports/u,
  );

  const consumer = path.join(root, 'consumer');
  const installed = path.join(consumer, 'node_modules/jiti');
  fs.mkdirSync(installed, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    artifact.artifactPath,
    '--strip-components=1',
    '-C',
    installed,
  ]);
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    '{"name":"@fixture/consumer","type":"module"}\n',
  );
  const nativeDir = path.join(consumer, 'node_modules/native-probe');
  fs.mkdirSync(nativeDir, { recursive: true });
  fs.writeFileSync(
    path.join(nativeDir, 'package.json'),
    '{"name":"native-probe","version":"1.0.0","exports":"./native.cjs"}\n',
  );
  fs.writeFileSync(
    path.join(nativeDir, 'native.cjs'),
    'module.exports = { native: true };\n',
  );
  const consumerRequire = createRequire(path.join(consumer, 'package.json'));
  const createJiti = consumerRequire('jiti');
  const reads = [];
  const native = createJiti(path.join(consumer, 'modern.config.ts'), {
    fsCache: false,
    moduleCache: false,
    packageMetadataRead(file, operation, originalRead) {
      const value = originalRead();
      reads.push({ file, operation });
      return value;
    },
  });
  assert.ok(String(native.esmResolve('native-probe')).endsWith('/native.cjs'));
  assert.ok(
    reads.some(read => read.file === path.join(nativeDir, 'package.json')),
  );
  assert.ok(
    reads.every(read =>
      ['cache', 'name', 'type', 'content'].includes(read.operation),
    ),
  );
  const plain = createJiti(path.join(consumer, 'plain.config.ts'), {
    fsCache: false,
    moduleCache: false,
  });
  assert.equal(
    String(plain.esmResolve('native-probe')),
    String(native.esmResolve('native-probe')),
  );
});

test('staging rejects missing registration, an unpatched installation and changed payload bytes', async t => {
  const { installedDir, patchBytes, root, sidecar } = fixture(t);
  const stage = () =>
    stageSidecarPackage(sidecar, path.join(root, 'sidecars'), {
      repoRoot: root,
    });
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    'patchedDependencies: {}\n',
  );
  await assert.rejects(stage, /maintained pnpm patch registration/u);
  const patch = inventory.find(item => item.packageName === 'jiti');
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    `patchedDependencies:\n  'jiti@2.7.0': ${patch.path}\n`,
  );
  execFileSync('patch', ['-p1', '--reverse', '--fuzz=0', '--batch'], {
    cwd: installedDir,
    input: patchBytes,
    stdio: 'pipe',
  });
  await assert.rejects(stage, /jiti: dist\/jiti\.cjs/u);
  fs.appendFileSync(
    path.join(installedDir, 'dist/babel.cjs'),
    '\n// changed installed payload\n',
  );
  execFileSync('patch', ['-p1', '--fuzz=0', '--batch'], {
    cwd: installedDir,
    input: patchBytes,
    stdio: 'pipe',
  });
  await assert.rejects(stage, /jiti: dist\/babel\.cjs/u);
});

test('packing rejects a manifest that omits the patched Jiti declarations', async t => {
  const { root, sidecar } = fixture(t);
  const staged = await stageSidecarPackage(
    sidecar,
    path.join(root, 'sidecars'),
    { repoRoot: root },
  );
  staged.packageJson.files = ['dist', 'lib/jiti.cjs'];
  fs.writeFileSync(
    staged.packageJsonPath,
    `${JSON.stringify(staged.packageJson, null, 2)}\n`,
  );
  assert.throws(
    () => packStagedSidecar(staged, path.join(root, 'tarballs')),
    /must preserve patched lib\/types\.d\.ts/u,
  );
});
