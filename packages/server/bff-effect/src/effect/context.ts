// @effect-diagnostics strictBooleanExpressions:off
import type { EffectContext, EffectContextStorage } from './operation-context';

export {
  type CreateEffectOperationContextOptions,
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

type EffectContextStorageConstructor = new () => EffectContextStorage;

// One storage for every entry: each imports this module as
// `@modern-js/bff-effect/context`, the request that Module Federation shares
// and that the BFF bundle keeps external, so the server and its lambdas load
// the same instance. A backend federation container bundles its own copy and
// adopts the host's storage in init() instead.
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

/**
 * Module Federation share through which a backend federation host hands its
 * request storage to the containers it initializes.
 */
export const EFFECT_BFF_CONTEXT_STORAGE_SHARE =
  '@modern-js/bff-effect/context-storage';

let effectContextStorage: EffectContextStorage = new AsyncLocalStorage();
let effectContextStorageUsed = false;

const usedEffectContextStorage = () => {
  effectContextStorageUsed = true;
  return effectContextStorage;
};

export const runWithEffectContext = <T>(
  context: EffectContext,
  cb: () => T,
): T => usedEffectContextStorage().run(context, cb);

export const useEffectContext = (): EffectContext => {
  const context = usedEffectContextStorage().getStore();
  if (!context) {
    throw new Error(`Can't call useEffectContext out of Effect runtime scope`);
  }

  return context;
};

/** @internal The storage a backend federation host shares with containers. */
export const getEffectContextStorage = (): EffectContextStorage =>
  effectContextStorage;

/**
 * @internal Called through `adoptEffectBffShareScope()` from a backend
 * federation container's `init()`, so its endpoints read the context the
 * host dispatcher enters.
 */
export function adoptEffectContextStorage(storage: unknown): void {
  const candidate = storage as Partial<EffectContextStorage> | undefined;
  if (
    typeof candidate?.run !== 'function' ||
    typeof candidate.getStore !== 'function'
  ) {
    throw new Error(
      `[BFF][Effect] Share ${EFFECT_BFF_CONTEXT_STORAGE_SHARE} must provide an AsyncLocalStorage.`,
    );
  }
  if (effectContextStorageUsed && candidate !== effectContextStorage) {
    throw new Error(
      '[BFF][Effect] A backend federation container received the host request storage after an Effect API already used its own. Evaluate exposes only after container init().',
    );
  }
  effectContextStorage = candidate as EffectContextStorage;
}

export const useOperationContext = () => useEffectContext().operationContext;
