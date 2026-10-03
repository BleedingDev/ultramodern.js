import type { AnyRouter } from '@octanejs/tanstack-router';

const released = new WeakSet<NonNullable<AnyRouter['serverSsr']>>();

/** The request handler, serializer and renderer share one native SSR owner. */
export function cleanupOctaneRouterSSR(router: AnyRouter): void {
  const serverSsr = router.serverSsr;
  if (!serverSsr || released.has(serverSsr)) return;
  released.add(serverSsr);
  serverSsr.cleanup();
}
