// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off
import type { Context, ServerPluginAPI } from '@modern-js/server-core';
import { logger } from '@modern-js/utils';

import { createSafeFailureResponse } from '../../safe-failure';

type ContextWithJson = Context & {
  json?: (data: unknown, status?: number, headers?: HeadersInit) => Response;
};

export async function createEffectAdapterRuntimeErrorResponse(
  api: ServerPluginAPI,
  error: unknown,
  c: Context,
) {
  try {
    const serverConfig = api.getServerConfig();
    const onErrorHandler = serverConfig?.onError;
    if (onErrorHandler) {
      const onErrorContext = ensureJsonContext(c);
      const result = await onErrorHandler(
        error instanceof Error ? error : new Error(String(error)),
        onErrorContext,
      );
      if (result instanceof Response) {
        return result;
      }
    } else {
      logger.error(error);
    }
  } catch (configError) {
    logger.error(`Error in serverConfig.onError handler: ${configError}`);
  }

  return createSafeFailureResponse(error);
}

function ensureJsonContext(c: Context): Context {
  const maybeJsonContext = c as ContextWithJson;
  if (typeof maybeJsonContext.json === 'function') {
    return c;
  }

  const headers = {
    'content-type': 'application/json; charset=utf-8',
  };
  const withJson = Object.assign({}, c, {
    json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
      const responseHeaders = new Headers(headers);
      if (extraHeaders) {
        new Headers(extraHeaders).forEach((value, key) => {
          responseHeaders.set(key, value);
        });
      }
      return new Response(JSON.stringify(data), {
        status,
        headers: responseHeaders,
      });
    },
  });

  return withJson as Context;
}
