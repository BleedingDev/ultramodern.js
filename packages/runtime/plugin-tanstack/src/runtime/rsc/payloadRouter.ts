// @effect-diagnostics asyncFunction:off globalFetch:off strictBooleanExpressions:off
import type { PayloadRoute, ServerPayload } from '@modern-js/runtime/context';
import { notFound, redirect } from '@tanstack/react-router';

type PayloadDecoder = (stream: ReadableStream<Uint8Array>) => Promise<unknown>;

type RouterStaticData = {
  modernRouteAction?: unknown;
  modernRouteHandle?: unknown;
  modernRouteHasAction?: unknown;
  modernRouteHasClientLoader?: unknown;
  modernRouteHasLoader?: unknown;
  modernRouteId?: unknown;
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

type RouterMatchLike = {
  error?: unknown;
  id?: unknown;
  loaderData?: unknown;
  params?: unknown;
  pathname?: unknown;
  pathnameBase?: unknown;
  route?: RouterRouteLike;
  routeId?: unknown;
};

type TanstackPayloadRouterLike = {
  state?: {
    location?: unknown;
    matches?: unknown;
    statusCode?: unknown;
  };
};

type LoadRouteDataOptions = {
  hasClientLoader?: boolean;
  loadClientData: () => Promise<unknown>;
  request: Request;
  routeId?: string;
};

const payloadFetchCache = new Map<string, Promise<ServerPayload>>();
let payloadDecoder: PayloadDecoder | undefined;

function getRouteId(match: RouterMatchLike) {
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

function toPayloadRoute(match: RouterMatchLike): PayloadRoute | undefined {
  const routeId = getRouteId(match);
  if (!routeId) {
    return undefined;
  }

  const staticData = getRouteStaticData(match);
  const params =
    match.params && typeof match.params === 'object'
      ? (match.params as Record<string, string>)
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

export function createTanstackRscServerPayload(
  router: TanstackPayloadRouterLike,
  options: {
    omitClientLoaderData?: boolean;
  } = {},
): ServerPayload {
  const matches = Array.isArray(router.state?.matches)
    ? (router.state.matches as RouterMatchLike[])
    : [];
  const routes: PayloadRoute[] = [];
  const loaderData: Record<string, unknown> = {};
  const errors: Record<string, unknown> = {};

  for (const match of matches) {
    const payloadRoute = toPayloadRoute(match);
    if (!payloadRoute) {
      continue;
    }

    routes.push(payloadRoute);

    if (
      'loaderData' in match &&
      typeof match.loaderData !== 'undefined' &&
      !(options.omitClientLoaderData && payloadRoute.hasClientLoader)
    ) {
      loaderData[payloadRoute.id] = match.loaderData;
    }

    if (typeof match.error !== 'undefined') {
      errors[payloadRoute.id] = match.error;
    }
  }

  return {
    type: 'render',
    actionData: null,
    errors: Object.keys(errors).length > 0 ? errors : null,
    loaderData,
    location: router.state?.location as ServerPayload['location'],
    routes,
  };
}

export function handleTanstackRscRedirect(
  headers: Headers,
  basename: string,
  status: number,
): Response {
  const newHeaders = new Headers(headers);
  let redirectUrl = headers.get('Location') || '/';

  if (basename !== '/') {
    redirectUrl = redirectUrl.replace(basename, '') || '/';
  }

  newHeaders.set('X-Modernjs-Redirect', redirectUrl);
  newHeaders.set('X-Modernjs-BaseUrl', basename);
  newHeaders.delete('Location');

  return new Response(null, {
    headers: newHeaders,
    status,
  });
}

export function isTanstackRscPayloadNavigationEnabled() {
  return typeof window !== 'undefined';
}

async function decodePayload(stream: ReadableStream<Uint8Array>) {
  if (payloadDecoder) {
    return payloadDecoder(stream);
  }

  const runtime = await import('@modern-js/runtime/rsc/client');
  return runtime.createFromReadableStream(stream);
}

function isServerPayload(value: unknown): value is ServerPayload {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as ServerPayload).type === 'render' &&
    Array.isArray((value as ServerPayload).routes)
  );
}

function createPayloadFetchKey(request: Request) {
  return request.url;
}

function isAbsoluteUrl(value: string) {
  try {
    void new URL(value);
    return true;
  } catch {
    return false;
  }
}

async function fetchTanstackRscPayload(request: Request) {
  const headers = new Headers(request.headers);
  headers.set('x-rsc-tree', 'true');

  const response = await fetch(request.url, {
    credentials: 'same-origin',
    headers,
    method: 'GET',
    signal: request.signal,
  });

  const redirectLocation = response.headers.get('X-Modernjs-Redirect');
  if (redirectLocation) {
    if (isAbsoluteUrl(redirectLocation)) {
      throw redirect({ href: redirectLocation });
    }
    throw redirect({ to: redirectLocation || '/' });
  }

  if (response.status === 404 && !response.body) {
    throw notFound();
  }

  if (!response.body) {
    throw new Error('TanStack RSC payload response body is null.');
  }

  const payload = await decodePayload(response.body);
  if (!isServerPayload(payload)) {
    throw new Error('Unexpected TanStack RSC payload type.');
  }

  return payload;
}

export function loadTanstackRscPayload(request: Request) {
  const key = createPayloadFetchKey(request);
  let payloadPromise = payloadFetchCache.get(key);
  if (!payloadPromise) {
    payloadPromise = fetchTanstackRscPayload(request).finally(() => {
      payloadFetchCache.delete(key);
    });
    payloadFetchCache.set(key, payloadPromise);
  }
  return payloadPromise;
}

function isSerializedNotFound(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { isNotFound?: unknown }).isNotFound === true
  );
}

function toRouteErrors(payload: ServerPayload) {
  return payload.errors && typeof payload.errors === 'object'
    ? (payload.errors as Record<string, unknown>)
    : {};
}

function toRouteLoaderData(payload: ServerPayload) {
  return payload.loaderData && typeof payload.loaderData === 'object'
    ? (payload.loaderData as Record<string, unknown>)
    : {};
}

export async function loadTanstackRscRouteData({
  hasClientLoader,
  loadClientData,
  request,
  routeId,
}: LoadRouteDataOptions) {
  if (hasClientLoader) {
    return loadClientData();
  }

  if (!routeId) {
    return loadClientData();
  }

  const payload = await loadTanstackRscPayload(request);
  const errors = toRouteErrors(payload);
  const routeError = errors[routeId];
  if (typeof routeError !== 'undefined') {
    if (isSerializedNotFound(routeError)) {
      throw notFound({
        ...(routeError as Record<string, unknown>),
        routeId,
      });
    }
    throw routeError;
  }

  const loaderData = toRouteLoaderData(payload);
  if (routeId in loaderData) {
    return loaderData[routeId];
  }

  const payloadRoute = payload.routes.find(route => route.id === routeId);
  if (payloadRoute && payloadRoute.hasClientLoader) {
    return loadClientData();
  }

  return undefined;
}

export function __setTanstackRscPayloadDecoderForTests(
  decoder?: PayloadDecoder,
) {
  payloadDecoder = decoder;
  payloadFetchCache.clear();
}
