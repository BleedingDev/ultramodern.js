import { createDataResponse } from '@modern-js/renderer-core/data';
import { expect, test } from '@rstest/core';
import { createOctaneRouteAction } from '../src/router';

const identity = {
  renderer: 'octane',
  appId: 'action-redirect',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'action-build',
} as const;

test.each([
  [307, 'POST'],
  [308, 'POST'],
  [302, 'PUT'],
  [301, 'DELETE'],
] as const)(
  'a method-preserving %s action redirect after %s fails instead of navigating',
  async (status, method) => {
    let navigated = false;
    const router = {
      latestLocation: { publicHref: '/products/42' },
      options: { origin: 'https://octane.test' },
      resolveRedirect: () => {
        navigated = true;
        return { options: { href: '/done' } };
      },
      navigate: async () => {
        navigated = true;
      },
    };
    const action = createOctaneRouteAction({
      router: router as never,
      routeId: 'product',
      identity,
      method: method as 'POST' | 'PUT' | 'DELETE',
      fetch: async () =>
        createDataResponse(
          {
            kind: 'redirect',
            location: '/done',
            response: {
              status,
              statusText: '',
              headers: [],
              cachePolicy: 'no-store',
            },
          } as never,
          identity,
          { routeId: 'product', operation: 'action' },
        ),
    });
    await expect(action(undefined, new FormData())).rejects.toThrow(
      'must not preserve the method',
    );
    expect(navigated).toBe(false);
  },
);
