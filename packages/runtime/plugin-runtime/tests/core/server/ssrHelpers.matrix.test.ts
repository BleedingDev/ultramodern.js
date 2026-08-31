globalThis.__webpack_require__ = {
  u: chunkId => String(chunkId),
};

import { applyRouterRuntimeState } from '../../../src/core/context';
import { createFederatedCssLinks } from '../../../src/core/server/federatedCss';
import type {
  RedirectContext,
  ResponseProxy,
} from '../../../src/core/server/requestResponse';
import {
  createRouterCleanup,
  type RouterCleanup,
} from '../../../src/core/server/routerCleanup';
import {
  createRouteHydrationScriptTags,
  orderHydrationScriptChunks,
} from '../../../src/core/server/scriptOrder';

const redirectCtx: RedirectContext = {
  enableRsc: false,
  isRSCNavigation: false,
  basename: '/',
};

const createResponseProxy = (
  status: number,
  headers: ResponseProxy['headers'] = {},
): ResponseProxy => ({
  status,
  headers,
});

const createRecordingRouterCleanup = (): RouterCleanup & {
  calls: string[];
} => {
  const calls: string[] = [];

  return {
    get deferred() {
      return false;
    },
    calls,
    run: async () => {
      calls.push('run');
    },
    deferUntilBodyDone: response => {
      calls.push('defer');
      return response;
    },
    discardBody: async response => {
      calls.push('discard');
      await response.body?.cancel();
    },
  };
};

const headersObject = (response: Response) =>
  Object.fromEntries(response.headers.entries());

const snapshotResponse = async (response: Response) => ({
  status: response.status,
  headers: headersObject(response),
  body: response.body === null ? null : await response.text(),
});

const createRuntimeContext = (
  matchedRouteIds: string[],
  routeAssets: Record<string, { assets?: string[] }>,
) => {
  const runtimeContext = {
    routeManifest: {
      routeAssets,
    },
  } as any;

  applyRouterRuntimeState(runtimeContext, {
    framework: 'custom-router',
    matchedRouteIds,
  } as any);

  return runtimeContext;
};

const createContextWithCleanup = (cleanup: () => void | Promise<void>) => {
  const context = {} as any;

  applyRouterRuntimeState(context, {
    framework: 'custom-router',
    cleanup,
  } as any);

  return context;
};

describe('plugin-runtime SSR server helper matrix', () => {
  it.each([
    204, 205, 304,
  ])('finalizeRenderResponse returns an exact null-body response for status %s', async status => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const routerCleanup = createRecordingRouterCleanup();
    const finalized = await finalizeRenderResponse(
      new Response('<main>rendered</main>', {
        status: 200,
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'text/html; charset=utf-8',
        },
      }),
      createResponseProxy(status, {
        'x-router-status': String(status),
      }),
      redirectCtx,
      routerCleanup,
    );

    expect(await snapshotResponse(finalized)).toEqual({
      status,
      headers: {
        'cache-control': 'max-age=60',
        'content-type': 'text/html; charset=utf-8',
        'x-router-status': String(status),
      },
      body: null,
    });
    expect(routerCleanup.calls).toEqual(['discard']);
  });

  it('finalizeRenderResponse returns an exact redirect response after discarding the rendered body', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const routerCleanup = createRecordingRouterCleanup();
    const finalized = await finalizeRenderResponse(
      new Response('<main>ignored</main>', {
        status: 200,
        headers: {
          'x-original': 'ignored',
        },
      }),
      createResponseProxy(302, {
        Location: '/login?from=/dashboard',
        'x-redirect': 'loader',
      }),
      redirectCtx,
      routerCleanup,
    );

    expect(await snapshotResponse(finalized)).toEqual({
      status: 302,
      headers: {
        location: '/login?from=/dashboard',
        'x-redirect': 'loader',
      },
      body: null,
    });
    expect(routerCleanup.calls).toEqual(['discard']);
  });

  it('finalizeRenderResponse preserves a normal 200 body and defers router cleanup until the body is done', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    let cleanupCalls = 0;
    const routerCleanup = createRouterCleanup(
      createContextWithCleanup(() => {
        cleanupCalls += 1;
      }),
      () => {},
    );
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('<shell>'));
        controller.enqueue(encoder.encode('<tail>'));
        controller.close();
      },
    });
    const finalized = await finalizeRenderResponse(
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/html',
        },
      }),
      createResponseProxy(200, {
        'x-render': 'ok',
      }),
      redirectCtx,
      routerCleanup,
    );

    expect(routerCleanup.deferred).toBe(true);
    expect(cleanupCalls).toBe(0);
    expect(await snapshotResponse(finalized)).toEqual({
      status: 200,
      headers: {
        'content-type': 'text/html',
        'x-render': 'ok',
      },
      body: '<shell><tail>',
    });
    expect(cleanupCalls).toBe(1);
  });

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

    const runtimeContext = createRuntimeContext(['routes/dashboard'], {
      'routes/dashboard': {
        assets: [
          '/assets/dashboard.js',
          '/assets/shared.js',
          '/assets/dashboard.css',
          '/assets/dashboard.js',
        ],
      },
      'async-main': {
        assets: [
          '/assets/async-main.js',
          '/assets/shared.js',
          '/assets/async-main.css',
        ],
      },
    });

    expect(
      createRouteHydrationScriptTags(runtimeContext, 'main', {
        nonce: 'nonce-1',
        template:
          '<script defer src="/assets/dashboard.js"></script><script src="/assets/shared.js?cache=1"></script>',
      }),
    ).toBe(
      '<script src=/assets/shared.js nonce="nonce-1"></script> <script src=/assets/async-main.js nonce="nonce-1"></script>',
    );
  });

  it('escapes federated CSS hrefs and dedupes existing, repeated, and template-present assets', () => {
    expect(
      createFederatedCssLinks(
        [
          '/remote/base.css',
          '/remote/base.css',
          '/remote/theme" onload="alert(1)&x=<tag>.css',
          '/remote/template".css',
          '/remote/existing.css',
          '',
        ],
        {
          template:
            '<link href="/remote/template&quot;.css" rel="stylesheet" />',
          attributes: {
            'data-mf': 'checkout',
            nonce: 'nonce-2',
            skipped: undefined,
          },
          existingAssets: ['/remote/existing.css'],
        },
      ),
    ).toBe(
      '<link data-mf="checkout" nonce="nonce-2" href="/remote/base.css" rel="stylesheet" /><link data-mf="checkout" nonce="nonce-2" href="/remote/theme&quot; onload=&quot;alert(1)&amp;x=&lt;tag&gt;.css" rel="stylesheet" />',
    );
  });
});
