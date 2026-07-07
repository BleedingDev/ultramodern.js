// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

export function mergeModernRouteHandle(route: {
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

export function createRouteStaticData(opts: {
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
