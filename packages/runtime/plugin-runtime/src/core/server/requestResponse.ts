import type { OnError } from '@modern-js/app-tools';
import { getRouterServerSnapshot } from '../../router/runtime/lifecycle';
import { handleRSCRedirect } from '../../router/runtime/rsc-router';
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
  status >= 300 && status <= 399;

const isNullBodyStatus = (status: number): boolean =>
  status === 204 || status === 205 || status === 304;

const processRedirect = (
  headers: Headers,
  status: number,
  ctx: RedirectContext,
): Response => {
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

  const redirectUrl = beforeRenderResult.headers.get('Location') || '/';
  return processRedirect(
    new Headers({ Location: redirectUrl }),
    beforeRenderResult.status,
    redirectCtx,
  );
};

export const finalizeRenderResponse = (
  response: Response,
  responseProxy: ResponseProxy,
  redirectCtx: RedirectContext,
  routerCleanup: RouterCleanup,
): Response => {
  if (
    responseProxy.status !== -1 &&
    isRedirectStatus(responseProxy.status) &&
    responseProxy.headers.Location !== undefined &&
    responseProxy.headers.Location !== ''
  ) {
    return processRedirect(
      new Headers(responseProxy.headers),
      responseProxy.status,
      redirectCtx,
    );
  }

  Object.entries(responseProxy.headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  if (responseProxy.status !== -1) {
    return routerCleanup.deferUntilBodyDone(
      new Response(
        isNullBodyStatus(responseProxy.status) ? null : response.body,
        {
          status: responseProxy.status,
          headers: response.headers,
        },
      ),
    );
  }

  return routerCleanup.deferUntilBodyDone(response);
};
