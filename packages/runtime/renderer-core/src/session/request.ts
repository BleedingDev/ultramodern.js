import type { RendererIdentity } from '../identity';
import { identityCacheKey } from '../identity';
import { permitsDocumentCache } from './cache';
import type {
  RequestCleanup,
  RequestCompletion,
  RequestPlatform,
  RequestSession,
  RequestState,
  ResponsePolicy,
} from './types';

function freezeResponsePolicy(policy: ResponsePolicy): ResponsePolicy {
  if (
    !Number.isInteger(policy.status) ||
    policy.status < 200 ||
    policy.status > 599
  ) {
    throw new TypeError(
      'A renderer response status must be an integer from 200 to 599.',
    );
  }
  if (policy.kind !== 'document' && policy.kind !== 'terminal') {
    throw new TypeError(
      'A renderer response must identify its document or terminal outcome.',
    );
  }
  const statusText = policy.statusText;
  if (statusText !== undefined && typeof statusText !== 'string') {
    throw new TypeError('A renderer response status text must be a string.');
  }
  // Fetch validates the reason text before a response can claim its stream.
  new Response(null, {
    status: policy.status,
    ...(statusText === undefined ? {} : { statusText }),
  });
  if (!['no-store', 'private', 'public'].includes(policy.cache.mode)) {
    throw new TypeError('A renderer response has an unknown cache policy.');
  }
  if (
    policy.cache.mode === 'public' &&
    (!Number.isInteger(policy.cache.maxAgeSeconds) ||
      policy.cache.maxAgeSeconds < 0)
  ) {
    throw new TypeError(
      'A public document cache lifetime must be a nonnegative integer.',
    );
  }
  const headers = policy.headers.map(([name, value]) => {
    // Validate before committing. Keep separate Set-Cookie entries in the policy.
    new Headers([[name, value]]);
    return Object.freeze([name, value] as const);
  });
  return Object.freeze({
    kind: policy.kind,
    status: policy.status,
    ...(statusText === undefined ? {} : { statusText }),
    headers: Object.freeze(headers),
    cache: Object.freeze({ ...policy.cache }),
  });
}

/** Owns one request and the lifetime of its response body, not a server instance. */
export function createRequestSession<Bindings extends object>(input: {
  request: Request;
  identity: RendererIdentity;
  platform: RequestPlatform<Bindings>;
}): RequestSession<Bindings> {
  identityCacheKey(input.identity);
  if (input.platform.kind !== 'node' && input.platform.kind !== 'worker') {
    throw new TypeError(
      'A renderer request requires an explicit Node or worker binding.',
    );
  }
  const identity = Object.freeze({ ...input.identity });
  const platform = Object.freeze({ ...input.platform });
  const abortController = new AbortController();
  const disposers = new Set<RequestCleanup>();
  let state: RequestState = 'matching';
  let policy: ResponsePolicy | undefined;
  let committedPolicy: ResponsePolicy | undefined;
  let fallback = false;
  let responseCreated = false;
  let hasDocumentBody = false;
  let deliveredResponse: Response | undefined;
  let deliveredHeaders: Headers | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelPromise: Promise<void> | undefined;
  let finishPromise: Promise<RequestCompletion> | undefined;
  let resolveCompletion!: (completion: RequestCompletion) => void;
  const completion = new Promise<RequestCompletion>(resolve => {
    resolveCompletion = resolve;
  });

  const cancelSource = (reason: unknown) => {
    cancelPromise ??= reader
      ? reader.cancel(reason).finally(() => reader?.releaseLock())
      : Promise.resolve();
    return cancelPromise;
  };

  const finish = (
    terminalState: RequestCompletion['state'],
    error?: unknown,
  ): Promise<RequestCompletion> => {
    if (finishPromise) return finishPromise;
    state = terminalState;
    input.request.signal.removeEventListener('abort', onRequestAbort);
    const ownedDisposers = [...disposers].reverse();
    disposers.clear();
    finishPromise = Promise.resolve().then(async () => {
      const cleanupErrors: unknown[] = [];
      // A native cancel operation can wait for its renderer owner to dispose.
      // Start both paths before waiting for cancellation to finish.
      const cancellation =
        terminalState === 'completed'
          ? Promise.resolve()
          : cancelSource(error).catch(cancelError => {
              cleanupErrors.push(cancelError);
            });
      for (const dispose of ownedDisposers) {
        try {
          await dispose();
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      await cancellation;
      if (terminalState === 'completed' && cleanupErrors.length > 0)
        state = 'failed';
      const result: RequestCompletion = Object.freeze({
        state: state as RequestCompletion['state'],
        fallback,
        ...(error !== undefined ? { error } : {}),
        cleanupErrors: Object.freeze(cleanupErrors),
        cacheEligible:
          state === 'completed' &&
          hasDocumentBody &&
          !fallback &&
          committedPolicy !== undefined &&
          permitsDocumentCache({
            ...committedPolicy,
            // Server middleware can append cookies to the Fetch Response before
            // transport sends it. Cache admission must inspect those final headers.
            headers: deliveredHeaders
              ? [...deliveredHeaders.entries()]
              : committedPolicy.headers,
          }),
      });
      resolveCompletion(result);
      return result;
    });
    if (terminalState !== 'completed') {
      // Publish terminal ownership before notifying native abort listeners.
      // Re-entrant failures and cancellations then share this same completion.
      abortController.abort(error);
      bodyController?.error(error);
    }
    return finishPromise;
  };

  const abort = (
    reason: unknown = new DOMException(
      'The renderer request was aborted.',
      'AbortError',
    ),
  ) => {
    void finish('aborted', reason);
  };

  function onRequestAbort() {
    void abort(input.request.signal.reason);
  }

  const session: RequestSession<Bindings> = {
    request: input.request,
    identity,
    platform,
    signal: abortController.signal,
    get state() {
      return state;
    },
    get responsePolicy() {
      return policy;
    },
    get committedPolicy() {
      return committedPolicy;
    },
    completion,
    resolveResponse(nextPolicy) {
      if (committedPolicy || finishPromise) {
        throw new Error(
          'Renderer response status and headers are already committed or terminated.',
        );
      }
      policy = freezeResponsePolicy(nextPolicy);
      if (state === 'matching') state = 'ready';
    },
    startRendering() {
      if (state !== 'ready') {
        throw new Error(
          'Resolve the blocking HTTP outcome before starting the renderer.',
        );
      }
      state = 'rendering';
    },
    registerCleanup(dispose) {
      if (finishPromise)
        throw new Error(
          'Cannot register cleanup after a renderer request terminates.',
        );
      disposers.add(dispose);
      return () => {
        disposers.delete(dispose);
      };
    },
    markFallback() {
      if (finishPromise)
        throw new Error(
          'Cannot change fallback disposition after a renderer request terminates.',
        );
      fallback = true;
    },
    respond(body) {
      if (responseCreated || committedPolicy || finishPromise) {
        throw new Error(
          'A renderer request has exactly one response body consumer.',
        );
      }
      if (!policy || (state !== 'ready' && state !== 'rendering')) {
        throw new Error(
          'Resolve the blocking HTTP outcome before committing a response.',
        );
      }
      if (body !== null && [204, 205, 304].includes(policy.status)) {
        throw new TypeError(
          `HTTP ${policy.status} cannot contain a renderer response body.`,
        );
      }
      reader = body?.getReader();
      hasDocumentBody = body !== null;
      responseCreated = true;
      committedPolicy = policy;
      state = 'committed';
      const headers = new Headers();
      for (const [name, value] of committedPolicy.headers)
        headers.append(name, value);
      if (!reader) {
        void finish('completed');
        const response = new Response(null, {
          status: committedPolicy.status,
          ...(committedPolicy.statusText === undefined
            ? {}
            : { statusText: committedPolicy.statusText }),
          headers,
        });
        deliveredResponse = response;
        deliveredHeaders = response.headers;
        return response;
      }
      const sourceReader = reader;
      const wrappedBody = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            bodyController = controller;
          },
          async pull(controller) {
            try {
              const next = await sourceReader.read();
              if (finishPromise) return;
              if (!next.done) {
                controller.enqueue(next.value);
                return;
              }
              sourceReader.releaseLock();
              const result = await finish('completed');
              if (result.cleanupErrors.length > 0) {
                controller.error(
                  new AggregateError(
                    result.cleanupErrors,
                    'Renderer request cleanup failed.',
                  ),
                );
              } else {
                controller.close();
              }
            } catch (error) {
              if (!finishPromise) {
                await finish('failed', error);
                controller.error(error);
              }
            }
          },
          cancel(reason) {
            abort(reason);
            return completion.then(() => {});
          },
        },
        { highWaterMark: 0 },
      );
      const response = new Response(wrappedBody, {
        status: committedPolicy.status,
        ...(committedPolicy.statusText === undefined
          ? {}
          : { statusText: committedPolicy.statusText }),
        headers,
      });
      deliveredResponse = response;
      deliveredHeaders = response.headers;
      return response;
    },
    ownsResponseBody(response) {
      return (
        deliveredResponse !== undefined &&
        (response === deliveredResponse ||
          (deliveredResponse.body !== null &&
            response.body === deliveredResponse.body))
      );
    },
    fail(error) {
      void finish('failed', error);
    },
    abort,
  };
  if (input.request.signal.aborted) onRequestAbort();
  else
    input.request.signal.addEventListener('abort', onRequestAbort, {
      once: true,
    });
  return session;
}
