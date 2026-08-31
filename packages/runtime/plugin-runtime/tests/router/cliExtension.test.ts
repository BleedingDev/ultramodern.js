import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Entrypoint } from '@modern-js/types';
import { fs, NESTED_ROUTE_SPEC_FILE } from '@modern-js/utils';
import { routerPlugin } from '../../src/router/cli';
import {
  getEntrypointRoutesDir,
  getEntrypointRoutesOwner,
  isRouteEntry,
} from '../../src/router/cli/entry';
import {
  handleFileChange,
  handleGeneratorEntryCode,
  handleModifyEntrypoints,
} from '../../src/router/cli/handler';
import { updateNestedRoutesSpec } from '../../src/router/cli/nestedRoutesSpec';

const createConfig = () =>
  ({
    output: {},
    server: {
      ssr: false,
      ssrByEntries: {},
      ssrByRouteIds: [],
      rsc: false,
    },
  }) as any;

const createApi = (appContext: any, hooks?: any) =>
  ({
    getAppContext: () => appContext,
    updateAppContext: (update: any) => {
      Object.assign(appContext, update);
    },
    getNormalizedConfig: createConfig,
    getHooks: () =>
      hooks || {
        modifyFileSystemRoutes: {
          call: async (params: any) => params,
        },
        onBeforeGenerateRoutes: {
          call: async (params: any) => params,
        },
      },
  }) as any;

describe('router cli extension points', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test('tracks plugin-owned route directory metadata', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-router-cli-'));
    const entryDir = path.join(tempDir, 'src', 'main');
    const viewsDir = path.join(entryDir, 'views');
    await mkdir(viewsDir, { recursive: true });

    const [entrypoint] = await handleModifyEntrypoints(
      [
        {
          entryName: 'main',
          isMainEntry: true,
          entry: entryDir,
          absoluteEntryDir: entryDir,
          isAutoMount: true,
        } as Entrypoint,
      ],
      'views',
    );

    expect(entrypoint.nestedRoutesEntry).toBe(viewsDir);
    expect(getEntrypointRoutesDir(entrypoint)).toBe('views');
    expect(isRouteEntry(entryDir, 'views')).toBe(viewsDir);
  });

  test('tracks plugin-owned route owner metadata for default routes directory', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-router-cli-'));
    const appDirectory = tempDir;
    const srcDirectory = path.join(tempDir, 'src');
    const distDirectory = path.join(tempDir, 'dist');
    const entryDir = path.join(srcDirectory, 'main');
    const routesDir = path.join(entryDir, 'routes');
    await mkdir(routesDir, { recursive: true });

    const [entrypoint] = await handleModifyEntrypoints(
      [
        {
          entryName: 'main',
          isMainEntry: true,
          entry: entryDir,
          absoluteEntryDir: entryDir,
          isAutoMount: true,
        } as Entrypoint,
      ],
      'routes',
      { routesOwner: '@modern-js/plugin-fake-router' },
    );

    const taps: Record<string, any> = {};
    const api = {
      getAppContext: () => ({
        appDirectory,
        srcDirectory,
        distDirectory,
        metaName: 'modern-js',
        runtimeConfigFile: 'modern.runtime',
        serverRoutes: [{ entryName: 'main', urlPath: '/' }],
      }),
      getNormalizedConfig: () => ({ router: { custom: true } }),
      addCommand: () => {},
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
    routerPlugin().setup!(api as any);

    expect(entrypoint.nestedRoutesEntry).toBe(routesDir);
    expect(getEntrypointRoutesDir(entrypoint)).toBe('routes');
    expect(getEntrypointRoutesOwner(entrypoint)).toBe(
      '@modern-js/plugin-fake-router',
    );
    expect(
      taps.internalRuntimePlugins!({ entrypoint, plugins: [] }).plugins,
    ).toEqual([]);
  });

  test('generates routes for a non-TanStack plugin-owned entry and returns routes by entry', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-router-cli-'));
    const appDirectory = tempDir;
    const srcDirectory = path.join(tempDir, 'src');
    const internalDirectory = path.join(tempDir, 'node_modules', '.modern-js');
    const entryDir = path.join(srcDirectory, 'main');
    const viewsDir = path.join(entryDir, 'views');
    await mkdir(viewsDir, { recursive: true });
    await writeFile(
      path.join(viewsDir, 'layout.tsx'),
      'export default function Layout() { return null; }',
    );
    await writeFile(
      path.join(viewsDir, 'page.tsx'),
      'export default function Page() { return null; }',
    );

    const [entrypoint] = await handleModifyEntrypoints(
      [
        {
          entryName: 'main',
          isMainEntry: true,
          entry: entryDir,
          absoluteEntryDir: entryDir,
          isAutoMount: true,
        } as Entrypoint,
      ],
      'views',
    );

    const appContext = {
      appDirectory,
      srcDirectory,
      internalDirectory,
      internalSrcAlias: '@_modern_js_src',
      metaName: 'modern-js',
      packageName: 'test-app',
      serverRoutes: [{ entryName: 'main', urlPath: '/' }],
      entrypoints: [entrypoint],
    };

    const routesByEntry = await handleGeneratorEntryCode(
      createApi(appContext),
      [entrypoint],
      {
        entrypointsKey: '@modern-js/plugin-fake-router',
      },
    );

    expect(routesByEntry.main).toHaveLength(1);
    const [rootRoute] = routesByEntry.main;
    expect(rootRoute).toMatchObject({
      id: 'layout',
      children: [
        expect.objectContaining({
          id: 'page',
          _component: '@_modern_js_src/main/views/page',
        }),
      ],
    });
    await expect(
      fs.pathExists(path.join(internalDirectory, 'main', 'routes.js')),
    ).resolves.toBe(true);
    await expect(
      fs.pathExists(
        path.join(internalDirectory, 'main', 'runtime-global-context.js'),
      ),
    ).resolves.toBe(true);
    expect(
      await fs.pathExists(path.join(srcDirectory, 'modern-tanstack')),
    ).toBe(false);
  });

  test('regenerates only the scoped route entries for file changes', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-router-cli-'));
    const appDirectory = tempDir;
    const srcDirectory = path.join(tempDir, 'src');
    const pluginEntryDir = path.join(srcDirectory, 'main');
    const builtInEntryDir = path.join(srcDirectory, 'dashboard');
    await mkdir(path.join(pluginEntryDir, 'views'), { recursive: true });
    await mkdir(path.join(builtInEntryDir, 'routes'), { recursive: true });

    const [pluginEntry] = await handleModifyEntrypoints(
      [
        {
          entryName: 'main',
          isMainEntry: true,
          entry: pluginEntryDir,
          absoluteEntryDir: pluginEntryDir,
          isAutoMount: true,
        } as Entrypoint,
      ],
      'views',
    );
    const [builtInEntry] = await handleModifyEntrypoints([
      {
        entryName: 'dashboard',
        isMainEntry: false,
        entry: builtInEntryDir,
        absoluteEntryDir: builtInEntryDir,
        isAutoMount: true,
      } as Entrypoint,
    ]);

    const appContext = {
      appDirectory,
      srcDirectory,
      internalSrcAlias: '@_modern_js_src',
      metaName: 'modern-js',
      entrypoints: [pluginEntry, builtInEntry],
    };
    const api = createApi(appContext);
    const regeneratePlugin = rstest.fn(async (_params: any) => {});
    const regenerateBuiltIn = rstest.fn(async (_params: any) => {});
    const filename = path.relative(
      appDirectory,
      path.join(pluginEntryDir, 'views', 'page.tsx'),
    );

    await handleFileChange(
      api,
      { filename, eventType: 'add' },
      {
        entrypointsKey: 'fake-router-file-change',
        includeEntry: entrypoint =>
          getEntrypointRoutesDir(entrypoint) === 'views',
        regenerate: regeneratePlugin,
      },
    );
    await handleFileChange(
      api,
      { filename, eventType: 'add' },
      {
        entrypointsKey: 'built-in-router',
        includeEntry: entrypoint =>
          getEntrypointRoutesDir(entrypoint) === 'routes',
        regenerate: regenerateBuiltIn,
      },
    );

    expect(regeneratePlugin).toHaveBeenCalledTimes(1);
    const pluginRegenerateParams = regeneratePlugin.mock.calls[0]?.[0] as any;
    expect(pluginRegenerateParams.entrypoints).toHaveLength(1);
    expect(pluginRegenerateParams.entrypoints[0]).toMatchObject({
      entryName: pluginEntry.entryName,
      nestedRoutesEntry: pluginEntry.nestedRoutesEntry,
    });
    expect(regenerateBuiltIn).not.toHaveBeenCalled();
  });

  test('built-in router ignores plugin-owned routes and merges route spec json', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-router-cli-'));
    const appDirectory = tempDir;
    const srcDirectory = path.join(tempDir, 'src');
    const distDirectory = path.join(tempDir, 'dist');
    const pluginEntryDir = path.join(srcDirectory, 'main');
    const builtInEntryDir = path.join(srcDirectory, 'dashboard');
    await mkdir(path.join(pluginEntryDir, 'views'), { recursive: true });
    await mkdir(path.join(builtInEntryDir, 'routes'), { recursive: true });

    const [pluginEntry] = await handleModifyEntrypoints(
      [
        {
          entryName: 'main',
          isMainEntry: true,
          entry: pluginEntryDir,
          absoluteEntryDir: pluginEntryDir,
          isAutoMount: true,
        } as Entrypoint,
      ],
      'views',
    );
    const [builtInEntry] = await handleModifyEntrypoints([
      {
        entryName: 'dashboard',
        isMainEntry: false,
        entry: builtInEntryDir,
        absoluteEntryDir: builtInEntryDir,
        isAutoMount: true,
      } as Entrypoint,
    ]);

    const taps: Record<string, any> = {};
    const api = {
      getAppContext: () => ({
        appDirectory,
        srcDirectory,
        distDirectory,
        metaName: 'modern-js',
        runtimeConfigFile: 'modern.runtime',
        serverRoutes: [{ entryName: 'dashboard', urlPath: '/dashboard' }],
      }),
      getNormalizedConfig: () => ({ router: { custom: true } }),
      addCommand: () => {},
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
    routerPlugin().setup!(api as any);

    const routerConfig = taps.config!();
    expect(routerConfig.source.include).toHaveLength(2);
    expect(
      routerConfig.source.include.some(
        (item: unknown) =>
          item instanceof RegExp && item.test('/node_modules/react-router/'),
      ),
    ).toBe(true);
    expect(
      routerConfig.source.include.some(
        (item: unknown) =>
          item instanceof RegExp &&
          item.test('/node_modules/react-router-dom/'),
      ),
    ).toBe(false);

    expect(
      taps.internalRuntimePlugins!({ entrypoint: pluginEntry, plugins: [] })
        .plugins,
    ).toEqual([]);
    expect(
      taps.internalRuntimePlugins!({ entrypoint: builtInEntry, plugins: [] })
        .plugins,
    ).toEqual([
      {
        name: 'router',
        path: '@modern-js/runtime/router/internal',
        config: { serverBase: ['/dashboard'] },
      },
    ]);

    const specPath = path.join(distDirectory, NESTED_ROUTE_SPEC_FILE);
    await fs.outputJSON(specPath, {
      main: [{ id: 'plugin-owned-route' }],
    });

    taps.modifyFileSystemRoutes({
      entrypoint: pluginEntry,
      routes: [{ id: 'plugin-route', type: 'nested', origin: 'file-system' }],
    });
    taps.modifyFileSystemRoutes({
      entrypoint: builtInEntry,
      routes: [
        {
          id: 'dashboard-route',
          type: 'nested',
          origin: 'file-system',
        },
      ],
    });
    await taps.onBeforeGenerateRoutes({ entrypoint: builtInEntry, code: '' });

    expect(await fs.readJSON(specPath)).toEqual({
      main: [{ id: 'plugin-owned-route' }],
      dashboard: [
        {
          id: 'dashboard-route',
          type: 'nested',
          origin: 'file-system',
        },
      ],
    });
  });

  test('atomically conserves built-in and TanStack routes without filesystem locks', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-router-cli-'));
    const specPath = path.join(tempDir, 'dist', NESTED_ROUTE_SPEC_FILE);

    await fs.outputJSON(specPath, {
      existing: [{ id: 'keep-me' }],
    });
    const mkdir = rstest.spyOn(fs, 'mkdir');
    const rename = rstest.spyOn(fs, 'rename');

    await Promise.all([
      updateNestedRoutesSpec(specPath, {
        dashboard: [{ id: 'built-in-route' }],
      }),
      updateNestedRoutesSpec(specPath, {
        main: [{ id: 'tanstack-route' }],
      }),
    ]);

    expect(await fs.readJSON(specPath)).toEqual({
      existing: [{ id: 'keep-me' }],
      dashboard: [{ id: 'built-in-route' }],
      main: [{ id: 'tanstack-route' }],
    });
    expect(rename).toHaveBeenCalledTimes(2);
    expect(
      rename.mock.calls.map(([temporaryPath, publishedPath]) => ({
        temporaryDirectory: path.dirname(temporaryPath as string),
        publishedPath,
      })),
    ).toEqual([
      {
        temporaryDirectory: path.dirname(specPath),
        publishedPath: specPath,
      },
      {
        temporaryDirectory: path.dirname(specPath),
        publishedPath: specPath,
      },
    ]);
    expect(
      new Set(rename.mock.calls.map(([temporaryPath]) => temporaryPath)).size,
    ).toBe(2);
    expect(mkdir).not.toHaveBeenCalledWith(`${specPath}.lock`);
    expect(await fs.pathExists(`${specPath}.lock`)).toBe(false);
  });

  test('snapshots nested route updates before the async write queue runs', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-router-cli-'));
    const specPath = path.join(tempDir, 'dist', NESTED_ROUTE_SPEC_FILE);
    const nextRoutes: Record<string, unknown> = {
      main: [{ id: 'initial-route' }],
    };

    const update = updateNestedRoutesSpec(specPath, nextRoutes);

    (nextRoutes.main as Array<{ id: string }>).push({ id: 'late-route' });
    nextRoutes.late = [{ id: 'late-entry' }];

    await update;

    expect(await fs.readJSON(specPath)).toEqual({
      main: [{ id: 'initial-route' }],
    });
  });
});
