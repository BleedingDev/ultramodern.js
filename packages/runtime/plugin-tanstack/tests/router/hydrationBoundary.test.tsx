import { isValidElement, Suspense } from 'react';
import { wrapTanstackSsrHydrationBoundary } from '../../src/runtime/hydrationBoundary';

describe('tanstack SSR hydration boundary', () => {
  it('wraps SSR hydration content in a Suspense boundary', () => {
    const routerContent = <main data-testid="router" />;

    const wrapped = wrapTanstackSsrHydrationBoundary(routerContent, true);

    expect(isValidElement(wrapped)).toBe(true);
    expect(wrapped.type).toBe(Suspense);
    expect(wrapped.props.fallback).toBe(null);
    expect(wrapped.props.children).toBe(routerContent);
  });

  it('keeps non-SSR router content unwrapped', () => {
    const routerContent = <main data-testid="router" />;

    expect(wrapTanstackSsrHydrationBoundary(routerContent, false)).toBe(
      routerContent,
    );
  });
});
