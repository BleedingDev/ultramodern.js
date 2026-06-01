import React from 'react';
import { RenderLevel } from '../../../src/core/constants';
import { LoadableCollector } from '../../../src/core/server/string/loadable';

describe('LoadableCollector federated css', () => {
  it('appends deduped module federation css after local route css', async () => {
    const chunkSet = {
      renderLevel: RenderLevel.CLIENT_RENDER,
      ssrScripts: '',
      jsChunk: '',
      cssChunk: '',
    };

    const collector = new LoadableCollector({
      runtimeContext: {
        routerServerSnapshot: {
          matchedRouteIds: ['route-a'],
        },
      } as any,
      template:
        '<html><head><link href="https://remote.example.com/already.css" rel="stylesheet" /></head></html>',
      entryName: 'main',
      chunkSet,
      config: {},
      routeManifest: {
        routeAssets: {
          'route-a': {
            assets: ['/static/css/route-a.css'],
          },
        },
      },
      moduleFederationCssAssets: [
        'https://remote.example.com/expose.css',
        'https://remote.example.com/expose.css',
        'https://remote.example.com/already.css',
      ],
    });

    collector.collect(React.createElement('div'));
    await collector.effect();

    expect(chunkSet.cssChunk).toBe(
      '<link href="/static/css/route-a.css" rel="stylesheet" /><link href="https://remote.example.com/expose.css" rel="stylesheet" />',
    );
  });
});
