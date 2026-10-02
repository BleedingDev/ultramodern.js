import { runtime } from '@modern-js/plugin/runtime';
import type { TInternalRuntimeContext } from '@modern-js/runtime/context';
import {
  routerProviderRegistryHooks,
  setGlobalContext,
  setGlobalInternalRuntimeContext,
} from '@modern-js/runtime/context';
import { type AnyRouter, RouterProvider } from '@tanstack/react-router';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { routerStatePlugin } from '../../../../solutions/ultramodern-app-tools/src/native-composition/router-state-runtime';
import { SSRErrors } from '../../../plugin-runtime/src/core/server/tracer';
import {
  getRouterRuntimeState,
  getRouterServerSnapshot,
} from '../../src/runtime/lifecycle';
import { tanstackRouterPlugin } from '../../src/runtime/plugin.node';
import type { TanstackRouterPluginAPI } from '../../src/runtime/pluginShared';
import * as ssrUtils from '../../src/runtime/ssrManagedTags';
import * as ssrPreload from '../../src/runtime/ssrPreload';
import type { RouterConfig } from '../../src/runtime/types';

type BeforeRenderListener = Parameters<
  TanstackRouterPluginAPI['onBeforeRender']
>[0];

(
  globalThis as typeof globalThis & {
    __webpack_require__?: { u: (chunkId: unknown) => string };
  }
).__webpack_require__ = {
  u: chunkId => String(chunkId),
};

function collectBeforeRender(
  createRoutes: NonNullable<RouterConfig['createRoutes']>,
): BeforeRenderListener {
  const { runtimeContext } = runtime.run({
    config: {},
    plugins: [tanstackRouterPlugin({ createRoutes })],
  });
  return async (context, interrupt) => {
    const result = await runtimeContext.hooks.onBeforeRender.call(context);
    if (result instanceof Response) {
      interrupt(result);
      return result;
    }
  };
}

function createServerContext(pathname: string) {
  const status = rstest.fn();
  const context = {
    ssrContext: {
      baseUrl: '/',
      loaderContext: {},
      mode: 'string',
      request: {
        raw: new Request(`http://localhost${pathname}`),
      },
      response: { status },
    },
  } as unknown as TInternalRuntimeContext;

  return { context, status };
}

afterEach(() => {
  rstest.restoreAllMocks();
});

describe('tanstack server plugin router results', () => {
  test.each(['/cs/login', '/en/login'])(
    'renders native link active attributes during SSR at %s',
    async pathname => {
      const { context } = createServerContext(pathname);
      const beforeRender = collectBeforeRender(() => [
        {
          id: 'login',
          path: '/:lang/login',
          Component: () => {
            const Link = context.router?.Link;
            if (!Link) {
              throw new Error('SSR router did not provide its native Link');
            }
            return createElement(Link, { to: '/cs' }, 'Home');
          },
        },
      ]);
      await beforeRender(context, value => value);

      expect(context.router?.Link).toBeTypeOf('function');
      const html = renderToString(
        createElement(RouterProvider, {
          router: getRouterRuntimeState(context)?.instance as AnyRouter,
        }),
      );
      expect(html).toContain('href="/cs"');
      if (pathname === '/cs/login') {
        expect(html).toContain('data-status="active"');
        expect(html).toContain('aria-current="page"');
      } else {
        expect(html).not.toContain('data-status="active"');
        expect(html).not.toContain('aria-current="page"');
      }
    },
  );

  test('uses the router render result as the HTTP and hydration status', async () => {
    const beforeRender = collectBeforeRender(() => [
      {
        id: 'root',
        path: '/',
        Component: () => null,
        children: [
          {
            id: 'target',
            path: 'target',
            Component: () => null,
          },
        ],
      },
    ]);
    const { context, status } = createServerContext('/target');

    await beforeRender(context, value => value);

    expect(status).toHaveBeenCalledWith(200);
    expect(getRouterServerSnapshot(context)).toMatchObject({
      framework: 'tanstack',
      statusCode: 200,
    });
    // Without the dehydrated router the client re-renders matched remotes
    // from scratch instead of hydrating the server HTML.
    expect(getRouterServerSnapshot(context)?.hydrationScripts).toEqual(
      expect.arrayContaining([expect.stringContaining('$_TSR')]),
    );
  });

  test('interrupts SSR with the router redirect response', async () => {
    const beforeRender = collectBeforeRender(() => [
      {
        id: 'root',
        path: '/',
        Component: () => null,
        children: [
          {
            id: 'redirect',
            path: 'redirect',
            loader: () =>
              new Response(null, {
                status: 307,
                headers: { Location: '/target' },
              }),
            Component: () => null,
          },
          {
            id: 'target',
            path: 'target',
            Component: () => null,
          },
        ],
      },
    ]);
    const { context, status } = createServerContext('/redirect');
    const interrupt = rstest.fn((value: unknown) => value);

    const response = await beforeRender(context, interrupt);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(307);
    expect((response as Response).headers.get('Location')).toBe('/target');
    expect(interrupt).toHaveBeenCalledWith(response);
    expect(status).not.toHaveBeenCalled();
  });
});

describe('TanStack preparation resource lifetime', () => {
  test.each([
    'attach',
    'load',
    'result',
    'preload',
    'dehydrate',
    'abort',
    'clientRender',
    'afterCreate',
  ])('disposes exactly once when %s fails', async stage => {
    const failure = new Error(`${stage} failed`);
    const cleanup = rstest.fn();
    const controller = new AbortController();
    const { context } = createServerContext('/');
    context.ssrContext!.request.raw = new Request('http://localhost/', {
      signal: controller.signal,
    });
    const attach = ssrUtils.attachServerSsrUtils;
    rstest
      .spyOn(ssrUtils, 'attachServerSsrUtils')
      .mockImplementation(async router => {
        await attach(router);
        rstest.spyOn(router.serverSsr!, 'cleanup').mockImplementation(cleanup);
        if (stage === 'attach') throw failure;
        if (stage === 'load')
          rstest.spyOn(router, 'load').mockRejectedValue(failure);
        if (stage === 'result')
          rstest.spyOn(router, 'load').mockResolvedValue(undefined);
        if (stage === 'dehydrate')
          rstest
            .spyOn(router.serverSsr!, 'dehydrate')
            .mockRejectedValue(failure);
        if (stage === 'abort') controller.abort(failure);
      });
    if (stage === 'clientRender') {
      context.ssrContext!.loaderFailureMode = 'clientRender';
      rstest
        .spyOn(ssrUtils, 'collectRouterErrors')
        .mockReturnValue({ root: failure });
    }
    if (stage === 'afterCreate')
      rstest
        .spyOn(routerProviderRegistryHooks.onAfterCreateRouter, 'call')
        .mockImplementation(() => {
          throw failure;
        });
    if (stage === 'preload')
      rstest
        .spyOn(ssrPreload, 'preloadMatchedRouteComponents')
        .mockRejectedValue(failure);
    const beforeRender = collectBeforeRender(() => [
      { id: 'root', path: '/', Component: () => null },
    ]);
    await expect(beforeRender(context, value => value)).rejects.toThrow(
      stage === 'result' ? 'without a server result' : failure.message,
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    await getRouterRuntimeState(context)?.cleanup?.();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test.each(['string', 'stream'] as const)(
    'retains %s router resources for response termination',
    async mode => {
      const { context } = createServerContext('/products/shoe?q=1#detail');
      context.ssrContext!.mode = mode;
      const beforeRender = collectBeforeRender(() => [
        { id: 'product', path: '/products/:id', Component: () => null },
      ]);
      await beforeRender(context, value => value);
      const state = getRouterRuntimeState(context)!;
      const router = state.instance as AnyRouter;
      const cleanup = rstest.spyOn(router.serverSsr!, 'cleanup');
      const navigation = state.navigation!;
      expect(navigation.getSnapshot()).toMatchObject({
        location: {
          pathname: '/products/shoe',
          search: '?q=1',
          hash: '#detail',
        },
        params: { id: 'shoe' },
      });
      expect(navigation.getSnapshot()).toBe(navigation.getSnapshot());
      expect(navigation.Link).toBe(context.router?.Link);
      expect(
        navigation.createLinkProps!({
          pathname: '/products/shoe',
          href: '/products/shoe?q=2#detail',
          search: { q: '2' },
          hash: 'detail',
          hashScrollIntoView: false,
          prefetch: 'none',
        }),
      ).toEqual({
        to: '/products/shoe',
        search: { q: '2' },
        hash: 'detail',
        hashScrollIntoView: false,
        preload: false,
      });
      expect(cleanup).not.toHaveBeenCalled();
      await state.cleanup?.();
      await state.cleanup?.();
      expect(cleanup).toHaveBeenCalledTimes(1);
    },
  );
});

test('incoming abort reaches an active Modern loader and disposes its router', async () => {
  const incoming = new AbortController();
  let started!: () => void;
  const loading = new Promise<void>(resolve => {
    started = resolve;
  });
  const { context } = createServerContext('/');
  context.ssrContext!.request.raw = new Request('http://localhost/', {
    signal: incoming.signal,
  });
  const failure = new Error('client disconnected during loader');
  const beforeRender = collectBeforeRender(() => [
    {
      id: 'root',
      path: '/',
      Component: () => null,
      loader: ({ request }: { request: Request }) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(request.signal.reason),
            { once: true },
          );
          started();
        }),
    },
  ]);
  const pending = beforeRender(context, value => value);
  await loading;
  const router = getRouterRuntimeState(context)!.instance as AnyRouter;
  const cleanup = rstest.spyOn(router.serverSsr!, 'cleanup');
  incoming.abort(failure);
  await expect(pending).rejects.toBe(failure);
  expect(cleanup).toHaveBeenCalledTimes(1);
  await getRouterRuntimeState(context)?.cleanup?.();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

describe('TanStack provider with the native request handler', () => {
  test.each([
    {
      label: 'plain provider completion',
      ultraPolicy: false,
      terminal: 'complete',
    },
    {
      label: 'plain provider cancellation',
      ultraPolicy: false,
      terminal: 'cancelled',
    },
    {
      label: 'Ultra observer completion',
      ultraPolicy: true,
      terminal: 'complete',
    },
    {
      label: 'Ultra observer cancellation',
      ultraPolicy: true,
      terminal: 'cancelled',
    },
  ] as const)(
    'preserves loader reporting and disposes once for $label',
    async ({ ultraPolicy, terminal }) => {
      const failure = new Error('TanStack loader failed');
      let loaderRequest: Request | undefined;
      const provider = tanstackRouterPlugin({
        createRoutes: () => [
          {
            id: 'root',
            path: '/',
            Component: () => null,
            children: [
              {
                id: 'error',
                path: 'error',
                Component: () => null,
                loader: ({ request }: { request: Request }) => {
                  loaderRequest = request;
                  throw failure;
                },
              },
            ],
          },
        ],
      });
      const { runtimeContext } = runtime.run({
        config: { router: { framework: 'tanstack' } },
        plugins: ultraPolicy ? [routerStatePlugin(), provider] : [provider],
      });
      setGlobalContext({
        entryName: 'main',
        App: () => null,
        enableRsc: false,
      });
      setGlobalInternalRuntimeContext(runtimeContext as any);
      const request = new Request('http://localhost/error');
      const removeAbortListener = rstest.spyOn(
        request.signal,
        'removeEventListener',
      );
      const onError = rstest.fn();
      const observer = rstest.fn();
      runtimeContext.hooks.onRequestEnd.tap(observer);
      let state: ReturnType<typeof getRouterRuntimeState>;
      let cleanup: ReturnType<typeof rstest.fn> | undefined;
      let serverCleanup: ReturnType<typeof rstest.spyOn> | undefined;
      let releaseTail = () => {};
      const tailReleased = new Promise<void>(resolve => {
        releaseTail = resolve;
      });
      const encoder = new TextEncoder();
      const { createRequestHandler } = await import(
        '../../../plugin-runtime/src/core/server/requestHandler'
      );
      const handler = await createRequestHandler(
        async (_request, _Root, options) => {
          state = getRouterRuntimeState(options.runtimeContext);
          if (!state?.cleanup)
            throw new Error('TanStack did not register request resources');
          cleanup = rstest.fn(state.cleanup);
          state.cleanup = cleanup;
          const router = state.instance as AnyRouter;
          serverCleanup = rstest.spyOn(router.serverSsr!, 'cleanup');
          const snapshot = getRouterServerSnapshot(options.runtimeContext);
          expect(snapshot).toMatchObject({
            framework: 'tanstack',
            statusCode: 500,
          });
          expect(Object.values(snapshot?.errors ?? {})).toContain(failure);
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode('<shell>'));
              },
              async pull(controller) {
                if (terminal === 'cancelled') return;
                await tailReleased;
                controller.enqueue(encoder.encode('<tail>'));
                controller.close();
              },
            }),
          );
        },
      );

      const response = await handler(request, {
        resource: {
          entryName: 'main',
          route: { urlPath: '/' },
          htmlTemplate: '<html><head></head><body></body></html>',
        },
        config: { ssr: { mode: 'stream' } },
        params: {},
        locals: {},
        loaderContext: {},
        onTiming: () => {},
        onError,
      } as any);

      expect(response.status).toBe(500);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(failure, SSRErrors.LOADER_ERROR);
      expect(state?.framework).toBe('tanstack');
      expect(cleanup).not.toHaveBeenCalled();
      expect(serverCleanup).not.toHaveBeenCalled();
      expect(observer).not.toHaveBeenCalled();
      expect(removeAbortListener).not.toHaveBeenCalled();
      expect(loaderRequest?.signal.aborted).toBe(false);

      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(
        '<shell>',
      );
      if (terminal === 'cancelled') {
        await reader.cancel('client disconnected');
      } else {
        releaseTail();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe(
          '<tail>',
        );
        expect((await reader.read()).done).toBe(true);
      }
      reader.releaseLock();

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(serverCleanup).toHaveBeenCalledTimes(1);
      expect(removeAbortListener).toHaveBeenCalledTimes(1);
      expect(removeAbortListener).toHaveBeenCalledWith(
        'abort',
        expect.any(Function),
      );
      expect(loaderRequest?.signal.aborted).toBe(true);
      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer.mock.calls[0]?.[0]).toMatchObject({
        terminal:
          terminal === 'complete'
            ? { status: 'complete' }
            : { status: 'cancelled', reason: 'client disconnected' },
      });
      expect(onError).toHaveBeenCalledTimes(1);
      await state?.cleanup?.();
      expect(serverCleanup).toHaveBeenCalledTimes(1);
      expect(removeAbortListener).toHaveBeenCalledTimes(1);
    },
  );
});
