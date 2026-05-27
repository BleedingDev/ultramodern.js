// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off strictBooleanExpressions:off

import type {
  EffectBffOpenApiConfig,
  EffectDataPlatformValidationOptions,
} from './handler';
import {
  type EffectApiModule,
  type EffectBffRequestHandler,
  resolveEffectBffModuleHandler,
} from './module';
import {
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

export * from './handler';
export {
  type CreateEffectOperationContextOptions,
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

export type EffectBffEdgeDispatchOptions = {
  prefix?: string;
  env?: Record<string, unknown>;
  path?: string;
  method?: string;
  onError?: (
    error: unknown,
    context: EffectContext,
  ) => Promise<Response> | Response;
};

export type EffectBffEdgeHandlerOptions = {
  module: EffectApiModule;
  prefix?: string;
  openapi?: EffectBffOpenApiConfig;
  dataPlatform?: EffectDataPlatformValidationOptions;
  onError?: (
    error: unknown,
    context: EffectContext,
  ) => Promise<Response> | Response;
  onWarning?: (message: string) => void;
};

function normalizePrefix(prefix: string | undefined) {
  if (!prefix || prefix === '/') {
    return '';
  }
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

function removePrefixFromPath(pathname: string, prefix: string | undefined) {
  const normalized = normalizePrefix(prefix);
  if (
    !normalized ||
    (pathname !== normalized && !pathname.startsWith(`${normalized}/`))
  ) {
    return pathname;
  }
  const sliced = pathname.slice(normalized.length);
  return sliced.startsWith('/') ? sliced : `/${sliced}`;
}

function matchesPrefix(pathname: string, prefix: string | undefined) {
  const normalized = normalizePrefix(prefix);
  return (
    !normalized ||
    pathname === normalized ||
    pathname.startsWith(`${normalized}/`)
  );
}

function createRequestForMountedPrefix(
  req: Request,
  prefix: string | undefined,
) {
  const url = new URL(req.url);
  const nextPath = removePrefixFromPath(url.pathname, prefix);
  if (nextPath === url.pathname) {
    return req;
  }
  url.pathname = nextPath;
  return new Request(url, req);
}

function createEdgeEffectContext(
  originalRequest: Request,
  effectRequest: Request,
  options: EffectBffEdgeDispatchOptions,
): EffectContext {
  const originalPath = options.path || new URL(originalRequest.url).pathname;
  const method = options.method || originalRequest.method;
  return {
    request: effectRequest,
    env: options.env || {},
    path: originalPath,
    method,
    operationContext: createEffectOperationContext({
      request: effectRequest,
      env: options.env || {},
      path: originalPath,
      method,
    }),
  };
}

function createRuntimeErrorResponse(error: unknown) {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : 500;

  return new Response(
    JSON.stringify({
      message:
        error instanceof Error ? error.message : '[BFF] Internal Server Error',
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    },
  );
}

export async function dispatchEffectBffRequest(
  handler: EffectBffRequestHandler,
  request: Request,
  options: EffectBffEdgeDispatchOptions = {},
) {
  const requestPathname = new URL(request.url).pathname;
  if (!matchesPrefix(requestPathname, options.prefix)) {
    return new Response(null, { status: 404 });
  }

  const effectRequest = createRequestForMountedPrefix(request, options.prefix);
  const effectContext = createEdgeEffectContext(
    request,
    effectRequest,
    options,
  );

  try {
    const response =
      handler.length > 1
        ? await handler(effectRequest, effectContext)
        : await handler(effectRequest);

    if (!(response instanceof Response)) {
      throw new Error(
        '[BFF][Effect] Effect handler must return a Response instance.',
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
    return createRuntimeErrorResponse(error);
  }
}

export async function createEffectBffEdgeHandler(
  options: EffectBffEdgeHandlerOptions,
) {
  const loaded = await resolveEffectBffModuleHandler(options.module, {
    openapi: options.openapi,
    dataPlatform: options.dataPlatform,
    onWarning: options.onWarning,
  });

  if (!loaded) {
    throw new Error(
      '[BFF][Effect] Invalid Effect edge module. Export { api, layer }, createHandler, or handler.',
    );
  }

  return {
    handler: (
      request: Request,
      dispatchOptions: Omit<
        EffectBffEdgeDispatchOptions,
        'prefix' | 'onError'
      > = {},
    ) =>
      dispatchEffectBffRequest(loaded.handler, request, {
        ...dispatchOptions,
        prefix: options.prefix,
        onError: options.onError,
      }),
    dispose: async () => {
      await loaded.dispose?.();
    },
  };
}
