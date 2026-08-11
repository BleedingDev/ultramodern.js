import { CHUNK_CSS_PLACEHOLDER } from '../../../../src/core/server/constants';
import { buildShellBeforeTemplate } from '../../../../src/core/server/stream/beforeTemplate';
import { buildShellBeforeTemplate as buildWorkerShellBeforeTemplate } from '../../../../src/core/server/stream/beforeTemplate.worker';
import { applyRouterRuntimeState } from '../../../../src/router/runtime/lifecycle';

const withRouterSnapshot = (
  runtimeContext: Record<string, unknown>,
  serverSnapshot: Record<string, unknown>,
) => {
  applyRouterRuntimeState(runtimeContext as any, {
    framework: 'react-router',
    serverSnapshot,
  });
  return runtimeContext;
};

describe('buildShellBeforeTemplate', () => {
  it('should use shared matched route ids from the router snapshot for css injection', async () => {
    for (const buildTemplate of [
      buildShellBeforeTemplate,
      buildWorkerShellBeforeTemplate,
    ]) {
      const html = await buildTemplate(
        `<html><head>${CHUNK_CSS_PLACEHOLDER}</head><body></body></html>`,
        {
          entryName: 'main',
          runtimeContext: withRouterSnapshot(
            {
              routeManifest: {
                routeAssets: {
                  'route-a': {
                    referenceCssAssets: ['/assets/route-a.css'],
                  },
                },
              },
            },
            {
              matchedRouteIds: ['route-a'],
            },
          ) as any,
          config: {} as any,
        },
      );

      expect(html).toContain('/assets/route-a.css');
    }
  });

  it('should derive css route ids from generic match snapshots', async () => {
    const html = await buildShellBeforeTemplate(
      `<html><head>${CHUNK_CSS_PLACEHOLDER}</head><body></body></html>`,
      {
        entryName: 'main',
        runtimeContext: withRouterSnapshot(
          {
            routeManifest: {
              routeAssets: {
                'asset-route': {
                  referenceCssAssets: ['/assets/asset-route.css'],
                },
                legacy: {
                  referenceCssAssets: ['/assets/legacy.css'],
                },
              },
            },
          },
          {
            matches: [{ routeId: 'router-route', assetRouteId: 'asset-route' }],
          },
        ) as any,
        config: {} as any,
      },
    );

    expect(html).toContain('/assets/asset-route.css');
    expect(html).not.toContain('/assets/legacy.css');
  });

  it('should inject entry css when route matching context is unavailable', async () => {
    const html = await buildShellBeforeTemplate(
      `<html><head>${CHUNK_CSS_PLACEHOLDER}</head><body></body></html>`,
      {
        entryName: 'index',
        runtimeContext: {
          routeManifest: {
            routeAssets: {
              'async-index': {
                referenceCssAssets: ['/assets/async-index.css'],
              },
            },
          },
        } as any,
        config: {} as any,
      },
    );

    expect(html).toContain('/assets/async-index.css');
  });

  it('should inject entry css in worker stream SSR when route matching context is unavailable', async () => {
    const html = await buildWorkerShellBeforeTemplate(
      `<html><head>${CHUNK_CSS_PLACEHOLDER}</head><body></body></html>`,
      {
        entryName: 'index',
        runtimeContext: {
          routeManifest: {
            routeAssets: {
              'async-index': {
                referenceCssAssets: ['/assets/async-index.css'],
              },
            },
          },
        } as any,
        config: {} as any,
      },
    );

    expect(html).toContain('/assets/async-index.css');
  });
});
