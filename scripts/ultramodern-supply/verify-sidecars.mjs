#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import inventory from '../../packages/toolkit/ultramodern-create/src/ultramodern-workspace/patch-inventory.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const recipes = JSON.parse(
  fs.readFileSync(new URL('./sidecars.json', import.meta.url), 'utf8'),
);
const contractFields = [
  'type',
  'main',
  'module',
  'types',
  'exports',
  'typesVersions',
  'sideEffects',
  'files',
  'engines',
  'bin',
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'license',
];

function files(directory, prefix = '') {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const relative = path.posix.join(prefix, entry.name);
      assert.ok(
        entry.isDirectory() || entry.isFile(),
        `unexpected artifact type: ${relative}`,
      );
      return entry.isDirectory()
        ? files(path.join(directory, entry.name), relative)
        : [relative];
    })
    .sort();
}

/** Reconstruct from a pinned tarball in an owned temporary directory, then compare every artifact. */
export async function verifySidecar(
  id,
  { artifactsDir, packageDir, materializeTo } = {},
) {
  const recipe = recipes.find(item => item.id === id);
  assert.ok(recipe, `unknown sidecar: ${id}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-sidecar-'));
  try {
    const target = packageDir ?? path.join(root, 'packages/sidecar', id);
    if (!materializeTo && recipe.artifacts.includes('*')) {
      materializeTo = path.join(temp, 'reconstructed');
    }
    let bytes;
    if (artifactsDir) {
      // Explicit offline input must exist and is held to the same integrity check.
      bytes = fs.readFileSync(path.join(artifactsDir, `${id}.tgz`));
    } else {
      const response = await fetch(recipe.upstream.tarball, {
        signal: AbortSignal.timeout(30_000),
      });
      assert.ok(response.ok, `upstream fetch failed: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    assert.equal(
      integrity,
      recipe.upstream.integrity,
      `${id}: upstream tarball integrity`,
    );
    const tarball = path.join(temp, 'upstream.tgz');
    fs.writeFileSync(tarball, bytes);
    execFileSync('tar', ['-xzf', tarball, '-C', temp], { stdio: 'pipe' });
    const upstreamDir = path.join(temp, 'package');
    const upstream = JSON.parse(
      fs.readFileSync(path.join(upstreamDir, 'package.json'), 'utf8'),
    );
    assert.equal(upstream.name, recipe.upstream.name);
    assert.equal(upstream.version, recipe.upstream.version);
    assert.equal(upstream.license, recipe.license);
    if (recipe.patch) {
      let patch = recipe.patch;
      if (patch.inventory) {
        patch = inventory.find(
          item => `${item.packageName}@${item.version}` === patch.inventory,
        );
        assert.ok(patch, `${id}: missing canonical patch`);
      }
      const patchBytes = fs.readFileSync(path.join(root, patch.path));
      assert.equal(
        createHash('sha256').update(patchBytes).digest('hex'),
        patch.sha256,
        `${id}: recipe patch integrity`,
      );
      execFileSync('patch', ['-p1', '--fuzz=0', '--batch'], {
        cwd: upstreamDir,
        input: patchBytes,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    if (materializeTo) {
      assert.deepEqual(
        recipe.artifacts,
        ['*'],
        `${id}: reconstruction requires the complete upstream artifact`,
      );
      const projected = {
        ...upstream,
        name: recipe.fork.name,
        version: recipe.fork.version,
        publishConfig: {
          registry: 'https://registry.npmjs.org/',
          access: 'public',
        },
        repository: {
          type: 'git',
          url: 'git+https://github.com/BleedingDev/ultramodern.js.git',
          directory: 'scripts/ultramodern-supply',
        },
      };
      for (const [key, changes] of Object.entries(recipe.manifestChanges)) {
        for (const dependencyName of Object.keys(changes)) {
          assert.ok(
            Object.hasOwn(upstream[key] ?? {}, dependencyName),
            `${id}: recipe changes absent upstream ${key}.${dependencyName}`,
          );
        }
        projected[key] = { ...upstream[key], ...changes };
      }
      if (packageDir) {
        const fork = JSON.parse(
          fs.readFileSync(path.join(target, 'package.json'), 'utf8'),
        );
        assert.deepEqual(
          fork,
          projected,
          `${id}: recipe must account for every manifest field`,
        );
      }
      fs.writeFileSync(
        path.join(upstreamDir, 'package.json'),
        `${JSON.stringify(projected, null, 2)}\n`,
      );
      fs.rmSync(materializeTo, { recursive: true, force: true });
      fs.cpSync(upstreamDir, materializeTo, { recursive: true });
      console.log(
        `Reconstructed ${id}: authenticated ${recipe.upstream.name}@${recipe.upstream.version}, exact patch and publication manifest.`,
      );
      return upstream;
    }
    const fork = JSON.parse(
      fs.readFileSync(path.join(target, 'package.json'), 'utf8'),
    );
    assert.equal(fork.name, recipe.fork.name);
    assert.equal(fork.version, recipe.fork.version);
    for (const key of contractFields) {
      const expected = recipe.manifestChanges[key]
        ? { ...upstream[key], ...recipe.manifestChanges[key] }
        : upstream[key];
      assert.deepEqual(fork[key], expected, `${id}: manifest ${key}`);
    }
    if (recipe.artifacts.includes('*')) {
      const expectedDevDependencies = recipe.manifestChanges.devDependencies
        ? {
            ...upstream.devDependencies,
            ...recipe.manifestChanges.devDependencies,
          }
        : upstream.devDependencies;
      assert.deepEqual(
        fork.devDependencies,
        expectedDevDependencies,
        `${id}: manifest devDependencies`,
      );
    }
    for (const artifact of recipe.artifacts) {
      if (artifact === '*') {
        const upstreamFiles = files(upstreamDir).filter(
          file => file !== 'package.json',
        );
        const forkFiles = files(target).filter(file => file !== 'package.json');
        assert.deepEqual(
          forkFiles,
          upstreamFiles,
          `${id}: complete artifact set`,
        );
        for (const file of upstreamFiles) {
          const expectedPath = path.join(upstreamDir, file);
          const actualPath = path.join(target, file);
          assert.deepEqual(
            fs.readFileSync(actualPath),
            fs.readFileSync(expectedPath),
            `${id}: ${file}`,
          );
          assert.equal(
            fs.statSync(actualPath).mode & 0o111,
            fs.statSync(expectedPath).mode & 0o111,
            `${id}: executable mode ${file}`,
          );
        }
        continue;
      }
      const source = path.join(upstreamDir, artifact);
      const destination = path.join(target, artifact);
      const directory = fs.statSync(source).isDirectory();
      const entries = directory ? files(source) : [''];
      if (directory)
        assert.deepEqual(
          files(destination),
          entries,
          `${id}: ${artifact} file set`,
        );
      for (const file of entries) {
        const expectedPath = path.join(source, file);
        const actualPath = path.join(destination, file);
        assert.deepEqual(
          fs.readFileSync(actualPath),
          fs.readFileSync(expectedPath),
          `${id}: ${artifact}/${file}`,
        );
        assert.equal(
          fs.statSync(actualPath).mode & 0o111,
          fs.statSync(expectedPath).mode & 0o111,
          `${id}: executable mode ${artifact}/${file}`,
        );
      }
    }
    console.log(
      `Verified ${id}: pinned ${recipe.upstream.name}@${recipe.upstream.version}, recipe, manifest, license and all runtime artifacts.`,
    );
    return upstream;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const offline = args.indexOf('--artifacts');
  const artifactsDir = offline < 0 ? undefined : args.splice(offline, 2)[1];
  assert.ok(offline < 0 || artifactsDir, '--artifacts requires a directory');
  for (const id of args.length ? args : recipes.map(item => item.id))
    await verifySidecar(id, { artifactsDir });
}
