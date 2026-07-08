// @effect-diagnostics asyncFunction:off globalFetch:off processEnv:off strictBooleanExpressions:off
import type { PayloadRoute, ServerPayload } from '@modern-js/runtime/context';
import { notFound } from '@tanstack/react-router';
import { serializeTanstackRscFlightValues } from './flightSerialization';
import {
  isSerializedNotFound,
  serializePayloadError,
  toRouteErrors,
  toRouteLoaderData,
} from './payloadErrors';
import {
  createPayloadFetchKey,
  fetchTanstackRscPayload,
  payloadFetchCache,
} from './payloadFetch';
import type {
  RouterMatchLike,
  TanstackPayloadRouterLike,
} from './payloadRoutes';
import { toPayloadRoute, toPlainLocation } from './payloadRoutes';

export { __setTanstackRscPayloadDecoderForTests } from './payloadFetch';

type LoadRouteDataOptions = {
  hasClientLoader?: boolean;
  loadClientData: () => Promise<unknown>;
  request: Request;
  routeId?: string;
};

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
      loaderData[payloadRoute.id] = serializeTanstackRscFlightValues(
        match.loaderData,
      );
    }

    if (typeof match.error !== 'undefined') {
      errors[payloadRoute.id] = serializePayloadError(match.error);
    }
  }

  return {
    type: 'render',
    actionData: null,
    errors: Object.keys(errors).length > 0 ? errors : null,
    loaderData,
    location: toPlainLocation(router.state?.location),
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
    if (redirectUrl === basename) {
      redirectUrl = '/';
    } else if (redirectUrl.startsWith(`${basename}/`)) {
      redirectUrl = redirectUrl.slice(basename.length);
    }
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
