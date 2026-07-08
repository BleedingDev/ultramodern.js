// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off strictBooleanExpressions:off
import { createSafeFailureResponse } from '../safe-failure';
import type { EffectBffRequestHandler } from './module';
import {
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

type EffectDispatchContextRunner = <T>(
  context: EffectContext,
  cb: () => T,
) => T;

export type DispatchEffectBffRequestOptions = {
  prefix?: string;
  env?: Record<string, unknown>;
  path?: string;
  method?: string;
  runWithEffectContext: EffectDispatchContextRunner;
  onError?: (
    error: unknown,
    context: EffectContext,
  ) => Promise<Response> | Response;
};

function normalizeEffectBffPrefix(prefix: string | undefined) {
  if (!prefix || prefix === '/') {
    return '';
  }
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

function removeEffectBffPrefixFromPath(
  pathname: string,
  prefix: string | undefined,
) {
  const normalized = normalizeEffectBffPrefix(prefix);
  if (
    !normalized ||
    (pathname !== normalized && !pathname.startsWith(`${normalized}/`))
  ) {
    return pathname;
  }
  const sliced = pathname.slice(normalized.length);
  return sliced.startsWith('/') ? sliced : `/${sliced}`;
}

function matchesEffectBffPrefix(pathname: string, prefix: string | undefined) {
  const normalized = normalizeEffectBffPrefix(prefix);
  return (
    !normalized ||
    pathname === normalized ||
    pathname.startsWith(`${normalized}/`)
  );
}

function createEffectBffMountedRequest(
  req: Request,
  prefix: string | undefined,
) {
  const url = new URL(req.url);
  const nextPath = removeEffectBffPrefixFromPath(url.pathname, prefix);
  if (nextPath !== url.pathname) {
    url.pathname = nextPath;
    return new Request(url, req);
  }
  return req;
}

function createEffectBffDispatchContext(
  originalRequest: Request,
  mountedRequest: Request,
  options: Omit<DispatchEffectBffRequestOptions, 'runWithEffectContext'>,
): EffectContext {
  const path = options.path ?? new URL(originalRequest.url).pathname;
  const method = options.method ?? originalRequest.method;
  const env = options.env ?? {};

  return {
    request: mountedRequest,
    env,
    path,
    method,
    operationContext: createEffectOperationContext({
      request: mountedRequest,
      env,
      path,
      method,
    }),
  };
}

export async function dispatchEffectBffRequestWithContext(
  handler: EffectBffRequestHandler,
  request: Request,
  options: DispatchEffectBffRequestOptions,
): Promise<Response> {
  const requestPath = new URL(request.url).pathname;
  if (!matchesEffectBffPrefix(requestPath, options.prefix)) {
    return new Response('', { status: 404 });
  }

  const mountedRequest = createEffectBffMountedRequest(request, options.prefix);
  const effectContext = createEffectBffDispatchContext(
    request,
    mountedRequest,
    options,
  );

  try {
    const response = await options.runWithEffectContext(effectContext, () =>
      handler(mountedRequest, effectContext),
    );
    if (!(response instanceof Response)) {
      throw new Error(
        '[BFF][Effect] Effect handler must return Response instance.',
      );
    }
    return new Response(response.body, response);
  } catch (error) {
    if (error instanceof Response) {
      return new Response(error.body, error);
    }
    if (options.onError) {
      const errorResponse = await options.onError(error, effectContext);
      if (errorResponse instanceof Response) {
        return errorResponse;
      }
    }
    return createSafeFailureResponse(error);
  }
}
