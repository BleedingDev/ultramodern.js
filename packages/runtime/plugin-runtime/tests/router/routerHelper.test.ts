import { ROUTE_MODULES } from '@modern-js/utils/universal/constants';
import {
  createShouldRevalidate,
  handleRouteModule,
  isRouteErrorResponse,
  resolveRouteComponent,
} from '../../src/router/runtime/routerHelper';

describe('router helper route error recognition', () => {
  test('recognizes the provider-neutral route error contract', () => {
    expect(
      isRouteErrorResponse({
        status: 404,
        statusText: 'Not Found',
        internal: false,
        data: { resource: 'invoice' },
      }),
    ).toBe(true);
  });

  test.each([null, { status: 404, statusText: 'Not Found', internal: false }])(
    'rejects values outside the route error contract',
    value => {
      expect(isRouteErrorResponse(value)).toBe(false);
    },
  );
});

describe('router helper route module handling', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  function Page() {
    return null;
  }
  const rspackExports = Symbol('rspack exports');

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  test('keeps the full route module for route metadata callbacks', () => {
    const shouldRevalidate = rstest.fn(() => false);
    const routeModule = {
      default: function Page() {
        return null;
      },
      shouldRevalidate,
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        [ROUTE_MODULES]: {},
      },
    });

    expect(handleRouteModule(routeModule, 'about/page')).toEqual({
      default: routeModule.default,
    });
    expect(
      (window as unknown as Record<string, Record<string, unknown>>)[
        ROUTE_MODULES
      ]['about/page'],
    ).toBe(routeModule);
    expect(
      createShouldRevalidate('about/page')({
        defaultShouldRevalidate: true,
      } as Parameters<ReturnType<typeof createShouldRevalidate>>[0]),
    ).toBe(false);
    expect(shouldRevalidate).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['nested namespace', { default: { default: Page } }],
    ['Component export', { Component: Page }],
    ['Rspack async exports', { [rspackExports]: { default: Page } }],
  ])('normalizes a route component from a %s', (_name, routeModule) => {
    expect(resolveRouteComponent(routeModule)).toBe(Page);
    expect(handleRouteModule(routeModule, 'about/page')).toEqual({
      default: Page,
    });
  });

  test('preserves the original module when no route component export exists', () => {
    const routeModule = {
      loader: () => null,
    };

    expect(handleRouteModule(routeModule, 'loader-only')).toBe(routeModule);
  });
});
