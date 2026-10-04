import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorEntryVariants } from './entries.mjs';
import { renderers } from './matrix.mts';
import { resolveRsbuildDependency } from './rsbuild-dependency.mjs';
import { nativeTypePrograms } from './type-programs.mjs';

const fixtureRoot = fileURLToPath(
  new URL(
    '../../../tests/ultramodern-renderers/conformance/fixtures/',
    import.meta.url,
  ),
);

const exactVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*))*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/u;

// Fixture authoring projects the frozen public profile and transport receipt.
// Installed manifest/profile, lock origin and archive bytes are audited separately.
export const MAINTAINED_NATIVE_TRANSPORTS = Object.freeze({
  octane: Object.freeze({
    renderer: 'octane',
    name: 'octane',
    version: '0.7.1+ultramodern.f75bf12ac8be',
    url: 'https://github.com/bleedingdev/octane/releases/download/octane%400.7.1%2Bultramodern.f75bf12ac8be/octane-0.7.1%2Bultramodern.f75bf12ac8be.tgz',
    integrity:
      'sha512-CpB2o7Mzq6I/e9udqhC47ud8nC/S4kWzviackzW+ekKK5mJVuAv84JkHx3Ar1eX8rabcYUT/jygn6Acvus9siw==',
    sha256: '485b62884e9e85621ad9d58347fed22dc66a628a9a7ec5f1c4cd5c7a86643137',
  }),
  '@octanejs/tanstack-router': Object.freeze({
    renderer: 'octane',
    name: '@octanejs/tanstack-router',
    version: '0.1.60+ultramodern.6c31d4be4768',
    url: 'https://github.com/bleedingdev/octane/releases/download/%40octanejs%2Ftanstack-router%400.1.60%2Bultramodern.6c31d4be4768/octanejs-tanstack-router-0.1.60%2Bultramodern.6c31d4be4768.tgz',
    integrity:
      'sha512-kRzYWp7WTIeyD64QsHXiNAYTHvX0RaCFhD/dLQkuGwEZXWW6yEsT7IG3+6Uy4deMYnlDssCYU2NMJpybdfhZ6Q==',
    sha256: 'a153fc802498dcd20034fc4a9596288e69d7ba0155e02e339e900a8c05ca27eb',
  }),
});

export function requiredFixtureDependencies(renderer) {
  return [
    '@bleedingdev/modern-js-ultramodern-app-tools',
    '@rsbuild/core',
    '@types/node',
    ...(renderer === 'react'
      ? [
          '@bleedingdev/modern-js-plugin-tanstack',
          '@bleedingdev/modern-js-runtime',
          'react',
          'react-dom',
          '@tanstack/react-router',
          '@types/react',
          '@types/react-dom',
        ]
      : [
          `@bleedingdev/modern-js-renderer-${renderer}`,
          '@bleedingdev/modern-js-renderer-core',
          ...(renderer === 'solid' ? ['@solidjs/web', 'solid-js'] : ['octane']),
        ]),
  ];
}

/** Copies authored app source into a new owned consumer; never writes generated output. */
export async function createHandAuthoredConsumer({
  consumerRoot,
  renderer,
  dependencySpecs,
  scripts,
  minimumNode,
  releaseManifest,
}) {
  if (!renderers.includes(renderer) || !path.isAbsolute(consumerRoot ?? '')) {
    throw new Error(
      'Hand-authored consumer requires a known renderer and absolute owned path',
    );
  }
  if (!/^\d+\.\d+\.\d+$/u.test(minimumNode ?? ''))
    throw new Error('An exact minimum Node version is required');
  if (
    !dependencySpecs ||
    !Object.keys(dependencySpecs).length ||
    !dependencySpecs['@bleedingdev/modern-js-ultramodern-app-tools']
  ) {
    throw new Error(
      'The actual mapped public app-tools package must be installed',
    );
  }
  if (
    releaseManifest !== undefined ||
    (typeof dependencySpecs['@rsbuild/core'] === 'string' &&
      dependencySpecs['@rsbuild/core'].startsWith('npm:'))
  ) {
    dependencySpecs = {
      ...dependencySpecs,
      '@rsbuild/core': resolveRsbuildDependency({
        releaseManifest,
        specifier: dependencySpecs['@rsbuild/core'],
      }),
    };
  }
  for (const [name, version] of Object.entries(dependencySpecs)) {
    if (
      typeof version !== 'string' ||
      !/^(?:@[a-z\d_.-]+\/)?[a-z\d_.-]+$/iu.test(name)
    )
      throw new Error(
        'Fixture dependencies must use exact admitted registry versions',
      );
    const transport = Object.hasOwn(MAINTAINED_NATIVE_TRANSPORTS, name)
      ? MAINTAINED_NATIVE_TRANSPORTS[name]
      : undefined;
    if (transport && version === transport.version)
      throw new Error(
        `Maintained ${name}@${transport.version} requires its exact public archive URL; registry specs ignore build metadata`,
      );
    if (transport && version === transport.url) {
      if (renderer !== transport.renderer)
        throw new Error(
          `Maintained ${name} transport requires renderer octane`,
        );
      continue;
    }
    if (name === '@rsbuild/core' && releaseManifest !== undefined) continue;
    if (!exactVersion.test(version))
      throw new Error(
        "Fixture dependencies must use exact admitted registry versions or the configured renderer's exact maintained archive tuple",
      );
  }
  for (const name of requiredFixtureDependencies(renderer))
    if (!dependencySpecs[name])
      throw new Error(
        `Authored ${renderer} fixture requires its direct native dependency ${name}`,
      );
  if (
    !scripts ||
    !['typecheck', 'build'].every(
      name => typeof scripts[name] === 'string' && scripts[name],
    )
  ) {
    throw new Error('Native typecheck and build scripts are required');
  }
  await fs.mkdir(consumerRoot, { recursive: false });
  try {
    for (const entry of await fs.readdir(path.join(fixtureRoot, renderer))) {
      await fs.cp(
        path.join(fixtureRoot, renderer, entry),
        path.join(consumerRoot, entry),
        {
          recursive: true,
          errorOnExist: true,
          force: false,
        },
      );
    }
    await fs.copyFile(
      path.join(fixtureRoot, 'observe-native-compiler.ts'),
      path.join(consumerRoot, 'observe-native-compiler.ts'),
    );
    const entries = await authorEntryVariants(consumerRoot, {
      compilerObservation: true,
    });
    if (renderer !== 'react') {
      const programs = nativeTypePrograms(renderer, Object.keys(entries));
      for (const [role, program] of Object.entries(programs))
        await fs.writeFile(
          path.join(consumerRoot, `tsconfig.native-${role}.json`),
          `${JSON.stringify(program, null, 2)}\n`,
          { flag: 'wx' },
        );
    }
    const packageJson = {
      name: `renderer-acceptance-${renderer}`,
      private: true,
      type: 'module',
      engines: { node: `>=${minimumNode}` },
      scripts,
      dependencies: dependencySpecs,
    };
    await fs.writeFile(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      { flag: 'wx' },
    );
    const digest = createHash('sha256');
    async function hashSources(directory) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await hashSources(file);
        else {
          digest.update(path.relative(consumerRoot, file));
          digest.update(await fs.readFile(file));
        }
      }
    }
    await hashSources(consumerRoot);
    return {
      consumerRoot,
      renderer,
      kind: 'hand-authored',
      sourceSha256: digest.digest('hex'),
      cleanupPath: consumerRoot,
      entries,
    };
  } catch (error) {
    await fs.rm(consumerRoot, { recursive: true, force: true });
    throw error;
  }
}
