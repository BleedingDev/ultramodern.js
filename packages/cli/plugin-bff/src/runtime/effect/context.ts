import { AsyncLocalStorage } from 'node:async_hooks';

export type EffectContext = {
  request: Request;
  env: Record<string, unknown>;
  path: string;
  method: string;
};

const effectContextStorage = new AsyncLocalStorage<EffectContext>();

export const runWithEffectContext = <T>(
  context: EffectContext,
  cb: () => T,
): T => {
  return effectContextStorage.run(context, cb);
};

export const useEffectContext = (): EffectContext => {
  const context = effectContextStorage.getStore();
  if (!context) {
    throw new Error(`Can't call useEffectContext out of Effect runtime scope`);
  }

  return context;
};
