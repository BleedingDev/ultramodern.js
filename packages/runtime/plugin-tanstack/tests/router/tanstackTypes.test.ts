import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const resolverDelays = new Map<string, number>();

rstest.mock('../../src/cli/tanstackTypes/shared', () => {
  const actual = rstest.requireActual(
    '../../src/cli/tanstackTypes/shared',
  ) as typeof import('../../src/cli/tanstackTypes/shared');

  return {
    ...actual,
    resolveFileNoExt: async (inputNoExtPath: string) => {
      const normalized = inputNoExtPath.replaceAll('\\', '/');
      const delay =
        [...resolverDelays.entries()].find(([suffix]) =>
          normalized.endsWith(suffix),
        )?.[1] ?? 0;

      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      return actual.resolveFileNoExt(inputNoExtPath);
    },
  };
});

import {
  collectCanonicalRoutesForEntry,
  generateTanstackRouterTypesSourceForEntry,
} from '../../src/cli/tanstackTypes';

const execFileAsync = promisify(execFile);
const routerGenOxlintConfigPath = path.join(
  __dirname,
  'fixtures',
  'router-gen.oxlint.json',
);
const oxlintCliPath = path.resolve(
  __dirname,
  '../../../../toolkit/code-tools/node_modules/oxlint/bin/oxlint',
);
const strictestTsconfigPath = path.resolve(
  __dirname,
  '../../node_modules/@tsconfig/strictest/tsconfig.json',
);

async function writeRuntimeTestPackage(projectDirectory: string) {
  const runtimePackageDirectory = path.join(
    projectDirectory,
    'node_modules',
    '@modern-js',
    'plugin-tanstack',
  );
  await mkdir(runtimePackageDirectory, { recursive: true });
  await writeFile(
    path.join(runtimePackageDirectory, 'package.json'),
    JSON.stringify({
      name: '@modern-js/plugin-tanstack',
      type: 'commonjs',
      exports: {
        './runtime': {
          types: './runtime.d.ts',
          default: './runtime.js',
        },
      },
    }),
  );
  await writeFile(
    path.join(runtimePackageDirectory, 'runtime.d.ts'),
    [
      'export type ModernRouterContext = { request?: Request; requestContext?: unknown };',
      'export type ModernRouteStaticData = { modernRouteId?: string; modernRouteAction?: unknown; modernRouteLoader?: unknown };',
      'export type RouteOptions = {',
      '  component?: unknown;',
      '  getParentRoute?: (...args: never[]) => unknown;',
      '  id?: string;',
      '  loader?: (...args: never[]) => unknown;',
      '  loaderDeps?: (...args: never[]) => unknown;',
      '  path?: string;',
      '  staticData?: ModernRouteStaticData;',
      '  validateSearch?: (...args: never[]) => unknown;',
      '};',
      'export type Route<TOptions extends RouteOptions = RouteOptions> = {',
      '  options: TOptions;',
      '  addChildren<const TChildren extends readonly unknown[]>(children: TChildren): Route<TOptions> & { children: TChildren };',
      '};',
      'export const runtimeState: { adapterCalls: Array<{ hasSplat: boolean; modernLoader: unknown }> };',
      'export function createMemoryHistory<TOptions>(options: TOptions): TOptions;',
      'export const modernTanstackRouterFastDefaults: { defaultPreload: "intent" };',
      'export function createRootRouteWithContext<TContext extends ModernRouterContext>(): <const TOptions extends RouteOptions>(options: TOptions) => Route<TOptions>;',
      'export function createRoute<const TOptions extends RouteOptions>(options: TOptions): Route<TOptions>;',
      'export function createRouter<const TOptions extends { context: ModernRouterContext; history: unknown; routeTree: unknown }>(options: TOptions): TOptions;',
      'export function createRouteStaticData<const TData extends ModernRouteStaticData>(data: TData): TData;',
      'export function modernLoaderToTanstack<TLoader extends (...args: never[]) => unknown>(options: { hasSplat: boolean }, modernLoader: TLoader): (context: unknown) => Promise<Awaited<ReturnType<TLoader>>>;',
    ].join('\n'),
  );
  await writeFile(
    path.join(runtimePackageDirectory, 'runtime.js'),
    [
      'const runtimeState = { adapterCalls: [] };',
      'const createRouteRecord = options => ({',
      '  options,',
      '  addChildren(children) {',
      '    this.children = children;',
      '    return this;',
      '  },',
      '});',
      'const createMemoryHistory = options => options;',
      'const modernTanstackRouterFastDefaults = { defaultPreload: "intent" };',
      'const createRootRouteWithContext = () => options => createRouteRecord(options);',
      'const createRoute = options => createRouteRecord(options);',
      'const createRouter = options => options;',
      'const createRouteStaticData = data => data;',
      'const modernLoaderToTanstack = (options, modernLoader) => {',
      '  runtimeState.adapterCalls.push({ ...options, modernLoader });',
      '  return async context => modernLoader(context);',
      '};',
      'module.exports = { createMemoryHistory, createRootRouteWithContext, createRoute, createRouter, createRouteStaticData, modernLoaderToTanstack, modernTanstackRouterFastDefaults, runtimeState };',
    ].join('\n'),
  );
}

async function compileAndRunGeneratedRouter(options: {
  projectDirectory: string;
  routerGenTs: string;
  runtimeCheck: string;
}) {
  const { projectDirectory, routerGenTs, runtimeCheck } = options;
  const generatedDirectory = path.join(
    projectDirectory,
    'src',
    'modern-tanstack',
    'index',
  );
  await mkdir(generatedDirectory, { recursive: true });
  await writeFile(path.join(generatedDirectory, 'router.gen.ts'), routerGenTs);
  await writeFile(
    path.join(projectDirectory, 'src', 'runtime-check.ts'),
    runtimeCheck,
  );
  await writeRuntimeTestPackage(projectDirectory);
  await writeFile(
    path.join(projectDirectory, 'package.json'),
    JSON.stringify({ private: true, type: 'commonjs' }),
  );
  await writeFile(
    path.join(projectDirectory, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: strictestTsconfigPath,
        compilerOptions: {
          lib: ['ESNext', 'DOM'],
          jsx: 'react-jsx',
          module: 'Node16',
          moduleResolution: 'Node16',
          outDir: 'dist',
          rootDir: 'src',
          target: 'ES2022',
          types: [],
          verbatimModuleSyntax: false,
        },
        include: ['src/**/*.ts', 'src/**/*.tsx'],
      },
      null,
      2,
    ),
  );

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
  await execFileAsync(
    process.execPath,
    [path.join(projectDirectory, 'dist', 'runtime-check.js')],
    { cwd: projectDirectory },
  );
}

async function writeComprehensiveRouterFixture(srcDirectory: string) {
  const files = new Map([
    [
      'routes/(app)/layout.tsx',
      'export default function AppLayout() { return null; }',
    ],
    [
      'routes/(app)/users/(userId)/page.tsx',
      'export default function UserPage() { return null; }',
    ],
    [
      'routes/(app)/users/(userId)/page.data.ts',
      [
        'export const loader = () => ({ userId: "42" });',
        'export const action = () => Response.json({ ok: true });',
      ].join('\n'),
    ],
    [
      'routes/(app)/docs/splat.tsx',
      'export default function DocsSplatPage() { return null; }',
    ],
    [
      'routes/search.contract.ts',
      [
        'export const validateSearch = (search: { tab?: string }) => ({ tab: search.tab ?? "overview" });',
        'export const loaderDeps = ({ search }: { search: { tab: string } }) => ({ tab: search.tab });',
      ].join('\n'),
    ],
  ]);

  for (const [relativePath, contents] of files) {
    const filePath = path.join(srcDirectory, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }
}

async function generateComprehensiveRouterGen(srcDirectory: string) {
  await writeComprehensiveRouterFixture(srcDirectory);

  const { routerGenTs } = await generateTanstackRouterTypesSourceForEntry({
    appContext: {
      srcDirectory,
      internalSrcAlias: '@/_',
    } as any,
    entryName: 'golden',
    routes: [
      {
        type: 'nested',
        id: 'layout',
        isRoot: true,
        children: [
          {
            type: 'nested',
            id: '(app)/layout',
            _component: '@/_/routes/(app)/layout',
            children: [
              {
                type: 'nested',
                id: '(app)/users/(userId)/page',
                path: 'users/:userId',
                _component: '@/_/routes/(app)/users/(userId)/page',
                data: '@/_/routes/(app)/users/(userId)/page.data',
                action: '@/_/routes/(app)/users/(userId)/page.data',
                validateSearch: '@/_/routes/search.contract',
                loaderDeps: '@/_/routes/search.contract',
              },
              {
                type: 'nested',
                id: '(app)/docs/splat/page',
                path: 'docs/*',
                _component: '@/_/routes/(app)/docs/splat',
              },
            ],
          },
        ],
      },
    ] as any,
  });

  return routerGenTs;
}

describe('tanstack router type generation', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    resolverDelays.clear();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test('strictly compiles and executes a loader-free conventional route tree', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const srcDirectory = path.join(tempDir, 'src');
    const files = new Map([
      [
        'routes/layout.tsx',
        'export default function Layout() { return null; }',
      ],
      ['routes/page.tsx', 'export default function Home() { return null; }'],
      [
        'routes/reviews/[scanId]/page.tsx',
        'export default function Review() { return null; }',
      ],
    ]);

    for (const [relativePath, contents] of files) {
      const filePath = path.join(srcDirectory, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    }

    const { routerGenTs } = await generateTanstackRouterTypesSourceForEntry({
      appContext: {
        srcDirectory,
        internalSrcAlias: '@/_',
      } as any,
      entryName: 'index',
      routes: [
        {
          type: 'nested',
          id: 'layout',
          isRoot: true,
          _component: '@/_/routes/layout',
          children: [
            {
              type: 'nested',
              id: 'page',
              index: true,
              _component: '@/_/routes/page',
            },
            {
              type: 'nested',
              id: 'reviews/(scanId)/page',
              path: 'reviews/:scanId',
              _component: '@/_/routes/reviews/[scanId]/page',
            },
          ],
        },
      ] as any,
    });

    await compileAndRunGeneratedRouter({
      projectDirectory: tempDir,
      routerGenTs,
      runtimeCheck: [
        "import { runtimeState } from '@modern-js/plugin-tanstack/runtime';",
        "import Layout from './routes/layout';",
        "import Home from './routes/page';",
        "import Review from './routes/reviews/[scanId]/page';",
        "import { rootRoute, routeTree, router } from './modern-tanstack/index/router.gen';",
        '',
        'if (runtimeState.adapterCalls.length !== 0) throw new Error("loader adapter registered without a loader");',
        'if (Object.keys(router.context).length !== 0) throw new Error("router context is not empty");',
        'if (rootRoute.options.component !== Layout) throw new Error("root component was not wired");',
        'const [homeRoute, reviewRoute] = routeTree.children;',
        'if (homeRoute.options.component !== Home) throw new Error("index component was not wired");',
        'if (reviewRoute.options.component !== Review) throw new Error("review component was not wired");',
        'if (reviewRoute.options.path !== "reviews/$scanId") throw new Error("route params were not translated");',
      ].join('\n'),
    });
  });

  test('executes generated loader and action wiring through route static data', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const srcDirectory = path.join(tempDir, 'src');
    const routeDir = path.join(srcDirectory, 'routes', 'mf');
    await mkdir(routeDir, { recursive: true });
    await writeFile(
      path.join(routeDir, 'page.data.ts'),
      [
        'export const loader = () => ({ count: 0 });',
        'export const action = () => Response.json({ count: 1 });',
      ].join('\n'),
    );

    const { routerGenTs } = await generateTanstackRouterTypesSourceForEntry({
      appContext: {
        srcDirectory,
        internalSrcAlias: '@/_',
      } as any,
      entryName: 'index',
      routes: [
        {
          type: 'nested',
          id: 'layout',
          isRoot: true,
          children: [
            {
              type: 'nested',
              id: 'mf/page',
              path: 'mf',
              data: '@/_/routes/mf/page.data',
              action: '@/_/routes/mf/page.data',
            },
          ],
        },
      ] as any,
    });

    await compileAndRunGeneratedRouter({
      projectDirectory: tempDir,
      routerGenTs,
      runtimeCheck: [
        "import { runtimeState } from '@modern-js/plugin-tanstack/runtime';",
        "import { action, loader } from './routes/mf/page.data';",
        "import { routeTree } from './modern-tanstack/index/router.gen';",
        '',
        'async function main() {',
        'const [mfRoute] = routeTree.children;',
        'if (runtimeState.adapterCalls.length !== 1) throw new Error("loader adapter was not registered exactly once");',
        'if (runtimeState.adapterCalls[0]?.modernLoader !== loader) throw new Error("wrong loader was adapted");',
        'const result = await mfRoute.options.loader({});',
        'if (result.count !== 0) throw new Error("adapted loader returned the wrong value");',
        'if (mfRoute.options.staticData.modernRouteLoader !== loader) throw new Error("loader static data was not wired");',
        'if (mfRoute.options.staticData.modernRouteAction !== action) throw new Error("action static data was not wired");',
        '}',
        'void main();',
      ].join('\n'),
    });
  });

  test('executes component sharing correctly when module resolution races', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const srcDirectory = path.join(tempDir, 'src');

    for (const componentFile of [
      'routes/slow-page.tsx',
      'routes/fast-page.tsx',
      'routes/shared-page.tsx',
    ]) {
      const componentPath = path.join(srcDirectory, componentFile);
      await mkdir(path.dirname(componentPath), { recursive: true });
      await writeFile(
        componentPath,
        'export default function Page() { return null; }',
      );
    }

    resolverDelays.set('/routes/slow-page', 25);
    const { routerGenTs } = await generateTanstackRouterTypesSourceForEntry({
      appContext: {
        srcDirectory,
        internalSrcAlias: '@/_',
      } as any,
      entryName: 'index',
      routes: [
        {
          type: 'nested',
          id: 'layout',
          isRoot: true,
          children: [
            {
              type: 'nested',
              id: 'slow/page',
              path: 'slow',
              _component: '@/_/routes/slow-page',
            },
            {
              type: 'nested',
              id: 'fast/page',
              path: 'fast',
              _component: '@/_/routes/fast-page',
            },
            {
              type: 'nested',
              id: 'shared-a/page',
              path: 'shared-a',
              _component: '@/_/routes/shared-page',
            },
            {
              type: 'nested',
              id: 'shared-b/page',
              path: 'shared-b',
              _component: '@/_/routes/shared-page',
            },
            {
              type: 'nested',
              id: 'data-only/page',
              path: 'data-only',
            },
          ],
        },
      ] as any,
    });

    await compileAndRunGeneratedRouter({
      projectDirectory: tempDir,
      routerGenTs,
      runtimeCheck: [
        "import SlowPage from './routes/slow-page';",
        "import FastPage from './routes/fast-page';",
        "import SharedPage from './routes/shared-page';",
        "import { routeTree } from './modern-tanstack/index/router.gen';",
        '',
        'const [slowRoute, fastRoute, sharedA, sharedB, dataOnly] = routeTree.children;',
        'if (slowRoute.options.component !== SlowPage) throw new Error("slow component was crossed during resolution");',
        'if (fastRoute.options.component !== FastPage) throw new Error("fast component was crossed during resolution");',
        'if (sharedA.options.component !== SharedPage || sharedB.options.component !== SharedPage) throw new Error("shared component identity was not preserved");',
        'if (Reflect.has(dataOnly.options, "component")) throw new Error("data-only route gained a component");',
      ].join('\n'),
    });
  });

  test('strictly compiles and executes nested loader and search contracts', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const srcDirectory = path.join(tempDir, 'src');
    const routerGenTs = await generateComprehensiveRouterGen(srcDirectory);

    await compileAndRunGeneratedRouter({
      projectDirectory: tempDir,
      routerGenTs,
      runtimeCheck: [
        "import { runtimeState } from '@modern-js/plugin-tanstack/runtime';",
        "import { action, loader } from './routes/(app)/users/(userId)/page.data';",
        "import { loaderDeps, validateSearch } from './routes/search.contract';",
        "import { routeTree } from './modern-tanstack/index/router.gen';",
        '',
        'async function main() {',
        'const [appRoute] = routeTree.children;',
        'const [userRoute, docsRoute] = appRoute.children;',
        'if (runtimeState.adapterCalls.length !== 1) throw new Error("nested loader was not adapted");',
        'if (userRoute.options.validateSearch !== validateSearch) throw new Error("search validator was not wired");',
        'if (userRoute.options.loaderDeps !== loaderDeps) throw new Error("loader dependencies were not wired");',
        'if (userRoute.options.staticData.modernRouteLoader !== loader) throw new Error("nested static loader was not wired");',
        'if (userRoute.options.staticData.modernRouteAction !== action) throw new Error("nested static action was not wired");',
        'const user = await userRoute.options.loader({});',
        'if (user.userId !== "42") throw new Error("nested loader result was lost");',
        'if (userRoute.options.path !== "users/$userId") throw new Error("required route param was not translated");',
        'if (docsRoute.options.path !== "docs/$") throw new Error("splat route was not translated");',
        'const search = userRoute.options.validateSearch({});',
        'if (search.tab !== "overview") throw new Error("search contract returned the wrong value");',
        '}',
        'void main();',
      ].join('\n'),
    });
  });

  test('passes the generated-artifact lint contract', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const srcDirectory = path.join(tempDir, 'src');
    const routerGenTs = await generateComprehensiveRouterGen(srcDirectory);
    const routerGenPath = path.join(
      srcDirectory,
      'modern-tanstack',
      'golden',
      'router.gen.ts',
    );

    await mkdir(path.dirname(routerGenPath), { recursive: true });
    await writeFile(routerGenPath, routerGenTs);

    const { stderr, stdout } = await execFileAsync(
      process.execPath,
      [
        oxlintCliPath,
        routerGenPath,
        '--config',
        routerGenOxlintConfigPath,
        '--no-ignore',
        '--report-unused-disable-directives-severity',
        'error',
        '--format',
        'unix',
      ],
      { cwd: tempDir },
    );

    expect(`${stdout}${stderr}`).toBe('');
  });

  test('executes localized aliases with typed children and correct parents', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const srcDirectory = path.join(tempDir, 'src');

    const { routerGenTs } = await generateTanstackRouterTypesSourceForEntry({
      appContext: {
        srcDirectory,
        internalSrcAlias: '@/_',
      } as any,
      entryName: 'index',
      routes: [
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
                  id: '(lang)/products/(slug)/page',
                  path: 'products/:slug',
                },
                {
                  type: 'nested',
                  id: '(lang)/products/(slug)/page__localised_produkty_slug',
                  path: 'produkty/:slug',
                },
                {
                  type: 'nested',
                  id: '(lang)/optional/(slug$)/page__localised_volitelne_slug',
                  path: 'volitelne/:slug?',
                },
              ],
            },
          ],
        },
      ] as any,
    });

    await compileAndRunGeneratedRouter({
      projectDirectory: tempDir,
      routerGenTs,
      runtimeCheck: [
        "import { routeTree } from './modern-tanstack/index/router.gen';",
        '',
        'const [localeRoute] = routeTree.children;',
        'const [productRoute, localizedProductRoute, optionalRoute] = localeRoute.children;',
        'if (localeRoute.options.path !== "$lang") throw new Error("locale param was not translated");',
        'if (productRoute.options.path !== "products/$slug") throw new Error("product param was not translated");',
        'if (localizedProductRoute.options.path !== "produkty/$slug") throw new Error("localized param was not translated");',
        'if (optionalRoute.options.path !== "volitelne/{-$slug}") throw new Error("optional param was not translated");',
        'for (const child of localeRoute.children) {',
        '  if (child.options.getParentRoute() !== localeRoute) throw new Error("localized child points at the wrong parent");',
        '}',
      ].join('\n'),
    });
  });
});

describe('collectCanonicalRoutesForEntry', () => {
  test('returns null for a route tree with no locale param and no canonical metadata', () => {
    const result = collectCanonicalRoutesForEntry([
      {
        type: 'nested',
        id: 'layout',
        isRoot: true,
        children: [
          {
            type: 'nested',
            id: 'about/page',
            path: 'about',
          },
          {
            type: 'nested',
            id: 'contact/page',
            path: 'contact',
          },
        ],
      },
    ] as any);

    expect(result).toBeNull();
  });

  test('ignores a leading :lang param when the locale-param heuristic is disabled (no plugin-i18n)', () => {
    const routes = [
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
    ] as any;

    // Without plugin-i18n, a hand-rolled `/:lang/` param must NOT trigger the
    // i18n surface (the emitted module augmentation would break typechecking).
    expect(
      collectCanonicalRoutesForEntry(routes, { localeParamHeuristic: false }),
    ).toBeNull();
    // With plugin-i18n installed the heuristic strips the locale prefix.
    expect(
      collectCanonicalRoutesForEntry(routes, { localeParamHeuristic: true }),
    ).toEqual({
      '/about': 'Record<string, never>',
    });
  });

  test('still honors modernCanonicalPath metadata when the heuristic is disabled', () => {
    const result = collectCanonicalRoutesForEntry(
      [
        {
          type: 'nested',
          id: 'layout',
          isRoot: true,
          children: [
            {
              type: 'nested',
              id: '(lang)/products/(slug)/page',
              path: 'products/:slug',
              modernCanonicalPath: '/products/:slug',
            },
          ],
        },
      ] as any,
      { localeParamHeuristic: false },
    );

    expect(result).not.toBeNull();
    expect(result!['/products/$slug']).toBe('{ "slug": string }');
  });

  test('strips leading :lang param and maps index under :lang to "/"', () => {
    const result = collectCanonicalRoutesForEntry([
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
                id: '(lang)/page',
                index: true,
              },
              {
                type: 'nested',
                id: '(lang)/about/page',
                path: 'about',
              },
            ],
          },
        ],
      },
    ] as any);

    expect(result).not.toBeNull();
    expect(result!['/']).toBe('Record<string, never>');
    expect(result!['/about']).toBe('Record<string, never>');
  });

  test('converts :slug to $slug with required params type', () => {
    const result = collectCanonicalRoutesForEntry([
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
                id: '(lang)/products/(slug)/page',
                path: 'products/:slug',
              },
            ],
          },
        ],
      },
    ] as any);

    expect(result).not.toBeNull();
    expect(result!['/products/$slug']).toBe('{ "slug": string }');
  });

  test('converts :slug? to optional {-$slug} with optional params type', () => {
    const result = collectCanonicalRoutesForEntry([
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
                id: '(lang)/optional/(slug$)/page',
                path: 'optional/:slug?',
              },
            ],
          },
        ],
      },
    ] as any);

    expect(result).not.toBeNull();
    expect(result!['/optional/{-$slug}']).toBe('{ "slug"?: string }');
  });

  test('converts * splat to $ with optional _splat param', () => {
    const result = collectCanonicalRoutesForEntry([
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
                id: '(lang)/files/page',
                path: 'files/*',
              },
            ],
          },
        ],
      },
    ] as any);

    expect(result).not.toBeNull();
    expect(result!['/files/$']).toBe("{ '_splat'?: string }");
  });

  test('collapses localized variants with shared modernCanonicalPath to one canonical key', () => {
    // This reuses the same fixture shape as the 'preserves typed child trees'
    // test but adds modernCanonicalPath fields as plugin-i18n now emits.
    const result = collectCanonicalRoutesForEntry([
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
                id: '(lang)/products/(slug)/page',
                path: 'products/:slug',
                modernCanonicalPath: '/products/:slug',
              },
              {
                type: 'nested',
                id: '(lang)/products/(slug)/page__localised_produkty_slug',
                path: 'produkty/:slug',
                modernCanonicalPath: '/products/:slug',
              },
              {
                type: 'nested',
                id: '(lang)/optional/(slug$)/page__localised_volitelne_slug',
                path: 'volitelne/:slug?',
                modernCanonicalPath: '/optional/:slug?',
              },
            ],
          },
        ],
      },
    ] as any);

    expect(result).not.toBeNull();
    // Two physical variants share the same canonical path — only one entry.
    const keys = Object.keys(result!);
    // /products/$slug and /optional/{-$slug} — exactly 2 keys with params
    expect(keys.filter(k => k.startsWith('/products'))).toHaveLength(1);
    expect(result!['/products/$slug']).toBe('{ "slug": string }');
    expect(result!['/optional/{-$slug}']).toBe('{ "slug"?: string }');
    // The Czech localized path must not appear as a separate key.
    expect('/produkty/$slug' in result!).toBe(false);
  });

  test('output is sorted alphabetically by canonical key', () => {
    const result = collectCanonicalRoutesForEntry([
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
                id: '(lang)/products/(slug)/page',
                path: 'products/:slug',
              },
              {
                type: 'nested',
                id: '(lang)/about/page',
                path: 'about',
              },
              {
                type: 'nested',
                id: '(lang)/page',
                index: true,
              },
            ],
          },
        ],
      },
    ] as any);

    expect(result).not.toBeNull();
    const keys = Object.keys(result!);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });
});
