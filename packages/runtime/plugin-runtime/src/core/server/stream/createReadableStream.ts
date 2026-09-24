// @effect-diagnostics asyncFunction:off newPromise:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off
import type { StreamSSRExtender } from '@modern-js/plugin/runtime';
import { storage } from '@modern-js/runtime-utils/node';
import { SSR_HYDRATION_ID_PREFIX } from '@modern-js/utils/universal/constants';
import { finished, PassThrough, pipeline, Readable, Transform } from 'stream';
import { ESCAPED_SHELL_STREAM_END_MARK } from '../../../common';
import { RenderLevel } from '../../constants';
import {
  getGlobalEnableRsc,
  getGlobalInternalRuntimeContext,
} from '../../context';
import { getMonitors } from '../../context/monitors';
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
  ShellChunkStatus,
} from './shared';
import { getTemplates } from './template';

export const createReadableStreamFromElement: CreateReadableStreamFromElement =
  async (request, rootElement, options) => {
    const { renderToPipeableStream } = await import('react-dom/server');
    const {
      runtimeContext,
      htmlTemplate,
      config,
      ssrConfig,
      entryName,
      resource,
    } = options;
    const hooks = getGlobalInternalRuntimeContext().hooks;
    const isRsc = getGlobalEnableRsc() === true;
    const extenders: StreamSSRExtender[] =
      hooks.extendStreamSSR.call({
        runtimeContext,
        request,
        resource,
        config,
        platform: 'node',
        mode: 'stream',
        isRsc,
        terminalMarker: ESCAPED_SHELL_STREAM_END_MARK,
      }) || [];
    const lifecycle = createSSRRenderLifecycle(extenders);
    const reportError = createSSRStreamErrorReporter(options.onError);
    const forceStream2String = Boolean(process.env.MODERN_JS_STREAM_TO_STRING);
    const { onReady } = resolveStreamingMode(request, forceStream2String);
    let renderLevel = RenderLevel.SERVER_RENDER;
    let hasStartedPipe = false;
    let failed = false;
    let reactStream: ReturnType<typeof renderToPipeableStream> | undefined;
    const ownedStreams = new Set<NodeJS.ReadWriteStream>();
    const streamCompletions: Promise<Error | undefined>[] = [];
    let teardown: Promise<void> | undefined;

    return new Promise<ReadableStream<Uint8Array>>((resolve, reject) => {
      const destroyOwnedStreams = (reason?: unknown): Promise<void> => {
        if (teardown) return teardown;
        const error =
          reason === undefined
            ? undefined
            : reason instanceof Error
              ? reason
              : new Error(String(reason));
        for (const stream of ownedStreams) {
          const destroyable = stream as NodeJS.ReadWriteStream & {
            destroy?: (error?: Error) => void;
          };
          destroyable.destroy?.(error);
        }
        teardown = Promise.all(streamCompletions).then(errors => {
          const cleanupError = errors.find(
            value =>
              value !== undefined &&
              value !== error &&
              (value as NodeJS.ErrnoException).code !==
                'ERR_STREAM_PREMATURE_CLOSE',
          );
          if (cleanupError) throw cleanupError;
        });
        return teardown;
      };
      const abortReact = (reason?: unknown) => reactStream?.abort(reason);
      const fail = (error: unknown) => {
        if (failed) return;
        failed = true;
        request.signal.removeEventListener('abort', onStartupAbort);
        if (request.signal.aborted) {
          lifecycle.finish({
            status: 'cancelled',
            reason: request.signal.reason,
          });
        } else {
          lifecycle.finish({ status: 'error', error });
          reportError(error);
        }
        abortReact(error);
        destroyOwnedStreams(error).then(
          () => reject(error),
          () => reject(error),
        );
      };
      const own = (stream: NodeJS.ReadWriteStream) => {
        if (!ownedStreams.has(stream)) {
          ownedStreams.add(stream);
          streamCompletions.push(
            new Promise<Error | undefined>(done => {
              finished(stream, error => done(error ?? undefined));
            }),
          );
          stream.on('error', fail);
        }
        return stream;
      };
      const onStartupAbort = () => fail(request.signal.reason);
      const deliver = (source: ReadableStream<Uint8Array>) => {
        const stream = observeSSRStream(source, {
          lifecycle,
          signal: request.signal,
          async onError(error) {
            failed = true;
            abortReact(error);
            await destroyOwnedStreams(error);
            reportError(error);
          },
          onCancel(reason) {
            failed = true;
            const cleanup = destroyOwnedStreams();
            abortReact(reason);
            return cleanup;
          },
        });
        request.signal.removeEventListener('abort', onStartupAbort);
        resolve(stream);
      };
      const templateOptions = () => ({
        request,
        ssrConfig,
        renderLevel,
        runtimeContext,
        config,
        entryName,
        lifecycle,
      });

      const startOutput = async () => {
        if (hasStartedPipe || failed) return;
        hasStartedPipe = true;
        const styledComponentsStyleTags = extenders
          .map(extender => extender.getStyleTags?.() ?? '')
          .join('');
        options[onReady]?.();
        // Head is read only after the completed shell has passed body transforms.
        const { shellBefore, shellAfter } = await getTemplates(htmlTemplate, {
          ...templateOptions(),
          styledComponentsStyleTags,
        });
        if (failed) return;
        const chunks: Buffer[] = [];
        const marker = Buffer.from(ESCAPED_SHELL_STREAM_END_MARK);
        const pendingScripts: string[] = [];
        let shellChunkStatus = ShellChunkStatus.START;
        const emitShell = (
          destination: Transform,
          buffered: Buffer,
          markerIndex: number,
        ) => {
          const beforeMark = lifecycle.completedBody(
            buffered.subarray(0, markerIndex).toString('utf8'),
            'shell',
          );
          const completedShellBefore = createReplaceHelemt(
            getHelmetData(extenders),
          )(shellBefore);
          shellChunkStatus = ShellChunkStatus.FINISH;
          chunks.length = 0;
          destination.push(`${completedShellBefore}${beforeMark}${shellAfter}`);
          const afterMark = buffered.subarray(markerIndex + marker.length);
          if (afterMark.length > 0) destination.push(afterMark);
          for (const script of pendingScripts) destination.push(script);
          pendingScripts.length = 0;
        };
        const body = new Transform({
          transform(chunk, _encoding, callback) {
            try {
              if (shellChunkStatus === ShellChunkStatus.FINISH) {
                this.push(chunk);
              } else {
                chunks.push(
                  Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
                );
                const buffered = Buffer.concat(chunks);
                const markerIndex = buffered.indexOf(marker);
                if (markerIndex !== -1) emitShell(this, buffered, markerIndex);
              }
              callback();
            } catch (error) {
              callback(
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          },
          flush(callback) {
            try {
              // A normal Node EOF completes an unmarked shell without losing bytes.
              if (shellChunkStatus !== ShellChunkStatus.FINISH) {
                const buffered = Buffer.concat(chunks);
                emitShell(this, buffered, buffered.length);
              }
              callback();
            } catch (error) {
              callback(
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          },
        });
        own(body);
        const passThrough = new PassThrough();
        let processedStream = own(passThrough);
        for (const extender of orderSSRStreamTransforms(extenders)) {
          if (extender.processStream)
            processedStream = own(extender.processStream(processedStream));
        }
        pipeline(processedStream, body, error => {
          if (error !== undefined && error !== null && !failed) fail(error);
        });
        deliver(Readable.toWeb(body) as ReadableStream<Uint8Array>);
        reactStream!.pipe(passThrough);

        try {
          const activeDeferreds = storage.useContext?.()?.activeDeferreds;
          const entries: Array<[string, unknown]> =
            activeDeferreds instanceof Map
              ? Array.from(activeDeferreds.entries())
              : [];
          enqueueFromEntries(entries, config.nonce, script => {
            if (failed || body.destroyed || body.writableEnded) return;
            if (shellChunkStatus === ShellChunkStatus.FINISH)
              body.write(script);
            else pendingScripts.push(script);
          });
        } catch (error) {
          getMonitors().error('cannot inject router data script', error);
        }
      };
      const renderFallback = async (error: unknown) => {
        if (failed || hasStartedPipe) return;
        lifecycle.finish({ status: 'fallback', error });
        renderLevel = RenderLevel.CLIENT_RENDER;
        const { shellBefore, shellAfter } = await getTemplates(htmlTemplate, {
          ...templateOptions(),
          helmetData: getHelmetData(extenders),
        });
        if (failed) return;
        options.onShellError?.(error);
        deliver(getReadableStreamFromString(`${shellBefore}${shellAfter}`));
      };

      request.signal.addEventListener('abort', onStartupAbort, { once: true });
      try {
        request.signal.throwIfAborted();
        for (const extender of extenders)
          extender.init?.({ rootElement, forceStream2String });
        let processedRootElement =
          isRsc && runtimeContext.isBrowser === false
            ? wrapRuntimeComponentResolver(rootElement, hooks)
            : rootElement;
        for (const extender of extenders) {
          processedRootElement =
            extender.modifyRootElement?.(processedRootElement) ??
            processedRootElement;
        }
        lifecycle.beforeReact();
        reactStream = renderToPipeableStream(processedRootElement, {
          nonce: config.nonce,
          identifierPrefix: SSR_HYDRATION_ID_PREFIX,
          [onReady]() {
            startOutput().catch(fail);
          },
          onShellError(error: unknown) {
            renderFallback(error).catch(fail);
          },
          onError(error: unknown) {
            renderLevel = RenderLevel.CLIENT_RENDER;
            if (!request.signal.aborted && !failed) reportError(error);
          },
        });
      } catch (error) {
        fail(error);
      }
    });
  };
