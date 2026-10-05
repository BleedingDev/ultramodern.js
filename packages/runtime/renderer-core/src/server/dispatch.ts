import { assertRendererIdentity, identityCacheKey } from '../identity';
import {
  createRequestSession,
  documentCacheKey,
  permitsDocumentCache,
  type RequestSession,
} from '../session';
import type {
  CachedNativeDocument,
  NativeDispatchOptions,
  NativeRequestContext,
  NativeServerManifest,
} from './types';

/** Runs before bundle loading, cache lookup, or any renderer dispatch. */
export function rejectNativeRscRequest(request: Request): Response | undefined {
  if (
    request.headers.has('x-rsc-tree') ||
    request.headers.has('x-rsc-action')
  ) {
    return Response.json(
      { code: 'unsupported-renderer-capability', capability: 'rsc' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
  return undefined;
}

function responseHeaders(headers: Headers): Array<[string, string]> {
  const fields: Array<[string, string]> = [...headers.entries()].filter(
    ([name]) => name !== 'set-cookie',
  );
  for (const value of headers.getSetCookie())
    fields.push(['set-cookie', value]);
  return fields;
}

function permitsCacheLookup(request: Request): boolean {
  const url = new URL(request.url);
  return (
    request.method === 'GET' &&
    !request.headers.has('authorization') &&
    !request.headers.has('cookie') &&
    !request.headers.has('range') &&
    !/(?:^|,)\s*(?:private|no-store|no-cache)(?:\s|,|=|$)/i.test(
      request.headers.get('cache-control') ?? '',
    ) &&
    request.headers.get('pragma')?.toLowerCase() !== 'no-cache' &&
    !url.searchParams.has('__loader') &&
    !url.searchParams.has('__ssrDirect')
  );
}

function isReusableDocument(
  document: CachedNativeDocument,
  key: string,
): boolean {
  return (
    document.identityKey === key &&
    Number.isFinite(document.storedAt) &&
    document.storedAt <= Date.now() &&
    document.expiresAt > Date.now() &&
    document.status === 200 &&
    document.bytes instanceof Uint8Array &&
    permitsDocumentCache({
      kind: 'document',
      status: document.status,
      headers: document.headers,
      cache: { mode: 'public', maxAgeSeconds: 1 },
    }) &&
    !new Headers(document.headers.map(([name, value]) => [name, value])).has(
      'vary',
    )
  );
}

function normalizeTerminalResponse<Bindings extends object>(
  response: Response,
  session: RequestSession<Bindings>,
): Response {
  if (session.committedPolicy) {
    if (response.status !== session.committedPolicy.status) {
      throw new Error(
        'Native handler changed HTTP status after committing its response policy.',
      );
    }
    if (response.statusText !== (session.committedPolicy.statusText ?? '')) {
      throw new Error(
        'Native handler changed HTTP status text after committing its response policy.',
      );
    }
    if (!session.ownsResponseBody(response)) {
      throw new Error(
        'Native handler returned a body outside its committed request session.',
      );
    }
    return response;
  }
  session.resolveResponse({
    kind: 'terminal',
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response.headers),
    cache: { mode: 'no-store' },
  });
  return session.respond(response.body);
}

async function chooseCSR<Bindings extends object>(
  request: Request,
  manifest: NativeServerManifest<Bindings>,
  context: NativeRequestContext<Bindings>,
): Promise<boolean> {
  const url = new URL(request.url);
  if (
    (request.method !== 'GET' && request.method !== 'HEAD') ||
    url.searchParams.has('__loader') ||
    url.searchParams.has('__ssrDirect')
  )
    return false;
  const config = context.serverConfig;
  if (config?.ssr === false || config?.forceCSR) return true;
  const selectedIds = config?.ssrByRouteIds;
  if (!selectedIds?.length) return false;
  if (!manifest.nativeMatchRouteIds) {
    throw new Error(
      'unsupported-renderer-capability: ssrByRouteIds requires native route matching.',
    );
  }
  const matchedIds = await manifest.nativeMatchRouteIds(request, context);
  const leafId = matchedIds.at(-1);
  return !leafId || !selectedIds.includes(leafId);
}

/** Capture follows the client consumer; abandoned bodies cannot populate cache. */
function captureDocument<Bindings extends object>(
  response: Response,
  session: RequestSession<Bindings>,
  options: NativeDispatchOptions<Bindings>,
  key: string,
  identityKey: string,
): Response {
  if (!response.body || !options.cache) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const maximum = options.maxCacheBytes ?? 2 * 1024 * 1024;
  let total = 0;
  let canCapture = Number.isSafeInteger(maximum) && maximum > 0;
  let delivered!: Response;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const part = await reader.read();
          if (!part.done) {
            if (canCapture) {
              total += part.value.byteLength;
              if (total <= maximum) chunks.push(part.value.slice());
              else {
                canCapture = false;
                chunks.length = 0;
              }
            }
            controller.enqueue(part.value);
            return;
          }
          reader.releaseLock();
          const completion = await session.completion;
          const policy = session.committedPolicy;
          if (
            canCapture &&
            completion.cacheEligible &&
            policy?.cache.mode === 'public' &&
            policy.cache.maxAgeSeconds > 0 &&
            delivered.status === 200 &&
            !delivered.headers.has('vary') &&
            permitsDocumentCache({
              ...policy,
              status: delivered.status,
              headers: responseHeaders(delivered.headers),
            })
          ) {
            const maxAgeSeconds = policy.cache.maxAgeSeconds;
            const bytes = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            const commit = async (headers: Headers | undefined) => {
              if (
                !headers ||
                headers.has('vary') ||
                !permitsDocumentCache({
                  ...policy,
                  status: delivered.status,
                  headers: responseHeaders(headers),
                })
              )
                return;
              try {
                const storedAt = Date.now();
                await options.cache?.set(key, {
                  identityKey,
                  storedAt,
                  expiresAt: storedAt + maxAgeSeconds * 1000,
                  status: 200,
                  statusText: delivered.statusText,
                  headers: responseHeaders(headers),
                  bytes,
                });
              } catch (error) {
                options.onCacheError?.(error);
              }
            };
            if (options.confirmDelivery) {
              // Node finish needs body EOF first. Confirm wire headers only
              // after middleware and the transport have completed delivery.
              chunks.length = 0;
              controller.close();
              void options
                .confirmDelivery(delivered)
                .then(commit)
                .catch(error => {
                  options.onCacheError?.(error);
                });
              return;
            }
            await commit(delivered.headers);
          }
          chunks.length = 0;
          controller.close();
        } catch (error) {
          chunks.length = 0;
          session.fail(error);
          await session.completion;
          controller.error(error);
        }
      },
      async cancel(reason) {
        chunks.length = 0;
        const cancellation = reader.cancel(reason);
        session.abort(reason);
        await Promise.all([cancellation, session.completion]);
        reader.releaseLock();
      },
    },
    { highWaterMark: 0 },
  );
  delivered = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  return delivered;
}

/** Production Fetch dispatch. React rendering and matching are never imported. */
export async function dispatchNativeNodeRequest<Bindings extends object>(
  request: Request,
  options: NativeDispatchOptions<Bindings>,
): Promise<Response> {
  const rscRejection = rejectNativeRscRequest(request);
  if (rscRejection) return rscRejection;
  const identityKey = identityCacheKey(options.identity);
  if (options.identity.renderer === 'react') {
    throw new Error('Native Node dispatch requires Solid or Octane.');
  }
  let session = createRequestSession({
    request,
    identity: options.identity,
    platform: { kind: 'node', bindings: options.context.bindings },
  });
  const { bindings: _bindings, ...renderContext } = options.context;
  let context: NativeRequestContext<Bindings> = {
    ...renderContext,
    session,
    entry: session.identity,
  };
  let handlerStarted = false;
  try {
    session.signal.throwIfAborted();
    const manifest = await options.loadManifest();
    assertRendererIdentity(manifest.rendererIdentity, options.identity);
    if (typeof manifest.nativeRequestHandler !== 'function') {
      throw new Error('Native renderer manifest has no request handler.');
    }
    const csr = await chooseCSR(request, manifest, context);
    session.signal.throwIfAborted();
    if (csr && !manifest.nativeCSRRequestHandler) {
      throw new Error(
        'unsupported-renderer-capability: selected CSR requires a native document handler.',
      );
    }
    if (csr) session.markFallback();
    if (
      options.hydrationBuildId !== undefined &&
      (typeof options.hydrationBuildId !== 'string' ||
        !options.hydrationBuildId.trim())
    )
      throw new Error(
        'Native hydration cache identity requires a nonempty build ID.',
      );
    const cacheKey = documentCacheKey(
      options.identity,
      JSON.stringify([
        request.url,
        options.hydrationBuildId ?? options.identity.buildId,
        options.context.assets ?? [],
        options.context.nonce ?? null,
      ]),
    );
    const cacheAllowed = !csr && permitsCacheLookup(request);
    if (cacheAllowed && options.cache) {
      try {
        const cached = await options.cache.get(cacheKey);
        if (cached && isReusableDocument(cached, identityKey)) {
          // The replayed cache-control lifetime started when the document was
          // stored. Age keeps downstream caches from extending its freshness.
          const age = Math.floor((Date.now() - cached.storedAt) / 1000);
          session.resolveResponse({
            kind: 'terminal',
            status: cached.status,
            statusText: cached.statusText,
            headers: [
              ...cached.headers.filter(
                ([name]) => name.toLowerCase() !== 'age',
              ),
              ['age', String(age)],
            ],
            cache: { mode: 'no-store' },
          });
          return session.respond(
            new ReadableStream({
              start(controller) {
                controller.enqueue(cached.bytes.slice());
                controller.close();
              },
            }),
          );
        }
      } catch (error) {
        options.onCacheError?.(error);
      }
    }
    session.signal.throwIfAborted();
    handlerStarted = true;
    let response = await (csr
      ? manifest.nativeCSRRequestHandler!
      : manifest.nativeRequestHandler)(request, context);
    if (!(response instanceof Response)) {
      throw new TypeError(
        'Native renderer handler must return a Fetch Response.',
      );
    }
    response = normalizeTerminalResponse(response, session);
    if (request.method === 'HEAD' && response.body) {
      await response.body.cancel();
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return cacheAllowed
      ? captureDocument(response, session, options, cacheKey, identityKey)
      : response;
  } catch (error) {
    const committed = session.committedPolicy !== undefined;
    session.fail(error);
    await session.completion;
    if (
      !handlerStarted ||
      committed ||
      request.signal.aborted ||
      !options.onError
    )
      throw error;
    // A pre-commit fallback owns a fresh lifetime; the failed session is disposed.
    session = createRequestSession({
      request,
      identity: options.identity,
      platform: { kind: 'node', bindings: options.context.bindings },
    });
    session.markFallback();
    context = { ...context, session };
    try {
      const response = await options.onError(error, request, context);
      if (!(response instanceof Response))
        throw new TypeError('Native fallback must return a Fetch Response.');
      const owned = normalizeTerminalResponse(response, session);
      if (request.method === 'HEAD' && owned.body) {
        await owned.body.cancel();
        return new Response(null, {
          status: owned.status,
          statusText: owned.statusText,
          headers: owned.headers,
        });
      }
      return owned;
    } catch (fallbackError) {
      session.fail(fallbackError);
      await session.completion;
      throw fallbackError;
    }
  }
}
