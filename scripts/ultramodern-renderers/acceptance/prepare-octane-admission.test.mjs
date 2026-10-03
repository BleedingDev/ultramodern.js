import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rewritePackageJson } from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/rewrite.mjs';
import { prepareOctaneAdmission } from './prepare-octane-admission.mjs';

const sdkName = '@modern-js/renderer-octane';

// These minimal archives test receiver path validation only. They never
// qualify an SDK or supply native checker or declaration admission evidence.
function fixture(t, { bin = 'bin/octane-tsc.mjs', publish = false } = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'octane-admission-paths-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixtureDirectory = path.join(root, 'consumer');
  const packageDirectory = path.join(root, 'package');
  fs.mkdirSync(fixtureDirectory);
  fs.mkdirSync(packageDirectory);
  const fixtureManifest = path.join(fixtureDirectory, 'package.json');
  fs.writeFileSync(
    fixtureManifest,
    `${JSON.stringify({
      name: 'ultramodern-octane-admission',
      private: true,
      dependencies: { typescript: '7.0.2' },
    })}\n`,
  );
  const sdk = {
    name: sdkName,
    version: '3.9.0-test',
    bin: { 'octane-tsc': bin },
    dependencies: { typescript: '7.0.2' },
    exports: {
      './typecheck': {
        types: './dist/types/typecheck.d.ts',
        node: {
          import: './dist/esm-node/typecheck.mjs',
          require: './dist/cjs/typecheck.js',
        },
      },
    },
  };
  if (publish) {
    rewritePackageJson(
      sdk,
      sdkName,
      {
        scope: 'modern-js',
        prefix: '',
        version: sdk.version,
        dependencyVersion: sdk.version,
        homepage: 'https://github.com/BleedingDev/ultramodern.js',
        bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues',
        repositoryUrl: 'https://github.com/BleedingDev/ultramodern.js.git',
      },
      new Set([sdkName]),
    );
  }
  for (const [relative, content] of Object.entries({
    'bin/octane-tsc.mjs': '#!/usr/bin/env node\n',
    'dist/esm-node/typecheck.mjs': 'export {};\n',
    'dist/cjs/typecheck.js': 'module.exports = {};\n',
    'dist/types/typecheck.d.ts': 'export {};\n',
  })) {
    const file = path.join(packageDirectory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const sdkTarball = path.join(root, 'sdk.tgz');
  function pack() {
    fs.writeFileSync(
      path.join(packageDirectory, 'package.json'),
      `${JSON.stringify(sdk)}\n`,
    );
    execFileSync('tar', ['-czf', sdkTarball, '-C', root, 'package'], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    return { fixtureDirectory, sdkTarball };
  }
  return { sdk, fixtureManifest, pack };
}

test('accepts the real canonical publisher bin normalization and preserves its declared fact', t => {
  const input = fixture(t, { bin: './bin/octane-tsc.mjs', publish: true });
  assert.equal(input.sdk.bin['octane-tsc'], 'bin/octane-tsc.mjs');
  const options = input.pack();
  const result = prepareOctaneAdmission(options);
  assert.equal(result.checker, input.sdk.bin['octane-tsc']);
  assert.equal(result.publicApi, './dist/esm-node/typecheck.mjs');
  assert.equal(result.compilerVersion, '7.0.2');
  const manifest = JSON.parse(fs.readFileSync(input.fixtureManifest, 'utf8'));
  assert.equal(manifest.devDependencies[sdkName], `file:${options.sdkTarball}`);
  assert.equal(manifest.dependencies.typescript, '7.0.2');
});

test('accepts a single ./ bin prefix without changing its declared fact', t => {
  const input = fixture(t, { bin: './bin/octane-tsc.mjs' });
  const result = prepareOctaneAdmission(input.pack());
  assert.equal(result.checker, './bin/octane-tsc.mjs');
});

for (const bin of [
  '',
  '.',
  '..',
  './',
  '/bin/octane-tsc.mjs',
  '../bin/octane-tsc.mjs',
  './../bin/octane-tsc.mjs',
  'bin/../bin/octane-tsc.mjs',
  'bin//octane-tsc.mjs',
  '././bin/octane-tsc.mjs',
  'bin\\octane-tsc.mjs',
  'bin/*.mjs',
  'bin/?.mjs',
  'bin/[cli].mjs',
  'bin/\0octane-tsc.mjs',
  'C:/bin/octane-tsc.mjs',
  'C:bin/octane-tsc.mjs',
]) {
  test(`rejects a non-canonical or escaping bin ${JSON.stringify(bin)}`, t => {
    const input = fixture(t, { bin });
    const options = input.pack();
    const before = fs.readFileSync(input.fixtureManifest, 'utf8');
    assert.throws(() => prepareOctaneAdmission(options), {
      message: 'octane-tsc bin must name an exact file inside the SDK',
    });
    assert.equal(fs.readFileSync(input.fixtureManifest, 'utf8'), before);
  });
}

test('rejects a canonical bin whose exact archive member is missing', t => {
  const input = fixture(t, { bin: 'bin/missing.mjs' });
  const options = input.pack();
  const before = fs.readFileSync(input.fixtureManifest, 'utf8');
  assert.throws(() => prepareOctaneAdmission(options), {
    message: 'The packed SDK is missing octane-tsc bin: bin/missing.mjs',
  });
  assert.equal(fs.readFileSync(input.fixtureManifest, 'utf8'), before);
});

for (const [field, label] of [
  ['import', 'public Node typecheck import'],
  ['require', 'public Node typecheck require'],
  ['types', 'public typecheck declarations'],
]) {
  test(`still requires ./ for ${label}`, t => {
    const input = fixture(t);
    const typecheck = input.sdk.exports['./typecheck'];
    const target = field === 'types' ? typecheck : typecheck.node;
    target[field] = target[field].slice(2);
    const options = input.pack();
    const before = fs.readFileSync(input.fixtureManifest, 'utf8');
    assert.throws(() => prepareOctaneAdmission(options), {
      message: `${label} must name an exact file inside the SDK`,
    });
    assert.equal(fs.readFileSync(input.fixtureManifest, 'utf8'), before);
  });
}
