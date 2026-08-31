import { DeferredData } from '@modern-js/runtime-utils/browser';
import { UNSAFE_ErrorResponseImpl as ErrorResponseImpl } from '@modern-js/runtime-utils/router';
import { createWebRequest, sendResponse } from '@modern-js/server-core/node';
import type { ServerRoute } from '@modern-js/types';
import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import qs from 'querystring';
import request from 'supertest';
import { LOADER_ID_PARAM } from '../src/common/constants';
import { handleRequest } from '../src/runtime';
import {
  errorResponseToJson,
  serializeError,
  serializeErrors,
} from '../src/runtime/errors';
import { createDeferredReadableStream } from '../src/runtime/response';

function withNodeEnv<T>(nodeEnv: string, callback: () => T): T {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  const restore = () => {
    process.env.NODE_ENV = previousNodeEnv;
  };

  try {
    const result = callback();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result).finally(restore) as T;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

describe.sequential('handleRequest', () => {
  const serverLoaders = path.join(
    __dirname,
    './fixtures',
    'server',
    'bundles',
    'three-server-loaders/index.js',
  );
  const createContext = (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ) => {
    const context = {
      req,
      res,
      params,
      get headers() {
        return req.headers;
      },
      get method() {
        return req.method!;
      },
      get url() {
        return req.url!;
      },
      get host() {
        return req.headers.host!;
      },
      get protocol() {
        return 'http';
      },
      get origin() {
        return `${this.protocol}://${this.host}`;
      },
      get href() {
        return `${this.origin}${this.url}`;
      },
      get parsedURL() {
        const url = new URL(req.url!, this.origin);
        return url;
      },
      get path() {
        return this.parsedURL.pathname;
      },
      get querystring() {
        return this.parsedURL.search.replace(/^\?/, '') || '';
      },
      get query() {
        const str = this.querystring;
        return qs.parse(str);
      },
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
        log() {},
      },
      reporter: {
        init() {},
        reportTiming() {},
        reportError() {},
        reportInfo() {},
        reportWarn() {},
      },
    };
    return context;
  };

  const createHandler = (
    serverRoutes: ServerRoute[],
    params: Record<string, string>,
  ) => {
    return async (req: IncomingMessage, res: ServerResponse) => {
      const context = createContext(req, res, params);
      const { routes } = await import(serverLoaders);
      const request = createWebRequest(req, res);
      const response = await handleRequest({
        request,
        context,
        serverRoutes,
        routes,
      });
      if (!res.headersSent && response) {
        await sendResponse(response, res);
      }
    };
  };

  test('should return 403 when routeId not match url', async () => {
    const handler = createHandler(
      [
        {
          urlPath: '/three',
          entryName: 'three',
          entryPath: 'html/three/index.html',
          isSPA: true,
          isSSR: true,
        },
      ],
      {},
    );
    const res = await request(handler).get(
      `/three?${LOADER_ID_PARAM}=user/profile/layout`,
    );

    expect(res.status).toBe(403);
  });

  test('should return directly when routeId not exist', async () => {
    const handler = createHandler(
      [
        {
          urlPath: '/three',
          entryName: 'three',
          entryPath: 'html/three/index.html',
          isSPA: true,
          isSSR: true,
        },
      ],
      {},
    );

    const realHandler = async (req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 404;
      await handler(req, res);
      if (!res.writableEnded) {
        res.end();
      }
    };

    const res = await request(realHandler).get('/three/user/profile');
    expect(res.status).toBe(404);
  });

  test('support return data directly', async () => {
    const handler = createHandler(
      [
        {
          urlPath: '/three',
          entryName: 'three',
          entryPath: 'html/three/index.html',
          isSPA: true,
          isSSR: true,
        },
      ],
      {},
    );

    const res = await request(handler).get(
      `/three/user/profile?${LOADER_ID_PARAM}=user/profile/layout`,
    );
    expect(res.status).toBe(200);
    expect(
      res.headers['content-type'].includes('application/json'),
    ).toBeTruthy();
    expect(res.body.message).toBe('loader0');
  });

  test('support return response directly', async () => {
    const handler = createHandler(
      [
        {
          urlPath: '/three',
          entryName: 'three',
          entryPath: 'html/three/index.html',
          isSPA: true,
          isSSR: true,
        },
      ],
      {},
    );

    const res = await request(handler).get(
      `/three/user?${LOADER_ID_PARAM}=user/layout`,
    );
    expect(res.status).toBe(404);
    expect(res.headers['content-type'].includes('text/plain')).toBeTruthy();
    expect(res.text).toBe('loader1');
  });

  test('support params', async () => {
    const id = '123';
    const handler = createHandler(
      [
        {
          urlPath: '/three',
          entryName: 'three',
          entryPath: 'html/three/index.html',
          isSPA: true,
          isSSR: true,
        },
      ],
      {
        id,
      },
    );
    const res = await request(handler).get(
      `/three/user/${id}?${LOADER_ID_PARAM}=user/[id]/layout`,
    );

    expect(res.status).toBe(200);
    expect(
      res.headers['content-type'].includes('application/json'),
    ).toBeTruthy();
    expect(res.text).toBe(JSON.stringify(id));
  });

  test('support error', async () => {
    const handler = createHandler(
      [
        {
          urlPath: '/three',
          entryName: 'three',
          entryPath: 'html/three/index.html',
          isSPA: true,
          isSSR: true,
        },
      ],
      {},
    );

    const res = await request(handler).get(
      `/three/user/profile/name?${LOADER_ID_PARAM}=user.profile.name/layout`,
    );
    expect(res.status).toBe(500);
    expect(
      res.headers['content-type'].includes('application/json'),
    ).toBeTruthy();
    expect(res.body.message).toBe('throw error by loader4');
  });

  test('redacts production loader and route error serialization', async () => {
    const secretError = new Error('loader secret');
    secretError.stack = 'loader stack';
    const routeError = new ErrorResponseImpl(
      500,
      'secret status text',
      'route secret',
      true,
    );

    const serializedError = withNodeEnv('production', () =>
      serializeError(secretError),
    );
    const serializedErrors = withNodeEnv('production', () =>
      serializeErrors({
        root: secretError,
        route: routeError,
      } as any),
    ) as Record<string, any>;
    const response = withNodeEnv('production', () =>
      errorResponseToJson(routeError),
    );
    const responseBody = (await response.json()) as Record<string, unknown>;

    expect(serializedError).toEqual({
      message: 'Unexpected Server Error',
      stack: undefined,
    });
    expect(serializedErrors.root).toMatchObject({
      message: 'Unexpected Server Error',
      stack: undefined,
      __type: 'Error',
    });
    expect(serializedErrors.route).toEqual({
      status: 500,
      statusText: 'Internal Server Error',
      data: 'Unexpected Server Error',
      __type: 'RouteErrorResponse',
    });
    expect(response.status).toBe(500);
    expect(response.statusText).toBe('Internal Server Error');
    expect(responseBody).toEqual({
      message: 'Unexpected Server Error',
    });
    expect(JSON.stringify(serializedErrors)).not.toContain('loader secret');
    expect(JSON.stringify(serializedErrors)).not.toContain('route secret');
    expect(JSON.stringify(serializedErrors)).not.toContain(
      'secret status text',
    );
  });

  test('redacts production deferred error chunks', async () => {
    const deferredData = new DeferredData({
      delayed: Promise.reject(new Error('deferred secret')),
    });
    const body = await withNodeEnv('production', () =>
      new Response(
        createDeferredReadableStream(
          deferredData,
          new AbortController().signal,
        ),
      ).text(),
    );

    expect(body).toContain('Unexpected Server Error');
    expect(body).not.toContain('deferred secret');
  });
});
