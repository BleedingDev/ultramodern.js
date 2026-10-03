import { holdProducer, responseHeaders } from '../server/conformance-controls';

interface RouteDataInput {
  request: Request;
  params: Record<string, string>;
}

export interface PageLoaderData {
  message: string;
  privateValue: string | null;
  late?: Promise<string>;
}

export function loader({ request }: RouteDataInput) {
  const scenario = new URL(request.url).searchParams.get('case');
  const value: PageLoaderData = {
    message: 'Native loader value',
    privateValue: request.headers.get('x-conformance-private'),
  };
  if (scenario === 'concurrent')
    return holdProducer(request).then(() =>
      Response.json(value, { headers: responseHeaders(request) }),
    );
  if (
    scenario === 'stream' ||
    scenario === 'abort' ||
    scenario === 'deferred'
  ) {
    return {
      ...value,
      message: 'Native critical value',
      late: holdProducer(request),
    };
  }
  if (scenario === 'cookies')
    return Response.json(value, { headers: responseHeaders(request) });
  if (scenario === 'not-found')
    throw new Response('Native route not found', { status: 404 });
  if (scenario === 'error') throw new Error('Native loader failure');
  if (scenario === 'redirect')
    return new Response(null, { status: 302, headers: { location: '/about' } });
  return value;
}

export async function action({ request, params }: RouteDataInput) {
  const form = await request.formData();
  const name = form.get('name');
  if (typeof name !== 'string' || !name.trim())
    return Response.json(
      { fieldErrors: { name: 'Name required' } },
      { status: 422 },
    );
  if (form.get('intent') === 'redirect')
    return new Response(null, {
      status: 303,
      headers: {
        location: '/about',
        'set-cookie': 'conformance-saved=1; Path=/; SameSite=Lax',
      },
    });
  if (form.get('intent') === 'throw') throw new Error('Native action failure');
  const value = {
    saved: name,
    privateValue: request.headers.get('x-conformance-private'),
    requestUrl: request.url,
    params,
    submitterIntent: form.get('intent'),
  };
  return new URL(request.url).searchParams.get('case') === 'cookies'
    ? Response.json(value, { headers: responseHeaders(request) })
    : value;
}
