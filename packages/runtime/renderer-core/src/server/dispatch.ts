import { untilAborted } from '../abort';
import { assertRendererIdentity, identityCacheKey } from '../identity';
import {
  createRequestSession,
  documentCacheKey,
  headerMaxAgeSeconds,
  permitsDocumentCache,
  policyHeaders,
  type RequestSession,
  responseHeaders,
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

function permitsCacheLookup(request: Request): boolean {
  const url = new URL(request.url);
  const cacheControl = request.headers.get('cache-control') ?? '';
  return (
    request.method === 'GET' &&
    !request.headers.has('authorization') &&
    !request.headers.has('cookie') &&
    !request.headers.has('range') &&
    !request.headers.has('if-none-match') &&
    !request.headers.has('if-modified-since') &&
    !request.headers.has('if-match') &&
    !request.headers.has('if-unmodified-since') &&
    !/(?:^|,)\s*(?:private|no-store|no-cache)(?:\s|,|=|$)/i.test(
      cacheControl,
    ) &&
    !/(?:^|,)\s*max-age\s*=\s*(?:0+|"0+")\s*(?:,|$)/i.test(cacheControl) &&
    // A cached entry cannot promise the remaining freshness min-fresh asks for.
    !/(?:^|,)\s*min-fresh(?:\s|,|=|$)/i.test(cacheControl) &&
    // Conflicting request lifetimes have no single limit to compare against.
    (cacheControl.match(/(?:^|,)\s*max-age\s*=/gi)?.length ?? 0) <= 1 &&
    !request.headers
      .get('pragma')
      ?.split(',')
      .some(directive => directive.trim().toLowerCase() === 'no-cache') &&
    !url.searchParams.has('__loader') &&
    !url.searchParams.has('__ssrDirect')
  );
}

/** The request's `max-age` limit in seconds, when it sets a valid one. */
function requestMaxAgeSeconds(request: Request): number | undefined {
  const match = /(?:^|,)\s*max-age\s*=\s*(?:(\d+)|"(\d+)")\s*(?:,|$)/i.exec(
    request.headers.get('cache-control') ?? '',
  );
  return match ? Number(match[1] ?? match[2]) : undefined;
}

function documentAgeSeconds(document: CachedNativeDocument): number {
  return Math.floor((Date.now() - document.storedAt) / 1000);
}

function isReusableDocument(
  document: CachedNativeDocument,
  key: string,
  maxAgeSeconds: number | undefined,
): boolean {
  return (
    document.identityKey === key &&
    Number.isFinite(document.storedAt) &&
    document.storedAt <= Date.now() &&
    // RFC 9111 freshness needs the lifetime to exceed the unrounded age.
    (maxAgeSeconds === undefined ||
      Date.now() - document.storedAt < maxAgeSeconds * 1000) &&
    document.expiresAt > Date.now() &&
    document.status === 200 &&
    document.bytes instanceof Uint8Array &&
    permitsDocumentCache({
      kind: 'document',
      status: document.status,
      headers: document.headers,
      cache: { mode: 'public', maxAgeSeconds: 1 },
    }) &&
    !policyHeaders(document.headers).has('vary')
  );
}

/**
 * The reason phrase a Fetch runtime assigns when a policy omits one: empty in
 * Node, the standard phrase (for example `OK`) in workerd.
 */
function defaultStatusText(status: number): string {
  return new Response(null, { status }).statusText;
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
    if (
      response.statusText !==
      (session.committedPolicy.statusText ??
        defaultStatusText(session.committedPolicy.status))
    ) {
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
  // An authored matcher that ignores cancellation must not hold the request.
  const matchedIds = await untilAborted(
    manifest.nativeMatchRouteIds(request, context),
    context.session.signal,
  );
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
  // The renderer's own fields, before the host merges route and middleware
  // headers into the returned response in place. A cache hit goes through
  // the host again, so storing the merged wire fields would repeat them.
  const nativeHeaders = responseHeaders(response.headers);
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
            // Final wire headers decide admission and lifetime only.
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
              // Middleware may shorten the committed lifetime; the stored
              // entry never outlives what the delivered headers allow.
              const lifetimeSeconds = Math.min(
                maxAgeSeconds,
                ...headerMaxAgeSeconds(headers),
              );
              // Upstream Age and an older Date already spent part of that
              // lifetime. Backdating storedAt by the larger one keeps both the
              // expiry and the replayed Age honest.
              const age = headers.get('age')?.trim() ?? '0';
              const date = Date.parse(headers.get('date') ?? '');
              const ageSeconds = Math.max(
                /^\d+$/u.test(age) ? Number(age) : 0,
                Number.isFinite(date)
                  ? Math.floor((Date.now() - date) / 1000)
                  : 0,
              );
              if (lifetimeSeconds - ageSeconds <= 0) return;
              try {
                const storedAt = Date.now() - ageSeconds * 1000;
                await options.cache?.set(key, {
                  identityKey,
                  storedAt,
                  expiresAt: storedAt + lifetimeSeconds * 1000,
                  status: 200,
                  statusText: delivered.statusText,
                  headers: nativeHeaders,
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
            // The write starts before EOF, but EOF never waits for it: a
            // stalled cache must not hold a delivered response open.
            void commit(delivered.headers).catch(error => {
              options.onCacheError?.(error);
            });
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
        // Like session completion, delivery never waits on the source's
        // cancel hook: an uncooperative stream must not hold the wire open.
        void reader.cancel(reason).catch(() => undefined);
        session.abort(reason);
        await session.completion;
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

function openSession<Bindings extends object>(
  request: Request,
  options: NativeDispatchOptions<Bindings>,
): RequestSession<Bindings> {
  const session = createRequestSession({
    request,
    identity: options.identity,
    platform: {
      kind: options.platform ?? 'node',
      bindings: options.context.bindings,
    },
  });
  // Worker isolates may end once fetch returns; keep owned cleanup alive.
  options.executionContext?.waitUntil(session.completion);
  return session;
}

/** Production Fetch dispatch. React rendering and matching are never imported. */
export async function dispatchNativeRequest<Bindings extends object>(
  request: Request,
  options: NativeDispatchOptions<Bindings>,
): Promise<Response> {
  const rscRejection = rejectNativeRscRequest(request);
  if (rscRejection) return rscRejection;
  const identityKey = identityCacheKey(options.identity);
  if (options.identity.renderer === 'react') {
    throw new Error('Native dispatch requires Solid or Octane.');
  }
  let session = openSession(request, options);
  const { bindings: _bindings, ...renderContext } = options.context;
  let context: NativeRequestContext<Bindings> = {
    ...renderContext,
    session,
    entry: session.identity,
  };
  let handlerStarted = false;
  try {
    session.signal.throwIfAborted();
    // Every stage before the response races the session signal: work that
    // ignores cancellation must not hold a disconnected request.
    const manifest = await untilAborted(options.loadManifest(), session.signal);
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
        // A cache outage must not keep a cancelled request alive.
        const cached = await untilAborted(
          options.cache.get(cacheKey),
          session.signal,
        );
        if (
          cached &&
          isReusableDocument(cached, identityKey, requestMaxAgeSeconds(request))
        ) {
          // The replayed cache-control lifetime started when the document was
          // stored. Age keeps downstream caches from extending its freshness.
          const age = documentAgeSeconds(cached);
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
        if (session.signal.aborted) throw error;
        options.onCacheError?.(error);
      }
    }
    session.signal.throwIfAborted();
    handlerStarted = true;
    let response = await untilAborted(
      (csr ? manifest.nativeCSRRequestHandler! : manifest.nativeRequestHandler)(
        request,
        context,
      ),
      session.signal,
    );
    if (!(response instanceof Response)) {
      throw new TypeError(
        'Native renderer handler must return a Fetch Response.',
      );
    }
    response = normalizeTerminalResponse(response, session);
    if (request.method === 'HEAD' && response.body) {
      // A HEAD answer never waits on, or fails with, its discarded body.
      void response.body.cancel().catch(() => {});
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
    session = openSession(request, options);
    session.markFallback();
    context = { ...context, session };
    try {
      const response = await untilAborted(
        options.onError(error, request, context),
        session.signal,
      );
      if (!(response instanceof Response))
        throw new TypeError('Native fallback must return a Fetch Response.');
      const owned = normalizeTerminalResponse(response, session);
      if (request.method === 'HEAD' && owned.body) {
        void owned.body.cancel().catch(() => {});
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

/**
 * Node host dispatch; the request platform binding is always `node`.
 * The Node adapter hands over a Proxy for requests with a body, which
 * `new Request(request)` rejects, so the body request is rebuilt first.
 */
export function dispatchNativeNodeRequest<Bindings extends object>(
  request: Request,
  options: NativeDispatchOptions<Bindings>,
): Promise<Response> {
  const fetchRequest =
    request.body === null
      ? request
      : new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: request.signal,
          duplex: 'half',
        } as RequestInit);
  return dispatchNativeRequest(fetchRequest, { ...options, platform: 'node' });
}
