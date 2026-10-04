import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { type Rspack, rspack } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';

interface NativePlugin {
  readonly name?: string;
  apply(compiler: Rspack.Compiler): void;
}

interface WorkerWitness {
  readonly pid: number;
  readonly closed: Promise<void>;
}

interface ChildOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface NativeChild {
  readonly child: ChildProcess;
  readonly closed: Promise<ChildOutcome>;
  readonly initialized: Promise<void>;
}

interface NativeOptions {
  name: string;
  runtimePlugins: string[];
  remotes: Record<string, string>;
  manifest?: false;
  experiments?: { provideExternalRuntime: boolean };
  dev?:
    | false
    | {
        disableLiveReload: boolean;
        disableHotTypesReload: boolean;
        disableDynamicRemoteTypeHints: boolean;
      };
  dts:
    | false
    | {
        generateTypes: false;
        consumeTypes: { remoteTypeUrls(): Promise<Record<string, never>> };
        onDevWorkerCreated(witness: WorkerWitness): void;
      };
}

type NativeConstructor = new (options: NativeOptions) => NativePlugin;
const adapterPath = path.resolve(
  __dirname,
  '../../src/native-composition/react-mf-dts-implementation.cjs',
);
const ownRequire = createRequire(adapterPath);
const adapter: {
  createIsolatedReactFederationPlugin(
    native: NativeConstructor,
  ): NativeConstructor;
} = ownRequire(adapterPath);
const nativeDtsPath = ownRequire.resolve('@module-federation/dts-plugin');
const nativeDtsRequire = createRequire(nativeDtsPath);
const { rpc }: typeof import('@module-federation/dts-plugin/core') =
  nativeDtsRequire('@module-federation/dts-plugin/core');
const applicationRequire = createRequire(
  path.resolve(
    __dirname,
    '../../../../../tests/integration/routes-tanstack-mf/mf-remote/package.json',
  ),
);
const federationRequire = createRequire(
  applicationRequire.resolve('@module-federation/modern-js-v3/ssr-plugin'),
);
const enhancedRequire = createRequire(
  federationRequire.resolve('@module-federation/enhanced/rspack'),
);
const mfRequire = createRequire(
  enhancedRequire.resolve('@module-federation/rspack/plugin'),
);
const processEvents = [
  'SIGTERM',
  'SIGINT',
  'unhandledRejection',
  'uncaughtException',
] as const;

const closeCompiler = (compiler: Rspack.Compiler): Promise<void> =>
  new Promise((resolve, reject) => {
    compiler.close(error => (error ? reject(error) : resolve()));
  });

function bounded<T>(promise: Promise<T>, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Native MF ${operation} did not finish within 5s`));
    }, 5_000);
    timer.unref();
    void promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function withNativeCompilers(
  run: (context: {
    root: string;
    compilers: Rspack.Compiler[];
    restore: (() => void)[];
    children: NativeChild[];
  }) => Promise<void>,
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-mf-apply-'),
    ),
  );
  const priorCwd = process.cwd();
  const priorNodeEnv = process.env.NODE_ENV;
  const before = processEvents.map(event => ({
    event,
    listeners: process.rawListeners(event),
  }));
  const compilers: Rspack.Compiler[] = [];
  const restore: (() => void)[] = [];
  const children: NativeChild[] = [];
  const observedChildren = channel('child_process');
  const observe = (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      'process' in message &&
      message.process instanceof ChildProcess
    ) {
      const child = message.process;
      const initialized = Promise.withResolvers<void>();
      let didInitialize = false;
      const onMessage = (value: unknown) => {
        if (!value || typeof value !== 'object' || !('type' in value)) return;
        if (value.type === rpc.RpcGMCallTypes.RESOLVE) {
          didInitialize = true;
          initialized.resolve();
        } else if (value.type === rpc.RpcGMCallTypes.REJECT)
          initialized.reject(
            new Error(`Native DTS child ${child.pid} rejected initialization`),
          );
      };
      child.on('message', onMessage);
      const closed = new Promise<ChildOutcome>(resolve => {
        child.once('close', (code, signal) => {
          child.off('message', onMessage);
          if (!didInitialize)
            initialized.reject(
              new Error(
                `Native DTS child ${child.pid} closed before RPC initialization (${code}, ${signal})`,
              ),
            );
          resolve({ code, signal });
        });
      });
      // The explicit startup assertion below consumes the rejection. Attach a
      // handler now because a failed child can close before its witness arrives.
      void initialized.promise.catch(() => undefined);
      children.push({ child, closed, initialized: initialized.promise });
    }
  };
  observedChildren.subscribe(observe);
  process.chdir(root);
  process.env.NODE_ENV = 'development';
  let failed = false;
  let primaryFailure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    await run({ root, compilers, restore, children });
  } catch (error) {
    failed = true;
    primaryFailure = error;
  } finally {
    try {
      for (const compiler of compilers)
        try {
          await bounded(closeCompiler(compiler), 'compiler cleanup');
        } catch (error) {
          cleanupErrors.push(error);
        }
      for (const { child, closed } of children) {
        try {
          if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGTERM');
          const outcome = await bounded(closed, 'owned child cleanup');
          if (outcome.code !== 0 || outcome.signal !== null)
            cleanupErrors.push(
              new Error(
                `Native DTS child ${child.pid} did not close normally (${outcome.code}, ${outcome.signal})`,
              ),
            );
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    } finally {
      for (const dispose of restore.reverse())
        try {
          dispose();
        } catch (error) {
          cleanupErrors.push(error);
        }
      // Failed regression assertions must not leave native signal handlers in
      // the test process. Production cleanup owns refs inside DevPlugin itself.
      for (const { event, listeners } of before)
        for (const listener of process.rawListeners(event))
          if (!listeners.includes(listener)) process.off(event, listener);
      observedChildren.unsubscribe(observe);
      process.chdir(priorCwd);
      if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = priorNodeEnv;
      if (cleanupErrors.length === 0)
        fs.rmSync(root, { recursive: true, force: true });
    }
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      failed ? [primaryFailure, ...cleanupErrors] : cleanupErrors,
      'Native MF operation or cleanup failed',
    );
  if (failed) throw primaryFailure;
}

describe('Native MF applications own separate options and listener lifetimes', () => {
  for (const format of ['cjs', 'esm'] as const)
    it(`resolves shipped ${format} runtime assets and closes both DTS workers without removing authored listeners`, async () => {
      const native: { DtsPlugin: NativeConstructor } =
        format === 'cjs'
          ? nativeDtsRequire('@module-federation/dts-plugin')
          : await import(
              pathToFileURL(
                path.join(path.dirname(nativeDtsPath), 'esm/index.mjs'),
              ).href
            );
      await withNativeCompilers(
        async ({ root, compilers, restore, children }) => {
          const instances: NativeOptions[] = [];
          const witnesses: WorkerWitness[] = [];
          const authoredListeners: (() => void)[] = [];
          const unchanged = () => {};
          for (const event of processEvents) {
            process.on(event, unchanged);
            restore.push(() => process.off(event, unchanged));
          }
          const baseline = processEvents.map(event => ({
            event,
            listeners: process.rawListeners(event),
          }));
          let created = Promise.withResolvers<void>();
          const remoteTypeUrls = () => {
            const listener = () => {};
            authoredListeners.push(listener);
            process.prependListener('SIGTERM', listener);
            restore.push(() => process.off('SIGTERM', listener));
            return Promise.resolve({});
          };
          const onDevWorkerCreated = (witness: WorkerWitness) => {
            witnesses.push(witness);
            created.resolve();
          };
          const original: NativeOptions = {
            name: 'isolated-native-dts',
            runtimePlugins: ['authored-runtime-plugin'],
            remotes: {},
            dev: {
              disableLiveReload: false,
              disableHotTypesReload: false,
              disableDynamicRemoteTypeHints: false,
            },
            dts: {
              generateTypes: false,
              consumeTypes: { remoteTypeUrls },
              onDevWorkerCreated,
            },
          };
          const ObservedNative = class extends native.DtsPlugin {
            constructor(options: NativeOptions) {
              super(options);
              instances.push(options);
            }
          };
          const Isolated =
            adapter.createIsolatedReactFederationPlugin(ObservedNative);
          const plugin = new Isolated(original);
          const authoredEntry = path.join(root, 'entry.js');
          fs.writeFileSync(authoredEntry, 'export {};\n');
          const liveReloadSource = fs.readFileSync(
            path.join(
              path.dirname(nativeDtsPath),
              'iife/launch-web-client.iife.js',
            ),
            'utf8',
          );
          for (let index = 0; index < 2; index++) {
            created = Promise.withResolvers<void>();
            const compiler = rspack({
              context: root,
              mode: 'development',
              entry: { main: authoredEntry },
              output: { path: path.join(root, `output-${index}`) },
            });
            compilers.push(compiler);
            plugin.apply(compiler);
            const entries = compiler.options.entry;
            if (typeof entries === 'function')
              throw new Error('Native static entry changed to a callback');
            const imports = entries.main?.import;
            if (!imports || imports.length !== 2)
              throw new Error('Native live reload did not prepend one entry');
            const liveReloadPath = imports[0];
            if (typeof liveReloadPath !== 'string')
              throw new Error('Native live reload entry is absent');
            expect(imports[1]).toBe(authoredEntry);
            await bounded(created.promise, 'worker creation');
            const witness = witnesses[index];
            if (!witness)
              throw new Error('Native DTS worker witness was absent');
            const child = children.find(
              owned => owned.child.pid === witness.pid,
            );
            if (!child)
              throw new Error('Native DTS witness did not own an actual child');
            // RPC RESOLVE proves the real packaged worker initialized. Its broker
            // socket can still be CONNECTING; immediate owner close must be safe.
            await bounded(child.initialized, 'RPC initialization');
            expect(
              child.child.spawnargs.some(
                argument =>
                  path.basename(argument) ===
                  (format === 'cjs'
                    ? 'fork-dev-worker.js'
                    : 'fork-dev-worker.mjs'),
              ),
            ).toBe(true);
            let closes = 0;
            void witness.closed.then(() => closes++);
            await bounded(closeCompiler(compiler), 'compiler close');
            await bounded(witness.closed, 'witness close');
            expect(
              await bounded(child.closed, 'native child close outcome'),
            ).toEqual({ code: 0, signal: null });
            await bounded(closeCompiler(compiler), 'repeated compiler close');
            expect(closes).toBe(1);
            expect(fs.statSync(liveReloadPath).isFile()).toBe(true);
            expect(fs.readFileSync(liveReloadPath, 'utf8')).toBe(
              liveReloadSource.replace(
                '__WEB_CLIENT_OPTIONS__',
                JSON.stringify({ name: original.name }),
              ),
            );
            for (const { event, listeners } of baseline)
              expect(process.rawListeners(event)).toEqual(
                event === 'SIGTERM'
                  ? [...authoredListeners.slice().reverse(), ...listeners]
                  : listeners,
              );
          }
          expect(witnesses[0]?.pid).not.toBe(witnesses[1]?.pid);
          expect(instances).toHaveLength(2);
          expect(instances[0]).not.toBe(instances[1]);
          for (const options of instances) {
            expect(options.runtimePlugins).toHaveLength(2);
            expect(options.runtimePlugins[0]).toBe('authored-runtime-plugin');
            const expectedRuntime = path.join(
              path.dirname(nativeDtsPath),
              format === 'cjs'
                ? 'dynamic-remote-type-hints-plugin.js'
                : 'esm/dynamic-remote-type-hints-plugin.mjs',
            );
            expect(options.runtimePlugins[1]).toBe(expectedRuntime);
            expect(fs.statSync(expectedRuntime).isFile()).toBe(true);
            const { default: runtimeFactory } = await import(
              pathToFileURL(expectedRuntime).href
            );
            expect(typeof runtimeFactory).toBe('function');
            if (options.dts === false)
              throw new Error('Native DTS was disabled');
            expect(options.dts.consumeTypes.remoteTypeUrls).toBe(
              remoteTypeUrls,
            );
            expect(options.dts.onDevWorkerCreated).toBe(onDevWorkerCreated);
          }
          expect(original.runtimePlugins).toEqual(['authored-runtime-plugin']);
        },
      );
    });

  it('isolates the public MF provideExternalRuntime append with native DTS disabled', async () => {
    const {
      ModuleFederationPlugin,
    }: {
      ModuleFederationPlugin: NativeConstructor;
    } = mfRequire('@module-federation/rspack/plugin');
    await withNativeCompilers(async ({ root, compilers }) => {
      const instances: NativeOptions[] = [];
      const ObservedNative = class extends ModuleFederationPlugin {
        constructor(options: NativeOptions) {
          super(options);
          instances.push(options);
        }
      };
      const Isolated =
        adapter.createIsolatedReactFederationPlugin(ObservedNative);
      const original: NativeOptions = {
        name: 'isolated-native-external-runtime',
        runtimePlugins: [
          mfRequire.resolve(
            '@module-federation/dts-plugin/dynamic-remote-type-hints-plugin',
          ),
        ],
        remotes: {},
        manifest: false,
        experiments: { provideExternalRuntime: true },
        dev: false,
        dts: false,
      };
      const plugin = new Isolated(original);
      for (let index = 0; index < 2; index++) {
        const compiler = rspack({
          context: root,
          mode: 'development',
          entry: {},
          output: { path: path.join(root, `output-${index}`) },
        });
        compilers.push(compiler);
        plugin.apply(compiler);
        await bounded(
          closeCompiler(compiler),
          'external-runtime compiler close',
        );
      }
      expect(instances).toHaveLength(2);
      expect(instances[0]?.runtimePlugins).toEqual(
        instances[1]?.runtimePlugins,
      );
      expect(instances[0]?.runtimePlugins).toHaveLength(2);
      expect(original.runtimePlugins).toHaveLength(1);
      expect(Object.hasOwn(original, 'implementation')).toBe(false);
    });
  });

  it('closes native listeners after an owning apply failure without creating a late worker', async () => {
    const { DtsPlugin }: { DtsPlugin: NativeConstructor } = nativeDtsRequire(
      '@module-federation/dts-plugin',
    );
    await withNativeCompilers(async ({ root, compilers, restore }) => {
      const urls = Promise.withResolvers<Record<string, never>>();
      const authored = () => {};
      restore.push(() => process.off('SIGINT', authored));
      const before = processEvents.map(event => ({
        event,
        listeners: process.rawListeners(event),
      }));
      const witnesses: WorkerWitness[] = [];
      const failure = new Error('Owning failure after actual native apply');
      const FailingNative = class extends DtsPlugin {
        apply(compiler: Rspack.Compiler): void {
          super.apply(compiler);
          throw failure;
        }
      };
      const Isolated =
        adapter.createIsolatedReactFederationPlugin(FailingNative);
      const plugin = new Isolated({
        name: 'native-apply-failure',
        runtimePlugins: [],
        remotes: {},
        dts: {
          generateTypes: false,
          consumeTypes: {
            remoteTypeUrls() {
              process.prependListener('SIGINT', authored);
              return urls.promise;
            },
          },
          onDevWorkerCreated(witness) {
            witnesses.push(witness);
          },
        },
      });
      const compiler = rspack({
        context: root,
        mode: 'development',
        entry: {},
        output: { path: path.join(root, 'output') },
      });
      compilers.push(compiler);
      try {
        expect(() => plugin.apply(compiler)).toThrow(failure);
        await bounded(closeCompiler(compiler), 'failed compiler close');
      } finally {
        urls.resolve({});
        await nextTurn();
        await nextTurn();
      }
      expect(witnesses).toEqual([]);
      for (const { event, listeners } of before)
        expect(process.rawListeners(event)).toEqual(
          event === 'SIGINT' ? [authored, ...listeners] : listeners,
        );
    });
  });
});
