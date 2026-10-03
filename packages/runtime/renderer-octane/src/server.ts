import {
  collectDocumentAssets,
  type DocumentAsset,
  type RequestSession,
  type ResponsePolicy,
  serializeDocumentAsset,
  serializeInlineData,
} from '@modern-js/renderer-core/session';
import {
  earlySignalBootstrapScript,
  renderToReadableStream,
  type ServerRenderNode,
  type StreamOptions,
} from 'octane/server';
import {
  assertNativeHydrationBuildId,
  encodeOctaneDocumentBootstrap,
  OCTANE_BOOTSTRAP_ID,
} from './bootstrap';

export interface OctaneDocumentOptions {
  /** One identity for this response, shared with the client's signal receiver. */
  readonly documentId: string;
  /** Actual native client compilation hash, separate from application identity. */
  readonly nativeHydrationBuildId: string;
  readonly rootId?: string;
  readonly lang?: string;
  readonly nonce?: string;
  readonly assets?: readonly DocumentAsset[];
}

export interface OctaneDocumentResponseOptions<
  Bindings extends object = object,
> {
  readonly session: RequestSession<Bindings>;
  readonly document: OctaneDocumentOptions;
  readonly responsePolicy?: ResponsePolicy;
  /** Native route loading finishes its blocking HTTP work before rendering. */
  readonly resolveResponse?: (
    session: RequestSession<Bindings>,
  ) => ResponsePolicy | Promise<ResponsePolicy>;
}

export interface RenderOctaneApplicationOptions<
  Bindings extends object = object,
> extends OctaneDocumentResponseOptions<Bindings> {
  readonly App: ServerRenderNode;
  readonly props?: unknown;
  /** Native router serialization, owned by this request's router SSR context. */
  readonly injection?: StreamOptions['injection'];
}

function documentAttribute(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`An Octane document requires a nonempty ${name}.`);
  }
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function prepareOctaneDocument<Bindings extends object>(
  session: RequestSession<Bindings>,
  document: OctaneDocumentOptions,
  hydrating: boolean,
) {
  if (session.identity.renderer !== 'octane') {
    throw new Error('The Octane adapter requires an Octane renderer identity.');
  }
  if (session.platform.kind !== 'node') {
    throw new Error('Octane worker rendering has not been admitted.');
  }
  assertNativeHydrationBuildId(document.nativeHydrationBuildId);
  const rootId = documentAttribute(document.rootId ?? 'root', 'rootId');
  if (rootId === OCTANE_BOOTSTRAP_ID) {
    throw new Error('An Octane root cannot share the document bootstrap id.');
  }
  const lang = documentAttribute(document.lang ?? 'en', 'lang');
  const bootstrap = serializeInlineData({
    id: OCTANE_BOOTSTRAP_ID,
    payload: encodeOctaneDocumentBootstrap({
      identity: session.identity,
      documentId: document.documentId,
      nativeHydrationBuildId: document.nativeHydrationBuildId,
      hydrating,
    }),
    ...(document.nonce === undefined ? {} : { nonce: document.nonce }),
  });
  const assets = collectDocumentAssets(document.assets ?? []);
  const headAssets = assets
    .filter(asset => asset.kind !== 'script')
    .map(asset => serializeDocumentAsset(asset, document.nonce))
    .join('');
  const entryScripts = assets
    .filter(asset => asset.kind === 'script')
    .map(asset =>
      serializeDocumentAsset(asset, document.nonce, {
        // Native ESM entry graphs can execute before document EOF. Classic
        // runtime/application chunks retain parser order from the build manifest.
        async: hydrating && asset.scriptType !== 'classic',
        ...(hydrating && asset.scriptType === 'classic'
          ? { defer: false }
          : {}),
      }),
    )
    .join('');
  return { rootId, lang, bootstrap, headAssets, entryScripts };
}

async function resolveDocumentResponse<Bindings extends object>(
  input: OctaneDocumentResponseOptions<Bindings>,
): Promise<void> {
  const { session } = input;
  if (input.responsePolicy && input.resolveResponse) {
    throw new Error('Choose one blocking Octane response policy resolver.');
  }
  if (input.resolveResponse) {
    session.resolveResponse(await input.resolveResponse(session));
  } else if (input.responsePolicy) {
    session.resolveResponse(input.responsePolicy);
  } else if (!session.responsePolicy) {
    session.resolveResponse({
      kind: 'document',
      status: 200,
      headers: [['content-type', 'text/html; charset=utf-8']],
      cache: { mode: 'no-store' },
    });
  }
}

/** Deliver the CSR document; native browser mounting owns the empty root. */
export async function renderOctaneCSRDocument<Bindings extends object>(
  input: OctaneDocumentResponseOptions<Bindings>,
): Promise<Response> {
  const { session } = input;
  try {
    const { rootId, lang, bootstrap, headAssets, entryScripts } =
      prepareOctaneDocument(session, input.document, false);
    await resolveDocumentResponse(input);
    if (session.responsePolicy?.kind === 'terminal')
      return session.respond(null);
    session.startRendering();
    const bytes = new TextEncoder().encode(
      `<!doctype html><html lang="${lang}"><head>${headAssets}</head><body><div id="${rootId}"></div>${bootstrap}${entryScripts}</body></html>`,
    );
    return session.respond(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    );
  } catch (error) {
    await session.fail(error);
    throw error;
  }
}

/**
 * Render a native Octane application into one request-owned HTML document.
 * The dispatcher owns the session; this adapter owns native stream consumption
 * and document placement. A late native error fails the body without changing
 * the status and headers already sent to the client.
 */
export async function renderOctaneApplication<Bindings extends object>(
  input: RenderOctaneApplicationOptions<Bindings>,
): Promise<Response> {
  const { session, document } = input;
  try {
    const { rootId, lang, bootstrap, headAssets, entryScripts } =
      prepareOctaneDocument(session, document, true);
    const earlyBootstrap = earlySignalBootstrapScript(
      document.nonce === undefined ? {} : { nonce: document.nonce },
    );

    await resolveDocumentResponse(input);
    if (session.responsePolicy?.kind === 'terminal')
      return session.respond(null);
    session.startRendering();

    let head = '';
    let renderError: unknown;
    let didRenderError = false;
    const nativeStream = await renderToReadableStream(input.App, input.props, {
      signal: session.signal,
      ...(document.nonce === undefined ? {} : { nonce: document.nonce }),
      earlySignalBootstrap: 'external',
      ...(input.injection === undefined ? {} : { injection: input.injection }),
      streamedSignals: {
        buildId: document.nativeHydrationBuildId,
        documentId: document.documentId,
      },
      headChannel: 'separate',
      onHeadReady(value) {
        head = value;
      },
      onError(error) {
        // Native recoverable boundaries can close their HTML stream normally.
        // Fail immediately so other pending producers cannot keep cleanup or
        // cache admission waiting for native EOF.
        didRenderError = true;
        renderError ??= error;
        void session.fail(error);
      },
    });
    // Observe rejection immediately, but consume concurrently: native allReady
    // requires downstream demand and cannot be awaited before reading the body.
    const ready = nativeStream.allReady.then(
      () => ({ ok: true as const }),
      error => ({ ok: false as const, error }),
    );
    const reader = nativeStream.getReader();
    const encoder = new TextEncoder();
    const prefix = encoder.encode(
      `<!doctype html><html lang="${lang}"><head>${head}${headAssets}</head><body>${earlyBootstrap}<div id="${rootId}">`,
    );
    const shellBootstrap = encoder.encode(`</div>${bootstrap}${entryScripts}`);
    const suffix = encoder.encode('</body></html>');
    let phase: 'prefix' | 'shell' | 'bootstrap' | 'native' | 'done' = 'prefix';
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      reader.releaseLock();
    };
    let cancellation: Promise<void> | undefined;
    const cancelNative = (reason: unknown): Promise<void> => {
      if (cancellation) return cancellation;
      if (released) return Promise.resolve();
      cancellation = reader.cancel(reason).finally(release);
      return cancellation;
    };
    try {
      session.registerCleanup(() => cancelNative(session.signal.reason));
    } catch (error) {
      // The request can abort between native shell readiness and registration.
      await cancelNative(error);
      throw error;
    }
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            if (phase === 'prefix') {
              phase = 'shell';
              controller.enqueue(prefix);
              return;
            }
            if (phase === 'bootstrap') {
              phase = 'native';
              controller.enqueue(shellBootstrap);
              return;
            }
            const next = await reader.read();
            if (!next.done) {
              // Octane 0.7.1 writes its complete initial shell as the first
              // chunk, including initial signal selections. Close only our
              // root after it, then start the browser before deferred segments.
              // Later native carriers find their targets in the whole document.
              if (phase === 'shell') phase = 'bootstrap';
              controller.enqueue(next.value);
              return;
            }
            if (phase === 'shell') {
              throw new Error(
                'Octane ended before publishing its initial shell.',
              );
            }
            const completion = await ready;
            release();
            if (!completion.ok) throw completion.error;
            if (didRenderError) throw renderError;
            phase = 'done';
            controller.enqueue(suffix);
            controller.close();
          } catch (error) {
            phase = 'done';
            // An errored ReadableStream does not invoke its cancel callback.
            // Release the native owner here as well as on consumer cancellation.
            await cancelNative(error).catch(() => {});
            controller.error(error);
          }
        },
        async cancel(reason) {
          phase = 'done';
          await cancelNative(reason);
        },
      },
      { highWaterMark: 0 },
    );
    return session.respond(body);
  } catch (error) {
    await session.fail(error);
    throw error;
  }
}
