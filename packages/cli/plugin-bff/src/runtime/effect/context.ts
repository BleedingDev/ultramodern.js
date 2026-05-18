// @effect-diagnostics strictBooleanExpressions:off
import { AsyncLocalStorage } from 'node:async_hooks';

export type EffectContext = {
  request: Request;
  env: Record<string, unknown>;
  path: string;
  method: string;
};

const kEffectContextStorage = Symbol.for(
  'modernjs.plugin-bff.effectContextStorage',
);

const globalStore = globalThis as typeof globalThis & {
  [key: symbol]: AsyncLocalStorage<EffectContext> | undefined;
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
