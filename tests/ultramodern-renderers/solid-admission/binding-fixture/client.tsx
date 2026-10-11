import { RouterProvider } from '@modern-js/renderer-solid/router';
import { hydrate } from '@solidjs/web';
import { createProbeRouter } from './routes';

function assertImmutableMatches(
  router: ReturnType<typeof createProbeRouter>['router'],
) {
  for (const match of router.stores.matches.get()) {
    if (!Object.isFrozen(match.context))
      throw new Error(
        'Native public route context was mutable at client publication',
      );
    if (match.context.tenant && !Object.isFrozen(match.context.tenant))
      throw new Error(
        'Native public nested context was mutable at client publication',
      );
    if (
      match.loaderData &&
      typeof match.loaderData === 'object' &&
      !Object.isFrozen(match.loaderData)
    )
      throw new Error(
        'Native public loader data was mutable at client publication',
      );
  }
}

async function probe(mode: string) {
  const { router, counters } = createProbeRouter('client');
  const transferred = router.stores.matches.get().length;
  if (mode !== 'sync') {
    await router.load();
    assertImmutableMatches(router);
    return {
      transferred,
      loaderCalls: counters.loader,
      beforeLoadCalls: counters.beforeLoad,
      loaderData: router.stores.matches.get().at(-1)?.loaderData,
    };
  }
  assertImmutableMatches(router);
  const original = document.getElementById('loader-value');
  const dispose = hydrate(
    () => <RouterProvider router={router} />,
    document.getElementById('root')!,
  );
  await new Promise(resolve => requestAnimationFrame(resolve));
  await new Promise(resolve => requestAnimationFrame(resolve));
  const result = {
    transferred,
    sameNode: document.getElementById('loader-value') === original,
    loaderCalls: counters.loader,
    beforeLoadCalls: counters.beforeLoad,
    routeContextCalls: counters.routeContext,
    beforeLoadOwner: router.stores.matches.get().at(-1)?.context.ownerMarker,
    routeContext: document.getElementById('route-context')?.textContent,
    routeOwner: router.stores.matches.get().at(-1)?.context.routeOwner,
    optionsOwner: router.stores.matches.get().at(-1)?.context.optionsOwner,
    tenant: router.stores.matches.get().at(-1)?.context.tenant,
    text: document.getElementById('loader-value')?.textContent,
    hydrated: document.getElementById('hydration-state')?.textContent,
    clientOnly: document.getElementById('client-only')?.textContent,
    fallback: document.getElementById('fallback')?.textContent ?? null,
    loaderData: router.stores.matches.get().at(-1)?.loaderData,
  };
  dispose();
  return result;
}

Object.assign(globalThis, { runBindingProbe: probe });
