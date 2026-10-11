import {
  nativeRouterActionOwnerDisposal,
  nativeRouterActionRedirect,
  nativeRouterPreloadAndInvalidationCounts,
  nativeRouterReversedPendingNavigation,
  nativeRouterRouteChainHydration,
} from './fixtures/routes-lifecycle';

// Rstest replaces Request/Response while retaining some Node Fetch classes.
// Use the public DOM platform's actual classes together for data and signals.
const platform = new window.Window() as Window & typeof globalThis;
Object.assign(globalThis, {
  fetch: platform.fetch.bind(platform),
  Request: platform.Request,
  Response: platform.Response,
  Headers: platform.Headers,
  FormData: platform.FormData,
  File: platform.File,
  Blob: platform.Blob,
  AbortController: platform.AbortController,
  AbortSignal: platform.AbortSignal,
  DOMException: platform.DOMException,
});

afterAll(() => platform.close());

test(
  'native route-data preload is reused by navigation and action invalidation has exact counts',
  nativeRouterPreloadAndInvalidationCounts,
);

test.each([
  {
    name: 'relative Location from a custom action URL',
    location: '../complete?sku=tractor#done',
    url: '/account/actions/save?intent=save',
    expected: 'https://native.test/account/complete?sku=tractor#done',
  },
  {
    name: 'relative Location from an action URL callback',
    location: '../complete',
    url: () => '/account/actions/save',
    expected: 'https://native.test/account/complete',
  },
  {
    name: 'relative Location from the default current-page action',
    location: '../complete',
    expected: 'https://native.test/complete',
  },
  {
    name: 'root-relative Location',
    location: '/account/complete',
    url: '/account/actions/save',
    expected: 'https://native.test/account/complete',
  },
  {
    name: 'same-origin absolute Location',
    location: 'https://native.test/account/complete',
    url: '/account/actions/save',
    expected: 'https://native.test/account/complete',
  },
  {
    name: 'query-only Location on the submitted action URL',
    location: '?saved=true',
    url: '/account/actions/save?intent=save',
    expected: 'https://native.test/account/actions/save?saved=true',
  },
])('native action redirect resolves $name', ({ location, expected, url }) =>
  nativeRouterActionRedirect(location, expected, url),
);

test.each([
  'https://checkout.test/complete?sku=tractor#paid',
  '//checkout.test/complete?sku=tractor#paid',
])('native action redirect uses document navigation for %s', location =>
  nativeRouterActionRedirect(
    location,
    'https://checkout.test/complete?sku=tractor#paid',
    '/account/actions/save',
    true,
  ),
);

test(
  'a route action is aborted with its unmounted owner and its late result is ignored',
  nativeRouterActionOwnerDisposal,
);

test(
  'native pending navigations finishing in reverse order retain the latest route',
  nativeRouterReversedPendingNavigation,
);

test(
  'the ordered native route chain is equal after SSR serialization, hydration and navigation',
  nativeRouterRouteChainHydration,
);
