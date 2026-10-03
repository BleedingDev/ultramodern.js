import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const packageRoot = resolve(__dirname, '../..');
const repositoryRoot = resolve(packageRoot, '../../..');

const consumerSource = `
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esmConfig from '@ultramodern/app-tools-extensions/config';
import * as esmBridge from '@ultramodern/app-tools-extensions/internal-effect-discovery';

const require = createRequire(import.meta.url);
const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const proof = JSON.parse(readFileSync(new URL('./proof.json', import.meta.url), 'utf8'));
const cjsConfig = require('@ultramodern/app-tools-extensions/config');
const cjsBridge = require('@ultramodern/app-tools-extensions/internal-effect-discovery');
const importedBridge = esmBridge.default;
const packageDirectory = join(fixtureRoot, 'node_modules/@ultramodern/app-tools-extensions');
const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));

assert.equal(manifest.name, '@ultramodern/app-tools-extensions');
assert.equal(existsSync(join(fixtureRoot, 'node_modules/@modern-js/app-tools-extensions')), false);
assert.throws(() => require.resolve('@modern-js/app-tools-extensions/config'), { code: 'MODULE_NOT_FOUND' });
assert.equal(require.resolve('@ultramodern/app-tools-extensions/config'), join(packageDirectory, 'dist/cjs/config.js'));
assert.equal(fileURLToPath(import.meta.resolve('@ultramodern/app-tools-extensions/config')), join(packageDirectory, 'dist/esm-node/config.mjs'));
assert.notEqual(cjsConfig.resolveEffectTsgoCompiler, esmConfig.resolveEffectTsgoCompiler);
assert.equal(require.resolve('@ultramodern/app-tools-extensions/internal-effect-discovery'), join(packageDirectory, 'dist/cjs/build-config/internal-effect-discovery.js'));
assert.equal(fileURLToPath(import.meta.resolve('@ultramodern/app-tools-extensions/internal-effect-discovery')), require.resolve('@ultramodern/app-tools-extensions/internal-effect-discovery'));
assert.equal(importedBridge, cjsBridge);

const observations = [];
const release = cjsBridge.installEffectCompilerDiscoveryObserver((installation, invokeValidatedDiscovery) => {
  assert.equal(installation.from, fileURLToPath(import.meta.url));
  assert.equal(installation.cliPath, proof.cliPath);
  assert.equal(installation.backendDirectory, proof.backendDirectory);
  const compiler = invokeValidatedDiscovery();
  assert.ok(compiler.trim(), 'The real Effect CLI must return its compiler path');
  observations.push(realpathSync(compiler.trim()));
  return compiler;
});
try {
  assert.throws(() => importedBridge.installEffectCompilerDiscoveryObserver(() => ''), /already has an observer/u);
  const cjsCompiler = cjsConfig.resolveEffectTsgoCompiler({ from: import.meta.url });
  const esmCompiler = esmConfig.resolveEffectTsgoCompiler({ from: import.meta.url });
  assert.equal(cjsCompiler, esmCompiler);
  accessSync(cjsCompiler, constants.X_OK);
  assert.equal(observations.length, 2);
  assert.equal(observations[0], observations[1]);
  assert.deepEqual(readFileSync(cjsCompiler), readFileSync(observations[0]));
  const resolvedCompiler = realpathSync(cjsCompiler);
  assert.ok(resolvedCompiler === observations[0] || resolvedCompiler.startsWith(join(fixtureRoot, 'native-cache') + sep));
} finally {
  release();
}
const releaseFromEsm = importedBridge.installEffectCompilerDiscoveryObserver(() => {
  throw new Error('The released observer must be replaceable from ESM');
});
try {
  assert.throws(() => cjsBridge.installEffectCompilerDiscoveryObserver(() => ''), /already has an observer/u);
} finally {
  releaseFromEsm();
}
`;

const fixtureSource = `
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourcePackageRoot, generatorRoot, rewritePath, consumerSource] = process.argv.slice(1);
const { rewritePackageJson } = await import(pathToFileURL(rewritePath).href);
const sourceManifest = JSON.parse(readFileSync(join(sourcePackageRoot, 'package.json'), 'utf8'));
const generatorManifest = JSON.parse(readFileSync(join(generatorRoot, 'package.json'), 'utf8'));
const fixtureRoot = realpathSync(mkdtempSync(join(process.env.OWNED_TEMP_DIR ?? tmpdir(), 'renamed-effect-discovery-')));
let cleaned = false;
const cleanup = () => {
  if (!cleaned) {
    cleaned = true;
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
};
const signalHandlers = new Map();
for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  const handler = () => { cleanup(); process.exit(exitCode); };
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

try {
  const installedDirectory = join(fixtureRoot, 'node_modules/@ultramodern/app-tools-extensions');
  mkdirSync(installedDirectory, { recursive: true });
  // Exercise the ordinary producer's bytes. The fixture never transpiles or patches them.
  cpSync(join(sourcePackageRoot, 'dist'), join(installedDirectory, 'dist'), { recursive: true });
  const publishedManifest = structuredClone(sourceManifest);
  const sourceNames = new Set([sourceManifest.name, ...['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap(block => Object.keys(sourceManifest[block] ?? {})).filter(name => name.startsWith('@modern-js/'))]);
  const version = sourceManifest.version + '-ultramodern.discovery-test';
  rewritePackageJson(publishedManifest, sourceManifest.name, {
    scope: 'ultramodern',
    prefix: '',
    version,
    dependencyVersion: version,
    homepage: sourceManifest.homepage,
    bugsUrl: sourceManifest.bugs.url,
    repositoryUrl: sourceManifest.repository.url,
  }, sourceNames);
  assert.equal(publishedManifest.name, '@ultramodern/app-tools-extensions');
  assert.equal(JSON.stringify(publishedManifest.exports).includes('modern:source'), false);
  assert.equal(publishedManifest.exports['./internal-effect-discovery'].import, publishedManifest.exports['./internal-effect-discovery'].require);
  assert.equal(publishedManifest.dependencies['@modern-js/surface-resolution'], 'npm:@ultramodern/surface-resolution@' + version);
  writeFileSync(join(installedDirectory, 'package.json'), JSON.stringify(publishedManifest));

  const linkDependency = (ownerRoot, name) => {
    const sourceDirectory = realpathSync(join(ownerRoot, 'node_modules', name));
    const sourcePackageJson = JSON.parse(readFileSync(join(sourceDirectory, 'package.json'), 'utf8'));
    const destination = join(fixtureRoot, 'node_modules', name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(sourceDirectory, destination, 'dir');
    assert.equal(realpathSync(destination), sourceDirectory);
    return { sourceDirectory, sourcePackageJson };
  };
  // Canonical dependency keys still use the exact owning package's installed cohort.
  for (const name of new Set([...Object.keys(sourceManifest.dependencies), ...Object.keys(sourceManifest.peerDependencies ?? {})])) {
    assert.notEqual(name, sourceManifest.name);
    linkDependency(sourcePackageRoot, name);
  }

  const compilerCohort = {};
  for (const name of ['@effect/tsgo', 'typescript', '@typescript/native']) {
    const installation = linkDependency(generatorRoot, name);
    const specification = generatorManifest.dependencies[name];
    const installedVersion = installation.sourcePackageJson.version;
    assert.equal(specification, name === '@typescript/native'
      ? 'npm:' + installation.sourcePackageJson.name + '@' + installedVersion
      : installedVersion, name + ' must match the generator exact dependency');
    compilerCohort[name] = installation;
  }
  const effect = compilerCohort['@effect/tsgo'];
  const effectBin = typeof effect.sourcePackageJson.bin === 'string'
    ? effect.sourcePackageJson.bin
    : effect.sourcePackageJson.bin['effect-tsgo'];
  const proof = {
    cliPath: realpathSync(resolve(effect.sourceDirectory, effectBin)),
    backendDirectory: compilerCohort['@typescript/native'].sourceDirectory,
  };
  writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      [publishedManifest.name]: version,
      ...Object.fromEntries(['@effect/tsgo', 'typescript', '@typescript/native'].map(name => [name, generatorManifest.dependencies[name]])),
    },
  }));
  writeFileSync(join(fixtureRoot, 'proof.json'), JSON.stringify(proof));
  const consumerFile = join(fixtureRoot, 'consumer.mjs');
  writeFileSync(consumerFile, consumerSource);
  const nativeCache = join(fixtureRoot, 'native-cache');
  mkdirSync(nativeCache);
  const environment = { ...process.env, TMPDIR: nativeCache, TMP: nativeCache, TEMP: nativeCache };
  delete environment.EFFECT_TSGO_BIN;
  delete environment.NODE_OPTIONS;
  execFileSync(process.execPath, [consumerFile], {
    cwd: fixtureRoot,
    env: environment,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 20_000,
  });
} finally {
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  cleanup();
}
`;

test('renamed standalone publication shares Effect discovery across public CJS and native ESM config', () => {
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      fixtureSource,
      packageRoot,
      resolve(repositoryRoot, 'packages/toolkit/ultramodern-create'),
      resolve(
        repositoryRoot,
        'scripts/ultramodern-publish/lib/prepare-bleedingdev-packages/rewrite.mjs',
      ),
      consumerSource,
    ],
    {
      cwd: packageRoot,
      env: environment,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 25_000,
    },
  );
});
