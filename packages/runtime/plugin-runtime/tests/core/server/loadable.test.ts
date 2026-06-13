import React from 'react';
import { RenderLevel } from '../../../src/core/constants';
import {
  LoadableCollector,
  orderHydrationScriptChunks,
} from '../../../src/core/server/string/loadable';
import { applyRouterRuntimeState } from '../../../src/router/runtime/lifecycle';

const createRuntimeContextWithMatchedRoutes = (matchedRouteIds: string[]) => {
  const runtimeContext = {} as any;
  applyRouterRuntimeState(runtimeContext, {
    framework: 'react-router',
    serverSnapshot: { matchedRouteIds },
  });
  return runtimeContext;
};

const chunk = (url: string, filename = url) => ({
  url,
  filename,
  path: url,
});

const scriptUrls = (chunks: Array<{ url?: string }>) =>
  chunks.map(item => item.url).filter(Boolean);

describe('LoadableCollector federated css', () => {
  it('appends deduped module federation css after local route css', async () => {
    const chunkSet = {
      renderLevel: RenderLevel.CLIENT_RENDER,
      ssrScripts: '',
      jsChunk: '',
      cssChunk: '',
    };

    const collector = new LoadableCollector({
      runtimeContext: createRuntimeContextWithMatchedRoutes(['route-a']),
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

  it('orders matched route scripts before the async entry script', () => {
    const ordered = orderHydrationScriptChunks({
      entryName: 'index',
      asyncEntryChunks: [
        chunk('/static/js/async/vendor.js'),
        chunk('/static/js/async/async-index-123.js'),
      ],
      collectedChunks: [chunk('/static/js/async/loadable-child.js')],
      matchedRouteChunks: [
        chunk('/static/js/async/(lang)/page.js'),
        chunk('/static/js/async/(lang)/checkout/page.js'),
        chunk('/static/js/async/(lang)/page.js'),
      ],
    });

    expect(scriptUrls(ordered)).toEqual([
      '/static/js/async/vendor.js',
      '/static/js/async/loadable-child.js',
      '/static/js/async/(lang)/page.js',
      '/static/js/async/(lang)/checkout/page.js',
      '/static/js/async/async-index-123.js',
    ]);
  });

  it('does not fall back to runtime route manifest when options omit routeManifest', async () => {
    const chunkSet = {
      renderLevel: RenderLevel.CLIENT_RENDER,
      ssrScripts: '',
      jsChunk: '',
      cssChunk: '',
    };
    const runtimeContext = createRuntimeContextWithMatchedRoutes(['route-a']);
    runtimeContext.routeManifest = {
      routeAssets: {
        'route-a': {
          assets: ['/static/css/route-a.css'],
        },
      },
    };

    const collector = new LoadableCollector({
      runtimeContext,
      template: '<html><head></head></html>',
      entryName: 'main',
      chunkSet,
      config: {},
    });

    collector.collect(React.createElement('div'));
    await collector.effect();

    expect(chunkSet.cssChunk).toBe('');
  });
});
