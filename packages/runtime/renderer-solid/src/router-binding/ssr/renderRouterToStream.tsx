import type { JSX } from '@solidjs/web';
import * as Solid from '@solidjs/web';
import type { AnyRouter } from '@tanstack/router-core';
import {
  createSsrStreamResponse,
  getSsrStatus,
  transformReadableStreamWithRouter,
  waitForRequest,
} from '@tanstack/router-core/ssr/server';
import { isbot } from 'isbot';
import {
  getSolidRenderOptions,
  type SolidRenderOptions,
} from './renderOptions';

export const renderRouterToStream = async ({
  request,
  router,
  responseHeaders,
  children,
  manifest,
}: {
  request: Request;
  router: AnyRouter;
  responseHeaders: Headers;
  children: () => JSX.Element;
  manifest?: SolidRenderOptions['manifest'];
}) => {
  const signal = request.signal;
  if (signal.aborted) {
    router.serverSsr?.cleanup();
    throw signal.reason;
  }

  try {
    const docType = Solid.ssr('<!DOCTYPE html>');
    const stream = Solid.renderToStream(
      () => (
        <>
          {docType}
          {children()}
        </>
      ),
      getSolidRenderOptions(router, manifest),
    );

    // The core transform owns cancellation and request-local SSR cleanup.
    // Solid has no disposal handle for unresolved renderer continuations.
    const { readable, writable } = new TransformStream<
      Uint8Array,
      Uint8Array
    >();
    const rendererAbort = isbot(request.headers.get('User-Agent'))
      ? new AbortController()
      : undefined;
    const responseStream = transformReadableStreamWithRouter(router, readable, {
      rendererSafePoint: 'record-end',
      signal,
      onAbort: rendererAbort
        ? reason => rendererAbort.abort(reason)
        : undefined,
    });

    if (rendererAbort) {
      await waitForRequest(stream, rendererAbort.signal);
    }

    void Promise.resolve(stream.pipeTo(writable)).catch((error: unknown) => {
      console.error('Error in Solid render stream:', error);
      void writable.abort(error).catch(() => {});
    });

    return createSsrStreamResponse(
      router,
      new Response(responseStream, {
        status: getSsrStatus(router),
        headers: responseHeaders,
      }),
    );
  } catch (error) {
    router.serverSsr?.cleanup();
    throw error;
  }
};
