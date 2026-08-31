export type ServerRuntimeHandle = (
  request: Request,
  ...args: any[]
) => Response | Promise<Response>;

export type DisposableServerRuntimeHandle = ServerRuntimeHandle & {
  dispose: () => Promise<void>;
};

type RuntimeDisposer = () => void | Promise<void>;

type RuntimeLifecycleState = {
  disposers: Set<RuntimeDisposer>;
  disposePromise?: Promise<void>;
  retired: boolean;
};

const runtimeLifecycleStates = new WeakMap<object, RuntimeLifecycleState>();

const getRuntimeLifecycleState = (owner: object) => {
  let state = runtimeLifecycleStates.get(owner);
  if (!state) {
    state = { disposers: new Set(), retired: false };
    runtimeLifecycleStates.set(owner, state);
  }
  return state;
};

export const registerServerRuntimeDisposer = (
  owner: object,
  disposer: RuntimeDisposer,
) => {
  const state = getRuntimeLifecycleState(owner);
  if (state.retired) {
    throw new Error('Cannot register a disposer on a retired server runtime.');
  }
  state.disposers.add(disposer);
  return () => {
    state.disposers.delete(disposer);
  };
};

export const disposeServerRuntime = (owner: object): Promise<void> => {
  const state = getRuntimeLifecycleState(owner);
  if (state.disposePromise) {
    return state.disposePromise;
  }
  state.retired = true;
  state.disposePromise = Promise.resolve().then(async () => {
    const disposers = [...state.disposers].reverse();
    state.disposers.clear();
    const errors: unknown[] = [];
    for (const disposer of disposers) {
      try {
        await disposer();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to dispose server runtime.');
    }
  });
  return state.disposePromise;
};

export const createDisposableServerRuntimeHandle = (
  owner: object,
  handle: ServerRuntimeHandle,
): DisposableServerRuntimeHandle => {
  let activeRequests = 0;
  let retired = false;
  let resolveDrained: (() => void) | undefined;
  let drained: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;

  const disposableHandle = (async (request: Request, ...args: any[]) => {
    if (retired) {
      throw new Error('Cannot dispatch through a retired server runtime.');
    }
    activeRequests += 1;
    try {
      return await handle(request, ...args);
    } finally {
      activeRequests -= 1;
      if (activeRequests === 0) {
        resolveDrained?.();
      }
    }
  }) as DisposableServerRuntimeHandle;

  disposableHandle.dispose = () => {
    disposePromise ??= (async () => {
      retired = true;
      if (activeRequests > 0) {
        drained ??= new Promise<void>(resolve => {
          resolveDrained = resolve;
        });
        await drained;
      }
      await disposeServerRuntime(owner);
    })();
    return disposePromise;
  };

  return disposableHandle;
};

export const initializeDisposableServerRuntime = async (
  owner: object,
  handle: ServerRuntimeHandle,
  initialize: () => Promise<void>,
): Promise<DisposableServerRuntimeHandle> => {
  try {
    await initialize();
  } catch (error) {
    try {
      await disposeServerRuntime(owner);
    } catch {
      // Preserve the setup failure that makes this candidate ineligible.
    }
    throw error;
  }
  return createDisposableServerRuntimeHandle(owner, handle);
};
