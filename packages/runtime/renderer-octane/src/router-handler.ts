import type { RequestSession } from '@modern-js/renderer-core/session';
import { type AnyRouter, createMemoryHistory } from '@octanejs/tanstack-router';
import {
  attachRouterServerSsrUtils,
  getNormalizedURL,
  getOrigin,
  normalizeSsrResponse,
  type RequestHandler,
} from '@octanejs/tanstack-router/ssr/server';
import { cleanupOctaneRouterSSR } from './router-server-cleanup';
import {
  type OctaneRouterSerializationOptions,
  prepareOctaneRouterSerialization,
} from './router-server-snapshot';

export interface OctaneRequestHandlerOptions<TRouter extends AnyRouter> {
  createRouter(): TRouter;
  request: Request;
  session: RequestSession;
  getRouterManifest?: () =>
    | Parameters<typeof attachRouterServerSsrUtils>[0]['manifest']
    | Promise<Parameters<typeof attachRouterServerSsrUtils>[0]['manifest']>;
  serialization?: OctaneRouterSerializationOptions;
}

function withAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (success: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (success) resolve(value as T);
      else reject(value);
    };
    const onAbort = () => finish(false, signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      value => finish(true, value),
      error => finish(false, error),
    );
    if (signal.aborted) onAbort();
  });
}

/** List fields that nested matches add to: CSP policies and timing metrics. */
const CSP_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'server-timing',
]);

/**
 * Match headers are server HTTP policy, never part of the public router
 * snapshot. Nested matches union `Vary` and append CSP fields; other
 * singleton fields stay last-writer-wins.
 */
function appendHeaders(destination: Headers, value: unknown): void {
  if (value == null) return;
  const source =
    value instanceof Headers ? value : new Headers(value as HeadersInit);
  for (const [key, item] of Headers.prototype.entries.call(source)) {
    if (key === 'set-cookie') continue;
    if (CSP_HEADERS.has(key)) destination.append(key, item);
    else if (key === 'vary') {
      const fields = new Map<string, string>();
      for (const field of `${destination.get('vary') ?? ''},${item}`.split(
        ',',
      )) {
        const name = field.trim();
        if (name && !fields.has(name.toLowerCase()))
          fields.set(name.toLowerCase(), name);
      }
      destination.set('vary', [...fields.values()].join(', '));
    } else destination.set(key, item);
  }
  for (const cookie of Headers.prototype.getSetCookie.call(source)) {
    destination.append('set-cookie', cookie);
  }
}

function requestHeaders(router: AnyRouter): Headers {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  for (const match of router.stores.matches.get()) {
    const field = Object.getOwnPropertyDescriptor(match, 'headers');
    if (field?.get || field?.set)
      throw new TypeError(
        'Native Octane response headers must be owned values',
      );
    appendHeaders(headers, field?.value);
  }
  const redirect = router.stores.redirect.get();
  if (redirect) appendHeaders(headers, redirect.headers);
  return headers;
}

/** Resolve native routes and HTTP disposition before the native document serializer. */
export function createOctaneRequestHandler<TRouter extends AnyRouter>({
  createRouter,
  request,
  session,
  getRouterManifest,
  serialization,
}: OctaneRequestHandlerOptions<TRouter>): RequestHandler<TRouter> {
  return async callback => {
    session.signal.throwIfAborted();
    const router = createRouter();
    let responseOwnsCleanup = false;
    try {
      const manifest = getRouterManifest
        ? await withAbort(Promise.resolve(getRouterManifest()), session.signal)
        : undefined;
      attachRouterServerSsrUtils({ router, manifest });
      const guard = prepareOctaneRouterSerialization(router, session, {
        ...serialization,
        forbiddenValues: [request, ...(serialization?.forbiddenValues ?? [])],
      });
      session.registerCleanup(() => router.cancelMatches());

      const { url } = getNormalizedURL(request.url, 'http://localhost');
      const href = url.href.replace(url.origin, '');
      router.update({
        ...router.options,
        history: createMemoryHistory({ initialEntries: [href] }),
        origin: router.options.origin ?? getOrigin(request),
      });
      await withAbort(router.load(), session.signal);
      guard.assertActive();

      // A native redirect is a terminal HTTP Response. It must never enter
      // the public serializer as a match error or document payload.
      const redirect = router.stores.redirect.get();
      if (redirect) {
        const resolved = router.resolveRedirect(redirect);
        const headers = requestHeaders(router);
        return new Response(null, {
          status: resolved.status,
          statusText: resolved.statusText,
          headers,
        });
      }

      guard.assertMatches();
      const serverSsr = router.serverSsr;
      if (!serverSsr)
        throw new Error('Native Octane router SSR state is required');
      await withAbort(serverSsr.dehydrate(), session.signal);
      guard.assertActive();
      const responseHeaders = requestHeaders(router);
      const result = normalizeSsrResponse(
        await callback({ request, router, responseHeaders }),
      );
      responseOwnsCleanup = result.serverSsrCleanup === 'stream';
      return result.response;
    } catch (error) {
      session.fail(error);
      throw error;
    } finally {
      if (!responseOwnsCleanup) cleanupOctaneRouterSSR(router);
    }
  };
}
