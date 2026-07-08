// @effect-diagnostics asyncFunction:off globalFetch:off processEnv:off strictBooleanExpressions:off
import type { PayloadRoute, ServerPayload } from '@modern-js/runtime/context';

type RouterStaticData = {
  modernRouteAction?: unknown;
  modernRouteHandle?: unknown;
  modernRouteHasAction?: unknown;
  modernRouteHasClientLoader?: unknown;
  modernRouteHasLoader?: unknown;
  modernRouteId?: unknown;
  modernRouteIsClientComponent?: unknown;
};

type RouterRouteLike = {
  id?: unknown;
  options?: {
    index?: unknown;
    path?: unknown;
    staticData?: RouterStaticData;
  };
  parentRoute?: RouterRouteLike;
};

export type RouterMatchLike = {
  error?: unknown;
  id?: unknown;
  loaderData?: unknown;
  params?: unknown;
  pathname?: unknown;
  pathnameBase?: unknown;
  route?: RouterRouteLike;
  routeId?: unknown;
};

export type TanstackPayloadRouterLike = {
  state?: {
    location?: unknown;
    matches?: unknown;
    statusCode?: unknown;
  };
};

function toPlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(Object.entries(value as Record<string, unknown>));
}

export function toPlainLocation(location: unknown): ServerPayload['location'] {
  if (!location || typeof location !== 'object') {
    return location as ServerPayload['location'];
  }

  const plainLocation = toPlainRecord(location);

  for (const key of ['search', 'state']) {
    if (
      plainLocation[key] &&
      typeof plainLocation[key] === 'object' &&
      !Array.isArray(plainLocation[key])
    ) {
      plainLocation[key] = toPlainRecord(plainLocation[key]);
    }
  }

  return plainLocation as unknown as ServerPayload['location'];
}

export function getRouteId(match: RouterMatchLike) {
  const routeId = match.routeId ?? match.route?.id ?? match.id;
  return typeof routeId === 'string' ? routeId : undefined;
}

function getRouteStaticData(match: RouterMatchLike) {
  return match.route?.options?.staticData || {};
}

function getRouteParentId(match: RouterMatchLike) {
  const parentId = match.route?.parentRoute?.id;
  return typeof parentId === 'string' ? parentId : undefined;
}

function toRoutePath(match: RouterMatchLike) {
  const path = match.route?.options?.path;
  return typeof path === 'string' ? path : undefined;
}

export function toPayloadRoute(
  match: RouterMatchLike,
): PayloadRoute | undefined {
  const routeId = getRouteId(match);
  if (!routeId) {
    return undefined;
  }

  const staticData = getRouteStaticData(match);
  const params =
    match.params && typeof match.params === 'object'
      ? (toPlainRecord(match.params) as Record<string, string>)
      : {};
  const pathname = typeof match.pathname === 'string' ? match.pathname : '';

  return {
    handle: staticData.modernRouteHandle,
    hasAction: Boolean(
      staticData.modernRouteHasAction || staticData.modernRouteAction,
    ),
    hasErrorBoundary: false,
    hasLoader: Boolean(staticData.modernRouteHasLoader),
    hasClientLoader: Boolean(staticData.modernRouteHasClientLoader),
    id: routeId,
    index: Boolean(match.route?.options?.index) || undefined,
    params,
    parentId: getRouteParentId(match),
    path: toRoutePath(match),
    pathname,
    pathnameBase:
      typeof match.pathnameBase === 'string' ? match.pathnameBase : pathname,
  };
}
