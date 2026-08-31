// @effect-diagnostics strictBooleanExpressions:off
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type EffectContext,
  type EffectContextStorage,
  kEffectContextStorage,
} from './operation-context';

export {
  type CreateEffectOperationContextOptions,
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

const globalStore = globalThis as typeof globalThis & {
  [kEffectContextStorage]?: EffectContextStorage;
};

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
