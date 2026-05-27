// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { NestedRoute, PageRoute } from '@modern-js/types';
import type {
  AnyRoute,
  AnyRouter,
  RootRoute as TanstackRootRoute,
} from '@tanstack/react-router';
import {
  createRootRoute,
  createRoute,
  notFound,
  redirect,
} from '@tanstack/react-router';
import { createElement, type ElementType } from 'react';
import { DefaultNotFound } from './DefaultNotFound';
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
  pendingComponent?: unknown;
  shouldRevalidate?: ModernShouldRevalidate;
};

type ModernGeneratedRoute = (NestedRoute | PageRoute) & {
  _component?: string;
  action?: unknown;
  children?: ModernGeneratedRoute[];
  component?: unknown;
  config?: { handle?: Record<string, unknown> } | unknown;
  clientData?: unknown;
  data?: string;
  error?: unknown;
  errorComponent?: unknown;
  filename?: string;
  handle?: Record<string, unknown>;
  hasAction?: boolean;
  hasClientLoader?: boolean;
  hasLoader?: boolean;
  inValidSSRRoute?: boolean;
  id?: string;
  index?: boolean;
  isClientComponent?: boolean;
  isRoot?: boolean;
  lazyImport?: () => unknown;
  loader?: ModernLoader;
  loading?: unknown;
  pendingComponent?: unknown;
  path?: string;
  shouldRevalidate?: ModernShouldRevalidate;
};

type MutableTanstackRoute = AnyRoute & {
  addChildren: (children: AnyRoute[]) => void;
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

function isResponse(value: unknown): value is Response {
  const record = value as { headers?: unknown; status?: unknown } | null;
  return (
    record != null &&
    typeof record === 'object' &&
    typeof record.status === 'number' &&
    typeof record.headers === 'object'
  );
}

function isTanstackRedirect(value: unknown): boolean {
  return (
    isResponse(value) &&
    typeof (value as { options?: unknown }).options === 'object'
  );
}

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
function isRedirectResponse(res: Response) {
  return redirectStatusCodes.has(res.status);
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

function pickRouteModuleComponent(
  routeModule: unknown,
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

  const module = routeModule as ModernRouteModule;
  const component = module.default || module.Component;
  if (
    typeof component === 'function' ||
    (component && typeof component === 'object' && '$$typeof' in component)
  ) {
    return component as ElementType<Record<string, unknown>>;
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

function isAbsoluteUrl(value: string) {
  try {
    void new URL(value);
    return true;
  } catch {
    return false;
  }
}

function throwTanstackRedirect(location: string) {
  const target = location || '/';
  // Prefer `to` for internal/relative redirects so basepath can be applied.
  // Use `href` for absolute redirects (external).
  if (isAbsoluteUrl(target)) {
    throw redirect({ href: target });
  }

  throw redirect({ to: target });
}

function mapParamsForModernLoader({
  modernRoute,
  params,
}: {
  modernRoute: NestedRoute | PageRoute;
  params: RouteParams;
}) {
  // React Router uses `*` for splat params, TanStack Router uses `_splat`.
  if (modernRoute.type === 'nested' && modernRoute.path?.includes('*')) {
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

function wrapModernLoader(
  modernRoute: NestedRoute | PageRoute,
  modernLoader: ModernLoader | undefined,
  revalidationState?: RouteRevalidationState,
  options: RouteTreeOptions = {},
) {
  const route = modernRoute as ModernGeneratedRoute;
  return async (ctx: TanstackLoaderContext) => {
    try {
      if (revalidationState) {
        rememberRouteLocation(revalidationState, ctx);
      }

      if (typeof route.lazyImport === 'function') {
        try {
          await route.lazyImport();
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

      const request = baseRequest
        ? new Request(baseRequest, { signal })
        : createModernRequest(href, signal);
      const params = mapParamsForModernLoader({
        modernRoute,
        params: ctx.params || {},
      });

      const loadModernData = async () => {
        const result = modernLoader
          ? await modernLoader({
              request,
              params,
              context: ctx?.context?.requestContext,
            })
          : null;

        return normalizeModernLoaderResponse(result);
      };

      if (options.rscPayloadRouter && isTanstackRscPayloadNavigationEnabled()) {
        return loadTanstackRscRouteData({
          hasClientLoader:
            route.hasClientLoader || typeof route.clientData !== 'undefined',
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

      const request = baseRequest
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

function toRouteComponent(routeObject: RouteObject): unknown {
  const route = routeObject as ModernRouteObject;
  const lazyImport =
    typeof route.lazyImport === 'function' ? route.lazyImport : undefined;
  const fallbackComponent = route.Component
    ? route.Component
    : route.element
      ? () => route.element
      : undefined;

  if (lazyImport && fallbackComponent) {
    return createServerLazyImportComponent(lazyImport, fallbackComponent);
  }

  if (route.Component) {
    return route.Component;
  }
  const element = route.element;
  if (element) {
    return () => element;
  }
  return undefined;
}

function toModernRouteComponent(route: ModernGeneratedRoute): unknown {
  const component = route.component || undefined;
  if (typeof route.lazyImport === 'function' && component) {
    return createServerLazyImportComponent(route.lazyImport, component);
  }

  return component;
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

  const base: TanstackRouteOptions = {
    getParentRoute: () => parent,
    component: toRouteComponent(routeObject),
    pendingComponent: toPendingComponent(routeObject),
    errorComponent: toErrorComponent(routeObject),
    wrapInSuspense: true,
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

function createRouteFromModernRoute(opts: {
  options?: RouteTreeOptions;
  parent: AnyRoute;
  modernRoute: NestedRoute | PageRoute;
}): AnyRoute {
  const { options = {}, parent, modernRoute } = opts;
  const route = modernRoute as ModernGeneratedRoute;
  const revalidationState: RouteRevalidationState = {};

  const modernId = route.id;
  const stableFallbackId =
    modernId ||
    route._component ||
    route.filename ||
    route.data ||
    (typeof route.loader === 'function' ? route.id : undefined);

  const pendingComponent = route.loading || route.pendingComponent;
  const errorComponent = route.error || route.errorComponent;
  const component = toModernRouteComponent(route);
  const modernLoader = route.loader;
  const modernAction = route.action;
  const modernShouldRevalidate = route.shouldRevalidate;
  const shouldReload = createModernShouldReload(
    modernShouldRevalidate,
    revalidationState,
  );

  // Pathless layout: no path segment, but must remain in the tree.
  const isPathlessLayout =
    route.type === 'nested' &&
    typeof route.index !== 'boolean' &&
    typeof route.path === 'undefined';

  const isIndexRoute = route.type === 'nested' && Boolean(route.index);

  const base: TanstackRouteOptions = {
    getParentRoute: () => parent,
    component: component || undefined,
    pendingComponent: pendingComponent || undefined,
    errorComponent: errorComponent || undefined,
    wrapInSuspense: true,
    staticData: createRouteStaticData({
      modernRouteId: modernId,
      modernRouteAction: modernAction,
      modernRouteHandle: mergeModernRouteHandle(route),
      modernRouteHasAction: route.hasAction || Boolean(modernAction),
      modernRouteHasClientLoader:
        route.hasClientLoader || typeof route.clientData !== 'undefined',
      modernRouteHasLoader:
        route.hasLoader || typeof modernLoader === 'function',
      modernRouteIsClientComponent: route.isClientComponent,
      modernRouteLoader: modernLoader,
      modernRouteShouldRevalidate: modernShouldRevalidate,
    }),
    loader: wrapModernLoader(
      modernRoute,
      modernLoader,
      revalidationState,
      options,
    ),
  };
  if (route.inValidSSRRoute) {
    base.ssr = false;
  }
  if (shouldReload) {
    base.shouldReload = shouldReload;
  }

  if (isPathlessLayout) {
    // Use a stable custom id for pathless layouts to avoid hydration mismatch.
    base.id = stableFallbackId || 'pathless';
  } else {
    const rawPath = route.path;
    base.path = isIndexRoute ? '/' : toTanstackPath(rawPath || '');
  }

  const tanstackRoute = createTanstackRoute(base);

  const children = route.children as Array<NestedRoute | PageRoute> | undefined;
  if (children && children.length > 0) {
    const childRoutes = children.map(child =>
      createRouteFromModernRoute({
        options,
        parent: tanstackRoute,
        modernRoute: child,
      }),
    );
    tanstackRoute.addChildren(childRoutes);
  }

  return tanstackRoute;
}

export function createRouteTreeFromModernRoutes(
  routes: Array<NestedRoute | PageRoute>,
  options: RouteTreeOptions = {},
): ModernTanstackRootRoute {
  const rootModern = routes.find(
    r =>
      r &&
      (r as ModernGeneratedRoute).type === 'nested' &&
      (r as ModernGeneratedRoute).isRoot,
  ) as ModernGeneratedRoute | undefined;

  const rootComponent = rootModern
    ? toModernRouteComponent(rootModern)
    : undefined;
  const pendingComponent = rootModern?.loading;
  const errorComponent = rootModern?.error;
  const rootLoader = rootModern?.loader;
  const rootAction = rootModern?.action;
  const rootModernId = rootModern?.id;
  const rootShouldRevalidate = rootModern?.shouldRevalidate;
  const rootRevalidationState: RouteRevalidationState = {};
  const rootShouldReload = createModernShouldReload(
    rootShouldRevalidate,
    rootRevalidationState,
  );

  const rootRouteOptions: TanstackRootRouteOptions = {
    component: rootComponent || undefined,
    pendingComponent: pendingComponent || undefined,
    errorComponent: errorComponent || undefined,
    wrapInSuspense: true,
    notFoundComponent: DefaultNotFound,
    staticData: createRouteStaticData({
      modernRouteId: rootModernId,
      modernRouteAction: rootAction,
      modernRouteHandle: rootModern
        ? mergeModernRouteHandle(rootModern)
        : undefined,
      modernRouteHasAction: rootModern?.hasAction || Boolean(rootAction),
      modernRouteHasClientLoader:
        rootModern?.hasClientLoader ||
        typeof rootModern?.clientData !== 'undefined',
      modernRouteHasLoader:
        rootModern?.hasLoader || typeof rootLoader === 'function',
      modernRouteIsClientComponent: rootModern?.isClientComponent,
      modernRouteLoader: rootLoader,
      modernRouteShouldRevalidate: rootShouldRevalidate,
    }),
    loader: rootModern
      ? wrapModernLoader(rootModern, rootLoader, rootRevalidationState, options)
      : undefined,
  };
  if (rootShouldReload) {
    rootRouteOptions.shouldReload = rootShouldReload;
  }
  if (rootModern?.inValidSSRRoute) {
    rootRouteOptions.ssr = false;
  }

  const rootRoute = createTanstackRootRoute(rootRouteOptions);

  const topLevel = rootModern
    ? (rootModern.children as Array<NestedRoute | PageRoute>) || []
    : routes;

  const childRoutes = topLevel.map(child =>
    createRouteFromModernRoute({
      options,
      parent: rootRoute,
      modernRoute: child,
    }),
  );

  rootRoute.addChildren(childRoutes);
  return rootRoute as unknown as ModernTanstackRootRoute;
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

  const rootRouteOptions: TanstackRootRouteOptions = {
    component: rootLikeRoute ? toRouteComponent(rootLikeRoute) : undefined,
    pendingComponent: rootLikeRoute
      ? toPendingComponent(rootLikeRoute)
      : undefined,
    errorComponent: rootLikeRoute ? toErrorComponent(rootLikeRoute) : undefined,
    wrapInSuspense: true,
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
  const ids = matches
    .map(match => {
      const route = (
        match as {
          route?: {
            options?: {
              staticData?: { modernRouteId?: unknown };
            };
          };
        }
      ).route;
      return route?.options?.staticData?.modernRouteId;
    })
    .filter((id): id is string => typeof id === 'string');
  return Array.from(new Set(ids));
}
