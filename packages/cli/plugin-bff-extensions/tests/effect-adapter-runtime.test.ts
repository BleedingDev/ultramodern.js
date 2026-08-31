import {
  type EffectContext,
  useEffectContext,
} from '@modern-js/bff-effect/effect';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { describe, expect, test } from '@rstest/core';

import { EffectAdapter } from '../src/effect-adapter';

type Middleware = {
  before?: string[];
  handler: (context: unknown, next: () => Promise<void>) => Promise<unknown>;
  path: string;
};

type DisposableHandler = ((
  request: Request,
  context?: EffectContext,
) => Promise<Response> | Response) & {
  dispose: () => Promise<void>;
};

const createDisposableHandler = (
  body: (request: Request, context: EffectContext) => unknown,
  onDispose: () => void = () => {},
): DisposableHandler => {
  const handler = (async (request: Request, context?: EffectContext) =>
    Response.json(body(request, context!))) as DisposableHandler;
  handler.dispose = async () => onDispose();
  return handler;
};

describe('EffectAdapter runtime ownership', () => {
  test('dispatches through the public Effect surface with mounted context', async () => {
    const middlewares: Middleware[] = [];
    const api = {
      getServerContext: () => ({
        bffRuntimeFramework: 'effect',
        middlewares,
      }),
      getServerConfig: () => ({}),
    } as unknown as ServerPluginAPI;
    const adapter = new EffectAdapter(api);
    const adapterState = adapter as unknown as {
      handler: DisposableHandler;
      reloadHandler: () => Promise<void>;
    };
    adapterState.reloadHandler = async () => {
      adapterState.handler = createDisposableHandler((request, context) => {
        const stored = useEffectContext();
        return {
          requestPath: new URL(request.url).pathname,
          explicitPath: new URL(context.request.url).pathname,
          storedPath: new URL(stored.request.url).pathname,
          middlewarePath: context.path,
          method: context.method,
          binding: context.env.binding,
        };
      });
    };

    await adapter.registerMiddleware({ prefix: '/api' });
    expect(middlewares).toHaveLength(1);
    expect(middlewares[0]?.path).toBe('/api/*');
    expect(middlewares[0]?.before).toEqual([
      'custom-server-hook',
      'custom-server-middleware',
      'render',
    ]);

    const response = (await middlewares[0]!.handler(
      {
        env: { binding: 'edge-compatible' },
        req: {
          method: 'POST',
          path: '/api/orders',
          raw: new Request('https://example.com/api/orders', {
            method: 'POST',
          }),
        },
      },
      async () => {},
    )) as Response;

    await expect(response.json()).resolves.toEqual({
      requestPath: '/orders',
      explicitPath: '/orders',
      storedPath: '/orders',
      middlewarePath: '/api/orders',
      method: 'POST',
      binding: 'edge-compatible',
    });
  });

  test('retires replaced and stale handlers without disposing the active one early', async () => {
    const disposed: string[] = [];
    const adapter = new EffectAdapter({} as ServerPluginAPI);
    const state = adapter as unknown as {
      handler: DisposableHandler | null;
      reloadGeneration: number;
      installHandler: (
        generation: number,
        candidate: DisposableHandler,
      ) => Promise<void>;
    };
    const first = createDisposableHandler(
      () => 'first',
      () => {
        disposed.push('first');
      },
    );
    const second = createDisposableHandler(
      () => 'second',
      () => {
        disposed.push('second');
      },
    );
    const stale = createDisposableHandler(
      () => 'stale',
      () => {
        disposed.push('stale');
      },
    );

    state.reloadGeneration = 1;
    await state.installHandler(1, first);
    state.reloadGeneration = 2;
    await state.installHandler(2, second);
    expect(disposed).toEqual(['first']);
    expect(state.handler).toBe(second);

    await state.installHandler(1, stale);
    expect(disposed).toEqual(['first', 'stale']);
    expect(state.handler).toBe(second);

    await adapter.dispose();
    await adapter.dispose();
    expect(disposed).toEqual(['first', 'stale', 'second']);
  });

  test('falls through missing and 404 handlers only for web middleware', async () => {
    const middlewares: Middleware[] = [];
    let nextCalls = 0;
    const api = {
      getServerContext: () => ({
        bffRuntimeFramework: 'effect',
        middlewares,
      }),
      getServerConfig: () => ({}),
    } as unknown as ServerPluginAPI;
    const adapter = new EffectAdapter(api);
    const state = adapter as unknown as {
      handler: DisposableHandler | null;
      reloadHandler: () => Promise<void>;
    };
    state.reloadHandler = async () => {
      state.handler = null;
    };

    await adapter.registerMiddleware({ prefix: '/api', enableHandleWeb: true });
    const result = await middlewares[0]!.handler(
      {
        env: {},
        req: {
          method: 'GET',
          path: '/page',
          raw: new Request('https://example.com/page'),
        },
      },
      async () => {
        nextCalls += 1;
      },
    );

    expect(result).toBeUndefined();
    expect(nextCalls).toBe(1);
  });
});
