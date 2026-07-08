import React from 'react';
import { RenderLevel } from '../../../src/core/constants';
import {
  createRouteHydrationScriptTags,
  orderHydrationScriptChunks,
} from '../../../src/core/server/scriptOrder';
import { LoadableCollector } from '../../../src/core/server/string/loadable';
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

describe('createRouteHydrationScriptTags', () => {
  it('does not treat substring matches in the template as existing scripts', () => {
    const runtimeContext = createRuntimeContextWithMatchedRoutes(['route-a']);
    runtimeContext.routeManifest = {
      routeAssets: {
        'route-a': {
          assets: ['/static/js/route-a.js'],
        },
      },
    };

    const scripts = createRouteHydrationScriptTags(runtimeContext, 'index', {
      template:
        '<html><head><link href="/static/js/route-a.js.map" rel="prefetch" /></head></html>',
    });

    expect(scripts).toBe('<script src=/static/js/route-a.js></script>');
  });
});

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

  it('emits async entry assets when the sync route manifest contains merged async assets', async () => {
    const chunkSet = {
      renderLevel: RenderLevel.CLIENT_RENDER,
      ssrScripts: '',
      jsChunk: '',
      cssChunk: '',
    };
    const collector = new LoadableCollector({
      runtimeContext: createRuntimeContextWithMatchedRoutes([]),
      template: '<html><head></head><body></body></html>',
      entryName: 'index',
      chunkSet,
      config: {
        enableAsyncEntry: true,
      },
      routeManifest: {
        routeAssets: {
          index: {
            assets: [
              '/static/js/async/async-index.js',
              '/static/css/async/async-index.css',
            ],
          },
        },
      },
    });

    (collector as any).extractor = {
      chunks: [],
      getChunkAssets: (chunks: string[]) =>
        chunks.includes('async-index')
          ? [
              chunk('/static/js/async/async-index.js'),
              chunk('/static/css/async/async-index.css'),
            ]
          : [],
      getScriptTags: () => '',
    };

    await collector.effect();

    expect(chunkSet.jsChunk).toBe(
      '<script defer="true" src="/static/js/async/async-index.js"></script>',
    );
    expect(chunkSet.cssChunk).toBe(
      '<link href="/static/css/async/async-index.css" rel="stylesheet" />',
    );
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
