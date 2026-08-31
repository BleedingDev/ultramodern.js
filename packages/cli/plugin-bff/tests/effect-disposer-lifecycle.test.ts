import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { disposeServerRuntime } from '@modern-js/server-runtime-extensions/runtime-lifecycle';
import { EffectAdapter } from '../src/runtime/effect/adapter';
import {
  type EffectBffHandlerFactory,
  resolveEffectBffModuleHandler,
} from '../src/runtime/effect/module';

rstest.mock('@modern-js/server-runtime-extensions/runtime-lifecycle', () => {
  type Dispose = () => void | Promise<void>;
  const states = new WeakMap<
    object,
    { disposers: Set<Dispose>; retired: boolean; promise?: Promise<void> }
  >();
  const stateFor = (owner: object) => {
    const state = states.get(owner) ?? {
      disposers: new Set<Dispose>(),
      retired: false,
    };
    states.set(owner, state);
    return state;
  };
  const disposeServerRuntime = (owner: object) => {
    const state = stateFor(owner);
    state.retired = true;
    state.promise ??= Promise.resolve().then(async () => {
      for (const dispose of [...state.disposers].reverse()) {
        await dispose();
      }
      state.disposers.clear();
    });
    return state.promise;
  };
  return {
    registerServerRuntimeDisposer(owner: object, dispose: Dispose) {
      const state = stateFor(owner);
      if (state.retired) {
        throw new Error(
          'Cannot register a disposer on a retired server runtime.',
        );
      }
      state.disposers.add(dispose);
      return () => state.disposers.delete(dispose);
    },
    disposeServerRuntime,
    createDisposableServerRuntimeHandle(
      owner: object,
      handle: (...args: any[]) => Response | Promise<Response>,
    ) {
      let active = 0;
      let retired = false;
      let resolveDrained: (() => void) | undefined;
      let disposePromise: Promise<void> | undefined;
      const wrapped = async (...args: any[]) => {
        if (retired) {
          throw new Error('retired server runtime');
        }
        active += 1;
        try {
          return await handle(...args);
        } finally {
          active -= 1;
          if (active === 0) resolveDrained?.();
        }
      };
      wrapped.dispose = () => {
        disposePromise ??= (async () => {
          retired = true;
          if (active > 0) {
            await new Promise<void>(resolve => {
              resolveDrained = resolve;
            });
          }
          await disposeServerRuntime(owner);
        })();
        return disposePromise;
      };
      return wrapped;
    },
  };
});

rstest.mock('@modern-js/runtime-extensions/safe-failure', () => ({
  createSafeFailureResponse: () =>
    new Response('Internal Server Error', { status: 500 }),
}));

const createBrandedFactory = (
  dispose: () => Promise<void>,
): EffectBffHandlerFactory => {
  const createHandler = (() => ({
    handler: () => new Response('ok'),
    dispose,
  })) as EffectBffHandlerFactory;
  Object.defineProperty(
    createHandler,
    Symbol.for('modernjs.effect.validatorAware'),
    { value: true },
  );
  return createHandler;
};

describe('Effect disposer lifecycle', () => {
  test('shares one module disposal across concurrent and repeated callers', async () => {
    let disposeCalls = 0;
    let releaseDispose!: () => void;
    const disposeStarted = new Promise<void>(resolve => {
      releaseDispose = resolve;
    });
    const loaded = await resolveEffectBffModuleHandler({
      createHandler: createBrandedFactory(async () => {
        disposeCalls += 1;
        await disposeStarted;
      }),
    });

    const first = loaded?.dispose?.();
    const second = loaded?.dispose?.();
    await Promise.resolve();
    expect(disposeCalls).toBe(1);

    releaseDispose();
    await Promise.all([first, second, loaded?.dispose?.()]);
    expect(disposeCalls).toBe(1);
  });

  test('disposes the active adapter exactly once when its server closes', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-dispose-'),
    );
    const disposeMarker = Symbol.for(
      `modernjs.plugin-bff.test.adapter-dispose.${path.basename(appDir)}`,
    );
    const testGlobal = globalThis as typeof globalThis & {
      [disposeMarker]?: number;
    };
    const serverBase = {};
    const middlewares: unknown[] = [];
    const entryFile = path.join(appDir, 'api', 'effect.ts');
    testGlobal[disposeMarker] = 0;

    try {
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await fs.promises.writeFile(
        entryFile,
        `const marker = Symbol.for(${JSON.stringify(disposeMarker.description)});
const createHandler = Object.assign(
  () => ({
    handler: () => new Response('ok'),
    dispose: async () => {
      globalThis[marker] = Number(globalThis[marker] || 0) + 1;
    },
  }),
  { [Symbol.for('modernjs.effect.validatorAware')]: true },
);
export { createHandler };`,
      );
      const api = {
        getServerContext: () => ({
          appDirectory: appDir,
          apiDirectory: path.dirname(entryFile),
          bffRuntimeFramework: 'effect',
          middlewares,
          serverBase,
        }),
        getServerConfig: () => ({
          bff: { effect: { entry: entryFile } },
        }),
      } as unknown as ServerPluginAPI;
      const adapter = new EffectAdapter(api);

      await adapter.registerMiddleware({ prefix: '/api' });
      expect(middlewares).toHaveLength(1);
      await disposeServerRuntime(serverBase);
      expect(testGlobal[disposeMarker]).toBe(1);

      await disposeServerRuntime(serverBase);
      await adapter.dispose();

      expect(testGlobal[disposeMarker]).toBe(1);
    } finally {
      delete testGlobal[disposeMarker];
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('keeps the active handler when a replacement fails to load', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-rollback-'),
    );
    const disposeMarker = Symbol.for(
      `modernjs.plugin-bff.test.adapter-rollback.${path.basename(appDir)}`,
    );
    const testGlobal = globalThis as typeof globalThis & {
      [disposeMarker]?: number;
    };
    const serverBase = {};
    const middlewares: Array<{
      handler: (context: any, next: () => Promise<void>) => Promise<unknown>;
    }> = [];
    const entryFile = path.join(appDir, 'api', 'effect.ts');
    const writeEntry = (body: string) =>
      fs.promises.writeFile(
        entryFile,
        `const marker = Symbol.for(${JSON.stringify(disposeMarker.description)});
const createHandler = Object.assign(
  () => ({
    handler: () => new Response(${JSON.stringify(body)}),
    dispose: async () => {
      globalThis[marker] = Number(globalThis[marker] || 0) + 1;
    },
  }),
  { [Symbol.for('modernjs.effect.validatorAware')]: true },
);
export { createHandler };`,
      );
    testGlobal[disposeMarker] = 0;

    try {
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await writeEntry('first');
      const api = {
        getServerContext: () => ({
          appDirectory: appDir,
          apiDirectory: path.dirname(entryFile),
          bffRuntimeFramework: 'effect',
          middlewares,
          serverBase,
        }),
        getServerConfig: () => ({
          bff: { effect: { entry: entryFile } },
        }),
      } as unknown as ServerPluginAPI;
      const adapter = new EffectAdapter(api);
      const invoke = async () => {
        const response = (await middlewares[0]!.handler(
          {
            env: {},
            req: {
              method: 'GET',
              path: '/api/value',
              raw: new Request('https://example.com/api/value'),
            },
          },
          async () => {},
        )) as Response;
        return response.text();
      };

      await adapter.registerMiddleware({ prefix: '/api' });
      await expect(invoke()).resolves.toBe('first');

      await fs.promises.writeFile(entryFile, 'export const broken = ;');
      await expect(adapter.onApiHandlersUpdated()).rejects.toBeDefined();
      await expect(invoke()).resolves.toBe('first');
      expect(testGlobal[disposeMarker]).toBe(0);

      await writeEntry('second');
      await adapter.onApiHandlersUpdated();
      expect(testGlobal[disposeMarker]).toBe(1);
      await expect(invoke()).resolves.toBe('second');

      await disposeServerRuntime(serverBase);
      expect(testGlobal[disposeMarker]).toBe(2);
    } finally {
      delete testGlobal[disposeMarker];
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });
});
