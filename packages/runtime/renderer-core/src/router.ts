import type {
  DataHandler,
  DataHandlerInput,
  DataOperation,
  DataOutcome,
  DecodedDataOutcome,
  FileSystemRouteIR,
  PublicDataOutcome,
  SelectedDataRoute,
} from './data';
import { DataProtocolError, toTanstackPath } from './data';
import type { RequestSession } from './session';

// Renderer-neutral glue between filesystem routes and a native TanStack router.
// Router shapes stay structural: each adapter pins its own router-core copy,
// and router-core's class types are nominal across copies.

export interface FileSystemDataModule<Context = unknown> {
  loader?: DataHandler<Context>;
  action?: DataHandler<Context>;
}

export type RouteOutcome = DataOutcome | DecodedDataOutcome;

export interface FileSystemRouteOptions<Context = unknown, Router = unknown> {
  /** The request owned by this router; carries RequestSession.signal. */
  request?: Request;
  /** The exact request owner validates native public snapshots (Solid). */
  session?: RequestSession;
  /** Private data-handler input; never part of native route context. */
  context?: Context;
  /** Resolve the native router once its route tree is installed (Octane). */
  getRouter?: () => Router;
  loadRoute?: (
    route: FileSystemRouteIR,
    input: DataHandlerInput<Context>,
  ) => Promise<RouteOutcome>;
  /** The server resolves HTTP policy from blocking outcomes before rendering. */
  onOutcome?: (routeId: string, outcome: RouteOutcome) => void;
}

/** A route boundary receives only the public error projection and its status. */
export class RouteDataError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly routeId: string;

  constructor(
    routeId: string,
    outcome: Extract<DataOutcome | PublicDataOutcome, { kind: 'error' }>,
  ) {
    super(outcome.error.message);
    this.name = outcome.error.name;
    this.routeId = routeId;
    this.status =
      'response' in outcome ? outcome.response.status : outcome.status;
    this.data = outcome.data;
  }
}

/** The renderer binding's own redirect and not-found constructors. */
export interface NativeRouteSignals {
  redirect(options: {
    href: string;
    statusCode: number;
    headers?: HeadersInit;
  }): unknown;
  notFound(options: { data: unknown }): unknown;
}

/**
 * Turn a data outcome into loader data, or throw it into the native redirect,
 * not-found or error boundary. `project` maps every public value first.
 */
export function resolveRouteData(
  native: NativeRouteSignals,
  routeId: string,
  outcome: DataOutcome | PublicDataOutcome,
  project: (value: unknown) => unknown = value => value,
): unknown {
  switch (outcome.kind) {
    case 'success':
      return project(outcome.value);
    case 'deferred':
      return project({ ...outcome.critical, ...outcome.deferred });
    case 'redirect':
      throw native.redirect({
        href: outcome.location,
        ...('response' in outcome ? { headers: outcome.response.headers } : {}),
        statusCode:
          'response' in outcome ? outcome.response.status : outcome.status,
      });
    case 'not-found':
      throw native.notFound({ data: project(outcome.value) });
    case 'error': {
      const error = project(outcome.error);
      if (
        !error ||
        typeof error !== 'object' ||
        !('name' in error) ||
        typeof error.name !== 'string' ||
        !('message' in error) ||
        typeof error.message !== 'string'
      )
        throw new DataProtocolError('Invalid public route error');
      throw Object.freeze(
        new RouteDataError(routeId, {
          ...outcome,
          error: { name: error.name, message: error.message },
          data: project(outcome.data),
        }),
      );
    }
  }
}

/** Validate the filesystem shape: one application root and unique ids. */
export function splitFileSystemRoutes(routes: readonly FileSystemRouteIR[]): {
  root: FileSystemRouteIR | undefined;
  children: readonly FileSystemRouteIR[];
} {
  const roots = routes.filter(route => route.isRoot);
  if (roots.length > 1)
    throw new Error('A filesystem route tree requires one application root');
  const root = roots[0];
  const ids = new Set<string>();
  const visit = (route: FileSystemRouteIR, nested: boolean) => {
    if (nested && route.isRoot)
      throw new Error('An application root cannot be a child route');
    if (ids.has(route.id))
      throw new Error(`Duplicate filesystem route id: ${route.id}`);
    ids.add(route.id);
    for (const child of route.children) visit(child, true);
  };
  for (const route of routes) visit(route, false);
  return {
    root,
    children: root
      ? [...root.children, ...routes.filter(route => route !== root)]
      : routes,
  };
}

/** Native path (or pathless id) options for one filesystem route. */
export function nativeRoutePath(
  route: FileSystemRouteIR,
): { path: string } | { id: string } {
  const path = route.index ? '/' : route.path;
  return path ? { path: toTanstackPath(path) } : { id: route.id };
}

export interface NativeLoaderMatch {
  params: Record<string, string>;
  location: { publicHref: string };
  abortController: AbortController;
}

/**
 * Invoke a route's data handler for one native loader generation. The request
 * carries the public URL (basepath included) and aborts with either owner.
 */
export async function loadFileSystemRoute<Context>(
  route: FileSystemRouteIR,
  loadRoute: NonNullable<FileSystemRouteOptions<Context>['loadRoute']>,
  options: FileSystemRouteOptions<Context>,
  { params, location, abortController }: NativeLoaderMatch,
): Promise<{ outcome: RouteOutcome; request: Request; signal: AbortSignal }> {
  const base =
    options.request?.url ??
    (typeof window === 'undefined' ? undefined : window.location.href);
  if (!base) throw new Error('A server route loader requires its request');
  const signal = options.request
    ? AbortSignal.any([options.request.signal, abortController.signal])
    : abortController.signal;
  signal.throwIfAborted();
  const request = new Request(new URL(location.publicHref, base), {
    headers: options.request?.headers,
    signal,
  });
  const outcome = await loadRoute(route, {
    request,
    routeId: route.id,
    params,
    context: options.context as Context,
  });
  signal.throwIfAborted();
  return { outcome, request, signal };
}

/** Location input accepted by a native router's parseLocation. */
export interface NativeHistoryLocation {
  href: string;
  pathname: string;
  search: string;
  hash: string;
  state: { __TSR_index: number };
}

export interface NativeRouteMatch {
  routeId: string;
  params: Readonly<Record<string, string>>;
}

export interface NativeRouteMatcher<Location, Match> {
  parseLocation(location: NativeHistoryLocation): Location;
  matchRoutes(location: Location): Match[];
  routesById: Readonly<
    Record<string, { options: { staticData?: unknown } } | undefined>
  >;
}

/**
 * Match a public request URL through the router's own location parsing, so the
 * basepath (a router rewrite) is removed exactly as navigation removes it.
 */
export function matchApplicationRoutes<Location, Match>(
  router: NativeRouteMatcher<Location, Match>,
  url: URL,
): Match[] {
  return router.matchRoutes(
    router.parseLocation({
      href: url.pathname + url.search + url.hash,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      state: { __TSR_index: 0 },
    }),
  );
}

/** The filesystem route id a native route was created for. */
export function applicationRouteId(
  router: Pick<NativeRouteMatcher<unknown, unknown>, 'routesById'>,
  nativeRouteId: string,
): string | undefined {
  const staticData = router.routesById[nativeRouteId]?.options.staticData;
  const id =
    staticData && typeof staticData === 'object'
      ? Reflect.get(staticData, 'ultramodernRouteId')
      : undefined;
  return typeof id === 'string' ? id : undefined;
}

/** A requested data id must belong to the native router's match for this URL. */
export function selectApplicationDataRoute<
  Context,
  Location,
  Match extends NativeRouteMatch,
>(
  router: NativeRouteMatcher<Location, Match>,
  request: Request,
  requestedRouteId: string,
  operation: DataOperation,
  handlers: Readonly<Record<string, FileSystemDataModule<Context>>>,
): SelectedDataRoute<Context> | undefined {
  const match = matchApplicationRoutes(router, new URL(request.url)).find(
    candidate =>
      applicationRouteId(router, candidate.routeId) === requestedRouteId,
  );
  const handler = handlers[requestedRouteId]?.[operation];
  if (!match || typeof handler !== 'function') return undefined;
  return { routeId: requestedRouteId, params: match.params, handler };
}
