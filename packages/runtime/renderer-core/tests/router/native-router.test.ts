import { describe, expect, it } from '@rstest/core';
import type { RendererIdentity } from '../../src/identity';
import type { FileSystemRouteOptions } from '../../src/router';
import {
  createNativeRouter,
  type NativeApplicationRouterOptions,
  type NativeRoutedApplication,
  type NativeRouterFactory,
} from '../../src/router';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'native-router',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'source-contract-digest',
};

const loadRoute = async () =>
  ({ kind: 'success', value: undefined, status: 200 }) as const;

function recordingFactory() {
  const trees: {
    modules: Readonly<Record<string, Record<string, unknown>>>;
    options: FileSystemRouteOptions<object, object>;
  }[] = [];
  const routers: NativeApplicationRouterOptions<object>[] = [];
  const factory: NativeRouterFactory<object, object> = {
    routeTree(_routes, modules, options) {
      trees.push({ modules, options });
      return {};
    },
    router(options) {
      routers.push(options);
      return { options };
    },
  };
  return { trees, routers, factory };
}

function application(
  routeModules: NativeRoutedApplication['routeModules'] = {},
): NativeRoutedApplication {
  return {
    basePath: '/catalog',
    routeIR: [{ id: 'layout', isRoot: true, children: [] }],
    routeModules,
    dataModules: {},
  };
}

describe('generated native application router', () => {
  it('resolves route module namespaces into native route options', () => {
    const { trees, factory } = recordingFactory();
    const Layout = () => null;
    const Pending = () => null;
    const head = () => ({});
    const validateSearch = (search: Record<string, unknown>) => search;
    createNativeRouter(
      application({
        layout: {
          component: { default: Layout },
          pendingComponent: { default: Pending },
          head: { default: head },
          search: { validateSearch },
        },
        page: { head: { head }, search: { default: validateSearch } },
      }),
      { identity, loadRoute },
      factory,
    );
    expect(trees[0].modules).toEqual({
      layout: {
        component: Layout,
        pendingComponent: Pending,
        head,
        validateSearch,
      },
      page: { head, validateSearch },
    });
    for (const search of [{}, { validateSearch: 'invalid' }])
      expect(() =>
        createNativeRouter(
          application({ layout: { search } }),
          { identity, loadRoute },
          factory,
        ),
      ).toThrow(
        'A native search module must export validateSearch or a default validator',
      );
  });

  it('keeps private request bindings in loader closures and public identity in native state', () => {
    const { trees, routers, factory } = recordingFactory();
    const create = (request: Request, context: object, session: object) =>
      createNativeRouter(
        application(),
        {
          identity,
          loadRoute,
          request,
          context,
          session: session as never,
        },
        factory,
      );
    const firstRequest = new Request('https://example.test/catalog/one?x=1#a');
    const first = { context: { secret: 'first' }, session: {} };
    const firstRouter = create(firstRequest, first.context, first.session);
    const secondRequest = new Request('https://example.test/catalog/two');
    const second = { context: { secret: 'second' }, session: {} };
    const secondRouter = create(secondRequest, second.context, second.session);

    expect(trees[0].options.context).toBe(first.context);
    expect(trees[1].options.context).toBe(second.context);
    expect(trees[0].options.request).toBe(firstRequest);
    expect(trees[0].options.session).toBe(first.session);
    expect(trees[0].options.loadRoute).toBe(loadRoute);
    // Octane streamed data resolves its own router; Solid ignores it.
    expect(trees[0].options.getRouter?.()).toBe(firstRouter);
    expect(trees[1].options.getRouter?.()).toBe(secondRouter);
    for (const options of routers) {
      expect(Object.keys(options.context)).toEqual(['ultramodern']);
      expect(options.context.ultramodern.rendererIdentity).toEqual(identity);
      expect(Object.isFrozen(options.context.ultramodern)).toBe(true);
      expect(
        Object.isFrozen(options.context.ultramodern.rendererIdentity),
      ).toBe(true);
      expect(options.basepath).toBe('/catalog');
    }
    expect(routers[0].context).not.toBe(routers[1].context);
    expect(routers[0].location).toEqual({
      origin: 'https://example.test',
      href: '/catalog/one?x=1#a',
    });
    expect(() =>
      create(firstRequest, { ultramodern: {} }, first.session),
    ).toThrow('reserves ultramodern metadata');
  });

  it('passes the CSP nonce and the i18n rewrite only when present', () => {
    const { routers, factory } = recordingFactory();
    const rewrite = { input: () => undefined, output: () => undefined };
    createNativeRouter(
      application(),
      { identity, loadRoute, nonce: 'request-nonce', rewrite },
      factory,
    );
    createNativeRouter(application(), { identity, loadRoute }, factory);
    expect(routers[0]).toMatchObject({
      ssr: { nonce: 'request-nonce' },
      rewrite,
    });
    expect(routers[1]).not.toHaveProperty('ssr');
    expect(routers[1]).not.toHaveProperty('rewrite');
    // A browser router keeps its own history.
    expect(routers[1]).not.toHaveProperty('location');
  });
});
