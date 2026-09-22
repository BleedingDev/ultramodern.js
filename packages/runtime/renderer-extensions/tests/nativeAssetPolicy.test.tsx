import { getGlobalInternalRuntimeContext } from '../../plugin-runtime/src/core/context';
import { registerPlugin } from '../../plugin-runtime/src/core/plugin';
import {
  createSSRRenderLifecycle,
  replaceSSRTemplateChunk,
} from '../../plugin-runtime/src/core/server/shared';
import { rendererHeadPlugin } from '../src/node';

const lifecycleFor = (options: any, mode: 'string' | 'stream' = 'stream') => {
  registerPlugin([rendererHeadPlugin()]);
  const hooks = getGlobalInternalRuntimeContext().hooks;
  const render = {
    runtimeContext: options.runtimeContext,
    request: options.request ?? new Request('http://localhost/'),
    resource: options.resource ?? {
      entryName: options.entryName,
      routeManifest: options.routeManifest,
      moduleFederationCssAssets: options.moduleFederationCssAssets,
    },
    config: options.config ?? {},
    platform: 'node' as const,
    mode,
    isRsc: false,
  };
  return createSSRRenderLifecycle(
    mode === 'string'
      ? (hooks.extendStringSSRCollectors
          .call({ chunkSet: options.chunkSet, render })
          .filter(Boolean) as any)
      : (hooks.extendStreamSSR
          .call({ ...render, terminalMarker: '<!--end-->' })
          .filter(Boolean) as any),
  );
};

const buildShellBeforeTemplate = (template: string, options: any) =>
  nativeBuildShellBeforeTemplate(template, {
    ...options,
    lifecycle: lifecycleFor(options),
  });
const buildWorkerShellBeforeTemplate = (template: string, options: any) =>
  nativeBuildWorkerShellBeforeTemplate(template, {
    ...options,
    lifecycle: lifecycleFor(options),
  });

import { applyRouterServerPrepareResult } from '@modern-js/runtime-extensions/router-state';
import { CHUNK_CSS_PLACEHOLDER } from '../../plugin-runtime/src/core/server/constants';
import { buildShellBeforeTemplate as nativeBuildShellBeforeTemplate } from '../../plugin-runtime/src/core/server/stream/beforeTemplate';
import { buildShellBeforeTemplate as nativeBuildWorkerShellBeforeTemplate } from '../../plugin-runtime/src/core/server/stream/beforeTemplate.worker';

const withRouterSnapshot = (
  runtimeContext: Record<string, unknown>,
  serverSnapshot: Record<string, unknown>,
) => {
  applyRouterServerPrepareResult(runtimeContext as any, {
    state: { framework: 'react-router' },
    snapshot: serverSnapshot,
  });
  return runtimeContext;
};

describe('buildShellBeforeTemplate', () => {
  it.each([
    ['node', buildShellBeforeTemplate],
    ['worker', buildWorkerShellBeforeTemplate],
  ])('preserves the complete %s CSS priority order without duplicate assets', async (_runtime, buildTemplate) => {
    const runtimeContext = withRouterSnapshot(
      {
        routeManifest: {
          routeAssets: {
            'route-a': {
              referenceCssAssets: ['/assets/route-a.css', '/assets/shared.css'],
            },
            'route-b': {
              referenceCssAssets: ['/assets/route-b.css'],
            },
            'async-main': {
              referenceCssAssets: ['/assets/async-main.css'],
            },
          },
        },
      },
      {
        matchedRouteIds: ['route-a', 'route-b'],
      },
    );
    const helmetStylesheet =
      '<link href="/assets/helmet.css" rel="stylesheet" data-rh="true">';
    const helmetData = {
      bodyAttributes: '',
      htmlAttributes: '',
      base: '',
      priority: '',
      link: helmetStylesheet,
      meta: '',
      noscript: '',
      script: '',
      style: '',
      title: '',
    } as any;

    const styledComponentsStyleTags =
      '<style data-styled="true">.styled{color:red}</style>';
    const orderedFragments = [
      '<link href="/assets/route-a.css" rel="stylesheet" />',
      '<link href="/assets/shared.css" rel="stylesheet" />',
      '<link href="/assets/route-b.css" rel="stylesheet" />',
      '<link href="/assets/async-main.css" rel="stylesheet" />',
      styledComponentsStyleTags,
      '<link href="/assets/federated.css" rel="stylesheet" />',
      helmetStylesheet,
    ];
    const expectedHtml = `<html><head>${orderedFragments
      .slice(0, -1)
      .join('')}  ${helmetStylesheet}\n</head><body></body></html>`;
    const html = await buildTemplate(
      `<html><head>${CHUNK_CSS_PLACEHOLDER}</head><body></body></html>`,
      {
        entryName: 'main',
        runtimeContext: runtimeContext as any,
        config: {} as any,
        styledComponentsStyleTags,
        helmetData,
        moduleFederationCssAssets: [
          '/assets/shared.css',
          '/assets/federated.css',
        ],
      },
    );

    expect(html).toBe(expectedHtml);
  });
});

const createRouteHydrationScriptTags = (
  runtimeContext: any,
  entryName: string,
  options: any = {},
) => {
  const lifecycle = lifecycleFor({
    runtimeContext,
    entryName,
    config: options,
  });
  return replaceSSRTemplateChunk(
    {
      name: 'scripts',
      template: `${options.template ?? ''}<!--assets-->`,
      placeholder: '<!--assets-->',
      content: '',
    },
    lifecycle,
  ).replace(options.template ?? '', '');
};
const createLoadableCollector = (options: any) => {
  const lifecycle = lifecycleFor(options, 'string');
  const collector = new NativeLoadableCollector({ ...options, lifecycle });
  const effect = collector.effect.bind(collector);
  collector.effect = async () => {
    await effect();
    options.chunkSet.cssChunk = replaceSSRTemplateChunk(
      {
        name: 'styles',
        template: `${options.template}<!--assets-->`,
        placeholder: '<!--assets-->',
        content: options.chunkSet.cssChunk,
        ...collector.stylesheetInfo,
      },
      lifecycle,
    ).slice(options.template.length);
  };
  return collector;
};

import { orderHydrationScriptChunks } from '@modern-js/runtime-extensions';
import React from 'react';
import { RenderLevel } from '../../plugin-runtime/src/core/constants';
import { LoadableCollector as NativeLoadableCollector } from '../../plugin-runtime/src/core/server/string/loadable';

const createRuntimeContextWithMatchedRoutes = (matchedRouteIds: string[]) => {
  const runtimeContext = {} as any;
  applyRouterServerPrepareResult(runtimeContext, {
    state: { framework: 'react-router' },
    snapshot: { matchedRouteIds },
  });
  return runtimeContext;
};

const chunk = (url: string, filename = url) => ({
  url,
  filename,
  path: url,
});

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

    expect(scripts).toBe('<script src="/static/js/route-a.js"></script>');
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

    const collector = createLoadableCollector({
      runtimeContext: createRuntimeContextWithMatchedRoutes(['route-a']),
      template:
        '<html><head><link href="https://remote.example.com/already.css" rel="stylesheet" /></head></html>',
      entryName: 'main',
      chunkSet,
      config: {},
      routeManifest: {
        routeAssets: {
          'route-a': {
            assets: ['/static/css/route-a.css', '/static/css/shared.css'],
          },
        },
      },
      moduleFederationCssAssets: [
        '/static/css/shared.css',
        'https://remote.example.com/expose.css',
        'https://remote.example.com/expose.css',
        'https://remote.example.com/already.css',
      ],
    });

    (collector as any).extractor = {
      chunks: ['local'],
      getChunkAssets: () => [
        chunk('/static/css/local.css'),
        chunk('/static/css/shared.css'),
      ],
      getScriptTags: () => '',
    };
    await collector.effect();

    expect(chunkSet.cssChunk).toBe(
      '<link href="/static/css/local.css" rel="stylesheet" /><link href="/static/css/shared.css" rel="stylesheet" /><link href="/static/css/route-a.css" rel="stylesheet" /><link href="https://remote.example.com/expose.css" rel="stylesheet" />',
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

    const collector = createLoadableCollector({
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

test('registered asset policy orders native loadable output before the async entry', async () => {
  const chunkSet = {
    renderLevel: RenderLevel.CLIENT_RENDER,
    ssrScripts: '',
    jsChunk: '',
    cssChunk: '',
  };
  const collector = createLoadableCollector({
    runtimeContext: createRuntimeContextWithMatchedRoutes(['route-a']),
    template: '',
    entryName: 'index',
    chunkSet,
    config: { enableAsyncEntry: true },
    routeManifest: { routeAssets: { 'route-a': { assets: ['/route-a.js'] } } },
  });
  (collector as any).extractor = {
    chunks: ['child'],
    getScriptTags: () => '',
    getChunkAssets: (ids: string[]) =>
      ids.includes('async-index')
        ? [chunk('/vendor.js'), chunk('/async-index.js')]
        : [chunk('/child.js')],
  };
  await collector.effect();
  expect(
    Array.from(chunkSet.jsChunk.matchAll(/src="([^"]+)"/g), match => match[1]),
  ).toEqual(['/vendor.js', '/child.js', '/route-a.js', '/async-index.js']);
});

describe('SSR hydration helper matrix', () => {
  it('dedupes hydration script chunks and generated tags by the exact script src', () => {
    expect(
      orderHydrationScriptChunks({
        entryName: 'main',
        asyncEntryChunks: [
          {
            filename: 'async-main.123.js',
            url: '/assets/async-main.123.js',
          },
          {
            filename: 'vendor.js',
            url: '/assets/vendor.js',
          },
          {
            filename: 'vendor-copy.js',
            url: '/assets/vendor.js',
          },
        ],
        collectedChunks: [
          {
            filename: 'route.js',
            url: '/assets/route.js',
          },
        ],
        matchedRouteChunks: [
          {
            filename: 'route-copy.js',
            url: '/assets/route.js',
          },
          {
            filename: 'vendor-query.js',
            url: '/assets/vendor.js?cache=1',
          },
        ],
      }),
    ).toEqual([
      {
        filename: 'vendor.js',
        url: '/assets/vendor.js',
      },
      {
        filename: 'route.js',
        url: '/assets/route.js',
      },
      {
        filename: 'vendor-query.js',
        url: '/assets/vendor.js?cache=1',
      },
      {
        filename: 'async-main.123.js',
        url: '/assets/async-main.123.js',
      },
    ]);
  });
});
