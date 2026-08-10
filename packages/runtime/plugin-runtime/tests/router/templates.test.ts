import { createRequire } from 'node:module';
import type { RouteLegacy } from '@modern-js/types/cli';
import * as utils from '@modern-js/utils' with { rstest: 'importActual' };
import { build } from 'esbuild';

import {
  fileSystemRoutes,
  routesForServer,
  ssrLoaderCombinedModule,
} from '../../src/router/cli/code/templates';

rstest.mock('@modern-js/utils', () => {
  const fs = {
    writeFile() {},
    writeJSON() {},
    ensureFile() {},
  };
  return {
    __esModule: true,
    ...utils,
    fs,
  };
});

const fixtureRequire = createRequire(import.meta.url);

async function executeGeneratedModule(code: string) {
  const result = await build({
    bundle: true,
    format: 'cjs',
    platform: 'node',
    stdin: {
      contents: code,
      resolveDir: '/',
      sourcefile: 'generated-router.mjs',
    },
    write: false,
    plugins: [
      {
        name: 'generated-router-runtime',
        setup(buildApi) {
          buildApi.onResolve({ filter: /.*/ }, args => {
            if (args.kind === 'entry-point') {
              return undefined;
            }
            return { namespace: 'fixture-module', path: args.path };
          });
          buildApi.onLoad(
            { filter: /.*/, namespace: 'fixture-module' },
            args => {
              if (args.path === 'react') {
                return {
                  contents:
                    'export const lazy = loader => ({ kind: "react-lazy", loader });',
                  loader: 'js',
                };
              }
              if (args.path === '@modern-js/runtime/loadable') {
                return {
                  contents: [
                    'export default function loadable(loader, options) { return { kind: "loadable", loader, options }; }',
                    'export const lazy = loader => ({ kind: "loadable-lazy", loader });',
                  ].join('\n'),
                  loader: 'js',
                };
              }
              if (args.path === '@modern-js/runtime/routerHelper') {
                return {
                  contents: [
                    'export const createShouldRevalidate = routeId => () => routeId;',
                    'export const handleRouteModule = routeModule => routeModule;',
                    'export const handleRouteModuleError = error => { throw error; };',
                    'export const resolveRouteComponent = routeModule => routeModule.default;',
                  ].join('\n'),
                  loader: 'js',
                };
              }
              if (args.path === './route-server-loaders.js') {
                return {
                  contents:
                    'export const routeServerLoader = () => "route-server";',
                  loader: 'js',
                };
              }
              if (args.path.includes('plugin-data-loader')) {
                return {
                  contents:
                    'export const runtimeLoader = () => "runtime-loader";',
                  loader: 'js',
                };
              }

              return {
                contents: [
                  `export const moduleId = ${JSON.stringify(args.path)};`,
                  'export const loader = () => ({ moduleId, kind: "loader-result" });',
                  'export const action = () => ({ moduleId, kind: "action-result" });',
                  'export default { moduleId };',
                ].join('\n'),
                loader: 'js',
              };
            },
          );
        },
      },
    ],
  });

  const output = result.outputFiles[0]?.text;
  if (!output) {
    throw new Error('generated router bundle was empty');
  }
  const moduleRecord: { exports: Record<string, any> } = { exports: {} };
  const evaluate = new Function('module', 'exports', 'require', output);
  evaluate(moduleRecord, moduleRecord.exports, fixtureRequire);
  return moduleRecord.exports;
}

describe('fileSystemRoutes', () => {
  test('executes a generated legacy route module', async () => {
    const routes: RouteLegacy[] = [
      {
        path: '/user',
        exact: true,
        component: '@/pages/user',
        _component: '@/pages/user',
      },
    ];

    const generatedModule = await executeGeneratedModule(
      await fileSystemRoutes({
        metaName: 'modern-js',
        routes,
        entryName: 'main',
        internalDirectory: '',
      }),
    );

    const [userRoute] = generatedModule.routes;
    expect(userRoute).toMatchObject({
      path: '/user',
      exact: true,
      _component: '@/pages/user',
      component: {
        kind: 'loadable',
      },
    });
    const userModule = await userRoute.component.loader();
    expect(userModule.default.moduleId).toBe('@/pages/user');
  });

  test('executes nested components, errors, loadings, and loaders', async () => {
    const routes = [
      {
        path: '/',
        _component: '@_modern_js_src/routes/layout.tsx',
        id: 'layout',
        type: 'nested' as const,
        children: [
          {
            path: 'user',
            error: '@_modern_js_src/routes/error.tsx',
            _component: '@_modern_js_src/routes/user/layout.tsx',
            loading: '@_modern_js_src/routes/loading.tsx',
            id: 'user/layout',
            type: 'nested' as const,
            loader: '@_modern_js_src/routes/layout.loader.ts',
            children: [
              {
                path: ':id',
                id: 'user/[id]/layout',
                type: 'nested' as const,
                children: [
                  {
                    _component: '@_modern_js_src/routes/user/[id]/page.tsx',
                    index: true,
                    id: 'user/[id]/page',
                    loader: '@_modern_js_src/routes/user/[id]/page.tsx',
                    type: 'nested' as const,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const generatedModule = await executeGeneratedModule(
      await fileSystemRoutes({
        metaName: 'modern-js',
        entryName: 'main',
        routes,
        internalDirectory: '',
      }),
    );

    const [rootRoute] = generatedModule.routes;
    const [userLayout] = rootRoute.children;
    const [userParamLayout] = userLayout.children;
    const [userPage] = userParamLayout.children;
    expect(userLayout).toMatchObject({
      id: 'user/layout',
      path: 'user',
      component: { kind: 'react-lazy' },
      error: { moduleId: '@_modern_js_src/routes/error.tsx' },
      loading: { moduleId: '@_modern_js_src/routes/loading.tsx' },
      loader: { moduleId: '@_modern_js_src/routes/layout.loader.ts' },
    });
    expect(userPage).toMatchObject({
      id: 'user/[id]/page',
      index: true,
      component: { kind: 'react-lazy' },
      loader: { moduleId: '@_modern_js_src/routes/user/[id]/page.tsx' },
    });
    expect(userPage.shouldRevalidate()).toBe('user/[id]/page');
    const loadedPage = await userPage.lazyImport();
    expect(loadedPage.default.moduleId).toBe(
      '@_modern_js_src/routes/user/[id]/page.tsx',
    );
  });

  test('executes synchronous route components for stream SSR when route chunks are disabled', async () => {
    const routes = [
      {
        path: '/',
        _component: '@_modern_js_src/routes/layout.tsx',
        id: 'layout',
        type: 'nested' as const,
        children: [
          {
            path: 'tractors',
            _component: '@_modern_js_src/routes/tractors/page.tsx',
            id: 'tractors/page',
            type: 'nested' as const,
          },
        ],
      },
    ];

    const generatedModule = await executeGeneratedModule(
      await fileSystemRoutes({
        metaName: 'modern-js',
        entryName: 'main',
        routes,
        internalDirectory: '',
        ssrMode: 'stream',
        splitRouteChunks: false,
      }),
    );

    const [rootRoute] = generatedModule.routes;
    const [tractorsRoute] = rootRoute.children;
    expect(tractorsRoute.component).toEqual({
      moduleId: '@_modern_js_src/routes/tractors/page.tsx',
    });
    expect(tractorsRoute.lazyImport).toBeNull();
  });

  test('loads string-SSR route components through the loadable contract', async () => {
    const routes = [
      {
        path: '/',
        _component: '@_modern_js_src/routes/layout.tsx',
        id: 'layout',
        type: 'nested' as const,
        children: [
          {
            path: 'about',
            _component: '@_modern_js_src/routes/about/page.tsx',
            id: 'about/page',
            type: 'nested' as const,
          },
        ],
      },
    ];

    const generatedModule = await executeGeneratedModule(
      await fileSystemRoutes({
        metaName: 'modern-js',
        entryName: 'main',
        routes,
        internalDirectory: '',
        ssrMode: 'string',
        splitRouteChunks: true,
      }),
    );

    const [rootRoute] = generatedModule.routes;
    const [aboutRoute] = rootRoute.children;
    expect(aboutRoute.component.kind).toBe('loadable');
    const aboutModule = await aboutRoute.component.loader();
    expect(
      aboutRoute.component.options.resolveComponent(aboutModule).moduleId,
    ).toBe('@_modern_js_src/routes/about/page.tsx');
  });
});

describe('routesForServer', () => {
  test('executes generated nested server loader bindings', async () => {
    const routesForServerLoaderMatches = [
      {
        path: '/',
        _component: '@_modern_js_src/routes/layout.tsx',
        id: 'layout',
        type: 'nested' as const,
        children: [
          {
            path: 'user',
            id: 'user/layout',
            type: 'nested' as const,
            loader: '@_modern_js_src/routes/layout.loader.ts',
            children: [
              {
                path: ':id',
                id: 'user/[id]/layout',
                type: 'nested' as const,
                children: [
                  {
                    id: 'user/[id]/page',
                    index: true,
                    loader: '@_modern_js_src/routes/user/[id]/page.loader.ts',
                    type: 'nested' as const,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const generatedModule = await executeGeneratedModule(
      routesForServer({ routesForServerLoaderMatches }),
    );
    const [rootRoute] = generatedModule.routes;
    const [userLayout] = rootRoute.children;
    const [userParamLayout] = userLayout.children;
    const [userPage] = userParamLayout.children;
    expect(userLayout.loader).toEqual({
      moduleId: '@_modern_js_src/routes/layout.loader.ts',
    });
    expect(userPage.loader).toEqual({
      moduleId: '@_modern_js_src/routes/user/[id]/page.loader.ts',
    });
  });
});

describe('ssrLoaderCombinedModule', () => {
  const entrypoints = [
    {
      entryName: 'main',
      isMainEntry: true,
      nestedRoutesEntry: '/app/src/routes',
    },
  ];
  const entrypoint = entrypoints[0];
  const appContext = {
    packageName: 'test-app',
    internalDirectory: '/tmp/modern-app/.modern-js',
  };

  test('executes synchronous runtime and route-server loader exports', async () => {
    const code = ssrLoaderCombinedModule(
      entrypoints as any,
      entrypoint as any,
      {
        server: { ssr: true, ssrByEntries: {} },
        output: {},
        source: { enableAsyncEntry: false },
      } as any,
      appContext as any,
    );
    if (!code) {
      throw new Error('expected an SSR loader module');
    }

    const generatedModule = await executeGeneratedModule(code);
    expect(generatedModule.runtimeLoader()).toBe('runtime-loader');
    expect(generatedModule.routeServerLoader()).toBe('route-server');
  });

  test('loads asynchronous runtime and route-server loader exports', async () => {
    const code = ssrLoaderCombinedModule(
      entrypoints as any,
      entrypoint as any,
      {
        server: { ssr: true, ssrByEntries: {} },
        output: {},
        source: { enableAsyncEntry: true },
      } as any,
      appContext as any,
    );
    if (!code) {
      throw new Error('expected an async SSR loader module');
    }

    const generatedModule = await executeGeneratedModule(code);
    const loadedModules = await generatedModule.loadModules();
    expect(loadedModules.runtimeLoader()).toBe('runtime-loader');
    expect(loadedModules.routeServerLoader()).toBe('route-server');
  });
});
