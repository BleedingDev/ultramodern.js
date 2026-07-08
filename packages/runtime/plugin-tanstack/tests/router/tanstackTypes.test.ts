import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isRedirect } from '@tanstack/react-router';

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
import { throwTanstackRedirect } from '../../src/runtime/loaderBridge';

const execFileAsync = promisify(execFile);
const routerGenGoldenPath = path.join(
  __dirname,
  'fixtures',
  'router-gen.golden.txt',
);

type RedirectLike = {
  options?: {
    href?: string;
    to?: string;
  };
};

function catchThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected function to throw');
}

function extractRouteGenerationOrder(source: string) {
  return source.split('\n').filter(line => {
    return (
      line.startsWith('import component_') ||
      line.startsWith('const route_') ||
      line.includes('component: component_') ||
      line.startsWith('export const routeTree')
    );
  });
}

async function writeGoldenRouterFixture(srcDirectory: string) {
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

async function generateGoldenRouterGen(srcDirectory: string) {
  await writeGoldenRouterFixture(srcDirectory);

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

  test('emits inline data actions into route static data', async () => {
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

    expect(routerGenTs).toContain(
      'import { loader as loader_0, action as action_0 } from "../../routes/mf/page.data";',
    );
    expect(routerGenTs).toContain('modernRouteLoader: loader_0');
    expect(routerGenTs).toContain('modernRouteAction: action_0');
    expect(routerGenTs).toContain(
      "} from '@modern-js/plugin-tanstack/runtime';",
    );
    expect(routerGenTs).toContain('modernTanstackRouterFastDefaults,');
    expect(routerGenTs).toContain('...modernTanstackRouterFastDefaults,');

    // The loader-bridge helpers are imported from the package runtime instead
    // of being inlined into every generated file (bugfixes ship via package
    // update, and the broken inline absolute-redirect handler is gone).
    expect(routerGenTs).toContain('createRouteStaticData,');
    expect(routerGenTs).toContain('modernLoaderToTanstack,');
    expect(routerGenTs).toContain('type ModernRouterContext,');
    expect(routerGenTs).not.toContain('function modernLoaderToTanstack');
    expect(routerGenTs).not.toContain('function createRouteStaticData');
    expect(routerGenTs).not.toContain('function throwTanstackRedirect');
    expect(routerGenTs).not.toContain('new URL(target)');
    expect(routerGenTs).not.toContain('redirect({ to: target })');

    const redirectError = catchThrown(() =>
      throwTanstackRedirect('https://example.com/absolute'),
    ) as RedirectLike;
    expect(isRedirect(redirectError)).toBe(true);
    expect(redirectError.options?.href).toBe('https://example.com/absolute');
    expect(redirectError.options?.to).toBeUndefined();
  });

  test('emits resolvable relative component imports for routes carrying _component', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const srcDirectory = path.join(tempDir, 'src');
    for (const componentFile of [
      'routes/layout.tsx',
      'routes/page.tsx',
      'routes/about/page.tsx',
    ]) {
      const componentPath = path.join(srcDirectory, componentFile);
      await mkdir(path.dirname(componentPath), { recursive: true });
      await writeFile(componentPath, 'export default () => null;');
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
              id: 'about/page',
              path: 'about',
              _component: '@/_/routes/about/page',
            },
            {
              // Shares the page component module: the import must be reused.
              type: 'nested',
              id: 'about-alias/page',
              path: 'about-alias',
              _component: '@/_/routes/about/page',
            },
            {
              // No _component: no component option may be emitted.
              type: 'nested',
              id: 'data-only/page',
              path: 'data-only',
            },
          ],
        },
      ] as any,
    });

    // Children are emitted first, the root route component import last.
    // Imports are relative (resolved like loader modules) — the raw
    // `@/_` internal alias is not mapped by app tsconfigs.
    expect(routerGenTs).toContain(
      'import component_0 from "../../routes/page";',
    );
    expect(routerGenTs).toContain(
      'import component_1 from "../../routes/about/page";',
    );
    expect(routerGenTs).toContain(
      'import component_2 from "../../routes/layout";',
    );
    expect(routerGenTs).not.toContain('@/_/routes');
    // The shared module is imported exactly once.
    expect(routerGenTs).not.toContain('component_3');
    expect(
      routerGenTs.match(/from "\.\.\/\.\.\/routes\/about\/page";/g),
    ).toHaveLength(1);

    expect(routerGenTs).toContain('component: component_0,');
    // The shared component import is referenced by both aliased routes.
    expect(routerGenTs.match(/component: component_1,/g)).toHaveLength(2);
    // The root route gets its component option.
    expect(routerGenTs).toContain('component: component_2,');

    const dataOnlyRoute = routerGenTs
      .split('const ')
      .find(block => block.includes('path: "data-only",'));
    expect(dataOnlyRoute).toBeDefined();
    expect(dataOnlyRoute).not.toContain('component:');
  });

  test('keeps generated source stable when route module resolution races', async () => {
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

    const routes = [
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
        ],
      },
    ] as any;

    const generateWithResolverDelays = async (
      delays: Record<string, number>,
    ) => {
      resolverDelays.clear();
      for (const [suffix, delay] of Object.entries(delays)) {
        resolverDelays.set(suffix, delay);
      }

      const { routerGenTs } = await generateTanstackRouterTypesSourceForEntry({
        appContext: {
          srcDirectory,
          internalSrcAlias: '@/_',
        } as any,
        entryName: 'index',
        routes,
      });

      return routerGenTs;
    };

    const sequentialOutput = await generateWithResolverDelays({});
    const racedOutput = await generateWithResolverDelays({
      '/routes/slow-page': 25,
    });

    expect(
      racedOutput.match(/from "\.\.\/\.\.\/routes\/shared-page";/g),
    ).toHaveLength(1);
    expect(extractRouteGenerationOrder(racedOutput)).toEqual(
      extractRouteGenerationOrder(sequentialOutput),
    );
    expect(racedOutput).toBe(sequentialOutput);
  });

  test('matches checked-in router.gen golden output', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const srcDirectory = path.join(tempDir, 'src');
    const routerGenTs = await generateGoldenRouterGen(srcDirectory);

    if (process.env.UPDATE_TANSTACK_ROUTER_GOLDEN === '1') {
      await mkdir(path.dirname(routerGenGoldenPath), { recursive: true });
      await writeFile(routerGenGoldenPath, routerGenTs);
    }

    await expect(readFile(routerGenGoldenPath, 'utf8')).resolves.toBe(
      routerGenTs,
    );
  });

  test('typechecks generated TanStack search contracts', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'modern-tanstack-types-'));
    const srcDirectory = path.join(tempDir, 'src');
    const routeDir = path.join(srcDirectory, 'routes');
    const generatedDir = path.join(srcDirectory, 'modern-tanstack', 'index');
    await mkdir(routeDir, { recursive: true });
    await mkdir(generatedDir, { recursive: true });
    await writeFile(
      path.join(routeDir, 'search.contract.ts'),
      [
        'export const validateSearch = (search: { q?: string }) => ({ q: search.q ?? "" });',
        'export const loaderDeps = ({ search }: { search: { q: string } }) => ({ q: search.q });',
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
          validateSearch: '@/_/routes/search.contract',
          loaderDeps: '@/_/routes/search.contract',
          children: [
            {
              type: 'nested',
              id: 'search/page',
              path: 'search',
              validateSearch: '@/_/routes/search.contract',
              loaderDeps: '@/_/routes/search.contract',
            },
          ],
        },
      ] as any,
    });

    await writeFile(path.join(generatedDir, 'router.gen.ts'), routerGenTs);
    await writeFile(
      path.join(srcDirectory, 'runtime-shim.d.ts'),
      [
        "declare module '@modern-js/plugin-tanstack/runtime' {",
        '  type RouteOptions = {',
        '    getParentRoute?: () => unknown;',
        '    id?: string;',
        '    loader?: unknown;',
        '    loaderDeps?: unknown;',
        '    path?: string;',
        '    staticData?: unknown;',
        '    validateSearch?: unknown;',
        '  };',
        '  type Route<TOptions extends RouteOptions> = {',
        '    options: TOptions;',
        '    addChildren<TChildren extends readonly unknown[]>(children: TChildren): Route<TOptions> & { children: TChildren };',
        '  };',
        '  export type ModernRouterContext = {',
        '    request?: Request;',
        '    requestContext?: unknown;',
        '  };',
        '  export function createMemoryHistory(options: unknown): unknown;',
        '  export const modernTanstackRouterFastDefaults: Record<string, unknown>;',
        '  export function createRootRouteWithContext<TContext>(): <TOptions extends RouteOptions>(options: TOptions) => Route<TOptions>;',
        '  export function createRoute<TOptions extends RouteOptions>(options: TOptions): Route<TOptions>;',
        '  export function createRouter<TOptions extends Record<string, unknown>>(options: TOptions): TOptions;',
        '  export function createRouteStaticData(opts: { modernRouteId?: string; modernRouteAction?: unknown; modernRouteLoader?: unknown }): Record<string, unknown>;',
        '  export function modernLoaderToTanstack<TLoader extends (args: never) => unknown>(opts: { hasSplat: boolean }, modernLoader: TLoader): (ctx: unknown) => Promise<Awaited<ReturnType<TLoader>>>;',
        '}',
      ].join('\n'),
    );
    await writeFile(
      path.join(srcDirectory, 'assert-search-contracts.ts'),
      [
        "import { rootRoute, routeTree } from './modern-tanstack/index/router.gen';",
        "import { loaderDeps, validateSearch } from './routes/search.contract';",
        '',
        'const rootValidateSearch: typeof validateSearch = rootRoute.options.validateSearch;',
        'const rootLoaderDeps: typeof loaderDeps = rootRoute.options.loaderDeps;',
        'const childValidateSearch: typeof validateSearch = routeTree.children[0].options.validateSearch;',
        'const childLoaderDeps: typeof loaderDeps = routeTree.children[0].options.loaderDeps;',
        '',
        "rootValidateSearch({ q: 'root' });",
        "rootLoaderDeps({ search: { q: 'root' } });",
        "childValidateSearch({ q: 'child' });",
        "childLoaderDeps({ search: { q: 'child' } });",
      ].join('\n'),
    );
    await writeFile(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            lib: ['ESNext', 'DOM'],
            module: 'Preserve',
            moduleResolution: 'Bundler',
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: 'ESNext',
            types: [],
          },
          include: ['src/**/*.ts', 'src/**/*.d.ts'],
        },
        null,
        2,
      ),
    );

    await expect(
      execFileAsync(
        process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo',
        ['--noEmit', '-p', 'tsconfig.json'],
        {
          cwd: tempDir,
          shell: process.platform === 'win32',
        },
      ),
    ).resolves.toBeDefined();
  });

  test('preserves typed child trees for localized nested route aliases', async () => {
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

    expect(routerGenTs).toContain(
      'const route__lang__layout__base = createRoute({',
    );
    expect(routerGenTs).toContain(
      'getParentRoute: () => route__lang__layout__base,',
    );
    expect(routerGenTs).toContain('path: "produkty/$slug",');
    expect(routerGenTs).toContain('path: "volitelne/{-$slug}",');
    expect(routerGenTs).toContain(
      'const route__lang__layout = route__lang__layout__base.addChildren([route__lang__products__slug__page, route__lang__products__slug__page__localised_produkty_slug, route__lang__optional__slug$__page__localised_volitelne_slug]);',
    );
    expect(routerGenTs).toContain(
      'export const routeTree = rootRoute.addChildren([route__lang__layout]);',
    );
    expect(routerGenTs).not.toContain('route__lang__layout.addChildren([');
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
