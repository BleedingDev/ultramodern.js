import {
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

test(
  'native pending navigations finishing in reverse order retain the latest route',
  nativeRouterReversedPendingNavigation,
);

test(
  'the ordered native route chain is equal after SSR serialization, hydration and navigation',
  nativeRouterRouteChainHydration,
);
