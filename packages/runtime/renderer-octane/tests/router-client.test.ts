import { rs } from '@rstest/core';
import { prepareOctaneRouterHydration } from '../src/router-client';
import { octaneRouterSnapshotAdapter } from '../src/router-snapshot';

const { nativeHydrate } = rs.hoisted(() => ({
  nativeHydrate: rs.fn<() => Promise<void>>(),
}));
rs.mock('@octanejs/tanstack-router', () => ({ RouterProvider: rs.fn() }));
rs.mock('@octanejs/tanstack-router/ssr/client', () => ({
  hydrate: nativeHydrate,
}));
rs.mock('../src/router-snapshot', () => ({
  octaneRouterSnapshotAdapter: { key: 'fixture-native-snapshot-decoder' },
}));
rs.mock('octane', () => ({
  createElement: rs.fn(),
  hookSlots: (count: number) => count,
  initializeHydrationEventCapture: rs.fn(),
  useEffect: rs.fn(),
}));

function routerWithMatches(
  onSubscribe?: (publish: (ids: string[]) => void) => void,
) {
  let ids: string[] = [];
  let subscriptions = 0;
  let unsubscribes = 0;
  const listeners = new Set<() => void>();
  const publish = (value: string[]) => {
    ids = value;
    for (const listener of listeners) listener();
  };
  const router = {
    options: {} as { serializationAdapters?: unknown[] },
    update(options: { serializationAdapters?: unknown[] }) {
      this.options = options;
    },
    stores: {
      matchesId: {
        get: () => ids,
        subscribe(listener: () => void) {
          subscriptions++;
          listeners.add(listener);
          onSubscribe?.(publish);
          return {
            unsubscribe() {
              unsubscribes++;
              listeners.delete(listener);
            },
          };
        },
      },
    },
  } as unknown as Parameters<typeof prepareOctaneRouterHydration>[0];
  return {
    router,
    publish,
    counts: () => ({ subscriptions, unsubscribes, listeners: listeners.size }),
  };
}

async function flushPromises() {
  for (let step = 0; step < 8; step++) await Promise.resolve();
}

function trackAbortListeners(signal: AbortSignal) {
  const added = rs.spyOn(signal, 'addEventListener');
  const removed = rs.spyOn(signal, 'removeEventListener');
  return () => {
    const listeners = added.mock.calls
      .filter(([type]) => type === 'abort')
      .map(call => call[1]);
    const cleanups = removed.mock.calls
      .filter(([type]) => type === 'abort')
      .map(call => call[1]);
    expect(cleanups).toEqual(listeners);
  };
}

beforeEach(() => nativeHydrate.mockReset().mockResolvedValue(undefined));
afterEach(() => rs.restoreAllMocks());

describe('Octane router hydration preparation', () => {
  it('installs the native snapshot decoder before restoring server matches', async () => {
    const state = routerWithMatches();
    state.publish(['root']);
    nativeHydrate.mockImplementation(async () => {
      expect(state.router.options.serializationAdapters).toEqual([
        octaneRouterSnapshotAdapter,
      ]);
    });
    await prepareOctaneRouterHydration(state.router);
    expect(nativeHydrate).toHaveBeenCalledTimes(1);
  });
  it('waits for committed matches and releases its store and abort subscriptions', async () => {
    const state = routerWithMatches();
    const controller = new AbortController();
    const assertListenersReleased = trackAbortListeners(controller.signal);
    let settled = false;
    const preparation = prepareOctaneRouterHydration(state.router, {
      signal: controller.signal,
    }).then(() => {
      settled = true;
    });
    await flushPromises();
    expect(state.counts()).toEqual({
      subscriptions: 1,
      unsubscribes: 0,
      listeners: 1,
    });
    state.publish([]);
    await flushPromises();
    expect(settled).toBe(false);
    state.publish(['root', 'home']);
    await preparation;
    expect(settled).toBe(true);
    expect(state.counts()).toEqual({
      subscriptions: 1,
      unsubscribes: 1,
      listeners: 0,
    });
    assertListenersReleased();
  });

  it('aborts the commit wait with the exact reason and ignores later commits', async () => {
    const state = routerWithMatches();
    const controller = new AbortController();
    const reason = new Error('Navigation was abandoned');
    const assertListenersReleased = trackAbortListeners(controller.signal);
    const preparation = prepareOctaneRouterHydration(state.router, {
      signal: controller.signal,
    });
    void preparation.catch(() => {});
    await flushPromises();
    expect(state.counts().listeners).toBe(1);
    controller.abort(reason);
    await expect(preparation).rejects.toBe(reason);
    state.publish(['root']);
    expect(state.counts()).toEqual({
      subscriptions: 1,
      unsubscribes: 1,
      listeners: 0,
    });
    assertListenersReleased();
  });

  it('releases a subscription returned after a synchronous match commit', async () => {
    const state = routerWithMatches(publish => publish(['root']));
    const controller = new AbortController();
    const assertListenersReleased = trackAbortListeners(controller.signal);
    await prepareOctaneRouterHydration(state.router, {
      signal: controller.signal,
    });
    expect(state.counts()).toEqual({
      subscriptions: 1,
      unsubscribes: 1,
      listeners: 0,
    });
    assertListenersReleased();
  });

  it('preserves a null cancellation reason during the commit wait', async () => {
    const state = routerWithMatches();
    const controller = new AbortController();
    const assertListenersReleased = trackAbortListeners(controller.signal);
    const preparation = prepareOctaneRouterHydration(state.router, {
      signal: controller.signal,
    });
    void preparation.catch(() => {});
    await flushPromises();
    controller.abort(null);
    await expect(preparation).rejects.toBeNull();
    expect(state.counts()).toEqual({
      subscriptions: 1,
      unsubscribes: 1,
      listeners: 0,
    });
    assertListenersReleased();
  });

  it('releases a subscription returned after a synchronous abort', async () => {
    const controller = new AbortController();
    const reason = new Error('Synchronous cancellation');
    const state = routerWithMatches(() => controller.abort(reason));
    const assertListenersReleased = trackAbortListeners(controller.signal);
    await expect(
      prepareOctaneRouterHydration(state.router, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(state.counts()).toEqual({
      subscriptions: 1,
      unsubscribes: 1,
      listeners: 0,
    });
    assertListenersReleased();
  });

  it('does not hydrate or subscribe for an already aborted caller', async () => {
    const state = routerWithMatches();
    const controller = new AbortController();
    const reason = new Error('Already cancelled');
    controller.abort(reason);
    await expect(
      prepareOctaneRouterHydration(state.router, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(nativeHydrate).not.toHaveBeenCalled();
    expect(state.counts()).toEqual({
      subscriptions: 0,
      unsubscribes: 0,
      listeners: 0,
    });
  });

  it('preserves an undefined native rejection and removes the abort listener', async () => {
    const state = routerWithMatches();
    const controller = new AbortController();
    const assertListenersReleased = trackAbortListeners(controller.signal);
    nativeHydrate.mockRejectedValue(undefined);
    await expect(
      prepareOctaneRouterHydration(state.router, { signal: controller.signal }),
    ).rejects.toBeUndefined();
    expect(state.counts().subscriptions).toBe(0);
    assertListenersReleased();
  });

  it('observes a late native failure after its caller has aborted', async () => {
    let rejectHydration!: (reason: unknown) => void;
    nativeHydrate.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectHydration = reject;
      }),
    );
    const state = routerWithMatches();
    const controller = new AbortController();
    const reason = new Error('Startup cancelled before native hydration');
    const lateFailure = new Error('Native hydration failed later');
    const assertListenersReleased = trackAbortListeners(controller.signal);
    const first = prepareOctaneRouterHydration(state.router, {
      signal: controller.signal,
    });
    void first.catch(() => {});
    controller.abort(reason);
    await expect(first).rejects.toBe(reason);
    rejectHydration(lateFailure);
    await flushPromises();
    await expect(prepareOctaneRouterHydration(state.router)).rejects.toBe(
      lateFailure,
    );
    expect(state.counts().subscriptions).toBe(0);
    assertListenersReleased();
  });

  it('shares native hydration without letting one caller cancel another', async () => {
    let finish!: () => void;
    nativeHydrate.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      }),
    );
    const state = routerWithMatches();
    const controller = new AbortController();
    const reason = new Error('Only the first caller stopped');
    const assertListenersReleased = trackAbortListeners(controller.signal);
    const first = prepareOctaneRouterHydration(state.router, {
      signal: controller.signal,
    });
    const second = prepareOctaneRouterHydration(state.router);
    void first.catch(() => {});
    expect(nativeHydrate).toHaveBeenCalledTimes(1);
    controller.abort(reason);
    await expect(first).rejects.toBe(reason);
    finish();
    await flushPromises();
    state.publish(['root']);
    await second;
    expect(state.counts()).toEqual({
      subscriptions: 1,
      unsubscribes: 1,
      listeners: 0,
    });
    assertListenersReleased();
  });
});
