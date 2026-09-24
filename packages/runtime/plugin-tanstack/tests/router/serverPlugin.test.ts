import type { TInternalRuntimeContext } from '@modern-js/runtime/context';
import { routerProviderRegistryHooks } from '@modern-js/runtime/context';
import { type AnyRouter, RouterProvider } from '@tanstack/react-router';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
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

function collectBeforeRender(
  createRoutes: NonNullable<RouterConfig['createRoutes']>,
) {
  let listener: BeforeRenderListener | undefined;
  tanstackRouterPlugin({ createRoutes }).setup?.({
    getRuntimeConfig: () => ({}),
    getHooks: () => routerProviderRegistryHooks,
    onBeforeRender: nextListener => {
      listener = nextListener;
    },
    wrapRoot: () => {},
  });

  if (!listener) {
    throw new Error('Expected the TanStack server plugin to register a hook');
  }
  return listener;
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

describe('tanstack server plugin router results', () => {
  afterEach(() => {
    rstest.restoreAllMocks();
  });

  test.each([
    '/cs/login',
    '/en/login',
  ])('renders native link active attributes during SSR at %s', async pathname => {
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
  });

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

  test.each([
    'string',
    'stream',
  ] as const)('retains %s router resources for response termination', async mode => {
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
      location: { pathname: '/products/shoe', search: '?q=1', hash: '#detail' },
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
  });
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
