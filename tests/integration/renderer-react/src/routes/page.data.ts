import { notFound } from '@modern-js/plugin-tanstack/runtime';
import { later } from '../data/late';

interface RouteDataInput {
  request: Request;
}

export interface PageLoaderData {
  message: string;
  late?: Promise<string>;
}

export function loader({ request }: RouteDataInput) {
  const scenario = new URL(request.url).searchParams.get('case');
  if (scenario === 'deferred')
    return {
      message: 'Native critical value',
      late: later('Native late value'),
    };
  if (scenario === 'not-found') throw notFound();
  if (scenario === 'error') throw new Error('Native loader failure');
  if (scenario === 'redirect')
    return new Response(null, { status: 302, headers: { location: '/about' } });
  return { message: 'Native loader value' };
}

export async function action({ request }: RouteDataInput) {
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
        'set-cookie': 'renderer-saved=1; Path=/; SameSite=Lax',
      },
    });
  if (form.get('intent') === 'throw') throw new Error('Native action failure');
  return { saved: name };
}
