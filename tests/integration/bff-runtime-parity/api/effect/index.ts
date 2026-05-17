// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import { useEffectContext } from '@modern-js/plugin-bff/effect-server';

type ErrorWithStatus = Error & {
  status?: number;
};

const validBase64Png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

const json = (
  data: unknown,
  init?: {
    status?: number;
    headers?: HeadersInit;
  },
) =>
  new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  });

const notFound = () => new Response('Not Found', { status: 404 });

const getPathId = (pathname: string) => {
  const match = pathname.match(/^\/hello\/([^/]+)$/);
  return match?.[1];
};

const toManagedError = (message: string, status?: number) => {
  const error = new Error(message) as ErrorWithStatus;
  if (typeof status === 'number') {
    error.status = status;
  }
  return error;
};

export const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const context = useEffectContext();
  const fullPath = context.path;

  if (request.method === 'GET' && pathname === '/') {
    return json({
      message: 'Hello Modern.js',
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

  if (request.method === 'GET' && pathname === '/hello/get') {
    const user = url.searchParams.get('user') ?? '';
    return json(
      {
        query: {
          user,
        },
      },
      {
        headers: {
          'x-bff-api': fullPath,
        },
      },
    );
  }

  if (request.method === 'POST' && pathname === '/upload') {
    const formData = await request.formData();
    const file = formData.get('images');
    const fileName =
      file && typeof file === 'object' && 'name' in file
        ? String((file as File).name)
        : '';

    return json({
      data: {
        code: 10,
        file_name: fileName,
      },
    });
  }

  if (request.method === 'GET' && pathname === '/hello/image') {
    const base64Data = validBase64Png.split(',')[1]!;
    const binary = Buffer.from(base64Data, 'base64');

    return new Response(binary, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'no-store',
      },
    });
  }

  const id = getPathId(pathname);
  if (request.method === 'POST' && id) {
    const payload = (await request.json()) as {
      message?: string;
    };
    const message = payload?.message ?? '';
    const user = url.searchParams.get('user') ?? '';
    const extFrom = url.searchParams.get('ext[0][from]') ?? '';
    const arr = [
      url.searchParams.get('arr[0]'),
      url.searchParams.get('arr[1]'),
    ].filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
    const objA = url.searchParams.get('obj[a]') ?? '';
    const xHeader = request.headers.get('x-header') ?? '';

    return json(
      {
        path: fullPath,
        params: {
          id,
        },
        query: {
          user,
          ext: [
            {
              from: extFrom,
            },
          ],
          arr,
          obj: {
            a: objA,
          },
        },
        data: {
          message: message.startsWith('msg: ') ? message : `msg: ${message}`,
        },
        headers: {
          'x-header': xHeader,
        },
      },
      {
        headers: {
          'x-bff-api': fullPath,
          'x-bff-fn-middleware': '1',
        },
      },
    );
  }

  if (request.method === 'GET' && pathname === '/error') {
    throw toManagedError('Intentional error in get');
  }

  if (request.method === 'GET' && pathname === '/error/managed') {
    throw toManagedError('Intentional managed error in get');
  }

  if (request.method === 'GET' && pathname === '/exception') {
    throw toManagedError('exception with 401', 401);
  }

  if (request.method === 'GET' && pathname === '/managed/exception') {
    throw toManagedError('managed exception with 401', 401);
  }

  return notFound();
};

export default {
  handler,
};
