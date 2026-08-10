import type { TInternalRuntimeContext } from '@modern-js/runtime/context';
import { routerProviderRegistryHooks } from '@modern-js/runtime/context';
import { getRouterServerSnapshot } from '../../src/runtime/lifecycle';
import { tanstackRouterPlugin } from '../../src/runtime/plugin.node';
import type { TanstackRouterPluginAPI } from '../../src/runtime/pluginShared';
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
