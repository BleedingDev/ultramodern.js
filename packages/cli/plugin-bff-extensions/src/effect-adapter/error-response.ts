import { createSafeFailureResponse } from '@modern-js/runtime-extensions/safe-failure';
import type { Context, ServerPluginAPI } from '@modern-js/server-core';
import { logger } from '@modern-js/utils';

export function createEffectAdapterRuntimeErrorResponse(
  api: ServerPluginAPI,
  error: unknown,
  context: Context,
): Promise<Response> {
  try {
    const onError = api.getServerConfig()?.onError;
    if (onError !== undefined) {
      return Promise.resolve(
        onError(
          error instanceof Error ? error : new Error(String(error)),
          ensureJsonContext(context),
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
    }
    logger.error(error instanceof Error ? error : new Error(String(error)));
  } catch (configError) {
    logger.error(`Error in serverConfig.onError handler: ${configError}`);
  }

  return Promise.resolve(createSafeFailureResponse(error));
}

function ensureJsonContext(context: Context): Context {
  if ('json' in context && typeof context.json === 'function') {
    return context;
  }

  return Object.assign({}, context, {
    json(
      data: unknown,
      statusOrInit: number | ResponseInit = 200,
      extraHeaders?: HeadersInit,
    ) {
      const responseInit =
        typeof statusOrInit === 'number'
          ? { status: statusOrInit, headers: extraHeaders }
          : statusOrInit;
      const responseHeaders = new Headers({
        'content-type': 'application/json; charset=utf-8',
      });
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
}
