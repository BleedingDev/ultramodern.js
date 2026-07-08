// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import type { RouteObject } from '@modern-js/runtime-utils/router';
import type {
  AnyRoute,
  RootRoute as TanstackRootRoute,
} from '@tanstack/react-router';

export type RouteParams = Record<string, string>;

type ModernLoader = (args: {
  request: Request;
  params: RouteParams;
  context?: unknown;
}) => unknown | Promise<unknown>;

export type ModernShouldRevalidate = (args: {
  currentParams: RouteParams;
  currentUrl: URL;
  nextParams: RouteParams;
  nextUrl: URL;
  defaultShouldRevalidate?: boolean;
}) => boolean | undefined;

export type TanstackLoaderContext = {
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

export type RouteRevalidationState = {
  currentParams?: RouteParams;
  currentUrl?: URL;
};

export type ModernRouteObject = RouteObject & {
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

export type MutableTanstackRoute = AnyRoute & {
  addChildren: (children: AnyRoute[]) => void;
  id?: string;
  options: {
    component?: unknown;
  };
};

export type TanstackRouteOptions = Record<string, unknown>;
export type TanstackRootRouteOptions = Record<string, unknown>;
export type ModernTanstackRootRoute = TanstackRootRoute;

export type RouteTreeOptions = {
  rscPayloadRouter?: boolean;
};
