import 'reflect-metadata';
import {
  type ApiHandler,
  buildPositionalHandlerArgs,
  getApiHandlerMode,
  getResponseMetaList,
  httpMethods,
  mapSchemaHandlerResult,
  ResponseMetaType,
} from '@modern-js/bff-core';
import type { Context } from 'koa';
import typeis from 'type-is';

/**
 * Koa context as seen by API routes: `params` is added by `@koa/router`,
 * `body`/`files` are added by `koa-body`.
 */
type ApiContext = Context & {
  params: Record<string, unknown>;
  request: Context['request'] & {
    body?: unknown;
    files?: unknown;
  };
};

const handleResponseMeta = (ctx: ApiContext, handler: ApiHandler) => {
  for (const meta of getResponseMetaList(handler)) {
    const metaValue = meta.value;
    switch (meta.type) {
      case ResponseMetaType.Headers:
        for (const [key, value] of Object.entries(metaValue as object)) {
          if (typeof value === 'string') {
            ctx.append(key, value);
          }
        }
        break;
      case ResponseMetaType.Redirect:
        if (typeof metaValue === 'string') {
          ctx.redirect(metaValue);
        }
        break;
      case ResponseMetaType.StatusCode:
        if (typeof metaValue === 'number') {
          ctx.status = metaValue;
        }
        break;
      default:
        break;
    }
  }
};

export const createRouteHandler = (handler: ApiHandler) => {
  const mode = getApiHandlerMode(handler);

  const apiHandler = async (ctx: ApiContext) => {
    const input = await getInputFromRequest(ctx);

    if (mode === 'meta') {
      try {
        handleResponseMeta(ctx, handler);
        const body = await handler(input);
        if (typeof body !== 'undefined') {
          ctx.body = body;
        }
      } catch (error) {
        if (error instanceof Error) {
          const { status, code } = error as Error & {
            status?: number;
            code?: unknown;
          };
          ctx.status = status || 500;
          ctx.body = {
            code,
            message: error.message,
          };
        }
      }
      return;
    }

    if (mode === 'schema') {
      const result = await handler(input);
      const outcome = mapSchemaHandlerResult(result);
      if (!outcome.success) {
        ctx.status = outcome.status;
      }
      ctx.body = outcome.body;
      return;
    }

    // 'inputParamsDecider' handlers keep the historical koa behavior and are
    // invoked like plain function handlers.
    const args = buildPositionalHandlerArgs(input);
    const body = await handler(...args);
    if (typeof body !== 'undefined') {
      ctx.body = body;
    }
  };

  Object.defineProperties(
    apiHandler,
    Object.getOwnPropertyDescriptors(handler),
  );
  return apiHandler;
};

export const isNormalMethod = (httpMethod: string) =>
  httpMethods.includes(httpMethod);

const getInputFromRequest = async (ctx: ApiContext) => {
  const draft: Record<string, any> = {
    params: ctx.params,
    query: ctx.query,
    headers: ctx.headers,
    cookies: ctx.headers.cookie,
  };

  if (typeis.is(ctx.request.type, ['application/json'])) {
    draft.data = ctx.request.body;
  } else if (typeis.is(ctx.request.type, ['multipart/form-data'])) {
    draft.formData = ctx.request.files;
  } else if (
    typeis.is(ctx.request.type, ['application/x-www-form-urlencoded'])
  ) {
    draft.formUrlencoded = ctx.request.body;
  } else {
    draft.body = ctx.request.body;
  }

  return draft;
};
