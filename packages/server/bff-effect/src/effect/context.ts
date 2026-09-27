// @effect-diagnostics strictBooleanExpressions:off
import type { EffectContext, EffectContextStorage } from './operation-context';

export {
  type CreateEffectOperationContextOptions,
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

type EffectContextStorageConstructor = new () => EffectContextStorage;

// One storage for the Node and edge entries: both import this module, and the
// BFF bundle keeps `@modern-js/bff-effect` external so the server and the
// lambdas load the same instance.
const globalStore = globalThis as typeof globalThis & {
  process?: {
    getBuiltinModule?: (id: string) => unknown;
  };
};

const asyncHooks = globalStore.process?.getBuiltinModule?.(
  'node:async_hooks',
) as { AsyncLocalStorage?: EffectContextStorageConstructor } | undefined;
const AsyncLocalStorage = asyncHooks?.AsyncLocalStorage;
if (typeof AsyncLocalStorage !== 'function') {
  throw new Error(
    '[BFF][Effect] The edge runtime must provide AsyncLocalStorage. Enable Node.js compatibility or the nodejs_als compatibility flag.',
  );
}

const effectContextStorage = new AsyncLocalStorage();

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
