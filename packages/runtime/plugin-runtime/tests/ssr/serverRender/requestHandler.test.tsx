import React from 'react';
import {
  applyRouterRuntimeState,
  setGlobalContext,
  setGlobalInternalRuntimeContext,
} from '../../../src/core/context';
import { ROUTER_CLEANUP_ERROR } from '../../../src/core/server/routerCleanup';
import { SSRErrors } from '../../../src/core/server/tracer';

describe('createRequestHandler router snapshot fallback', () => {
  it('should honor loader status and errors from routerServerSnapshot when routerContext is absent', async () => {
    const onErrorCalls: unknown[][] = [];
    const onError = (...args: unknown[]) => {
      onErrorCalls.push(args);
    };
    (
      globalThis as typeof globalThis & {
        __webpack_require__?: { u: (chunkId: unknown) => string };
      }
    ).__webpack_require__ = {
      u: chunkId => String(chunkId),
    };

    setGlobalContext({
      entryName: 'main',
      App: () => React.createElement('div', null, 'app'),
      enableRsc: false,
    });
    setGlobalInternalRuntimeContext({
      hooks: {
        wrapRoot: {
          call: (App: React.ComponentType) => App,
        },
        onBeforeRender: {
          call: async (context: any) => {
            applyRouterRuntimeState(context, {
              framework: 'custom-router',
              serverSnapshot: {
                statusCode: 418,
                errors: {
                  root: new Error('loader failed'),
                },
              },
            });
          },
        },
      },
    } as any);

    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const requestHandler = await createRequestHandler(async () => {
      return new Response('ok', { status: 200 });
    });

    const response = await requestHandler(new Request('http://localhost/'), {
      resource: {
        entryName: 'main',
        route: {
          urlPath: '/',
        },
        htmlTemplate: '<html><head></head><body></body></html>',
      } as any,
      config: {
        ssr: true,
      } as any,
      params: {},
      reporter: undefined,
      monitors: undefined,
      locals: {},
      loaderContext: {},
      onTiming: () => {},
      onError,
    } as any);

    expect(response.status).toBe(418);
    expect(onErrorCalls).toHaveLength(1);
    expect(onErrorCalls[0]?.[1]).toBe(SSRErrors.LOADER_ERROR);
  });

  it('should defer generic router cleanup until the response body finishes', async () => {
    let cleaned = false;

    setGlobalContext({
      entryName: 'main',
      App: () => React.createElement('div', null, 'app'),
      enableRsc: false,
    });
    setGlobalInternalRuntimeContext({
      hooks: {
        wrapRoot: {
          call: (App: React.ComponentType) => App,
        },
        onBeforeRender: {
          call: async (context: any) => {
            applyRouterRuntimeState(context, {
              framework: 'custom-router',
              cleanup: () => {
                cleaned = true;
              },
            });
          },
        },
      },
    } as any);

    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const requestHandler = await createRequestHandler(async () => {
      return new Response('ok', { status: 200 });
    });

    const response = await requestHandler(new Request('http://localhost/'), {
      resource: {
        entryName: 'main',
        route: {
          urlPath: '/',
        },
        htmlTemplate: '<html><head></head><body></body></html>',
      } as any,
      config: {
        ssr: true,
      } as any,
      params: {},
      reporter: undefined,
      monitors: undefined,
      locals: {},
      loaderContext: {},
      onTiming: () => {},
      onError: () => {},
    } as any);

    expect(response.status).toBe(200);
    // The body may still be streaming when the Response is returned, so the
    // cleanup must not have run yet.
    expect(cleaned).toBe(false);
    await response.text();
    expect(cleaned).toBe(true);
  });

  it('should not clean up router state while a streamed body is still rendering', async () => {
    let cleaned = false;

    setGlobalContext({
      entryName: 'main',
      App: () => React.createElement('div', null, 'app'),
      enableRsc: false,
    });
    setGlobalInternalRuntimeContext({
      hooks: {
        wrapRoot: {
          call: (App: React.ComponentType) => App,
        },
        onBeforeRender: {
          call: async (context: any) => {
            applyRouterRuntimeState(context, {
              framework: 'custom-router',
              cleanup: () => {
                cleaned = true;
              },
            });
          },
        },
      },
    } as any);

    const encoder = new TextEncoder();
    let releaseTail = () => {};
    const tailReleased = new Promise<void>(resolve => {
      releaseTail = resolve;
    });

    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    // Emulates streaming SSR: the Response is returned at shell-ready while
    // the rest of the body keeps rendering.
    const requestHandler = await createRequestHandler(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('<shell>'));
        },
        async pull(controller) {
          await tailReleased;
          controller.enqueue(encoder.encode('<deferred-tail>'));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });

    const response = await requestHandler(new Request('http://localhost/'), {
      resource: {
        entryName: 'main',
        route: {
          urlPath: '/',
        },
        htmlTemplate: '<html><head></head><body></body></html>',
      } as any,
      config: {
        ssr: true,
      } as any,
      params: {},
      reporter: undefined,
      monitors: undefined,
      locals: {},
      loaderContext: {},
      onTiming: () => {},
      onError: () => {},
    } as any);

    expect(response.status).toBe(200);
    expect(cleaned).toBe(false);

    const reader = response.body!.getReader();
    const shell = await reader.read();
    expect(new TextDecoder().decode(shell.value)).toBe('<shell>');
    expect(cleaned).toBe(false);

    releaseTail();
    const tail = await reader.read();
    expect(new TextDecoder().decode(tail.value)).toBe('<deferred-tail>');
    const done = await reader.read();
    expect(done.done).toBe(true);
    expect(cleaned).toBe(true);
  });

  it('should report router cleanup failures through onError', async () => {
    const failure = new Error('cleanup failed');
    const onErrorCalls: unknown[][] = [];

    setGlobalContext({
      entryName: 'main',
      App: () => React.createElement('div', null, 'app'),
      enableRsc: false,
    });
    setGlobalInternalRuntimeContext({
      hooks: {
        wrapRoot: {
          call: (App: React.ComponentType) => App,
        },
        onBeforeRender: {
          call: async (context: any) => {
            applyRouterRuntimeState(context, {
              framework: 'custom-router',
              cleanup: () => {
                throw failure;
              },
            });
          },
        },
      },
    } as any);

    const { createRequestHandler } = await import(
      '../../../src/core/server/requestHandler'
    );
    const requestHandler = await createRequestHandler(async () => {
      return new Response('ok', { status: 200 });
    });

    const response = await requestHandler(new Request('http://localhost/'), {
      resource: {
        entryName: 'main',
        route: {
          urlPath: '/',
        },
        htmlTemplate: '<html><head></head><body></body></html>',
      } as any,
      config: {
        ssr: true,
      } as any,
      params: {},
      reporter: undefined,
      monitors: undefined,
      locals: {},
      loaderContext: {},
      onTiming: () => {},
      onError: (...args: unknown[]) => {
        onErrorCalls.push(args);
      },
    } as any);

    await response.text();

    expect(onErrorCalls).toHaveLength(1);
    expect(onErrorCalls[0]?.[0]).toBe(failure);
    expect(onErrorCalls[0]?.[1]).toBe(ROUTER_CLEANUP_ERROR);
  });
});
