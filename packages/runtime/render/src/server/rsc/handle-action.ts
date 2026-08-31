import type { ReactElement } from 'react';

// Fork-owned shared implementation of the RSC server-action handler.
//
// The Node entry (`rsc.tsx`, upstream file) and the edge worker entry
// (`rsc.worker.tsx`, fork-added) only differ in which react-server-dom-rspack
// runtime they bind (`server.node` vs `server.edge`). The security-sensitive
// request handling lives here exactly once so upstream fixes only need to be
// merged in a single place. Behavior is intentionally identical to upstream's
// `handleAction` in rsc.tsx — do not diverge the two lanes here.
export type RscActionRuntime = {
  decodeReply: (body: string | FormData) => Promise<unknown[]>;
  loadServerAction: (actionId: string) => unknown;
  renderRsc: (options: { element: ReactElement }) => ReadableStream<Uint8Array>;
};

const MAX_ACTION_BODY_BYTES = 1024 * 1024;

const readBoundedBody = async (
  req: Request,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  const reader = req.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }

  const bytes = new Uint8Array(MAX_ACTION_BODY_BYTES);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return bytes.slice(0, size);
      }
      if (value.byteLength > MAX_ACTION_BODY_BYTES - size) {
        void reader.cancel().catch(() => {});
        return null;
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
};

export const createHandleAction =
  ({ decodeReply, loadServerAction, renderRsc }: RscActionRuntime) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'POST' },
      });
    }

    try {
      const serverReference = req.headers.get('x-rsc-action');
      if (!serverReference) {
        return new Response('Cannot find server reference', { status: 404 });
      }

      const declaredLength = req.headers.get('content-length');
      if (declaredLength !== null) {
        const parsedLength = Number(declaredLength);
        if (
          !/^\d+$/.test(declaredLength) ||
          !Number.isSafeInteger(parsedLength)
        ) {
          return new Response('Invalid server action request', { status: 400 });
        }
        if (parsedLength > MAX_ACTION_BODY_BYTES) {
          return new Response('Server action payload too large', {
            status: 413,
          });
        }
      }

      const action = loadServerAction(serverReference);
      if (typeof action !== 'function') {
        console.error(
          '[RSC] Invalid action: server reference is not a function, serverReference:',
          serverReference,
        );
        return new Response('Invalid action', { status: 400 });
      }

      const contentType = req.headers.get('content-type');

      let args;
      try {
        const body = await readBoundedBody(req);
        if (body === null) {
          return new Response('Server action payload too large', {
            status: 413,
          });
        }
        if (contentType?.includes('multipart/form-data')) {
          const formData = await new Response(body, {
            headers: { 'Content-Type': contentType },
          }).formData();
          args = await decodeReply(formData);
        } else {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
          args = await decodeReply(text);
        }
      } catch (error) {
        console.error(
          '[RSC] Failed to decode request arguments, error:',
          error instanceof Error ? error.message : String(error),
          'contentType:',
          contentType || 'unknown',
        );
        return new Response('Failed to decode request arguments', {
          status: 400,
        });
      }

      // Handle both sync and async actions
      const result = await Promise.resolve(action.apply(null, args));
      const stream = renderRsc({
        element: result,
      });

      const response = new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/x-component',
        },
      });

      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error(
        '[RSC] Error handling server action, error:',
        errorMessage,
        errorStack ? `\n${errorStack}` : '',
      );
      return new Response('Internal server error', { status: 500 });
    }
  };
