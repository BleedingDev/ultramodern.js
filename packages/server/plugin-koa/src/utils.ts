import 'reflect-metadata';
import {
  HttpMetadata,
  httpMethods,
  isWithMetaHandler,
  ResponseMetaType,
} from '@modern-js/bff-core';
import { isSchemaHandler } from '@modern-js/bff-runtime';
import typeis from 'type-is';

type AnyHandler = (...args: any[]) => any;

const handleResponseMeta = (ctx: any, handler: AnyHandler) => {
  const responseMeta = Reflect.getMetadata(HttpMetadata.Response, handler);
  if (!Array.isArray(responseMeta)) {
    return;
  }

  for (const meta of responseMeta) {
    const metaType = meta.type;
    const metaValue = meta.value;
    switch (metaType) {
      case ResponseMetaType.Headers:
        for (const [key, value] of Object.entries(metaValue)) {
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

export const createRouteHandler = (handler: AnyHandler) => {
  const apiHandler = async (ctx: any) => {
    const input = await getInputFromRequest(ctx);

    if (isWithMetaHandler(handler)) {
      try {
        handleResponseMeta(ctx, handler);
        const body = await handler(input);
        if (typeof body !== 'undefined') {
          ctx.body = body;
        }
      } catch (error: any) {
        if (error instanceof Error) {
          if (error.status) {
            ctx.status = error.status;
          } else {
            ctx.status = 500;
          }
          ctx.body = {
            code: error.code,
            message: error.message,
          };
        }
      }
      return;
    }

    if (isSchemaHandler(handler)) {
      const result = await handler(input);
      if (result.type !== 'HandleSuccess') {
        if (result.type === 'InputValidationError') {
          ctx.status = 400;
        } else {
          ctx.status = 500;
        }
        ctx.body = result.message;
      } else {
        ctx.body = result.value;
      }
      return;
    }

    const args = Object.values(input.params).concat(input);
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

const getInputFromRequest = async (ctx: any) => {
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
