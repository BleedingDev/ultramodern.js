(
  globalThis as typeof globalThis & {
    __webpack_require__?: { u: (chunkId: unknown) => string };
  }
).__webpack_require__ = {
  u: chunkId => String(chunkId),
};

import { applyRouterRuntimeState } from '../../../src/core/context';
import type {
  RedirectContext,
  ResponseProxy,
} from '../../../src/core/server/requestResponse';
import {
  createRouterCleanup,
  finishWithRouterCleanup,
  type RouterCleanup,
} from '../../../src/core/server/routerCleanup';

const redirectCtx: RedirectContext = {
  enableRsc: false,
  isRSCNavigation: false,
  basename: '/',
};

const createNoopRouterCleanup = (): RouterCleanup => ({
  get deferred() {
    return false;
  },
  run: async () => undefined,
  deferUntilBodyDone: response => response,
  discardBody: async response => {
    await response.body?.cancel();
  },
});

const createResponseProxy = (status: number): ResponseProxy => ({
  status,
  headers: {
    'x-router-status': String(status),
  },
});

describe('createLoaderRedirectResponse', () => {
  it.each([
    300, 304, 305, 306,
  ])('does not classify status %s as a navigation redirect', async status => {
    const { createLoaderRedirectResponse } = await import(
      '../../../src/core/server/requestResponse'
    );

    expect(
      createLoaderRedirectResponse(
        new Response(null, {
          status,
          headers: { Location: '/not-a-navigation-redirect' },
        }),
        redirectCtx,
      ),
    ).toBeUndefined();
  });

  it.each([
    ['missing', {}],
    ['empty', { Location: '' }],
    ['malformed', { Location: 'http://[::1' }],
  ])('does not invent a target for a %s Location header', async (_, headers) => {
    const { createLoaderRedirectResponse } = await import(
      '../../../src/core/server/requestResponse'
    );

    expect(
      createLoaderRedirectResponse(
        new Response(null, { status: 302, headers }),
        redirectCtx,
      ),
    ).toBeUndefined();
  });

  it.each([
    301, 302, 303, 307, 308,
  ])('preserves canonical redirect status %s and its localized target', async status => {
    const { createLoaderRedirectResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const response = createLoaderRedirectResponse(
      new Response(null, {
        status,
        headers: { lOcAtIoN: '/cs/objednavky?from=prehled' },
      }),
      redirectCtx,
    );

    expect(response?.status).toBe(status);
    expect(response?.headers.get('location')).toBe(
      '/cs/objednavky?from=prehled',
    );
  });

  it.each([
    307, 308,
  ])('preserves method-retaining status %s through the RSC redirect transform', async status => {
    const { createLoaderRedirectResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const response = createLoaderRedirectResponse(
      new Response(null, {
        status,
        headers: { Location: '/app/cs/objednavky' },
      }),
      { enableRsc: true, isRSCNavigation: true, basename: '/app' },
    );

    expect(response?.status).toBe(status);
    expect(response?.headers.get('x-modernjs-redirect')).toBe('/cs/objednavky');
    expect(response?.headers.get('location')).toBeNull();
  });

  it.each([
    ['304 response', 304, { Location: '/cached' }],
    ['missing target', 302, {}],
    ['malformed target', 302, { Location: 'http://[::1' }],
  ])('does not let the RSC transform manufacture navigation for a %s', async (_, status, headers) => {
    const [{ createLoaderRedirectResponse }, { handleRSCRedirect }] =
      await Promise.all([
        import('../../../src/core/server/requestResponse'),
        import('../../../src/router/runtime/redirect'),
      ]);
    const transformed = handleRSCRedirect(new Headers(headers), '/', status);

    expect(transformed.headers.get('x-modernjs-redirect')).toBeNull();
    expect(
      createLoaderRedirectResponse(transformed, redirectCtx),
    ).toBeUndefined();
  });
});

describe('finalizeRenderResponse', () => {
  it('recognizes a lowercase Location header without changing redirect status', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const finalized = await finalizeRenderResponse(
      new Response('<html>discarded</html>'),
      {
        status: 307,
        headers: { location: '/cs/objednavky' },
      },
      redirectCtx,
      createNoopRouterCleanup(),
    );

    expect(finalized.status).toBe(307);
    expect(finalized.headers.get('location')).toBe('/cs/objednavky');
    expect(finalized.body).toBeNull();
  });

  it('does not discard rendered output for a malformed redirect target', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const finalized = await finalizeRenderResponse(
      new Response('<html>kept</html>'),
      {
        status: 302,
        headers: { Location: 'http://[::1' },
      },
      redirectCtx,
      createNoopRouterCleanup(),
    );

    expect(finalized.status).toBe(302);
    await expect(finalized.text()).resolves.toBe('<html>kept</html>');
  });

  it.each([
    { status: 204, headers: {} },
    { status: 205, headers: {} },
    { status: 304, headers: {} },
    { status: 302, headers: { Location: '/login' } },
  ])('cancels the discarded source before router cleanup for status $status', async ({
    status,
    headers,
  }) => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const events: string[] = [];
    let releaseCancel = () => {};
    let reportCancelStarted = () => {};
    const cancelReleased = new Promise<void>(resolve => {
      releaseCancel = resolve;
    });
    const cancelStarted = new Promise<void>(resolve => {
      reportCancelStarted = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async cancel() {
        events.push('cancel:start');
        reportCancelStarted();
        await cancelReleased;
        events.push('cancel:end');
      },
    });
    const context = {} as any;
    applyRouterRuntimeState(context, {
      framework: 'custom-router',
      cleanup: () => {
        events.push('cleanup');
      },
    } as any);
    const routerCleanup = createRouterCleanup(context, () => {});
    const response = new Response(body, {
      status: 200,
      headers: {
        'content-length': '123',
        'transfer-encoding': 'chunked',
      },
    });

    const finalizing = finishWithRouterCleanup(routerCleanup, () =>
      finalizeRenderResponse(
        response,
        {
          status,
          headers: {
            ...headers,
            'content-length': '999',
            'transfer-encoding': 'chunked',
          },
        },
        redirectCtx,
        routerCleanup,
      ),
    );

    const firstLifecycleEvent = await Promise.race([
      cancelStarted.then(() => 'cancel:start'),
      finalizing.then(() => 'finalized'),
    ]);
    releaseCancel();

    expect(firstLifecycleEvent).toBe('cancel:start');
    const finalized = await finalizing;
    expect(events).toEqual(['cancel:start', 'cancel:end', 'cleanup']);
    expect(finalized.status).toBe(status);
    expect(finalized.body).toBeNull();
    expect(finalized.headers.has('content-length')).toBe(false);
    expect(finalized.headers.has('transfer-encoding')).toBe(false);
  });

  it('fails closed without router cleanup when a discarded body has another owner', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const events: string[] = [];
    const context = {} as any;
    applyRouterRuntimeState(context, {
      framework: 'custom-router',
      cleanup: () => {
        events.push('cleanup');
      },
    } as any);
    const routerCleanup = createRouterCleanup(context, () => {});
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          events.push(`source-cancel:${String(reason)}`);
        },
      }),
    );
    const owner = response.body!.getReader();

    const finalizing = finishWithRouterCleanup(routerCleanup, () =>
      finalizeRenderResponse(
        response,
        createResponseProxy(204),
        redirectCtx,
        routerCleanup,
      ),
    );

    await expect(finalizing).rejects.toThrow(
      'Cannot discard a locked response body before router cleanup',
    );
    expect(events).toEqual([]);
    expect(response.body!.locked).toBe(true);

    await owner.cancel('owner finished');
    owner.releaseLock();
    await routerCleanup.run();
    expect(events).toEqual(['source-cancel:owner finished', 'cleanup']);
  });

  it.each([
    204, 205, 304,
  ])('drops the rendered body when applying no-body status %s', async status => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const response = new Response('<html>rendered</html>', {
      status: 200,
      headers: {
        'content-type': 'text/html',
      },
    });

    const finalized = await finalizeRenderResponse(
      response,
      createResponseProxy(status),
      redirectCtx,
      createNoopRouterCleanup(),
    );

    expect(finalized.status).toBe(status);
    expect(finalized.headers.get('x-router-status')).toBe(String(status));
    expect(finalized.body).toBeNull();
    await expect(finalized.text()).resolves.toBe('');
  });
});
