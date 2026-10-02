import { initHooks, type SSRRequestTerminal } from '@modern-js/plugin/runtime';
import type { RequestHandlerOptions } from '@modern-js/server-core';
import React from 'react';
import {
  setGlobalContext,
  setGlobalInternalRuntimeContext,
  type TInternalRuntimeContext,
} from '../../../src/core/context';
import { SSRErrors } from '../../../src/core/server/tracer';

(
  globalThis as typeof globalThis & {
    __webpack_require__?: { u: (chunkId: unknown) => string };
  }
).__webpack_require__ = {
  u: chunkId => String(chunkId),
};

const installRuntime = (
  configure: (
    hooks: ReturnType<typeof initHooks<{}, TInternalRuntimeContext>>,
  ) => void = () => {},
) => {
  setGlobalContext({
    entryName: 'main',
    App: () => React.createElement('div', null, 'app'),
    enableRsc: false,
  });
  const hooks = initHooks<{}, TInternalRuntimeContext>();
  hooks.wrapRoot.tap(App => App);
  configure(hooks);
  setGlobalInternalRuntimeContext({ hooks } as any);
};

const requestOptions = (
  onError: RequestHandlerOptions['onError'] = () => {},
): RequestHandlerOptions => ({
  resource: {
    entryName: 'main',
    route: { urlPath: '/' },
    htmlTemplate: '<html><head></head><body></body></html>',
  } as any,
  config: { ssr: true } as any,
  params: {},
  reporter: undefined,
  monitors: undefined,
  locals: {},
  loaderContext: {},
  onTiming: () => {},
  onError,
});

describe('createRequestHandler native request hooks', () => {
  it('preserves native routerContext loader status and errors', async () => {
    const failure = new Error('loader failed');
    const errors: unknown[][] = [];
    const terminals: SSRRequestTerminal[] = [];
    let preparedContext: TInternalRuntimeContext | undefined;
    let endedContext: TInternalRuntimeContext | undefined;
    installRuntime(hooks => {
      hooks.onBeforeRender.tap(context => {
        context.routerContext = {
          statusCode: 418,
          errors: { root: failure },
        } as any;
      });
      hooks.onRenderPrepared.tap(info => {
        preparedContext = info.runtimeContext;
        expect(info.routerResult).toEqual({
          statusCode: 418,
          errors: { root: failure },
        });
        return info;
      });
      hooks.onRequestEnd.tap(info => {
        endedContext = info.runtimeContext;
        terminals.push(info.terminal);
      });
    });
    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(
      async () => new Response('error boundary'),
    );

    const response = await handler(
      new Request('http://localhost/'),
      requestOptions((...args: unknown[]) => {
        errors.push(args);
      }),
    );

    expect(response.status).toBe(418);
    expect(errors).toEqual([[failure, SSRErrors.LOADER_ERROR]]);
    await expect(response.text()).resolves.toBe('error boundary');
    expect(terminals).toEqual([{ status: 'complete' }]);
    expect(endedContext).toBe(preparedContext);
  });

  it('lets a native plugin replace router preparation through the waterfall hook', async () => {
    const failure = new Error('custom loader failed');
    const errors: unknown[][] = [];
    const preparedStatuses: (number | undefined)[] = [];
    installRuntime(hooks => {
      hooks.onBeforeRender.tap(context => {
        context.routerContext = { statusCode: 404 } as any;
      });
      hooks.onRenderPrepared.tap(info => ({
        ...info,
        routerResult: { statusCode: 418, errors: { root: failure } },
      }));
      hooks.onRenderPrepared.tap(info => {
        preparedStatuses.push(info.routerResult?.statusCode);
        info.runtimeContext.ssrContext?.response.setHeader('x-prepared', 'yes');
        return info;
      });
    });
    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(async () => new Response('ok'));

    const response = await handler(
      new Request('http://localhost/'),
      requestOptions((...args: unknown[]) => {
        errors.push(args);
      }),
    );

    expect(preparedStatuses).toEqual([418]);
    expect(response.status).toBe(418);
    expect(response.headers.get('x-prepared')).toBe('yes');
    expect(errors).toEqual([[failure, SSRErrors.LOADER_ERROR]]);
    await expect(response.text()).resolves.toBe('ok');
  });

  it.each([false, true])(
    'works with no request hook registrations (RSC=%s)',
    async enableRsc => {
      installRuntime();
      const { createRequestHandler } = await import(
        '../../../src/core/server/requestHandler'
      );
      const handler = await createRequestHandler(
        async () =>
          new Response('native renderer', {
            status: 201,
            headers: { 'x-renderer': 'kept' },
          }),
        { enableRsc },
      );

      const response = await handler(
        new Request('http://localhost/'),
        requestOptions(),
      );

      expect(response.status).toBe(201);
      expect(response.headers.get('x-renderer')).toBe('kept');
      await expect(response.text()).resolves.toBe('native renderer');
    },
  );

  it('waits for a streamed render to finish before calling onRequestEnd', async () => {
    const terminals: SSRRequestTerminal[] = [];
    installRuntime(hooks => {
      hooks.onRequestEnd.tap(info => {
        terminals.push(info.terminal);
      });
    });
    const encoder = new TextEncoder();
    let releaseTail = () => {};
    const tailReleased = new Promise<void>(resolve => {
      releaseTail = resolve;
    });
    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('<shell>'));
            },
            async pull(controller) {
              await tailReleased;
              controller.enqueue(encoder.encode('<deferred-tail>'));
              controller.close();
            },
          }),
        ),
    );

    const response = await handler(
      new Request('http://localhost/'),
      requestOptions(),
    );
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      '<shell>',
    );
    expect(terminals).toEqual([]);

    releaseTail();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      '<deferred-tail>',
    );
    expect((await reader.read()).done).toBe(true);
    expect(terminals).toEqual([{ status: 'complete' }]);
  });

  it('reports a renderer failure exactly once and preserves the failure', async () => {
    const failure = new Error('render failed');
    const terminals: SSRRequestTerminal[] = [];
    installRuntime(hooks => {
      hooks.onRequestEnd.tap(info => {
        terminals.push(info.terminal);
      });
    });
    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(async () => {
      throw failure;
    });

    await expect(
      handler(new Request('http://localhost/'), requestOptions()),
    ).rejects.toBe(failure);

    expect(terminals).toEqual([{ status: 'error', error: failure }]);
  });

  it('reports a preparation hook failure before starting the renderer', async () => {
    const failure = new Error('prepare failed');
    const terminals: SSRRequestTerminal[] = [];
    let renders = 0;
    installRuntime(hooks => {
      hooks.onRenderPrepared.tap(() => {
        throw failure;
      });
      hooks.onRequestEnd.tap(info => {
        terminals.push(info.terminal);
      });
    });
    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(async () => {
      renders += 1;
      return new Response('unexpected');
    });

    await expect(
      handler(new Request('http://localhost/'), requestOptions()),
    ).rejects.toBe(failure);

    expect(renders).toBe(0);
    expect(terminals).toEqual([{ status: 'error', error: failure }]);
  });

  it('reports a streamed render failure through onRequestEnd', async () => {
    const failure = new Error('stream failed');
    const terminals: SSRRequestTerminal[] = [];
    installRuntime(hooks => {
      hooks.onRequestEnd.tap(info => {
        terminals.push(info.terminal);
      });
    });
    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(failure);
            },
          }),
        ),
    );

    const response = await handler(
      new Request('http://localhost/'),
      requestOptions(),
    );
    await expect(response.text()).rejects.toBe(failure);

    expect(terminals).toEqual([{ status: 'error', error: failure }]);
  });

  it('reports stream cancellation through onRequestEnd', async () => {
    const terminals: SSRRequestTerminal[] = [];
    const cancelled: unknown[] = [];
    installRuntime(hooks => {
      hooks.onRequestEnd.tap(info => {
        terminals.push(info.terminal);
      });
    });
    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel(reason) {
              cancelled.push(reason);
            },
          }),
        ),
    );

    const response = await handler(
      new Request('http://localhost/'),
      requestOptions(),
    );
    await response.body!.cancel('client disconnected');

    expect(cancelled).toEqual(['client disconnected']);
    expect(terminals).toEqual([
      { status: 'cancelled', reason: 'client disconnected' },
    ]);
  });

  it.each([false, true])(
    'cancels a loader redirect body before ending the request (RSC=%s)',
    async enableRsc => {
      const events: unknown[] = [];
      let renders = 0;
      let releaseCancel = () => {};
      let reportCancelStarted = () => {};
      const cancelStarted = new Promise<void>(resolve => {
        reportCancelStarted = resolve;
      });
      const cancelReleased = new Promise<void>(resolve => {
        releaseCancel = resolve;
      });
      installRuntime(hooks => {
        hooks.onBeforeRender.tap((_, interrupt) => {
          interrupt(
            new Response(
              new ReadableStream<Uint8Array>({
                async cancel() {
                  events.push('cancel:start');
                  reportCancelStarted();
                  await cancelReleased;
                  events.push('cancel:done');
                },
              }),
              { status: 307, headers: { location: '/orders' } },
            ),
          );
        });
        hooks.onRequestEnd.tap(info => {
          events.push(info.terminal);
        });
      });
      const { createRequestHandler } = await import(
        '../../../src/core/server/requestHandler'
      );
      const handler = await createRequestHandler(
        async () => {
          renders += 1;
          return new Response('unexpected');
        },
        { enableRsc },
      );

      const handling = handler(
        new Request('http://localhost/', {
          headers: enableRsc ? { 'x-rsc-tree': 'true' } : {},
        }),
        requestOptions(),
      );
      await cancelStarted;
      expect(events).toEqual(['cancel:start']);
      expect(renders).toBe(0);

      releaseCancel();
      const response = await handling;
      expect(response.status).toBe(307);
      expect(response.body).toBeNull();
      expect(
        response.headers.get(enableRsc ? 'x-modernjs-redirect' : 'location'),
      ).toBe('/orders');
      expect(events).toEqual([
        'cancel:start',
        'cancel:done',
        { status: 'discarded' },
      ]);
      expect(renders).toBe(0);
    },
  );

  it('completes a bodyless loader redirect without starting the renderer', async () => {
    const terminals: SSRRequestTerminal[] = [];
    let renders = 0;
    installRuntime(hooks => {
      hooks.onBeforeRender.tap((_, interrupt) => {
        interrupt(
          new Response(null, { status: 302, headers: { Location: '/login' } }),
        );
      });
      hooks.onRequestEnd.tap(info => {
        terminals.push(info.terminal);
      });
    });
    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(async () => {
      renders += 1;
      return new Response('unexpected');
    });

    const response = await handler(
      new Request('http://localhost/'),
      requestOptions(),
    );

    expect(response.status).toBe(302);
    expect(response.body).toBeNull();
    expect(response.headers.get('location')).toBe('/login');
    expect(terminals).toEqual([{ status: 'complete' }]);
    expect(renders).toBe(0);
  });

  it.each(['loader redirect', 'null-body render'])(
    'ends request resources when %s body cancellation rejects',
    async scenario => {
      const failure = new Error('source cancellation failed');
      const disposalFailure = new Error('resource disposal failed');
      const events: unknown[] = [];
      const errors: unknown[][] = [];
      let cleanupCalls = 0;
      let disposalCalls = 0;
      let renders = 0;
      let releaseCancel = () => {};
      let reportCancelStarted = () => {};
      const cancelStarted = new Promise<void>(resolve => {
        reportCancelStarted = resolve;
      });
      const cancelReleased = new Promise<void>(resolve => {
        releaseCancel = resolve;
      });
      const source = new ReadableStream<Uint8Array>({
        async cancel() {
          events.push('cancel:start');
          reportCancelStarted();
          await cancelReleased;
          events.push('cancel:reject');
          throw failure;
        },
      });
      installRuntime(hooks => {
        if (scenario === 'loader redirect') {
          hooks.onBeforeRender.tap((_, interrupt) => {
            interrupt(
              new Response(source, {
                status: 307,
                headers: { Location: '/orders' },
              }),
            );
          });
        } else {
          hooks.onRenderPrepared.tap(info => ({
            ...info,
            routerResult: { statusCode: 204 },
          }));
        }
        hooks.onRequestEnd.tap(info => {
          cleanupCalls += 1;
          events.push(info.terminal);
        });
        hooks.onRequestEnd.tap(() => {
          disposalCalls += 1;
          throw disposalFailure;
        });
      });
      const { createRequestHandler, REQUEST_END_ERROR } = await import(
        '../../../src/core/server/requestHandler'
      );
      const handler = await createRequestHandler(async () => {
        renders += 1;
        return new Response(source);
      });

      const handling = handler(
        new Request('http://localhost/'),
        requestOptions((...args: unknown[]) => {
          errors.push(args);
        }),
      );
      await cancelStarted;
      expect(events).toEqual(['cancel:start']);
      expect(cleanupCalls).toBe(0);
      expect(disposalCalls).toBe(0);
      expect(errors).toEqual([]);

      releaseCancel();
      await expect(handling).rejects.toBe(failure);
      expect(events).toEqual([
        'cancel:start',
        'cancel:reject',
        { status: 'error', error: failure },
      ]);
      expect(cleanupCalls).toBe(1);
      expect(disposalCalls).toBe(1);
      expect(errors).toEqual([[disposalFailure, REQUEST_END_ERROR]]);
      expect(renders).toBe(scenario === 'loader redirect' ? 0 : 1);
    },
  );

  it('keeps an already transformed RSC redirect body until it completes', async () => {
    const terminals: SSRRequestTerminal[] = [];
    let renders = 0;
    installRuntime(hooks => {
      hooks.onBeforeRender.tap((_, interrupt) => {
        interrupt(
          new Response('flight redirect', {
            status: 308,
            headers: { 'x-modernjs-redirect': '/orders' },
          }),
        );
      });
      hooks.onRequestEnd.tap(info => {
        terminals.push(info.terminal);
      });
    });
    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(
      async () => {
        renders += 1;
        return new Response('unexpected');
      },
      { enableRsc: true },
    );

    const response = await handler(
      new Request('http://localhost/', {
        headers: { 'x-rsc-tree': 'true' },
      }),
      requestOptions(),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get('x-modernjs-redirect')).toBe('/orders');
    expect(terminals).toEqual([]);
    await expect(response.text()).resolves.toBe('flight redirect');
    expect(terminals).toEqual([{ status: 'complete' }]);
    expect(renders).toBe(0);
  });

  it.each([204, 205, 304])(
    'discards the render body before onRequestEnd for status %s',
    async status => {
      const events: unknown[] = [];
      installRuntime(hooks => {
        hooks.onRenderPrepared.tap(info => ({
          ...info,
          routerResult: { statusCode: status },
        }));
        hooks.onRequestEnd.tap(info => {
          events.push(info.terminal);
        });
      });
      const { createRequestHandler } = await import(
        '../../../src/core/server/requestHandler'
      );
      const handler = await createRequestHandler(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                events.push('cancel');
              },
            }),
            {
              headers: {
                'content-length': '123',
                'transfer-encoding': 'chunked',
              },
            },
          ),
      );

      const response = await handler(
        new Request('http://localhost/'),
        requestOptions(),
      );

      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(response.headers.has('content-length')).toBe(false);
      expect(response.headers.has('transfer-encoding')).toBe(false);
      expect(events).toEqual(['cancel', { status: 'discarded' }]);
    },
  );

  it('runs every end observer when another observer throws', async () => {
    const failure = new Error('first observer failed');
    const events: string[] = [];
    const errors: unknown[][] = [];
    let releaseEnd = () => {};
    let reportEndStarted = () => {};
    const endStarted = new Promise<void>(resolve => {
      reportEndStarted = resolve;
    });
    const endReleased = new Promise<void>(resolve => {
      releaseEnd = resolve;
    });
    installRuntime(hooks => {
      hooks.onRequestEnd.tap(() => {
        events.push('first');
        throw failure;
      });
      hooks.onRequestEnd.tap(async () => {
        events.push('second:start');
        reportEndStarted();
        await endReleased;
        events.push('second:done');
      });
    });
    const { createRequestHandler, REQUEST_END_ERROR } = await import(
      '../../../src/core/server/requestHandler'
    );
    const handler = await createRequestHandler(async () => new Response('ok'));

    const response = await handler(
      new Request('http://localhost/'),
      requestOptions((...args: unknown[]) => {
        errors.push(args);
      }),
    );
    const reading = response.text();
    await endStarted;
    expect(events).toEqual(['first', 'second:start']);
    expect(errors).toEqual([]);

    releaseEnd();
    await expect(reading).resolves.toBe('ok');
    expect(events).toEqual(['first', 'second:start', 'second:done']);
    expect(errors).toEqual([[failure, REQUEST_END_ERROR]]);
  });
});
