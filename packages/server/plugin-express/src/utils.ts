import 'reflect-metadata';
import {
  HttpMetadata,
  httpMethods,
  isInputParamsDeciderHandler,
  isWithMetaHandler,
  ResponseMetaType,
  ValidationError,
} from '@modern-js/bff-core';
import { isSchemaHandler } from '@modern-js/bff-runtime';
import type { NextFunction, Request, Response } from 'express';
import formidable from 'formidable';
import typeis from 'type-is';

type AnyHandler = (...args: any[]) => any;

const handleResponseMeta = (res: Response, handler: AnyHandler) => {
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
          res.append(key, value as string);
        }
        break;
      case ResponseMetaType.Redirect:
        res.redirect(metaValue);
        break;
      case ResponseMetaType.StatusCode:
        res.status(metaValue);
        break;
      default:
        break;
    }
  }
};

export const createRouteHandler = (handler: AnyHandler) => {
  const apiHandler = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const input = await getInputFromRequest(req);

    if (isWithMetaHandler(handler)) {
      try {
        handleResponseMeta(res, handler);
        if (res.headersSent) {
          return;
        }

        const result = await handler(input);
        if (result && typeof result === 'object') {
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

    if (isSchemaHandler(handler)) {
      const result = await handler(input);
      if (result.type !== 'HandleSuccess') {
        if (result.type === 'InputValidationError') {
          res.status(400);
        } else {
          res.status(500);
        }
        res.json(result.message);
        return;
      }

      res.status(200);
      res.json(result.value);
      return;
    }

    if (isInputParamsDeciderHandler(handler)) {
      try {
        const args = input?.data?.args || [];
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

    const args = Object.values(input.params).concat(input);
    try {
      const body = await handler(...args);
      if (res.headersSent) {
        await Promise.resolve();
        return;
      }
      if (typeof body !== 'undefined') {
        res.json(body);
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
  httpMethods.includes(httpMethod);

const getInputFromRequest = async (request: Request) => {
  const draft: Record<string, any> = {
    params: request.params,
    query: request.query,
    headers: request.headers,
    cookies: request.headers.cookie,
  };

  if (typeis(request, ['application/json'])) {
    draft.data = request.body;
  } else if (typeis(request, ['multipart/form-data'])) {
    draft.formData = await resolveFormData(request);
  } else if (typeis(request, ['application/x-www-form-urlencoded'])) {
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
      if (err) {
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
