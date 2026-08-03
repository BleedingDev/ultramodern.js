import * as ah from 'async_hooks';

type StorageGlobals = typeof globalThis & {
  [key: symbol]: ah.AsyncLocalStorage<unknown> | undefined;
};

const getGlobalStorage = <T>(storageKey: string | symbol) => {
  const globalStore = globalThis as StorageGlobals;
  const key =
    typeof storageKey === 'string' ? Symbol.for(storageKey) : storageKey;
  const sharedStorage = globalStore[key];
  const storage =
    (sharedStorage as ah.AsyncLocalStorage<T> | undefined) ??
    new ah.AsyncLocalStorage<T>();
  globalStore[key] = storage;
  return storage;
};

const createStorage = <T>(storageKey?: string | symbol) => {
  let storage: ah.AsyncLocalStorage<T>;

  if (typeof ah.AsyncLocalStorage !== 'undefined') {
    storage = storageKey
      ? getGlobalStorage<T>(storageKey)
      : new ah.AsyncLocalStorage<T>();
  }

  const run = <O>(context: T, cb: () => O | Promise<O>): Promise<O> => {
    if (!storage) {
      throw new Error(`Unable to use async_hook, please confirm the node version >= 12.17
        `);
    }

    return new Promise<O>((resolve, reject) => {
      storage.run(context, () => {
        try {
          return resolve(cb());
        } catch (error) {
          return reject(error);
        }
      });
    });
  };

  const useContext: () => T = () => {
    if (!storage) {
      throw new Error(`Unable to use async_hook, please confirm the node version >= 12.17
        `);
    }
    const context = storage.getStore();
    if (!context) {
      throw new Error(`Can't call useContext out of server scope`);
    }

    return context;
  };

  return {
    run,
    useContext,
    useHonoContext: useContext,
  };
};

export { createStorage };
