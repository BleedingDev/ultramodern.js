import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
  imports: Record<string, { default: string; types: string }>;
  keywords: string[];
  main: string;
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
  types: string;
  typesVersions: Record<string, Record<string, string[]>>;
};

const packageRoot = path.resolve(__dirname, '..');
const requireCjs = createRequire(import.meta.url);
const packageManifest = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as PackageManifest;

const sourceLoaders = {
  '.': {
    target: './src/index.ts',
    load: () => import('../src/index'),
  },
  './effect': {
    target: './src/effect/index.ts',
    load: () => import('../src/effect'),
  },
  './effect-edge': {
    target: './src/effect/edge.ts',
    load: () => import('../src/effect/edge'),
  },
  './effect-client': {
    target: './src/effect-client/index.ts',
    load: () => import('../src/effect-client'),
  },
  './effect-client-runtime': {
    target: './src/effect-client/runtime.ts',
    load: () => import('../src/effect-client/runtime'),
  },
  './data-platform': {
    target: './src/data-platform/index.ts',
    load: () => import('../src/data-platform'),
  },
} as const;

const publicSubpaths = Object.keys(sourceLoaders) as Array<
  keyof typeof sourceLoaders
>;

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

describe('@modern-js/bff-effect package surface', () => {
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
      directory: 'packages/server/bff-effect',
    });
    expect(packageManifest.keywords).toContain('ultramodern.js');
    expect(packageManifest.files).toEqual(['dist', 'src']);
    expect(packageManifest.types).toBe('./dist/types/index.d.ts');
    expect(packageManifest.main).toBe('./dist/cjs/index.js');
    expect(packageManifest.imports).toEqual({
      '#effect-entry-shape-registry': {
        types: './src/effect/entry-shape-registry.d.cts',
        default: './src/effect/entry-shape-registry.cjs',
      },
    });
    expect(packageManifest.sideEffects).toBe(false);
    expect(packageManifest.engines).toEqual({ node: '>=26.7.0' });
    expect(packageManifest.publishConfig).toEqual({
      registry: 'https://registry.npmjs.org/',
      access: 'public',
      types: './dist/types/index.d.ts',
    });
    expect(packageManifest.scripts.build).toBe('rslib build');
    expect(packageManifest.scripts.test).toBe('rstest');
    expect(packageManifest.scripts.prepublishOnly).toBe('only-allow-pnpm');
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

      expectLoadedNamespace(
        await source.load(),
        `${subpath} modern:source export`,
      );

      const cjsPath = path.resolve(packageRoot, conditions.node.require);
      expectLoadedNamespace(requireCjs(cjsPath), `${subpath} CJS export`);

      const esmTargets = new Set([
        conditions.node.import,
        conditions.import,
        conditions.default.endsWith('.mjs') ? conditions.default : undefined,
      ]);
      esmTargets.delete(undefined);
      for (const target of esmTargets) {
        const targetPath = path.resolve(packageRoot, target as string);
        expectLoadedNamespace(
          await import(pathToFileURL(targetPath).href),
          `${subpath} ESM export ${target}`,
        );
      }

      if (conditions.default.endsWith('.js')) {
        expectLoadedNamespace(
          requireCjs(path.resolve(packageRoot, conditions.default)),
          `${subpath} default CJS export`,
        );
      }
    }
  });

  test('shares validator-aware factory identity across CJS and ESM builds', async () => {
    const cjsEntryShape = requireCjs(
      path.join(packageRoot, 'dist/cjs/effect/entry-shape.js'),
    ) as {
      registerValidatorAwareHandlerFactory: <TFactory extends Function>(
        factory: TFactory,
      ) => TFactory;
    };
    const esmEntryShape = (await import(
      pathToFileURL(
        path.join(packageRoot, 'dist/esm-node/effect/entry-shape.mjs'),
      ).href
    )) as {
      isValidatorAwareHandlerFactory: (factory: unknown) => boolean;
    };
    const factory = () => undefined;

    cjsEntryShape.registerValidatorAwareHandlerFactory(factory);

    expect(esmEntryShape.isValidatorAwareHandlerFactory(factory)).toBe(true);
  });

  test('resolves every declared types export with TypeScript 7', () => {
    const fixtureRoot = mkdtempSync(
      path.join(tmpdir(), 'bff-effect-types-surface-'),
    );

    try {
      const packageLinkParent = path.join(
        fixtureRoot,
        'node_modules/@modern-js',
      );
      mkdirSync(packageLinkParent, { recursive: true });
      symlinkSync(
        packageRoot,
        path.join(packageLinkParent, 'bff-effect'),
        'dir',
      );

      const typeImports = publicSubpaths
        .map((subpath, index) => {
          const specifier =
            subpath === '.'
              ? '@modern-js/bff-effect'
              : `@modern-js/bff-effect/${subpath.slice(2)}`;
          return `import * as Entry${index} from ${JSON.stringify(
            specifier,
          )};\ntype ExportKeys${index} = keyof typeof Entry${index};\ndeclare const key${index}: ExportKeys${index};\nvoid key${index};`;
        })
        .join('\n');
      writeFileSync(path.join(fixtureRoot, 'index.ts'), `${typeImports}\n`);
      const nodeTypesManifestPath = requireCjs.resolve(
        '@types/node/package.json',
      );
      const reactTypesManifestPath = requireCjs.resolve(
        '@types/react/package.json',
      );
      writeFileSync(
        path.join(fixtureRoot, 'tsconfig.json'),
        `${JSON.stringify(
          {
            compilerOptions: {
              lib: ['DOM', 'ESNext'],
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmit: true,
              skipLibCheck: false,
              strict: true,
              target: 'ES2024',
              typeRoots: [
                path.dirname(path.dirname(nodeTypesManifestPath)),
                path.dirname(path.dirname(reactTypesManifestPath)),
              ],
              types: ['node', 'react'],
            },
            include: ['index.ts'],
          },
          null,
          2,
        )}\n`,
      );

      const compilerManifestPath = requireCjs.resolve(
        '@typescript/native-preview/package.json',
      );
      const compilerManifest = JSON.parse(
        readFileSync(compilerManifestPath, 'utf8'),
      ) as { bin: { tsgo: string } };
      const compilerPath = path.resolve(
        path.dirname(compilerManifestPath),
        compilerManifest.bin.tsgo,
      );
      const result = spawnSync(
        compilerPath,
        ['--project', path.join(fixtureRoot, 'tsconfig.json')],
        {
          encoding: 'utf8',
        },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  test('dry-run pack includes product files and excludes tests and config', () => {
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
});
