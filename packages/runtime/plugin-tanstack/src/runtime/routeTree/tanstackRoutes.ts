// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import { createRootRoute, createRoute } from '@tanstack/react-router';

import { withModernRouteMatchContext } from '../outlet';
import type {
  MutableTanstackRoute,
  TanstackRootRouteOptions,
  TanstackRouteOptions,
} from './types';

export function createTanstackRoute(
  options: TanstackRouteOptions,
): MutableTanstackRoute {
  return createRoute(options as never) as unknown as MutableTanstackRoute;
}

export function createTanstackRootRoute(
  options: TanstackRootRouteOptions,
): MutableTanstackRoute {
  return createRootRoute(options as never) as unknown as MutableTanstackRoute;
}

export function wrapRouteComponentWithModernContext(
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
