import type { RequestSession } from '@modern-js/renderer-core/session';
import type { AnyRouter } from '@octanejs/tanstack-router';
import type { StreamInjectionSource } from 'octane/server';
import { cleanupOctaneRouterSSR } from './router-server-cleanup';

const SERIALIZATION_TIMEOUT_MS = 60_000;

export interface OctaneRouterInjectionOptions {
  serializationTimeoutMs?: number;
}

/** Couple native router serialization to the response's single stream owner. */
export function createOctaneRouterInjection(
  router: AnyRouter,
  session: RequestSession,
  options: OctaneRouterInjectionOptions = {},
): StreamInjectionSource {
  const serverSsr = router.serverSsr;
  if (!serverSsr) {
    throw new Error('Native Octane router.serverSsr is required for streaming');
  }
  const timeoutMs = options.serializationTimeoutMs ?? SERIALIZATION_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > SERIALIZATION_TIMEOUT_MS
  ) {
    throw new TypeError(
      'Octane router serialization timeout must be 1 to 60000 ms',
    );
  }
  session.signal.throwIfAborted();
  let settled = false;
  let released = false;
  let renderFinished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopSerialization: (() => void) | undefined;
  const subscriptions = new Set<() => void>();
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // The caller may fail before attaching the injection to its native renderer.
  void done.catch(() => {});

  const settle = (error?: unknown) => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    stopSerialization?.();
    stopSerialization = undefined;
    if (error === undefined) resolveDone();
    else rejectDone(error);
  };
  const release = () => {
    if (released) return;
    released = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    stopSerialization?.();
    stopSerialization = undefined;
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions.clear();
    session.signal.removeEventListener('abort', onAbort);
    if (!settled) {
      settle(
        session.signal.reason ??
          new Error('Octane router serialization was interrupted'),
      );
    }
  };
  function onAbort() {
    settle(
      session.signal.reason ??
        new DOMException('Octane request aborted', 'AbortError'),
    );
    release();
  }

  if (serverSsr.isSerializationFinished()) settle();
  else stopSerialization = serverSsr.onSerializationFinished(() => settle());
  serverSsr.onCleanup(release);
  session.signal.addEventListener('abort', onAbort, { once: true });
  try {
    session.registerCleanup(() => {
      release();
      cleanupOctaneRouterSSR(router);
    });
  } catch (error) {
    release();
    cleanupOctaneRouterSSR(router);
    throw error;
  }

  return {
    take() {
      if (released) return '';
      // Octane takes injected HTML only once the shell is rendered, so the
      // router's Scripts has already moved the $_TSR bootstrap into its
      // barrier script. Lift the barrier here, not on subscribe: streamed
      // signals subscribe before rendering. Deferred $_TSR chunks then stream
      // as they settle instead of waiting for setRenderFinished.
      serverSsr.liftScriptBarrier();
      return serverSsr.takeBufferedHtml() ?? '';
    },
    subscribe(notify) {
      if (released) return () => {};
      const stop = serverSsr.onInjectedHtml(notify);
      let subscribed = true;
      const unsubscribe = () => {
        if (!subscribed) return;
        subscribed = false;
        subscriptions.delete(unsubscribe);
        stop();
      };
      subscriptions.add(unsubscribe);
      return unsubscribe;
    },
    done,
    cancel(reason) {
      settle(
        reason ?? new DOMException('Octane rendering cancelled', 'AbortError'),
      );
      release();
      void session.abort(reason);
    },
    renderComplete() {
      if (released || renderFinished) return;
      renderFinished = true;
      serverSsr.setRenderFinished();
      if (!serverSsr.isSerializationFinished() && !settled) {
        timer = setTimeout(() => {
          const error = new Error(
            'Octane router serialization timed out after app rendering',
          );
          settle(error);
          void session.fail(error);
        }, timeoutMs);
      }
    },
  };
}
