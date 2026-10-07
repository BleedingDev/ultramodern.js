import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkInstalledCohort,
  readInstalledPackageFiles,
  verifyInstalledPackage,
} from './installed-cohort.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const packed = {
  'package.json': '{"name":"@bleedingdev/modern-js-runtime","version":"1.0.0"}',
  'dist/index.js': 'export const runtime = 1;\n',
};
const cohort = {
  artifacts: [
    {
      sourceName: '@modern-js/runtime',
      targetName: '@bleedingdev/modern-js-runtime',
      version: '1.0.0',
      files: Object.entries(packed).map(([file, text]) => ({
        path: file,
        size: text.length,
        sha256: sha256(text),
      })),
    },
  ],
};

function app(
  t,
  { link, spec = 'npm:@bleedingdev/modern-js-runtime@1.0.0' } = {},
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'installed-cohort-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = path.join(
    root,
    'node_modules/.pnpm/@bleedingdev+modern-js-runtime@1.0.0/node_modules/@bleedingdev/modern-js-runtime',
  );
  for (const [file, text] of Object.entries(packed)) {
    fs.mkdirSync(path.dirname(path.join(installed, file)), { recursive: true });
    fs.writeFileSync(path.join(installed, file), text);
  }
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      dependencies: { '@modern-js/runtime': spec },
    }),
  );
  fs.mkdirSync(path.join(root, 'node_modules/@modern-js'));
  fs.symlinkSync(
    link ?? installed,
    path.join(root, 'node_modules/@modern-js/runtime'),
  );
  return { root, installed };
}

test('accepts packages installed from the packed tarballs', t => {
  const { root } = app(t);
  assert.equal(checkInstalledCohort({ appRoot: root, cohort }), 2);
});

test('resolves the catalog specifiers the generator writes', t => {
  const { root } = app(t, { spec: 'catalog:ultramodern' });
  const workspace = path.join(root, 'pnpm-workspace.yaml');
  fs.writeFileSync(
    workspace,
    'catalogs:\n  ultramodern:\n    "@modern-js/runtime": "npm:@bleedingdev/modern-js-runtime@1.0.0"\n',
  );
  assert.equal(checkInstalledCohort({ appRoot: root, cohort }), 2);
  fs.writeFileSync(
    workspace,
    'catalogs:\n  ultramodern:\n    "@modern-js/runtime": "1.0.0"\n',
  );
  assert.throws(
    () => checkInstalledCohort({ appRoot: root, cohort }),
    /must depend on the packed cohort/u,
  );
});

test('rejects an installed file that differs from the tarball', t => {
  const { root, installed } = app(t);
  fs.appendFileSync(path.join(installed, 'dist/index.js'), '// patched\n');
  assert.throws(
    () => checkInstalledCohort({ appRoot: root, cohort }),
    /differs from its tarball at dist\/index\.js/u,
  );
});

test('rejects a workspace link', t => {
  const workspacePackage = fileURLToPath(
    new URL('../../packages/runtime/plugin-runtime', import.meta.url),
  );
  const { root } = app(t, { link: workspacePackage });
  assert.throws(
    () => checkInstalledCohort({ appRoot: root, cohort }),
    /is a workspace link/u,
  );
});

test('package inventory retains the worker receipt shape and cohort install alias support', t => {
  const { root, installed } = app(t);
  const expected = Object.entries(packed)
    .map(([file, text]) => ({
      path: file,
      byteLength: Buffer.byteLength(text),
      sha256: sha256(text),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(readInstalledPackageFiles(installed), expected);
  assert.deepEqual(
    verifyInstalledPackage(installed, cohort.artifacts[0]),
    expected,
  );
  assert.equal(
    sha256(JSON.stringify(readInstalledPackageFiles(installed))),
    sha256(JSON.stringify(expected)),
    'Worker fileGraphSha256 must retain the same evidence bytes',
  );
  assert.equal(checkInstalledCohort({ appRoot: root, cohort }), 2);
});

test('recorded physical package roots cannot be replaced by a symlink before reauthentication', t => {
  const { installed } = app(t);
  const relocated = `${installed}-relocated`;
  fs.renameSync(installed, relocated);
  fs.symlinkSync(relocated, installed);
  assert.throws(() => readInstalledPackageFiles(installed), /symlink/u);
  assert.throws(
    () => verifyInstalledPackage(installed, cohort.artifacts[0]),
    /symlink/u,
  );
});

test('package inventory omits nested dependency directories without omitting package files', t => {
  const { root, installed } = app(t);
  const dependency = path.join(installed, 'dist/node_modules/dependency');
  fs.mkdirSync(dependency, { recursive: true });
  fs.writeFileSync(
    path.join(dependency, 'injected.js'),
    'unrelated dependency',
  );
  fs.symlinkSync(root, path.join(dependency, 'external-link'));
  assert.deepEqual(
    verifyInstalledPackage(installed, cohort.artifacts[0]).map(
      file => file.path,
    ),
    ['dist/index.js', 'package.json'],
  );
  assert.equal(checkInstalledCohort({ appRoot: root, cohort }), 2);
});

for (const [name, relative] of [
  ['file', 'dist/index.js'],
  ['directory', 'dist'],
  ['dependency directory', 'node_modules'],
]) {
  test(`package inventory rejects a symlink ${name}`, t => {
    const { root, installed } = app(t);
    const target = path.join(installed, relative);
    fs.rmSync(target, { recursive: true, force: true });
    fs.symlinkSync(root, target);
    assert.throws(() => readInstalledPackageFiles(installed), /symlink/u);
    assert.throws(
      () => verifyInstalledPackage(installed, cohort.artifacts[0]),
      /symlink/u,
    );
  });
}

test('package evidence rechecks files after reading the directory inventory', t => {
  const { root, installed } = app(t);
  const file = path.join(installed, 'dist/index.js');
  const originalRead = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (directory, options) => {
    const entries = originalRead(directory, options);
    if (directory === path.dirname(file)) {
      fs.unlinkSync(file);
      fs.symlinkSync(path.join(root, 'package.json'), file);
    }
    return entries;
  });
  assert.throws(() => readInstalledPackageFiles(installed), /symlink/u);
});

for (const [name, change, message] of [
  [
    'injected file',
    installed => fs.writeFileSync(path.join(installed, 'extra.js'), 'injected'),
    /has an unpacked file extra\.js/u,
  ],
  [
    'missing file',
    installed => fs.unlinkSync(path.join(installed, 'dist/index.js')),
    /is missing dist\/index\.js/u,
  ],
]) {
  test(`package verification rejects ${name} changes`, t => {
    const { root, installed } = app(t);
    change(installed);
    assert.throws(
      () => checkInstalledCohort({ appRoot: root, cohort }),
      message,
    );
  });
}

test('package verification binds recorded sizes as well as hashes', t => {
  const { installed } = app(t);
  const artifact = structuredClone(cohort.artifacts[0]);
  artifact.files[0].size += 1;
  assert.throws(
    () => verifyInstalledPackage(installed, artifact),
    /differs from its tarball at package\.json/u,
  );
});

test('package inventory rejects non-files before reading their bytes', {
  skip: process.platform === 'win32',
}, t => {
  const { installed } = app(t);
  execFileSync('mkfifo', [path.join(installed, 'pipe')], { timeout: 5_000 });
  assert.throws(() => readInstalledPackageFiles(installed), /non-file/u);
});
