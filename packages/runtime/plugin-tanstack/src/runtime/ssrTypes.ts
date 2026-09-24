import type { RequestContext } from '@modern-js/runtime-utils/node';
import type { AnyRouter } from '@tanstack/react-router';

export type ModernTanstackRouterContext = {
  request: Request;
  requestContext: RequestContext<Record<string, unknown>>;
};

export type RouterManagedTag = {
  attrs?: Record<string, unknown>;
  children?: unknown;
  tag?: unknown;
};

export type RouterMatchWithError = {
  error?: unknown;
  route?: {
    id?: unknown;
    options?: RouterRouteOptions;
  };
  routeId?: unknown;
};

type RouterRouteOptions = {
  component?: unknown;
  errorComponent?: unknown;
  notFoundComponent?: unknown;
  pendingComponent?: unknown;
};

type RouterRouteWithOptions = {
  options?: RouterRouteOptions;
};

export type TanstackRouterWithServerSsr = AnyRouter & {
  routesById?: Record<string, RouterRouteWithOptions>;
  state: AnyRouter['state'] & {
    matches?: unknown;
  };
};
