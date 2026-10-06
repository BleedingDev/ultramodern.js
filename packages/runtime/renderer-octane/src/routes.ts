import type {
  DataHandler,
  DataHandlerInput,
  DataOperation,
  DataOutcome,
  DecodedDataOutcome,
  FileSystemRouteIR,
  PublicDataOutcome,
  SelectedDataRoute,
} from '@modern-js/renderer-core/data';
import { toTanstackPath } from '@modern-js/renderer-core/data';
import {
  type AnyRoute,
  type AnyRouteMatch,
  type AnyRouter,
  createRootRoute,
  createRoute,
  ErrorComponent,
  type ErrorRouteComponent,
  HeadContent,
  type NotFoundRouteComponent,
  notFound,
  Outlet,
  type RouteComponent,
  redirect,
  Scripts,
} from '@octanejs/tanstack-router';
import { createElement, Fragment } from 'octane';

/** Generated imports contain native view bindings, keyed by the structural id. */
export interface FileSystemRouteModule {
  component?: RouteComponent;
  pendingComponent?: RouteComponent;
  errorComponent?: ErrorRouteComponent;
  notFoundComponent?: NotFoundRouteComponent;
  validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>;
  head?: AnyRoute['options']['head'];
}

export interface FileSystemRouteOptions<Context = unknown> {
  /** The Node request belongs to this router and carries RequestSession.signal. */
  request?: Request;
  /** Private data-handler input; native beforeLoad context belongs to its match. */
  context?: Context;
  /** Resolve the native router only after its route tree has been installed. */
  getRouter?: () => AnyRouter;
  loadRoute?: (
    route: FileSystemRouteIR,
    input: DataHandlerInput<Context>,
  ) => Promise<DataOutcome | DecodedDataOutcome>;
  onOutcome?: (
    routeId: string,
    outcome: DataOutcome | DecodedDataOutcome,
  ) => void;
}

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

/** Native route boundaries decide how redirects, missing data and errors render. */
export function resolveRouteData(
  routeId: string,
  outcome: DataOutcome | PublicDataOutcome,
): unknown {
  switch (outcome.kind) {
    case 'success':
      return outcome.value;
    case 'deferred':
      return { ...outcome.critical, ...outcome.deferred };
    case 'redirect':
      throw redirect({
        href: outcome.location,
        statusCode:
          'response' in outcome ? outcome.response.status : outcome.status,
        ...('response' in outcome
          ? { headers: new Headers(outcome.response.headers) }
          : {}),
      });
    case 'not-found':
      throw notFound({ data: outcome.value });
    case 'error':
      throw new RouteDataError(routeId, outcome);
  }
}

interface ReactiveNativeMatch {
  get(): AnyRouteMatch;
  subscribe(callback: () => void): { unsubscribe(): void };
}

function isReactiveNativeMatch(value: unknown): value is ReactiveNativeMatch {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'get') === 'function' &&
    typeof Reflect.get(value, 'subscribe') === 'function'
  );
}

/** A transport failure belongs to the native generation that fetched it. */
function observeRouteCompletion(
  router: AnyRouter,
  controller: AbortController,
  signal: AbortSignal,
  completion: Promise<void>,
) {
  void completion.catch(error => {
    if (signal.aborted) return;
    const match = [
      ...router.stores.pendingMatches.get(),
      ...router.stores.matches.get(),
      ...router.stores.cachedMatches.get(),
    ].find(candidate => candidate.abortController === controller);
    if (!match) return;
    const store = [
      router.stores.pendingMatchStores.get(match.id),
      router.stores.matchStores.get(match.id),
      router.stores.cachedMatchStores.get(match.id),
    ].find(candidate => candidate?.get().abortController === controller);
    if (!store) return;
    let subscription: { unsubscribe(): void } | undefined;
    let settled = false;
    const cleanup = () => {
      subscription?.unsubscribe();
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      settled = true;
      cleanup();
    };
    const publish = () => {
      if (settled) return;
      const current = store.get();
      if (
        current.abortController !== controller ||
        signal.aborted ||
        (current.status !== 'pending' && current.status !== 'success')
      ) {
        onAbort();
        return;
      }
      // The initial loader can still be pending after its critical value returns.
      if (current.status !== 'success' || current.isFetching) return;
      settled = true;
      cleanup();
      const route = router.routesById[current.routeId];
      let failure = error;
      try {
        route?.options.onError?.(failure);
      } catch (onErrorFailure) {
        failure = onErrorFailure;
      }
      // Native successful loads have already preloaded their route components.
      if (signal.aborted) return;
      router.updateMatch(match.id, previous =>
        previous.abortController === controller &&
        previous.status === 'success' &&
        !previous.isFetching
          ? {
              ...previous,
              error: failure,
              status: 'error',
              isFetching: false,
            }
          : previous,
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (isReactiveNativeMatch(store)) subscription = store.subscribe(publish);
    if (settled) subscription?.unsubscribe();
    else publish();
  });
}

/** Pass filesystem structure to native factories without matching any URL. */
export function createFileSystemRouteTree<Context = unknown>(
  routes: readonly FileSystemRouteIR[],
  modules: Readonly<Record<string, FileSystemRouteModule>>,
  options: FileSystemRouteOptions<Context> = {},
): AnyRoute {
  const roots = routes.filter(route => route.isRoot);
  if (roots.length > 1) {
    throw new Error(
      'An Octane filesystem route tree requires one application root',
    );
  }
  const rootDescriptor = roots[0];
  const ids = new Set<string>();

  function bindings(
    route: FileSystemRouteIR,
    errorComponent?: ErrorRouteComponent,
  ) {
    if (ids.has(route.id)) {
      throw new Error(`Duplicate filesystem route id: ${route.id}`);
    }
    ids.add(route.id);
    const needsData = Boolean(route.modules?.data || route.modules?.clientData);
    if (needsData && !options.loadRoute) {
      throw new Error(`An Octane data route requires its loader: ${route.id}`);
    }
    const loadRoute = options.loadRoute;
    const { head, ...module } = modules[route.id] ?? {};
    return {
      ...module,
      ...(head !== undefined ? { head } : {}),
      // Octane's server renders an uncaught match error through the root
      // outlet's Suspense, which defers it to a client retry that then
      // replaces the whole layout. Give every child match the nearest
      // error.tsx (or the native default) so the error renders in place.
      ...(errorComponent ? { errorComponent } : {}),
      component: module.component ?? Outlet,
      staticData: { ultramodernRouteId: route.id },
      ...(needsData && loadRoute
        ? {
            loader: async ({
              params,
              location,
              abortController,
            }: {
              params: Record<string, string>;
              location: { publicHref: string };
              abortController: AbortController;
            }) => {
              const base =
                options.request?.url ??
                (typeof window === 'undefined'
                  ? undefined
                  : window.location.href);
              if (!base) {
                throw new Error(
                  'A server Octane route loader requires its request',
                );
              }
              const signal = options.request
                ? AbortSignal.any([
                    options.request.signal,
                    abortController.signal,
                  ])
                : abortController.signal;
              signal.throwIfAborted();
              // A basepath is a router rewrite: only publicHref keeps the
              // URL that the server and data endpoints actually serve.
              const request = new Request(new URL(location.publicHref, base), {
                ...(options.request
                  ? { headers: options.request.headers }
                  : {}),
                signal,
              });
              const outcome = await loadRoute(route, {
                request,
                routeId: route.id,
                params,
                context: options.context as Context,
              });
              signal.throwIfAborted();
              if ('completion' in outcome && outcome.completion) {
                const router = options.getRouter?.();
                if (!router) {
                  throw new Error(
                    'An Octane streamed data route requires its native router',
                  );
                }
                let failed = false;
                let failure: unknown;
                void outcome.completion.catch(error => {
                  failed = true;
                  failure = error;
                });
                // Detect a terminal failure already received with the first frame.
                await Promise.resolve();
                signal.throwIfAborted();
                if (failed) throw failure;
                observeRouteCompletion(
                  router,
                  abortController,
                  signal,
                  outcome.completion,
                );
              }
              options.onOutcome?.(route.id, outcome);
              return resolveRouteData(route.id, outcome);
            },
          }
        : {}),
    };
  }

  const rootBindings = rootDescriptor
    ? bindings(rootDescriptor)
    : { component: Outlet };
  const authoredRoot: RouteComponent = rootBindings.component;
  function OctaneDocumentRoot(props: Parameters<RouteComponent>[0]) {
    return createElement(
      Fragment,
      null,
      createElement(HeadContent),
      createElement(authoredRoot, props),
      createElement(Scripts),
    );
  }
  if (authoredRoot.preload !== undefined) {
    OctaneDocumentRoot.preload = authoredRoot.preload;
  }
  const rootErrorComponent =
    (rootDescriptor && modules[rootDescriptor.id]?.errorComponent) ||
    ErrorComponent;
  const root = createRootRoute({
    ...rootBindings,
    component: OctaneDocumentRoot,
  });

  function bind(
    route: FileSystemRouteIR,
    parent: AnyRoute,
    inheritedErrorComponent: ErrorRouteComponent,
  ): AnyRoute {
    if (route.isRoot) {
      throw new Error('An Octane application root cannot be a child route');
    }
    const path = route.index ? '/' : route.path;
    const errorComponent =
      modules[route.id]?.errorComponent ?? inheritedErrorComponent;
    const native = createRoute({
      getParentRoute: () => parent,
      ...(path ? { path: toTanstackPath(path) } : { id: route.id }),
      ...bindings(route, errorComponent),
    });
    return native.addChildren(
      route.children.map(child => bind(child, native, errorComponent)),
    );
  }

  return root.addChildren(
    (rootDescriptor
      ? [
          ...rootDescriptor.children,
          ...routes.filter(route => route !== rootDescriptor),
        ]
      : routes
    ).map(route => bind(route, root, rootErrorComponent)),
  );
}

export interface FileSystemDataModule<Context = unknown> {
  loader?: DataHandler<Context>;
  action?: DataHandler<Context>;
}

/**
 * Match a public request URL through the router's own location parsing, so the
 * basepath (a router rewrite) is removed exactly as navigation removes it.
 */
export function matchApplicationRoutes(
  router: AnyRouter,
  url: URL,
): AnyRouteMatch[] {
  const href = url.pathname + url.search + url.hash;
  const location = router.parseLocation({
    href,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    state: { __TSR_index: 0 },
  });
  return router.matchRoutes(location);
}

/** A requested data id must belong to the native router's match for this URL. */
export function selectApplicationDataRoute<Context = unknown>(
  router: AnyRouter,
  request: Request,
  requestedRouteId: string,
  operation: DataOperation,
  handlers: Readonly<Record<string, FileSystemDataModule<Context>>>,
): SelectedDataRoute<Context> | undefined {
  const match = matchApplicationRoutes(router, new URL(request.url)).find(
    candidate => {
      const route = router.routesById[candidate.routeId];
      return route?.options.staticData?.ultramodernRouteId === requestedRouteId;
    },
  );
  const handler = handlers[requestedRouteId]?.[operation];
  if (!match || !handler) return undefined;
  return { routeId: requestedRouteId, params: match.params, handler };
}
