import {
  createDataClient,
  type PublicDataOutcome,
} from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { type AnyRouter, useMatch, useRouter } from '@octanejs/tanstack-router';
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
      await input.router.navigate({ href: outcome.location });
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
