import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { generateTanstackRouterTypesSourceForEntry } from '../../src/cli/tanstackTypes';

const execFileAsync = promisify(execFile);

describe('tanstack router type generation', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
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
    expect(routerGenTs).toContain('modernRouteId?: string;');
    expect(routerGenTs).not.toContain(
      'return Object.keys(staticData).length > 0 ? staticData : undefined;',
    );
    expect(routerGenTs).toContain(
      "} from '@modern-js/plugin-tanstack/runtime';",
    );
    expect(routerGenTs).toContain('modernTanstackRouterFastDefaults,');
    expect(routerGenTs).toContain('...modernTanstackRouterFastDefaults,');
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
        '  export function createMemoryHistory(options: unknown): unknown;',
        '  export const modernTanstackRouterFastDefaults: Record<string, unknown>;',
        '  export function createRootRouteWithContext<TContext>(): <TOptions extends RouteOptions>(options: TOptions) => Route<TOptions>;',
        '  export function createRoute<TOptions extends RouteOptions>(options: TOptions): Route<TOptions>;',
        '  export function createRouter<TOptions extends Record<string, unknown>>(options: TOptions): TOptions;',
        '  export function notFound(): never;',
        '  export function redirect(options: unknown): never;',
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
      execFileAsync('tsgo', ['--noEmit', '-p', 'tsconfig.json'], {
        cwd: tempDir,
      }),
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
