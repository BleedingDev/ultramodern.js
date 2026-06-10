import React, { useContext } from 'react';
import { renderToString } from 'react-dom/server';
import {
  getInitialContext,
  InternalRuntimeContext,
  RuntimeContext,
} from '../../../src/core/context';
import { wrapRuntimeContextProvider } from '../../../src/core/react/wrapper';
import { Helmet } from '../../../src/exports/head';

describe('wrapRuntimeContextProvider', () => {
  it('should keep routerServerSnapshot internal-only', () => {
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
    context.routerFramework = 'custom-router';
    context.routerInstance = { kind: 'internal-router' };
    context.routerServerSnapshot = {
      matchedRouteIds: ['route-a'],
    };

    renderToString(
      wrapRuntimeContextProvider(
        <Probe />,
        context as Record<string, unknown> as any,
      ),
    );

    expect(internalValue?.routerServerSnapshot).toEqual({
      matchedRouteIds: ['route-a'],
    });
    expect(internalValue?.routerFramework).toBe('custom-router');
    expect(internalValue?.routerInstance).toEqual({
      kind: 'internal-router',
    });
    expect(runtimeValue?.routerFramework).toBe('custom-router');
    expect(runtimeValue?.routerInstance).toBeUndefined();
    expect(runtimeValue?.routerServerSnapshot).toBeUndefined();
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

    expect(context._helmetContext?.helmet?.htmlAttributes.toString()).toBe(
      'lang="cs"',
    );
    expect(context._helmetContext?.helmet?.title.toString()).toBe(
      '<title data-rh="true">Modern SSR</title>',
    );
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

    expect(context._helmetContext?.helmet?.link.toString()).toContain(
      '<link data-rh="true" href="/cs" hreflang="cs" rel="alternate">',
    );
    expect(context._helmetContext?.helmet?.meta.toString()).toContain(
      '<meta data-rh="true" charset="utf-8">',
    );
  });
});
