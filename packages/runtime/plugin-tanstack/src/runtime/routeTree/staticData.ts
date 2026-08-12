// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

export function mergeModernRouteHandle(route: {
  config?: unknown;
  handle?: Record<string, unknown>;
  [key: string]: unknown;
}) {
  const config = route.config as { handle?: Record<string, unknown> } | null;
  const handle = {
    ...route.handle,
    ...(config && typeof config === 'object' ? config.handle : {}),
  };

  return Object.keys(handle).length > 0 ? handle : undefined;
}
