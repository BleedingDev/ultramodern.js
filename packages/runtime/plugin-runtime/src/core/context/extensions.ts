/**
 * Fork-owned runtime-context extension mechanism.
 *
 * Plugins must not add ad-hoc fields to `TRuntimeContext` /
 * `TInternalRuntimeContext`. Instead they store state in a single internal
 * slot (a `Map` keyed by symbol) attached to the context object under a
 * symbol property, so nothing leaks into string-key enumeration
 * (`Object.keys`, `JSON.stringify`, `{ ...context }` rest patterns over
 * named keys).
 *
 * `Symbol.for` is used for both the slot and the extension keys so that the
 * mechanism stays coherent even if this module is instantiated twice
 * (e.g. esm/cjs interop in test runners).
 */

const EXTENSIONS_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:context-extensions',
);

type ExtensionStore = Map<symbol, unknown>;

type ExtensibleContext = {
  [EXTENSIONS_SLOT]?: ExtensionStore;
};

export interface RuntimeContextExtension<T> {
  /** Stable identity of this extension. */
  readonly key: symbol;
  get(context: object): T | undefined;
  set(context: object, value: T): void;
  remove(context: object): void;
}

function getStore(context: object): ExtensionStore | undefined {
  return (context as ExtensibleContext)[EXTENSIONS_SLOT];
}

function ensureStore(context: object): ExtensionStore {
  const target = context as ExtensibleContext;
  const store = target[EXTENSIONS_SLOT] ?? new Map();
  Object.defineProperty(target, EXTENSIONS_SLOT, {
    configurable: true,
    enumerable: false,
    value: store,
  });
  return store;
}

/**
 * Removes the extension slot from a context object.
 *
 * The slot is non-enumerable and therefore does not cross object spreads.
 * This remains available for callers that explicitly clear the original context.
 */
export function stripRuntimeContextExtensions(context: object): void {
  delete (context as ExtensibleContext)[EXTENSIONS_SLOT];
}

/**
 * Creates a typed accessor pair over the shared extension slot.
 *
 * The `id` must be globally unique (it is interned via `Symbol.for`); use a
 * package-prefixed name such as `@modern-js/plugin-tanstack:router-state`.
 */
export function createRuntimeContextExtension<T>(
  id: string,
): RuntimeContextExtension<T> {
  const key = Symbol.for(`@modern-js/runtime:context-extension:${id}`);

  return {
    key,
    get(context: object): T | undefined {
      return getStore(context)?.get(key) as T | undefined;
    },
    set(context: object, value: T): void {
      ensureStore(context).set(key, value);
    },
    remove(context: object): void {
      getStore(context)?.delete(key);
    },
  };
}
