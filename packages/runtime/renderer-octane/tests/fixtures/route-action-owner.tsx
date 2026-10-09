import { useOctaneRouteAction } from '../../src/router';

/** Captures the bound action so a test can submit it, then unmount its owner. */
export const routeActionOwner: {
  fetch?: typeof globalThis.fetch;
  submit?: ReturnType<typeof useOctaneRouteAction>;
} = {};

export function RouteActionOwner() {
  routeActionOwner.submit = useOctaneRouteAction({
    fetch: routeActionOwner.fetch,
  });
  return <form data-fixture="route-action-owner" />;
}
