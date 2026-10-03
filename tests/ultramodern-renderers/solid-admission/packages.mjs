import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const packageNames = ['@modern-js/renderer-core', '@modern-js/renderer-solid'];

/** Local tarballs are transport for unpublished owning packages. Native package
 * versions and peer constraints remain exactly those authored by their producer. */
export async function prepareRendererPackages(
  consumerDirectory,
  pnpm,
  runCommand = execute,
) {
  const packageManifest = process.env.MODERN_TEST_PACKAGE_MANIFEST;
  const tarballs = {};
  if (packageManifest) {
    const { packages } = JSON.parse(await readFile(packageManifest, 'utf8'));
    for (const name of packageNames) {
      const packed = packages?.[name];
      assert.ok(
        packed?.tarball && packed.integrity,
        `Packed prerequisite missing ${name}`,
      );
      const digest = createHash('sha256')
        .update(await readFile(packed.tarball))
        .digest('hex');
      assert.equal(
        digest,
        packed.integrity,
        `Packed prerequisite changed: ${name}`,
      );
      tarballs[name] = path.resolve(packed.tarball);
    }
  } else {
    const destination = path.join(consumerDirectory, 'packed');
    await mkdir(destination);
    for (const name of packageNames) {
      const packageDirectory = path.join(
        workspaceRoot,
        'packages/runtime',
        name.slice('@modern-js/'.length),
      );
      const manifest = JSON.parse(
        await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
      );
      const required = new Set([manifest.main, manifest.types]);
      const targets =
        manifest.exports[
          name === '@modern-js/renderer-solid' ? './router' : '.'
        ];
      const collect = target => {
        if (typeof target === 'string') {
          required.add(target);
          return;
        }
        for (const [condition, value] of Object.entries(target ?? {})) {
          if (condition !== 'modern:source') collect(value);
        }
      };
      collect(targets);
      for (const filename of required) {
        assert.ok(
          typeof filename === 'string' && filename.startsWith('./dist/'),
          `Invalid ${name} public build export: ${filename}`,
        );
        await access(path.join(packageDirectory, filename)).catch(() => {
          throw new Error(
            `Build ${name} before admission; missing ${filename}`,
          );
        });
      }
      await runCommand(pnpm, ['pack', '--pack-destination', destination], {
        cwd: packageDirectory,
        maxBuffer: 4 * 1024 * 1024,
      });
      const filename = `${name.replace(/^@/u, '').replaceAll('/', '-')}-${manifest.version}.tgz`;
      tarballs[name] = path.join(destination, filename);
      await access(tarballs[name]);
    }
  }
  // This matches the repository's packed-consumer transport. The overrides are
  // limited to our unpublished packages, never Solid/TanStack or their peers.
  await writeFile(
    path.join(consumerDirectory, 'pnpm-workspace.yaml'),
    JSON.stringify({
      packages: [],
      overrides: Object.fromEntries(
        Object.entries(tarballs).map(([name, tarball]) => [
          name,
          `file:${tarball}`,
        ]),
      ),
    }),
  );
  return Object.fromEntries(
    await Promise.all(
      Object.entries(tarballs).map(async ([name, tarball]) => [
        name,
        createHash('sha256')
          .update(await readFile(tarball))
          .digest('hex'),
      ]),
    ),
  );
}

export async function assertNativePackageGraph(consumerDirectory) {
  const resolve = createRequire(path.join(consumerDirectory, 'package.json'));
  const root = `${await realpath(consumerDirectory)}${path.sep}`;
  const router = await realpath(
    resolve.resolve('@modern-js/renderer-solid/router'),
  );
  assert.ok(
    router.startsWith(root),
    'Native router escaped the clean-room consumer',
  );
  assert.ok(
    !router.split(path.sep).includes('src'),
    'Native router selected authored source instead of built exports',
  );
  const manifest = JSON.parse(
    await readFile(
      resolve.resolve('@modern-js/renderer-solid/package.json'),
      'utf8',
    ),
  );
  assert.equal(manifest.version, '3.8.3');
  assert.equal(manifest.dependencies['@tanstack/router-core'], '1.171.32');
  assert.equal(manifest.dependencies['@tanstack/history'], '1.162.4');
  assert.equal(manifest.dependencies.isbot, '5.2.2');
  assert.equal(manifest.dependencies.seroval, '1.6.8');
  assert.equal(manifest.dependencies['seroval-plugins'], '1.6.8');
  assert.equal(manifest.dependencies['@tanstack/solid-router'], undefined);
  const nativeResolve = createRequire(router);
  const versions = {};
  async function installedManifest(name, resolver) {
    let current = path.dirname(await realpath(resolver.resolve(name)));
    while (current.startsWith(root)) {
      try {
        const candidate = JSON.parse(
          await readFile(path.join(current, 'package.json'), 'utf8'),
        );
        if (candidate.name === name)
          return { manifest: candidate, directory: current };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      current = path.dirname(current);
    }
    throw new Error(`Installed native package escaped the consumer: ${name}`);
  }
  for (const [name, expected] of Object.entries({
    'solid-js': '2.0.0-rc.13',
    '@solidjs/web': '2.0.0-rc.13',
    '@solidjs/signals': '2.0.0-rc.13',
    '@tanstack/router-core': '1.171.32',
    '@tanstack/history': '1.162.4',
    isbot: '5.2.2',
    seroval: '1.6.8',
    'seroval-plugins': '1.6.8',
  })) {
    const installed = await installedManifest(name, nativeResolve);
    assert.equal(
      installed.manifest.version,
      expected,
      `Native version drift: ${name}`,
    );
    versions[name] = installed.manifest.version;
  }
  for (const [name, expected] of Object.entries({
    '@solidjs/compiler': '2.0.0-rc.13',
    '@rsbuild/core': '2.2.9',
    '@babel/core': '7.29.7',
    playwright: '1.63.0',
    typescript: '7.0.2',
  })) {
    const installed = await installedManifest(name, resolve);
    assert.equal(
      installed.manifest.version,
      expected,
      `Compiler host version drift: ${name}`,
    );
    versions[name] = installed.manifest.version;
  }
  const rsbuild = await installedManifest('@rsbuild/core', resolve);
  const rsbuildResolve = createRequire(
    path.join(rsbuild.directory, 'package.json'),
  );
  const rspack = await installedManifest('@rspack/core', rsbuildResolve);
  assert.equal(rspack.manifest.version, '2.2.8', 'Rspack version drift');
  versions['@rspack/core'] = rspack.manifest.version;
  const core = await installedManifest('@tanstack/router-core', nativeResolve);
  const coreResolve = createRequire(path.join(core.directory, 'package.json'));
  const plugin = await installedManifest('seroval-plugins', coreResolve);
  const pluginResolve = createRequire(
    path.join(plugin.directory, 'package.json'),
  );
  assert.equal(
    (await installedManifest('seroval', pluginResolve)).manifest.version,
    '1.6.8',
    'Native router serializer plugin resolved an incompatible Seroval',
  );
  assert.equal(
    (await installedManifest('seroval', coreResolve)).manifest.version,
    '1.6.8',
    'Native router resolved an incompatible Seroval',
  );
  const installed = await readdir(
    path.join(consumerDirectory, 'node_modules/.pnpm'),
  );
  for (const name of installed) {
    assert.doesNotMatch(
      name,
      /^(?:@tanstack\+solid-router@|@solid-devtools\+|@solid-primitives\+|react@|react-dom@)/u,
      `Native dependency graph contains an unrelated or obsolete runtime: ${name}`,
    );
  }
  return {
    owningPackage: `${manifest.name}@${manifest.version}`,
    routerEntry: path.relative(root, router),
    versions,
  };
}
