import {
  createDataClient,
  type PublicDataOutcome,
} from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  type AnyRouter,
  redirect,
  useMatch,
  useRouter,
} from '@octanejs/tanstack-router';
import { createSubSlot, useCallback, useEffect, useRef } from 'octane';
import { assertOctaneIdentity } from './bootstrap';
import { resolveRouteData } from './routes';

/** These bindings own matching, preloading, navigation and route component lifetimes. */
export * from '@octanejs/tanstack-router';
export {
  createRouter as createApplicationRouter,
  RouterProvider as ApplicationRouter,
} from '@octanejs/tanstack-router';
export type {
  FileSystemDataModule,
  FileSystemRouteModule,
  FileSystemRouteOptions,
} from './routes';
export {
  createFileSystemRouteTree,
  matchApplicationRouteIds,
  matchApplicationRoutes,
  RouteDataError,
  resolveRouteData,
  selectApplicationDataRoute,
} from './routes';

/** Read the identity selected by this application's framework composition. */
export function useApplicationIdentity(): Readonly<RendererIdentity> {
  const identity = useRouter().options.context?.ultramodern?.rendererIdentity;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error(
      'The Octane application router is missing its renderer identity',
    );
  }
  assertOctaneIdentity(identity);
  return Object.freeze({ ...identity });
}

/** Bind an action to its nearest native route, including ancestor layouts. */
export function useApplicationRouteId(): string {
  const router = useRouter();
  const routeId = useMatch({ strict: false, select: match => match.routeId });
  if (typeof routeId !== 'string') {
    throw new Error(
      'The Octane application requires an active native route match',
    );
  }
  const id = router.routesById[routeId]?.options.staticData?.ultramodernRouteId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(
      'The Octane application route is missing its filesystem identity',
    );
  }
  return id;
}

/**
 * Native actions follow a redirect as a navigation, a GET. HTTP lets that
 * happen for 303, and for 301/302 only after POST; any other redirect keeps
 * the method and body, which a navigation would silently drop, so it fails.
 */
function assertNavigableActionRedirect(status: number, method: string): void {
  if (
    status === 307 ||
    status === 308 ||
    ((status === 301 || status === 302) && method !== 'POST')
  )
    throw new Error(
      `A native action redirect must not preserve the method (HTTP ${status} after ${method}); redirect with 303 to navigate after the mutation`,
    );
}

export interface OctaneRouteActionOptions {
  readonly router: AnyRouter;
  readonly routeId: string;
  readonly identity: RendererIdentity;
  readonly url?: string | (() => string);
  readonly method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

/** Native useActionState owns submission state and the HTML form action. */
export function createOctaneRouteAction(input: OctaneRouteActionOptions) {
  const data = createDataClient(input.routeId, input.identity, {
    fetch: input.fetch,
  });
  return async (
    _previous: PublicDataOutcome | undefined,
    formData: FormData,
  ): Promise<PublicDataOutcome> => {
    input.signal?.throwIfAborted();
    const target =
      typeof input.url === 'function'
        ? input.url()
        : (input.url ?? input.router.latestLocation.publicHref);
    const origin = input.router.options.origin ?? globalThis.location?.origin;
    const request = new Request(new URL(target, origin), {
      method: input.method ?? 'POST',
      body: formData,
      signal: input.signal,
    });
    const outcome = await data.action({ request });
    await outcome.completion;
    input.signal?.throwIfAborted();
    if (outcome.kind === 'redirect') {
      assertNavigableActionRedirect(outcome.status, request.method);
      const resolved = input.router.resolveRedirect(
        redirect({
          href: new URL(outcome.location, request.url).href,
          statusCode: outcome.status,
        }),
      );
      // Native navigation chooses document loading from the normalized href.
      await input.router.navigate({ href: resolved.options.href });
    } else if (
      (outcome.kind === 'error' || outcome.kind === 'not-found') &&
      outcome.thrown
    ) {
      resolveRouteData(input.routeId, outcome);
    } else if (outcome.kind === 'success') {
      await input.router.invalidate();
    }
    return outcome;
  };
}

export type OctaneRouteActionBinding = Pick<
  OctaneRouteActionOptions,
  'url' | 'method' | 'fetch'
>;

// Plain TypeScript is not rewritten by the Octane compiler: derive each
// composed hook's slot from the caller's, with a stable slotless fallback.
const actionSlot = createSubSlot({ slotlessPrefix: 'ultramodern-action:' });

/**
 * Bind an action to the nearest native route and to this component's
 * lifetime: unmounting aborts a submission still in flight, so its late
 * result cannot redirect or invalidate the route the user moved on to.
 */
export function useOctaneRouteAction(
  binding?: OctaneRouteActionBinding,
): ReturnType<typeof createOctaneRouteAction>;
export function useOctaneRouteAction(...args: unknown[]) {
  const tail = args.at(-1);
  const slot = typeof tail === 'symbol' ? tail : undefined;
  const binding = (
    typeof args[0] === 'object' && args[0] !== null ? args[0] : {}
  ) as OctaneRouteActionBinding;
  const router = useRouter();
  const identity = useApplicationIdentity();
  const routeId = useApplicationRouteId();
  const owner = useRef<AbortController | null>(null, actionSlot(slot, 'owner'));
  useEffect(
    () => {
      const controller = new AbortController();
      owner.current = controller;
      return () =>
        controller.abort(
          new DOMException('The route action owner unmounted', 'AbortError'),
        );
    },
    [],
    actionSlot(slot, 'lifetime'),
  );
  const { url, method, fetch } = binding;
  return useCallback(
    (previous: PublicDataOutcome | undefined, formData: FormData) =>
      createOctaneRouteAction({
        router,
        routeId,
        identity,
        url,
        method,
        fetch,
        signal: owner.current?.signal,
      })(previous, formData),
    // The identity is read from the router, so the router stands for it.
    [router, routeId, url, method, fetch],
    actionSlot(slot, 'action'),
  );
}
