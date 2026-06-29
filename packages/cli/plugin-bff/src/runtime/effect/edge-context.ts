// @effect-diagnostics strictBooleanExpressions:off
import type { EffectContext } from './operation-context';

export {
  type CreateEffectOperationContextOptions,
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

const kEffectContext = Symbol.for('modernjs.plugin-bff.edgeEffectContext');
const kEffectContextStorage = Symbol.for(
  'modernjs.plugin-bff.edgeEffectContextStorage',
);

type AsyncContextStorage<T> = {
  getStore: () => T | undefined;
  run: <TResult>(value: T, cb: () => TResult) => TResult;
};

const globalStore = globalThis as typeof globalThis & {
  [kEffectContext]?: EffectContext;
  [kEffectContextStorage]?: AsyncContextStorage<EffectContext>;
  AsyncLocalStorage?: new () => AsyncContextStorage<EffectContext>;
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  'then' in value &&
  typeof (value as { then?: unknown }).then === 'function';

const getRuntimeStorage = () => {
  if (globalStore[kEffectContextStorage]) {
    return globalStore[kEffectContextStorage];
  }

  if (typeof globalStore.AsyncLocalStorage === 'function') {
    globalStore[kEffectContextStorage] = new globalStore.AsyncLocalStorage();
  }

  return globalStore[kEffectContextStorage];
};

export const runWithEffectContext = <T>(
  context: EffectContext,
  cb: () => T,
): T => {
  const storage = getRuntimeStorage();
  if (storage) {
    return storage.run(context, cb);
  }

  const previous = globalStore[kEffectContext];
  globalStore[kEffectContext] = context;

  try {
    const result = cb();
    if (isPromiseLike(result)) {
      return Promise.resolve(result).finally(() => {
        globalStore[kEffectContext] = previous;
      }) as T;
    }
    globalStore[kEffectContext] = previous;
    return result;
  } catch (error) {
    globalStore[kEffectContext] = previous;
    throw error;
  }
};

export const useEffectContext = (): EffectContext => {
  const context =
    getRuntimeStorage()?.getStore() ?? globalStore[kEffectContext];
  if (!context) {
    throw new Error(`Can't call useEffectContext out of Effect runtime scope`);
  }

  return context;
};

export const useOperationContext = () => useEffectContext().operationContext;
