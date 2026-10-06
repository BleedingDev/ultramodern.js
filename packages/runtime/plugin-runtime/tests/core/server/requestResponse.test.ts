(
  globalThis as typeof globalThis & {
    __webpack_require__?: { u: (chunkId: unknown) => string };
  }
).__webpack_require__ = {
  u: chunkId => String(chunkId),
};

import type {
  RedirectContext,
  RequestLifecycle,
  ResponseProxy,
} from '../../../src/core/server/requestHandler';
import { SSRErrors } from '../../../src/core/server/tracer';

type RequestHelpers = typeof import('../../../src/core/server/requestHandler');
let createRequestLifecycle: RequestHelpers['createRequestLifecycle'];
let finishWithRequestLifecycle: RequestHelpers['finishWithRequestLifecycle'];

beforeAll(async () => {
  const helpers = await import('../../../src/core/server/requestHandler');
  createRequestLifecycle = helpers.createRequestLifecycle;
  finishWithRequestLifecycle = helpers.finishWithRequestLifecycle;
});

const redirectCtx: RedirectContext = {
  enableRsc: false,
  isRSCNavigation: false,
  basename: '/',
};

const createNoopRequestLifecycle = (): RequestLifecycle => ({
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

describe('applyRouterResult', () => {
  it('applies loader status and reports only the first loader failure', async () => {
    const { applyRouterResult } = await import(
      '../../../src/core/server/requestHandler'
    );
    const statuses: number[] = [];
    const status = (code: number) => {
      statuses.push(code);
    };
    const errors: unknown[][] = [];
    const onError = (...args: unknown[]) => {
      errors.push(args);
    };
    const first = new Error('root loader failed');
    const second = new Error('nested loader failed');

    applyRouterResult(
      { ssrContext: { response: { status } } } as any,
      { statusCode: 418, errors: { root: first, nested: second } },
      onError,
    );

    expect(statuses).toEqual([418]);
    expect(errors).toEqual([[first, SSRErrors.LOADER_ERROR]]);
  });

  it.each([undefined, 0, Number.NaN, 200])(
    'keeps the renderer status for router status %s',
    async statusCode => {
      const { applyRouterResult } = await import(
        '../../../src/core/server/requestHandler'
      );
      const statuses: number[] = [];
      const status = (code: number) => {
        statuses.push(code);
      };
      const errors: unknown[][] = [];
      const onError = (...args: unknown[]) => {
        errors.push(args);
      };

      applyRouterResult(
        { ssrContext: { response: { status } } } as any,
        { statusCode, errors: null },
        onError,
      );

      expect(statuses).toEqual([]);
      expect(errors).toEqual([]);
    },
  );
});

describe('createLoaderRedirectResponse', () => {
  it.each([304])(
    'does not classify status %s as a navigation redirect',
    async status => {
      const { createLoaderRedirectResponse } = await import(
        '../../../src/core/server/requestHandler'
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
    },
  );

  it.each([
    ['missing', {}],
    ['empty', { Location: '' }],
    ['malformed', { Location: 'http://[::1' }],
  ])(
    'does not invent a target for a %s Location header',
    async (_, headers) => {
      const { createLoaderRedirectResponse } = await import(
        '../../../src/core/server/requestHandler'
      );

      expect(
        createLoaderRedirectResponse(
          new Response(null, { status: 302, headers }),
          redirectCtx,
        ),
      ).toBeUndefined();
    },
  );

  it.each([301, 302, 303, 307, 308])(
    'preserves canonical redirect status %s and its localized target',
    async status => {
      const { createLoaderRedirectResponse } = await import(
        '../../../src/core/server/requestHandler'
      );
      const response = createLoaderRedirectResponse(
        new Response(null, {
          status,
          headers: {
            lOcAtIoN: '/cs/objednavky?from=prehled',
            'x-redirect-metadata': 'preserved',
          },
        }),
        redirectCtx,
      );

      expect(response?.status).toBe(status);
      expect(response?.headers.get('location')).toBe(
        '/cs/objednavky?from=prehled',
      );
      expect(response?.headers.get('x-redirect-metadata')).toBe('preserved');
    },
  );

  it.each([301, 302, 303, 307, 308])(
    'preserves navigation status %s through the RSC redirect transform',
    async status => {
      const { createLoaderRedirectResponse } = await import(
        '../../../src/core/server/requestHandler'
      );
      const response = createLoaderRedirectResponse(
        new Response(null, {
          status,
          headers: {
            Location: '/app/cs/objednavky',
            'x-redirect-metadata': 'preserved',
          },
        }),
        { enableRsc: true, isRSCNavigation: true, basename: '/app' },
      );

      expect(response?.status).toBe(status);
      expect(response?.headers.get('x-modernjs-redirect')).toBe(
        '/cs/objednavky',
      );
      expect(response?.headers.get('x-redirect-metadata')).toBe('preserved');
      expect(response?.headers.get('location')).toBeNull();
    },
  );

  it.each([
    ['304 response', 304, { Location: '/cached' }],
    ['missing target', 302, {}],
    ['malformed target', 302, { Location: 'http://[::1' }],
  ])(
    'does not let the RSC transform manufacture navigation for a %s',
    async (_, status, headers) => {
      const [{ createLoaderRedirectResponse }, { handleRSCRedirect }] =
        await Promise.all([
          import('../../../src/core/server/requestHandler'),
          import('../../../src/router/runtime/redirect'),
        ]);
      const transformed = handleRSCRedirect(new Headers(headers), '/', status);

      expect(transformed.headers.get('x-modernjs-redirect')).toBeNull();
      expect(
        createLoaderRedirectResponse(transformed, redirectCtx),
      ).toBeUndefined();
    },
  );
});

describe('finalizeRenderResponse', () => {
  it.each([
    {
      label: '204 null-body status',
      proxy: { status: 204, headers: {} },
      context: redirectCtx,
    },
    {
      label: '205 null-body status',
      proxy: { status: 205, headers: {} },
      context: redirectCtx,
    },
    {
      label: '304 null-body status',
      proxy: { status: 304, headers: {} },
      context: redirectCtx,
    },
    {
      label: 'navigation redirect',
      proxy: { status: 307, headers: { Location: '/app/orders' } },
      context: redirectCtx,
    },
    {
      label: 'RSC redirect',
      proxy: { status: 308, headers: { Location: '/app/orders' } },
      context: { enableRsc: true, isRSCNavigation: true, basename: '/app' },
    },
  ])(
    'finishes request resources when discarded-body cancellation rejects for $label',
    async ({ proxy, context }) => {
      const { finalizeRenderResponse, REQUEST_END_ERROR } = await import(
        '../../../src/core/server/requestHandler'
      );
      const failure = new Error('source cancellation failed');
      const disposalFailure = new Error('resource disposal failed');
      const events: unknown[] = [];
      const errors: unknown[][] = [];
      let releaseCancel = () => {};
      let reportCancelStarted = () => {};
      const cancelStarted = new Promise<void>(resolve => {
        reportCancelStarted = resolve;
      });
      const cancelReleased = new Promise<void>(resolve => {
        releaseCancel = resolve;
      });
      const lifecycle = createRequestLifecycle(
        terminal => {
          events.push(terminal);
          throw disposalFailure;
        },
        (...args: unknown[]) => {
          errors.push(args);
        },
      );
      const original = new Response(
        new ReadableStream<Uint8Array>({
          async cancel() {
            events.push('cancel:start');
            reportCancelStarted();
            await cancelReleased;
            events.push('cancel:reject');
            throw failure;
          },
        }),
      );

      const finalizing = finishWithRequestLifecycle(lifecycle, () =>
        finalizeRenderResponse(original, proxy, context, lifecycle),
      );
      await cancelStarted;
      expect(events).toEqual(['cancel:start']);
      expect(errors).toEqual([]);

      releaseCancel();
      await expect(finalizing).rejects.toBe(failure);
      await lifecycle.run();
      expect(events).toEqual([
        'cancel:start',
        'cancel:reject',
        { status: 'error', error: failure },
      ]);
      expect(errors).toEqual([[disposalFailure, REQUEST_END_ERROR]]);
      const reader = original.body!.getReader();
      await expect(reader.read()).resolves.toEqual({
        done: true,
        value: undefined,
      });
      reader.releaseLock();
    },
  );

  it.each([
    {
      label: 'invalid response header',
      proxy: { status: -1, headers: { 'bad header': 'value' } },
      cancellationRejects: false,
    },
    {
      label: 'invalid response status',
      proxy: { status: 99, headers: {} },
      cancellationRejects: false,
    },
    {
      label: 'invalid response header with failed cancellation',
      proxy: { status: -1, headers: { 'bad header': 'value' } },
      cancellationRejects: true,
    },
    {
      label: 'invalid response status with failed cancellation',
      proxy: { status: 99, headers: {} },
      cancellationRejects: true,
    },
  ])(
    'cancels the render body before reporting $label failure',
    async ({ proxy, cancellationRejects }) => {
      const {
        finalizeRenderResponse,
        REQUEST_END_ERROR,
        RESPONSE_BODY_CANCEL_ERROR,
      } = await import('../../../src/core/server/requestHandler');
      const cancellationFailure = new Error('source cancellation failed');
      const disposalFailure = new Error('resource disposal failed');
      const events: unknown[] = [];
      const errors: unknown[][] = [];
      let disposalCalls = 0;
      let releaseCancel = () => {};
      let reportCancelStarted = () => {};
      const cancelStarted = new Promise<void>(resolve => {
        reportCancelStarted = resolve;
      });
      const cancelReleased = new Promise<void>(resolve => {
        releaseCancel = resolve;
      });
      const lifecycle = createRequestLifecycle(
        terminal => {
          events.push(terminal);
          disposalCalls += 1;
          throw disposalFailure;
        },
        (...args: unknown[]) => {
          errors.push(args);
        },
      );
      const original = new Response(
        new ReadableStream<Uint8Array>({
          async cancel() {
            events.push('cancel:start');
            reportCancelStarted();
            await cancelReleased;
            events.push(cancellationRejects ? 'cancel:reject' : 'cancel:done');
            if (cancellationRejects) throw cancellationFailure;
          },
        }),
      );

      const finalizing = finishWithRequestLifecycle(lifecycle, () =>
        finalizeRenderResponse(original, proxy, redirectCtx, lifecycle),
      );
      await cancelStarted;
      expect(events).toEqual(['cancel:start']);
      expect(errors).toEqual([]);
      expect(disposalCalls).toBe(0);

      releaseCancel();
      const failure = await finalizing.then(
        () => {
          throw new Error('Expected response finalization to fail');
        },
        error => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBe(cancellationFailure);
      expect(failure).not.toBe(disposalFailure);
      await lifecycle.run();
      expect(events).toEqual([
        'cancel:start',
        cancellationRejects ? 'cancel:reject' : 'cancel:done',
        { status: 'error', error: failure },
      ]);
      expect(disposalCalls).toBe(1);
      expect(errors).toEqual([
        [disposalFailure, REQUEST_END_ERROR],
        ...(cancellationRejects
          ? [[cancellationFailure, RESPONSE_BODY_CANCEL_ERROR]]
          : []),
      ]);
    },
  );

  it('preserves the renderer status and merges response headers when no status is set', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestHandler'
    );
    const original = new Response('native renderer', {
      status: 201,
      headers: { 'x-renderer': 'kept', 'x-shared': 'renderer' },
    });
    const response = await finalizeRenderResponse(
      original,
      { status: -1, headers: { 'x-shared': 'application' } },
      redirectCtx,
      createNoopRequestLifecycle(),
    );

    expect(response).toBe(original);
    expect(response.status).toBe(201);
    expect(response.headers.get('x-renderer')).toBe('kept');
    expect(response.headers.get('x-shared')).toBe('application');
    await expect(response.text()).resolves.toBe('native renderer');
  });

  it('preserves rendered data while applying a loader error status', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestHandler'
    );
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );
    const response = await finishWithRequestLifecycle(lifecycle, () =>
      finalizeRenderResponse(
        new Response('error boundary', { headers: { 'x-renderer': 'kept' } }),
        { status: 418, headers: { 'x-loader': 'kept' } },
        redirectCtx,
        lifecycle,
      ),
    );

    expect(response.status).toBe(418);
    expect(response.headers.get('x-renderer')).toBe('kept');
    expect(response.headers.get('x-loader')).toBe('kept');
    expect(terminals).toEqual([]);
    await expect(response.text()).resolves.toBe('error boundary');
    expect(terminals).toEqual([{ status: 'complete' }]);
  });

  it('discards rendered output for an RSC redirect and preserves its native status', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestHandler'
    );
    const events: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        events.push(terminal);
      },
      () => {},
    );
    const original = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          events.push('cancel');
        },
      }),
    );
    const response = await finishWithRequestLifecycle(lifecycle, () =>
      finalizeRenderResponse(
        original,
        {
          status: 308,
          headers: {
            Location: '/app/orders',
            'content-length': '999',
            'transfer-encoding': 'chunked',
            'x-redirect-metadata': 'kept',
          },
        },
        { enableRsc: true, isRSCNavigation: true, basename: '/app' },
        lifecycle,
      ),
    );

    expect(response.status).toBe(308);
    expect(response.body).toBeNull();
    expect(response.headers.get('x-modernjs-redirect')).toBe('/orders');
    expect(response.headers.get('x-redirect-metadata')).toBe('kept');
    expect(response.headers.has('location')).toBe(false);
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('transfer-encoding')).toBe(false);
    expect(events).toEqual(['cancel', { status: 'discarded' }]);
  });

  it('recognizes a lowercase Location header without changing redirect status', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestHandler'
    );
    const finalized = await finalizeRenderResponse(
      new Response('<html>discarded</html>'),
      {
        status: 307,
        headers: { location: '/cs/objednavky' },
      },
      redirectCtx,
      createNoopRequestLifecycle(),
    );

    expect(finalized.status).toBe(307);
    expect(finalized.headers.get('location')).toBe('/cs/objednavky');
    expect(finalized.body).toBeNull();
  });

  it('does not discard rendered output for a malformed redirect target', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestHandler'
    );
    const finalized = await finalizeRenderResponse(
      new Response('<html>kept</html>'),
      {
        status: 302,
        headers: { Location: 'http://[::1' },
      },
      redirectCtx,
      createNoopRequestLifecycle(),
    );

    expect(finalized.status).toBe(302);
    await expect(finalized.text()).resolves.toBe('<html>kept</html>');
  });

  it.each([
    { status: 204, headers: {} },
    { status: 205, headers: {} },
    { status: 304, headers: {} },
  ])(
    'cancels the discarded source before request completion for status $status',
    async ({ status, headers }) => {
      const { finalizeRenderResponse } = await import(
        '../../../src/core/server/requestHandler'
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
      const lifecycle = createRequestLifecycle(
        () => {
          events.push('cleanup');
        },
        () => {},
      );
      const response = new Response(body, {
        status: 200,
        headers: {
          'content-length': '123',
          'transfer-encoding': 'chunked',
        },
      });

      const finalizing = finishWithRequestLifecycle(lifecycle, () =>
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
          lifecycle,
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
    },
  );

  it('fails closed without request completion when a discarded body has another owner', async () => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestHandler'
    );
    const events: string[] = [];
    const lifecycle = createRequestLifecycle(
      () => {
        events.push('cleanup');
      },
      () => {},
    );
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          events.push(`source-cancel:${String(reason)}`);
        },
      }),
    );
    const owner = response.body!.getReader();

    const finalizing = finishWithRequestLifecycle(lifecycle, () =>
      finalizeRenderResponse(
        response,
        createResponseProxy(204),
        redirectCtx,
        lifecycle,
      ),
    );

    await expect(finalizing).rejects.toThrow(
      'Cannot discard a locked response body before request completion',
    );
    expect(events).toEqual([]);
    expect(response.body!.locked).toBe(true);

    await owner.cancel('owner finished');
    owner.releaseLock();
    await lifecycle.run();
    expect(events).toEqual(['source-cancel:owner finished', 'cleanup']);
  });

  it.each([-1, 418])(
    'preserves another reader ownership when finalizing status %s',
    async status => {
      const { finalizeRenderResponse } = await import(
        '../../../src/core/server/requestHandler'
      );
      const events: unknown[] = [];
      const lifecycle = createRequestLifecycle(
        terminal => {
          events.push(terminal);
        },
        () => {},
      );
      const original = new Response(
        new ReadableStream<Uint8Array>({
          cancel(reason) {
            events.push(reason);
          },
        }),
      );
      const owner = original.body!.getReader();

      await expect(
        finishWithRequestLifecycle(lifecycle, () =>
          finalizeRenderResponse(
            original,
            createResponseProxy(status),
            redirectCtx,
            lifecycle,
          ),
        ),
      ).rejects.toThrow(
        'Cannot observe a locked response body before request completion',
      );
      expect(lifecycle.deferred).toBe(true);
      expect(events).toEqual([]);
      expect(original.body!.locked).toBe(true);

      await owner.cancel('owner finished');
      owner.releaseLock();
      await lifecycle.run();

      expect(events).toEqual(['owner finished', { status: 'complete' }]);
    },
  );
});
