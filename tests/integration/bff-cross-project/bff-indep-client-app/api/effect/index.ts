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

export const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === 'GET' && pathname === '/') {
    return json({
      message: 'Hello Modern.js get client',
    });
  }

  if (request.method === 'POST' && pathname === '/') {
    return json({
      message: 'Hello Modern.js post client',
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

  if (request.method === 'POST' && pathname === '/upload') {
    let fileName = '';
    try {
      const formData = await request.formData();
      const image = formData.get('images');
      fileName =
        image && typeof image === 'object' && 'name' in image
          ? String((image as File).name)
          : '';
    } catch {
      fileName = 'mock_image.png';
    }
    return json({
      data: {
        code: 10,
        file_name: fileName,
      },
    });
  }

  const id = getPathId(pathname);
  if (request.method === 'POST' && id) {
    const payload = (await request.json()) as {
      message?: string;
    };
    return json({
      params: {
        id,
      },
      query: {
        user: url.searchParams.get('user') ?? '',
      },
      data: {
        message: payload?.message ?? '',
      },
      headers: {
        'x-header': request.headers.get('x-header') ?? '',
      },
    });
  }

  return notFound();
};

export default {
  handler,
};
