import assert from 'node:assert/strict';
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
    await assert.rejects(
      verifySidecar('ipx', { artifactsDir: directory }),
      /ENOENT/,
    );
    fs.writeFileSync(path.join(directory, 'ipx.tgz'), 'untrusted bytes');
    await assert.rejects(
      verifySidecar('ipx', { artifactsDir: directory }),
      /upstream tarball integrity/,
    );
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
