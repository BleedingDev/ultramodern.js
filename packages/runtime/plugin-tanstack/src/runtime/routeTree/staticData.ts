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
