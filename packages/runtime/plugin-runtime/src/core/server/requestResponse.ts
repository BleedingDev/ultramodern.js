import type { OnError } from '@modern-js/app-tools';
import { getRouterServerSnapshot } from '../../router/runtime/lifecycle';
import { handleRSCRedirect } from '../../router/runtime/redirect';
import type { TInternalRuntimeContext } from '../context';
import type { RouterCleanup } from './routerCleanup';
import { SSRErrors } from './tracer';

export type ResponseProxy = {
  headers: Record<string, string>;
  status: number;
};

export type RedirectContext = {
  enableRsc: boolean;
  isRSCNavigation: boolean;
  basename: string;
};

const isRedirectStatus = (status: number): boolean =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308;

const isNullBodyStatus = (status: number): boolean =>
  status === 204 || status === 205 || status === 304;

const getRedirectLocation = (headers: Headers): string | undefined => {
  const location = headers.get('Location');
  return location && URL.canParse(location, 'http://localhost')
    ? location
    : undefined;
};

const processRedirect = (
  headers: Headers,
  status: number,
  ctx: RedirectContext,
): Response => {
  headers.delete('content-length');
  headers.delete('transfer-encoding');

  if (ctx.enableRsc && ctx.isRSCNavigation) {
    return handleRSCRedirect(headers, ctx.basename, status);
  }

  return new Response(null, { status, headers });
};

export const applyRouterSnapshotResult = (
  context: TInternalRuntimeContext,
  onError: OnError,
): void => {
  const routerServerSnapshot = getRouterServerSnapshot(context);
  const routerStatusCode =
    routerServerSnapshot?.statusCode ?? context.routerContext?.statusCode;
  if (
    routerStatusCode !== undefined &&
    routerStatusCode !== 0 &&
    !Number.isNaN(routerStatusCode) &&
    routerStatusCode !== 200
  ) {
    context.ssrContext?.response.status(routerStatusCode);
  }

  const errors = Object.values(
    (routerServerSnapshot?.errors ||
      context.routerContext?.errors ||
      {}) as Record<string, Error>,
  );
  if (errors.length > 0) {
    onError(errors[0], SSRErrors.LOADER_ERROR);
  }
};

export const createLoaderRedirectResponse = (
  beforeRenderResult: Response | undefined,
  redirectCtx: RedirectContext,
): Response | undefined => {
  if (
    beforeRenderResult === undefined ||
    !isRedirectStatus(beforeRenderResult.status)
  ) {
    return;
  }

  if (beforeRenderResult.headers.has('X-Modernjs-Redirect')) {
    return beforeRenderResult;
  }

  const redirectUrl = getRedirectLocation(beforeRenderResult.headers);
  if (!redirectUrl) {
    return;
  }
  return processRedirect(
    new Headers(beforeRenderResult.headers),
    beforeRenderResult.status,
    redirectCtx,
  );
};

export const finalizeRenderResponse = async (
  response: Response,
  responseProxy: ResponseProxy,
  redirectCtx: RedirectContext,
  routerCleanup: RouterCleanup,
): Promise<Response> => {
  const proxyHeaders = new Headers(responseProxy.headers);
  if (
    responseProxy.status !== -1 &&
    isRedirectStatus(responseProxy.status) &&
    getRedirectLocation(proxyHeaders) !== undefined
  ) {
    await routerCleanup.discardBody(response);
    return processRedirect(proxyHeaders, responseProxy.status, redirectCtx);
  }

  const headers = new Headers(response.headers);
  Object.entries(responseProxy.headers).forEach(([key, value]) => {
    headers.set(key, value);
  });

  if (responseProxy.status !== -1) {
    if (isNullBodyStatus(responseProxy.status)) {
      await routerCleanup.discardBody(response);
      headers.delete('content-length');
      headers.delete('transfer-encoding');
      return new Response(null, {
        status: responseProxy.status,
        headers,
      });
    }

    return routerCleanup.deferUntilBodyDone(
      new Response(response.body, {
        status: responseProxy.status,
        headers,
      }),
    );
  }

  Object.entries(responseProxy.headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return routerCleanup.deferUntilBodyDone(response);
};
