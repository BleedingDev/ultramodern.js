// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import type { RouteObject } from '@modern-js/runtime-utils/router';
import { notFound } from '@tanstack/react-router';

import {
  isRedirectResponse,
  isResponse,
  isTanstackRedirect,
  throwTanstackRedirect,
} from '../loaderBridge';
import {
  isTanstackRscPayloadNavigationEnabled,
  loadTanstackRscRouteData,
} from '../rsc/payloadRouter';
import type {
  ModernRouteObject,
  ModernShouldRevalidate,
  RouteParams,
  RouteRevalidationState,
  RouteTreeOptions,
  TanstackLoaderContext,
} from './types';

type ModernDeferredDataLike = {
  __modern_deferred?: unknown;
  data?: unknown;
};

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

export function createModernShouldReload(
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

export function wrapRouteObjectLoader(
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
