import { RenderLevel } from '../../../../src/core/constants';
import { SSR_DATA_PLACEHOLDER } from '../../../../src/core/server/constants';
import { buildShellAfterTemplate } from '../../../../src/core/server/stream/afterTemplate';
import { getTemplates } from '../../../../src/core/server/stream/template';
import { SSRDataCollector } from '../../../../src/core/server/string/ssrData';
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

const scriptSrcs = (html: string) =>
  Array.from(
    html.matchAll(/<script\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/g),
  ).map(match => match[1] ?? match[2] ?? match[3]);

describe('SSRDataCollector (stream parity)', () => {
  it('should strip denylisted headers from serialized SSR data script', () => {
    const chunkSet = {
      renderLevel: RenderLevel.SERVER_RENDER,
      ssrScripts: '',
      jsChunk: '',
      cssChunk: '',
    };

    const collector = new SSRDataCollector({
      runtimeContext: {
        initialData: {},
        __i18nData__: {},
      } as any,
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
        unsafeHeaders: ['x-request-id'],
      } as any,
    });

    collector.effect();

    expect(chunkSet.ssrScripts).toMatch('"x-request-id":"req-1"');
    expect(chunkSet.ssrScripts).not.toMatch('authorization');
    expect(chunkSet.ssrScripts).not.toMatch('cookie');
    expect(chunkSet.ssrScripts).not.toMatch('x-internal-secret');
  });

  it('should append router hydration script from the shared router snapshot', () => {
    const chunkSet = {
      renderLevel: RenderLevel.SERVER_RENDER,
      ssrScripts: '',
      jsChunk: '',
      cssChunk: '',
    };

    const collector = new SSRDataCollector({
      runtimeContext: withRouterSnapshot(
        {
          initialData: {},
          __i18nData__: {},
        },
        {
          hydrationScript: '<script>window.__HYDRATE__ = "router";</script>',
        },
      ) as any,
      request: new Request('http://localhost/'),
      chunkSet,
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
      } as any,
      ssrConfig: {} as any,
    });

    collector.effect();

    expect(chunkSet.ssrScripts).toContain('window.__HYDRATE__ = "router";');
  });

  it('should inject generic router hydration scripts into stream templates', async () => {
    const html = await buildShellAfterTemplate(SSR_DATA_PLACEHOLDER, {
      entryName: 'main',
      renderLevel: RenderLevel.SERVER_RENDER,
      request: new Request('http://localhost/'),
      runtimeContext: withRouterSnapshot(
        {
          initialData: {},
          __i18nData__: {},
          routeManifest: {},
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
        },
        {
          hydrationScripts: [
            '<script>window.__STREAM_ROUTER_A__ = true;</script>',
            '<script>window.__STREAM_ROUTER_B__ = true;</script>',
          ],
        },
      ) as any,
      ssrConfig: {} as any,
      config: {} as any,
    });

    expect(html).toContain('window.__STREAM_ROUTER_A__ = true;');
    expect(html).toContain('window.__STREAM_ROUTER_B__ = true;');
  });

  it('should omit nonce attributes from injected async scripts when nonce is absent', async () => {
    const html = await buildShellAfterTemplate('<!--<?- chunksMap.js ?>-->', {
      entryName: 'main',
      renderLevel: RenderLevel.SERVER_RENDER,
      request: new Request('http://localhost/'),
      runtimeContext: {
        routeManifest: {
          routeAssets: {
            'async-main': {
              assets: ['/assets/main.js'],
            },
          },
        },
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
      } as any,
      ssrConfig: {} as any,
      config: {} as any,
    });

    expect(html).toContain('<script src=/assets/main.js></script>');
    expect(html).not.toContain('nonce=');
  });

  it('should include nonce attributes in injected async scripts when nonce is present', async () => {
    const html = await buildShellAfterTemplate('<!--<?- chunksMap.js ?>-->', {
      entryName: 'main',
      renderLevel: RenderLevel.SERVER_RENDER,
      request: new Request('http://localhost/'),
      runtimeContext: {
        routeManifest: {
          routeAssets: {
            'async-main': {
              assets: ['/assets/main.js'],
            },
          },
        },
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
      } as any,
      ssrConfig: {} as any,
      config: {
        nonce: 'nonce-value',
      } as any,
    });

    expect(html).toContain(
      '<script src=/assets/main.js nonce="nonce-value"></script>',
    );
  });

  it('should inject matched route scripts before hydration', async () => {
    const html = await buildShellAfterTemplate('<!--<?- chunksMap.js ?>-->', {
      entryName: 'main',
      renderLevel: RenderLevel.SERVER_RENDER,
      request: new Request('http://localhost/products/shoe'),
      runtimeContext: withRouterSnapshot(
        {
          routeManifest: {
            routeAssets: {
              layout: {
                assets: ['/assets/layout.js'],
              },
              'products/$slug': {
                assets: ['/assets/product.js', '/assets/product.css'],
              },
              'async-main': {
                assets: ['/assets/main.js'],
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
          matchedRouteIds: ['layout', 'products/$slug'],
        },
      ) as any,
      ssrConfig: {} as any,
      config: {} as any,
    });

    expect(html).toContain('<script src=/assets/layout.js></script>');
    expect(html).toContain('<script src=/assets/product.js></script>');
    expect(html).toContain('<script src=/assets/main.js></script>');
    expect(html).not.toContain('/assets/product.css');
  });

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

  it('should place stream hydration bootstrap before an async head entry', async () => {
    const { shellBefore, shellAfter } = await getTemplates(
      [
        '<html><head>',
        '<script async src="/static/js/index.js"></script>',
        '</head><body><div id="root">',
        '<!--<?- html ?>-->',
        '</div>',
        '<!--<?- chunksMap.js ?>-->',
        SSR_DATA_PLACEHOLDER,
        '</body></html>',
      ].join(''),
      {
        entryName: 'index',
        renderLevel: RenderLevel.SERVER_RENDER,
        request: new Request('http://localhost/products/shoe'),
        runtimeContext: withRouterSnapshot(
          {
            routeManifest: {
              routeAssets: {
                'products/$slug': {
                  assets: ['/static/js/async/products/$slug.js'],
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
            hydrationScripts: [
              '<script>window.$_TSR = { router: "hydrated" };</script>',
            ],
            matchedRouteIds: ['products/$slug'],
          },
        ) as any,
        ssrConfig: {} as any,
        config: {} as any,
      },
    );

    const html = `${shellBefore}<main>server markup</main>${shellAfter}`;
    const entryIndex = html.indexOf(
      '<script async src="/static/js/index.js"></script>',
    );
    const routeIndex = html.indexOf(
      '<script src=/static/js/async/products/$slug.js></script>',
    );
    const ssrDataIndex = html.indexOf('window._SSR_DATA =');
    const routerBootstrapIndex = html.indexOf('window.$_TSR =');

    expect(routeIndex).toBeGreaterThan(-1);
    expect(ssrDataIndex).toBeGreaterThan(routeIndex);
    expect(routerBootstrapIndex).toBeGreaterThan(ssrDataIndex);
    expect(entryIndex).toBeGreaterThan(routerBootstrapIndex);
    expect(html).not.toContain('<!--<?- chunksMap.js ?>-->');
    expect(html).not.toContain(SSR_DATA_PLACEHOLDER);
  });

  it('should preserve JSON bootstrap and nonce before an async head entry', async () => {
    const { shellBefore, shellAfter } = await getTemplates(
      [
        '<html><head>',
        '<script async nonce="nonce-value" src="/static/js/index.js"></script>',
        '</head><body><div id="root">',
        '<!--<?- html ?>-->',
        '</div>',
        '<!--<?- chunksMap.js ?>-->',
        SSR_DATA_PLACEHOLDER,
        '</body></html>',
      ].join(''),
      {
        entryName: 'index',
        renderLevel: RenderLevel.SERVER_RENDER,
        request: new Request('http://localhost/products/shoe'),
        runtimeContext: withRouterSnapshot(
          {
            routeManifest: {
              routeAssets: {
                'products/$slug': {
                  assets: ['/static/js/async/products/$slug.js'],
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
            hydrationScripts: [
              '<script nonce="nonce-value">window.$_TSR = { router: "hydrated" };</script>',
            ],
            matchedRouteIds: ['products/$slug'],
          },
        ) as any,
        ssrConfig: {} as any,
        config: {
          nonce: 'nonce-value',
          useJsonScript: true,
        } as any,
      },
    );

    const html = `${shellBefore}<main>server markup</main>${shellAfter}`;
    const routeIndex = html.indexOf(
      '<script src=/static/js/async/products/$slug.js nonce="nonce-value"></script>',
    );
    const ssrDataIndex = html.indexOf(
      '<script type="application/json" id="__MODERN_SSR_DATA__">',
    );
    const routerBootstrapIndex = html.indexOf('window.$_TSR =');
    const entryIndex = html.indexOf(
      '<script async nonce="nonce-value" src="/static/js/index.js"></script>',
    );

    expect(routeIndex).toBeGreaterThan(-1);
    expect(ssrDataIndex).toBeGreaterThan(routeIndex);
    expect(routerBootstrapIndex).toBeGreaterThan(ssrDataIndex);
    expect(entryIndex).toBeGreaterThan(routerBootstrapIndex);
    expect(html).not.toContain('window._SSR_DATA =');
    expect(html).not.toContain('<!--<?- chunksMap.js ?>-->');
    expect(html).not.toContain(SSR_DATA_PLACEHOLDER);
  });

  it('should preserve a custom stream template that omits script markers', async () => {
    const template = '<script async src="/static/js/index.js"></script>';
    const html = await buildShellAfterTemplate(template, {
      entryName: 'index',
      renderLevel: RenderLevel.SERVER_RENDER,
      request: new Request('http://localhost/products/shoe'),
      runtimeContext: withRouterSnapshot(
        {
          initialData: {},
          __i18nData__: {},
          routeManifest: {
            routeAssets: {
              'products/$slug': {
                assets: ['/static/js/async/products/$slug.js'],
              },
              'async-index': {
                assets: ['/static/js/async/async-index.js'],
              },
            },
          },
          ssrContext: {
            request: {
              params: {},
              query: {},
              pathname: '/products/shoe',
              host: 'localhost',
              url: 'http://localhost/products/shoe',
              headers: {
                'x-request-id': 'request-1',
              },
            },
            reporter: { sessionId: 'session-1' },
          },
        },
        {
          hydrationScripts: [
            '<script>window.__OMITTED_BOOTSTRAP__ = true;</script>',
          ],
          matchedRouteIds: ['products/$slug'],
        },
      ) as any,
      ssrConfig: {
        unsafeHeaders: ['x-request-id'],
      } as any,
      config: {} as any,
    });

    expect(html).toBe(template);
  });
});
