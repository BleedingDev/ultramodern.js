import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { mergeConfig } from '@modern-js/plugin/cli';
import type { Entrypoint } from '@modern-js/types';
import { fs, NESTED_ROUTE_SPEC_FILE } from '@modern-js/utils';
import {
  createTanstackRsbuildRouteSplittingProfile,
  generateTanstackRouteArtifacts,
  tanstackRouterPlugin,
  writeTanstackRegisterFile,
  writeTanstackRouterTypesForEntries,
} from '../../src/cli';

const execFileAsync = promisify(execFile);
const strictestTsconfigPath = path.resolve(
  __dirname,
  '../../node_modules/@tsconfig/strictest/tsconfig.json',
);

async function typecheckGeneratedRegistration(options: {
  entries: string[];
  generatedDirName: string;
  srcDirectory: string;
  runtimeModule?: string;
  i18nRuntimeModule?: string;
  canonicalTypeChecks?: string[];
}) {
  const {
    entries,
    generatedDirName,
    srcDirectory,
    runtimeModule = '@modern-js/plugin-tanstack/runtime',
    i18nRuntimeModule,
    canonicalTypeChecks = [],
  } = options;
  const projectDirectory = path.dirname(srcDirectory);

  for (const entry of entries) {
    const routerPath = path.join(
      srcDirectory,
      generatedDirName,
      entry,
      'router.gen.ts',
    );
    if (!(await fs.pathExists(routerPath))) {
      await fs.outputFile(routerPath, 'export const router = { context: {} };');
    }
  }

  const runtimeDeclaration = [
    `declare module '${runtimeModule}' {`,
    '  export interface Register {}',
    '  export type ModernRouterContext = { request?: Request; requestContext?: unknown };',
    '  type RouteOptions = { getParentRoute?: (...args: never[]) => unknown; id?: string; loader?: (...args: never[]) => unknown; path?: string; staticData?: unknown };',
    '  type Route<TOptions extends RouteOptions = RouteOptions> = { options: TOptions; addChildren<const TChildren extends readonly unknown[]>(children: TChildren): Route<TOptions> & { children: TChildren } };',
    '  export function createMemoryHistory<TOptions>(options: TOptions): TOptions;',
    '  export function createRootRouteWithContext<TContext extends ModernRouterContext>(): <const TOptions extends RouteOptions>(options: TOptions) => Route<TOptions>;',
    '  export function createRoute<const TOptions extends RouteOptions>(options: TOptions): Route<TOptions>;',
    '  export function createRouter<const TOptions extends { context: ModernRouterContext; routeTree: unknown }>(options: TOptions): TOptions;',
    '  export function createRouteStaticData<const TData extends Record<string, unknown>>(data: TData): TData;',
    '  export function modernLoaderToTanstack<TLoader extends (...args: never[]) => unknown>(options: { hasSplat: boolean }, loader: TLoader): (context: unknown) => Promise<Awaited<ReturnType<TLoader>>>;',
    '  export const modernTanstackRouterFastDefaults: Record<string, unknown>;',
    '}',
  ];
  if (i18nRuntimeModule) {
    runtimeDeclaration.push(
      `declare module '${i18nRuntimeModule}' { export interface UltramodernCanonicalRoutes {} }`,
    );
  }
  await fs.outputFile(
    path.join(srcDirectory, 'generated-runtime-shim.d.ts'),
    runtimeDeclaration.join('\n'),
  );

  const contractLines = [
    `import type { Register } from '${runtimeModule}';`,
    ...entries.map(
      (entry, index) =>
        `import { router as router${index} } from './${generatedDirName}/${entry}/router.gen';`,
    ),
    ...entries.map(
      (_, index) =>
        `const registeredRouter${index}: Register['router'] = router${index};`,
    ),
    ...entries.map((_, index) => `void registeredRouter${index};`),
    ...canonicalTypeChecks,
  ];
  await fs.outputFile(
    path.join(srcDirectory, 'registration-contract.ts'),
    contractLines.join('\n'),
  );
  await fs.outputJSON(path.join(projectDirectory, 'tsconfig.json'), {
    extends: strictestTsconfigPath,
    compilerOptions: {
      lib: ['ESNext', 'DOM'],
      module: 'Preserve',
      moduleResolution: 'Bundler',
      noEmit: true,
      target: 'ESNext',
      types: [],
    },
    include: ['src/**/*.ts', 'src/**/*.d.ts'],
  });

  try {
    await execFileAsync(
      process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo',
      ['-p', 'tsconfig.json'],
      {
        cwd: projectDirectory,
        shell: process.platform === 'win32',
      },
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'stdout' in error &&
      typeof error.stdout === 'string'
    ) {
      throw new Error(error.stdout, { cause: error });
    }
    throw error;
  }
}

const runtimeCliMocks = {
  handleFileChange: rstest.fn(),
  handleGeneratorEntryCode: rstest.fn(),
};

rstest.mock('@modern-js/runtime/cli', () => {
  const routesDirMetaKey = '__modernRoutesDir';
  // The codegen helpers are pure — forward to the real implementations.
  const actualCli = rstest.requireActual('@modern-js/runtime/cli') as {
    getPathWithoutExt: (filename: string) => string;
    makeLegalIdentifier: (value: string) => string;
  };

  return {
    __esModule: true,
    getPathWithoutExt: actualCli.getPathWithoutExt,
    makeLegalIdentifier: actualCli.makeLegalIdentifier,
    getEntrypointRoutesDir: (entrypoint: any) =>
      entrypoint[routesDirMetaKey] ||
      (entrypoint.nestedRoutesEntry
        ? path.basename(entrypoint.nestedRoutesEntry)
        : null),
    getEntrypointRoutesOwner: (entrypoint: any) =>
      entrypoint.__modernRoutesOwner || null,
    // Forward through arrows: the mock factory is hoisted above the
    // `runtimeCliMocks` initializer, so it must not dereference it eagerly.
    handleFileChange: (...args: unknown[]) =>
      runtimeCliMocks.handleFileChange(...args),
    handleGeneratorEntryCode: (...args: unknown[]) =>
      runtimeCliMocks.handleGeneratorEntryCode(...args),
    handleModifyEntrypoints: async (
      entrypoints: Entrypoint[],
      routesDir = 'routes',
    ) =>
      entrypoints.map(entrypoint => {
        const routesEntry = path.join(entrypoint.absoluteEntryDir!, routesDir);
        return {
          ...entrypoint,
          nestedRoutesEntry: routesEntry,
          [routesDirMetaKey]: routesDir,
        };
      }),
    isRouteEntry: (dir: string, routesDir = 'routes') => {
      const routesEntry = path.join(dir, routesDir);
      return fs.existsSync(routesEntry) ? routesEntry : false;
    },
    updateNestedRoutesSpec: async (
      specPath: string,
      nextRoutes: Record<string, unknown>,
    ) => {
      const existingRoutes = fs.existsSync(specPath)
        ? await fs.readJSON(specPath)
        : {};
      await fs.outputJSON(specPath, {
        ...existingRoutes,
        ...nextRoutes,
      });
    },
  };
});

describe('tanstack router cli plugin', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    runtimeCliMocks.handleFileChange.mockReset();
    runtimeCliMocks.handleGeneratorEntryCode.mockReset();

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test('typechecks plugin-owned routers and register metadata under strictest', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
    const srcDirectory = path.join(tempDir, 'src');
    await mkdir(srcDirectory, { recursive: true });

    await writeTanstackRouterTypesForEntries({
      appContext: {
        srcDirectory,
        internalSrcAlias: '@/_',
        entrypoints: [
          { entryName: 'dashboard', isMainEntry: false },
          { entryName: 'main', isMainEntry: true },
        ],
      } as any,
      generatedDirName: 'generated-router',
      routesByEntry: {
        dashboard: [
          {
            type: 'nested',
            id: 'layout',
            isRoot: true,
            children: [{ type: 'nested', id: 'page', index: true }],
          },
        ],
        main: [
          {
            type: 'nested',
            id: 'layout',
            isRoot: true,
            children: [{ type: 'nested', id: 'page', index: true }],
          },
        ],
      },
    });

    await typecheckGeneratedRegistration({
      entries: ['main', 'dashboard'],
      generatedDirName: 'generated-router',
      srcDirectory,
    });
  });

  test('typechecks register metadata for custom entry lists without routes', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
    const srcDirectory = path.join(tempDir, 'src');

    await writeTanstackRegisterFile({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
    });

    await typecheckGeneratedRegistration({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
    });
  });

  test('exposes canonical route params through plugin-i18n types', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
    const srcDirectory = path.join(tempDir, 'src');

    await writeTanstackRegisterFile({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
      canonicalRoutes: {
        '/': 'Record<string, never>',
        '/products/$slug': '{ "slug": string }',
      },
    });

    await typecheckGeneratedRegistration({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
      i18nRuntimeModule: '@modern-js/plugin-i18n/runtime',
      canonicalTypeChecks: [
        "import type { UltramodernCanonicalRoutes } from '@modern-js/plugin-i18n/runtime';",
        "const rootParams: UltramodernCanonicalRoutes['/'] = {};",
        "const productParams: UltramodernCanonicalRoutes['/products/$slug'] = { slug: 'tractor' };",
        'void rootParams;',
        'void productParams;',
      ],
    });
  });

  test('typechecks a plain TanStack register without plugin-i18n installed', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
    const srcDirectory = path.join(tempDir, 'src');

    await writeTanstackRegisterFile({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
    });

    await typecheckGeneratedRegistration({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
    });
  });

  test('exposes canonical route params through a custom i18n runtime module', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
    const srcDirectory = path.join(tempDir, 'src');

    await writeTanstackRegisterFile({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
      canonicalRoutes: {
        '/talks': 'Record<string, never>',
      },
      i18nRuntimeModule: '@my-org/i18n/runtime',
    });

    await typecheckGeneratedRegistration({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
      i18nRuntimeModule: '@my-org/i18n/runtime',
      canonicalTypeChecks: [
        "import type { UltramodernCanonicalRoutes } from '@my-org/i18n/runtime';",
        "const talksParams: UltramodernCanonicalRoutes['/talks'] = {};",
        'void talksParams;',
      ],
    });
  });

  test('claims custom routes, injects runtime plugin, and merges route specs', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
    const srcDirectory = path.join(tempDir, 'src');
    const distDirectory = path.join(tempDir, 'dist');
    const entryDir = path.join(srcDirectory, 'main');
    const viewsDir = path.join(entryDir, 'views');
    await mkdir(viewsDir, { recursive: true });

    const taps: Record<string, any> = {};
    const api = {
      getAppContext: () => ({
        srcDirectory,
        distDirectory,
        metaName: 'modern-js',
        serverRoutes: [{ entryName: 'main', urlPath: '/dashboard' }],
      }),
      _internalRuntimePlugins: (tap: any) => {
        taps.internalRuntimePlugins = tap;
      },
      checkEntryPoint: (tap: any) => {
        taps.checkEntryPoint = tap;
      },
      config: (tap: any) => {
        taps.config = tap;
      },
      modifyEntrypoints: (tap: any) => {
        taps.modifyEntrypoints = tap;
      },
      generateEntryCode: (tap: any) => {
        taps.generateEntryCode = tap;
      },
      onFileChanged: (tap: any) => {
        taps.onFileChanged = tap;
      },
      modifyFileSystemRoutes: (tap: any) => {
        taps.modifyFileSystemRoutes = tap;
      },
      onBeforeGenerateRoutes: (tap: any) => {
        taps.onBeforeGenerateRoutes = tap;
      },
    };

    tanstackRouterPlugin({ routesDir: 'views' }).setup!(api as any);

    expect(taps.checkEntryPoint({ path: entryDir, entry: false })).toEqual({
      path: entryDir,
      entry: viewsDir,
    });

    const { entrypoints } = await taps.modifyEntrypoints({
      entrypoints: [
        {
          entryName: 'main',
          entry: entryDir,
          absoluteEntryDir: entryDir,
          isAutoMount: true,
          isMainEntry: true,
        } as Entrypoint,
      ],
    });
    const [entrypoint] = entrypoints;
    expect(entrypoint.nestedRoutesEntry).toBe(viewsDir);

    expect(
      taps.internalRuntimePlugins({ entrypoint, plugins: [] }).plugins,
    ).toEqual([
      {
        name: 'tanstackRouter',
        path: '@modern-js/plugin-tanstack/runtime',
        config: { serverBase: ['/dashboard'] },
      },
    ]);

    expect(taps.config()).toMatchObject({
      output: {
        splitRouteChunks: true,
      },
    });

    const specPath = path.join(distDirectory, NESTED_ROUTE_SPEC_FILE);
    await fs.outputJSON(specPath, {
      existing: [{ id: 'keep-me' }],
    });

    await taps.modifyFileSystemRoutes({
      entrypoint,
      routes: [
        {
          id: 'main-route',
          type: 'nested',
          origin: 'file-system',
        },
      ],
    });
    await taps.onBeforeGenerateRoutes({ entrypoint, code: '' });

    expect(await fs.readJSON(specPath)).toEqual({
      existing: [{ id: 'keep-me' }],
      main: [
        {
          id: 'main-route',
          type: 'nested',
          origin: 'file-system',
        },
      ],
    });
  });

  test('injects the framework-resolving router wrapper for non-file-route entrypoints', async () => {
    const taps: Record<string, any> = {};
    const api = {
      getAppContext: () => ({
        srcDirectory: '/tmp/app/src',
        metaName: 'modern-js',
        serverRoutes: [{ entryName: 'custom', urlPath: '/' }],
      }),
      _internalRuntimePlugins: (tap: any) => {
        taps.internalRuntimePlugins = tap;
      },
      checkEntryPoint: () => {},
      config: () => {},
      modifyEntrypoints: () => {},
      generateEntryCode: () => {},
      onFileChanged: () => {},
      modifyFileSystemRoutes: () => {},
      onBeforeGenerateRoutes: () => {},
    };

    tanstackRouterPlugin().setup!(api as any);

    // Custom entry without a routes dir (e.g. `createRoutes` in
    // modern.runtime.ts): installing the plugin is the explicit opt-in, no
    // source sniffing — the wrapper plus the provider registration is
    // injected through the package's own runtime/router module.
    const customEntrypoint = {
      entryName: 'custom',
      isAutoMount: true,
    } as Entrypoint;
    expect(
      taps.internalRuntimePlugins({ entrypoint: customEntrypoint, plugins: [] })
        .plugins,
    ).toEqual([
      {
        name: 'router',
        path: '@modern-js/plugin-tanstack/runtime/router',
        config: { serverBase: ['/'] },
      },
    ]);

    // If the built-in router CLI already installed the internal router for
    // this custom entry (explicit `runtime.router` config), only the module
    // path is redirected so the TanStack provider registration is
    // value-imported with it.
    const existingRouterPlugin = {
      name: 'router',
      path: '@modern-js/runtime/router/internal',
      config: { serverBase: ['/'] },
    };
    const { plugins } = taps.internalRuntimePlugins({
      entrypoint: customEntrypoint,
      plugins: [existingRouterPlugin],
    });
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toEqual({
      name: 'router',
      path: '@modern-js/plugin-tanstack/runtime/router',
      config: { serverBase: ['/'] },
    });
  });

  test('leaves built-in and foreign-owned route entrypoints to their own router', () => {
    const taps: Record<string, any> = {};
    const api = {
      getAppContext: () => ({
        srcDirectory: '/tmp/app/src',
        metaName: 'modern-js',
        serverRoutes: [{ entryName: 'home', urlPath: '/' }],
      }),
      _internalRuntimePlugins: (tap: any) => {
        taps.internalRuntimePlugins = tap;
      },
      checkEntryPoint: () => {},
      config: () => {},
      modifyEntrypoints: () => {},
      generateEntryCode: () => {},
      onFileChanged: () => {},
      modifyFileSystemRoutes: () => {},
      onBeforeGenerateRoutes: () => {},
    };

    tanstackRouterPlugin({ routesDir: 'ts-routes' }).setup!(api as any);

    // A classic react-router file-route entry (src/<entry>/routes) living
    // next to the TanStack entries: its internal router plugin must be left
    // untouched — redirecting it through the TanStack wrapper would pull
    // @tanstack/react-router into a pure react-router bundle.
    const builtInEntrypoint = {
      entryName: 'home',
      isAutoMount: true,
      nestedRoutesEntry: '/tmp/app/src/home/routes',
      __modernRoutesDir: 'routes',
    } as Entrypoint;
    const { plugins: builtInPlugins } = taps.internalRuntimePlugins({
      entrypoint: builtInEntrypoint,
      plugins: [
        {
          name: 'router',
          path: '@modern-js/runtime/router/internal',
          config: { serverBase: ['/'] },
        },
      ],
    });
    expect(builtInPlugins).toEqual([
      {
        name: 'router',
        path: '@modern-js/runtime/router/internal',
        config: { serverBase: ['/'] },
      },
    ]);

    // An entry tagged by another routes-owner plugin: nothing is pushed.
    // The replaced sniffing path in @modern-js/runtime excluded
    // plugin-owned entrypoints for the same reason — pushing a second
    // `router` plugin can install two routers for one entry.
    const foreignEntrypoint = {
      entryName: 'home',
      isAutoMount: true,
      nestedRoutesEntry: '/tmp/app/src/home/acme-routes',
      __modernRoutesDir: 'acme-routes',
      __modernRoutesOwner: '@acme/plugin-file-router',
    } as Entrypoint;
    expect(
      taps.internalRuntimePlugins({
        entrypoint: foreignEntrypoint,
        plugins: [],
      }).plugins,
    ).toEqual([]);

    // The built-in pages/ convention is foreign too.
    const pagesEntrypoint = {
      entryName: 'home',
      isAutoMount: true,
      pageRoutesEntry: '/tmp/app/src/home/pages',
    } as Entrypoint;
    expect(
      taps.internalRuntimePlugins({ entrypoint: pagesEntrypoint, plugins: [] })
        .plugins,
    ).toEqual([]);
  });

  test('source.include covers the package dist and TanStack runtime deps without string surgery', () => {
    const taps: Record<string, any> = {};
    const api = {
      getAppContext: () => ({
        srcDirectory: '/tmp/app/src',
        serverRoutes: [],
      }),
      _internalRuntimePlugins: () => {},
      checkEntryPoint: () => {},
      config: (tap: any) => {
        taps.config = tap;
      },
      modifyEntrypoints: () => {},
      generateEntryCode: () => {},
      onFileChanged: () => {},
      modifyFileSystemRoutes: () => {},
      onBeforeGenerateRoutes: () => {},
    };

    tanstackRouterPlugin().setup!(api as any);

    const include = taps.config().source.include as Array<RegExp | string>;
    const regexes = include.filter(
      (entry): entry is RegExp => entry instanceof RegExp,
    );
    for (const dep of ['react-router', 'router-core', 'react-store']) {
      const sample = `/repo/node_modules/@tanstack/${dep}/dist/esm/index.js`;
      expect(regexes.some(regex => regex.test(sample))).toBe(true);
    }

    const stringEntries = include.filter(
      (entry): entry is string => typeof entry === 'string',
    );
    expect(stringEntries).toHaveLength(1);
    // The include must point at the package root (two levels above the cli
    // build dir) so dist/esm, dist/esm-node and dist/cjs are all covered —
    // the old `.replace('cjs', 'esm')` never matched the bundled dist/esm
    // runtime when the CLI was loaded through the ESM condition.
    expect(stringEntries[0]).toBe(path.resolve(__dirname, '..', '..'));
    expect(stringEntries[0]).not.toContain('esm');
  });

  test('emits the plugin-i18n augmentation only when plugin-i18n is registered', async () => {
    const langRoutes = [
      {
        type: 'nested',
        id: 'layout',
        isRoot: true,
        children: [
          {
            type: 'nested',
            id: '(lang)/layout',
            path: ':lang',
            children: [
              {
                type: 'nested',
                id: '(lang)/about/page',
                path: 'about',
              },
            ],
          },
        ],
      },
    ];

    const runGenerate = async (registeredPlugins: Array<{ name: string }>) => {
      const dir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
      const srcDirectory = path.join(dir, 'src');
      const entrypoint = {
        entryName: 'main',
        isAutoMount: true,
        isMainEntry: true,
        nestedRoutesEntry: path.join(srcDirectory, 'routes'),
        __modernRoutesDir: 'routes',
      } as Entrypoint;
      runtimeCliMocks.handleGeneratorEntryCode.mockResolvedValueOnce({
        main: langRoutes,
      });

      const taps: Record<string, any> = {};
      const api = {
        getAppContext: () => ({
          srcDirectory,
          internalSrcAlias: '@/_',
          entrypoints: [entrypoint],
          plugins: registeredPlugins,
        }),
        _internalRuntimePlugins: () => {},
        checkEntryPoint: () => {},
        config: () => {},
        modifyEntrypoints: () => {},
        generateEntryCode: (tap: any) => {
          taps.generateEntryCode = tap;
        },
        onFileChanged: () => {},
        modifyFileSystemRoutes: () => {},
        onBeforeGenerateRoutes: () => {},
      };

      tanstackRouterPlugin().setup!(api as any);
      await taps.generateEntryCode({ entrypoints: [entrypoint] });

      const hasI18n = registeredPlugins.some(
        plugin => plugin.name === '@modern-js/plugin-i18n',
      );
      await typecheckGeneratedRegistration({
        entries: ['main'],
        generatedDirName: 'modern-tanstack',
        srcDirectory,
        ...(hasI18n && {
          i18nRuntimeModule: '@modern-js/plugin-i18n/runtime',
        }),
        canonicalTypeChecks: hasI18n
          ? [
              "import type { UltramodernCanonicalRoutes } from '@modern-js/plugin-i18n/runtime';",
              "const aboutParams: UltramodernCanonicalRoutes['/about'] = {};",
              'void aboutParams;',
            ]
          : [],
      });
      await rm(dir, { recursive: true, force: true });
    };

    // A hand-rolled `/:lang/` app WITHOUT plugin-i18n must not get the
    // augmentation — it would reference an unresolvable module (TS2664).
    await runGenerate([{ name: '@modern-js/app-tools' }]);

    // With plugin-i18n registered the canonical route map is emitted.
    await runGenerate([
      { name: '@modern-js/app-tools' },
      { name: '@modern-js/plugin-i18n' },
    ]);
  });

  test('generates plugin-owned TanStack route files through core route generation', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
    const srcDirectory = path.join(tempDir, 'src');
    const entryDir = path.join(srcDirectory, 'main');
    const viewsDir = path.join(entryDir, 'views');
    await mkdir(path.join(viewsDir, 'mf'), { recursive: true });
    await fs.outputFile(
      path.join(viewsDir, 'mf', 'page.data.ts'),
      [
        'export const loader = () => ({ count: 0 });',
        'export const action = () => Response.json({ count: 1 });',
      ].join('\n'),
    );

    const entrypoint = {
      entryName: 'main',
      entry: entryDir,
      absoluteEntryDir: entryDir,
      isAutoMount: true,
      isMainEntry: true,
      nestedRoutesEntry: viewsDir,
      __modernRoutesDir: 'views',
    } as Entrypoint;
    runtimeCliMocks.handleGeneratorEntryCode.mockResolvedValue({
      main: [
        {
          type: 'nested',
          id: 'layout',
          isRoot: true,
          children: [
            {
              type: 'nested',
              id: 'mf/page',
              path: 'mf',
              data: '@/_/main/views/mf/page.data',
              action: '@/_/main/views/mf/page.data',
            },
          ],
        },
      ],
    });

    const taps: Record<string, any> = {};
    const api = {
      getAppContext: () => ({
        srcDirectory,
        internalSrcAlias: '@/_',
        entrypoints: [entrypoint],
      }),
      _internalRuntimePlugins: () => {},
      checkEntryPoint: (tap: any) => {
        taps.checkEntryPoint = tap;
      },
      config: (tap: any) => {
        taps.config = tap;
      },
      modifyEntrypoints: (tap: any) => {
        taps.modifyEntrypoints = tap;
      },
      generateEntryCode: (tap: any) => {
        taps.generateEntryCode = tap;
      },
      onFileChanged: (tap: any) => {
        taps.onFileChanged = tap;
      },
      modifyFileSystemRoutes: (tap: any) => {
        taps.modifyFileSystemRoutes = tap;
      },
      onBeforeGenerateRoutes: (tap: any) => {
        taps.onBeforeGenerateRoutes = tap;
      },
    };

    tanstackRouterPlugin({
      generatedDirName: 'tanstack-generated',
      routesDir: 'views',
    }).setup!(api as any);

    await taps.generateEntryCode({ entrypoints: [entrypoint] });

    expect(runtimeCliMocks.handleGeneratorEntryCode).toHaveBeenCalledWith(
      api,
      [entrypoint],
      {
        entrypointsKey: '@modern-js/plugin-tanstack',
        hydrateRscClientRoutes: true,
        serverRoutesFileName: 'tanstack-routes.server.js',
      },
    );

    await typecheckGeneratedRegistration({
      entries: ['main'],
      generatedDirName: 'tanstack-generated',
      srcDirectory,
    });
  });

  test('regenerates plugin-owned TanStack files for scoped file changes', async () => {
    const regenerateEvent = {
      eventType: 'add',
      filename: 'src/main/views/page.tsx',
    };
    const entrypoint = {
      entryName: 'main',
      __modernRoutesDir: 'views',
    } as any as Entrypoint;
    const api = {
      getAppContext: () => ({
        srcDirectory: '/tmp/app/src',
        internalSrcAlias: '@/_',
        entrypoints: [entrypoint],
      }),
      _internalRuntimePlugins: () => {},
      checkEntryPoint: () => {},
      config: () => {},
      modifyEntrypoints: () => {},
      generateEntryCode: () => {},
      onFileChanged: (tap: any) => {
        api.onFileChangedTap = tap;
      },
      modifyFileSystemRoutes: () => {},
      onBeforeGenerateRoutes: () => {},
      onFileChangedTap: undefined as any,
    };

    tanstackRouterPlugin({ routesDir: 'views' }).setup!(api as any);

    runtimeCliMocks.handleFileChange.mockImplementationOnce(
      async (_api, _event, options) => {
        expect(options.entrypointsKey).toBe('@modern-js/plugin-tanstack');
        expect(options.includeEntry(entrypoint)).toBe(true);
        expect(
          options.includeEntry({
            ...entrypoint,
            __modernRoutesDir: 'routes',
          }),
        ).toBe(false);
        expect(typeof options.regenerate).toBe('function');
      },
    );

    await api.onFileChangedTap(regenerateEvent);

    expect(runtimeCliMocks.handleFileChange).toHaveBeenCalledWith(
      api,
      regenerateEvent,
      expect.objectContaining({
        entrypointsKey: '@modern-js/plugin-tanstack',
      }),
    );
  });

  test('can opt out of Modern-owned route code splitting', async () => {
    const taps: Record<string, any> = {};
    const api = {
      getAppContext: () => ({
        srcDirectory: '/tmp/app/src',
        serverRoutes: [],
      }),
      _internalRuntimePlugins: () => {},
      checkEntryPoint: () => {},
      config: (tap: any) => {
        taps.config = tap;
      },
      modifyEntrypoints: () => {},
      generateEntryCode: () => {},
      onFileChanged: () => {},
      modifyFileSystemRoutes: () => {},
      onBeforeGenerateRoutes: () => {},
    };

    tanstackRouterPlugin({ routeCodeSplitting: false }).setup!(api as any);

    expect(taps.config()).toMatchObject({
      output: {
        splitRouteChunks: false,
      },
    });
  });

  test('route splitting profile carries only the rsbuild config production consumes', () => {
    expect(createTanstackRsbuildRouteSplittingProfile({})).toEqual({
      defaultConfig: {
        output: {
          splitRouteChunks: true,
        },
      },
    });
    expect(
      createTanstackRsbuildRouteSplittingProfile({ routeCodeSplitting: false }),
    ).toEqual({
      defaultConfig: {
        output: {
          splitRouteChunks: false,
        },
      },
    });
  });

  test('preserves user-selected route and builder chunk splitting modes', () => {
    const pluginDefaults = createTanstackRsbuildRouteSplittingProfile(
      {},
    ).defaultConfig;
    const chunkSplits = [
      { strategy: 'split-by-module' },
      { strategy: 'split-by-experience' },
      { strategy: 'all-in-one' },
      { strategy: 'single-vendor' },
      { strategy: 'split-by-size', minSize: 10_000, maxSize: 60_000 },
      {
        strategy: 'custom',
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            tractors: {
              name: 'tractors',
              test: /tractors/u,
            },
          },
        },
      },
    ];

    for (const chunkSplit of chunkSplits) {
      expect(
        mergeConfig([
          pluginDefaults,
          {
            output: {
              splitRouteChunks: false,
            },
            performance: {
              chunkSplit,
            },
            splitChunks: false,
          },
        ]),
      ).toMatchObject({
        output: {
          splitRouteChunks: false,
        },
        performance: {
          chunkSplit,
        },
        splitChunks: false,
      });
    }

    const pageSplitWithManualAsyncChunks = mergeConfig([
      pluginDefaults,
      {
        performance: {
          chunkSplit: {
            strategy: 'custom',
            splitChunks: {
              chunks: 'async',
            },
          },
        },
      },
    ]);

    expect(pageSplitWithManualAsyncChunks).toMatchObject({
      output: {
        splitRouteChunks: true,
      },
      performance: {
        chunkSplit: {
          strategy: 'custom',
          splitChunks: {
            chunks: 'async',
          },
        },
      },
    });
  });

  test('keeps custom cache group details intact', () => {
    const pluginDefaults = createTanstackRsbuildRouteSplittingProfile(
      {},
    ).defaultConfig;

    const mergedConfig = mergeConfig([
      pluginDefaults,
      {
        performance: {
          chunkSplit: {
            strategy: 'custom',
            splitChunks: {
              chunks: 'all',
              cacheGroups: {
                tractors: {
                  name: 'tractors',
                  test: /tractors/u,
                },
              },
            },
          },
        },
      },
    ]);

    expect(
      (
        mergedConfig as {
          performance?: {
            chunkSplit?: {
              splitChunks?: {
                cacheGroups?: {
                  tractors?: {
                    test?: RegExp;
                  };
                };
              };
            };
          };
        }
      ).performance?.chunkSplit?.splitChunks?.cacheGroups?.tractors?.test,
    ).toEqual(/tractors/u);
    expect(mergedConfig).toMatchObject({
      output: {
        splitRouteChunks: true,
      },
      performance: {
        chunkSplit: {
          strategy: 'custom',
          splitChunks: {
            chunks: 'all',
            cacheGroups: {
              tractors: {
                name: 'tractors',
              },
            },
          },
        },
      },
    });
  });

  test('plugin opt-out can still combine with manual builder chunking', () => {
    const pluginDefaults = createTanstackRsbuildRouteSplittingProfile({
      routeCodeSplitting: false,
    }).defaultConfig;

    expect(
      mergeConfig([
        pluginDefaults,
        {
          performance: {
            chunkSplit: {
              strategy: 'single-vendor',
            },
          },
        },
      ]),
    ).toMatchObject({
      output: {
        splitRouteChunks: false,
      },
      performance: {
        chunkSplit: {
          strategy: 'single-vendor',
        },
      },
    });
  });
});

describe('generateTanstackRouteArtifacts export', () => {
  test('is exported as a function', () => {
    expect(typeof generateTanstackRouteArtifacts).toBe('function');
  });
});
