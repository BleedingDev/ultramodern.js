import { untilAborted } from './abort';
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
import {
  DataProtocolError,
  parsePublicData,
  serializePublicData,
  toTanstackPath,
} from './data';
import type { RendererIdentity } from './identity';
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
  /** Retires every route load, as a disposed browser entry does. */
  signal?: AbortSignal;
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
    case 'deferred': {
      // The critical record makes the same codec round trip as on the wire:
      // a copy that keeps its cycles and prototype, never the loader's own
      // (possibly shared) object, then receives the deferred promises.
      const value = parsePublicData(
        serializePublicData(outcome.critical),
      ) as Record<string, unknown>;
      for (const [key, promise] of Object.entries(outcome.deferred))
        Object.defineProperty(value, key, {
          value: promise,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      return project(value);
    }
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
  const owners = [
    abortController.signal,
    ...(options.request ? [options.request.signal] : []),
    ...(options.signal ? [options.signal] : []),
  ];
  const signal = owners.length > 1 ? AbortSignal.any(owners) : owners[0]!;
  signal.throwIfAborted();
  const request = new Request(new URL(location.publicHref, base), {
    headers: options.request?.headers,
    signal,
  });
  // A custom loader that ignores its signal must not hold an aborted
  // navigation or server request.
  const outcome = await untilAborted(
    loadRoute(route, {
      request,
      routeId: route.id,
      params,
      context: options.context as Context,
    }),
    signal,
  );
  return { outcome, request, signal };
}

/** Renderer adapters race their authored router hooks with the same rule. */
export { untilAborted };

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
function applicationRouteId(
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

/** The filesystem route ids a public request URL matches, outermost first. */
export function matchApplicationRouteIds<
  Location,
  Match extends { routeId: string },
>(router: NativeRouteMatcher<Location, Match>, url: URL): string[] {
  return matchApplicationRoutes(router, url).flatMap(match => {
    const id = applicationRouteId(router, match.routeId);
    return id === undefined ? [] : [id];
  });
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

/** One route's source module namespaces, as the generated application imports them. */
export interface NativeRouteSources {
  readonly component?: { readonly default?: unknown };
  readonly pendingComponent?: { readonly default?: unknown };
  readonly errorComponent?: { readonly default?: unknown };
  readonly notFoundComponent?: { readonly default?: unknown };
  readonly head?: { readonly head?: unknown; readonly default?: unknown };
  readonly search?: {
    readonly validateSearch?: unknown;
    readonly default?: unknown;
  };
}

/** The generated module of a file-system routed entry: route sources and data. */
export interface NativeRoutedApplication {
  /** The analyzed public prefix the router strips before matching. */
  readonly basePath: string;
  readonly routeIR: readonly FileSystemRouteIR[];
  readonly routeModules: Readonly<Record<string, NativeRouteSources>>;
  readonly dataModules: Readonly<Record<string, FileSystemDataModule>>;
  /** Client graph only: routes whose loader runs on the server. */
  readonly serverDataRoutes?: readonly string[];
}

/** The generated module of an entry that renders one component. */
export interface NativeComponentApplication {
  readonly default: unknown;
}

export type NativeApplicationModule =
  | NativeRoutedApplication
  | NativeComponentApplication;

export function isRoutedApplication(
  application: NativeApplicationModule,
): application is NativeRoutedApplication {
  return 'routeIR' in application;
}

/** Structurally identical to router-core's `LocationRewrite`. */
export interface NativeLocationRewrite {
  input?: (args: { url: URL }) => undefined | string | URL;
  output?: (args: { url: URL }) => undefined | string | URL;
}

export interface NativeRouterOptions {
  readonly identity: RendererIdentity;
  readonly loadRoute: NonNullable<FileSystemRouteOptions['loadRoute']>;
  /** The server request this router renders; a browser router omits it. */
  readonly request?: Request;
  /** Retires every route load of this router, e.g. on entry disposal. */
  readonly signal?: AbortSignal;
  /** Private data-handler input; never part of native route context. */
  readonly context?: object;
  readonly onOutcome?: (routeId: string, outcome: RouteOutcome) => void;
  readonly session?: RequestSession;
  /** The document CSP nonce the router stamps on its emitted scripts. */
  readonly nonce?: string;
  readonly rewrite?: NativeLocationRewrite;
}

/** Router options a renderer passes to its native router constructor. */
export interface NativeApplicationRouterOptions<Route> {
  readonly routeTree: Route;
  readonly basepath: string;
  readonly context: {
    readonly ultramodern: Readonly<{
      rendererIdentity: Readonly<RendererIdentity>;
    }>;
  };
  readonly rewrite?: NativeLocationRewrite;
  readonly ssr?: { readonly nonce: string };
  /** A server router starts at the request location in memory history. */
  readonly location?: { readonly origin: string; readonly href: string };
}

/** The renderer's own route tree and router constructors. */
export interface NativeRouterFactory<Route, Router> {
  routeTree(
    routes: readonly FileSystemRouteIR[],
    modules: Readonly<Record<string, Record<string, unknown>>>,
    options: FileSystemRouteOptions<object, Router>,
  ): Route;
  router(options: NativeApplicationRouterOptions<Route>): Router;
}

const viewFields = [
  'component',
  'pendingComponent',
  'errorComponent',
  'notFoundComponent',
] as const;

/** Resolve one route's module namespaces into native route options. */
function resolveRouteSources(
  sources: NativeRouteSources,
): Record<string, unknown> {
  const module: Record<string, unknown> = {};
  for (const field of viewFields) {
    const source = sources[field];
    if (source) module[field] = source.default;
  }
  if (sources.head) module.head = sources.head.head ?? sources.head.default;
  if (sources.search) {
    const validateSearch =
      sources.search.validateSearch ?? sources.search.default;
    if (typeof validateSearch !== 'function')
      throw new Error(
        'A native search module must export validateSearch or a default validator',
      );
    module.validateSearch = validateSearch;
  }
  return module;
}

/** Create the native router of a generated routed application. */
export function createNativeRouter<Route, Router>(
  application: NativeRoutedApplication,
  options: NativeRouterOptions,
  factory: NativeRouterFactory<Route, Router>,
): Router {
  const context = options.context ?? {};
  if (Object.hasOwn(context, 'ultramodern'))
    throw new Error('The native router context reserves ultramodern metadata');
  const modules = Object.fromEntries(
    Object.entries(application.routeModules).map(([id, sources]) => [
      id,
      resolveRouteSources(sources),
    ]),
  );
  let router: Router | undefined;
  const routeTree = factory.routeTree(application.routeIR, modules, {
    ...(options.request ? { request: options.request } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    context,
    ...(options.onOutcome ? { onOutcome: options.onOutcome } : {}),
    ...(options.session ? { session: options.session } : {}),
    getRouter: () => {
      if (!router) throw new Error('The native router is not created yet');
      return router;
    },
    loadRoute: options.loadRoute,
  });
  const url = options.request ? new URL(options.request.url) : undefined;
  router = factory.router({
    routeTree,
    basepath: application.basePath,
    context: {
      ultramodern: Object.freeze({
        rendererIdentity: Object.freeze({ ...options.identity }),
      }),
    },
    // Matching stays on canonical paths; public URLs carry the language.
    ...(options.rewrite ? { rewrite: options.rewrite } : {}),
    // Router-emitted scripts carry the document's CSP nonce.
    ...(options.nonce === undefined ? {} : { ssr: { nonce: options.nonce } }),
    ...(url
      ? {
          location: {
            origin: url.origin,
            href: url.pathname + url.search + url.hash,
          },
        }
      : {}),
  });
  return router;
}
