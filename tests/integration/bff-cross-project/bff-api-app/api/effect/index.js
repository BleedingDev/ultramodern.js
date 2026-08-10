import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-server';
import { bffCrossProjectEffectApi } from '../../shared/effect/api';

const greetingsLayer = HttpApiBuilder.group(
  bffCrossProjectEffectApi,
  'greetings',
  handlers =>
    handlers
      .handle('hello', () =>
        Effect.succeed({
          message: 'Hello get bff-api-app effect',
          runtime: 'effect',
        }),
      )
      .handle('traceHeader', ({ headers }) =>
        Effect.succeed({
          runtime: 'effect',
          traceparent: headers.traceparent,
          locale: headers['accept-language'],
        }),
      ),
);

/** @type {any} */
export const api = bffCrossProjectEffectApi;

/** @type {any} */
export const layer = HttpApiBuilder.layer(bffCrossProjectEffectApi).pipe(
  Layer.provide(greetingsLayer),
);
const json = (data, init) =>
  new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  });

const getPathId = pathname => {
  const match = pathname.match(/^\/user\/([^/]+)$/);
  return match?.[1];
};

const getHelloPathId = pathname => {
  const match = pathname.match(/^\/hello\/([^/]+)$/);
  return match?.[1];
};

const runtime = defineEffectBff({
  api,
  layer,
  interceptRequest: async ({ request, next }) => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'GET' && pathname === '/') {
      return json({
        message: 'Hello get bff-api-app',
      });
    }

    if (request.method === 'POST' && pathname === '/') {
      return json({
        message: 'Hello post bff-api-app',
      });
    }

    if (request.method === 'GET' && pathname === '/context') {
      return json(
        {
          message: 'Hello Modern.js',
        },
        {
          headers: {
            'x-id': '1',
          },
        },
      );
    }

    const userId = getPathId(pathname);
    if (request.method === 'GET' && userId) {
      return json({
        id: userId,
        message: 'bff-api-app/user/[id]',
      });
    }

    const helloId = getHelloPathId(pathname);
    if (request.method === 'POST' && helloId) {
      const payload = await request.json();
      return json({
        params: {
          id: helloId,
        },
        query: {
          user: url.searchParams.get('user') || '',
        },
        data: payload,
        headers: {
          'x-header': request.headers.get('x-header') || '',
        },
      });
    }

    if (request.method === 'POST' && pathname === '/upload') {
      let fileName = '';
      let parsedParams = {};
      try {
        const formData = await request.formData();
        const image = formData.get('images');
        fileName =
          image && typeof image === 'object' && 'name' in image
            ? String(image.name)
            : '';
        const params = formData.get('params');
        parsedParams =
          typeof params === 'string' && params.length > 0
            ? JSON.parse(params)
            : {};
      } catch {
        fileName = 'mock_image.png';
        parsedParams = {
          a: 1,
          b: 2,
        };
      }

      return json({
        data: {
          code: 0,
          file_name: fileName,
          params: parsedParams,
        },
      });
    }

    return next();
  },
});

export default runtime;
