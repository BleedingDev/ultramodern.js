import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifySidecar } from './verify-sidecars.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('explicit offline provenance fails closed on missing or tampered tarballs', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sidecar-integrity-'),
  );
  try {
    for (const id of ['ipx', 'jiti', 'rsbuild-core']) {
      await assert.rejects(
        verifySidecar(id, { artifactsDir: directory }),
        /ENOENT/,
      );
      fs.writeFileSync(path.join(directory, `${id}.tgz`), 'untrusted bytes');
      await assert.rejects(
        verifySidecar(id, { artifactsDir: directory }),
        /upstream tarball integrity/,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('reconstruction accepts the vendored artifact and rejects an unreviewed runtime change', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sidecar-reconstruction-'),
  );
  try {
    const recipe = JSON.parse(
      fs.readFileSync(new URL('./sidecars.json', import.meta.url), 'utf8'),
    ).find(item => item.id === 'rsbuild-image-core');
    const response = await fetch(recipe.upstream.tarball, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok);
    fs.writeFileSync(
      path.join(directory, 'rsbuild-image-core.tgz'),
      Buffer.from(await response.arrayBuffer()),
    );
    const packageDir = path.join(directory, 'fork');
    fs.cpSync(
      path.join(root, 'packages/sidecar/rsbuild-image-core'),
      packageDir,
      { recursive: true },
    );
    const options = { artifactsDir: directory, packageDir };
    await verifySidecar('rsbuild-image-core', options);
    fs.appendFileSync(
      path.join(packageDir, 'dist/index.js'),
      '\n// unreviewed change\n',
    );
    await assert.rejects(
      verifySidecar('rsbuild-image-core', options),
      /dist\/index.js/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('reconstruction drops node_modules the upstream tarball shipped but pnpm never installs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-node-'));
  try {
    const recipe = JSON.parse(
      fs.readFileSync(new URL('./sidecars.json', import.meta.url), 'utf8'),
    ).find(item => item.id === 'mf-node');
    const response = await fetch(recipe.upstream.tarball, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok);
    const tarball = path.join(directory, 'mf-node.tgz');
    fs.writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
    const shipped = execFileSync('tar', ['-tzf', tarball], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(entry => entry.split('/').includes('node_modules'));
    assert.ok(shipped.length > 0, 'upstream fixture still ships node_modules');
    const packageDir = path.join(directory, 'reconstructed');
    await verifySidecar('mf-node', {
      artifactsDir: directory,
      materializeTo: packageDir,
    });
    const stack = [packageDir];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        assert.notEqual(entry.name, 'node_modules', current);
        if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      }
    }
    assert.ok(fs.statSync(path.join(packageDir, 'dist/src/index.js')).isFile());
    await verifySidecar('mf-node', { artifactsDir: directory, packageDir });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Rsbuild reconstruction preserves the complete public package and rejects unpatched, modified, missing and mode drift', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rsbuild-reconstruction-'),
  );
  try {
    const recipe = JSON.parse(
      fs.readFileSync(new URL('./sidecars.json', import.meta.url), 'utf8'),
    ).find(item => item.id === 'rsbuild-core');
    const response = await fetch(recipe.upstream.tarball, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok);
    fs.writeFileSync(
      path.join(directory, 'rsbuild-core.tgz'),
      Buffer.from(await response.arrayBuffer()),
    );
    const packageDir = path.join(directory, 'maintained');
    const upstream = await verifySidecar('rsbuild-core', {
      artifactsDir: directory,
      materializeTo: packageDir,
    });
    const packedManifest = JSON.parse(
      fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
    );
    for (const field of [
      'exports',
      'types',
      'bin',
      'dependencies',
      'peerDependencies',
      'license',
    ])
      assert.deepEqual(
        packedManifest[field],
        upstream[field],
        `Rsbuild public ${field}`,
      );
    const options = { artifactsDir: directory, packageDir };
    await verifySidecar('rsbuild-core', options);
    const runtime = path.join(packageDir, 'dist/m.js');
    const original = fs.readFileSync(runtime);
    fs.writeFileSync(
      runtime,
      execFileSync(
        'tar',
        ['-xOf', path.join(directory, 'rsbuild-core.tgz'), 'package/dist/m.js'],
        { maxBuffer: 16 * 1024 * 1024 },
      ),
    );
    await assert.rejects(verifySidecar('rsbuild-core', options), /dist\/m.js/u);
    fs.writeFileSync(runtime, original);
    fs.appendFileSync(runtime, '\n// unreviewed runtime change\n');
    await assert.rejects(verifySidecar('rsbuild-core', options), /dist\/m.js/u);
    fs.writeFileSync(runtime, original);
    const mode = fs.statSync(runtime).mode & 0o777;
    fs.chmodSync(runtime, mode ^ 0o100);
    await assert.rejects(
      verifySidecar('rsbuild-core', options),
      /executable mode dist\/m.js/u,
    );
    fs.chmodSync(runtime, mode);
    fs.unlinkSync(runtime);
    await assert.rejects(
      verifySidecar('rsbuild-core', options),
      /complete artifact set/u,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
