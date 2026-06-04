import { type ReactElement, Suspense } from 'react';

export function wrapTanstackSsrHydrationBoundary(
  routerContent: ReactElement,
  shouldWrap: boolean,
) {
  if (shouldWrap) {
    return <Suspense fallback={null}>{routerContent}</Suspense>;
  }

  return routerContent;
}
