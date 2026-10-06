// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import type {
  SSRRequestPreparedInfo,
  SSRRequestRouterResult,
  SSRRequestTerminal,
} from '@modern-js/plugin/runtime';
import {
  getGlobalInternalRuntimeContext,
  getGlobalRSCRoot,
  getInitialContext,
  type TInternalRuntimeContext,
} from '@modern-js/runtime/context';
import type { DeferredData } from '@modern-js/runtime-utils/browser';
import { storage } from '@modern-js/runtime-utils/node';
import {
  getPathname,
  parseCookie,
  parseHeaders,
  parseQuery,
} from '@modern-js/runtime-utils/universal/request';
import type {
  RequestHandler,
  RequestHandlerOptions,
} from '@modern-js/server-core';
import type { OnError } from '@modern-js/types';
import React, { Fragment } from 'react';
import { handleRSCRedirect } from '../../router/runtime/redirect';
import { getServerPayload } from '../context/serverPayload';
import { createRoot } from '../react';
import type { SSRServerContext } from '../types';
import { CHUNK_CSS_PLACEHOLDER } from './constants';
import { SSRErrors } from './tracer';
import { getSSRConfigByEntry, getSSRMode } from './utils';

export const REQUEST_END_ERROR =
  'An error occurs during request lifecycle completion';
export const RESPONSE_BODY_CANCEL_ERROR =
  'An error occurs while cancelling a discarded response body';

export type RequestLifecycle = {
  /** True once completion belongs to a response body rather than the handler. */
  readonly deferred: boolean;
  /** Notify request completion once; concurrent callers await the same work. */
  run: (terminal?: SSRRequestTerminal) => Promise<void>;
  deferUntilBodyDone: (response: Response) => Response;
  /** Cancel a discarded body before notifying extensions. */
  discardBody: (
    response: Response,
    terminal?: SSRRequestTerminal,
  ) => Promise<void>;
};

export async function runWithRequestLifecycleOnError<T>(
  lifecycle: RequestLifecycle,
  callback: () => Promise<T> | T,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    await lifecycle.run({ status: 'error', error });
    throw error;
  }
}

export async function finishWithRequestLifecycle<T>(
  lifecycle: RequestLifecycle,
  callback: () => Promise<T> | T,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (!lifecycle.deferred) {
      await lifecycle.run({ status: 'error', error });
    }
    throw error;
  } finally {
    if (!lifecycle.deferred) {
      await lifecycle.run();
    }
  }
}

/** The native owner controls body lifetime; plugins own request resources. */
export function createRequestLifecycle(
  onEnd: (terminal: SSRRequestTerminal) => void | Promise<void>,
  onError: OnError,
): RequestLifecycle {
  let deferred = false;
  let finished: Promise<void> | undefined;

  const run = (terminal: SSRRequestTerminal = { status: 'complete' }) => {
    finished ??= Promise.resolve()
      .then(() => onEnd(terminal))
      .catch(error => {
        onError(error, REQUEST_END_ERROR);
      });
    return finished;
  };

  const deferUntilBodyDone = (response: Response): Response => {
    const { body } = response;
    if (!body) {
      return response;
    }

    deferred = true;
    if (body.locked) {
      throw new TypeError(
        'Cannot observe a locked response body before request completion',
      );
    }
    let cancelled = false;
    const reader = body.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (error) {
          if (!cancelled) {
            await run({ status: 'error', error });
            controller.error(error);
          }
          return;
        }
        // Cancellation can settle an in-flight read while its source is still
        // shutting down. Only cancel() may notify completion in that case.
        if (cancelled) {
          return;
        }
        if (result.done) {
          await run();
          if (!cancelled) {
            controller.close();
          }
          return;
        }
        controller.enqueue(result.value);
      },
      async cancel(reason) {
        cancelled = true;
        try {
          await reader.cancel(reason);
        } catch {
          // The reader is terminal even when the source cancellation fails.
        }
        await run({ status: 'cancelled', reason });
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  const discardBody = async (
    response: Response,
    terminal: SSRRequestTerminal = { status: 'discarded' },
  ): Promise<void> => {
    const { body } = response;
    if (!body) {
      await run(terminal);
      return;
    }

    deferred = true;
    if (body.locked) {
      throw new TypeError(
        'Cannot discard a locked response body before request completion',
      );
    }
    try {
      await body.cancel('Response body discarded during finalization');
    } catch (error) {
      // Web Streams close before running the source cancellation algorithm.
      // Rejection still ends body ownership, so extensions must be released.
      await run(
        terminal.status === 'error' ? terminal : { status: 'error', error },
      );
      if (terminal.status === 'error') {
        onError(error, RESPONSE_BODY_CANCEL_ERROR);
      }
      throw error;
    }
    await run(terminal);
  };

  return {
    get deferred() {
      return deferred;
    },
    run,
    deferUntilBodyDone,
    discardBody,
  };
}

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
  return location !== null &&
    location !== '' &&
    URL.canParse(location, 'http://localhost')
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

export const applyRouterResult = (
  context: TInternalRuntimeContext,
  routerResult: SSRRequestRouterResult | undefined,
  onError: OnError,
): void => {
  const routerStatusCode = routerResult?.statusCode;
  if (
    routerStatusCode !== undefined &&
    routerStatusCode !== 0 &&
    !Number.isNaN(routerStatusCode) &&
    routerStatusCode !== 200
  ) {
    context.ssrContext?.response.status(routerStatusCode);
  }

  const errors = Object.values(routerResult?.errors || {});
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
  if (redirectUrl === undefined) {
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
  lifecycle: RequestLifecycle,
): Promise<Response> => {
  try {
    const proxyHeaders = new Headers(responseProxy.headers);
    if (
      responseProxy.status !== -1 &&
      isRedirectStatus(responseProxy.status) &&
      getRedirectLocation(proxyHeaders) !== undefined
    ) {
      await lifecycle.discardBody(response);
      return processRedirect(proxyHeaders, responseProxy.status, redirectCtx);
    }

    const headers = new Headers(response.headers);
    Object.entries(responseProxy.headers).forEach(([key, value]) => {
      headers.set(key, value);
    });

    if (responseProxy.status !== -1) {
      if (isNullBodyStatus(responseProxy.status)) {
        await lifecycle.discardBody(response);
        headers.delete('content-length');
        headers.delete('transfer-encoding');
        return new Response(null, {
          status: responseProxy.status,
          headers,
        });
      }

      if (response.body?.locked) {
        // Preserve body ownership before Response's constructor can reject it.
        lifecycle.deferUntilBodyDone(response);
      }
      return lifecycle.deferUntilBodyDone(
        new Response(response.body, {
          status: responseProxy.status,
          headers,
        }),
      );
    }

    Object.entries(responseProxy.headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return lifecycle.deferUntilBodyDone(response);
  } catch (error) {
    if (!lifecycle.deferred) {
      try {
        await lifecycle.discardBody(response, { status: 'error', error });
      } catch {
        // Disposal/cancellation diagnostics are reported by the lifecycle.
        // Keep the response finalization failure as the request's primary error.
      }
    }
    throw error;
  }
};

async function handleRSCRequest(
  request: Request,
  Root: React.ComponentType,
  context: TInternalRuntimeContext,
  options: RequestHandlerOptions,
  handleRequest: HandleRequest,
): Promise<Response> {
  const serverPayload = getServerPayload();

  if (typeof serverPayload !== 'undefined') {
    return await handleRequest(request, Root, {
      ...options,
      runtimeContext: context,
      rscRoot: serverPayload,
    });
  }

  const App = getGlobalRSCRoot();
  if (App) {
    return await handleRequest(request, Fragment, {
      ...options,
      runtimeContext: context,
      rscRoot: <App />,
    });
  }

  // Fallback when no RSC root is available
  return await handleRequest(request, Root, {
    ...options,
    runtimeContext: context,
  });
}

export type { RequestHandlerConfig as HandleRequestConfig } from '@modern-js/server-core';

export type HandleRequestOptions = Exclude<
  RequestHandlerOptions,
  'staticGenerate'
> & {
  runtimeContext: TInternalRuntimeContext;
};

export type HandleRequest = (
  request: Request,
  ServerRoot: React.ComponentType, // App, routes,
  options: HandleRequestOptions,
) => Promise<Response>;

export type CreateRequestHandler = (
  handleRequest: HandleRequest,
  options?: {
    enableRsc?: boolean;
  },
) => Promise<RequestHandler>;

const renderRequest = async (
  request: Request,
  Root: React.ComponentType,
  context: TInternalRuntimeContext,
  options: RequestHandlerOptions,
  handleRequest: HandleRequest,
  enableRsc: boolean,
): Promise<Response> => {
  if (enableRsc) {
    return handleRSCRequest(request, Root, context, options, handleRequest);
  }

  return handleRequest(request, Root, {
    ...options,
    runtimeContext: context,
  });
};

function createSSRContext(
  request: Request,
  options: RequestHandlerOptions & {
    responseProxy: ResponseProxy;
  },
): SSRServerContext {
  const {
    config,
    loaderContext,
    onError,
    onTiming,
    locals,
    resource,
    params,
    responseProxy,
    reporter,
  } = options;

  const { nonce, useJsonScript } = config;

  const { entryName, route } = resource;

  const { headers } = request;

  const cookie = headers.get('cookie') || '';

  const cookieMap = parseCookie(request);

  const pathname = getPathname(request);

  const query = parseQuery(request);

  const headersData = parseHeaders(request);

  const url = new URL(request.url);

  const host =
    headers.get('X-Forwarded-Host') || headers.get('host') || url.host;

  let protocol = (
    headers.get('X-Forwarded-Proto') ||
    url.protocol ||
    'http'
  ).split(/\s*,\s*/, 1)[0];

  // The protocal including the final `:`.
  // Follow: https://developer.mozilla.org/en-US/docs/Web/API/URL/protocol
  if (!protocol.endsWith(':')) {
    protocol += ':';
  }

  const ssrConfig = getSSRConfigByEntry(
    entryName,
    config.ssr,
    config.ssrByEntries,
  );
  let ssrMode = getSSRMode(ssrConfig);

  const isSsgRender = headers.get('x-modern-ssg-render') === 'true';
  if (isSsgRender) {
    const reactMajor = Number((React.version || '0').split('.')[0]);
    ssrMode = reactMajor >= 18 ? 'stream' : 'string';
  }

  const loaderFailureMode =
    typeof ssrConfig === 'object' &&
    ssrConfig &&
    'loaderFailureMode' in ssrConfig
      ? (
          ssrConfig as {
            loaderFailureMode?: 'clientRender' | 'errorBoundary';
          }
        ).loaderFailureMode
      : undefined;

  return {
    nonce,
    useJsonScript,
    loaderContext,
    htmlModifiers: [],
    baseUrl: route.urlPath,
    request: {
      url: request.url.replace(url.host, host).replace(url.protocol, protocol),
      userAgent: headers.get('user-agent')!,
      cookie,
      cookieMap,
      pathname,
      query,
      params,
      headers: headersData,
      host,
      referer: headers.get('referer')!,
      raw: request,
    },
    response: {
      setHeader(key, value) {
        responseProxy.headers[key] = value;
      },
      status(code) {
        responseProxy.status = code;
      },
      locals: locals || {},
    },
    reporter,
    mode: ssrMode,
    onError,
    onTiming,
    loaderFailureMode,
  };
}

export const createRequestHandler: CreateRequestHandler = async (
  handleRequest,
  createRequestOptions,
) => {
  const requestHandler: RequestHandler = async (request, options) => {
    const headersData = parseHeaders(request);
    const responseProxy: ResponseProxy = {
      headers: {},
      status: -1,
    };
    const activeDeferreds = new Map<string, DeferredData>();
    return storage.run(
      {
        headers: headersData,
        request,
        monitors: options.monitors,
        responseProxy,
        activeDeferreds,
        serverPayload: undefined,
      },
      async () => {
        const Root = createRoot();

        const internalRuntimeContext = getGlobalInternalRuntimeContext();
        const hooks = internalRuntimeContext.hooks;

        const { routeManifest } = options.resource;

        const context: TInternalRuntimeContext = getInitialContext(
          false,
          routeManifest as any,
        );

        const runBeforeRender = async (
          context: TInternalRuntimeContext,
        ): Promise<Response | undefined> => {
          // when router is redirect, beforeRender will return a response
          const result = await hooks.onBeforeRender.call(context);
          if (typeof Response !== 'undefined' && result instanceof Response) {
            return result;
          }
        };

        const ssrContext = createSSRContext(request, {
          ...options,
          responseProxy,
        });

        Object.assign(context, {
          ssrContext,
          isBrowser: false,
        });

        // Prepare redirect context once for all redirect handling
        const redirectCtx: RedirectContext = {
          enableRsc: !!createRequestOptions?.enableRsc,
          isRSCNavigation: request.headers.get('x-rsc-tree') === 'true',
          basename: ssrContext.baseUrl || '/',
        };

        const lifecycle = createRequestLifecycle(async terminal => {
          await hooks.onRequestEnd?.call({
            runtimeContext: context,
            terminal,
          });
        }, options.onError);
        const beforeRenderResult = await runWithRequestLifecycleOnError(
          lifecycle,
          () => runBeforeRender(context),
        );

        let redirectResponse: Response | undefined;
        try {
          const prepared: SSRRequestPreparedInfo<TInternalRuntimeContext> = {
            runtimeContext: context,
            routerResult: context.routerContext,
          };
          const result =
            (await hooks.onRenderPrepared?.call(prepared)) ?? prepared;
          applyRouterResult(context, result.routerResult, options.onError);

          if (typeof Response !== 'undefined') {
            redirectResponse = createLoaderRedirectResponse(
              beforeRenderResult,
              redirectCtx,
            );
          }
        } catch (error) {
          if (beforeRenderResult) {
            try {
              await lifecycle.discardBody(beforeRenderResult, {
                status: 'error',
                error,
              });
            } catch {
              // Keep the original failure; cancellation diagnostics are
              // reported by the lifecycle, and locked bodies retain ownership.
            }
          } else {
            await lifecycle.run({ status: 'error', error });
          }
          throw error;
        }

        if (redirectResponse) {
          const response = redirectResponse;
          if (beforeRenderResult?.body && response !== beforeRenderResult) {
            await lifecycle.discardBody(beforeRenderResult);
          }
          return finishWithRequestLifecycle(lifecycle, () =>
            lifecycle.deferUntilBodyDone(response),
          );
        }

        await runWithRequestLifecycleOnError(lifecycle, () => {
          if (!createRequestOptions?.enableRsc) {
            const { htmlTemplate } = options.resource;
            options.resource.htmlTemplate = htmlTemplate.replace(
              '</head>',
              `${CHUNK_CSS_PLACEHOLDER}</head>`,
            );
          }
        });

        const response = await runWithRequestLifecycleOnError(lifecycle, () =>
          renderRequest(
            request,
            Root,
            context,
            options,
            handleRequest,
            !!createRequestOptions?.enableRsc,
          ),
        );

        return finishWithRequestLifecycle(lifecycle, () =>
          finalizeRenderResponse(
            response,
            responseProxy,
            redirectCtx,
            lifecycle,
          ),
        );
      },
    );
  };

  return requestHandler;
};
