// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import { DefaultNotFound } from '@modern-js/runtime/context';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import type {
  AnyRoute,
  AnyRouter,
  RootRoute as TanstackRootRoute,
} from '@tanstack/react-router';
import {
  createRootRoute,
  createRoute,
  notFound,
  rootRouteId,
} from '@tanstack/react-router';
import { createElement, type ElementType } from 'react';
import {
  isRedirectResponse,
  isResponse,
  isTanstackRedirect,
  throwTanstackRedirect,
} from './loaderBridge';
import { withModernRouteMatchContext } from './outlet';
import {
  isTanstackRscPayloadNavigationEnabled,
  loadTanstackRscRouteData,
} from './rsc/payloadRouter';

type RouteParams = Record<string, string>;

type ModernLoader = (args: {
  request: Request;
  params: RouteParams;
  context?: unknown;
}) => unknown | Promise<unknown>;

type ModernShouldRevalidate = (args: {
  currentParams: RouteParams;
  currentUrl: URL;
  nextParams: RouteParams;
  nextUrl: URL;
  defaultShouldRevalidate?: boolean;
}) => boolean | undefined;

type TanstackLoaderContext = {
  abortController?: AbortController;
  cause?: string;
  signal?: AbortSignal;
  context?: {
    request?: Request;
    requestContext?: unknown;
  };
  location?:
    | string
    | {
        publicHref?: string;
        href?: string;
        url?: { href?: string };
      };
  params?: RouteParams;
  route?: {
    id?: string;
  };
};

type RouteRevalidationState = {
  currentParams?: RouteParams;
  currentUrl?: URL;
};

type ModernRouteObject = RouteObject & {
  ErrorBoundary?: unknown;
  HydrateFallback?: unknown;
  action?: unknown;
  clientData?: unknown;
  component?: unknown;
  config?: { handle?: Record<string, unknown> } | unknown;
  file?: string;
  handle?: Record<string, unknown>;
  hasAction?: boolean;
  hasClientLoader?: boolean;
  hasLoader?: boolean;
  inValidSSRRoute?: boolean;
  isClientComponent?: boolean;
  lazyImport?: () => unknown;
  loader?: ModernLoader;
  loaderDeps?: unknown;
  pendingComponent?: unknown;
  shouldRevalidate?: ModernShouldRevalidate;
  validateSearch?: unknown;
};

type MutableTanstackRoute = AnyRoute & {
  addChildren: (children: AnyRoute[]) => void;
  id?: string;
  options: {
    component?: unknown;
  };
};

type TanstackRouteOptions = Record<string, unknown>;
type TanstackRootRouteOptions = Record<string, unknown>;
type ModernTanstackRootRoute = TanstackRootRoute;
type ModernDeferredDataLike = {
  __modern_deferred?: unknown;
  data?: unknown;
};
type ModernRouteModule = {
  Component?: unknown;
  default?: unknown;
};
type PreloadableComponent = {
  (props: Record<string, unknown>): ReturnType<typeof createElement>;
  load?: () => Promise<unknown>;
  preload?: () => Promise<unknown>;
};
type RouteTreeOptions = {
  rscPayloadRouter?: boolean;
};

function createTanstackRoute(
  options: TanstackRouteOptions,
): MutableTanstackRoute {
  return createRoute(options as never) as unknown as MutableTanstackRoute;
}

function createTanstackRootRoute(
  options: TanstackRootRouteOptions,
): MutableTanstackRoute {
  return createRootRoute(options as never) as unknown as MutableTanstackRoute;
}

function wrapRouteComponentWithModernContext(
  route: MutableTanstackRoute,
  component: unknown,
  routeId?: string,
) {
  const routeMatchId = routeId || route.id;
  if (component && routeMatchId) {
    route.options.component = withModernRouteMatchContext(
      component,
      routeMatchId,
    ) as typeof route.options.component;
  }
}

function toTanstackPath(pathname: string): string {
  // TanStack Router uses `$param` and `$` (splat) style params.
  // Modern's conventional routing currently generates React Router style params (e.g. `:id`, `*`).
  //
  // We only convert the subset Modern generates today:
  // - `:id` -> `$id`
  // - `:id?` -> `{-$id}` (optional param)
  // - `*`   -> `$`
  return pathname
    .split('/')
    .map(segment => {
      if (!segment) {
        return segment;
      }
      if (segment === '*') {
        return '$';
      }
      if (segment.startsWith(':')) {
        const name = segment.slice(1);
        if (name.endsWith('?')) {
          return `{-$${name.slice(0, -1)}}`;
        }
        return `$${name}`;
      }
      return segment;
    })
    .join('/');
}

function isModernDeferredData(
  value: unknown,
): value is ModernDeferredDataLike & { data: Record<string, unknown> } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const deferred = value as ModernDeferredDataLike;
  return (
    deferred.__modern_deferred === true &&
    Boolean(deferred.data) &&
    typeof deferred.data === 'object' &&
    !Array.isArray(deferred.data)
  );
}

function normalizeModernLoaderResult(result: unknown): unknown {
  return isModernDeferredData(result) ? result.data : result;
}

function normalizeModernLoaderResponse(result: unknown): unknown {
  if (isResponse(result)) {
    if (isRedirectResponse(result)) {
      const location = result.headers.get('Location') || '/';
      throwTanstackRedirect(location);
    }
    if (result.status === 404) {
      throw notFound();
    }
  }

  return normalizeModernLoaderResult(result);
}

export function pickRouteModuleComponent(
  routeModule: unknown,
  seen: Set<unknown> = new Set(),
): ElementType<Record<string, unknown>> | undefined {
  if (
    typeof routeModule === 'function' ||
    (routeModule &&
      typeof routeModule === 'object' &&
      '$$typeof' in routeModule)
  ) {
    return routeModule as ElementType<Record<string, unknown>>;
  }

  if (!routeModule || typeof routeModule !== 'object') {
    return undefined;
  }
  if (seen.has(routeModule)) {
    return undefined;
  }
  seen.add(routeModule);

  const module = routeModule as ModernRouteModule;
  for (const candidate of [module.default, module.Component]) {
    const component = pickRouteModuleComponent(candidate, seen);
    if (component) {
      return component;
    }
  }

  return undefined;
}

function createServerLazyImportComponent(
  lazyImport: () => unknown,
  fallbackComponent?: unknown,
): PreloadableComponent | unknown {
  if (typeof document !== 'undefined') {
    return fallbackComponent;
  }

  let resolvedComponent: ElementType<Record<string, unknown>> | undefined;
  let pendingLoad: Promise<unknown> | undefined;

  const load = async () => {
    if (resolvedComponent) {
      return resolvedComponent;
    }

    const routeModule = await lazyImport();
    const component = pickRouteModuleComponent(routeModule);
    if (component) {
      resolvedComponent = component;
    }
    return resolvedComponent;
  };

  const Component: PreloadableComponent = props => {
    if (resolvedComponent) {
      return createElement(resolvedComponent, props);
    }

    pendingLoad ||= load();
    throw pendingLoad;
  };
  Component.load = load;
  Component.preload = load;

  return Component;
}

function createModernRequest(input: string, signal: AbortSignal) {
  return new Request(input, { signal });
}

function getModernUrlFromLoaderContext(ctx: TanstackLoaderContext): URL {
  const href =
    typeof ctx?.location === 'string'
      ? ctx.location
      : ctx?.location?.publicHref ||
        ctx?.location?.href ||
        ctx?.location?.url?.href ||
        '/';
  const baseRequest: Request | undefined =
    ctx?.context?.request instanceof Request ? ctx.context.request : undefined;
  const baseUrl =
    baseRequest?.url ||
    (typeof window !== 'undefined' ? window.origin : 'http://localhost');

  return new URL(href || '/', baseUrl);
}

function rememberRouteLocation(
  state: RouteRevalidationState,
  ctx: TanstackLoaderContext,
) {
  state.currentUrl = getModernUrlFromLoaderContext(ctx);
  state.currentParams = ctx?.params || {};
}

function createModernShouldReload(
  shouldRevalidate: unknown,
  state: RouteRevalidationState,
) {
  if (typeof shouldRevalidate !== 'function') {
    return undefined;
  }
  const revalidate = shouldRevalidate as ModernShouldRevalidate;

  return (ctx: TanstackLoaderContext) => {
    const nextUrl = getModernUrlFromLoaderContext(ctx);
    const nextParams = ctx?.params || {};
    const result = revalidate({
      currentUrl: state.currentUrl || nextUrl,
      currentParams: state.currentParams || nextParams,
      nextUrl,
      nextParams,
      // Returning undefined keeps TanStack's native stale-reload default.
      defaultShouldRevalidate: undefined,
    });

    state.currentUrl = nextUrl;
    state.currentParams = nextParams;

    return typeof result === 'boolean' ? result : undefined;
  };
}

function isRouteObjectPathlessLayout(route: RouteObject) {
  return !route.path && !route.index;
}

function isRouteObjectSplatRoute(route: RouteObject) {
  return typeof route.path === 'string' && route.path.includes('*');
}

function mapParamsForRouteObjectLoader({
  route,
  params,
}: {
  route: RouteObject;
  params: RouteParams;
}) {
  if (isRouteObjectSplatRoute(route)) {
    const { _splat, ...rest } = params as RouteParams & {
      _splat?: string;
    };
    if (typeof _splat !== 'undefined') {
      return { ...rest, '*': _splat };
    }
    return rest;
  }
  return params;
}

function wrapRouteObjectLoader(
  route: RouteObject,
  revalidationState?: RouteRevalidationState,
  options: RouteTreeOptions = {},
) {
  const modernRoute = route as ModernRouteObject;
  const routeLoader = modernRoute.loader;
  if (typeof routeLoader !== 'function') {
    return undefined;
  }

  return async (ctx: TanstackLoaderContext) => {
    try {
      if (revalidationState) {
        rememberRouteLocation(revalidationState, ctx);
      }

      if (typeof modernRoute.lazyImport === 'function') {
        try {
          await modernRoute.lazyImport();
        } catch {}
      }

      const signal: AbortSignal =
        ctx?.abortController?.signal ||
        ctx?.signal ||
        new AbortController().signal;
      const baseRequest: Request | undefined =
        ctx?.context?.request instanceof Request
          ? ctx.context.request
          : undefined;

      const href =
        typeof ctx?.location === 'string'
          ? ctx.location
          : ctx?.location?.publicHref ||
            ctx?.location?.href ||
            ctx?.location?.url?.href ||
            '';

      const request =
        baseRequest !== undefined
          ? new Request(baseRequest, { signal })
          : createModernRequest(href, signal);

      const params = mapParamsForRouteObjectLoader({
        route,
        params: ctx.params || {},
      });

      const loadModernData = async () => {
        const result = await routeLoader({
          request,
          params,
          context: ctx?.context?.requestContext,
        });

        return normalizeModernLoaderResponse(result);
      };

      if (options.rscPayloadRouter && isTanstackRscPayloadNavigationEnabled()) {
        return loadTanstackRscRouteData({
          hasClientLoader:
            modernRoute.hasClientLoader ||
            typeof modernRoute.clientData !== 'undefined',
          loadClientData: loadModernData,
          request,
          routeId: ctx.route?.id,
        });
      }

      return loadModernData();
    } catch (err) {
      if (isResponse(err)) {
        if (isTanstackRedirect(err)) {
          throw err;
        }
        if (isRedirectResponse(err)) {
          const location = err.headers.get('Location') || '/';
          throwTanstackRedirect(location);
        }
        if (err.status === 404) {
          throw notFound();
        }
      }
      throw err;
    }
  };
}

function toRouteComponent(
  routeObject: RouteObject,
  options: RouteTreeOptions = {},
): unknown {
  const route = routeObject as ModernRouteObject;
  const lazyImport =
    typeof route.lazyImport === 'function' ? route.lazyImport : undefined;
  const routeComponent = route.Component || route.component;
  const fallbackComponent = routeComponent
    ? routeComponent
    : route.element
      ? () => route.element
      : undefined;

  if (lazyImport && fallbackComponent) {
    return createServerLazyImportComponent(lazyImport, fallbackComponent);
  }

  if (routeComponent) {
    return routeComponent;
  }
  const element = route.element;
  if (element) {
    return () => element;
  }
  return undefined;
}

function toErrorComponent(routeObject: RouteObject): unknown {
  const route = routeObject as ModernRouteObject;
  if (route.ErrorBoundary) {
    return route.ErrorBoundary;
  }
  if (route.errorElement) {
    return () => route.errorElement;
  }
  return undefined;
}

function toPendingComponent(routeObject: RouteObject): unknown {
  const route = routeObject as ModernRouteObject;
  return route.HydrateFallback || route.pendingComponent || undefined;
}

function mergeModernRouteHandle(route: {
  config?: { handle?: Record<string, unknown> } | unknown;
  handle?: Record<string, unknown>;
}) {
  const config = route.config as { handle?: Record<string, unknown> } | null;
  const handle = {
    ...route.handle,
    ...(config && typeof config === 'object' ? config.handle : {}),
  };

  return Object.keys(handle).length > 0 ? handle : undefined;
}

function createRouteStaticData(opts: {
  modernRouteId?: string;
  modernRouteAction?: unknown;
  modernRouteHandle?: unknown;
  modernRouteHasAction?: boolean;
  modernRouteHasClientLoader?: boolean;
  modernRouteHasLoader?: boolean;
  modernRouteIsClientComponent?: boolean;
  modernRouteLoader?: unknown;
  modernRouteShouldRevalidate?: unknown;
}) {
  const staticData: Record<string, unknown> = {};

  if (opts.modernRouteId) {
    staticData.modernRouteId = opts.modernRouteId;
  }

  if (opts.modernRouteAction) {
    staticData.modernRouteAction = opts.modernRouteAction;
  }

  if (opts.modernRouteHandle) {
    staticData.modernRouteHandle = opts.modernRouteHandle;
  }

  if (opts.modernRouteHasAction) {
    staticData.modernRouteHasAction = true;
  }

  if (opts.modernRouteHasClientLoader) {
    staticData.modernRouteHasClientLoader = true;
  }

  if (opts.modernRouteHasLoader) {
    staticData.modernRouteHasLoader = true;
  }

  if (opts.modernRouteIsClientComponent) {
    staticData.modernRouteIsClientComponent = true;
  }

  if (opts.modernRouteLoader) {
    staticData.modernRouteLoader = opts.modernRouteLoader;
  }

  if (opts.modernRouteShouldRevalidate) {
    staticData.modernRouteShouldRevalidate = opts.modernRouteShouldRevalidate;
  }

  return Object.keys(staticData).length > 0 ? staticData : undefined;
}

function createRouteFromRouteObject(opts: {
  options?: RouteTreeOptions;
  parent: AnyRoute;
  routeObject: RouteObject;
}): AnyRoute {
  const { options = {}, parent, routeObject } = opts;
  const modernRouteObject = routeObject as ModernRouteObject;
  const revalidationState: RouteRevalidationState = {};
  const shouldRevalidate = modernRouteObject.shouldRevalidate;
  const shouldReload = createModernShouldReload(
    shouldRevalidate,
    revalidationState,
  );

  const stableFallbackId =
    routeObject.id || modernRouteObject.file || routeObject.path || 'pathless';

  const component = toRouteComponent(routeObject, options);
  const base: TanstackRouteOptions = {
    getParentRoute: () => parent,
    component,
    pendingComponent: toPendingComponent(routeObject),
    errorComponent: toErrorComponent(routeObject),
    validateSearch: modernRouteObject.validateSearch,
    loaderDeps: modernRouteObject.loaderDeps,
    staticData: createRouteStaticData({
      modernRouteId: routeObject.id,
      modernRouteAction: modernRouteObject.action,
      modernRouteHandle: mergeModernRouteHandle(modernRouteObject),
      modernRouteHasAction:
        modernRouteObject.hasAction || Boolean(modernRouteObject.action),
      modernRouteHasClientLoader:
        modernRouteObject.hasClientLoader ||
        typeof modernRouteObject.clientData !== 'undefined',
      modernRouteHasLoader:
        modernRouteObject.hasLoader ||
        typeof modernRouteObject.loader === 'function',
      modernRouteIsClientComponent: modernRouteObject.isClientComponent,
      modernRouteLoader: modernRouteObject.loader,
      modernRouteShouldRevalidate: shouldRevalidate,
    }),
    loader: wrapRouteObjectLoader(routeObject, revalidationState, options),
  };
  if (modernRouteObject.inValidSSRRoute) {
    base.ssr = false;
  }
  if (shouldReload) {
    base.shouldReload = shouldReload;
  }

  if (isRouteObjectPathlessLayout(routeObject)) {
    base.id = stableFallbackId;
  } else {
    base.path = routeObject.index
      ? '/'
      : toTanstackPath((routeObject.path as string) || '');
  }

  const route = createTanstackRoute(base);
  wrapRouteComponentWithModernContext(route, component, routeObject.id);

  const children = routeObject.children;
  if (children && children.length > 0) {
    const childRoutes = children.map((child: RouteObject) =>
      createRouteFromRouteObject({
        options,
        parent: route,
        routeObject: child,
      }),
    );
    route.addChildren(childRoutes);
  }

  return route;
}

function getRootLikeRouteObject(routes: RouteObject[]) {
  return routes.find(route => route.path === '/' && !route.index);
}

export function createRouteTreeFromRouteObjects(
  routes: RouteObject[],
  options: RouteTreeOptions = {},
): ModernTanstackRootRoute {
  const rootLikeRoute = getRootLikeRouteObject(routes) as
    | ModernRouteObject
    | undefined;
  const rootRevalidationState: RouteRevalidationState = {};
  const rootShouldRevalidate = rootLikeRoute?.shouldRevalidate;
  const rootShouldReload = createModernShouldReload(
    rootShouldRevalidate,
    rootRevalidationState,
  );

  const rootComponent = rootLikeRoute
    ? toRouteComponent(rootLikeRoute)
    : undefined;
  const rootRouteOptions: TanstackRootRouteOptions = {
    component: rootComponent,
    pendingComponent: rootLikeRoute
      ? toPendingComponent(rootLikeRoute)
      : undefined,
    errorComponent: rootLikeRoute ? toErrorComponent(rootLikeRoute) : undefined,
    validateSearch: rootLikeRoute?.validateSearch,
    loaderDeps: rootLikeRoute?.loaderDeps,
    notFoundComponent: DefaultNotFound,
    staticData: createRouteStaticData({
      modernRouteId: rootLikeRoute?.id,
      modernRouteAction: rootLikeRoute?.action,
      modernRouteHandle: rootLikeRoute
        ? mergeModernRouteHandle(rootLikeRoute)
        : undefined,
      modernRouteHasAction:
        rootLikeRoute?.hasAction || Boolean(rootLikeRoute?.action),
      modernRouteHasClientLoader:
        rootLikeRoute?.hasClientLoader ||
        typeof rootLikeRoute?.clientData !== 'undefined',
      modernRouteHasLoader:
        rootLikeRoute?.hasLoader || typeof rootLikeRoute?.loader === 'function',
      modernRouteIsClientComponent: rootLikeRoute?.isClientComponent,
      modernRouteLoader: rootLikeRoute?.loader,
      modernRouteShouldRevalidate: rootShouldRevalidate,
    }),
    loader: rootLikeRoute
      ? wrapRouteObjectLoader(rootLikeRoute, rootRevalidationState, options)
      : undefined,
  };
  if (rootShouldReload) {
    rootRouteOptions.shouldReload = rootShouldReload;
  }
  if (rootLikeRoute?.inValidSSRRoute) {
    rootRouteOptions.ssr = false;
  }

  const rootRoute = createTanstackRootRoute(rootRouteOptions);
  if (rootComponent) {
    rootRoute.options.component = withModernRouteMatchContext(
      rootComponent,
      rootRouteId,
    ) as typeof rootRoute.options.component;
  }

  const topLevel = rootLikeRoute
    ? [
        ...((rootLikeRoute.children as RouteObject[] | undefined) || []),
        ...routes.filter(route => route !== rootLikeRoute),
      ]
    : routes;

  const childRoutes = topLevel.map(routeObject =>
    createRouteFromRouteObject({ options, parent: rootRoute, routeObject }),
  );

  rootRoute.addChildren(childRoutes);
  return rootRoute as unknown as ModernTanstackRootRoute;
}

export function getModernRouteIdsFromMatches(router: AnyRouter): string[] {
  const matches = router.state.matches || [];
  const routesById = (
    router as AnyRouter & {
      routesById?: Record<
        string,
        {
          options?: {
            staticData?: { modernRouteId?: unknown };
          };
        }
      >;
    }
  ).routesById;
  const ids = matches
    .map(match => {
      const normalizedMatch = match as {
        route?: {
          options?: {
            staticData?: { modernRouteId?: unknown };
          };
        };
        routeId?: unknown;
      };
      const routeId =
        typeof normalizedMatch.routeId === 'string'
          ? normalizedMatch.routeId
          : undefined;
      return (
        normalizedMatch.route?.options?.staticData?.modernRouteId ??
        (routeId
          ? routesById?.[routeId]?.options?.staticData?.modernRouteId
          : undefined)
      );
    })
    .filter((id): id is string => typeof id === 'string');
  return Array.from(new Set(ids));
}
