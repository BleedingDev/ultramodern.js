// @effect-diagnostics strictBooleanExpressions:off
import type { EffectContext } from './operation-context';

export {
  type CreateEffectOperationContextOptions,
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

const kEffectContextStorage = Symbol.for(
  'modernjs.plugin-bff.edgeEffectContextStorage',
);

type AsyncContextStorage<T> = {
  getStore: () => T | undefined;
  run: <TResult>(value: T, cb: () => TResult) => TResult;
};

type AsyncContextStorageConstructor = new <T>() => AsyncContextStorage<T>;

const globalStore = globalThis as typeof globalThis & {
  [kEffectContextStorage]?: AsyncContextStorage<EffectContext>;
  process?: {
    getBuiltinModule?: (id: string) => unknown;
  };
};

const asyncHooks = globalStore.process?.getBuiltinModule?.(
  'node:async_hooks',
) as { AsyncLocalStorage?: AsyncContextStorageConstructor } | undefined;
const AsyncLocalStorage = asyncHooks?.AsyncLocalStorage;
if (typeof AsyncLocalStorage !== 'function') {
  throw new Error(
    '[BFF][Effect] The edge runtime must provide AsyncLocalStorage. Enable Node.js compatibility or the nodejs_als compatibility flag.',
  );
}

const effectContextStorage =
  globalStore[kEffectContextStorage] ??
  (globalStore[kEffectContextStorage] = new AsyncLocalStorage<EffectContext>());

export const runWithEffectContext = <T>(
  context: EffectContext,
  cb: () => T,
): T => effectContextStorage.run(context, cb);

export const useEffectContext = (): EffectContext => {
  const context = effectContextStorage.getStore();
  if (!context) {
    throw new Error(`Can't call useEffectContext out of Effect runtime scope`);
  }

  return context;
};

export const useOperationContext = () => useEffectContext().operationContext;
