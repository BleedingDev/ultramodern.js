import vm from 'node:vm';
import { RenderLevel } from '../../../../src/core/constants';
import { SSRDataCollector } from '../../../../src/core/server/string/ssrData';
import { applyRouterRuntimeState } from '../../../../src/router/runtime/lifecycle';

const createScripts = (options?: {
  useJsonScript?: boolean;
  nonce?: string;
  unsafeHeaders?: string[];
  routerServerSnapshot?: {
    routerData?: {
      loaderData?: Record<string, unknown>;
      errors?: Record<string, unknown>;
    };
    hydrationScript?: string;
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
    applyRouterRuntimeState(runtimeContext, {
      framework: 'react-router',
      serverSnapshot: options.routerServerSnapshot,
    });
  }

  const collector = new SSRDataCollector({
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
  it('should inject json script correctly', () => {
    const scripts = parseScripts(createScripts({ useJsonScript: true }));

    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.attributes).toEqual({
      id: '__MODERN_SSR_DATA__',
      type: 'application/json',
    });
    expect(JSON.parse(scripts[0]?.body ?? '')).toMatchObject({
      data: { initialData: { name: 'modern.js' }, i18nData: {} },
      mode: 'string',
      renderLevel: RenderLevel.SERVER_RENDER,
    });
  });

  it('should inject inline scripts with nonce correctly', () => {
    const html = createScripts({ nonce: 'test-nonce' });
    expect(parseScripts(html)[0]?.attributes).toEqual({ nonce: 'test-nonce' });
    expect(executeScripts(html)._SSR_DATA).toMatchObject({
      data: { initialData: { name: 'modern.js' }, i18nData: {} },
      mode: 'string',
      renderLevel: RenderLevel.SERVER_RENDER,
    });
  });

  it('should inject inline script correctly', () => {
    const payload = executeScripts(createScripts())._SSR_DATA;
    expect(payload).toMatchObject({
      data: { initialData: { name: 'modern.js' }, i18nData: {} },
      context: {
        request: {
          host: 'localhost',
          params: {},
          pathname: '/',
          query: {},
          url: 'http://localhost/',
        },
        reporter: { sessionId: 'session-1' },
      },
      mode: 'string',
      renderLevel: RenderLevel.SERVER_RENDER,
    });
  });

  it('should strip denylisted headers from serialized SSR payload', () => {
    const payload = executeScripts(
      createScripts({ unsafeHeaders: ['x-request-id'] }),
    )._SSR_DATA;
    expect(payload.context.request.headers).toEqual({
      'x-request-id': 'req-1',
    });
  });

  it('should use router snapshot data and hydration script when present', () => {
    const browser = executeScripts(
      createScripts({
        routerServerSnapshot: {
          routerData: {
            loaderData: { route: { ok: true } },
            errors: {},
          },
          hydrationScript: '<script>window.__ROUTER_SSR__ = true;</script>',
        },
      }),
    );

    expect(browser.__ROUTER_SSR__).toBe(true);
    expect(browser._ROUTER_DATA).toEqual({
      errors: {},
      loaderData: { route: { ok: true } },
    });
  });

  it('should serialize generic router hydration scripts when present', () => {
    const browser = executeScripts(
      createScripts({
        routerServerSnapshot: {
          hydrationScripts: [
            '<script>window.__ROUTER_A__ = true;</script>',
            '<script>window.__ROUTER_B__ = true;</script>',
          ],
        },
      }),
    );

    expect(browser.__ROUTER_A__).toBe(true);
    expect(browser.__ROUTER_B__).toBe(true);
  });
});
