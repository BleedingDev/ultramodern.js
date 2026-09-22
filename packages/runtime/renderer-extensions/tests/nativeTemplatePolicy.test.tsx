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

const buildShellAfterTemplate = (template: string, options: any) =>
  nativeBuildShellAfterTemplate(template, {
    ...options,
    lifecycle: lifecycleFor(options),
  });
const createDataCollector = (options: any) => {
  const lifecycle = lifecycleFor(options, 'string');
  const collector = new SSRDataCollector({ ...options, lifecycle });
  return {
    effect() {
      collector.effect();
      options.chunkSet.ssrScripts = replaceSSRTemplateChunk(
        {
          name: 'data',
          template: SSR_DATA_PLACEHOLDER,
          placeholder: SSR_DATA_PLACEHOLDER,
          content: options.chunkSet.ssrScripts,
        },
        lifecycle,
      );
    },
  };
};

import { applyRouterServerPrepareResult } from '@modern-js/runtime-extensions/router-state';
import { RenderLevel } from '../../plugin-runtime/src/core/constants';
import { SSR_DATA_PLACEHOLDER } from '../../plugin-runtime/src/core/server/constants';
import { buildShellAfterTemplate as nativeBuildShellAfterTemplate } from '../../plugin-runtime/src/core/server/stream/afterTemplate';
import { SSRDataCollector } from '../../plugin-runtime/src/core/server/string/ssrData';

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

const scriptSrcs = (html: string) =>
  Array.from(
    html.matchAll(/<script\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/g),
  ).map(match => match[1] ?? match[2] ?? match[3]);

describe('SSRDataCollector (stream parity)', () => {
  it('should move matched route scripts before the hydration entry script', async () => {
    const html = await buildShellAfterTemplate(
      '<script defer src="/static/js/index.js"></script><!--<?- chunksMap.js ?>-->',
      {
        entryName: 'index',
        renderLevel: RenderLevel.SERVER_RENDER,
        request: new Request('http://localhost/products/shoe'),
        runtimeContext: withRouterSnapshot(
          {
            routeManifest: {
              routeAssets: {
                'products/$slug': {
                  assets: [
                    '/static/js/async/products/shared.js',
                    '/static/js/async/products/$slug.js',
                  ],
                },
                'async-index': {
                  assets: ['/static/js/async/async-index.js'],
                },
              },
            },
            initialData: {},
            __i18nData__: {},
            ssrContext: {
              request: {
                params: {},
                query: {},
                pathname: '/products/shoe',
                host: 'localhost',
                url: 'http://localhost/products/shoe',
                headers: {},
              },
              reporter: { sessionId: 'session-1' },
            },
          },
          {
            matchedRouteIds: ['products/$slug'],
          },
        ) as any,
        ssrConfig: {} as any,
        config: {} as any,
      },
    );

    expect(scriptSrcs(html)).toEqual([
      '/static/js/async/products/shared.js',
      '/static/js/async/products/$slug.js',
      '/static/js/async/async-index.js',
      '/static/js/index.js',
    ]);
  });
});

import React from 'react';
import { renderString } from '../../plugin-runtime/src/core/server/string';

const TSR_BOOTSTRAP = '<script>window.$_TSR = { router: "hydrated" };</script>';

const createRuntimeContext = (options: { withRouterBootstrap: boolean }) => {
  const runtimeContext = {
    isBrowser: false,
    requestContext: {},
    context: {},
    initialData: {},
    __i18nData__: {},
    ssrContext: {
      request: {
        params: {},
        query: {},
        pathname: '/',
        host: 'localhost',
        url: 'http://localhost/',
        headers: {},
      },
      reporter: { sessionId: 'session-1' },
    },
  };

  if (options.withRouterBootstrap) {
    applyRouterServerPrepareResult(runtimeContext as any, {
      state: { framework: 'react-router' },
      snapshot: {
        hydrationScripts: [TSR_BOOTSTRAP],
      },
    });
  }

  return runtimeContext;
};

const render = async (
  htmlTemplate: string,
  options: { entryName?: string; withRouterBootstrap?: boolean } = {},
) => {
  registerPlugin([rendererHeadPlugin()]);

  return renderString(
    new Request('http://localhost/'),
    React.createElement('main', null, 'server markup'),
    {
      resource: {
        entryName: options.entryName ?? 'index',
        htmlTemplate,
        routeManifest: {},
      },
      runtimeContext: createRuntimeContext({
        withRouterBootstrap: options.withRouterBootstrap ?? true,
      }),
      config: {},
      onError: () => {},
      onTiming: () => {},
    } as any,
  );
};

describe('renderString template assembly (string-mode script ordering)', () => {
  it('should emit the SSR data + router bootstrap before the entry script', async () => {
    const html = await render(
      [
        '<html><head>',
        '<script src="/static/js/index.js" async></script>',
        '<!--<?- chunksMap.css ?>-->',
        '</head><body><div id="root">',
        '<!--<?- html ?>-->',
        '</div>',
        '<!--<?- chunksMap.js ?>-->',
        SSR_DATA_PLACEHOLDER,
        '</body></html>',
      ].join(''),
    );

    const entryIndex = html.indexOf(
      '<script src="/static/js/index.js" async></script>',
    );
    const ssrDataIndex = html.indexOf('window._SSR_DATA =');
    const routerBootstrapIndex = html.indexOf('window.$_TSR =');

    expect(ssrDataIndex).toBeGreaterThan(-1);
    expect(routerBootstrapIndex).toBeGreaterThan(ssrDataIndex);
    expect(entryIndex).toBeGreaterThan(routerBootstrapIndex);
    expect(html).not.toContain(SSR_DATA_PLACEHOLDER);
  });

  it('should preserve a custom template that omits script markers', async () => {
    const template =
      '<html><head><script async src="/static/js/index.js"></script></head><body>custom shell</body></html>';
    const runtimeContext = createRuntimeContext({ withRouterBootstrap: true });
    runtimeContext.ssrContext.request.headers = {
      'x-request-id': 'request-1',
    };

    const html = await renderString(
      new Request('http://localhost/'),
      React.createElement('main', null, 'server markup'),
      {
        resource: {
          entryName: 'index',
          htmlTemplate: template,
          routeManifest: {},
        },
        runtimeContext,
        config: {
          ssr: {
            unsafeHeaders: ['x-request-id'],
          },
        },
        onError: () => {},
        onTiming: () => {},
      } as any,
    );

    expect(html).toBe(template);
  });
});

import vm from 'node:vm';

const createScripts = (options?: {
  useJsonScript?: boolean;
  nonce?: string;
  unsafeHeaders?: string[];
  routerServerSnapshot?: {
    routerData?: {
      loaderData?: Record<string, unknown>;
      errors?: Record<string, unknown>;
    };
    hydrationScripts?: string[];
  };
}) => {
  const chunkSet = {
    renderLevel: RenderLevel.SERVER_RENDER,
    ssrScripts: '',
    jsChunk: '',
    cssChunk: '',
  };

  const runtimeContext = {
    initialData: { name: 'modern.js' },
    __i18nData__: {},
  } as any;
  if (options?.routerServerSnapshot) {
    applyRouterServerPrepareResult(runtimeContext, {
      state: { framework: 'react-router' },
      snapshot: options.routerServerSnapshot,
    });
  }

  const collector = createDataCollector({
    runtimeContext,
    request: new Request('http://localhost/'),
    chunkSet,
    ssrContext: {
      request: {
        params: {},
        query: {},
        pathname: '/',
        host: 'localhost',
        url: 'http://localhost/',
        headers: {
          authorization: 'Bearer secret',
          cookie: 'sid=abc',
          'x-request-id': 'req-1',
          'x-internal-secret': 'hidden',
        },
      },
      reporter: { sessionId: 'session-1' },
    } as any,
    ssrConfig: {
      unsafeHeaders: options?.unsafeHeaders,
    } as any,
    nonce: options?.nonce,
    useJsonScript: options?.useJsonScript,
  });

  collector.effect();
  return chunkSet.ssrScripts;
};

const parseScripts = (html: string) =>
  [
    ...html.matchAll(
      /<script(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/script>/gu,
    ),
  ].map(match => ({
    attributes: Object.fromEntries(
      [
        ...(match.groups?.attributes ?? '').matchAll(/([\w-]+)="([^"]*)"/gu),
      ].map(attribute => [attribute[1], attribute[2]]),
    ),
    body: match.groups?.body ?? '',
  }));

const executeScripts = (html: string) => {
  const browser = {} as Record<string, any>;
  const context = vm.createContext({ window: browser });
  for (const script of parseScripts(html)) {
    vm.runInContext(script.body, context);
  }
  return browser;
};

describe('SSR data script generation', () => {
  it('should use router snapshot data and hydration script when present', () => {
    const browser = executeScripts(
      createScripts({
        routerServerSnapshot: {
          routerData: {
            loaderData: { route: { ok: true } },
            errors: {},
          },
          hydrationScripts: ['<script>window.__ROUTER_SSR__ = true;</script>'],
        },
      }),
    );

    expect(browser.__ROUTER_SSR__).toBe(true);
    expect(browser._ROUTER_DATA).toEqual({
      errors: {},
      loaderData: { route: { ok: true } },
    });
  });
});
