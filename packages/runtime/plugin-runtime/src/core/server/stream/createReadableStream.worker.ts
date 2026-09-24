// @effect-diagnostics asyncFunction:off processEnv:off
import type { StreamSSRExtender } from '@modern-js/plugin/runtime';
import { renderSSRStream } from '@modern-js/render/ssr';
import { storage } from '@modern-js/runtime-utils/node';
import React from 'react';
import { ESCAPED_SHELL_STREAM_END_MARK } from '../../../common';
import { RenderLevel } from '../../constants';
import {
  getGlobalEnableRsc,
  getGlobalInternalRuntimeContext,
} from '../../context';
import { wrapRuntimeComponentResolver } from '../../react/wrapper';
import { createReplaceHelemt, getHelmetData } from '../helmet';
import {
  createSSRRenderLifecycle,
  createSSRStreamErrorReporter,
  observeSSRStream,
  orderSSRStreamTransforms,
} from '../shared';
import { enqueueFromEntries } from './deferredScript';
import {
  type CreateReadableStreamFromElement,
  getReadableStreamFromString,
  resolveStreamingMode,
  SHELL_PROGRESSIVE_CHUNK_SIZE,
  ShellChunkStatus,
} from './shared';
import { getTemplates } from './template';

export const createReadableStreamFromElement: CreateReadableStreamFromElement =
  async (request, rootElement, options) => {
    const {
      htmlTemplate,
      runtimeContext,
      config,
      ssrConfig,
      entryName,
      resource,
      rscManifest,
      rscRoot,
    } = options;
    const hooks = getGlobalInternalRuntimeContext().hooks;
    const isRsc = getGlobalEnableRsc() === true;
    const extenders: StreamSSRExtender[] =
      hooks.extendStreamSSR.call({
        runtimeContext,
        request,
        resource,
        config,
        platform: 'web',
        mode: 'stream',
        isRsc,
        terminalMarker: ESCAPED_SHELL_STREAM_END_MARK,
      }) || [];
    const lifecycle = createSSRRenderLifecycle(extenders);
    const reportOnce = createSSRStreamErrorReporter(options.onError);
    const reportError = (error: unknown) => {
      if (!request.signal.aborted && lifecycle.terminal?.status !== 'cancelled')
        reportOnce(error);
    };
    const forceStream2String = Boolean(
      typeof process !== 'undefined' && process.env?.MODERN_JS_STREAM_TO_STRING,
    );
    let pendingSource: ReadableStream<Uint8Array> | undefined;
    let bodyOpen = true;
    let bodyPipe: Promise<void> | undefined;
    const templateOptions = {
      runtimeContext,
      ssrConfig,
      request,
      config,
      entryName,
      lifecycle,
    };
    try {
      request.signal.throwIfAborted();
      for (const extender of extenders)
        extender.init?.({ rootElement, forceStream2String });
      const readableOriginal = await renderSSRStream(rootElement, {
        request,
        signal: request.signal,
        nonce: config.nonce,
        progressiveChunkSize: SHELL_PROGRESSIVE_CHUNK_SIZE,
        rscManifest,
        rscRoot: rscRoot!,
        routes: runtimeContext.routes,
        onError: reportError,
        wrapHtmlRoot(root) {
          // Request-valued providers must never enter renderRsc's Flight input.
          let element = React.isValidElement(root)
            ? root
            : React.createElement(React.Fragment, null, root);
          if (isRsc && runtimeContext.isBrowser === false)
            element = wrapRuntimeComponentResolver(element, hooks);
          for (const extender of extenders)
            element = extender.modifyRootElement?.(element) ?? element;
          lifecycle.beforeReact();
          return element;
        },
      });
      pendingSource = readableOriginal;
      options.onShellReady?.();
      readableOriginal.allReady
        .then(() => options.onAllReady?.())
        .catch(reportError);
      const { waitForAllReady } = resolveStreamingMode(
        request,
        forceStream2String,
      );
      if (waitForAllReady) await readableOriginal.allReady;
      request.signal.throwIfAborted();
      const styledComponentsStyleTags = extenders
        .map(extender => extender.getStyleTags?.() ?? '')
        .join('');
      const { shellBefore, shellAfter } = await getTemplates(htmlTemplate, {
        ...templateOptions,
        renderLevel: RenderLevel.SERVER_RENDER,
        styledComponentsStyleTags,
      });
      for (const extender of orderSSRStreamTransforms(extenders)) {
        if (extender.processReadableStream !== undefined)
          pendingSource = extender.processReadableStream(pendingSource);
      }
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      const pendingScripts: string[] = [];
      let buffered = '';
      let shellChunkStatus = ShellChunkStatus.START;
      let bodyController: TransformStreamDefaultController<Uint8Array>;
      const emit = (
        chunk: string,
        controller: TransformStreamDefaultController<Uint8Array>,
      ) => {
        if (shellChunkStatus === ShellChunkStatus.FINISH) {
          if (chunk.length > 0) controller.enqueue(encoder.encode(chunk));
          return;
        }
        buffered += chunk;
        const markerIndex = buffered.indexOf(ESCAPED_SHELL_STREAM_END_MARK);
        if (markerIndex === -1) return;
        const beforeMark = lifecycle.completedBody(
          buffered.slice(0, markerIndex),
          'shell',
        );
        const afterMark = buffered.slice(
          markerIndex + ESCAPED_SHELL_STREAM_END_MARK.length,
        );
        const completedShellBefore = createReplaceHelemt(
          getHelmetData(extenders),
        )(shellBefore);
        shellChunkStatus = ShellChunkStatus.FINISH;
        buffered = '';
        controller.enqueue(
          encoder.encode(`${completedShellBefore}${beforeMark}${shellAfter}`),
        );
        if (afterMark.length > 0) controller.enqueue(encoder.encode(afterMark));
        for (const script of pendingScripts)
          controller.enqueue(encoder.encode(script));
        pendingScripts.length = 0;
      };
      const body = new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
        transform(chunk, controller) {
          emit(decoder.decode(chunk, { stream: true }), controller);
        },
        flush(controller) {
          bodyOpen = false;
          emit(decoder.decode(), controller);
          if (shellChunkStatus !== ShellChunkStatus.FINISH)
            throw new Error('React SSR stream ended before the shell marker');
        },
      });
      bodyPipe = pendingSource.pipeTo(body.writable);
      // Retain completion so cancellation cannot outlive the returned body.
      bodyPipe.catch(() => {});
      pendingSource = body.readable;
      const activeDeferreds = storage.useContext?.()?.activeDeferreds;
      const entries: Array<[string, unknown]> =
        activeDeferreds instanceof Map
          ? Array.from(activeDeferreds.entries())
          : [];
      enqueueFromEntries(entries, config.nonce, script => {
        if (!bodyOpen) return;
        if (shellChunkStatus === ShellChunkStatus.FINISH) {
          try {
            bodyController.enqueue(encoder.encode(script));
          } catch {
            bodyOpen = false;
          }
        } else pendingScripts.push(script);
      });
      return observeSSRStream(pendingSource, {
        lifecycle,
        async onError(error) {
          bodyOpen = false;
          await bodyPipe?.catch(() => {});
          reportError(error);
        },
        signal: request.signal,
        async onCancel(reason) {
          bodyOpen = false;
          await bodyPipe?.catch(error => {
            if (error !== reason) throw error;
          });
        },
        onComplete: () => bodyPipe,
      });
    } catch (error) {
      bodyOpen = false;
      if (pendingSource !== undefined) {
        try {
          await pendingSource.cancel(error);
          await bodyPipe?.catch(() => {});
        } catch (cancelError) {
          if (!request.signal.aborted) reportError(cancelError);
        }
      }
      if (request.signal.aborted) {
        lifecycle.finish({
          status: 'cancelled',
          reason: request.signal.reason,
        });
        throw request.signal.reason;
      }
      lifecycle.finish({ status: 'fallback', error });
      reportError(error);
      const { shellBefore, shellAfter } = await getTemplates(htmlTemplate, {
        ...templateOptions,
        renderLevel: RenderLevel.CLIENT_RENDER,
        helmetData: getHelmetData(extenders),
      });
      return observeSSRStream(
        getReadableStreamFromString(`${shellBefore}${shellAfter}`),
        {
          lifecycle,
          onError: reportError,
          signal: request.signal,
        },
      );
    }
  };
