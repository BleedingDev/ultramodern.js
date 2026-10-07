import { describe, expect, it, rstest } from '@rstest/core';
import type { DataOutcome } from '../../src/data';
import {
  createNativeServerEntry,
  type NativeEntryI18n,
  type NativeI18nView,
  type NativeServerAdapter,
  type NativeServerDocument,
} from '../../src/entry-server';
import type { RendererIdentity } from '../../src/identity';
import {
  createNativeRouter,
  type NativeApplicationModule,
  type NativeHistoryLocation,
  type NativeRouteMatch,
  type NativeRouteMatcher,
  type NativeRouterOptions,
} from '../../src/router';
import type { NativeRequestContext } from '../../src/server';
import { createRequestSession } from '../../src/session';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'server-entry',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'server-entry-build',
};

type Router = NativeRouteMatcher<NativeHistoryLocation, NativeRouteMatch> & {
  readonly options: NativeRouterOptions;
};

function context(
  request: Request,
  overrides: Partial<NativeRequestContext> = {},
): NativeRequestContext {
  return {
    entry: identity,
    session: createRequestSession({
      request,
      identity,
      platform: { kind: 'node', bindings: { binding: 'private' } },
    }),
    nonce: 'document-nonce',
    nativeManifest: { modules: 'manifest' },
    ...overrides,
  };
}

function html(context: NativeRequestContext, text: string): Response {
  context.session.startRendering();
  return context.session.respond(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
  );
}

type Document = NativeServerDocument & { manifest: unknown };

/** A recording renderer whose router matches `/items` to the `page` route. */
function adapter() {
  const calls: {
    kind: string;
    document?: Document;
    value?: unknown;
    i18n?: NativeI18nView<I18nInstance, never>;
  }[] = [];
  const routers: Router[] = [];
  const recording: NativeServerAdapter<Router, Document, I18nInstance, never> =
    {
      document: (base, nativeManifest) => ({
        ...base,
        manifest: nativeManifest,
      }),
      run: (_session, callback) => callback(),
      respond: (_session, response) => response,
      createRouter(application, options) {
        const router = createNativeRouter(application, options, {
          routeTree: () => ({}),
          router: () => ({
            options,
            routesById: {
              layout: {
                options: { staticData: { ultramodernRouteId: 'layout' } },
              },
              page: { options: { staticData: { ultramodernRouteId: 'page' } } },
            },
            parseLocation: location => location,
            matchRoutes: location =>
              location.pathname === '/items'
                ? [
                    { routeId: 'layout', params: {} },
                    { routeId: 'page', params: {} },
                  ]
                : [],
          }),
        });
        routers.push(router);
        return router;
      },
      renderCSR(requestContext, document) {
        calls.push({ kind: 'csr', document });
        return html(requestContext, 'csr');
      },
      async renderComponent(
        requestContext,
        component,
        document,
        i18n?: NativeI18nView<I18nInstance, never>,
      ) {
        calls.push({ kind: 'component', document, value: component, i18n });
        return html(requestContext, 'component');
      },
      async renderRoutes(input) {
        calls.push({ kind: 'routes', document: input.document, value: input });
        input.context.session.resolveResponse({
          kind: 'document',
          status: 200,
          headers: [['content-type', 'text/html; charset=utf-8']],
          cache: { mode: 'no-store' },
        });
        return html(input.context, 'routes');
      },
    };
  return { calls, routers, adapter: recording };
}

const component = () => null;
const loader = async () => ({ kind: 'page' });
const routed: NativeApplicationModule = {
  basePath: '/',
  routeIR: [
    {
      id: 'layout',
      isRoot: true,
      path: '/',
      children: [{ id: 'page', path: 'items', children: [] }],
    },
  ],
  routeModules: {},
  dataModules: { page: { loader } },
};

interface I18nInstance {
  readonly language: string;
}

function localization(): NativeEntryI18n<I18nInstance, never> {
  return {
    languages: ['en', 'cs'],
    resolveRequest: request =>
      new URL(request.url).pathname.startsWith('/cs')
        ? { kind: 'language', language: 'cs' }
        : { kind: 'redirect', language: 'en', location: '/en/items' },
    redirect: location =>
      new Response(null, { status: 302, headers: { location } }),
    create: async language => ({ language }),
    rewrite: () => ({}),
    handoff: (language, instance) => ({
      id: 'handoff',
      payload: JSON.stringify({ language, bundles: Boolean(instance) }),
    }),
    clientHandoff: () => ({ language: 'en' }),
    syncWithRouter() {},
  };
}

describe('generated native server entry', () => {
  it('requires the exact entry identity and the session request', async () => {
    const { adapter: recording } = adapter();
    const entry = createNativeServerEntry(
      { identity, app: async () => ({ default: component }) },
      recording,
    );
    expect(entry.rendererIdentity).toEqual(identity);
    expect(Object.isFrozen(entry.rendererIdentity)).toBe(true);
    const request = new Request('https://example.test/');
    await expect(
      entry.nativeRequestHandler(
        request,
        context(request, { entry: { ...identity, buildId: 'another' } }),
      ),
    ).rejects.toThrow('conflicts with the application build');
    await expect(
      entry.nativeRequestHandler(
        new Request('https://example.test/'),
        context(request),
      ),
    ).rejects.toThrow('Native request/session ownership mismatch');
  });

  it('renders a component application into a renderer document', async () => {
    const { adapter: recording, calls } = adapter();
    const entry = createNativeServerEntry(
      { identity, app: async () => ({ default: component }) },
      recording,
    );
    const request = new Request('https://example.test/');
    const response = await entry.nativeRequestHandler(
      request,
      context(request),
    );
    expect(await response.text()).toBe('component');
    expect(calls[0].value).toBe(component);
    expect(calls[0].document).toMatchObject({
      rootId: 'root',
      nonce: 'document-nonce',
      manifest: { modules: 'manifest' },
    });
    expect(calls[0].document?.documentId).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(
      entry.nativeMatchRouteIds(request, context(request)),
    ).rejects.toThrow('ssrByRouteIds requires native route matching');
  });

  it('localizes component SSR with one request instance and keeps CSR handoff language-only', async () => {
    const { adapter: recording, calls, routers } = adapter();
    const instance = { language: 'cs' };
    const adapterBootstrap = {
      id: 'adapter-bootstrap',
      payload: '{"feature":true}',
    };
    const i18n = localization();
    const create = rstest.fn(async () => instance);
    const handoff = rstest.fn(i18n.handoff);
    const entry = createNativeServerEntry(
      {
        identity,
        app: async () => ({ default: component }),
        i18n: { ...i18n, create, handoff },
      },
      {
        ...recording,
        document: (base, manifest) => ({
          ...recording.document(base, manifest, identity),
          inlineData: [adapterBootstrap],
        }),
      },
    );
    const request = new Request('https://example.test/cs/items');
    const response = await entry.nativeRequestHandler(
      request,
      context(request),
    );
    expect(await response.text()).toBe('component');
    expect(create).toHaveBeenCalledExactlyOnceWith('cs');
    expect(handoff).toHaveBeenCalledExactlyOnceWith('cs', instance);
    expect(calls[0].document).toMatchObject({
      lang: 'cs',
      inlineData: [
        adapterBootstrap,
        { id: 'handoff', payload: '{"language":"cs","bundles":true}' },
      ],
    });
    expect(calls[0].i18n).toEqual({
      instance,
      languages: ['en', 'cs'],
    });
    expect(calls[0].i18n?.instance).toBe(instance);
    expect(routers).toEqual([]);

    await entry.nativeCSRRequestHandler(request, context(request));
    expect(create).toHaveBeenCalledTimes(1);
    expect(calls[1].document).toMatchObject({
      lang: 'cs',
      inlineData: [
        { id: 'handoff', payload: '{"language":"cs","bundles":false}' },
      ],
    });
  });

  it('redirects component requests through the native response without loading bundles', async () => {
    const { adapter: recording, calls, routers } = adapter();
    const create = rstest.fn(localization().create);
    const redirected = new Response(null, {
      status: 307,
      headers: { location: '/en/items', 'set-cookie': 'language=en' },
    });
    const entry = createNativeServerEntry(
      {
        identity,
        app: async () => ({ default: component }),
        i18n: { ...localization(), create, redirect: () => redirected },
      },
      recording,
    );
    const request = new Request('https://example.test/items');
    const response = await entry.nativeRequestHandler(
      request,
      context(request),
    );
    expect(response).toBe(redirected);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/en/items');
    expect(response.headers.get('set-cookie')).toBe('language=en');
    expect(create).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(routers).toEqual([]);
  });

  it.each([false, true])(
    'preserves the component request body when localization is %s',
    async localized => {
      const { adapter: recording } = adapter();
      const entry = createNativeServerEntry(
        {
          identity,
          app: async () => ({ default: component }),
          ...(localized ? { i18n: localization() } : {}),
        },
        {
          ...recording,
          async renderComponent(requestContext) {
            return html(
              requestContext,
              await requestContext.session.request.text(),
            );
          },
        },
      );
      const request = new Request('https://example.test/cs/items', {
        method: 'POST',
        body: 'native-component-request',
      });
      const response = await entry.nativeRequestHandler(
        request,
        context(request),
      );
      expect(await response.text()).toBe('native-component-request');
    },
  );

  it('answers data requests before rendering and keeps private values out of the router', async () => {
    const { adapter: recording, calls, routers } = adapter();
    const entry = createNativeServerEntry(
      { identity, app: async () => routed },
      recording,
    );
    const data = new Request('https://example.test/items?__loader=page');
    const dataResponse = await entry.nativeRequestHandler(data, context(data));
    expect(dataResponse.headers.get('content-type')).toContain('json');
    expect(calls).toEqual([]);

    const request = new Request('https://example.test/items');
    const requestContext = context(request);
    const response = await entry.nativeRequestHandler(request, requestContext);
    expect(await response.text()).toBe('routes');
    const input = calls[0].value as {
      router: Router;
      outcomes: DataOutcome[];
      forbiddenValues: readonly unknown[];
      request: Request;
    };
    expect(input.router).toBe(routers[1]);
    expect(routers[1].options).toMatchObject({
      context: { binding: 'private' },
      nonce: 'document-nonce',
      session: requestContext.session,
    });
    expect(routers[1].options.request?.signal).not.toBe(request.signal);
    expect(input.forbiddenValues).toEqual([
      requestContext,
      requestContext.session,
      requestContext.session.platform,
      requestContext.session.platform.bindings,
      input.request,
    ]);
    expect(await entry.nativeMatchRouteIds(request, context(request))).toEqual([
      'layout',
      'page',
    ]);
  });

  it('answers routed data requests before localized redirects or document handoff', async () => {
    const { adapter: recording, calls } = adapter();
    const i18n = localization();
    const handoff = rstest.fn(i18n.handoff);
    const redirect = rstest.fn(i18n.redirect);
    const entry = createNativeServerEntry(
      {
        identity,
        app: async () => routed,
        i18n: { ...i18n, handoff, redirect },
      },
      recording,
    );
    const request = new Request('https://example.test/items?__loader=page');
    const response = await entry.nativeRequestHandler(
      request,
      context(request),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('json');
    expect(redirect).not.toHaveBeenCalled();
    expect(handoff).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('localizes CSR and SSR documents and redirects unprefixed URLs', async () => {
    const { adapter: recording, calls } = adapter();
    const entry = createNativeServerEntry(
      { identity, app: async () => routed, i18n: localization() },
      recording,
    );
    const unprefixed = new Request('https://example.test/items');
    for (const handler of [
      entry.nativeCSRRequestHandler,
      entry.nativeRequestHandler,
    ]) {
      const redirect = await handler(unprefixed, context(unprefixed));
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get('location')).toBe('/en/items');
    }
    const czech = new Request('https://example.test/cs/items');
    await entry.nativeCSRRequestHandler(czech, context(czech));
    await entry.nativeRequestHandler(czech, context(czech));
    expect(calls.map(call => call.kind)).toEqual(['csr', 'routes']);
    expect(calls[0].document).toMatchObject({
      lang: 'cs',
      inlineData: [
        { id: 'handoff', payload: '{"language":"cs","bundles":false}' },
      ],
    });
    expect(calls[1].document).toMatchObject({
      lang: 'cs',
      inlineData: [
        { id: 'handoff', payload: '{"language":"cs","bundles":true}' },
      ],
    });
    expect((calls[1].value as { i18n: unknown }).i18n).toEqual({
      instance: { language: 'cs' },
      languages: ['en', 'cs'],
    });
  });
});
