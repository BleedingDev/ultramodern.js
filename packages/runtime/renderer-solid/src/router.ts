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
import {
  DataProtocolError,
  toTanstackPath,
} from '@modern-js/renderer-core/data';
import type { RequestSession } from '@modern-js/renderer-core/session';
import {
  createRouteCompletionScope,
  registerRouteCompletionScope,
} from './route-completion';
import { RouteDataError, restoreRouteDataError } from './route-data-error';
import type {
  AnyRoute,
  AnyRouter,
  ErrorRouteComponent,
  NotFoundRouteComponent,
  RouteComponent,
} from './router-binding/index';
import {
  createRootRoute,
  createRoute,
  isNotFound,
  isRedirect,
  notFound,
  Outlet,
  preparePublicContextData,
  preparePublicLoaderData,
  preparePublicMatchError,
  redirect,
} from './router-binding/index';

export type {
  DataHandler,
  DataHandlerInput,
  DataOutcome,
  DecodedDataOutcome,
  PublicDataOutcome,
} from '@modern-js/renderer-core/data';
export type {
  ActionFormProps,
  RouteAction,
  RouteActionOptions,
} from './actions';
export {
  ActionForm,
  createRouteAction,
  RouteActionError,
  useRouteAction,
} from './actions';
export { ApplicationRouter } from './application-router';
// Native TanStack owns matching, transitions, cancellation and route context.
// Keep this entry separate from other renderer adapters and their type programs.
export { createApplicationRouter } from './route-completion';
export { RouteDataError } from './route-data-error';
export * from './router-binding/index';

export interface FileSystemRouteModule {
  component?: RouteComponent;
  pendingComponent?: RouteComponent;
  errorComponent?: ErrorRouteComponent;
  notFoundComponent?: NotFoundRouteComponent;
  head?: AnyRoute['options']['head'];
  /** Explicit returned context becomes immutable public native route context. */
  beforeLoad?: AnyRoute['options']['beforeLoad'];
  /** Native synchronous context contributions are checked before composition. */
  context?: AnyRoute['options']['context'];
  validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>;
}

export interface FileSystemRouteOptions<Context = unknown> {
  /** The Node request is supplied once per native router, never shared globally. */
  request?: Request;
  /** The exact request owner validates native public snapshots before rendering. */
  session?: RequestSession;
  context?: Context;
  loadRoute?: (
    route: FileSystemRouteIR,
    input: DataHandlerInput<Context>,
  ) => Promise<DataOutcome | DecodedDataOutcome>;
  /** The server resolves HTTP policy from blocking outcomes before rendering. */
  onOutcome?: (
    routeId: string,
    outcome: DataOutcome | PublicDataOutcome,
  ) => void;
}

export interface FileSystemDataModule<Context = unknown> {
  loader?: DataHandler<Context>;
  action?: DataHandler<Context>;
}

function isPublicRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Resolve location through the native router before committing HTTP headers. */
export function resolveApplicationRedirect(
  router: AnyRouter,
): Response | undefined {
  const result = router._serverResult;
  const value = result?.type === 'redirect' ? result.redirect : undefined;
  return isRedirect(value) ? router.resolveRedirect(value) : undefined;
}

/** The native server load resolves status independently from rendered UI. */
export function getApplicationStatus(router: AnyRouter): number {
  const result = router._serverResult;
  if (!result)
    throw new Error(
      'Load the native Solid router before resolving HTTP status',
    );
  return result.type === 'render' ? result.status : result.redirect.status;
}

/** Authorize a .data request against the native router's matched route chain. */
export function selectApplicationDataRoute<Context>(
  router: AnyRouter,
  request: Request,
  requestedRouteId: string,
  operation: DataOperation,
  handlers: Readonly<Record<string, FileSystemDataModule<Context>>>,
): SelectedDataRoute<Context> | undefined {
  for (const match of router.matchRoutes(new URL(request.url).pathname)) {
    const route = router.routesById[match.routeId];
    const originalId = (
      route?.options.staticData as { ultramodernRouteId?: string } | undefined
    )?.ultramodernRouteId;
    if (originalId !== requestedRouteId) continue;
    const handler = handlers[originalId]?.[operation];
    if (typeof handler !== 'function') return undefined;
    return { routeId: originalId, params: match.params, handler };
  }
  return undefined;
}

export function resolveRouteData(
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
      throw redirect({
        href: outcome.location,
        ...('response' in outcome ? { headers: outcome.response.headers } : {}),
        statusCode:
          'response' in outcome ? outcome.response.status : outcome.status,
      });
    case 'not-found':
      throw notFound({ data: project(outcome.value) });
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
        throw new DataProtocolError('Invalid public Solid route error');
      const result = new RouteDataError(routeId, {
        ...outcome,
        error: { name: error.name, message: error.message },
        data: project(outcome.data),
      });
      throw Object.freeze(result);
    }
  }
}

/** Project route structure into native factories without matching any URL. */
export function createFileSystemRouteTree<Context = unknown>(
  routes: readonly FileSystemRouteIR[],
  modules: Readonly<Record<string, FileSystemRouteModule>>,
  options: FileSystemRouteOptions<Context> = {},
): AnyRoute {
  const roots = routes.filter(route => route.isRoot);
  if (roots.length > 1) {
    throw new Error(
      'A Solid filesystem route tree requires one application root',
    );
  }
  const rootDescriptor = roots[0];
  const privateRoots =
    options.context &&
    (typeof options.context === 'object' ||
      typeof options.context === 'function')
      ? [options.context]
      : [];
  const completionScope = createRouteCompletionScope(
    privateRoots,
    options.session,
  );
  const moduleFields = new Set([
    'component',
    'pendingComponent',
    'errorComponent',
    'notFoundComponent',
    'head',
    'beforeLoad',
    'context',
    'validateSearch',
  ]);

  function routeModuleOptions(id: string): FileSystemRouteModule {
    const module = modules[id] ?? {};
    const prototype = Object.getPrototypeOf(module);
    if (prototype !== Object.prototype && prototype !== null)
      throw new DataProtocolError(
        'Native Solid filesystem route modules require plain option records',
      );
    for (const key of Reflect.ownKeys(module)) {
      const descriptor = Object.getOwnPropertyDescriptor(module, key)!;
      if (
        typeof key !== 'string' ||
        !moduleFields.has(key) ||
        descriptor.get ||
        descriptor.set
      )
        throw new DataProtocolError(
          'Unsupported native Solid filesystem route option; use the declared public route module contract',
        );
    }
    const beforeLoad = module.beforeLoad;
    const validateSearch = module.validateSearch;
    const context = module.context;
    const contextOptions = context
      ? {
          context(...args: Parameters<typeof context>) {
            const authored = context(...args);
            try {
              const value = preparePublicContextData(
                authored,
                options.session ?? completionScope.hydrationOwner,
                [options.context],
              );
              if (value !== undefined && !isPublicRecord(value))
                throw new DataProtocolError(
                  'Native Solid route context must return a synchronous public record',
                );
              return value;
            } catch (error) {
              options.session?.fail(error);
              throw error;
            }
          },
        }
      : {};
    const searchOptions = validateSearch
      ? {
          validateSearch(search: Record<string, unknown>) {
            const authored = validateSearch(search);
            try {
              const value = preparePublicContextData(
                authored,
                options.session ?? completionScope.hydrationOwner,
                [options.context],
              );
              if (!isPublicRecord(value))
                throw new DataProtocolError(
                  'Native Solid search validation must return a public record',
                );
              return value;
            } catch (error) {
              options.session?.fail(error);
              throw error;
            }
          },
        }
      : {};
    if (!beforeLoad) return { ...module, ...searchOptions, ...contextOptions };
    return {
      ...module,
      ...searchOptions,
      ...contextOptions,
      beforeLoad: async (...args: Parameters<typeof beforeLoad>) => {
        let value: unknown;
        try {
          value = await beforeLoad(...args);
        } catch (error) {
          if (isRedirect(error)) throw error;
          let projected: unknown;
          try {
            projected = isNotFound(error)
              ? preparePublicContextData(error, options.session, [
                  options.context,
                ])
              : preparePublicMatchError(error, options.session, [
                  options.context,
                ]);
          } catch (invalid) {
            options.session?.fail(invalid);
            throw invalid;
          }
          if (isNotFound(projected)) throw projected;
          if (
            projected &&
            typeof projected === 'object' &&
            Object.getOwnPropertyDescriptor(projected, 'kind')?.value ===
              'ultramodern-route-data-error'
          )
            throw Object.freeze(restoreRouteDataError(projected));
          const message =
            projected && typeof projected === 'object'
              ? Object.getOwnPropertyDescriptor(projected, 'message')?.value
              : undefined;
          const name =
            projected && typeof projected === 'object'
              ? Object.getOwnPropertyDescriptor(projected, 'name')?.value
              : undefined;
          const diagnostic = new Error(
            typeof message === 'string' ? message : 'Unexpected Server Error',
          );
          diagnostic.name = typeof name === 'string' ? name : 'Error';
          if (projected && typeof projected === 'object') {
            for (const key of ['cause', 'stack']) {
              const descriptor = Object.getOwnPropertyDescriptor(
                projected,
                key,
              );
              if (descriptor && !descriptor.get && !descriptor.set)
                Object.defineProperty(diagnostic, key, {
                  value: descriptor.value,
                  configurable: true,
                  writable: true,
                });
            }
          }
          throw Object.freeze(diagnostic);
        }
        try {
          return preparePublicContextData(
            value,
            options.session ?? completionScope.hydrationOwner,
            [options.context],
          );
        } catch (error) {
          options.session?.fail(error);
          throw error;
        }
      },
    };
  }

  function loaderOptions(route: FileSystemRouteIR) {
    const loadRoute = options.loadRoute;
    if (!(route.modules?.data || route.modules?.clientData) || !loadRoute) {
      return {};
    }
    return {
      loader: async ({
        params,
        location,
        abortController,
      }: {
        params: Record<string, string>;
        location: { href: string };
        abortController: AbortController;
      }) => {
        const base =
          options.request?.url ??
          (typeof window === 'undefined' ? undefined : window.location.href);
        if (!base) {
          throw new Error('A server Solid route loader requires its request');
        }
        const signal = options.request
          ? AbortSignal.any([options.request.signal, abortController.signal])
          : abortController.signal;
        const request = new Request(new URL(location.href, base), {
          headers: options.request?.headers,
          signal,
        });
        const outcome = await loadRoute(route, {
          request,
          routeId: route.id,
          params,
          context: options.context as Context,
        });
        options.onOutcome?.(route.id, outcome);
        signal.throwIfAborted();
        const generation = completionScope.begin(signal, () =>
          abortController.abort(),
        );
        const owner = options.session ?? generation.owner;
        const project = (value: unknown): unknown => {
          try {
            return preparePublicLoaderData(value, owner, [
              options.context,
              request,
            ]);
          } catch (error) {
            owner.fail(error);
            throw error;
          }
        };
        const value = resolveRouteData(route.id, outcome, project);
        generation.publish(
          value,
          'completion' in outcome ? outcome.completion : undefined,
        );
        return value;
      },
    };
  }

  const root = createRootRoute({
    ...routeModuleOptions(rootDescriptor?.id ?? ''),
    component: completionScope.component(
      modules[rootDescriptor?.id ?? '']?.component ?? Outlet,
    ),
    staticData: { ultramodernRouteId: rootDescriptor?.id },
    ...(rootDescriptor ? loaderOptions(rootDescriptor) : {}),
  });
  const ids = new Set<string>();
  if (rootDescriptor) ids.add(rootDescriptor.id);

  function bind(route: FileSystemRouteIR, parent: AnyRoute): AnyRoute {
    if (ids.has(route.id)) {
      throw new Error(`Duplicate filesystem route id: ${route.id}`);
    }
    ids.add(route.id);
    const path = route.index ? '/' : route.path;
    const native = createRoute({
      getParentRoute: () => parent,
      ...(path ? { path: toTanstackPath(path) } : { id: route.id }),
      ...routeModuleOptions(route.id),
      component: completionScope.component(
        modules[route.id]?.component ?? Outlet,
      ),
      staticData: { ultramodernRouteId: route.id },
      ...loaderOptions(route),
    });
    return native.addChildren(route.children.map(child => bind(child, native)));
  }

  const children = rootDescriptor
    ? [
        ...rootDescriptor.children,
        ...routes.filter(route => route !== rootDescriptor),
      ]
    : routes;
  const tree = root.addChildren(children.map(route => bind(route, root)));
  registerRouteCompletionScope(tree, completionScope);
  return tree;
}
