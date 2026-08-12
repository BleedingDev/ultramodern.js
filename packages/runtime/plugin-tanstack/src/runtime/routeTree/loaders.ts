// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import type { RouteObject } from '@modern-js/runtime-utils/router';
import {
  getLoaderHref,
  handleModernLoaderError,
  handleModernLoaderResult,
  mapSplatParamsForModernLoader,
} from '../loaderBridge';
import {
  isTanstackRscPayloadNavigationEnabled,
  loadTanstackRscRouteData,
} from '../rsc/payloadRouter';
import type {
  ModernRouteObject,
  ModernShouldRevalidate,
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
  return normalizeModernLoaderResult(handleModernLoaderResult(result));
}

function getModernUrlFromLoaderContext(ctx: TanstackLoaderContext): URL {
  const href = getLoaderHref(ctx) || '/';
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

      const href = getLoaderHref(ctx);

      const request =
        baseRequest !== undefined
          ? new Request(baseRequest, { signal })
          : new Request(href, { signal });

      const params = mapSplatParamsForModernLoader(
        ctx.params || {},
        typeof route.path === 'string' && route.path.includes('*'),
      );

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
      handleModernLoaderError(err);
    }
  };
}
