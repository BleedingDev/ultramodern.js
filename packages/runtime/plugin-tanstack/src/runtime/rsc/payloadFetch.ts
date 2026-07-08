// @effect-diagnostics asyncFunction:off globalFetch:off processEnv:off strictBooleanExpressions:off
import type { ServerPayload } from '@modern-js/runtime/context';
import { notFound, redirect } from '@tanstack/react-router';
import { isAbsoluteUrl } from '../shared/isAbsoluteUrl';
import { reviveTanstackRscFlightValues } from './flightSerialization';

export { isAbsoluteUrl };

type PayloadDecoder = (stream: ReadableStream<Uint8Array>) => Promise<unknown>;

export const payloadFetchCache = new Map<string, Promise<ServerPayload>>();
let payloadDecoder: PayloadDecoder | undefined;

export async function decodePayload(stream: ReadableStream<Uint8Array>) {
  if (payloadDecoder) {
    return reviveTanstackRscFlightValues(await payloadDecoder(stream));
  }

  const runtime = await import('@modern-js/runtime/rsc/client');
  return reviveTanstackRscFlightValues(
    await runtime.createFromReadableStream(stream),
  );
}

export function isServerPayload(value: unknown): value is ServerPayload {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as ServerPayload).type === 'render' &&
    Array.isArray((value as ServerPayload).routes)
  );
}

export function createPayloadFetchKey(request: Request) {
  return JSON.stringify([
    request.url,
    request.method,
    [...request.headers.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ]);
}

export async function fetchTanstackRscPayload(request: Request) {
  const headers = new Headers(request.headers);
  headers.set('x-rsc-tree', 'true');

  const response = await fetch(request.url, {
    credentials: 'same-origin',
    headers,
    method: 'GET',
    signal: request.signal,
  });

  const redirectLocation = response.headers.get('X-Modernjs-Redirect');
  if (redirectLocation) {
    if (isAbsoluteUrl(redirectLocation)) {
      throw redirect({
        headers: response.headers,
        href: redirectLocation,
        statusCode: response.status,
      });
    }
    throw redirect({
      headers: response.headers,
      statusCode: response.status,
      to: redirectLocation || '/',
    });
  }

  if (response.status === 404 && !response.body) {
    throw notFound();
  }

  if (!response.body) {
    throw new Error('TanStack RSC payload response body is null.');
  }

  const payload = await decodePayload(response.body);
  if (!isServerPayload(payload)) {
    throw new Error('Unexpected TanStack RSC payload type.');
  }

  return payload;
}

export function __setTanstackRscPayloadDecoderForTests(
  decoder?: PayloadDecoder,
) {
  payloadDecoder = decoder;
  payloadFetchCache.clear();
}
