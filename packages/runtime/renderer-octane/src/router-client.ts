import { type AnyRouter, RouterProvider } from '@octanejs/tanstack-router';
import { hydrate } from '@octanejs/tanstack-router/ssr/client';
import {
  createElement,
  hookSlots,
  initializeHydrationEventCapture,
  useEffect,
} from 'octane';
import { octaneRouterSnapshotAdapter } from './router-snapshot';

export interface OctaneRouterHydrationOptions {
  signal?: AbortSignal;
}

const hydration = new WeakMap<AnyRouter, Promise<void>>();

function abortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException('Octane router hydration aborted', 'AbortError')
    : signal.reason;
}

function awaitHydration(
  promise: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (success: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (success) resolve();
      else reject(error);
    };
    const onAbort = () => finish(false, abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      () => finish(true),
      error => finish(false, error),
    );
    if (signal.aborted) onAbort();
  });
}

interface ReactiveMatchIds {
  get(): readonly string[];
  subscribe(callback: () => void): { unsubscribe(): void };
}

function isReactiveMatchIds(value: unknown): value is ReactiveMatchIds {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'get') === 'function' &&
    typeof Reflect.get(value, 'subscribe') === 'function'
  );
}

function waitForCommittedMatches(
  router: AnyRouter,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const matchesId = router.stores.matchesId;
  if (matchesId.get().length > 0) return Promise.resolve();
  if (!isReactiveMatchIds(matchesId)) {
    throw new Error(
      'Octane router hydration requires its native reactive match store',
    );
  }
  return new Promise((resolve, reject) => {
    let subscription: ReturnType<typeof matchesId.subscribe> | undefined;
    let settled = false;
    const cleanup = () => {
      subscription?.unsubscribe();
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = () => {
      if (settled || matchesId.get().length === 0) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal) reject(abortReason(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    subscription = matchesId.subscribe(finish);
    // Native stores can notify synchronously while a subscription is installed.
    if (settled) subscription.unsubscribe();
    else finish();
  });
}

/** Restore native SSR matches before Octane adopts the server's route ranges. */
export async function prepareOctaneRouterHydration(
  router: AnyRouter,
  options: OctaneRouterHydrationOptions = {},
): Promise<void> {
  initializeHydrationEventCapture();
  options.signal?.throwIfAborted();
  const adapters = router.options.serializationAdapters ?? [];
  if (!adapters.includes(octaneRouterSnapshotAdapter)) {
    const nativeOptions = {
      ...router.options,
      serializationAdapters: [octaneRouterSnapshotAdapter, ...adapters],
    };
    router.update(nativeOptions);
  }
  let pending = hydration.get(router);
  if (!pending) {
    pending = Promise.resolve(hydrate(router)).then(() => {});
    // Native hydration can finish after this startup owner has been cancelled.
    void pending.catch(() => {});
    hydration.set(router, pending);
  }
  await awaitHydration(pending, options.signal);
  await waitForCommittedMatches(router, options.signal);
  options.signal?.throwIfAborted();
}

const routerHydrationEffectSlot = Symbol(hookSlots(1));

/** Adopt the native provider's ranges inside the admitted fragment host. */
export function OctaneRouterRoot({ router }: { router: AnyRouter }) {
  useEffect(
    () => {
      window.$_TSR?.h();
    },
    [],
    routerHydrationEffectSlot,
  );
  return createElement(RouterProvider, { router });
}
