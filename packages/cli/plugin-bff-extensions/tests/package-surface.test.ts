import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

type ExportConditions = {
  types: string;
  'modern:source': string;
  node: {
    import: string;
    require: string;
  };
  import?: string;
  default: string;
};

type PackageManifest = {
  bugs: string;
  dependencies: Record<string, string>;
  description: string;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
  exports: Record<string, ExportConditions | string>;
  files: string[];
  homepage: string;
  keywords: string[];
  main?: string;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
  publishConfig: Record<string, string>;
  repository: {
    directory: string;
    type: string;
    url: string;
  };
  scripts: Record<string, string>;
  sideEffects: boolean;
  types?: string;
  typesVersions: Record<string, Record<string, string[]>>;
};

const packageRoot = path.resolve(__dirname, '..');
const requireCjs = createRequire(import.meta.url);
const packageManifest = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as PackageManifest;

const sourceLoaders = {
  './hono': {
    target: './src/hono/index.ts',
    load: () => import('../src/hono'),
  },
  './cross-project-policy': {
    target: './src/cross-project-policy/index.ts',
    load: () => import('../src/cross-project-policy'),
  },
  './cross-project-generation': {
    target: './src/cross-project-generation/index.ts',
    load: () => import('../src/cross-project-generation'),
  },
  './effect-adapter': {
    target: './src/effect-adapter/index.ts',
    load: () => import('../src/effect-adapter'),
  },
  './effect-source-loader': {
    target: './src/effect-source-loader/index.ts',
    load: () => import('../src/effect-source-loader'),
  },
  './client-generator': {
    target: './src/client-generator/index.ts',
    load: () => import('../src/client-generator'),
  },
  './backend-federation': {
    target: './src/backend-federation/index.ts',
    load: () => import('../src/backend-federation'),
  },
  './backend-federation/edge': {
    target: './src/backend-federation/edge.ts',
    load: () => import('../src/backend-federation/edge'),
  },
  './backend-federation/node': {
    target: './src/backend-federation/node.ts',
    load: () => import('../src/backend-federation/node'),
  },
  './backend-federation-manifest': {
    target: './src/backend-federation-manifest/index.ts',
    load: () => import('../src/backend-federation-manifest'),
  },
  './backend-federation-manifest/node': {
    target: './src/backend-federation-manifest/node.ts',
    load: () => import('../src/backend-federation-manifest/node'),
  },
} as const;

const publicSubpaths = Object.keys(sourceLoaders) as Array<
  keyof typeof sourceLoaders
>;
const webSubpaths = new Set<keyof typeof sourceLoaders>([
  './hono',
  './backend-federation',
  './backend-federation/edge',
]);

function conditionsFor(subpath: keyof typeof sourceLoaders) {
  return packageManifest.exports[subpath] as ExportConditions;
}

function expectLoadedNamespace(value: unknown, label: string) {
  const isCallable = typeof value === 'function';
  const hasExports =
    typeof value === 'object' &&
    value !== null &&
    Reflect.ownKeys(value).some(key => key !== '__esModule');
  expect(isCallable || hasExports, `${label} must expose a public API`).toBe(
    true,
  );
}

describe('@modern-js/plugin-bff-extensions package surface', () => {
  test('attributes the fork-owned package to UltraModern.js', () => {
    expect(packageManifest.description).toContain('UltraModern.js');
    expect(packageManifest.homepage).toBe(
      'https://github.com/BleedingDev/ultramodern.js#readme',
    );
    expect(packageManifest.bugs).toBe(
      'https://github.com/BleedingDev/ultramodern.js/issues',
    );
    expect(packageManifest.repository).toEqual({
      type: 'git',
      url: 'https://github.com/BleedingDev/ultramodern.js',
      directory: 'packages/cli/plugin-bff-extensions',
    });
    expect(packageManifest.keywords).toContain('ultramodern.js');
    expect(packageManifest.files).toEqual(['dist', 'src']);
    expect(packageManifest.types).toBeUndefined();
    expect(packageManifest.main).toBeUndefined();
    expect(packageManifest.sideEffects).toBe(false);
    expect(packageManifest.engines).toEqual({ node: '>=26.7.0' });
    expect(packageManifest.publishConfig).toEqual({
      registry: 'https://registry.npmjs.org/',
      access: 'public',
    });
    expect(packageManifest.scripts).toMatchObject({
      build: 'rslib build',
      prepublishOnly: 'only-allow-pnpm',
      pretest: 'pnpm run build',
      test: 'rstest',
    });
  });

  test('declares only the source graph runtime dependencies', () => {
    expect(Object.keys(packageManifest.dependencies).sort()).toEqual(
      [
        '@modern-js/bff-core',
        '@modern-js/bff-effect',
        '@modern-js/runtime-extensions',
        '@modern-js/server-core',
        '@modern-js/server-runtime-extensions',
        '@modern-js/types',
        '@modern-js/utils',
        '@module-federation/runtime',
        'esbuild',
      ].sort(),
    );
    expect(
      packageManifest.dependencies['@modern-js/plugin-bff'],
    ).toBeUndefined();
  });

  test('keeps the exact Effect cohort optional for Hono-only consumers', () => {
    const effectVersion = '4.0.0-rc.112';

    for (const peerName of ['effect', '@effect/opentelemetry']) {
      expect({
        dependency: packageManifest.dependencies[peerName],
        devDependency: packageManifest.devDependencies[peerName],
        optional: packageManifest.peerDependenciesMeta[peerName]?.optional,
        peer: packageManifest.peerDependencies[peerName],
      }).toEqual({
        dependency: undefined,
        devDependency: effectVersion,
        optional: true,
        peer: effectVersion,
      });
    }

    const honoEntry = readFileSync(
      path.join(packageRoot, 'src/hono/index.ts'),
      'utf8',
    );
    expect(honoEntry).not.toMatch(/(?:^|[/'"])(?:effect)(?:[/'"]|$)/u);
  });

  test('loads built Hono exports without resolving optional Effect peers', () => {
    const conditions = conditionsFor('./hono');
    const esmEntries = [conditions.node.import, conditions.import].map(
      entry => pathToFileURL(path.resolve(packageRoot, entry!)).href,
    );
    const cjsEntries = [path.resolve(packageRoot, conditions.node.require)];
    const script = `
      import { createRequire, registerHooks } from 'node:module';

      const optionalEffectPeers = ['effect', '@effect/opentelemetry'];
      registerHooks({
        resolve(specifier, context, nextResolve) {
          const forbiddenPeer = optionalEffectPeers.find(
            peer => specifier === peer || specifier.startsWith(peer + '/'),
          );
          if (forbiddenPeer) {
            throw new Error('built Hono surface resolved optional peer: ' + specifier);
          }
          return nextResolve(specifier, context);
        },
      });

      for (const entry of ${JSON.stringify(esmEntries)}) {
        await import(entry);
      }

      const require = createRequire(import.meta.url);
      for (const entry of ${JSON.stringify(cjsEntries)}) {
        require(entry);
      }
    `;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: packageRoot,
        encoding: 'utf8',
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.signal).toBeNull();
  });

  test('loads every declared CJS, ESM, and modern:source export', async () => {
    expect(Object.keys(packageManifest.exports).sort()).toEqual(
      ['./package.json', ...publicSubpaths].sort(),
    );

    for (const subpath of publicSubpaths) {
      const conditions = conditionsFor(subpath);
      const source = sourceLoaders[subpath];
      expect(conditions['modern:source']).toBe(source.target);
      expect(existsSync(path.resolve(packageRoot, conditions.types))).toBe(
        true,
      );
      const typeVersionKey = subpath === '.' ? '.' : subpath.slice(2);
      expect(packageManifest.typesVersions['*'][typeVersionKey]).toEqual([
        conditions.types,
        conditions['modern:source'],
      ]);
      expect(conditions.import !== undefined).toBe(webSubpaths.has(subpath));

      expectLoadedNamespace(
        await source.load(),
        `${subpath} modern:source export`,
      );
      expectLoadedNamespace(
        requireCjs(path.resolve(packageRoot, conditions.node.require)),
        `${subpath} CJS export`,
      );
      expectLoadedNamespace(
        await import(
          pathToFileURL(path.resolve(packageRoot, conditions.node.import)).href
        ),
        `${subpath} Node ESM export`,
      );

      if (conditions.import) {
        expectLoadedNamespace(
          await import(
            pathToFileURL(path.resolve(packageRoot, conditions.import)).href
          ),
          `${subpath} web ESM export`,
        );
      }
    }
  });

  test('publishes semantic entry points without convenience-only APIs', async () => {
    expect(packageManifest.exports['.']).toBeUndefined();
    expect(packageManifest.typesVersions['*']['.']).toBeUndefined();
    expect(existsSync(path.join(packageRoot, 'src/index.ts'))).toBe(false);

    expect(Object.keys(await sourceLoaders['./hono'].load()).sort()).toEqual([
      'bindHonoRouteHandlers',
    ]);
    expect(
      Object.keys(await sourceLoaders['./cross-project-policy'].load()).sort(),
    ).toEqual(['resolveAdapterCrossProjectPolicy']);
    expect(
      Object.keys(await sourceLoaders['./effect-source-loader'].load()).sort(),
    ).toEqual([
      'bundleEffectEntryForNode',
      'generateEffectClientCode',
      'generateEffectWorkerRuntimeWrapper',
      'resolveEffectEntryFile',
    ]);
    expect(
      Object.keys(await sourceLoaders['./backend-federation'].load()).sort(),
    ).toEqual(
      [
        'BACKEND_FEDERATION_CONTRACT_VERSION',
        'BACKEND_FEDERATION_EFFECT_EXPOSE',
        'BACKEND_FEDERATION_MANIFEST_FILE',
        'BACKEND_FEDERATION_NODE_ADAPTER_VERSION',
        'createBackendFederationLoadEntryPlugin',
        'createBackendFederationRuntime',
        'validateExpectedBackendFederationIdentity',
      ].sort(),
    );
    expect(
      Object.keys(
        await sourceLoaders['./backend-federation-manifest'].load(),
      ).sort(),
    ).toEqual(
      [
        'BackendFederationManifestAdapterError',
        'loadBackendFederationManifest',
        'resolveBackendFederationRemoteFromManifest',
      ].sort(),
    );
  });

  test('keeps the built edge federation cone free of Node evaluators', async () => {
    const edgeEntry = path.join(
      packageRoot,
      'dist/esm/backend-federation/edge.mjs',
    );
    const result = await build({
      bundle: true,
      entryPoints: [edgeEntry],
      format: 'esm',
      packages: 'external',
      platform: 'browser',
      target: 'es2021',
      write: false,
    });
    const output = result.outputFiles.map(file => file.text).join('\n');

    for (const forbidden of [
      /\bnode:/u,
      /\bcreateRequire\b/u,
      /\bnew Function\b/u,
      /\beval\s*\(/u,
      /\bModuleFederation\b/u,
      /@module-federation\/runtime/u,
      /evaluateNodeBackendFederationCommonJs/u,
      /loadBackendFederationExpose/u,
      /backend-federation-security\/node/u,
    ]) {
      expect(output).not.toMatch(forbidden);
    }
  });

  test('maps every public source entry to its generated declaration', () => {
    const generatedTypeTargets = publicSubpaths.map(subpath => {
      const conditions = conditionsFor(subpath);
      const sourceTarget = sourceLoaders[subpath].target;
      const expectedTypeTarget = sourceTarget
        .replace(/^\.\/src\//u, './dist/types/')
        .replace(/\.[cm]?[jt]sx?$/u, '.d.ts');

      expect(conditions.types).toBe(expectedTypeTarget);
      expect(existsSync(path.join(packageRoot, conditions.types))).toBe(true);
      const declaration = readFileSync(
        path.join(packageRoot, conditions.types),
        'utf8',
      );
      expect(declaration.trim().length).toBeGreaterThan(0);
      expect(declaration).toMatch(/\bexport\b/u);
      expect(declaration).not.toContain('adapter-kit');

      return conditions.types;
    });

    expect(new Set(generatedTypeTargets).size).toBe(publicSubpaths.length);
    expect(
      Object.values(packageManifest.typesVersions['*']).map(
        targets => targets[0],
      ),
    ).toEqual(generatedTypeTargets);
  });

  test('dry-run pack includes product files and excludes internal surfaces', () => {
    const result = spawnSync('pnpm', ['pack', '--dry-run', '--json'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);

    const report = JSON.parse(result.stdout) as {
      files: Array<{ path: string }>;
    };
    const packedPaths = report.files.map(file => file.path);
    expect(packedPaths.some(file => file.startsWith('dist/'))).toBe(true);
    expect(packedPaths.some(file => file.startsWith('src/'))).toBe(true);
    expect(packedPaths).toContain('package.json');
    expect(packedPaths.some(file => file.includes('adapter-kit'))).toBe(false);

    const allowedRootFiles = new Set(['LICENSE', 'README.md', 'package.json']);
    for (const packedPath of packedPaths) {
      expect(
        packedPath.startsWith('dist/') ||
          packedPath.startsWith('src/') ||
          allowedRootFiles.has(packedPath),
        `unexpected non-product file in package: ${packedPath}`,
      ).toBe(true);
    }
  });

  test('does not publish adapter-kit or undeclared convenience subpaths', () => {
    const serializedSurface = JSON.stringify({
      exports: packageManifest.exports,
      typesVersions: packageManifest.typesVersions,
    });
    expect(serializedSurface).not.toContain('adapter-kit');
    expect(serializedSurface).not.toContain('worker-runtime-wrapper');
  });
});
