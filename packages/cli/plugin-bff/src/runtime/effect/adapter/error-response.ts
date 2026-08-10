import type { Context, ServerPluginAPI } from '@modern-js/server-core';
import { logger } from '@modern-js/utils';

import { createSafeFailureResponse } from '../../safe-failure';

export function createEffectAdapterRuntimeErrorResponse(
  api: ServerPluginAPI,
  error: unknown,
  c: Context,
): Promise<Response> {
  try {
    const serverConfig = api.getServerConfig();
    const onErrorHandler = serverConfig?.onError;
    if (onErrorHandler !== undefined) {
      const onErrorContext = ensureJsonContext(c);
      return Promise.resolve(
        onErrorHandler(
          error instanceof Error ? error : new Error(String(error)),
          onErrorContext,
        ),
      )
        .then(result =>
          result instanceof Response
            ? result
            : createSafeFailureResponse(error),
        )
        .catch(configError => {
          logger.error(
            `Error in serverConfig.onError handler: ${String(configError)}`,
          );
          return createSafeFailureResponse(error);
        });
    } else {
      logger.error(error instanceof Error ? error : new Error(String(error)));
    }
  } catch (configError) {
    logger.error(`Error in serverConfig.onError handler: ${configError}`);
  }

  return Promise.resolve(createSafeFailureResponse(error));
}

function ensureJsonContext(c: Context): Context {
  if ('json' in c && typeof c.json === 'function') {
    return c;
  }

  const headers = {
    'content-type': 'application/json; charset=utf-8',
  };
  const withJson = Object.assign({}, c, {
    json(
      data: unknown,
      statusOrInit: number | ResponseInit = 200,
      extraHeaders?: HeadersInit,
    ) {
      const responseInit =
        typeof statusOrInit === 'number'
          ? { status: statusOrInit, headers: extraHeaders }
          : statusOrInit;
      const responseHeaders = new Headers(headers);
      if (responseInit.headers !== undefined) {
        new Headers(responseInit.headers).forEach((value, key) => {
          responseHeaders.set(key, value);
        });
      }
      return new Response(JSON.stringify(data), {
        ...responseInit,
        headers: responseHeaders,
      });
    },
  });

  return withJson;
}
