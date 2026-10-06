import { serializePublicData } from '@modern-js/renderer-core/data';
import {
  collectDocumentAssets,
  type DocumentAsset,
  type DocumentCachePolicy,
  type RequestSession,
  type ResponsePolicy,
  serializeDocumentAsset,
  serializeInlineData,
} from '@modern-js/renderer-core/session';
import {
  commitEventResponse,
  createRequestEvent,
  generateHydrationScript,
  isServer,
  type JSX,
  renderToStream,
  ssr,
  ssrElementAttribute,
} from '@solidjs/web';
import { provideRequestEvent } from '@solidjs/web/storage';
import {
  createComponent,
  createRoot,
  Hydration,
  NoHydration,
  runWithOwner,
} from 'solid-js';
import { withFederatedAssets } from './federation-ssr';
import { nativePromiseSerializationPlugin } from './native-promise-serialization';

type NativeStreamOptions = NonNullable<Parameters<typeof renderToStream>[1]>;

type ApplicationRequestEvent = ReturnType<
  typeof createRequestEvent<{
    locals: { session: RequestSession; bindings: object };
  }>
>;

const requestEvents = new WeakMap<RequestSession, ApplicationRequestEvent>();
const nativeHeads = new WeakMap<
  ApplicationRequestEvent,
  { response: ApplicationRequestEvent['response']; headers: Headers }
>();
const headerForEach = Headers.prototype.forEach;
const headerGet = Headers.prototype.get;
const headerHas = Headers.prototype.has;
const headerCookies = Headers.prototype.getSetCookie;

function applicationRequestEvent<Bindings extends object>(
  session: RequestSession<Bindings>,
): ApplicationRequestEvent {
  if (session.identity.renderer !== 'solid') {
    throw new Error('The Solid adapter requires a Solid renderer identity.');
  }
  if (session.platform.kind !== 'node' && session.platform.kind !== 'worker') {
    throw new Error(
      'Solid request context requires a Node or worker request platform.',
    );
  }
  if (!isServer) {
    throw new Error(
      'The Solid server adapter must resolve @solidjs/web with a server (node or worker) condition.',
    );
  }
  let event = requestEvents.get(session);
  if (!event) {
    event = createRequestEvent(session.request, {
      locals: { session, bindings: session.platform.bindings },
    });
    requestEvents.set(session, event);
    nativeHeads.set(event, {
      response: event.response,
      headers: event.response.headers,
    });
  }
  return event;
}

/** Establish Solid's native request scope before loaders and response dispatch. */
export async function runApplicationRequest<Bindings extends object, Result>(
  session: RequestSession<Bindings>,
  callback: () => Result,
): Promise<Awaited<Result>> {
  let event: ApplicationRequestEvent;
  try {
    event = applicationRequestEvent(session);
  } catch (error) {
    void session.fail(error);
    throw error;
  }
  // Fail inside the request scope so session cleanup observes its event.
  return await provideRequestEvent(event, async () => {
    try {
      return await callback();
    } catch (error) {
      void session.fail(error);
      throw error;
    }
  });
}

function ownData(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError(
      'Solid response metadata must contain own data fields.',
    );
  }
  return descriptor.value;
}

function readNativeHead(event: ApplicationRequestEvent) {
  const native = nativeHeads.get(event);
  if (!native || ownData(event, 'response') !== native.response) {
    throw new TypeError('The native Solid response stub cannot be replaced.');
  }
  const response = native.response;
  const status = ownData(response, 'status');
  const statusText = ownData(response, 'statusText');
  if (
    status !== undefined &&
    (typeof status !== 'number' ||
      !Number.isInteger(status) ||
      status < 200 ||
      status > 599)
  ) {
    throw new TypeError(
      'A Solid response status must be an integer from 200 to 599.',
    );
  }
  if (statusText !== undefined && typeof statusText !== 'string') {
    throw new TypeError('A Solid response statusText must be a string.');
  }
  if (ownData(response, 'committed') !== false) {
    throw new Error('The native Solid response head is already committed.');
  }
  if (
    ownData(response, 'headers') !== native.headers ||
    Object.getPrototypeOf(native.headers) !== Headers.prototype
  ) {
    throw new TypeError(
      'The native Solid response Headers cannot be replaced.',
    );
  }
  for (const key of [
    'append',
    'delete',
    'entries',
    'forEach',
    'get',
    'getSetCookie',
    'has',
    'set',
    Symbol.iterator,
  ]) {
    if (Object.getOwnPropertyDescriptor(native.headers, key)) {
      throw new TypeError(
        'The native Solid response Headers methods cannot be replaced.',
      );
    }
  }
  return { status, statusText, headers: native.headers };
}

function collectResponseHeaders(headers: Headers): [string, string][] {
  const entries: [string, string][] = [];
  headerForEach.call(headers, (value, name) => {
    if (name !== 'set-cookie') entries.push([name, value]);
  });
  for (const cookie of headerCookies.call(headers)) {
    entries.push(['set-cookie', cookie]);
  }
  return entries;
}

function policyHeaders(policy: ResponsePolicy): Headers {
  const headers = new Headers();
  for (const [name, value] of policy.headers) headers.append(name, value);
  return headers;
}

function cacheDirectives(value: string | null) {
  let mode: DocumentCachePolicy['mode'] = 'public';
  const ages: number[] = [];
  const ageNames = new Set<string>();
  if (value !== null) {
    for (const part of value.split(',')) {
      const match = /^\s*([!#$%&'*+.^_`|~\w-]+)(?:\s*=\s*([^\s]+))?\s*$/u.exec(
        part,
      );
      if (!match) return { mode: 'no-store' as const, ages: [] };
      const name = match[1].toLowerCase();
      if (name === 'no-store' || name === 'no-cache') mode = 'no-store';
      else if (name === 'private' && mode !== 'no-store') mode = 'private';
      if (name === 'max-age' || name === 's-maxage') {
        if (ageNames.has(name) || !/^\d+$/u.test(match[2] ?? '')) {
          return { mode: 'no-store' as const, ages: [] };
        }
        const age = Number(match[2]);
        if (!Number.isSafeInteger(age))
          return { mode: 'no-store' as const, ages: [] };
        ageNames.add(name);
        ages.push(age);
      }
    }
  }
  return { mode, ages };
}

function restrictDocumentCache(
  policy: ResponsePolicy,
  status: number,
  original: Headers,
  native: Headers,
  outgoing: Headers,
): DocumentCachePolicy {
  let mode = policy.cache.mode;
  const ages =
    policy.cache.mode === 'public' ? [policy.cache.maxAgeSeconds] : [];
  for (const headers of [original, native, outgoing]) {
    const control = cacheDirectives(headerGet.call(headers, 'cache-control'));
    ages.push(...control.ages);
    if (control.mode === 'no-store') mode = 'no-store';
    else if (control.mode === 'private' && mode === 'public') mode = 'private';
    if (
      headerHas.call(headers, 'set-cookie') ||
      headerGet
        .call(headers, 'vary')
        ?.split(',')
        .some(value => value.trim() === '*')
    )
      mode = 'no-store';
  }
  if (
    policy.kind !== 'document' ||
    status !== 200 ||
    headerGet.call(original, 'content-type')?.includes(',') ||
    headerGet.call(outgoing, 'content-type')?.includes(',') ||
    headerGet
      .call(original, 'content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase() !== 'text/html' ||
    headerGet
      .call(outgoing, 'content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase() !== 'text/html'
  )
    mode = 'no-store';
  if (mode === 'public') {
    const maxAgeSeconds = Math.min(...ages);
    outgoing.set(
      'cache-control',
      `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, must-revalidate`,
    );
    return { mode, maxAgeSeconds };
  }
  outgoing.set(
    'cache-control',
    mode === 'private' ? 'private, max-age=0, must-revalidate' : 'no-store',
  );
  return { mode };
}

function respondApplicationBody<Bindings extends object>(
  session: RequestSession<Bindings>,
  body: () => ReadableStream<Uint8Array> | null,
  hasSuppliedBody = false,
): Response {
  return provideRequestEvent(applicationRequestEvent(session), () => {
    try {
      const event = applicationRequestEvent(session);
      const policy = session.responsePolicy;
      if (!policy || session.committedPolicy) {
        throw new Error(
          'Resolve an uncommitted Solid HTTP outcome before responding.',
        );
      }
      const native = readNativeHead(event);
      const original = policyHeaders(policy);
      const outgoing = policyHeaders(policy);
      let status = policy.status;
      let statusText = policy.statusText;
      let kind = policy.kind;
      let bodyless = [204, 205, 304].includes(status);
      if (kind === 'document') {
        status = native.status ?? status;
        statusText = native.statusText ?? statusText;
        headerForEach.call(native.headers, (value, name) => {
          // Cookies and timing merge through the native commit operation below.
          if (
            name !== 'set-cookie' &&
            name !== 'server-timing' &&
            name !== 'vary'
          ) {
            outgoing.set(name, value);
          }
        });
        const vary = [
          headerGet.call(original, 'vary'),
          headerGet.call(native.headers, 'vary'),
        ].flatMap(
          value =>
            value
              ?.split(',')
              .map(part => part.trim())
              .filter(Boolean) ?? [],
        );
        if (vary.length) outgoing.set('vary', [...new Set(vary)].join(', '));
        for (const name of [
          'content-length',
          'content-encoding',
          'transfer-encoding',
        ])
          outgoing.delete(name);
        if (outgoing.has('location')) {
          status = [301, 302, 303, 307, 308].includes(status) ? status : 302;
          bodyless = true;
        } else bodyless = [204, 205, 304].includes(status);
        if (bodyless) {
          kind = 'terminal';
          outgoing.delete('content-type');
        }
      }
      if (bodyless && hasSuppliedBody) {
        throw new TypeError(
          'A terminal Solid HTTP outcome cannot consume a document body.',
        );
      }
      const cache = restrictDocumentCache(
        { ...policy, kind },
        status,
        original,
        native.headers,
        outgoing,
      );
      // Validate the complete policy before native commit makes late writes fail.
      session.resolveResponse({
        kind,
        status,
        statusText,
        headers: collectResponseHeaders(outgoing),
        cache,
      });
      const preview = commitEventResponse(
        new Response(bodyless ? null : body(), {
          status,
          statusText,
          headers: outgoing,
        }),
        event,
      );
      const committedHeaders = preview.headers;
      const finalCache = restrictDocumentCache(
        { ...policy, kind },
        status,
        original,
        native.headers,
        committedHeaders,
      );
      session.resolveResponse({
        kind,
        status,
        statusText,
        headers: collectResponseHeaders(committedHeaders),
        cache: finalCache,
      });
      return session.respond(preview.body);
    } catch (error) {
      void session.fail(error);
      throw error;
    }
  });
}

/** Fold Solid's native response metadata before the one session body commits. */
export function respondApplication<Bindings extends object>(
  session: RequestSession<Bindings>,
  body: ReadableStream<Uint8Array> | null,
): Response {
  try {
    return respondApplicationBody(session, () => body, body !== null);
  } catch (error) {
    void session.fail(error);
    throw error;
  }
}

/** Adopt an explicit data or redirect Response without replacing its outcome. */
export function respondApplicationResponse<Bindings extends object>(
  session: RequestSession<Bindings>,
  response: Response,
): Response {
  try {
    session.resolveResponse({
      kind: 'terminal',
      status: response.status,
      statusText: response.statusText,
      headers: collectResponseHeaders(response.headers),
      cache: { mode: 'no-store' },
    });
    return respondApplication(session, response.body);
  } catch (error) {
    void session.fail(error);
    throw error;
  }
}

function getDocumentNonce(
  nonce: NativeStreamOptions['nonce'],
  destination: 'script' | 'style',
): string | undefined {
  const value = typeof nonce === 'string' ? nonce : nonce?.[destination];
  return value === false ? undefined : value;
}

/** Solid owns hydration, lazy module assets and head placement in its document. */
export type SolidDocumentOptions = Pick<
  NativeStreamOptions,
  'renderId' | 'nonce' | 'manifest' | 'onHead'
>;

export interface SolidRenderOptions<Bindings extends object = object> {
  readonly session: RequestSession<Bindings>;
  readonly view: () => JSX.Element;
  readonly document?: SolidDocumentOptions;
  /** Return Solid's native public error mapping, if one is required. */
  readonly onError?: NativeStreamOptions['onError'];
}

/** Public JSON a client module reads from the document before it starts. */
export interface DocumentInlineData {
  readonly id: string;
  readonly payload: Parameters<typeof serializeInlineData>[0]['payload'];
}

export interface SolidApplicationDocumentOptions extends SolidDocumentOptions {
  readonly rootId?: string;
  readonly lang?: string;
  readonly assets?: readonly DocumentAsset[];
  /** Placed in the head, after the renderer bootstrap and before modules. */
  readonly inlineData?: readonly DocumentInlineData[];
}

export interface SolidDocumentRenderOptions<Bindings extends object = object>
  extends Omit<SolidRenderOptions<Bindings>, 'document'> {
  readonly document?: SolidApplicationDocumentOptions;
}

/**
 * Render a prepared Node document through Solid's one readable consumer.
 * The caller resolves blocking route/data HTTP outcomes before calling this.
 * Like Solid's own SSR response, the HTTP head commits when the shell
 * completes, so status, headers and redirects declared before the shell apply
 * and a shell-time failure rejects before any head commits.
 * A contained native fallback can finish, but is never a successful cache entry.
 * A deferred uncontained failure cancels delivery without changing sent headers.
 */
export async function renderApplication<Bindings extends object>(
  options: SolidRenderOptions<Bindings>,
): Promise<Response> {
  const { session } = options;
  let readable: ReadableStream<Uint8Array> | undefined;
  let consumed = false;
  try {
    const event = applicationRequestEvent(session);
    if (
      session.responsePolicy?.kind !== 'document' ||
      [204, 205, 304].includes(session.responsePolicy.status)
    ) {
      throw new Error(
        'Resolve a document HTTP outcome before invoking the Solid renderer; terminal responses bypass rendering.',
      );
    }
    session.startRendering();
    let renderFailure: { error: unknown } | undefined;
    const {
      promise: shell,
      resolve,
      reject,
    } = Promise.withResolvers<Response>();
    // A synchronous construction failure rethrows below without awaiting this.
    shell.catch(() => {});
    const failBeforeShell = () =>
      reject(renderFailure ? renderFailure.error : session.signal.reason);
    // A native abort abandons the render without completing its shell.
    if (session.signal.aborted) failBeforeShell();
    else
      session.signal.addEventListener('abort', failBeforeShell, { once: true });
    readable = provideRequestEvent(event, () =>
      runWithOwner(null, () =>
        createRoot(
          dispose => {
            // Solid links its render root to this detached transparent owner.
            // Register disposal before construction: a throwing view can precede
            // renderToStream's own abort listener. Cleanup retains the request event.
            const nativeAbort = new AbortController();
            const abortNative = () =>
              provideRequestEvent(event, () => {
                nativeAbort.abort(session.signal.reason);
              });
            session.signal.addEventListener('abort', abortNative, {
              once: true,
            });
            session.registerCleanup(() =>
              provideRequestEvent(event, () => {
                session.signal.removeEventListener('abort', abortNative);
                if (session.committedPolicy?.kind === 'terminal') {
                  nativeAbort.abort(
                    new DOMException(
                      'The request resolved without a document body.',
                      'AbortError',
                    ),
                  );
                }
                dispose();
              }),
            );
            if (session.signal.aborted) abortNative();
            const native = renderToStream(options.view, {
              ...options.document,
              // Server-rendered federated components add their remote assets.
              manifest: withFederatedAssets(options.document?.manifest),
              plugins: [nativePromiseSerializationPlugin],
              // Restore the request event when transport cancellation occurs
              // outside the async scope that constructed the native stream.
              signal: nativeAbort.signal,
              // The shell completes synchronously before its first write and
              // before a finished render disposes owner-scoped declarations.
              onCompleteShell() {
                session.signal.removeEventListener('abort', failBeforeShell);
                try {
                  resolve(
                    respondApplicationBody(session, () => {
                      consumed = true;
                      return native.readable;
                    }),
                  );
                } catch (error) {
                  reject(error);
                  throw error;
                }
              },
              onError(error, context) {
                if (context.handling === 'failed') {
                  renderFailure ??= { error };
                  void session.fail(error);
                } else if (
                  session.state !== 'completed' &&
                  session.state !== 'failed' &&
                  session.state !== 'aborted'
                ) {
                  session.markFallback();
                }
                return options.onError?.(error, context);
              },
            });
            if (renderFailure) throw renderFailure.error;
            // Claim Solid's one consumer; do not await the native thenable, which
            // waits for the complete document. The session owns cancellation,
            // backpressure and exactly-once cleanup.
            return native.readable;
          },
          { transparent: true },
        ),
      ),
    );
    return await shell;
  } catch (error) {
    void session.fail(error);
    throw error;
  } finally {
    // A bodyless or failed outcome releases the native document consumer.
    if (readable && !consumed) void readable.cancel().catch(() => {});
  }
}

function createDocumentParts<Bindings extends object>(
  options: Pick<SolidDocumentRenderOptions<Bindings>, 'session' | 'document'>,
  hydrating: boolean,
) {
  const document = options.document ?? {};
  const rootId = document.rootId ?? 'root';
  const renderId =
    document.renderId ??
    `${[
      options.session.identity.appId,
      options.session.identity.entryName,
      options.session.identity.buildId,
    ]
      .map(value => encodeURIComponent(value).replaceAll("'", '%27'))
      .join(':')}:`;
  if (
    typeof rootId !== 'string' ||
    !rootId.trim() ||
    typeof renderId !== 'string' ||
    !renderId.trim()
  )
    throw new TypeError(
      'A Solid document requires nonempty rootId and renderId values.',
    );
  if (/[\s"'`=<>&]/u.test(renderId)) {
    throw new TypeError(
      'A Solid renderId cannot contain whitespace, quotes or HTML syntax.',
    );
  }
  if (
    document.lang !== undefined &&
    (typeof document.lang !== 'string' || !document.lang.trim())
  ) {
    throw new TypeError('A Solid document language must be a nonempty string.');
  }
  const assets = collectDocumentAssets(document.assets ?? []);
  const scriptCSPNonce = getDocumentNonce(document.nonce, 'script');
  const headAssets = assets
    .filter(asset => asset.kind !== 'script')
    .map(asset =>
      serializeDocumentAsset(
        asset,
        asset.kind === 'stylesheet'
          ? getDocumentNonce(document.nonce, 'style')
          : scriptCSPNonce,
      ),
    )
    .join('');
  const moduleAssets = assets
    .filter(asset => asset.kind === 'script')
    .map(asset => {
      if (!hydrating) return serializeDocumentAsset(asset, scriptCSPNonce);
      // The complete root and bootstraps precede these scripts. Hydration must
      // start while deferred native fragments keep the document stream open.
      return serializeDocumentAsset(
        asset,
        scriptCSPNonce,
        (asset.scriptType ?? 'module') === 'classic'
          ? { defer: false }
          : { async: true },
      );
    })
    .join('');
  const bootstrap = serializeInlineData({
    id: '__ULTRAMODERN_RENDERER__',
    payload: serializePublicData({
      identity: options.session.identity,
      documentId: renderId,
      hydrating,
    }),
    nonce: scriptCSPNonce,
  });
  const inlineData = (document.inlineData ?? [])
    .map(item => {
      if (item.id === '__ULTRAMODERN_RENDERER__' || item.id === rootId)
        throw new TypeError(
          'Document inline data cannot reuse the root or bootstrap id.',
        );
      return serializeInlineData({
        id: item.id,
        payload: item.payload,
        nonce: scriptCSPNonce,
      });
    })
    .join('');
  return {
    rootId,
    renderId,
    lang: ssrElementAttribute('lang', document.lang ?? 'en'),
    root: ssrElementAttribute('id', rootId),
    head:
      headAssets +
      bootstrap +
      inlineData +
      (hydrating ? generateHydrationScript({ nonce: scriptCSPNonce }) : ''),
    modules: moduleAssets,
  };
}

/** Construct the native document used by generated and hand-authored entries. */
export async function renderDocumentApplication<Bindings extends object>(
  options: SolidDocumentRenderOptions<Bindings>,
): Promise<Response> {
  try {
    const parts = createDocumentParts(options, true);
    return await renderApplication({
      session: options.session,
      document: {
        renderId: parts.renderId,
        nonce: options.document?.nonce,
        manifest: options.document?.manifest,
        onHead: options.document?.onHead,
      },
      onError: options.onError,
      view: () =>
        createComponent(NoHydration, {
          get children() {
            return ssr(
              [
                '<!doctype html><html',
                '><head>',
                '</head><body><div',
                '>',
                '</div>',
                '</body></html>',
              ],
              parts.lang,
              ssr(parts.head),
              parts.root,
              createComponent(Hydration, {
                id: parts.renderId,
                get children() {
                  return options.view();
                },
              }),
              ssr(parts.modules),
            );
          },
        }),
    });
  } catch (error) {
    void options.session.fail(error);
    throw error;
  }
}

/** CSR delivers an empty mount region and never evaluates an SSR application. */
export function renderCSRDocument<Bindings extends object>(
  options: Pick<SolidDocumentRenderOptions<Bindings>, 'session' | 'document'>,
): Response {
  const { session } = options;
  try {
    if (
      session.identity.renderer !== 'solid' ||
      (session.platform.kind !== 'node' && session.platform.kind !== 'worker')
    ) {
      throw new Error(
        'The Solid CSR document requires a Solid Node or worker request session.',
      );
    }
    if (
      session.responsePolicy?.kind !== 'document' ||
      [204, 205, 304].includes(session.responsePolicy.status)
    ) {
      throw new Error('Terminal HTTP outcomes bypass the Solid CSR document.');
    }
    const parts = createDocumentParts(options, false);
    const html = `<!doctype html><html${parts.lang}><head>${parts.head}</head><body><div${parts.root}></div>${parts.modules}</body></html>`;
    return respondApplication(
      session,
      new ReadableStream<Uint8Array>(
        {
          start(controller) {
            controller.enqueue(new TextEncoder().encode(html));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
    );
  } catch (error) {
    void session.fail(error);
    throw error;
  }
}
