import { type ReactElement, Suspense } from 'react';

export function wrapTanstackSsrHydrationBoundary(
  routerContent: ReactElement,
  shouldWrap: boolean,
) {
  return shouldWrap ? (
    <Suspense fallback={null}>{routerContent}</Suspense>
  ) : (
    routerContent
  );
}
