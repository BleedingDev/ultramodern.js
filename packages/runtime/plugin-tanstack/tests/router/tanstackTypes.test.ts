import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateTanstackRouterTypesSourceForEntry } from '../../src/cli/tanstackTypes';

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
