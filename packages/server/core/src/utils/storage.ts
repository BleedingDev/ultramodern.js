import * as ah from 'async_hooks';

type StorageGlobals = typeof globalThis & {
  [key: symbol]: ah.AsyncLocalStorage<unknown> | undefined;
};

const createStorage = <T>(storageKey?: symbol) => {
  let storage: ah.AsyncLocalStorage<T>;

  if (typeof ah.AsyncLocalStorage !== 'undefined') {
    if (storageKey) {
      const globalStore = globalThis as StorageGlobals;
      const sharedStorage = globalStore[storageKey];
      storage =
        (sharedStorage as ah.AsyncLocalStorage<T> | undefined) ??
        new ah.AsyncLocalStorage<T>();
      globalStore[storageKey] = storage;
    } else {
      storage = new ah.AsyncLocalStorage<T>();
    }
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
      throw new Error(`Can't call context hook out of server scope`);
    }

    return context;
  };

  return {
    run,
    useContext,
  };
};

export { createStorage };
