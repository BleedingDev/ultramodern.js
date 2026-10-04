import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppTools } from '@modern-js/app-tools/cli-config';
import type {
  RendererBuildIdentities,
  RendererGeneratedOutputIdentityLease,
} from '@modern-js/app-tools-extensions/renderer-build-identity';
import type {
  RendererGeneratedOutputAcknowledgement,
  RendererGeneratedOutputNode,
  RendererGeneratedOutputRegistrationInput,
} from '@modern-js/app-tools-extensions/renderer-generated-outputs';
import type { CLIPluginAPI } from '@modern-js/plugin';
import {
  createRsbuild,
  type RsbuildPlugin,
  type Rspack,
  rspack,
} from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import { captureConfigSourceSnapshot } from '../../src/native-composition/config-evaluator/source-snapshot';
import {
  createConfigurationReadContextPlugin,
  type ObservedConfigSourceInputs,
  retainConfigurationSourceSnapshot,
} from '../../src/native-composition/configuration-read-context';
import { REACT_RENDERER_IDENTITY_ELEMENT_ID } from '../../src/native-composition/react-build-metadata';
import {
  createReactReceiverOutputIntegration,
  type ReactReceiverImplementation,
} from '../../src/native-composition/react-mf-dts-outputs';
import type {
  ReceiverContext,
  ReceiverRegistry,
  ReceiverSeed,
} from '../../src/native-composition/react-mf-dts-registry';
import { ReactTypedCssPhase } from '../../src/native-composition/react-typed-css-phase';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

const repositoryRoot = path.resolve(__dirname, '../../../../..');
const applicationRequire = createRequire(
  path.join(
    repositoryRoot,
    'tests/integration/routes-tanstack-mf/mf-remote/package.json',
  ),
);
const nativeRequire = createRequire(
  applicationRequire.resolve('@module-federation/modern-js-v3/ssr-plugin'),
);
const { ModuleFederationPlugin } = nativeRequire(
  '@module-federation/enhanced/rspack',
) as {
  ModuleFederationPlugin: new (
    options: Record<string, unknown>,
  ) => {
    apply(compiler: Rspack.Compiler): void;
  };
};
const enhancedRequire = createRequire(
  nativeRequire.resolve('@module-federation/enhanced/rspack'),
);
const rspackPluginRequire = createRequire(
  enhancedRequire.resolve('@module-federation/rspack/plugin'),
);
const nativeDtsExports = rspackPluginRequire(
  '@module-federation/dts-plugin',
) as {
  DtsPlugin: new (
    options: Record<string, unknown>,
  ) => {
    apply(compiler: Rspack.Compiler): void;
    addRuntimePlugins(): void;
  };
};
const adapterPath = path.resolve(
  __dirname,
  '../../src/native-composition/react-mf-dts-implementation.cjs',
);
const sourceRequire = createRequire(adapterPath);
let sourceResolution: ReturnType<typeof registerHooks> | undefined;
try {
  sourceRequire.resolve('@module-federation/dts-plugin/core');
} catch (error) {
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'MODULE_NOT_FOUND'
  )
    throw error;
  const corePath = nativeRequire.resolve('@module-federation/dts-plugin/core');
  sourceResolution = registerHooks({
    resolve(specifier, context, next) {
      if (
        specifier === '@module-federation/dts-plugin/core' &&
        context.parentURL === pathToFileURL(adapterPath).href
      )
        return { url: pathToFileURL(corePath).href, shortCircuit: true };
      return next(specifier, context);
    },
  });
}
let adapter: ReactReceiverImplementation & {
  nativeDtsOwner(): RendererGeneratedOutputRegistrationInput['producer'];
};
try {
  adapter = sourceRequire(adapterPath);
} finally {
  sourceResolution?.deregister();
}

const closes: (() => Promise<void>)[] = [];
const roots: string[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const close of closes.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  for (const root of roots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, 'Native graph cleanup failed');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

function graphIdentities(generation: number): RendererBuildIdentities {
  const profile = resolveRendererProfile('react');
  const provider = { ...profile.router, framework: 'react-router' as const };
  const buildId = createHash('sha256')
    .update(`native-graph-${generation}`)
    .digest('hex');
  return {
    identities: {
      main: {
        renderer: 'react',
        appId: 'native-receiver-graph',
        entryName: 'main',
        protocolVersion: 1,
        buildId,
      },
    },
    buildMarker: buildId,
    sourceRevision: 'workspace',
    inputDigest: 'b'.repeat(64),
    profileDigest: 'c'.repeat(64),
    compilerDigest: 'd'.repeat(64),
    frameworkCohortDigest: 'e'.repeat(64),
    cacheAllowed: false,
    promotable: false,
    routerBindings: {
      main: {
        owner: '@modern-js/plugin-router',
        evidence: 'owned-default',
        defaultProvider: provider,
        providers: [provider],
      },
    },
  };
}

describe('React receiver ownership of the native web compiler graph', () => {
  it('publishes exact aggregate receipts across two real Enhanced web compilers and a partial watch rebuild', async () => {
    if (!process.env.OWNED_TEMP_DIR)
      throw new Error('Native graph tests require an owned temporary lease');
    const appDirectory = fs.realpathSync(
      fs.mkdtempSync(path.join(process.env.OWNED_TEMP_DIR, 'native-graph-')),
    );
    roots.push(appDirectory);
    fs.mkdirSync(path.join(appDirectory, 'src'));
    fs.writeFileSync(
      path.join(appDirectory, 'package.json'),
      JSON.stringify({ name: 'native-receiver-graph', private: true }),
    );
    const entry = path.join(appDirectory, 'src/main.js');
    fs.writeFileSync(entry, 'globalThis.nativeReceiverGraph = true;\n');
    const names = ['client', 'secondaryWeb'] as const;
    const destinations = new Map<string, string>();
    for (const name of names) {
      const directory = path.join(appDirectory, '@mf-types', name);
      fs.mkdirSync(directory, { recursive: true });
      const filename = path.join(directory, 'App.d.ts');
      fs.writeFileSync(filename, 'export declare const App: string;\n');
      destinations.set(name, filename);
    }
    const observed: ObservedConfigSourceInputs = Object.freeze({
      kind: 'observed-config-source-inputs',
      version: 1,
      packageMetadata: Object.freeze([]),
      observations: Object.freeze([]),
    });
    const snapshot = captureConfigSourceSnapshot({
      sourceRoots: [appDirectory],
    });
    const sourceNodes = Object.freeze([]);
    retainConfigurationSourceSnapshot(observed, snapshot, sourceNodes);
    const hooks = {};
    const chainModifiers: Parameters<
      CLIPluginAPI<AppTools>['modifyBundlerChain']
    >[0][] = [];
    const beforeCompiler: Parameters<
      CLIPluginAPI<AppTools>['onBeforeCreateCompiler']
    >[0][] = [];
    const afterCompiler: Parameters<
      CLIPluginAPI<AppTools>['onAfterCreateCompiler']
    >[0][] = [];
    const beforeExit: Parameters<CLIPluginAPI<AppTools>['onBeforeExit']>[0][] =
      [];
    const beforeBuild: Parameters<
      CLIPluginAPI<AppTools>['onBeforeBuild']
    >[0][] = [];
    const closeBuild: (() => void | Promise<void>)[] = [];
    const builder = {
      onCloseBuild(callback: (typeof closeBuild)[number]) {
        closeBuild.push(callback);
      },
    };
    const config = {
      renderer: 'react' as const,
      source: { mainEntryName: 'main', entriesDir: './src' },
      server: { ssr: false },
      output: { enableCssModuleTSDeclaration: false },
    };
    const cliAPI = {
      getHooks: () => hooks,
      getAppContext: () => ({ appDirectory, command: 'dev', builder }),
      getNormalizedConfig: () => config,
      modifyBundlerChain(callback: (typeof chainModifiers)[number]) {
        chainModifiers.push(callback);
      },
      onBeforeCreateCompiler(callback: (typeof beforeCompiler)[number]) {
        beforeCompiler.push(callback);
      },
      onAfterCreateCompiler(callback: (typeof afterCompiler)[number]) {
        afterCompiler.push(callback);
      },
      onBeforeExit(callback: (typeof beforeExit)[number]) {
        beforeExit.push(callback);
      },
      onBeforeBuild(callback: (typeof beforeBuild)[number]) {
        beforeBuild.push(callback);
      },
    };
    await createConfigurationReadContextPlugin(() => observed).setup?.(cliAPI);
    let registry!: ReceiverRegistry;
    let restored = 0;
    const integration = createReactReceiverOutputIntegration({
      resolveImplementation: () => adapterPath,
      loadImplementation: () => ({
        EXTRA_OPTIONS_KEY: adapter.EXTRA_OPTIONS_KEY,
        createIsolatedReactFederationPlugin:
          adapter.createIsolatedReactFederationPlugin,
        installReceiverRegistry(value) {
          registry = value;
          const restore = adapter.installReceiverRegistry(value);
          return () => {
            restore();
            restored++;
          };
        },
        observeReceiverNodes: adapter.observeReceiverNodes,
      }),
      resolveProducer: async () => adapter.nativeDtsOwner(),
      async resolveDestinations(details) {
        const native = details.nativeOptions as {
          compiler?: string;
          host?: { moduleFederationConfig?: { name?: string } };
        };
        const name =
          native.compiler ??
          native.host?.moduleFederationConfig?.name?.replace(
            'native_graph_',
            '',
          );
        if (!name) throw new Error('Receiver has no configured compiler');
        const filename = destinations.get(name);
        if (!filename) throw new Error('Receiver has no enrolled destination');
        return {
          effectiveOptions: { compiler: name, consumeTypes: true },
          context: { operation: details.operation },
          destinations: [
            {
              path: { lexical: filename, canonical: filename },
              kind: 'file',
              scope: 'exact',
            },
          ],
        };
      },
      sourceNodes: () => sourceNodes,
      trackedInputs: async () => [],
    });
    await integration.plugin.setup?.(
      cliAPI as unknown as CLIPluginAPI<AppTools>,
    );
    let closed = false;
    const closeController = async () => {
      if (closed) return;
      for (const callback of beforeExit) await callback();
      closed = true;
    };
    closes.push(closeController);
    const context = {
      entrypoints: [{ entryName: 'main', isMainEntry: true, entry }],
      appDirectory,
      internalDirectory: path.join(appDirectory, '.modern-js'),
      distDirectory: path.join(appDirectory, 'dist'),
      configFile: false as const,
      consumedSourceInputs: observed,
      configurationSourceSnapshot: snapshot,
      configurationSourceNodes: sourceNodes,
      packageName: 'native-receiver-graph',
      mode: 'development' as const,
      config: config as unknown as Parameters<
        typeof integration.controller.bindPhase
      >[1]['config'],
    };
    const leases: RendererGeneratedOutputIdentityLease[] = [];
    const finalizedStats: Rspack.MultiStats[] = [];
    const published: number[] = [];
    const phase = new ReactTypedCssPhase({
      appDirectory,
      internalDirectory: context.internalDirectory,
      distDirectory: context.distDirectory,
      produceTypedCss: false,
      generatedOutputs: integration.controller,
      async finalize(stats, lease) {
        if (!('stats' in stats) || !lease)
          throw new Error(
            'Graph requires its aggregate completion and receipt lease',
          );
        finalizedStats.push(stats);
        leases.push(lease);
        await lease.assertCurrent();
        return graphIdentities(
          phase.currentGeneratedOutputGeneration().generation,
        );
      },
      async publishDevelopment(_stats, _identities, assertCurrent) {
        assertCurrent();
        published.push(phase.currentGeneratedOutputGeneration().generation);
      },
    });
    integration.controller.bindPhase(phase, context);
    const nativeOptions = new Map<string, Record<string, unknown>>();
    const configuredWorkerHooks = new Map<string, unknown>();
    const dtsConstructorWorkerHooks = new Map<string, unknown>();
    const dtsConstructorDescriptor = Object.getOwnPropertyDescriptor(
      nativeDtsExports,
      'DtsPlugin',
    );
    if (!dtsConstructorDescriptor || !('value' in dtsConstructorDescriptor))
      throw new Error('The actual public DTS constructor cannot be observed');
    const NativeDtsPlugin = nativeDtsExports.DtsPlugin;
    nativeDtsExports.DtsPlugin = class ObservedNativeDtsPlugin extends (
      NativeDtsPlugin
    ) {
      constructor(options: Record<string, unknown>) {
        const name = String(options.name).replace('native_graph_', '');
        const dts = options.dts as Record<string, unknown>;
        dtsConstructorWorkerHooks.set(name, dts.onDevWorkerCreated);
        // Observe the public call boundary, then delegate unchanged to the
        // real constructor. This does not invoke or manufacture a worker hook.
        super(options);
      }
    };
    let dtsConstructorRestored = false;
    function restoreDtsConstructor() {
      if (dtsConstructorRestored) return;
      Object.defineProperty(
        nativeDtsExports,
        'DtsPlugin',
        dtsConstructorDescriptor!,
      );
      dtsConstructorRestored = true;
    }
    closes.push(async () => {
      restoreDtsConstructor();
    });
    const nativePlugins = new Map<
      string,
      InstanceType<typeof ModuleFederationPlugin>
    >();
    const pluginConstructors = new Map<string, typeof ModuleFederationPlugin>();
    let clientHTMLFilename = '';
    const compilers = new Map<string, Rspack.Compiler>();
    const watchRuns = new Map<string, number>();
    const shutdowns: string[] = [];
    const firstMemberCompleted = deferred<void>();
    const siblingIOEntered = deferred<void>();
    const releaseSiblingIO = deferred<void>();
    closes.push(async () => {
      firstMemberCompleted.resolve();
      releaseSiblingIO.resolve();
    });
    const initialFrames = new Map<string, ReceiverContext['frame']>();
    const activeReceivers = new Map<
      ReceiverContext,
      RendererGeneratedOutputAcknowledgement[]
    >();
    let cleaningUp = false;
    async function retireReceiver(receiver: ReceiverContext) {
      const operations = activeReceivers.get(receiver) ?? [];
      try {
        await receiver.terminal({
          status: 'failed',
          frame: receiver.frame,
          operations,
          nodes: operations.map(operation => operation.after),
          stages: [],
          failures: [
            {
              operation: 'test-cleanup',
              reason: 'Test ended before receiver completion',
            },
          ],
        });
      } catch {
        // A previously rejected terminal may already have settled this frame.
      } finally {
        activeReceivers.delete(receiver);
      }
    }
    function read(filename: string): RendererGeneratedOutputNode {
      return adapter.observeReceiverNodes(
        {
          consumer: { id: context.packageName, projectRoot: appDirectory },
          generation: {
            operationId: 'test-read',
            compilerId: 'test-read',
            generation: 1,
            revision: 'test-read',
          },
        },
        [{ path: { lexical: filename, canonical: filename }, kind: 'missing' }],
      ).nodes[0]!;
    }
    function authority(name: string): ReceiverSeed {
      const dts = nativeOptions.get(name)!.dts as {
        extraOptions: Record<string, ReceiverSeed>;
      };
      return dts.extraOptions[adapter.EXTRA_OPTIONS_KEY]!;
    }
    async function begin(name: string) {
      if (cleaningUp) throw new Error('Native graph test is closing');
      const receiver = await registry.begin(authority(name), {
        operation: 'consumeTypes',
        nativeOptions: { compiler: name, consumeTypes: true },
      });
      activeReceivers.set(receiver, []);
      if (cleaningUp) {
        await retireReceiver(receiver);
        throw new Error('Native graph test closed during BEGIN');
      }
      return receiver;
    }
    async function receiverWrite(
      receiver: ReceiverContext,
      name: string,
      declaration: string,
    ) {
      const filename = destinations.get(name)!;
      const operation = {
        operation: 'write' as const,
        kind: 'file' as const,
        before: read(filename),
      };
      receiver.beforeOperations([operation]);
      fs.writeFileSync(filename, declaration);
      const acknowledgement = { ...operation, after: read(filename) };
      receiver.acknowledgeOperations([acknowledgement]);
      activeReceivers.get(receiver)!.push(acknowledgement);
      await receiver.terminal({
        status: 'complete',
        frame: receiver.frame,
        operations: [acknowledgement],
        nodes: [acknowledgement.after],
        stages: [
          {
            stage: 'api',
            alias: 'remote',
            requested: true,
            outcome: 'complete',
            result: false,
          },
        ],
        failures: [],
      });
      activeReceivers.delete(receiver);
    }
    const lifecycle: RsbuildPlugin = {
      name: 'test-real-enhanced-receiver-compiler-graph',
      setup(api) {
        phase.install(api);
        api.onBeforeBuild(async params => {
          for (const callback of beforeBuild) await callback(params as never);
        });
        api.onCloseBuild(async () => {
          for (const callback of closeBuild) await callback();
        });
        api.modifyBundlerChain(async (chain, utils) => {
          const name = utils.environment.name;
          const options = {
            name: `native_graph_${name}`,
            remotes: {},
            dev: false,
            dts: {
              generateTypes: false,
              consumeTypes: { consumeAPITypes: false },
            },
          };
          nativeOptions.set(name, options);
          chain
            .plugin('plugin-module-federation')
            .use(ModuleFederationPlugin, [options])
            .init((Plugin, args) => {
              const dts = args[0].dts as Record<string, unknown>;
              expect(typeof dts.onDevWorkerCreated).toBe('function');
              configuredWorkerHooks.set(name, dts.onDevWorkerCreated);
              expect(Plugin).not.toBe(ModuleFederationPlugin);
              const plugin = new Plugin(args[0]);
              pluginConstructors.set(name, Plugin);
              nativePlugins.set(name, plugin);
              return plugin;
            });
          for (const modifier of chainModifiers)
            await modifier(chain, utils as never);
        });
        api.modifyHTMLTags((tags, { filename, environment }) => {
          if (environment.name === 'client') {
            clientHTMLFilename = filename;
            tags.bodyTags.push({
              tag: 'script',
              attrs: {
                id: REACT_RENDERER_IDENTITY_ELEMENT_ID,
                type: 'application/json',
              },
              children: phase.pendingHTML(filename, 'main'),
            });
          }
          return tags;
        });
        api.onBeforeCreateCompiler(async params => {
          for (const callback of beforeCompiler)
            await callback(params as never);
          expect(nativePlugins.size).toBe(2);
          for (const [name, plugin] of nativePlugins)
            expect(plugin).toBeInstanceOf(pluginConstructors.get(name)!);
        });
        api.onAfterCreateCompiler(async params => {
          for (const callback of afterCompiler) await callback(params as never);
          if (!('compilers' in params.compiler))
            throw new Error('Expected native multi-compiler graph');
          for (const compiler of params.compiler.compilers) {
            const name = compiler.options.name!;
            compilers.set(name, compiler);
            compiler.hooks.watchRun.tap(
              { name: 'test-graph-watch-count', stage: -1000 },
              () => {
                watchRuns.set(name, (watchRuns.get(name) ?? 0) + 1);
              },
            );
            compiler.hooks.shutdown.tap('test-graph-public-shutdown', () => {
              shutdowns.push(name);
            });
            let initial = true;
            compiler.hooks.thisCompilation.tap(
              'test-graph-initial-receiver',
              compilation => {
                compilation.hooks.processAssets.tapPromise(
                  {
                    name: 'test-graph-initial-receiver',
                    stage: rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                  },
                  async () => {
                    if (!initial) return;
                    initial = false;
                    if (name === 'secondaryWeb')
                      await firstMemberCompleted.promise;
                    const receiver = await begin(name);
                    initialFrames.set(name, receiver.frame);
                    if (name === 'secondaryWeb') {
                      siblingIOEntered.resolve();
                      await releaseSiblingIO.promise;
                    }
                    await receiverWrite(
                      receiver,
                      name,
                      `export declare const App: ${name === 'client' ? 'number' : 'boolean'};\n`,
                    );
                    if (name === 'client') firstMemberCompleted.resolve();
                  },
                );
              },
            );
          }
        });
      },
    };
    const rsbuild = await createRsbuild({
      cwd: appDirectory,
      rsbuildConfig: {
        mode: 'development',
        plugins: [lifecycle],
        environments: Object.fromEntries(
          names.map(name => [
            name,
            {
              source: { entry: { main: entry } },
              output: {
                target: 'web',
                distPath: { root: path.join(context.distDirectory, name) },
              },
            },
          ]),
        ),
        tools: { htmlPlugin: { cache: false } },
        output: { cleanDistPath: false },
        dev: { writeToDisk: false, hmr: false, liveReload: false },
        server: { host: '127.0.0.1', port: 0, printUrls: false },
        performance: { printFileSize: false },
      },
    });
    let server: Awaited<ReturnType<typeof rsbuild.createDevServer>>;
    try {
      server = await rsbuild.createDevServer({ getPortSilently: true });
    } finally {
      restoreDtsConstructor();
    }
    closes.push(async () => {
      cleaningUp = true;
      firstMemberCompleted.resolve();
      releaseSiblingIO.resolve();
      try {
        for (const receiver of activeReceivers.keys())
          await retireReceiver(receiver);
        await closeController();
      } finally {
        await server.close();
      }
    });
    expect(dtsConstructorWorkerHooks.size).toBe(2);
    for (const name of names)
      expect(dtsConstructorWorkerHooks.get(name)).toBe(
        configuredWorkerHooks.get(name),
      );
    const listening = server.listen();
    const initialReady = phase.resolveIdentities();
    await Promise.race([firstMemberCompleted.promise, initialReady]);
    await Promise.race([siblingIOEntered.promise, initialReady]);
    expect(published).toEqual([]);
    expect(finalizedStats).toHaveLength(0);
    const frames = names.map(name => initialFrames.get(name)!);
    expect(new Set(frames.map(frame => frame.compilerId)).size).toBe(2);
    expect(new Set(frames.map(frame => frame.registrationId)).size).toBe(2);
    expect(new Set(frames.map(frame => frame.operationId)).size).toBe(1);
    expect(frames.map(frame => frame.generation)).toEqual([1, 1]);
    releaseSiblingIO.resolve();
    await listening;
    await phase.resolveIdentities();
    expect(published).toEqual([1]);
    expect(
      finalizedStats[0]!.stats
        .map(child => child.compilation.compiler.options.name)
        .sort(),
    ).toEqual([...names].sort());
    expect(() =>
      integration.controller.assertCompilerGraph?.(
        finalizedStats[0]!.stats[0]!,
      ),
    ).toThrow('missing compiler');
    // Native empty-remote consumes also retain their truthful no-IO receipts.
    // File effects must belong to the two independently enrolled members.
    const initialFileReceipts = leases[0]!.receipts.filter(
      pair => pair.receipt.nodes.length > 0,
    );
    const nativeNoIOReceipts = leases[0]!.receipts.filter(
      pair => pair.receipt.nodes.length === 0,
    );
    expect(nativeNoIOReceipts).toHaveLength(2);
    expect(
      nativeNoIOReceipts
        .map(pair => pair.registration.generation.compilerId)
        .sort(),
    ).toEqual(frames.map(frame => frame.compilerId).sort());
    expect(initialFileReceipts).toHaveLength(2);
    expect(
      initialFileReceipts
        .map(pair => pair.receipt.nodes[0]!.path.lexical)
        .sort(),
    ).toEqual([...destinations.values()].sort());
    expect(
      new Set(
        leases[0]!.receipts.map(
          pair => pair.registration.generation.compilerId,
        ),
      ).size,
    ).toBe(2);
    const priorSiblingCompilation = finalizedStats[0]!.stats.find(
      child => child.compilation.compiler.options.name === 'secondaryWeb',
    )!.compilation;
    const oldLease = await integration.controller.pinReceipts();
    const receiver = await begin('client');
    const secondReady = phase.resolveIdentities();
    expect(receiver.frame.generation).toBe(2);
    await expect(oldLease.assertCurrent()).rejects.toThrow();
    expect(published).toEqual([1]);
    await receiverWrite(
      receiver,
      'client',
      'export declare const App: bigint;\n',
    );
    await secondReady;
    expect(published).toEqual([1, 2]);
    const client = compilers.get('client')!;
    const nativeHTML = await new Promise<string>((resolve, reject) => {
      client.outputFileSystem!.readFile(
        path.join(client.options.output.path!, clientHTMLFilename),
        (error, bytes) => {
          if (error) reject(error);
          else resolve(String(bytes));
        },
      );
    });
    expect(nativeHTML).toContain(graphIdentities(2).identities.main!.buildId);
    expect(nativeHTML).not.toContain(
      graphIdentities(1).identities.main!.buildId,
    );
    expect(watchRuns.get('client')).toBe(2);
    expect(watchRuns.get('secondaryWeb')).toBe(1);
    expect(
      finalizedStats[1]!.stats.find(
        child => child.compilation.compiler.options.name === 'secondaryWeb',
      )!.compilation,
    ).toBe(priorSiblingCompilation);
    const updatedFileReceipts = leases[1]!.receipts.filter(
      pair => pair.receipt.nodes.length > 0,
    );
    expect(updatedFileReceipts).toHaveLength(1);
    expect(updatedFileReceipts[0]!.registration.generation.compilerId).toBe(
      authority('client').compilerId,
    );
    expect(updatedFileReceipts[0]!.receipt.nodes[0]!.path.lexical).toBe(
      destinations.get('client'),
    );
    expect(
      fs.readFileSync(destinations.get('secondaryWeb')!, 'utf8'),
    ).toContain('boolean');
    oldLease.release();
    await closeController();
    expect(shutdowns.sort()).toEqual([...names].sort());
    expect(restored).toBe(1);
    await expect(begin('client')).rejects.toThrow();
  });
});
