// @effect-diagnostics asyncFunction:off newPromise:off
import 'reflect-metadata';
import {
  type ApiHandler,
  type ApiHandlerInput,
  buildPositionalHandlerArgs,
  getApiHandlerMode,
  getResponseMetaList,
  httpMethods,
  mapSchemaHandlerResult,
  ResponseMetaType,
  ValidationError,
} from '@modern-js/bff-core';
import type { NextFunction, Request, Response } from 'express';
import formidable from 'formidable';
import typeis from 'type-is';

const handleResponseMeta = (res: Response, handler: ApiHandler) => {
  for (const meta of getResponseMetaList(handler)) {
    const metaValue = meta.value;
    switch (meta.type) {
      case ResponseMetaType.Headers:
        for (const [key, value] of Object.entries(metaValue as object)) {
          res.append(key, value as string);
        }
        break;
      case ResponseMetaType.Redirect:
        res.redirect(metaValue as string);
        break;
      case ResponseMetaType.StatusCode:
        res.status(metaValue as number);
        break;
      default:
        break;
    }
  }
};

export const createRouteHandler = (handler: ApiHandler) => {
  const mode = getApiHandlerMode(handler);

  const apiHandler = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const input = await getInputFromRequest(req);

    if (mode === 'meta') {
      try {
        handleResponseMeta(res, handler);
        if (res.headersSent) {
          return;
        }

        const result: unknown = await handler(input);
        if (typeof result === 'object' && result !== null) {
          res.json(result);
        }
      } catch (error) {
        if (error instanceof ValidationError) {
          res.status(error.status);
          res.json({
            message: error.message,
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (mode === 'schema') {
      const result = await handler(input);
      const outcome = mapSchemaHandlerResult(result);
      res.status(outcome.status);
      res.json(outcome.body);
      return;
    }

    if (mode === 'inputParamsDecider') {
      try {
        const data = input.data as { args?: unknown[] } | undefined;
        const args = data?.args ?? [];
        const body = await handler(...args);
        if (typeof body !== 'undefined') {
          if (typeof body === 'object') {
            res.json(body);
            return;
          }
          res.send(body);
        }
      } catch (error) {
        next(error);
      }
      return;
    }

    const args = buildPositionalHandlerArgs(input);
    try {
      const body = await handler(...args);
      if (res.headersSent) {
        await Promise.resolve();
        return;
      }
      if (typeof body !== 'undefined') {
        res.json(body);
      } else {
        // A plain handler returning undefined used to leave the response
        // open forever (the request hung until the client timed out).
        res.end();
      }
    } catch (error) {
      next(error);
    }
  };

  Object.defineProperties(
    apiHandler,
    Object.getOwnPropertyDescriptors(handler),
  );
  return apiHandler;
};

export const isNormalMethod = (httpMethod: string) =>
  (httpMethods as readonly string[]).includes(httpMethod);

const matchesContentType = (request: Request, patterns: string[]): boolean =>
  typeof typeis(request, patterns) === 'string';

const getInputFromRequest = async (request: Request) => {
  const draft: ApiHandlerInput = {
    params: request.params,
    query: request.query,
    headers: request.headers,
    cookies: request.headers.cookie,
  };

  if (matchesContentType(request, ['application/json'])) {
    draft.data = request.body;
  } else if (matchesContentType(request, ['multipart/form-data'])) {
    draft.formData = await resolveFormData(request);
  } else if (
    matchesContentType(request, ['application/x-www-form-urlencoded'])
  ) {
    draft.formUrlencoded = request.body;
  } else {
    draft.body = request.body;
  }

  return draft;
};

const resolveFormData = (request: Request) => {
  const form = formidable({
    multiples: true,
  });
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    form.parse(request, (err, fields, files) => {
      if (err != null) {
        reject(err);
        return;
      }
      resolve({
        ...fields,
        ...files,
      });
    });
  });
};
