import type { DataHandlerInput } from '@bleedingdev/modern-js-renderer-core/data';
import { deferData } from '@bleedingdev/modern-js-renderer-core/data';
import { holdProducer, responseHeaders } from '../conformance-controls';

export function loader({ request }: DataHandlerInput) {
  const url = new URL(request.url);
  const scenario = url.searchParams.get('case');
  const value = {
    message: 'Native loader value',
    privateValue: request.headers.get('x-conformance-private'),
  };
  if (scenario === 'concurrent')
    return holdProducer(request).then(() =>
      Response.json(value, { headers: responseHeaders(request) }),
    );
  if (scenario === 'stream' || scenario === 'abort' || scenario === 'deferred')
    return deferData(
      { ...value, message: 'Native critical value' },
      { late: holdProducer(request) },
      { headers: responseHeaders(request) },
    );
  if (scenario === 'cookies')
    return Response.json(value, { headers: responseHeaders(request) });
  if (url.searchParams.get('case') === 'not-found')
    throw new Response('Native route not found', { status: 404 });
  if (url.searchParams.get('case') === 'error')
    throw new Error('Native loader failure');
  if (url.searchParams.get('case') === 'redirect')
    return new Response(null, { status: 302, headers: { location: '/about' } });
  return value;
}

export async function action({ request }: DataHandlerInput) {
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
  };
  return new URL(request.url).searchParams.get('case') === 'cookies'
    ? Response.json(value, { headers: responseHeaders(request) })
    : value;
}
