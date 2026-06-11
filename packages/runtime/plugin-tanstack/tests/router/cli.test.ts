import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergeConfig } from '@modern-js/plugin/cli';
import type { Entrypoint } from '@modern-js/types';
import { fs, NESTED_ROUTE_SPEC_FILE } from '@modern-js/utils';
import {
  createTanstackRsbuildRouteSplittingProfile,
  isTanstackStartRouteModuleSource,
  tanstackRouterPlugin,
  writeTanstackRegisterFile,
  writeTanstackRouterTypesForEntries,
} from '../../src/cli';

const runtimeCliMocks = {
  handleFileChange: rstest.fn(),
  handleGeneratorEntryCode: rstest.fn(),
};

rstest.mock('@modern-js/runtime/cli', () => {
  const routesDirMetaKey = '__modernRoutesDir';

  return {
    __esModule: true,
    getEntrypointRoutesDir: (entrypoint: any) =>
      entrypoint[routesDirMetaKey] ||
      (entrypoint.nestedRoutesEntry
        ? path.basename(entrypoint.nestedRoutesEntry)
        : null),
    handleFileChange: runtimeCliMocks.handleFileChange,
    handleGeneratorEntryCode: runtimeCliMocks.handleGeneratorEntryCode,
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

  test('writes plugin-owned router types and register metadata', async () => {
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
        dashboard: [],
        main: [],
      },
    });

    const mainRouter = await readFile(
      path.join(srcDirectory, 'generated-router', 'main', 'router.gen.ts'),
      'utf-8',
    );
    expect(mainRouter).toContain(
      "} from '@modern-js/plugin-tanstack/runtime';",
    );

    const register = await readFile(
      path.join(srcDirectory, 'generated-router', 'register.gen.d.ts'),
      'utf-8',
    );
    expect(register).toContain("from './main/router.gen'");
    expect(register.indexOf("from './main/router.gen'")).toBeLessThan(
      register.indexOf("from './dashboard/router.gen'"),
    );
    expect(register).toContain(
      "declare module '@modern-js/plugin-tanstack/runtime'",
    );
  });

  test('can write register metadata without routes for custom entry lists', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
    const srcDirectory = path.join(tempDir, 'src');

    await writeTanstackRegisterFile({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
    });

    const register = await readFile(
      path.join(srcDirectory, 'tanstack', 'register.gen.d.ts'),
      'utf-8',
    );
    expect(register).toContain('router: typeof router0');
    expect(register).toContain(
      "declare module '@modern-js/plugin-tanstack/runtime'",
    );
  });

  test('writes plugin-i18n module augmentation when canonicalRoutes are provided', async () => {
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

    const register = await readFile(
      path.join(srcDirectory, 'tanstack', 'register.gen.d.ts'),
      'utf-8',
    );

    expect(register).toContain(
      "declare module '@modern-js/plugin-i18n/runtime'",
    );
    expect(register).toContain('interface UltramodernCanonicalRoutes');
    expect(register).toContain("'/': Record<string, never>;");
    expect(register).toContain('\'/products/$slug\': { "slug": string };');
  });

  test('does not emit plugin-i18n augmentation when canonicalRoutes is absent (back-compat)', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-cli-'));
    const srcDirectory = path.join(tempDir, 'src');

    await writeTanstackRegisterFile({
      entries: ['main'],
      generatedDirName: 'tanstack',
      srcDirectory,
      // No canonicalRoutes provided at all — plain TanStack app
    });

    const register = await readFile(
      path.join(srcDirectory, 'tanstack', 'register.gen.d.ts'),
      'utf-8',
    );

    expect(register).not.toContain('plugin-i18n');
    expect(register).not.toContain('UltramodernCanonicalRoutes');
    // But the standard TanStack runtime augmentation must still be present.
    expect(register).toContain(
      "declare module '@modern-js/plugin-tanstack/runtime'",
    );
  });

  test('uses a custom i18nRuntimeModule when specified', async () => {
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

    const register = await readFile(
      path.join(srcDirectory, 'tanstack', 'register.gen.d.ts'),
      'utf-8',
    );

    expect(register).toContain("declare module '@my-org/i18n/runtime'");
    expect(register).not.toContain(
      "declare module '@modern-js/plugin-i18n/runtime'",
    );
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
        generateCodeOptions: {
          enableTanstackTypes: false,
        },
      },
    );

    const routerGen = await readFile(
      path.join(srcDirectory, 'tanstack-generated', 'main', 'router.gen.ts'),
      'utf-8',
    );
    expect(routerGen).toContain("} from '@modern-js/plugin-tanstack/runtime';");
    expect(routerGen).toContain('modernRouteAction: action_0');

    const register = await readFile(
      path.join(srcDirectory, 'tanstack-generated', 'register.gen.d.ts'),
      'utf-8',
    );
    expect(register).toContain(
      "declare module '@modern-js/plugin-tanstack/runtime'",
    );
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

  test('documents why TanStack Start Rspack splitter is not registered for Modern routes', () => {
    const profile = createTanstackRsbuildRouteSplittingProfile({});

    expect(profile).toMatchObject({
      defaultConfig: {
        output: {
          splitRouteChunks: true,
        },
      },
      modernRouteChunks: {
        enabled: true,
        owner: 'modern',
      },
      builderChunkSplit: {
        owner: 'modern-rsbuild',
        preserved: true,
      },
      tanstackStartRspackSplitter: {
        compatible: false,
        clientDeleteNodes: ['ssr', 'server', 'headers'],
      },
    });
    expect(
      isTanstackStartRouteModuleSource(
        "export const Route = createFileRoute('/dashboard')({ component })",
      ),
    ).toBe(true);
    expect(
      isTanstackStartRouteModuleSource(
        'export const route = createRoute({ getParentRoute, path })',
      ),
    ).toBe(false);
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
