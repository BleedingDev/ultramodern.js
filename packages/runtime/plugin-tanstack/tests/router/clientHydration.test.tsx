import type { AnyRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import React, { Suspense } from 'react';
import { ModernRouterClient } from '../../src/runtime/clientHydration';

let hydrateImpl: () => Promise<unknown>;

rstest.mock('@tanstack/react-router', () => ({
  RouterProvider: ({ router }: { router: { label: string } }) => (
    <div data-testid="router-provider">{router.label}</div>
  ),
}));

rstest.mock('@tanstack/react-router/ssr/client', () => ({
  hydrate: () => hydrateImpl(),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createRouter(label: string): AnyRouter {
  return {
    label,
    routesById: {},
    stores: {
      matches: {
        get: () => [],
      },
    },
  } as unknown as AnyRouter;
}

describe('TanStack SSR client hydration', () => {
  it('keeps the router behind Suspense until late SSR hydration completes', async () => {
    const hydration = createDeferred<void>();
    hydrateImpl = () => hydration.promise;

    render(
      <Suspense fallback={<div data-testid="hydrating">hydrating</div>}>
        <ModernRouterClient router={createRouter('inventory')} />
      </Suspense>,
    );

    expect(screen.getByTestId('hydrating')).toBeTruthy();
    expect(screen.queryByTestId('router-provider')).toBeNull();

    hydration.resolve();

    expect(
      (await screen.findByTestId('router-provider')).textContent,
    ).toContain('inventory');
    expect(screen.queryByTestId('hydrating')).toBeNull();
  });
});
