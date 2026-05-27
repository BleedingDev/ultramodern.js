import type { Monitors } from '@modern-js/types';
import type { IncomingHttpHeaders } from 'http';

type AsyncLocalStorageLike<T> = {
  getStore: () => T | undefined;
  run: <O>(context: T, cb: () => O | Promise<O>) => O | Promise<O>;
};

const getGlobalAsyncLocalStorage = <T>() => {
  const AsyncLocalStorage = (
    globalThis as typeof globalThis & {
      AsyncLocalStorage?: new () => AsyncLocalStorageLike<T>;
    }
  ).AsyncLocalStorage;

  return AsyncLocalStorage ? new AsyncLocalStorage() : undefined;
};

const createFallbackStorage = <T>(): AsyncLocalStorageLike<T> => {
  const stack: T[] = [];

  return {
    getStore() {
      return stack[stack.length - 1];
    },
    run(context, cb) {
      stack.push(context);
      try {
        const result = cb();
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).finally(() => {
            stack.pop();
          }) as ReturnType<typeof cb>;
        }
        stack.pop();
        return result;
      } catch (error) {
        stack.pop();
        throw error;
      }
    },
  };
};

const createStorage = <T>() => {
  const storage = getGlobalAsyncLocalStorage<T>() || createFallbackStorage<T>();

  const run = <O>(context: T, cb: () => O | Promise<O>): Promise<O> =>
    Promise.resolve(storage.run(context, cb));

  const useContext: () => T = () => {
    const context = storage.getStore();
    if (!context) {
      throw new Error(
        `Can't call useContext out of scope, make sure @modern-js/runtime-utils is a single version in node_modules`,
      );
    }

    return context;
  };

  return {
    run,
    useContext,
  };
};

const storage = createStorage<{
  monitors?: Monitors;
  headers?: IncomingHttpHeaders;
  request?: Request;
  responseProxy?: {
    headers: Record<string, string>;
    status: number;
  };
  activeDeferreds?: Map<string, unknown>;
  serverPayload?: unknown;
}>();

type Storage = typeof storage;

export { type Storage, storage };

export const getAsyncLocalStorage = async (): Promise<Storage> => {
  return storage;
};
