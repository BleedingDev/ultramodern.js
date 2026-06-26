import type { ServerRoute } from '@modern-js/types';
import { useHonoContext } from '../../src/context';
import { dataHandler } from '../../src/plugins/render/dataHandler';
import type { Context, ServerManifest, UserConfig } from '../../src/types';

describe('dataHandler', () => {
  it('runs server loader bundles inside the request Hono context', async () => {
    const serverContext = {} as Context;
    const routeInfo = {
      urlPath: '/',
      entryName: 'main',
      entryPath: 'index.html',
      isSPA: true,
      isSSR: true,
    } as ServerRoute;
    const serverManifest = {
      loaderBundles: {
        main: {
          routes: [],
          handleRequest: async () => {
            expect(useHonoContext()).toBe(serverContext);

            return new Response('ok');
          },
        },
      },
    } as unknown as ServerManifest;

    const response = await dataHandler(
      new Request('http://localhost/?__loader=page'),
      {
        pwd: '',
        html: '',
        routeInfo,
        staticGenerate: false,
        config: {} as UserConfig,
        serverManifest,
        loaderContext: new Map(),
        serverContext,
        params: {},
        monitors: {},
        onError() {},
        onTiming() {},
        serverRoutes: [routeInfo],
      },
    );

    expect(await response?.text()).toBe('ok');
  });
});
