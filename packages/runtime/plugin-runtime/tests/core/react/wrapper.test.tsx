import React, { useContext } from 'react';
import { renderToString } from 'react-dom/server';
import {
  applyRouterRuntimeState,
  getInitialContext,
  getRouterRuntimeState,
  getRouterServerSnapshot,
  InternalRuntimeContext,
  RuntimeContext,
  setGlobalContext,
} from '../../../src/core/context';
import { getHelmetContext } from '../../../src/core/context/helmetContext';
import { wrapRuntimeContextProvider } from '../../../src/core/react/wrapper';
import { Helmet } from '../../../src/exports/head';

describe('wrapRuntimeContextProvider', () => {
  it('should keep router runtime state out of public context enumeration', () => {
    let runtimeValue: Record<string, unknown> | undefined;
    let internalValue: Record<string, unknown> | undefined;

    const Probe = () => {
      runtimeValue = useContext(RuntimeContext) as Record<string, unknown>;
      internalValue = useContext(InternalRuntimeContext) as Record<
        string,
        unknown
      >;
      return null;
    };

    const context = getInitialContext(false);
    applyRouterRuntimeState(context, {
      framework: 'custom-router',
      instance: { kind: 'internal-router' },
      serverSnapshot: {
        matchedRouteIds: ['route-a'],
      },
    });

    renderToString(
      wrapRuntimeContextProvider(
        <Probe />,
        context as Record<string, unknown> as any,
      ),
    );

    expect(getRouterServerSnapshot(internalValue as object)).toMatchObject({
      matchedRouteIds: ['route-a'],
    });
    expect(getRouterRuntimeState(internalValue as object)?.framework).toBe(
      'custom-router',
    );
    expect(getRouterRuntimeState(internalValue as object)?.instance).toEqual({
      kind: 'internal-router',
    });

    // None of the router state may leak into string-key enumeration of
    // either context value — each forbidden key is asserted individually so
    // a partial leak fails too.
    const forbiddenKeys = [
      'routerFramework',
      'routerInstance',
      'routerRuntime',
      'routerServerSnapshot',
      'routerHydrationScript',
      'routerMatchedRouteIds',
      '_helmetContext',
    ];
    for (const value of [runtimeValue, internalValue]) {
      const keys = Object.keys(value as object);
      for (const forbidden of forbiddenKeys) {
        expect(keys).not.toContain(forbidden);
      }
    }
    expect(runtimeValue?.routerFramework).toBeUndefined();
    expect(runtimeValue?.routerInstance).toBeUndefined();
    expect(runtimeValue?.routerServerSnapshot).toBeUndefined();

    // The symbol-keyed extension slot must not be reachable from the PUBLIC
    // context object either: spreads copy enumerable symbol properties, so
    // the wrapper has to strip the slot from the public copy.
    const extensionsSlot = Symbol.for('@modern-js/runtime:context-extensions');
    expect(Object.getOwnPropertySymbols(runtimeValue as object)).not.toContain(
      extensionsSlot,
    );
    expect(getRouterRuntimeState(runtimeValue as object)).toBeUndefined();
    expect(getRouterServerSnapshot(runtimeValue as object)).toBeUndefined();

    // ...while the internal context keeps carrying it.
    expect(Object.getOwnPropertySymbols(internalValue as object)).toContain(
      extensionsSlot,
    );
  });

  it('should collect head tags in an isolated request context', () => {
    const context = getInitialContext(false);

    renderToString(
      wrapRuntimeContextProvider(
        <Helmet htmlAttributes={{ lang: 'cs' }}>
          <title>Modern SSR</title>
        </Helmet>,
        context as Record<string, unknown> as any,
      ),
    );

    expect(getHelmetContext(context)?.helmet?.htmlAttributes.toString()).toBe(
      'lang="cs"',
    );
    expect(getHelmetContext(context)?.helmet?.title.toString()).toBe(
      '<title data-rh="true">Modern SSR</title>',
    );
  });

  it('keeps response functions outside the RSC internal context', () => {
    let internalValue: ReturnType<typeof getInitialContext> | undefined;

    const Probe = () => {
      internalValue = useContext(InternalRuntimeContext);
      return null;
    };

    const response = {
      setHeader: rstest.fn(),
      status: rstest.fn(),
      locals: { tenant: 'tractor-store' },
    };
    const context = getInitialContext(false);
    context.ssrContext = {
      request: {
        params: { category: 'compact' },
        pathname: '/tractors',
        query: { sort: 'price' },
        headers: { accept: 'text/html' },
        host: 'example.test',
        url: 'https://example.test/tractors?sort=price',
      },
      response,
    };

    setGlobalContext({ enableRsc: true });
    try {
      renderToString(wrapRuntimeContextProvider(<Probe />, context));
    } finally {
      setGlobalContext({ enableRsc: false });
    }

    expect(internalValue?.ssrContext).toBeUndefined();
    expect(internalValue?.requestContext.request).toEqual({
      params: { category: 'compact' },
      pathname: '/tractors',
      query: { sort: 'price' },
      headers: { accept: 'text/html' },
      host: 'example.test',
      url: 'https://example.test/tractors?sort=price',
      userAgent: undefined,
      cookie: undefined,
      referer: undefined,
    });
    expect(internalValue?.requestContext.response).toEqual({
      locals: response.locals,
    });
    expect(
      Object.values(internalValue?.requestContext.response ?? {}).some(
        value => typeof value === 'function',
      ),
    ).toBe(false);
  });

  it('renders an RSC context without an SSR context', () => {
    let internalValue: ReturnType<typeof getInitialContext> | undefined;

    const Probe = () => {
      internalValue = useContext(InternalRuntimeContext);
      return <main>RSC request context</main>;
    };

    setGlobalContext({ enableRsc: true });
    try {
      const html = renderToString(
        wrapRuntimeContextProvider(<Probe />, getInitialContext(false)),
      );

      expect(html).toContain('RSC request context');
      expect(internalValue?.requestContext).toEqual({
        request: {},
        response: { locals: {} },
      });
      expect(internalValue?.ssrContext).toBeUndefined();
    } finally {
      setGlobalContext({ enableRsc: false });
    }
  });

  it('serializes React head prop names to valid HTML attributes', () => {
    const context = getInitialContext(false);

    renderToString(
      wrapRuntimeContextProvider(
        <Helmet>
          <link href="/cs" hrefLang="cs" rel="alternate" />
          <meta charSet="utf-8" />
        </Helmet>,
        context as Record<string, unknown> as any,
      ),
    );

    expect(getHelmetContext(context)?.helmet?.link.toString()).toContain(
      '<link data-rh="true" href="/cs" hreflang="cs" rel="alternate">',
    );
    expect(getHelmetContext(context)?.helmet?.meta.toString()).toContain(
      '<meta data-rh="true" charset="utf-8">',
    );
  });
});
