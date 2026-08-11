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

  test.each([
    null,
    new Error('not a route response'),
    { status: '404', statusText: 'Not Found', internal: false, data: null },
    { status: 404, statusText: 404, internal: false, data: null },
    { status: 404, statusText: 'Not Found', internal: 'false', data: null },
    { status: 404, statusText: 'Not Found', internal: false },
  ])('rejects values outside the route error contract', value => {
    expect(isRouteErrorResponse(value)).toBe(false);
  });
});

describe('router helper route module handling', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

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

  test('returns a default route component module from a nested namespace', () => {
    function Page() {
      return null;
    }

    expect(resolveRouteComponent({ default: { default: Page } })).toBe(Page);
    expect(
      handleRouteModule({ default: { default: Page } }, 'about/page'),
    ).toEqual({
      default: Page,
    });
  });

  test('returns a default route component module from a Component export', () => {
    function Page() {
      return null;
    }

    expect(resolveRouteComponent({ Component: Page })).toBe(Page);
    expect(handleRouteModule({ Component: Page }, 'about/page')).toEqual({
      default: Page,
    });
  });

  test('returns a default route component module from Rspack async module exports', () => {
    function Page() {
      return null;
    }
    const rspackExports = Symbol('rspack exports');

    expect(
      resolveRouteComponent({
        [rspackExports]: {
          default: Page,
        },
      }),
    ).toBe(Page);
    expect(
      handleRouteModule(
        {
          [rspackExports]: {
            default: Page,
          },
        },
        'about/page',
      ),
    ).toEqual({
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
