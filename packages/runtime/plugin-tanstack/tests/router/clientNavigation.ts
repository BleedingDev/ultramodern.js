import type { AnyRouter } from '@tanstack/react-router';

// Router-core navigates only on the client. Node tests perform the same
// transition a mounted RouterProvider runs: push the rewritten public URL,
// then load it.
export async function navigateOnClient(
  router: AnyRouter,
  options: Parameters<AnyRouter['buildLocation']>[0],
) {
  router.history.push(router.buildLocation(options).publicHref);
  router.updateLatestLocation();
  await router.load();
}
