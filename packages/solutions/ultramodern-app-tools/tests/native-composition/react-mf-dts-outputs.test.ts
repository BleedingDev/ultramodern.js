import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { type ClientRequest, request } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { RendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import type {
  RendererGeneratedOutputCurrentNodes,
  RendererGeneratedOutputNode,
  RendererGeneratedOutputRegistration,
} from '@modern-js/app-tools-extensions/renderer-generated-outputs';
import { type CLIPluginAPI, createPluginManager } from '@modern-js/plugin';
import {
  type CLIPlugin,
  type CLIPluginExtends,
  createCli,
} from '@modern-js/plugin/cli';
import { program } from '@modern-js/utils/commander';
import {
  createRsbuild,
  type OnCloseBuildFn,
  type RsbuildInstance,
  type RsbuildPlugin,
  type Rspack,
  type RspackChain,
  rspack,
} from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import { applyCloudflareWorkerMfRuntimeBoundary } from '../../../app-tools-extensions/src/cloudflare-builder';
import { captureConfigSourceSnapshot } from '../../src/native-composition/config-evaluator/source-snapshot';
import {
  type ConfigSourceSnapshot,
  type ConfigurationSourceNode,
  createConfigurationReadContextPlugin,
  getConfigurationSourceInputs,
  getConfigurationSourceNodes,
  getConfigurationSourceSnapshot,
  type ObservedConfigSourceInputs,
  retainConfigurationSourceSnapshot,
} from '../../src/native-composition/configuration-read-context';
import { createNativeConfigLoad } from '../../src/native-composition/native-config-load';
import { reactAuthoredInputPaths } from '../../src/native-composition/react-authored-inputs';
import { REACT_RENDERER_IDENTITY_ELEMENT_ID } from '../../src/native-composition/react-build-metadata';
import {
  createReactReceiverOutputIntegration,
  type ReactReceiverImplementation,
  type ReactReceiverOutputIntegrationOptions,
} from '../../src/native-composition/react-mf-dts-outputs';
import type {
  ReceiverBridge,
  ReceiverContext,
  ReceiverFrame,
  ReceiverRegistry,
  ReceiverSeed,
} from '../../src/native-composition/react-mf-dts-registry';
import {
  type ReactGeneratedOutputGeneration,
  ReactTypedCssPhase,
} from '../../src/native-composition/react-typed-css-phase';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

const roots: string[] = [];
const closes: (() => Promise<void>)[] = [];
const requests = new Set<ClientRequest>();

afterEach(async () => {
  const errors: unknown[] = [];
  for (const close of closes.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const root of roots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  for (const req of requests) req.destroy();
  requests.clear();
  if (errors.length)
    throw new AggregateError(errors, 'Receiver output test cleanup failed');
});

const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-mf-controller-'),
    ),
  );
  roots.push(root);
  const appDirectory = path.join(root, 'app');
  const producerDirectory = path.join(root, 'native-dts-owner');
  fs.mkdirSync(path.join(appDirectory, 'src'), { recursive: true });
  fs.mkdirSync(path.join(appDirectory, '@mf-types/remote'), {
    recursive: true,
  });
  fs.mkdirSync(producerDirectory);
  fs.writeFileSync(
    path.join(appDirectory, 'package.json'),
    JSON.stringify({ name: 'native-receiver-controller', private: true }),
  );
  fs.writeFileSync(
    path.join(appDirectory, 'src/main.js'),
    'globalThis.nativeReceiverController = true;\n',
  );
  const declaration = path.join(appDirectory, '@mf-types/remote/App.d.ts');
  fs.writeFileSync(declaration, 'export declare const App: string;\n');
  const producerPath = path.join(producerDirectory, 'core.cjs');
  fs.writeFileSync(producerPath, 'module.exports = class NativeDTSManager {};');
  fs.writeFileSync(
    path.join(producerDirectory, 'package.json'),
    JSON.stringify({ name: '@fixture/native-dts-owner', version: '1.2.3' }),
  );
  return { root, appDirectory, producerDirectory, producerPath, declaration };
}

function observe(filename: string): RendererGeneratedOutputNode {
  const lexical = path.resolve(filename);
  let canonical = lexical;
  try {
    canonical = fs.realpathSync.native(lexical);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    let ancestor = path.dirname(lexical);
    const tail = [path.basename(lexical)];
    while (!fs.existsSync(ancestor)) {
      tail.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
    canonical = path.join(fs.realpathSync.native(ancestor), ...tail);
  }
  const inputPath = { lexical, canonical };
  let stat: fs.BigIntStats;
  try {
    stat = fs.lstatSync(lexical, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { path: inputPath, kind: 'missing' };
    throw error;
  }
  if (stat.isSymbolicLink())
    throw new Error('Test producer cannot follow links');
  const metadata = {
    device: String(stat.dev),
    inode: String(stat.ino),
    mode: Number(stat.mode),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
    size: String(stat.size),
    nlink: String(stat.nlink),
    blocks: String(stat.blocks),
    birthtimeNs: String(stat.birthtimeNs),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
  if (stat.isFile())
    return {
      path: inputPath,
      kind: 'file',
      byteDigest: digest(fs.readFileSync(lexical)),
      metadata,
    };
  if (!stat.isDirectory())
    throw new Error('Test producer has an unsupported node');
  return {
    path: inputPath,
    kind: 'directory',
    metadata,
    entries: fs.readdirSync(lexical, { withFileTypes: true }).map(entry => ({
      name: entry.name,
      kind: entry.isSymbolicLink()
        ? 'symlink'
        : entry.isDirectory()
          ? 'directory'
          : 'file',
    })),
  };
}

function current(
  registration: Pick<
    RendererGeneratedOutputRegistration,
    'consumer' | 'generation'
  >,
  expectedNodes: readonly RendererGeneratedOutputNode[],
): RendererGeneratedOutputCurrentNodes {
  return {
    generation: registration.generation,
    nodes: expectedNodes.map(node => {
      const actual = observe(node.path.lexical);
      if (actual.path.canonical !== node.path.canonical)
        throw new Error('Test receiver physical path changed');
      return actual;
    }),
  };
}

function identities(): RendererBuildIdentities {
  const profile = resolveRendererProfile('react');
  const provider = { ...profile.router, framework: 'react-router' as const };
  return {
    identities: {
      main: {
        renderer: 'react',
        appId: 'native-receiver-controller',
        entryName: 'main',
        protocolVersion: 1,
        buildId: 'a'.repeat(64),
      },
    },
    buildMarker: 'a'.repeat(64),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type NativeConfigurationCapture = {
  observed: ObservedConfigSourceInputs;
  snapshot: ConfigSourceSnapshot;
  nodes: readonly ConfigurationSourceNode[];
  configFile: string;
};

async function captureNativeConfiguration(
  appDirectory: string,
): Promise<NativeConfigurationCapture> {
  const manifest = path.join(appDirectory, 'package.json');
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      ...JSON.parse(fs.readFileSync(manifest, 'utf8')),
      type: 'commonjs',
    }),
  );
  fs.writeFileSync(
    path.join(appDirectory, 'native-config-helper.js'),
    'module.exports = true;\n',
  );
  const configFile = path.join(appDirectory, 'modern.config.js');
  const token = `__native_receiver_capture_${randomBytes(12).toString('hex')}`;
  const globals = globalThis as unknown as Record<string, unknown>;
  let captured: NativeConfigurationCapture | undefined;
  let dispose: (() => Promise<unknown>) | undefined;
  const consumer: CLIPlugin<CLIPluginExtends> = {
    name: 'native-receiver-original-configuration-consumer',
    setup(api) {
      const observed = getConfigurationSourceInputs(api);
      const snapshot = getConfigurationSourceSnapshot(api);
      const nodes = getConfigurationSourceNodes(api);
      if (!observed || !snapshot || !nodes)
        throw new Error(
          'The native CLI original configuration capture is absent',
        );
      expect(api.getAppContext().configFile).toBe(configFile);
      captured = { observed, snapshot, nodes, configFile };
      dispose = () => api.getHooks().onBeforeExit.call();
    },
  };
  globals[token] = consumer;
  fs.writeFileSync(
    configFile,
    `require('./native-config-helper.js');\nmodule.exports = () => ({plugins: [globalThis[${JSON.stringify(token)}]]});\n`,
  );
  const cli = createCli<CLIPluginExtends>();
  const previousArgv = process.argv;
  const envKeys = ['NODE_ENV', 'MODERN_ENV', 'MODERN_ARGV'] as const;
  const previousEnv = envKeys.map(key => process.env[key]);
  const previousOptions = [...program.options];
  const previousCommands = [...program.commands];
  const previousName = program.name();
  const previousUsage = program.usage();
  const previousVersionListeners = new Set(
    EventEmitter.prototype.listeners.call(program, 'option:version'),
  );
  try {
    process.argv = [process.execPath, 'modern', 'dev'];
    process.env.NODE_ENV = 'test';
    delete process.env.MODERN_ENV;
    delete process.env.MODERN_ARGV;
    await cli.init({
      ...createNativeConfigLoad(),
      cwd: appDirectory,
      configFile,
      command: 'dev',
      version: '0.0.0-native-receiver-capture',
    });
    if (!captured)
      throw new Error(
        'The native CLI consumer did not capture its configuration',
      );
    expect(captured.observed.packageMetadata).toEqual(
      expect.arrayContaining([
        {
          path: manifest,
          canonicalPath: manifest,
          field: 'name',
          value: 'native-receiver-controller',
        },
      ]),
    );
    const originalType = captured.observed.packageMetadata.find(
      record => record.path === manifest && record.field === 'type',
    );
    if (originalType)
      expect(originalType).toEqual({
        path: manifest,
        canonicalPath: manifest,
        field: 'type',
        value: 'commonjs',
      });
    expect(captured.nodes).toHaveLength(
      captured.observed.observations.length +
        captured.observed.packageMetadata.length,
    );
    return captured;
  } finally {
    try {
      await dispose?.();
    } finally {
      cli.dispose();
      Array.prototype.splice.call(
        program.options,
        0,
        program.options.length,
        ...previousOptions,
      );
      Array.prototype.splice.call(
        program.commands,
        0,
        program.commands.length,
        ...previousCommands,
      );
      program.name(previousName).usage(previousUsage);
      for (const listener of EventEmitter.prototype.listeners.call(
        program,
        'option:version',
      ))
        if (!previousVersionListeners.has(listener))
          EventEmitter.prototype.removeListener.call(
            program,
            'option:version',
            listener,
          );
      process.argv = previousArgv;
      for (const [index, key] of envKeys.entries()) {
        if (previousEnv[index] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[index];
      }
      delete globals[token];
    }
  }
}

type ChainModifier = Parameters<
  CLIPluginAPI<AppTools>['modifyBundlerChain']
>[0];
type BeforeCompiler = Parameters<
  CLIPluginAPI<AppTools>['onBeforeCreateCompiler']
>[0];
type AfterCompiler = Parameters<
  CLIPluginAPI<AppTools>['onAfterCreateCompiler']
>[0];
type BeforeExit = Parameters<CLIPluginAPI<AppTools>['onBeforeExit']>[0];
type BeforeBuild = Parameters<CLIPluginAPI<AppTools>['onBeforeBuild']>[0];
const AUTHORITY_KEY = 'ultramodernReceiverDts';
type FixtureNativePlugin = { apply(compiler: Rspack.Compiler): void };
type FixtureNativeConstructor = new (...args: unknown[]) => FixtureNativePlugin;
const effectiveNativeOptions = new WeakMap<
  Record<string, unknown>,
  Record<string, unknown>
>();

async function integration(
  app: ReturnType<typeof fixture>,
  options: {
    command?: 'dev' | 'build';
    capturedConfiguration?: NativeConfigurationCapture;
    producerGate?: Promise<void> | (() => Promise<void> | undefined);
    configurationInput?: string;
    configurationOperation?: 'content' | 'metadata' | 'directory';
    destinations?: readonly string[];
    destructiveDirectories?: readonly string[];
    sourceOverrides?: Record<string, unknown>;
    useRealTrackedInputs?: boolean;
    setupPlugins?: (
      api: CLIPluginAPI<AppTools>,
      receiver: CliPlugin<AppTools>,
    ) => Promise<void>;
  } = {},
) {
  const observation = options.configurationInput
    ? Object.freeze({
        path: options.configurationInput,
        canonicalPath: fs.realpathSync.native(options.configurationInput),
        operation: options.configurationOperation ?? ('content' as const),
        existed: true,
      })
    : undefined;
  const sourceNodes =
    options.capturedConfiguration?.nodes ??
    (observation ? [{ observation, node: observe(observation.path) }] : []);
  const observed: ObservedConfigSourceInputs =
    options.capturedConfiguration?.observed ??
    Object.freeze({
      kind: 'observed-config-source-inputs',
      version: 1,
      packageMetadata: Object.freeze([]),
      observations: Object.freeze(observation ? [observation] : []),
    });
  const snapshot =
    options.capturedConfiguration?.snapshot ??
    captureConfigSourceSnapshot({
      sourceRoots: [app.appDirectory],
    });
  retainConfigurationSourceSnapshot(observed, snapshot, sourceNodes);
  const hooks = {};
  let registry: ReceiverRegistry | undefined;
  let restoreCalls = 0;
  let observationReads = 0;
  let loads = 0;
  let producerReads = 0;
  let producerPreflights = 0;
  const compilerOwnerPlugins = new Map<
    string,
    new () => { apply(compiler: Rspack.Compiler): void }
  >();
  const compilerNativePlugins = new Map<
    string,
    {
      NativeConstructor: FixtureNativeConstructor;
      originalNativeConstructor: FixtureNativeConstructor;
      args: unknown[];
    }
  >();
  const compilerPluginInstances = new Map<
    string,
    { nativePlugin: FixtureNativePlugin; companionPlugin: FixtureNativePlugin }
  >();
  const testCompilers = new Map<string, Rspack.Compiler>();
  const producerEntered = deferred<void>();
  const chainModifiers: ChainModifier[] = [];
  const beforeCompiler: BeforeCompiler[] = [];
  const afterCompiler: AfterCompiler[] = [];
  const beforeExit: BeforeExit[] = [];
  const beforeBuild: BeforeBuild[] = [];
  const closeBuild: OnCloseBuildFn[] = [];
  let builder: Pick<RsbuildInstance, 'onCloseBuild'> = {
    onCloseBuild(callback) {
      if (typeof callback !== 'function')
        throw new Error('This test requires a native close callback');
      closeBuild.push(callback);
    },
  };
  const config = {
    renderer: 'react' as const,
    source: {
      mainEntryName: 'main',
      entriesDir: './src',
      ...options.sourceOverrides,
    },
    server: { ssr: false },
    output: { enableCssModuleTSDeclaration: false },
  };
  const api = {
    getHooks: () => hooks,
    getAppContext: () => ({
      appDirectory: app.appDirectory,
      command: options.command ?? 'dev',
      builder,
    }),
    getNormalizedConfig: () => config,
    modifyBundlerChain(callback: ChainModifier) {
      chainModifiers.push(callback);
    },
    onBeforeCreateCompiler(callback: BeforeCompiler) {
      beforeCompiler.push(callback);
    },
    onAfterCreateCompiler(callback: AfterCompiler) {
      afterCompiler.push(callback);
    },
    onBeforeExit(callback: BeforeExit) {
      beforeExit.push(callback);
    },
    onBeforeBuild(callback: BeforeBuild) {
      beforeBuild.push(callback);
    },
  };
  await createConfigurationReadContextPlugin(() => observed).setup?.(api);
  const configurationObserver: typeof current = options.capturedConfiguration
    ? (
        createRequire(import.meta.url)(
          '../../src/native-composition/react-mf-dts-implementation.cjs',
        ) as { observeReceiverNodes: typeof current }
      ).observeReceiverNodes
    : current;
  const implementation: ReactReceiverOutputIntegrationOptions['loadImplementation'] =
    () => {
      loads++;
      return {
        EXTRA_OPTIONS_KEY: AUTHORITY_KEY,
        createIsolatedReactFederationPlugin(NativeConstructor) {
          const adapter = createRequire(import.meta.url)(
            '../../src/native-composition/react-mf-dts-implementation.cjs',
          ) as Pick<
            ReactReceiverImplementation,
            'createIsolatedReactFederationPlugin'
          >;
          return adapter.createIsolatedReactFederationPlugin(NativeConstructor);
        },
        installReceiverRegistry(value) {
          registry = value;
          return () => {
            restoreCalls++;
          };
        },
        observeReceiverNodes(...args) {
          observationReads++;
          return configurationObserver(...args);
        },
      };
    };
  const result = createReactReceiverOutputIntegration({
    resolveImplementation: () => app.producerPath,
    loadImplementation: implementation,
    async resolveProducer() {
      if (!producerPreflights) producerPreflights++;
      else {
        producerReads++;
        producerEntered.resolve();
        await (typeof options.producerGate === 'function'
          ? options.producerGate()
          : options.producerGate);
      }
      return {
        packageName: '@fixture/native-dts-owner',
        version: '1.2.3',
        packageDirectory: app.producerDirectory,
        modulePath: app.producerPath,
        moduleDigest: digest(fs.readFileSync(app.producerPath)),
      };
    },
    async resolveDestinations(details) {
      return {
        effectiveOptions: details.nativeOptions,
        context: { operation: details.operation },
        destinations: (options.destinations ?? [app.declaration]).map(
          filename => ({
            path: observe(filename).path,
            kind: options.destructiveDirectories?.includes(filename)
              ? 'directory'
              : 'file',
            scope: options.destructiveDirectories?.includes(filename)
              ? 'subtree'
              : 'exact',
          }),
        ),
      };
    },
    sourceNodes: () => sourceNodes,
    ...(options.useRealTrackedInputs ? {} : { trackedInputs: async () => [] }),
  });
  if (options.setupPlugins)
    await options.setupPlugins(
      api as unknown as CLIPluginAPI<AppTools>,
      result.plugin,
    );
  else await result.plugin.setup?.(api as unknown as CLIPluginAPI<AppTools>);
  let closed = false;
  const close = async () => {
    if (closed) return;
    for (const callback of beforeExit) await callback();
    closed = true;
  };
  closes.push(close);
  const context = {
    entrypoints: [
      {
        entryName: 'main',
        isMainEntry: true,
        entry: path.join(app.appDirectory, 'src/main.js'),
      },
    ],
    appDirectory: app.appDirectory,
    internalDirectory: path.join(app.appDirectory, '.modern-js'),
    distDirectory: path.join(app.appDirectory, 'dist'),
    configFile: options.capturedConfiguration?.configFile ?? (false as const),
    consumedSourceInputs: observed,
    configurationSourceSnapshot: snapshot,
    configurationSourceNodes: sourceNodes,
    packageName: 'native-receiver-controller',
    mode: 'development' as const,
    config: config as unknown as Parameters<
      typeof result.controller.bindPhase
    >[1]['config'],
  };
  return {
    ...result,
    context,
    chainModifiers,
    beforeCompiler,
    beforeBuild,
    closeBuild,
    setBuilder(value: RsbuildInstance) {
      builder = value;
    },
    afterCompiler,
    compilerOwnerPlugins,
    compilerNativePlugins,
    compilerPluginInstances,
    testCompilers,
    producerEntered: producerEntered.promise,
    registry: () => {
      if (!registry)
        throw new Error('Native receiver implementation was not loaded');
      return registry;
    },
    loads: () => loads,
    producerReads: () => producerReads,
    producerPreflights: () => producerPreflights,
    restoreCalls: () => restoreCalls,
    observationReads: () => observationReads,
    close,
  };
}

async function configureChain(
  result: Awaited<ReturnType<typeof integration>>,
  options: Record<string, unknown>,
  enabled = true,
  nativeLifecycle = false,
  environmentName = 'client',
) {
  let args: unknown[] = [options, 'retained-native-argument'];
  const originalNativeConstructor: FixtureNativeConstructor = class {
    apply(_compiler: Rspack.Compiler) {}
  };
  let nativePlugin = originalNativeConstructor;
  const chain = {
    plugins: { has: () => enabled },
    plugin: (name: string) => ({
      get(key: string) {
        expect(name).toBe('plugin-module-federation');
        if (key === 'plugin') return nativePlugin;
        if (key === 'args') return args;
        throw new Error(`Unexpected native plugin key: ${key}`);
      },
      tap(callback: (value: unknown[]) => unknown[]) {
        expect(name).toBe('plugin-module-federation');
        args = callback(args);
      },
      before(nativePlugin: string) {
        expect(name).toBe('ultramodern-react-mf-receiver-owner');
        expect(nativePlugin).toBe('plugin-module-federation');
        return this;
      },
      use(Plugin: FixtureNativeConstructor, suppliedArgs?: unknown[]) {
        if (name === 'plugin-module-federation') {
          nativePlugin = Plugin;
          args = suppliedArgs ?? args;
        } else result.compilerOwnerPlugins.set(environmentName, Plugin);
      },
    }),
  };
  for (const modifier of result.chainModifiers)
    await modifier(
      chain as unknown as RspackChain,
      { environment: { name: environmentName } } as never,
    );
  effectiveNativeOptions.set(options, args[0] as Record<string, unknown>);
  result.compilerNativePlugins.set(environmentName, {
    NativeConstructor: nativePlugin,
    originalNativeConstructor,
    args,
  });
  const Owner = result.compilerOwnerPlugins.get(environmentName);
  const nativeInstance = new nativePlugin(...args);
  const companionInstance = Owner ? new Owner() : undefined;
  if (companionInstance)
    result.compilerPluginInstances.set(environmentName, {
      nativePlugin: nativeInstance,
      companionPlugin: companionInstance,
    });
  const plugins = [
    ...(companionInstance ? [companionInstance] : []),
    ...(enabled ? [nativeInstance] : []),
  ];
  if (!nativeLifecycle) {
    for (const callback of result.beforeCompiler)
      await callback({
        bundlerConfigs: [{ name: environmentName, plugins }],
      } as never);
    const compiler = {
      options: { name: environmentName, plugins },
      hooks: { shutdown: { tapPromise() {} } },
      close(callback: (error?: Error) => void) {
        callback();
      },
    } as unknown as Rspack.Compiler;
    result.testCompilers.set(environmentName, compiler);
    for (const plugin of plugins) plugin.apply(compiler);
    for (const callback of result.afterCompiler)
      await callback({ compiler } as never);
  }
  return args;
}

function seed(options: Record<string, unknown>): ReceiverSeed {
  const dts = (effectiveNativeOptions.get(options) ?? options).dts as {
    extraOptions: Record<string, ReceiverSeed>;
  };
  return dts.extraOptions[AUTHORITY_KEY];
}

function workerCreated(options: Record<string, unknown>) {
  return (
    (effectiveNativeOptions.get(options) ?? options).dts as {
      onDevWorkerCreated: (witness: unknown) => void;
    }
  ).onDevWorkerCreated;
}

function installFixtureCompilerPlugins(
  chain: RspackChain,
  result: Awaited<ReturnType<typeof integration>>,
  name: string,
) {
  const Native = result.compilerNativePlugins.get(name);
  const Owner = result.compilerOwnerPlugins.get(name);
  if (!Native || !Owner) return;
  const instances = result.compilerPluginInstances.get(name);
  if (!instances)
    throw new Error('The configured compiler plugin pair is absent');
  chain
    .plugin('ultramodern-react-mf-receiver-owner')
    .use(instances.companionPlugin);
  chain.plugin('plugin-module-federation').use(instances.nativePlugin);
}

function receiverDetails() {
  return {
    operation: 'consumeTypes' as const,
    nativeOptions: { host: { consumeAPITypes: true }, consumeTypes: true },
  };
}

function writeReceiver(
  context: ReceiverContext,
  destination: string,
  bytes = 'export declare const App: number;\n',
) {
  const operation = {
    operation: 'write' as const,
    kind: 'file' as const,
    before: observe(destination),
  };
  context.beforeOperations([operation]);
  fs.writeFileSync(destination, bytes);
  const acknowledgement = { ...operation, after: observe(destination) };
  context.acknowledgeOperations([acknowledgement]);
  return acknowledgement;
}

async function completeReceiver(
  context: ReceiverContext,
  ...operations: ReturnType<typeof writeReceiver>[]
) {
  await context.terminal({
    status: 'complete',
    frame: context.frame,
    operations,
    nodes: operations.map(operation => observe(operation.after.path.lexical)),
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
}

interface BridgeResponse {
  status: number | undefined;
  value: unknown;
}

function postBridge(bridge: ReceiverBridge, body: unknown) {
  const response = deferred<BridgeResponse>();
  const bytes = Buffer.from(JSON.stringify(body));
  const req = request(
    bridge.url,
    {
      method: 'POST',
      agent: false,
      headers: {
        authorization: `Bearer ${bridge.token}`,
        'content-type': 'application/json',
        'content-length': bytes.length,
      },
    },
    incoming => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.once('error', response.reject);
      incoming.once('end', () => {
        try {
          response.resolve({
            status: incoming.statusCode,
            value: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        } catch (error) {
          response.reject(error);
        }
      });
    },
  );
  requests.add(req);
  req.once('close', () => requests.delete(req));
  req.once('error', response.reject);
  req.end(bytes);
  return response.promise;
}

async function queuedBridgeBegin(
  bridge: ReceiverBridge,
  configured: ReceiverSeed,
  onCreated: (request: {
    beginId: string;
    responses: Promise<BridgeResponse>[];
  }) => void,
) {
  const beginId = randomBytes(16).toString('hex');
  const body = {
    action: 'begin',
    beginId,
    seed: configured,
    details: { ...receiverDetails(), receiverProcessId: process.pid },
  };
  const responses = [postBridge(bridge, body), postBridge(bridge, body)];
  onCreated({ beginId, responses });
  const duplicate = await Promise.race(
    responses.map((response, index) =>
      response.then(value => ({ index, value })),
    ),
  );
  expect(duplicate.value.status).toBe(400);
  return { beginId, response: responses[1 - duplicate.index] };
}

function bridgeTerminal(beginId: string, frame: ReceiverFrame, failed = false) {
  return {
    action: 'terminal',
    beginId,
    frame,
    events: [],
    evidence: {
      status: failed ? 'failed' : 'complete',
      frame,
      operations: [],
      nodes: [],
      stages: failed
        ? []
        : [
            {
              stage: 'api',
              alias: 'remote',
              requested: true,
              outcome: 'complete',
              result: false,
            },
          ],
      failures: failed
        ? [
            {
              operation: 'test-cleanup',
              reason: 'Test stopped before completion',
            },
          ]
        : [],
    },
  };
}

function bindTestPhase(
  app: ReturnType<typeof fixture>,
  result: Awaited<ReturnType<typeof integration>>,
) {
  const phase = new ReactTypedCssPhase({
    appDirectory: app.appDirectory,
    internalDirectory: result.context.internalDirectory,
    distDirectory: result.context.distDirectory,
    produceTypedCss: false,
    inputPaths: reactAuthoredInputPaths(result.context),
    generatedOutputs: result.controller,
    finalize: async () => identities(),
  });
  result.controller.bindPhase(phase, result.context);
  return phase;
}

async function nativeOneShotBuild(
  app: ReturnType<typeof fixture>,
  options: {
    publicationError?: Error;
    compilationError?: boolean;
    worker?: Readonly<{ pid: number; closed: Promise<void> }>;
  } = {},
) {
  const result = await integration(app, { command: 'build' });
  const nativeOptions: Record<string, unknown> = { dts: true };
  await configureChain(result, nativeOptions, true, true);
  const events: string[] = [];
  let frameCompleted = false;
  const phase = new ReactTypedCssPhase({
    appDirectory: app.appDirectory,
    internalDirectory: result.context.internalDirectory,
    distDirectory: result.context.distDirectory,
    produceTypedCss: false,
    generatedOutputs: result.controller,
    async finalize(_stats, lease) {
      expect(frameCompleted).toBe(true);
      expect(lease?.receipts).toHaveLength(1);
      await lease?.assertCurrent();
      events.push('identity');
      return identities();
    },
    async publishMetadata(_stats, _identities, assertCurrent) {
      assertCurrent();
      events.push('metadata');
      if (options.publicationError) throw options.publicationError;
    },
  });
  result.controller.bindPhase(phase, result.context);
  let closeCalls = 0;
  const lifecycle: RsbuildPlugin = {
    name: 'test-one-shot-receiver-lifecycle',
    setup(api) {
      phase.install(api);
      api.modifyBundlerChain((chain, { environment }) => {
        installFixtureCompilerPlugins(chain, result, environment.name);
      });
      api.onBeforeBuild(async params => {
        for (const callback of result.beforeBuild)
          await callback(params as never);
      });
      api.onBeforeCreateCompiler(async params => {
        for (const callback of result.beforeCompiler)
          await callback(params as never);
      });
      api.onAfterCreateCompiler(async params => {
        for (const callback of result.afterCompiler)
          await callback(params as never);
        if (options.worker) workerCreated(nativeOptions)(options.worker);
        const compilers =
          'compilers' in params.compiler
            ? params.compiler.compilers
            : [params.compiler];
        for (const compiler of compilers) {
          const nativeClose = compiler.close.bind(compiler);
          compiler.close = callback => {
            closeCalls++;
            nativeClose(error => {
              events.push(`closed:${compiler.options.name}`);
              callback(error);
            });
          };
          if (compiler.options.name !== 'client') continue;
          compiler.hooks.thisCompilation.tap(
            'test-production-receiver',
            compilation => {
              compilation.hooks.processAssets.tapPromise(
                {
                  name: 'test-production-receiver',
                  stage: rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                },
                async () => {
                  const receiver = await result
                    .registry()
                    .begin(seed(nativeOptions), receiverDetails());
                  await completeReceiver(
                    receiver,
                    writeReceiver(receiver, app.declaration),
                  );
                  frameCompleted = true;
                  events.push('frame');
                  if (options.compilationError)
                    compilation.errors.push(
                      new Error('Controlled native compilation failure'),
                    );
                },
              );
            },
          );
        }
      });
    },
  };
  const builder = await createRsbuild({
    cwd: app.appDirectory,
    rsbuildConfig: {
      mode: 'production',
      plugins: [lifecycle],
      environments: {
        client: {
          source: { entry: { main: './src/main.js' } },
          output: { target: 'web' },
        },
        server: {
          source: { entry: { main: './src/main.js' } },
          output: { target: 'node' },
        },
      },
      output: {
        cleanDistPath: false,
        distPath: { root: result.context.distDirectory },
      },
      performance: { printFileSize: false },
    },
  });
  result.setBuilder(builder);
  return {
    result,
    phase,
    events,
    builder,
    closeCalls: () => closeCalls,
    frameCompleted: () => frameCompleted,
  };
}

async function publicPhaseHooks(
  app: ReturnType<typeof fixture>,
  result: Awaited<ReturnType<typeof integration>>,
  phase: ReactTypedCssPhase,
) {
  type PhaseAPI = Parameters<ReactTypedCssPhase['install']>[0];
  type CompilerHook = Parameters<PhaseAPI['onAfterCreateCompiler']>[0];
  let install: Extract<CompilerHook, (...args: never[]) => unknown> | undefined;
  const api: Pick<
    PhaseAPI,
    'onAfterBuild' | 'modifyRspackConfig' | 'onAfterCreateCompiler'
  > = {
    onAfterBuild() {},
    modifyRspackConfig() {},
    onAfterCreateCompiler(callback) {
      install = typeof callback === 'function' ? callback : callback.handler;
    },
  };
  phase.install(api as unknown as PhaseAPI);
  const instances = result.compilerPluginInstances.get('client');
  if (!instances)
    throw new Error('The native receiver compiler plugin pair is absent');
  const compilerConfig: Rspack.Configuration = {
    name: 'client',
    mode: 'development',
    context: app.appDirectory,
    entry: './src/main.js',
    output: { path: result.context.distDirectory },
    plugins: [instances.companionPlugin, instances.nativePlugin],
  };
  for (const callback of result.beforeCompiler)
    await callback({ bundlerConfigs: [compilerConfig] } as never);
  // Construct genuine public hooks; no compiler run, watch, or build occurs.
  const compiler = rspack(compilerConfig);
  if (!compiler || !install)
    throw new Error('The public phase compiler hooks are absent');
  const params = {
    compiler,
    environments: { client: { config: { output: { target: 'web' } } } },
  };
  for (const callback of result.afterCompiler) await callback(params as never);
  await install(params as never);
  return compiler;
}

async function destructiveDirectoryRejectedBeforeIO(
  result: Awaited<ReturnType<typeof integration>>,
  configured: ReceiverSeed,
  directory: string,
) {
  const receiver = await result.registry().begin(configured, receiverDetails());
  const terminal = {
    status: 'failed' as const,
    frame: receiver.frame,
    operations: [],
    nodes: [],
    stages: [],
    failures: [
      { operation: 'delete', reason: 'Destructive native operation rejected' },
    ],
  };
  closes.push(async () => {
    await receiver.terminal(terminal).catch(() => {});
  });
  const operation = {
    operation: 'delete' as const,
    kind: 'directory' as const,
    before: observe(directory),
  };
  let nativeIOCalls = 0;
  let acknowledgementCalls = 0;
  expect(() => {
    receiver.beforeOperations([operation]);
    nativeIOCalls++;
    fs.rmSync(directory, { recursive: true });
    acknowledgementCalls++;
    receiver.acknowledgeOperations([
      { ...operation, after: observe(directory) },
    ]);
  }).toThrow('operation changes an authored or tracked input ancestor');
  expect(nativeIOCalls).toBe(0);
  expect(acknowledgementCalls).toBe(0);
  await expect(receiver.terminal(terminal)).rejects.toThrow(
    'operation changes an authored or tracked input ancestor',
  );
  await expect(result.controller.pinReceipts()).rejects.toThrow(
    'operation changes an authored or tracked input ancestor',
  );
}

async function expectWriteRejectedBeforeIO(
  result: Awaited<ReturnType<typeof integration>>,
  configured: ReceiverSeed,
  filename: string,
  reason?: string,
) {
  const receiver = await result.registry().begin(configured, receiverDetails());
  closes.push(async () => {
    await receiver
      .terminal({
        status: 'failed',
        frame: receiver.frame,
        operations: [],
        nodes: [],
        stages: [],
        failures: [
          { operation: 'test-cleanup', reason: 'Rejected native write' },
        ],
      })
      .catch(() => {});
  });
  const rejection = expect(() =>
    receiver.beforeOperations([
      { operation: 'write', kind: 'file', before: observe(filename) },
    ]),
  );
  if (reason) rejection.toThrow(reason);
  else rejection.toThrow();
}

async function settleClosedReceiver(receiver: ReceiverContext) {
  await expect(
    receiver.terminal({
      status: 'failed',
      frame: receiver.frame,
      operations: [],
      nodes: [],
      stages: [],
      failures: [
        { operation: 'test-close', reason: 'Same-process receiver IO settled' },
      ],
    }),
  ).rejects.toThrow();
}

describe('React native receiver output controller', () => {
  it.each([
    'success',
    'metadata-error',
    'compiler-error',
  ])('lets a plain one-shot compiler process exit naturally: %s', async outcome => {
    const app = fixture();
    const owningRequire = createRequire(import.meta.url);
    const sourceDirectory = path.resolve(
      __dirname,
      '../../src/native-composition',
    );
    const childEntry = path.join(app.root, 'one-shot-entry.mjs');
    const childBundle = path.join(app.root, 'one-shot-bundle.cjs');
    const phaseModule = path.resolve(
      sourceDirectory,
      '../../dist/cjs/native-composition/react-typed-css-phase.js',
    );
    fs.writeFileSync(
      childEntry,
      `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import http from 'node:http';
      import { createRequire } from 'node:module';
      import { createRsbuild } from '@rsbuild/core';
      import { ReactTypedCssPhase } from ${JSON.stringify(phaseModule)};
      import { createReactReceiverOutputIntegration } from ${JSON.stringify(path.join(sourceDirectory, 'react-mf-dts-outputs.ts'))};
      import { captureConfigSourceSnapshot } from ${JSON.stringify(path.join(sourceDirectory, 'config-evaluator/source-snapshot.ts'))};
      import { createConfigurationReadContextPlugin, retainConfigurationSourceSnapshot } from ${JSON.stringify(path.join(sourceDirectory, 'configuration-read-context.ts'))};
      const app = ${JSON.stringify(app)};
      const { observeReceiverNodes, createIsolatedReactFederationPlugin } = createRequire(import.meta.url)(${JSON.stringify(path.join(sourceDirectory, 'react-mf-dts-implementation.cjs'))});
      const outcome = ${JSON.stringify(outcome)};
      const observed = Object.freeze({kind:'observed-config-source-inputs',version:1,packageMetadata:Object.freeze([]),observations:Object.freeze([])});
      const snapshot = captureConfigSourceSnapshot({sourceRoots:[app.appDirectory]});
      const sourceNodes = Object.freeze([]);
      retainConfigurationSourceSnapshot(observed, snapshot, sourceNodes);
      const hooks = {}, modifiers = [], beforeCompiler = [], afterCompiler = [], beforeBuild = [];
      let builder, registry, restored = 0;
      const config = {renderer:'react', source:{mainEntryName:'main',entriesDir:'./src'},server:{ssr:false},output:{enableCssModuleTSDeclaration:false}};
      const api = {
        getHooks:()=>hooks,
        getAppContext:()=>({appDirectory:app.appDirectory,command:'build',builder}),
        getNormalizedConfig:()=>config,
        modifyBundlerChain:fn=>modifiers.push(fn),
        onBeforeCreateCompiler:fn=>beforeCompiler.push(fn),
        onAfterCreateCompiler:fn=>afterCompiler.push(fn),
        onBeforeBuild:fn=>beforeBuild.push(fn),
        onBeforeExit:()=>{}
      };
      await createConfigurationReadContextPlugin(()=>observed).setup(api);
      const integration = createReactReceiverOutputIntegration({
        resolveImplementation:()=>app.producerPath,
        loadImplementation:()=>({EXTRA_OPTIONS_KEY:'ultramodernReceiverDts',createIsolatedReactFederationPlugin,installReceiverRegistry(value){registry=value;return()=>{restored++}},observeReceiverNodes}),
        resolveProducer:async()=>({packageName:'@fixture/native-dts-owner',version:'1.2.3',packageDirectory:app.producerDirectory,modulePath:app.producerPath,moduleDigest:${JSON.stringify(digest(fs.readFileSync(app.producerPath)))} }),
        resolveDestinations:async details=>({effectiveOptions:details.nativeOptions,context:{operation:details.operation},destinations:[{path:{lexical:app.declaration,canonical:fs.realpathSync(app.declaration)},kind:'file',scope:'exact'}]}),
        sourceNodes:()=>sourceNodes,trackedInputs:async()=>[]
      });
      await integration.plugin.setup(api);
      const borrowedNativeOptions = {dts:true};
      let nativeOptions;
      let receiptComplete = false, metadataComplete = false;
      const context = {appDirectory:app.appDirectory,internalDirectory:path.join(app.appDirectory,'.modern-js'),distDirectory:path.join(app.appDirectory,'dist'),configFile:false,config,consumedSourceInputs:observed,configurationSourceSnapshot:snapshot,configurationSourceNodes:sourceNodes,packageName:'native-receiver-controller',mode:'production',entrypoints:[{entryName:'main',isMainEntry:true,entry:path.join(app.appDirectory,'src/main.js')}]};
      const phase = new ReactTypedCssPhase({appDirectory:context.appDirectory,internalDirectory:context.internalDirectory,distDirectory:context.distDirectory,configurationSourceSnapshot:snapshot,produceTypedCss:false,generatedOutputs:integration.controller,
        async finalize(_stats,lease){assert.ok(receiptComplete);assert.equal(lease.receipts.length,1);await lease.assertCurrent();return ${JSON.stringify(identities())}},
        async publishMetadata(_stats,_identities,assertCurrent){assertCurrent();if(outcome==='metadata-error')throw new Error('Original child metadata error');metadataComplete=true;}
      });
      integration.controller.bindPhase(phase,context);
      class NativeMFConfiguration {apply(){}}
      builder = await createRsbuild({cwd:app.appDirectory,rsbuildConfig:{
        mode:'production',output:{cleanDistPath:false,distPath:{root:path.join(app.appDirectory,'dist')}},performance:{printFileSize:false},
        environments:{client:{source:{entry:{main:'./src/main.js'}},output:{target:'web'}}},
        plugins:[{name:'test-natural-receiver-process',setup(native){
          phase.install(native);
          native.modifyBundlerChain(async(chain,utils)=>{chain.plugin('plugin-module-federation').use(NativeMFConfiguration,[borrowedNativeOptions]);for(const fn of modifiers)await fn(chain,utils);nativeOptions=chain.plugin('plugin-module-federation').get('args')[0];assert.deepEqual(borrowedNativeOptions,{dts:true});});
          native.onBeforeBuild(async params=>{for(const fn of beforeBuild)await fn(params)});
          native.onBeforeCreateCompiler(async params=>{for(const fn of beforeCompiler)await fn(params)});
          native.onAfterCreateCompiler(async params=>{
            for(const fn of afterCompiler)await fn(params);
            const compiler=params.compiler.compilers?.[0]??params.compiler;
            compiler.hooks.thisCompilation.tap('child-receiver',compilation=>compilation.hooks.processAssets.tapPromise('child-receiver',async()=>{
              const receiver=await registry.begin(nativeOptions.dts.extraOptions.ultramodernReceiverDts,{operation:'consumeTypes',nativeOptions:{host:{consumeAPITypes:true},consumeTypes:true}});
              await receiver.terminal({status:'complete',frame:receiver.frame,operations:[],nodes:[],stages:[{stage:'api',alias:'remote',requested:true,outcome:'complete',result:false}],failures:[]});
              receiptComplete=true;
              if(outcome==='compiler-error')compilation.errors.push(new Error('Original child compilation error'));
            }));
          });
        }}]
      }});
      let built, failure;
      try {built=await builder.build()} catch(error){failure=error}
      if(!receiptComplete && failure) throw failure;
      assert.ok(receiptComplete);
      const bridge = nativeOptions.dts.extraOptions.ultramodernReceiverDts.receiverBridge;
      assert.ok(bridge.url.startsWith('http://127.0.0.1:'));
      if(outcome==='success') {assert.equal(failure,undefined);assert.ok(metadataComplete);assert.equal(restored,0);await built.close()}
      else {assert.ok(failure);assert.equal(metadataComplete,false);if(outcome==='metadata-error')assert.equal(failure.message,'Original child metadata error')}
      assert.equal(restored,1);
      await new Promise((resolve,reject)=>{
        const request=http.get(bridge.url,{agent:false},()=>reject(new Error('Receiver bridge remained reachable')));
        request.on('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
      });
      process.stdout.write('NATURAL_RECEIVER_BUILD_EXIT:${outcome}\\n');
      // No explicit controller cleanup, process.exit(), signals or unref.
    `,
    );
    const childCompiler = rspack({
      mode: 'development',
      target: 'node',
      entry: childEntry,
      devtool: false,
      output: { path: app.root, filename: path.basename(childBundle) },
      resolve: { extensions: ['.ts', '.js', '.mjs', '.cjs'] },
      module: {
        rules: [
          {
            test: /\.ts$/u,
            use: {
              loader: 'builtin:swc-loader',
              options: { jsc: { parser: { syntax: 'typescript' } } },
            },
          },
        ],
      },
      externals: ({ request }, callback) => {
        if (request === phaseModule)
          return callback(undefined, `commonjs ${phaseModule}`);
        if (!request || request.startsWith('.') || path.isAbsolute(request))
          return callback();
        if (request.startsWith('node:'))
          return callback(undefined, `commonjs ${request}`);
        return callback(
          undefined,
          `commonjs ${owningRequire.resolve(request)}`,
        );
      },
    });
    await new Promise<void>((resolve, reject) => {
      childCompiler.run((error, stats) => {
        childCompiler.close(closeError => {
          if (error || closeError) reject(error ?? closeError);
          else if (stats?.hasErrors())
            reject(new Error(stats.toString({ all: false, errors: true })));
          else resolve();
        });
      });
    });
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [childBundle],
        { cwd: app.appDirectory, timeout: 20_000 },
        (error, stdout, stderr) => {
          if (error)
            reject(
              new Error(`Natural build process failed: ${stderr}`, {
                cause: error,
              }),
            );
          else resolve(stdout);
        },
      );
    });
    expect(output).toContain(`NATURAL_RECEIVER_BUILD_EXIT:${outcome}`);
  });

  it.each([
    { command: 'build' as const, isWatch: true },
    { command: 'dev' as const, isWatch: false },
  ])('retains the receiver bridge across the close hook for %o', async ({
    command,
    isWatch,
  }) => {
    const app = fixture();
    const result = await integration(app, { command });
    await configureChain(result, { dts: true });
    for (const callback of result.beforeBuild)
      await callback({ isWatch } as never);
    const bridge = await result.registry().openBridge();
    for (const callback of result.closeBuild) await callback();
    expect(result.restoreCalls()).toBe(0);
    expect((await postBridge(bridge, { action: 'unknown' })).status).not.toBe(
      0,
    );
    await result.close();
    expect(result.restoreCalls()).toBe(1);
  });
  it('closes a one-shot bridge after actual native compiler close, metadata and worker drain', async () => {
    const app = fixture();
    const worker = execFile(process.execPath, [
      '-e',
      'process.stdin.resume(); process.stdout.write("ready");',
    ]);
    const ready = new Promise<void>(resolve =>
      worker.stdout!.once('data', () => resolve()),
    );
    const closed = new Promise<void>((resolve, reject) => {
      worker.once('error', reject);
      worker.once('close', (code, signal) => {
        if (code === 0 && signal === null) resolve();
        else
          reject(
            new Error(`Native lifecycle worker failed: ${code}/${signal}`),
          );
      });
    });
    await ready;
    if (!worker.pid) throw new Error('The real worker has no process identity');
    const build = await nativeOneShotBuild(app, {
      worker: { pid: worker.pid, closed },
    });
    closes.push(async () => {
      worker.stdin!.end();
      await closed;
    });
    const compiled = await build.builder.build();
    expect(build.frameCompleted()).toBe(true);
    expect(build.events.slice(0, 3)).toEqual(['frame', 'identity', 'metadata']);
    expect(build.events.slice(3).sort()).toEqual([
      'closed:client',
      'closed:server',
    ]);
    expect(build.closeCalls()).toBe(2);
    expect(build.result.restoreCalls()).toBe(0);
    const bridge = await build.result.registry().openBridge();
    let finished = false;
    const finishing = compiled.close().then(() => {
      finished = true;
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(finished).toBe(false);
    expect(build.result.restoreCalls()).toBe(0);
    const concurrentSignalCleanup = build.result.close();
    worker.stdin!.end();
    await closed;
    await Promise.all([finishing, concurrentSignalCleanup]);
    expect(finished).toBe(true);
    expect(build.closeCalls()).toBe(2);
    expect(build.result.restoreCalls()).toBe(1);
    await expect(postBridge(bridge, { action: 'begin' })).rejects.toThrow();
    await compiled.close();
    expect(build.result.restoreCalls()).toBe(1);
  });

  it('drains the bridge on a genuine one-shot metadata rejection and preserves its error', async () => {
    const app = fixture();
    const failure = new Error('Controlled production metadata rejection');
    const build = await nativeOneShotBuild(app, { publicationError: failure });
    await expect(build.builder.build()).rejects.toBe(failure);
    expect(build.frameCompleted()).toBe(true);
    expect(build.events).toContain('metadata');
    expect(build.closeCalls()).toBe(2);
    expect(build.result.restoreCalls()).toBe(1);
    await expect(build.result.registry().openBridge()).rejects.toThrow(
      'disposed',
    );
  });

  it('does not await its own public shutdown hook during one-shot signal cleanup', async () => {
    const app = fixture();
    const result = await integration(app, { command: 'build' });
    await configureChain(result, { dts: true }, true, true);
    const phase = bindTestPhase(app, result);
    const compiler = await publicPhaseHooks(app, result, phase);
    for (const callback of result.beforeBuild)
      await callback({ isWatch: false } as never);
    const bridge = await result.registry().openBridge();
    let closeCalls = 0;
    const nativeClose = compiler.close.bind(compiler);
    compiler.close = callback => {
      closeCalls++;
      nativeClose(callback);
    };
    await Promise.all([result.close(), result.close()]);
    await expect(phase.resolveIdentities()).rejects.toThrow(
      'closed before identity finalization',
    );
    expect(closeCalls).toBe(1);
    expect(result.restoreCalls()).toBe(1);
    await expect(postBridge(bridge, { action: 'begin' })).rejects.toThrow();
  });

  it('drains the bridge when the real one-shot compiler reports errors before publication', async () => {
    const app = fixture();
    const build = await nativeOneShotBuild(app, { compilationError: true });
    await expect(build.builder.build()).rejects.toThrow();
    expect(build.frameCompleted()).toBe(true);
    expect(build.events).not.toContain('metadata');
    expect(build.closeCalls()).toBe(2);
    expect(build.result.restoreCalls()).toBe(1);
    await expect(build.result.registry().openBridge()).rejects.toThrow(
      'disposed',
    );
  });
  it.each([
    { input: 'unrelated', reject: false },
    { input: 'consumed', reject: true },
  ])('protects only app and consumed shared Git files before receiver IO: $input', async ({
    input,
    reject,
  }) => {
    const app = fixture();
    const consumed = path.join(app.root, 'shared-input.ts');
    const unrelated = path.join(app.root, 'unrelated-package.ts');
    fs.writeFileSync(consumed, 'export const value = 1;\n');
    fs.writeFileSync(unrelated, 'export const value = 1;\n');
    execFileSync('git', ['init', '--quiet'], { cwd: app.root });
    execFileSync('git', ['add', '.'], { cwd: app.root });
    const result = await integration(app, {
      useRealTrackedInputs: true,
      sourceOverrides: { alias: { '@shared': consumed } },
    });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    bindTestPhase(app, result);
    fs.writeFileSync(
      input === 'consumed' ? consumed : unrelated,
      'export const value = 2;\n',
    );
    const beginning = result.registry().begin(seed(options), receiverDetails());
    if (reject)
      await expect(beginning).rejects.toThrow(
        'authored file changed before IO',
      );
    else {
      const receiver = await beginning;
      await completeReceiver(receiver);
      const registration = result
        .registry()
        .completedReceipts()[0].registration;
      expect(
        registration.authoredPaths.some(input => input.lexical === consumed),
      ).toBe(true);
      expect(
        registration.authoredPaths.some(input => input.lexical === unrelated),
      ).toBe(false);
    }
  });

  it('rejects a configured native remote declaration hardlink to an original authored file before IO', async () => {
    const app = fixture();
    const authored = path.join(app.appDirectory, 'src/authored.ts');
    fs.writeFileSync(authored, 'export declare const Authored: string;\n');
    fs.unlinkSync(app.declaration);
    fs.linkSync(authored, app.declaration);
    const authoredBefore = observe(authored);
    const declarationBefore = observe(app.declaration);
    const beforeBytes = fs.readFileSync(authored);
    expect(authoredBefore.path.lexical).not.toBe(
      declarationBefore.path.lexical,
    );
    expect(authoredBefore.path.canonical).not.toBe(
      declarationBefore.path.canonical,
    );
    expect(authoredBefore.kind).toBe('file');
    expect(declarationBefore.kind).toBe('file');
    if (authoredBefore.kind !== 'file' || declarationBefore.kind !== 'file')
      throw new Error('The actual hardlink fixture is not a file');
    expect(declarationBefore.metadata.device).toBe(
      authoredBefore.metadata.device,
    );
    expect(declarationBefore.metadata.inode).toBe(
      authoredBefore.metadata.inode,
    );
    const applicationRequire = createRequire(
      path.resolve(
        __dirname,
        '../../../../../tests/integration/routes-tanstack-mf/mf-remote/package.json',
      ),
    );
    const native = applicationRequire('@module-federation/modern-js-v3') as {
      moduleFederationPlugin(
        options: Record<string, unknown>,
      ): CliPlugin<AppTools>;
    };
    const remotes = { remote: 'remote@http://127.0.0.1/remote.js' };
    const result = await integration(app, {
      async setupPlugins(api, receiver) {
        Object.assign(api, {
          getConfig: () => api.getNormalizedConfig(),
          config() {},
          _internalServerPlugins() {},
        });
        const manager = createPluginManager<CLIPluginAPI<AppTools>>();
        manager.addPlugins([
          receiver,
          native.moduleFederationPlugin({
            config: {
              name: 'native-hardlink-host',
              remotes,
              dts: {
                generateTypes: false,
                consumeTypes: { consumeAPITypes: false },
              },
              dev: false,
            },
            ssr: false,
          }),
        ]);
        for (const plugin of manager.getPlugins()) await plugin.setup?.(api);
      },
    });
    let nativeOptions: Record<string, unknown> | undefined;
    const lifecycle: RsbuildPlugin = {
      name: 'test-native-hardlink-declaration-configuration',
      setup(api) {
        api.modifyBundlerChain(async (chain, utils) => {
          expect(chain.plugins.has('plugin-module-federation')).toBe(false);
          for (const modifier of result.chainModifiers)
            await modifier(chain, utils as never);
          nativeOptions = (
            chain.plugin('plugin-module-federation').get('args') as [
              Record<string, unknown>,
            ]
          )[0];
        });
      },
    };
    const rsbuild = await createRsbuild({
      cwd: app.appDirectory,
      rsbuildConfig: {
        mode: 'development',
        plugins: [lifecycle],
        environments: {
          client: {
            source: {
              entry: { main: path.join(app.appDirectory, 'src/main.js') },
            },
            output: { target: 'web' },
          },
        },
        tools: { htmlPlugin: false },
        output: {
          cleanDistPath: false,
          distPath: { root: result.context.distDirectory },
        },
      },
    });
    const bundlerConfigs = await rsbuild.initConfigs();
    expect(nativeOptions?.remotes).toEqual(remotes);
    const phase = bindTestPhase(app, result);
    for (const callback of result.beforeCompiler)
      await callback({ bundlerConfigs } as never);
    const original = phase.reserveGeneratedOutputGeneration();
    expect(original.snapshot.states).toContainEqual(
      expect.objectContaining({ kind: 'file', path: authored }),
    );
    const first = await result
      .registry()
      .begin(seed(nativeOptions!), receiverDetails());
    await completeReceiver(first);
    const registration = result.registry().completedReceipts()[0].registration;
    expect(
      registration.authoredPaths.some(
        input =>
          input.lexical === app.declaration ||
          input.canonical === app.declaration,
      ),
    ).toBe(false);
    expect(
      registration.protectedInputs.some(
        input =>
          input.node.path.lexical === app.declaration ||
          input.node.path.canonical === app.declaration,
      ),
    ).toBe(false);
    const protectedFile = registration.protectedInputs.find(
      input => input.node.path.lexical === authored,
    );
    expect(protectedFile).toMatchObject({
      observation: 'content',
      node: {
        kind: 'file',
        path: authoredBefore.path,
        metadata: {
          device: authoredBefore.metadata.device,
          inode: authoredBefore.metadata.inode,
        },
      },
    });
    await expectWriteRejectedBeforeIO(
      result,
      seed(nativeOptions!),
      app.declaration,
      'operation collides with an observed input',
    );
    expect(phase.currentGeneratedOutputGeneration().snapshot).toBe(
      original.snapshot,
    );
    expect(observe(authored)).toEqual(authoredBefore);
    expect(observe(app.declaration)).toEqual(declarationBefore);
    expect(fs.readFileSync(authored)).toEqual(beforeBytes);
    expect(fs.readFileSync(app.declaration)).toEqual(beforeBytes);
  });

  it.each([
    false,
    true,
  ])('runs the actual native CLI key installer before receiver configuration, tracked declaration=%s', async tracked => {
    const app = fixture();
    if (tracked) {
      execFileSync('git', ['init', '--quiet'], { cwd: app.appDirectory });
      execFileSync('git', ['add', '--', '@mf-types/remote/App.d.ts'], {
        cwd: app.appDirectory,
      });
    }
    const applicationRequire = createRequire(
      path.resolve(
        __dirname,
        '../../../../../tests/integration/routes-tanstack-mf/mf-remote/package.json',
      ),
    );
    const native = applicationRequire('@module-federation/modern-js-v3') as {
      moduleFederationPlugin(
        options: Record<string, unknown>,
      ): CliPlugin<AppTools>;
    };
    const modifierOwners: string[] = [];
    const setupOrder: string[] = [];
    const result = await integration(app, {
      useRealTrackedInputs: tracked,
      async setupPlugins(api, receiver) {
        let currentPlugin = '';
        const modifyBundlerChain = api.modifyBundlerChain;
        Object.assign(api, {
          getConfig: () => api.getNormalizedConfig(),
          config() {},
          _internalServerPlugins() {},
          modifyBundlerChain(callback: ChainModifier) {
            modifierOwners.push(currentPlugin);
            modifyBundlerChain(callback);
          },
        });
        const manager = createPluginManager<CLIPluginAPI<AppTools>>();
        manager.addPlugins([
          receiver,
          native.moduleFederationPlugin({
            config: {
              name: 'native-cli-order',
              remotes: {},
              dts: {
                generateTypes: false,
                consumeTypes: { consumeAPITypes: false },
              },
              dev: false,
            },
            ssr: false,
          }),
        ]);
        for (const plugin of manager.getPlugins()) {
          currentPlugin = plugin.name;
          setupOrder.push(plugin.name);
          await plugin.setup?.(api);
        }
      },
    });
    expect(
      setupOrder.indexOf('@modern-js/plugin-module-federation'),
    ).toBeLessThan(setupOrder.indexOf(result.plugin.name));
    expect(
      modifierOwners.indexOf('@modern-js/plugin-module-federation'),
    ).toBeLessThan(modifierOwners.indexOf(result.plugin.name));
    let nativeOptions: Record<string, unknown> | undefined;
    const transitions: { owner: string; before: boolean; after: boolean }[] =
      [];
    const rsbuild = await createRsbuild({
      cwd: app.appDirectory,
      rsbuildConfig: {
        mode: 'development',
        plugins: [
          {
            name: 'test-real-native-cli-key-installation',
            setup(api: Parameters<RsbuildPlugin['setup']>[0]) {
              api.modifyBundlerChain(async (chain, utils) => {
                expect(chain.plugins.has('plugin-module-federation')).toBe(
                  false,
                );
                for (const [
                  index,
                  modifier,
                ] of result.chainModifiers.entries()) {
                  const before = chain.plugins.has('plugin-module-federation');
                  await modifier(chain, utils as never);
                  transitions.push({
                    owner: modifierOwners[index],
                    before,
                    after: chain.plugins.has('plugin-module-federation'),
                  });
                }
                nativeOptions = (
                  chain.plugin('plugin-module-federation').get('args') as [
                    Record<string, unknown>,
                  ]
                )[0];
              });
            },
          },
        ],
        environments: {
          client: {
            source: {
              entry: { main: path.join(app.appDirectory, 'src/main.js') },
            },
            output: { target: 'web' },
          },
        },
        tools: { htmlPlugin: false },
        output: {
          cleanDistPath: false,
          distPath: { root: result.context.distDirectory },
        },
      },
    });
    const bundlerConfigs = await rsbuild.initConfigs();
    expect(transitions).toContainEqual({
      owner: '@modern-js/plugin-module-federation',
      before: false,
      after: true,
    });
    expect(transitions).toContainEqual({
      owner: result.plugin.name,
      before: true,
      after: true,
    });
    expect(result.loads()).toBe(1);
    expect(nativeOptions?.dts).toMatchObject({
      implementation: app.producerPath,
      generateTypes: false,
      consumeTypes: { consumeAPITypes: false },
    });
    expect(seed(nativeOptions!)).toMatchObject({
      schemaVersion: 1,
      receiverBridge: { schemaVersion: 1 },
    });
    if (tracked) {
      bindTestPhase(app, result);
      for (const callback of result.beforeCompiler)
        await callback({ bundlerConfigs } as never);
      const before = fs.readFileSync(app.declaration);
      await expectWriteRejectedBeforeIO(
        result,
        seed(nativeOptions!),
        app.declaration,
        'authored or tracked input',
      );
      expect(fs.readFileSync(app.declaration)).toEqual(before);
    }
  });

  it('preserves the native worker callback and binds one exact manual witness identity', async () => {
    const app = fixture();
    const result = await integration(app);
    const seen: unknown[] = [];
    const receivers: unknown[] = [];
    const original = function (this: unknown, witness: unknown) {
      seen.push(witness);
      receivers.push(this);
    };
    const options = {
      name: 'native-host',
      dts: { onDevWorkerCreated: original },
    };
    await configureChain(result, options);
    const closed = deferred<void>();
    closes.push(async () => {
      closed.resolve();
    });
    const witness = Object.freeze({ pid: 424242, closed: closed.promise });
    const created = workerCreated(options);
    expect(created).not.toBe(original);
    const nativeOwner = Object.freeze({ name: 'manual-native-worker-owner' });
    Reflect.apply(created, nativeOwner, [witness]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(witness);
    expect(receivers).toEqual([nativeOwner]);
    expect(() => created({ ...witness })).toThrow('worker identity was reused');
    expect(() => created(witness)).toThrow('worker is still live');
    expect(() => created({ pid: 424243, closed: Promise.resolve() })).toThrow(
      'worker is still live',
    );
    expect(seen).toEqual([witness]);
    closed.resolve();
    await closed.promise;
    expect(() => created(witness)).toThrow('witness was already retired');
  });

  it.each([
    true,
    'invalid-native-hook',
    {},
  ])('rejects a malformed native worker callback: %s', async onDevWorkerCreated => {
    const app = fixture();
    const result = await integration(app);
    const options = { dts: { onDevWorkerCreated } };
    await expect(configureChain(result, options)).rejects.toThrow(
      'worker lifecycle hook must be a function',
    );
    expect(result.producerReads()).toBe(0);
    expect(fs.readFileSync(app.declaration, 'utf8')).toContain('string');
  });

  it('rejects malformed manual worker witnesses before invoking the authored hook', async () => {
    const app = fixture();
    const result = await integration(app);
    const seen: unknown[] = [];
    const options = {
      dts: {
        onDevWorkerCreated: (value: unknown) => {
          seen.push(value);
        },
      },
    };
    await configureChain(result, options);
    const created = workerCreated(options);
    const invalidThenable = Object.fromEntries([['then', () => {}]]);
    for (const invalid of [
      undefined,
      null,
      'invalid-worker',
      { pid: 0, closed: Promise.resolve() },
      { pid: 1.5, closed: Promise.resolve() },
      { pid: Number.NaN, closed: Promise.resolve() },
      { pid: Number.MAX_SAFE_INTEGER + 1, closed: Promise.resolve() },
      { pid: 424242 },
      { pid: 424242, closed: invalidThenable },
    ])
      expect(() => created(invalid)).toThrow();
    expect(seen).toEqual([]);
    const valid = Object.freeze({ pid: 424242, closed: Promise.resolve() });
    created(valid);
    expect(seen).toEqual([valid]);
  });

  it('keeps a manual worker accounted for shutdown when the authored callback throws', async () => {
    const app = fixture();
    const result = await integration(app);
    const failure = new Error('Controlled authored worker callback failure');
    const options = {
      dts: {
        onDevWorkerCreated() {
          throw failure;
        },
      },
    };
    await configureChain(result, options);
    const closed = deferred<void>();
    closes.push(async () => {
      closed.resolve();
    });
    const witness = Object.freeze({ pid: 424242, closed: closed.promise });
    expect(() => workerCreated(options)(witness)).toThrow(failure);
    const publicCloseReached = deferred<void>();
    result.testCompilers.get('client')!.close = callback => {
      publicCloseReached.resolve();
      callback();
    };
    let exited = false;
    const exit = result.close().then(() => {
      exited = true;
    });
    await publicCloseReached.promise;
    expect(exited).toBe(false);
    expect(result.restoreCalls()).toBe(0);
    closed.resolve();
    await exit;
    expect(exited).toBe(true);
    expect(result.restoreCalls()).toBe(1);
  });

  it('rejects a worker callback before the native compiler graph is enrolled', async () => {
    const app = fixture();
    const result = await integration(app);
    const seen: unknown[] = [];
    const options = {
      dts: {
        onDevWorkerCreated: (value: unknown) => {
          seen.push(value);
        },
      },
    };
    await configureChain(result, options, true, true);
    expect(() =>
      workerCreated(options)({ pid: 424242, closed: Promise.resolve() }),
    ).toThrow('before graph enrollment');
    expect(seen).toEqual([]);
    expect(result.producerPreflights()).toBe(0);
  });

  it.each([
    true,
    false,
  ])('requires the exact manual worker close witness for a quarantined TCP frame, matched=%s', async matched => {
    const app = fixture();
    const result = await integration(app);
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    bindTestPhase(app, result);
    const closed = deferred<void>();
    closes.push(async () => {
      closed.resolve();
    });
    workerCreated(options)(
      Object.freeze({ pid: 424242, closed: closed.promise }),
    );
    const bridge = seed(options).receiverBridge!;
    const beginId = randomBytes(16).toString('hex');
    const response = await postBridge(bridge, {
      action: 'begin',
      beginId,
      seed: seed(options),
      details: {
        ...receiverDetails(),
        receiverProcessId: matched ? 424242 : 424243,
      },
    });
    expect(response.status).toBe(200);
    const frame = (response.value as { frame: ReceiverFrame }).frame;
    let terminalRequired = true;
    closes.push(async () => {
      if (terminalRequired)
        await postBridge(bridge, bridgeTerminal(beginId, frame, true)).catch(
          () => {},
        );
    });
    expect(result.registry().receiverProcessId(frame)).toBe(
      matched ? 424242 : 424243,
    );
    const compiler = result.testCompilers.get('client')!;
    const publicCloseReached = deferred<void>();
    compiler.close = callback => {
      publicCloseReached.resolve();
      callback();
    };
    let exited = false;
    const exit = result.close().then(() => {
      exited = true;
    });
    await publicCloseReached.promise;
    expect(result.registry().quarantinedFrames('bridge')).toEqual([frame]);
    expect(result.restoreCalls()).toBe(0);
    expect(exited).toBe(false);
    closed.resolve();
    await closed.promise;
    if (!matched) {
      expect(result.registry().quarantinedFrames('bridge')).toEqual([frame]);
      expect(result.restoreCalls()).toBe(0);
      expect(exited).toBe(false);
      expect(() => result.registry().confirmReceiverTerminated(frame)).toThrow(
        'termination is unproven',
      );
      const terminal = await postBridge(
        bridge,
        bridgeTerminal(beginId, frame, true),
      ).then(
        response => ({ response }),
        error => ({ error }),
      );
      if ('response' in terminal) expect(terminal.response.status).toBe(400);
      else
        expect(terminal.error).toMatchObject({
          code: 'ECONNRESET',
          message: 'socket hang up',
        });
    }
    await exit;
    terminalRequired = false;
    expect(exited).toBe(true);
    expect(result.restoreCalls()).toBe(1);
  });

  it('closes the actual public native compiler before retiring quarantined live watch work', async () => {
    const app = fixture();
    const result = await integration(app);
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options, true, true);
    const phase = bindTestPhase(app, result);
    const watchRunEntered = deferred<void>();
    let client: Rspack.Compiler | undefined;
    const lifecycle: RsbuildPlugin = {
      name: 'test-receiver-public-native-shutdown',
      setup(api) {
        phase.install(api);
        api.modifyBundlerChain((chain, { environment }) => {
          installFixtureCompilerPlugins(chain, result, environment.name);
        });
        api.onBeforeCreateCompiler(async params => {
          for (const callback of result.beforeCompiler)
            await callback(params as never);
        });
        api.onAfterCreateCompiler(async params => {
          for (const callback of result.afterCompiler)
            await callback(params as never);
          const compilers =
            'compilers' in params.compiler
              ? params.compiler.compilers
              : [params.compiler];
          client = compilers.find(
            candidate => candidate.options.name === 'client',
          );
          if (!client)
            throw new Error('The actual native client compiler is absent');
          client.hooks.watchRun.tap(
            { name: 'test-quarantined-native-watch', stage: -1000 },
            () => watchRunEntered.resolve(),
          );
        });
      },
    };
    const rsbuild = await createRsbuild({
      cwd: app.appDirectory,
      rsbuildConfig: {
        mode: 'development',
        plugins: [lifecycle],
        environments: {
          client: {
            source: {
              entry: { main: path.join(app.appDirectory, 'src/main.js') },
            },
            output: { target: 'web' },
          },
        },
        tools: { htmlPlugin: false },
        output: {
          cleanDistPath: false,
          distPath: { root: result.context.distDirectory },
        },
        performance: { printFileSize: false },
      },
    });
    const nativeCompiler = await rsbuild.createCompiler();
    if (!client)
      throw new Error('The actual native compiler owner was not applied');
    const owner = client;
    const nativeClose = owner.close;
    const publicCloseEntered = deferred<void>();
    const nativeCloseCompleted = deferred<void>();
    const allowCloseCallback = deferred<void>();
    const closeCallbackForwarded = deferred<void>();
    let closeCalls = 0;
    let publicCloseInProgress = false;
    owner.close = callback => {
      if (publicCloseInProgress)
        return Reflect.apply(nativeClose, owner, [callback]);
      publicCloseInProgress = true;
      closeCalls++;
      publicCloseEntered.resolve();
      Reflect.apply(nativeClose, owner, [
        (error?: Error) => {
          nativeCloseCompleted.resolve();
          void allowCloseCallback.promise.then(() => {
            callback(error);
            closeCallbackForwarded.resolve();
          });
        },
      ]);
    };
    closes.push(async () => {
      allowCloseCallback.resolve();
      await result.close();
      owner.close = nativeClose;
      await new Promise<void>((resolve, reject) =>
        nativeCompiler.close(error => (error ? reject(error) : resolve())),
      );
    });
    const receiver = await result
      .registry()
      .begin(seed(options), receiverDetails());
    closes.push(() => settleClosedReceiver(receiver));
    let drained = false;
    const registryDrain = result
      .registry()
      .waitForSettled()
      .then(() => {
        drained = true;
      });
    const idle = result.controller.waitForIdle().then(
      () => undefined,
      error => error,
    );
    const pin = result.controller.pinReceipts().then(
      () => undefined,
      error => error,
    );
    owner.watch({}, () => {});
    await watchRunEntered.promise;
    expect(owner.watching).toBeDefined();
    expect(drained).toBe(false);
    let exited = false;
    const exit = result.close().then(() => {
      exited = true;
    });
    await publicCloseEntered.promise;
    await nativeCloseCompleted.promise;
    expect(await idle).toMatchObject({
      message: 'React receiver compiler is exiting',
    });
    expect(await pin).toMatchObject({
      message: 'React receiver compiler is exiting',
    });
    expect(closeCalls).toBe(1);
    expect(exited).toBe(false);
    expect(result.registry().quarantinedFrames()).toEqual([receiver.frame]);
    expect(result.restoreCalls()).toBe(0);
    expect(drained).toBe(false);
    allowCloseCallback.resolve();
    await closeCallbackForwarded.promise;
    expect(result.registry().quarantinedFrames('direct')).toEqual([
      receiver.frame,
    ]);
    expect(result.restoreCalls()).toBe(0);
    expect(drained).toBe(false);
    await settleClosedReceiver(receiver);
    await exit;
    await registryDrain;
    expect(drained).toBe(true);
    expect(result.restoreCalls()).toBe(1);
  });

  it('retains receiver quarantine and implementation ownership when public close fails', async () => {
    const app = fixture();
    const result = await integration(app);
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    bindTestPhase(app, result);
    const compiler = result.testCompilers.get('client')!;
    let closeSucceeds = false;
    let closeCalls = 0;
    compiler.close = callback => {
      closeCalls++;
      callback(
        closeSucceeds
          ? undefined
          : new Error('Controlled native close failure'),
      );
    };
    closes.push(async () => {
      closeSucceeds = true;
      await result.close();
    });
    const receiver = await result
      .registry()
      .begin(seed(options), receiverDetails());
    closes.push(() => settleClosedReceiver(receiver));
    let drained = false;
    const registryDrain = result
      .registry()
      .waitForSettled()
      .then(() => {
        drained = true;
      });
    await expect(result.close()).rejects.toThrow(
      'React receiver shutdown failed',
    );
    expect(closeCalls).toBe(1);
    expect(result.registry().quarantinedFrames()).toEqual([receiver.frame]);
    expect(result.restoreCalls()).toBe(0);
    expect(drained).toBe(false);
    await expect(result.controller.waitForIdle()).rejects.toThrow('closed');
    closeSucceeds = true;
    const successfulExit = result.close();
    expect(result.registry().quarantinedFrames('direct')).toEqual([
      receiver.frame,
    ]);
    expect(result.restoreCalls()).toBe(0);
    await settleClosedReceiver(receiver);
    await successfulExit;
    await registryDrain;
    expect(closeCalls).toBe(2);
    expect(result.restoreCalls()).toBe(1);
    expect(drained).toBe(true);
  });

  it.each([
    'entry source',
    'static asset',
    'filesystem alias',
  ] as const)('rejects a destructive operation covering non-Git authored files before IO: %s', async sourceKind => {
    const app = fixture();
    let directory: string;
    let sourceOverrides: Record<string, unknown> = {};
    if (sourceKind === 'entry source')
      directory = path.join(app.appDirectory, 'src');
    else if (sourceKind === 'static asset') {
      directory = path.join(app.appDirectory, 'config/public');
      fs.mkdirSync(directory, { recursive: true });
    } else {
      directory = path.join(app.appDirectory, 'physical-authored-alias');
      fs.mkdirSync(directory);
      fs.symlinkSync(
        directory,
        path.join(app.appDirectory, 'authored-alias'),
        'dir',
      );
      sourceOverrides = { alias: { '@authored': './authored-alias' } };
    }
    const authored = path.join(directory, 'authored.txt');
    fs.writeFileSync(authored, `Original ${sourceKind} bytes\n`);
    const before = fs.readFileSync(authored);
    const beforeAuthored = observe(authored);
    const beforeDirectory = observe(directory);
    const alias = path.join(app.appDirectory, 'authored-alias');
    const beforeAlias =
      sourceKind === 'filesystem alias'
        ? {
            metadata: fs.lstatSync(alias, { bigint: true }),
            target: fs.readlinkSync(alias),
          }
        : undefined;
    const result = await integration(app, {
      destinations: [directory],
      destructiveDirectories: [directory],
      sourceOverrides,
    });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    bindTestPhase(app, result);
    expect(fs.existsSync(path.join(app.appDirectory, '.git'))).toBe(false);
    await destructiveDirectoryRejectedBeforeIO(
      result,
      seed(options),
      directory,
    );
    expect(fs.readFileSync(authored)).toEqual(before);
    expect(observe(authored)).toEqual(beforeAuthored);
    expect(observe(directory)).toEqual(beforeDirectory);
    if (beforeAlias) {
      expect(fs.lstatSync(alias, { bigint: true })).toEqual(
        beforeAlias.metadata,
      );
      expect(fs.readlinkSync(alias)).toBe(beforeAlias.target);
    }
    expect(fs.readFileSync(app.declaration, 'utf8')).toContain('string');
  });

  it('rejects an exact non-entry source file captured by the original reservation', async () => {
    const app = fixture();
    const authored = path.join(app.appDirectory, 'src/not-imported.ts');
    fs.writeFileSync(authored, 'export const authored = "unreferenced";\n');
    const before = fs.readFileSync(authored);
    const result = await integration(app, { destinations: [authored] });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    bindTestPhase(app, result);
    await expectWriteRejectedBeforeIO(result, seed(options), authored);
    expect(fs.readFileSync(authored)).toEqual(before);
  });

  it('rejects an unknown source path added after the original reservation before native IO', async () => {
    const app = fixture();
    const authored = path.join(
      app.appDirectory,
      'src/added-after-reservation.ts',
    );
    const result = await integration(app, { destinations: [authored] });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    const phase = bindTestPhase(app, result);
    const original = phase.reserveGeneratedOutputGeneration();
    fs.writeFileSync(authored, 'export const authored = "added later";\n');
    const before = fs.readFileSync(authored);
    await expectWriteRejectedBeforeIO(result, seed(options), authored);
    expect(phase.currentGeneratedOutputGeneration().snapshot).toBe(
      original.snapshot,
    );
    expect(fs.readFileSync(authored)).toEqual(before);
  });

  it.each([
    undefined,
    true,
  ])('registers a stable worker authority and preserves native options, dts=%s', async dts => {
    const app = fixture();
    const result = await integration(app);
    const remotes = { remote: 'remote@http://127.0.0.1/remote.js' };
    const shared = { react: { singleton: true } };
    const options = { name: 'native-host', remotes, shared, dts };
    const args = await configureChain(result, options);
    const effective = args[0] as Record<string, unknown>;
    expect(args).toEqual([effective, 'retained-native-argument']);
    expect(effective).not.toBe(options);
    expect(effective.remotes).toBe(remotes);
    expect(effective.shared).toBe(shared);
    expect(options.remotes).toBe(remotes);
    expect(options.shared).toBe(shared);
    expect(options.dts).toBe(dts);
    expect(effective.dts).toMatchObject({ implementation: app.producerPath });
    expect(seed(options)).toMatchObject({
      schemaVersion: 1,
      generation: 1,
      receiverBridge: { schemaVersion: 1 },
    });
    expect(Object.isFrozen(seed(options))).toBe(true);
    expect(result.loads()).toBe(1);
    await result.close();
    expect(result.restoreCalls()).toBe(1);
  });

  it('preserves native DTS and extra options when selecting the receiver', async () => {
    const app = fixture();
    const result = await integration(app);
    const retained = { selected: 'native-extra-option' };
    const options = {
      name: 'native-host',
      dts: {
        generateTypes: { compileInChildProcess: false },
        consumeTypes: { typesFolder: 'native-types', abortOnError: true },
        extraOptions: { retained },
      },
    };
    const originalDts = options.dts;
    const originalExtraOptions = options.dts.extraOptions;
    const args = await configureChain(result, options);
    const effective = args[0] as {
      dts: Record<string, unknown> & { extraOptions: Record<string, unknown> };
    };
    expect(effective.dts).not.toBe(originalDts);
    expect(effective.dts.extraOptions).not.toBe(originalExtraOptions);
    expect(effective.dts).toMatchObject({
      generateTypes: { compileInChildProcess: false },
      consumeTypes: { typesFolder: 'native-types', abortOnError: true },
      implementation: app.producerPath,
    });
    expect(effective.dts.extraOptions.retained).toBe(retained);
    expect(options.dts).toBe(originalDts);
    expect(options.dts.extraOptions).toBe(originalExtraOptions);
    expect(options.dts.extraOptions.retained).toBe(retained);
    expect(Object.hasOwn(options.dts, 'implementation')).toBe(false);
    expect(Object.hasOwn(options.dts.extraOptions, AUTHORITY_KEY)).toBe(false);
    expect(seed(options).receiverBridge?.url).toMatch(
      /^http:\/\/127\.0\.0\.1:/u,
    );
  });

  it.each([
    { dts: false },
    { dts: { consumeTypes: false } },
  ])('keeps disabled native receivers inactive: %s', async options => {
    const app = fixture();
    const result = await integration(app);
    const before = JSON.stringify(options);
    await configureChain(result, options);
    expect(JSON.stringify(options)).toBe(before);
    expect(result.loads()).toBe(0);
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    result.controller.bindGeneration?.(
      phase.currentGeneratedOutputGeneration(),
    );
    const lease = await result.controller.pinReceipts();
    await lease.assertCurrent();
    expect(lease.receipts).toHaveLength(0);
    expect(lease.permission(app.declaration)).toBeUndefined();
    lease.release();
  });

  it('keeps ordinary React compilers active without loading optional MF code', async () => {
    const app = fixture();
    const result = await integration(app);
    await configureChain(result, {}, false);
    expect(result.loads()).toBe(0);
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    result.controller.bindGeneration?.(
      phase.currentGeneratedOutputGeneration(),
    );
    await result.controller.waitForIdle();
    const lease = await result.controller.pinReceipts();
    await lease.assertCurrent();
    expect(lease.receipts).toHaveLength(0);
    lease.release();
  });

  it('rejects a custom native implementation before any receiver begins', async () => {
    const app = fixture();
    const result = await integration(app);
    const options = {
      dts: { implementation: '/authored/custom-receiver.cjs' },
    };
    await expect(configureChain(result, options)).rejects.toThrow(
      'cannot audit a custom native DTS implementation',
    );
    expect(options.dts.implementation).toBe('/authored/custom-receiver.cjs');
    expect(result.producerReads()).toBe(0);
    expect(fs.readFileSync(app.declaration, 'utf8')).toContain('string');
  });

  it.each([
    'generation',
    'operationId',
    'revision',
  ] as const)('rejects a modified configured worker authority before IO: %s', async field => {
    const app = fixture();
    const result = await integration(app);
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    const configured = seed(options);
    const changed = {
      ...configured,
      [field]: field === 'generation' ? configured.generation + 1 : 'changed',
    };
    await expect(
      result.registry().begin(changed, receiverDetails()),
    ).rejects.toThrow();
    expect(result.producerReads()).toBe(0);
    expect(fs.readFileSync(app.declaration, 'utf8')).toContain('string');
  });

  it('binds constructor-time receiver IO to the explicit initial generation', async () => {
    const app = fixture();
    const result = await integration(app);
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    const receiver = await result
      .registry()
      .begin(seed(options), receiverDetails());
    const beforeIO = phase.currentGeneratedOutputGeneration();
    expect(receiver.frame.generation).toBe(1);
    const acknowledgement = writeReceiver(receiver, app.declaration);
    await completeReceiver(receiver, acknowledgement);
    result.controller.bindGeneration?.(
      phase.currentGeneratedOutputGeneration(),
    );
    expect(phase.currentGeneratedOutputGeneration().snapshot).toBe(
      beforeIO.snapshot,
    );
    const lease = await result.controller.pinReceipts();
    await lease.assertCurrent();
    expect(lease.receipts).toHaveLength(1);
    expect(lease.permission(app.declaration)).toMatchObject({
      kind: 'file',
      byteDigest: digest('export declare const App: number;\n'),
    });
    lease.release();
  });

  it('checks the pinned epoch without rescanning files and still validates final bytes', async () => {
    const app = fixture();
    const result = await integration(app);
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    const receiver = await result
      .registry()
      .begin(seed(options), receiverDetails());
    await completeReceiver(receiver, writeReceiver(receiver, app.declaration));
    result.controller.bindGeneration?.(
      phase.currentGeneratedOutputGeneration(),
    );
    const lease = await result.controller.pinReceipts();
    const reads = result.observationReads();
    for (let index = 0; index < 100; index++) lease.assertEpochCurrent();
    expect(result.observationReads()).toBe(reads);
    const originalSnapshot = result.context.configurationSourceSnapshot;
    result.context.configurationSourceSnapshot = { ...originalSnapshot };
    expect(() => lease.assertEpochCurrent()).toThrow('provenance has changed');
    result.context.configurationSourceSnapshot = originalSnapshot;
    fs.writeFileSync(app.declaration, 'changed after the input read\n');
    lease.assertEpochCurrent();
    expect(result.observationReads()).toBe(reads);
    await expect(lease.assertCurrent()).rejects.toThrow('changed');
    lease.release();
    expect(() => lease.assertEpochCurrent()).toThrow('released or stale');
  });

  it('accepts the original native package metadata capture before initial preparation and protects its manifest', async () => {
    const app = fixture();
    const captured = await captureNativeConfiguration(app.appDirectory);
    const manifest = path.join(app.appDirectory, 'package.json');
    const originalManifest = observe(manifest);
    const originalBytes = fs.readFileSync(manifest);
    const result = await integration(app, {
      capturedConfiguration: captured,
      destinations: [app.declaration, manifest],
    });
    expect(result.context.consumedSourceInputs).toBe(captured.observed);
    expect(result.context.configurationSourceSnapshot).toBe(captured.snapshot);
    expect(result.context.configurationSourceNodes).toBe(captured.nodes);
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    const phase = bindTestPhase(app, result);
    const initial = phase.currentGeneratedOutputGeneration();
    const receiver = await result
      .registry()
      .begin(seed(options), receiverDetails());
    expect(receiver.frame.generation).toBe(1);
    await completeReceiver(receiver);
    result.controller.bindGeneration?.(initial);
    expect(phase.currentGeneratedOutputGeneration()).toBe(initial);
    const lease = await result.controller.pinReceipts();
    await lease.assertCurrent();
    expect(lease.receipts).toHaveLength(1);
    expect(lease.permission(manifest)).toBeUndefined();
    lease.release();
    await expectWriteRejectedBeforeIO(
      result,
      seed(options),
      manifest,
      'operation collides with an observed input',
    );
    expect(observe(manifest)).toEqual(originalManifest);
    expect(fs.readFileSync(manifest)).toEqual(originalBytes);
  });

  it.each([
    'changed',
    'swapped',
    'missing',
  ] as const)('rejects a %s native package metadata companion before receiver IO', async malformedKind => {
    const app = fixture();
    const captured = await captureNativeConfiguration(app.appDirectory);
    const metadataIndex = captured.observed.observations.length;
    const nodes = [...captured.nodes];
    const metadata = nodes[metadataIndex];
    if (!metadata || !nodes[0] || metadataIndex === 0)
      throw new Error(
        'The real native capture has no ordinary and metadata companions',
      );
    if (malformedKind === 'missing') nodes.splice(metadataIndex, 1);
    else if (malformedKind === 'swapped')
      [nodes[0], nodes[metadataIndex]] = [metadata, nodes[0]];
    else
      nodes[metadataIndex] = Object.freeze({
        ...metadata,
        observation: Object.freeze({
          ...metadata.observation,
          operation: 'content' as const,
        }),
      });
    // A distinct negative owner permits retention of the malformed array;
    // all original records and the pre-load snapshot remain untouched.
    const malformed: NativeConfigurationCapture = {
      ...captured,
      observed: Object.freeze({ ...captured.observed }),
      nodes: Object.freeze(nodes),
    };
    const result = await integration(app, { capturedConfiguration: malformed });
    expect(result.context.consumedSourceInputs).toBe(malformed.observed);
    expect(result.context.configurationSourceSnapshot).toBe(captured.snapshot);
    expect(result.context.configurationSourceNodes).toBe(malformed.nodes);
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    bindTestPhase(app, result);
    const before = observe(app.declaration);
    await expect(
      result.registry().begin(seed(options), receiverDetails()),
    ).rejects.toThrow('configuration provenance has changed');
    expect(observe(app.declaration)).toEqual(before);
    expect(fs.readFileSync(app.declaration, 'utf8')).toContain('string');
  });

  it('keeps initial enrollment unchanged and waits for a pending receiver before public rebuild preparation', async () => {
    const app = fixture();
    let gate: ReturnType<typeof deferred<void>> | undefined;
    let idleEntered: ReturnType<typeof deferred<void>> | undefined;
    const producerEntered = deferred<void>();
    const result = await integration(app, {
      producerGate() {
        if (gate) producerEntered.resolve();
        return gate?.promise;
      },
    });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options, true, true);
    const bindings: ReactGeneratedOutputGeneration[] = [];
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      generatedOutputs: {
        ...result.controller,
        waitForIdle() {
          idleEntered?.resolve();
          return result.controller.waitForIdle();
        },
        bindGeneration(value) {
          bindings.push(value);
          result.controller.bindGeneration?.(value);
        },
      },
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    const compiler = await publicPhaseHooks(app, result, phase);
    const initial = phase.currentGeneratedOutputGeneration();
    const enrollment = result.registry().pinReceipts([]);
    result.controller.bindGeneration?.(initial);
    enrollment.assertCurrent([]);
    enrollment.release();
    const receiver = await result
      .registry()
      .begin(seed(options), receiverDetails());
    expect(receiver.frame.generation).toBe(1);
    await completeReceiver(receiver, writeReceiver(receiver, app.declaration));
    const oldLease = await result.controller.pinReceipts();
    closes.push(async () => oldLease.release());
    await oldLease.assertCurrent();
    expect(oldLease.receipts).toHaveLength(1);
    await compiler.hooks.beforeRun.promise(compiler);
    expect(bindings).toEqual([initial]);
    expect(bindings[0]).toBe(initial);
    await oldLease.assertCurrent();
    await compiler.hooks.watchRun.promise(compiler);
    expect(phase.currentGeneratedOutputGeneration()).toBe(initial);
    await oldLease.assertCurrent();
    const compileError = new Error('Public hook test retires the initial wave');
    compiler.hooks.failed.call(compileError);
    await expect(phase.resolveIdentities()).rejects.toBe(compileError);
    await compiler.hooks.watchRun.promise(compiler);
    const rebuild = phase.currentGeneratedOutputGeneration();
    expect(rebuild.generation).toBe(2);
    expect(rebuild.snapshot).not.toBe(initial.snapshot);
    expect(bindings).toEqual([initial, rebuild]);
    await expect(oldLease.assertCurrent()).rejects.toThrow();
    expect(() => result.controller.bindGeneration?.(initial)).toThrow(
      'reservation is no longer active',
    );

    compiler.hooks.failed.call(
      new Error('Public hook test retires the rebuild'),
    );
    gate = deferred<void>();
    const nextBegin = result.registry().begin(seed(options), receiverDetails());
    let nextCompleted = false;
    closes.push(async () => {
      gate?.resolve();
      const accepted = await nextBegin.catch(() => undefined);
      if (accepted && !nextCompleted) await completeReceiver(accepted);
    });
    await producerEntered.promise;
    const pendingReservation = phase.currentGeneratedOutputGeneration();
    idleEntered = deferred<void>();
    let prepared = false;
    const pending = compiler.hooks.watchRun.promise(compiler).then(() => {
      prepared = true;
    });
    await idleEntered.promise;
    expect(prepared).toBe(false);
    gate.resolve();
    const nextReceiver = await nextBegin;
    expect(nextReceiver.frame.generation).toBe(3);
    expect(prepared).toBe(false);
    await completeReceiver(nextReceiver);
    nextCompleted = true;
    await pending;
    expect(phase.currentGeneratedOutputGeneration().generation).toBe(3);
    expect(bindings[2]).toBe(pendingReservation);
    expect(phase.currentGeneratedOutputGeneration().snapshot).toBe(
      pendingReservation.snapshot,
    );
  });

  it('preserves an early BEGIN failure through first and duplicate public initial hooks', async () => {
    const app = fixture();
    const result = await integration(app);
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options, true, true);
    const bindings: ReactGeneratedOutputGeneration[] = [];
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      generatedOutputs: {
        ...result.controller,
        bindGeneration(value) {
          bindings.push(value);
          result.controller.bindGeneration?.(value);
        },
      },
      finalize: async () => identities(),
    });
    const compiler = await publicPhaseHooks(app, result, phase);
    const failure = await result
      .registry()
      .begin(seed(options), receiverDetails())
      .catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('before its native phase was bound');
    result.controller.bindPhase(phase, result.context);
    const initial = phase.currentGeneratedOutputGeneration();
    await expect(compiler.hooks.beforeRun.promise(compiler)).rejects.toBe(
      failure,
    );
    await expect(compiler.hooks.watchRun.promise(compiler)).rejects.toBe(
      failure,
    );
    expect(bindings).toEqual([initial, initial]);
    expect(bindings[0]).toBe(initial);
    expect(bindings[1]).toBe(initial);
    expect(phase.currentGeneratedOutputGeneration()).toBe(initial);
    await expect(result.controller.pinReceipts()).rejects.toBe(failure);
    expect(fs.readFileSync(app.declaration, 'utf8')).toContain('string');
  });

  it('coalesces simultaneous BEGIN calls into the same pre-write generation', async () => {
    const app = fixture();
    const producerGate = deferred<void>();
    const result = await integration(app, {
      producerGate: producerGate.promise,
    });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    const receivers = [
      result.registry().begin(seed(options), receiverDetails()),
      result.registry().begin(seed(options), receiverDetails()),
    ];
    await result.producerEntered;
    const beforeIO = phase.currentGeneratedOutputGeneration();
    producerGate.resolve();
    const first = await receivers[0];
    let secondAdmitted = false;
    void receivers[1].then(() => {
      secondAdmitted = true;
    });
    await Promise.resolve();
    expect(secondAdmitted).toBe(false);
    await completeReceiver(first);
    const second = await receivers[1];
    expect(first.frame.generation).toBe(1);
    expect(second.frame.generation).toBe(1);
    expect(first.frame.frameId).not.toBe(second.frame.frameId);
    expect(first.frame.operationId).toBe(second.frame.operationId);
    expect(first.frame.revision).toBe(second.frame.revision);
    await completeReceiver(second);
    result.controller.bindGeneration?.(
      phase.currentGeneratedOutputGeneration(),
    );
    expect(phase.currentGeneratedOutputGeneration().snapshot).toBe(
      beforeIO.snapshot,
    );
    const lease = await result.controller.pinReceipts();
    await lease.assertCurrent();
    expect(lease.receipts).toHaveLength(2);
    lease.release();
  });

  it('keeps the untouched alias and selects the latest rewritten exact node in one generation', async () => {
    const app = fixture();
    const untouched = path.join(
      app.appDirectory,
      '@mf-types/untouched/App.d.ts',
    );
    fs.mkdirSync(path.dirname(untouched));
    fs.writeFileSync(untouched, 'export declare const Stable: string;\n');
    const result = await integration(app, {
      destinations: [app.declaration, untouched],
    });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    const first = await result
      .registry()
      .begin(seed(options), receiverDetails());
    const written = writeReceiver(first, app.declaration);
    const stable = writeReceiver(
      first,
      untouched,
      'export declare const Stable: number;\n',
    );
    await completeReceiver(first, written, stable);
    result.controller.bindGeneration?.(
      phase.currentGeneratedOutputGeneration(),
    );
    const firstLease = await result.controller.pinReceipts();
    await firstLease.assertCurrent();
    const second = await result
      .registry()
      .begin(seed(options), receiverDetails());
    expect(second.frame.generation).toBe(first.frame.generation);
    await expect(firstLease.assertCurrent()).rejects.toThrow();
    const rewritten = writeReceiver(
      second,
      app.declaration,
      'export declare const App: boolean;\n',
    );
    await completeReceiver(second, rewritten);
    const lease = await result.controller.pinReceipts();
    await lease.assertCurrent();
    expect(lease.receipts).toHaveLength(2);
    expect(lease.permission(untouched)).toEqual(stable.after);
    expect(lease.permission(app.declaration)).toEqual(rewritten.after);
    expect(
      lease.permission(path.join(app.appDirectory, '@mf-types/unacknowledged')),
    ).toBeUndefined();
    firstLease.release();
    lease.release();
  });

  it.each([
    'content',
    'metadata',
    'directory',
  ] as const)('rejects a changed original configuration read after an awaited helper before output IO: %s', async operation => {
    const app = fixture();
    const configurationInput = path.join(
      app.appDirectory,
      operation === 'directory' ? 'selection' : 'selection.json',
    );
    if (operation === 'directory') fs.mkdirSync(configurationInput);
    else fs.writeFileSync(configurationInput, '{"selected":"original"}\n');
    const producerGate = deferred<void>();
    const result = await integration(app, {
      producerGate: producerGate.promise,
      configurationInput,
      configurationOperation: operation,
    });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    const receiver = result.registry().begin(seed(options), receiverDetails());
    await result.producerEntered;
    if (operation === 'directory')
      fs.writeFileSync(path.join(configurationInput, 'added.json'), '{}\n');
    else if (operation === 'metadata') fs.chmodSync(configurationInput, 0o400);
    else fs.writeFileSync(configurationInput, '{"selected":"changed"}\n');
    producerGate.resolve();
    await expect(receiver).rejects.toThrow(
      'React receiver configuration input changed',
    );
    expect(fs.readFileSync(app.declaration, 'utf8')).toBe(
      'export declare const App: string;\n',
    );
    await result.controller.waitForIdle();
    await expect(result.controller.pinReceipts()).rejects.toThrow();
  });

  it('accepts the captured configuration alias and rejects its retarget before native IO', async () => {
    const app = fixture();
    const first = path.join(app.appDirectory, 'first-input');
    const second = path.join(app.appDirectory, 'second-input');
    const link = path.join(app.appDirectory, 'selected-input');
    for (const directory of [first, second]) {
      fs.mkdirSync(directory);
      fs.writeFileSync(
        path.join(directory, 'selection.json'),
        '{"selected":true}\n',
      );
    }
    fs.symlinkSync(first, link, 'dir');
    const result = await integration(app, {
      configurationInput: path.join(link, 'selection.json'),
    });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options);
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      finalize: async () => identities(),
    });
    result.controller.bindPhase(phase, result.context);
    const accepted = await result
      .registry()
      .begin(seed(options), receiverDetails());
    await completeReceiver(accepted);
    fs.unlinkSync(link);
    fs.symlinkSync(second, link, 'dir');
    await expect(
      result.registry().begin(seed(options), receiverDetails()),
    ).rejects.toThrow();
    expect(fs.readFileSync(app.declaration, 'utf8')).toBe(
      'export declare const App: string;\n',
    );
  });

  it('schedules the actual native watch and reuses its pre-write reservation after receiver completion', async () => {
    const app = fixture();
    const producerGate = deferred<void>();
    let producerGateArmed = false;
    const result = await integration(app, {
      producerGate: () =>
        producerGateArmed ? producerGate.promise : undefined,
    });
    const options: Record<string, unknown> = { name: 'native-host', dts: true };
    await configureChain(result, options, true, true);
    const generations: ReactGeneratedOutputGeneration[] = [];
    const leases: Parameters<
      NonNullable<
        ConstructorParameters<typeof ReactTypedCssPhase>[0]['finalize']
      >
    >[1][] = [];
    const published: number[] = [];
    let finalizations = 0;
    let initialReceiver: ReceiverContext | undefined;
    let initialReceiptCompleted = false;
    let initialProcessAssetsRuns = 0;
    let client: Rspack.Compiler | undefined;
    let htmlFilename = '';
    let gateNextFinalWrite = false;
    let releaseOutputWrite: (() => void) | undefined;
    let outputWriteEntered = deferred<void>();
    const secondWatchEntered = deferred<void>();
    let watchRuns = 0;
    const observedController = {
      ...result.controller,
      bindGeneration(value: ReactGeneratedOutputGeneration) {
        generations.push(value);
        result.controller.bindGeneration?.(value);
      },
    };
    const phase = new ReactTypedCssPhase({
      appDirectory: app.appDirectory,
      internalDirectory: result.context.internalDirectory,
      distDirectory: result.context.distDirectory,
      produceTypedCss: false,
      generatedOutputs: observedController,
      async finalize(_stats, lease) {
        finalizations++;
        leases.push(lease);
        await lease?.assertCurrent();
        return identities();
      },
      async publishDevelopment(_stats, _identities, assertCurrent) {
        assertCurrent();
        published.push(phase.currentGeneratedOutputGeneration().generation);
      },
    });
    result.controller.bindPhase(phase, result.context);
    closes.push(async () => {
      if (initialReceiver && !initialReceiptCompleted)
        await initialReceiver
          .terminal({
            status: 'failed',
            frame: initialReceiver.frame,
            operations: [],
            nodes: [],
            stages: [],
            failures: [
              {
                operation: 'test-cleanup',
                reason: 'Initial native processAssets receipt did not complete',
              },
            ],
          })
          .catch(() => {});
    });
    const lifecycle: RsbuildPlugin = {
      name: 'test-actual-native-receiver-watch-lifecycle',
      setup(api) {
        phase.install(api);
        api.modifyBundlerChain((chain, { environment }) => {
          installFixtureCompilerPlugins(chain, result, environment.name);
        });
        api.modifyHTMLTags((tags, { filename, environment }) => {
          if (environment.name !== 'client') return tags;
          htmlFilename = filename;
          tags.bodyTags.push({
            tag: 'script',
            attrs: {
              id: REACT_RENDERER_IDENTITY_ELEMENT_ID,
              type: 'application/json',
            },
            children: phase.pendingHTML(filename, 'main'),
          });
          return tags;
        });
        api.onBeforeCreateCompiler(async params => {
          for (const callback of result.beforeCompiler)
            await callback(params as never);
        });
        api.onAfterCreateCompiler(async params => {
          for (const callback of result.afterCompiler)
            await callback(params as never);
          const compilers =
            'compilers' in params.compiler
              ? params.compiler.compilers
              : [params.compiler];
          client = compilers.find(
            candidate => candidate.options.name === 'client',
          );
          if (!client)
            throw new Error('The actual native client compiler is absent');
          client.hooks.thisCompilation.tap(
            'test-initial-native-process-assets-receiver',
            compilation => {
              compilation.hooks.processAssets.tapPromise(
                {
                  name: 'test-initial-native-process-assets-receiver',
                  stage: rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                },
                async () => {
                  if (initialProcessAssetsRuns++) return;
                  const beforeIO = phase.currentGeneratedOutputGeneration();
                  expect(beforeIO.generation).toBe(1);
                  initialReceiver = await result
                    .registry()
                    .begin(seed(options), receiverDetails());
                  expect(initialReceiver.frame.generation).toBe(1);
                  const acknowledgement = writeReceiver(
                    initialReceiver,
                    app.declaration,
                  );
                  await completeReceiver(initialReceiver, acknowledgement);
                  initialReceiptCompleted = true;
                  expect(
                    phase.currentGeneratedOutputGeneration().generation,
                  ).toBe(1);
                  expect(
                    phase.currentGeneratedOutputGeneration().snapshot,
                  ).toBe(beforeIO.snapshot);
                },
              );
            },
          );
          client.hooks.watchRun.tap(
            { name: 'test-receiver-watch-entry', stage: -1000 },
            () => {
              watchRuns++;
              if (watchRuns === 2) secondWatchEntered.resolve();
            },
          );
        });
      },
    };
    const rsbuild = await createRsbuild({
      cwd: app.appDirectory,
      rsbuildConfig: {
        mode: 'development',
        plugins: [lifecycle],
        environments: {
          client: {
            source: {
              entry: { main: path.join(app.appDirectory, 'src/main.js') },
            },
            output: { target: 'web' },
          },
        },
        tools: { htmlPlugin: { cache: false } },
        output: {
          cleanDistPath: false,
          distPath: { root: result.context.distDirectory },
        },
        dev: { writeToDisk: false, hmr: false, liveReload: false },
        server: { host: '127.0.0.1', port: 0, printUrls: false },
        performance: { printFileSize: false },
      },
    });
    const nativeServer = await rsbuild.createDevServer({
      getPortSilently: true,
    });
    closes.push(() => nativeServer.close());
    await nativeServer.listen();
    await phase.resolveIdentities();
    expect(client?.watching).toBeDefined();
    expect(watchRuns).toBe(1);
    expect(finalizations).toBe(1);
    expect(published).toEqual([1]);
    expect(initialReceiptCompleted).toBe(true);
    expect(leases[0]?.receipts).toHaveLength(1);
    expect(leases[0]?.receipts[0].receipt.nodes).toMatchObject([
      {
        path: { lexical: app.declaration },
        kind: 'file',
        byteDigest: digest('export declare const App: number;\n'),
      },
    ]);
    const outputFileSystem = client!.outputFileSystem;
    const nativeWriteFile = outputFileSystem?.writeFile;
    if (!outputFileSystem || !nativeWriteFile)
      throw new Error('The actual native dev output filesystem is absent');
    outputFileSystem.writeFile = ((...args: unknown[]) => {
      const callback = args[args.length - 1];
      if (typeof callback !== 'function')
        return Reflect.apply(nativeWriteFile, outputFileSystem, args);
      const nativeCallback = (...completedArgs: unknown[]) => {
        if (
          gateNextFinalWrite &&
          String(args[0]) ===
            path.join(client!.options.output.path!, htmlFilename) &&
          String(args[1]).includes(`"buildId":"${'a'.repeat(64)}"`)
        ) {
          gateNextFinalWrite = false;
          releaseOutputWrite = () => {
            releaseOutputWrite = undefined;
            Reflect.apply(callback, undefined, completedArgs);
          };
          outputWriteEntered.resolve();
          return;
        }
        Reflect.apply(callback, undefined, completedArgs);
      };
      return Reflect.apply(nativeWriteFile, outputFileSystem, [
        ...args.slice(0, -1),
        nativeCallback,
      ]);
    }) as typeof nativeWriteFile;
    closes.push(async () => {
      releaseOutputWrite?.();
      outputFileSystem.writeFile = nativeWriteFile;
    });
    const oldLease = await result.controller.pinReceipts();
    await oldLease.assertCurrent();
    producerGateArmed = true;
    const pendingReceiver = result
      .registry()
      .begin(seed(options), receiverDetails());
    let completed = false;
    closes.push(async () => {
      producerGate.resolve();
      const receiver = await pendingReceiver.catch(() => undefined);
      if (receiver && !completed)
        await receiver
          .terminal({
            status: 'failed',
            frame: receiver.frame,
            operations: [],
            nodes: [],
            stages: [],
            failures: [
              {
                operation: 'test-cleanup',
                reason: 'Test stopped before native completion',
              },
            ],
          })
          .catch(() => {});
    });
    await result.producerEntered;
    await expect(oldLease.assertCurrent()).rejects.toThrow();
    await secondWatchEntered.promise;
    expect(finalizations).toBe(1);
    expect(published).toEqual([1]);
    expect(generations).toHaveLength(1);
    producerGate.resolve();
    const receiver = await pendingReceiver;
    const beforeIO = phase.currentGeneratedOutputGeneration();
    expect(receiver.frame.generation).toBe(2);
    const acknowledgement = writeReceiver(
      receiver,
      app.declaration,
      'export declare const App: boolean;\n',
    );
    let idle = false;
    const pendingIdle = result.controller.waitForIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);
    expect(finalizations).toBe(1);
    const secondReady = phase.resolveIdentities();
    gateNextFinalWrite = true;
    await completeReceiver(receiver, acknowledgement);
    completed = true;
    await pendingIdle;
    await outputWriteEntered.promise;
    expect(finalizations).toBe(2);
    expect(published).toEqual([1]);
    expect(phase.currentGeneratedOutputGeneration().generation).toBe(2);
    const bridge = seed(options).receiverBridge!;
    const pendingTCP: {
      beginId: string;
      responses: Promise<BridgeResponse>[];
    }[] = [];
    const finishedTCP = new Set<string>();
    closes.push(async () => {
      releaseOutputWrite?.();
      for (const queued of pendingTCP) {
        if (finishedTCP.has(queued.beginId)) continue;
        for (const response of queued.responses) {
          const result = await response.catch(() => undefined);
          if (result?.status === 200) {
            const frame = (result.value as { frame?: ReceiverFrame }).frame;
            if (frame)
              await postBridge(
                bridge,
                bridgeTerminal(queued.beginId, frame, true),
              ).catch(() => {});
          }
        }
      }
    });
    const queued = await queuedBridgeBegin(bridge, seed(options), request => {
      pendingTCP.push(request);
    });
    const canceled = await queuedBridgeBegin(bridge, seed(options), request => {
      pendingTCP.push(request);
    });
    const canceledAck = await postBridge(bridge, {
      action: 'abort',
      beginId: canceled.beginId,
      reason: 'Canceled while the native publication write was pending',
    });
    expect(canceledAck.status).toBe(200);
    expect(phase.currentGeneratedOutputGeneration().generation).toBe(2);
    expect(result.producerReads()).toBe(2);
    expect(published).toEqual([1]);
    expect(fs.readFileSync(app.declaration, 'utf8')).toContain('boolean');
    expect(releaseOutputWrite).toBeDefined();
    releaseOutputWrite!();
    await secondReady;
    expect(published).toEqual([1, 2]);
    const accepted = await queued.response;
    expect(accepted.status).toBe(200);
    const acceptedFrame = (accepted.value as { frame: ReceiverFrame }).frame;
    expect(acceptedFrame.generation).toBe(3);
    expect(result.producerReads()).toBe(3);
    expect(phase.currentGeneratedOutputGeneration().generation).toBe(3);
    const thirdReady = phase.resolveIdentities();
    const finalAck = await postBridge(
      bridge,
      bridgeTerminal(queued.beginId, acceptedFrame),
    );
    expect(finalAck.status).toBe(200);
    finishedTCP.add(queued.beginId);
    const canceledResponse = await canceled.response;
    expect(canceledResponse.status).toBe(400);
    finishedTCP.add(canceled.beginId);
    await thirdReady;
    expect(watchRuns).toBe(3);
    expect(finalizations).toBe(3);
    expect(published).toEqual([1, 2, 3]);
    expect(generations.map(value => value.generation)).toEqual([1, 2, 3]);
    expect(generations[1].snapshot).toBe(beforeIO.snapshot);
    expect(leases[1]?.receipts).toHaveLength(1);
    expect(leases[1]?.receipts[0].receipt.nodes).toMatchObject([
      {
        path: { lexical: app.declaration },
        kind: 'file',
        byteDigest: digest('export declare const App: boolean;\n'),
      },
    ]);
    oldLease.release();

    const nativeClose = client!.close;
    const nativeShutdownComplete = deferred<void>();
    client!.close = callback => {
      Reflect.apply(nativeClose, client, [
        (error?: Error) => {
          nativeShutdownComplete.resolve();
          callback(error);
        },
      ]);
    };
    closes.push(async () => {
      releaseOutputWrite?.();
      client!.close = nativeClose;
    });
    const exitReceiver = await result
      .registry()
      .begin(seed(options), receiverDetails());
    const exitGeneration = phase.currentGeneratedOutputGeneration().generation;
    expect(exitGeneration).toBe(4);
    let exitReadinessPublished = false;
    const exitReady = phase.resolveIdentities().then(
      value => {
        exitReadinessPublished = true;
        return value;
      },
      error => error,
    );
    outputWriteEntered = deferred<void>();
    gateNextFinalWrite = true;
    await completeReceiver(exitReceiver);
    await outputWriteEntered.promise;
    expect(finalizations).toBe(4);
    expect(published).toEqual([1, 2, 3]);
    let exited = false;
    const exit = result.close().then(() => {
      exited = true;
    });
    await nativeShutdownComplete.promise;
    expect(exited).toBe(false);
    expect(result.restoreCalls()).toBe(0);
    expect(exitReadinessPublished).toBe(false);
    expect(await exitReady).toBeInstanceOf(Error);
    expect(releaseOutputWrite).toBeDefined();
    releaseOutputWrite!();
    await exit;
    expect(result.restoreCalls()).toBe(1);
    expect(exitReadinessPublished).toBe(false);
    expect(published).toEqual([1, 2, 3]);
  });
});

describe('native receiver ownership in final bundler configurations', () => {
  it('isolates shared actual MAIN arguments across web environments and removes the CF receiver after tools.bundlerChain deletes its native plugin', async () => {
    const app = fixture();
    const applicationRequire = createRequire(
      path.resolve(
        __dirname,
        '../../../../../tests/integration/routes-tanstack-mf/mf-remote/package.json',
      ),
    );
    const native = applicationRequire('@module-federation/modern-js-v3') as {
      moduleFederationPlugin(
        options: Record<string, unknown>,
      ): CliPlugin<AppTools>;
    };
    const modifierOwners: string[] = [];
    const result = await integration(app, {
      async setupPlugins(api, receiver) {
        let currentPlugin = '';
        const modifyBundlerChain = api.modifyBundlerChain;
        Object.assign(api, {
          getConfig: () => api.getNormalizedConfig(),
          config() {},
          _internalServerPlugins() {},
          modifyBundlerChain(callback: ChainModifier) {
            modifierOwners.push(currentPlugin);
            modifyBundlerChain(callback);
          },
        });
        const manager = createPluginManager<CLIPluginAPI<AppTools>>();
        manager.addPlugins([
          receiver,
          native.moduleFederationPlugin({
            config: {
              name: 'native-final-config-shared-arguments',
              remotes: {},
              dts: {
                generateTypes: false,
                consumeTypes: { consumeAPITypes: false },
              },
              dev: false,
            },
            ssr: false,
          }),
        ]);
        for (const plugin of manager.getPlugins()) {
          currentPlugin = plugin.name;
          await plugin.setup?.(api);
        }
      },
    });
    const retainedArgument = { caller: 'retained-native-argument' };
    const originalWorkerCreated = () => {};
    const originalExtraOptions = { caller: { retained: true } };
    let borrowedArgs: unknown[] | undefined;
    let borrowedConfig: Record<string, unknown> | undefined;
    let borrowedDts: Record<string, unknown> | undefined;
    const configured = new Map<
      string,
      {
        NativeConstructor: FixtureNativeConstructor;
        Owner: FixtureNativeConstructor;
        args: unknown[];
      }
    >();
    let cfDeletionRuns = 0;
    const rsbuild = await createRsbuild({
      cwd: app.appDirectory,
      rsbuildConfig: {
        mode: 'development',
        plugins: [
          {
            name: 'test-real-native-main-final-config-ownership',
            setup(api: Parameters<RsbuildPlugin['setup']>[0]) {
              api.modifyBundlerChain(async (chain, utils) => {
                for (const [
                  index,
                  modifier,
                ] of result.chainModifiers.entries()) {
                  if (modifierOwners[index] === result.plugin.name) {
                    expect(chain.plugins.has('plugin-module-federation')).toBe(
                      true,
                    );
                    const installedArgs = chain
                      .plugin('plugin-module-federation')
                      .get('args') as unknown[];
                    if (!borrowedArgs) {
                      borrowedArgs = installedArgs;
                      borrowedArgs.push(retainedArgument);
                      borrowedConfig = borrowedArgs[0] as Record<
                        string,
                        unknown
                      >;
                      borrowedDts = borrowedConfig.dts as Record<
                        string,
                        unknown
                      >;
                      borrowedDts.onDevWorkerCreated = originalWorkerCreated;
                      borrowedDts.extraOptions = originalExtraOptions;
                    }
                    expect(installedArgs[0]).toBe(borrowedConfig);
                    chain
                      .plugin('plugin-module-federation')
                      .tap(() => borrowedArgs!);
                  }
                  await modifier(chain, utils as never);
                  if (modifierOwners[index] === result.plugin.name) {
                    const ownedArgs = chain
                      .plugin('plugin-module-federation')
                      .get('args') as unknown[];
                    const ownedConfig = ownedArgs[0] as Record<string, unknown>;
                    const ownedDts = ownedConfig.dts as Record<string, unknown>;
                    expect(ownedArgs).not.toBe(borrowedArgs);
                    expect(ownedArgs[1]).toBe(retainedArgument);
                    expect(ownedConfig).not.toBe(borrowedConfig);
                    expect(ownedDts).not.toBe(borrowedDts);
                    expect(ownedDts.extraOptions).not.toBe(
                      originalExtraOptions,
                    );
                    expect(ownedDts.extraOptions).toMatchObject(
                      originalExtraOptions,
                    );
                    expect(ownedDts.implementation).toBe(app.producerPath);
                    expect(ownedDts.onDevWorkerCreated).not.toBe(
                      originalWorkerCreated,
                    );
                    expect(borrowedConfig!.dts).toBe(borrowedDts);
                    expect(borrowedDts!.onDevWorkerCreated).toBe(
                      originalWorkerCreated,
                    );
                    expect(borrowedDts!.extraOptions).toBe(
                      originalExtraOptions,
                    );
                    expect(borrowedDts!.implementation).toBeUndefined();
                    expect(
                      Object.hasOwn(originalExtraOptions, AUTHORITY_KEY),
                    ).toBe(false);
                    configured.set(utils.environment.name, {
                      NativeConstructor: chain
                        .plugin('plugin-module-federation')
                        .get('plugin') as FixtureNativeConstructor,
                      Owner: chain
                        .plugin('ultramodern-react-mf-receiver-owner')
                        .get('plugin') as FixtureNativeConstructor,
                      args: ownedArgs,
                    });
                  }
                }
              });
            },
          },
        ],
        environments: {
          client: {
            source: {
              entry: { main: path.join(app.appDirectory, 'src/main.js') },
            },
            output: { target: 'web' },
          },
          preview: {
            source: {
              entry: { main: path.join(app.appDirectory, 'src/main.js') },
            },
            output: { target: 'web' },
          },
          cloudflare: {
            source: {
              entry: { main: path.join(app.appDirectory, 'src/main.js') },
            },
            output: { target: 'web' },
            tools: {
              bundlerChain(chain) {
                cfDeletionRuns++;
                expect(configured.has('cloudflare')).toBe(true);
                expect(chain.plugins.has('plugin-module-federation')).toBe(
                  true,
                );
                expect(
                  chain.plugins.has('ultramodern-react-mf-receiver-owner'),
                ).toBe(true);
                applyCloudflareWorkerMfRuntimeBoundary(chain);
              },
            },
          },
        },
        tools: { htmlPlugin: false },
        output: {
          cleanDistPath: false,
          distPath: { root: result.context.distDirectory },
        },
      },
    });
    const bundlerConfigs = await rsbuild.initConfigs();
    expect(cfDeletionRuns).toBe(1);
    expect([...configured.keys()].sort()).toEqual([
      'client',
      'cloudflare',
      'preview',
    ]);
    const configuredSeeds = [...configured.values()].map(value =>
      seed(value.args[0] as Record<string, unknown>),
    );
    expect(new Set(configuredSeeds.map(value => value.compilerId)).size).toBe(
      3,
    );
    expect(
      new Set(configuredSeeds.map(value => value.registrationId)).size,
    ).toBe(3);
    expect(result.loads()).toBe(1);
    expect(result.producerPreflights()).toBe(0);
    for (const name of ['client', 'preview']) {
      const configuredPlugin = configured.get(name)!;
      const finalConfig = bundlerConfigs.find(config => config.name === name)!;
      expect(
        finalConfig.plugins?.filter(
          plugin => plugin instanceof configuredPlugin.NativeConstructor,
        ),
      ).toHaveLength(1);
      expect(
        finalConfig.plugins?.filter(
          plugin => plugin instanceof configuredPlugin.Owner,
        ),
      ).toHaveLength(1);
    }
    const cfConfigured = configured.get('cloudflare')!;
    const cfConfig = bundlerConfigs.find(
      config => config.name === 'cloudflare',
    )!;
    expect(
      cfConfig.plugins?.filter(
        plugin => plugin instanceof cfConfigured.NativeConstructor,
      ),
    ).toHaveLength(0);
    const cfCompanion = cfConfig.plugins?.find(
      plugin => plugin instanceof cfConfigured.Owner,
    );
    expect(cfCompanion).toBeDefined();
    for (const callback of result.beforeCompiler)
      await callback({ bundlerConfigs } as never);
    expect(cfConfig.plugins).not.toContain(cfCompanion);
    expect(result.producerPreflights()).toBe(1);
    expect(result.producerReads()).toBe(0);
    await expect(
      result
        .registry()
        .begin(
          seed(cfConfigured.args[0] as Record<string, unknown>),
          receiverDetails(),
        ),
    ).rejects.toThrow('receiver is not an enrolled graph member');
    expect(borrowedDts!.onDevWorkerCreated).toBe(originalWorkerCreated);
    expect(borrowedDts!.extraOptions).toBe(originalExtraOptions);
    expect(originalExtraOptions).toEqual({ caller: { retained: true } });
  });

  it('rejects a foreign preseed without changing the borrowed options or authored worker callback', async () => {
    const app = fixture();
    const result = await integration(app);
    const originalWorkerCreated = () => {};
    const foreignSeed = Object.freeze({ owner: 'foreign-native-receiver' });
    const extraOptions = Object.freeze({
      [AUTHORITY_KEY]: foreignSeed,
      caller: 'retained',
    });
    const dts = Object.freeze({
      onDevWorkerCreated: originalWorkerCreated,
      extraOptions,
    });
    const options = Object.freeze({ name: 'foreign-seed-host', dts });
    await expect(configureChain(result, options, true, true)).rejects.toThrow(
      'React receiver seed already has an owner',
    );
    expect(options.dts).toBe(dts);
    expect(dts.extraOptions).toBe(extraOptions);
    expect(dts.onDevWorkerCreated).toBe(originalWorkerCreated);
    expect(extraOptions[AUTHORITY_KEY]).toBe(foreignSeed);
    expect(options).toEqual({
      name: 'foreign-seed-host',
      dts: { onDevWorkerCreated: originalWorkerCreated, extraOptions },
    });
    expect(result.producerPreflights()).toBe(0);
    expect(result.producerReads()).toBe(0);
  });

  it('accepts the exact native instance and companion together in their named final configuration', async () => {
    const app = fixture();
    const result = await integration(app);
    await configureChain(result, { dts: true }, true, true);
    const { nativePlugin, companionPlugin } =
      result.compilerPluginInstances.get('client')!;
    const unrelatedPlugin = { apply(_compiler: Rspack.Compiler) {} };
    const plugins = [unrelatedPlugin, companionPlugin, nativePlugin];
    const bundlerConfigs = [
      { name: 'client', plugins },
      { name: 'other', plugins: [unrelatedPlugin] },
    ];
    for (const callback of result.beforeCompiler)
      await callback({ bundlerConfigs } as never);
    expect(bundlerConfigs[0].plugins).toBe(plugins);
    expect(bundlerConfigs[0].plugins).toEqual([
      unrelatedPlugin,
      companionPlugin,
      nativePlugin,
    ]);
    expect(result.producerPreflights()).toBe(1);
    expect(result.producerReads()).toBe(0);
  });

  it('rejects the exact native instance moved into another final configuration', async () => {
    const app = fixture();
    const result = await integration(app);
    await configureChain(result, { dts: true }, true, true);
    const { nativePlugin, companionPlugin } =
      result.compilerPluginInstances.get('client')!;
    const bundlerConfigs = [
      { name: 'client', plugins: [companionPlugin] },
      { name: 'other', plugins: [nativePlugin] },
    ];
    for (const callback of result.beforeCompiler)
      await expect(callback({ bundlerConfigs } as never)).rejects.toThrow(
        'React receiver native compiler plugin ownership changed',
      );
    expect(result.producerPreflights()).toBe(0);
  });

  it('rejects the exact native instance duplicated in the final plugin list', async () => {
    const app = fixture();
    const result = await integration(app);
    await configureChain(result, { dts: true }, true, true);
    const { nativePlugin, companionPlugin } =
      result.compilerPluginInstances.get('client')!;
    const bundlerConfigs = [
      {
        name: 'client',
        plugins: [companionPlugin, nativePlugin, nativePlugin],
      },
    ];
    for (const callback of result.beforeCompiler)
      await expect(callback({ bundlerConfigs } as never)).rejects.toThrow(
        'React receiver native compiler plugin ownership changed',
      );
    expect(result.producerPreflights()).toBe(0);
  });

  it('rejects replacement by an instance of the original native constructor in the final configuration', async () => {
    const app = fixture();
    const result = await integration(app);
    await configureChain(result, { dts: true }, true, true);
    const { nativePlugin, companionPlugin } =
      result.compilerPluginInstances.get('client')!;
    const { originalNativeConstructor, args } =
      result.compilerNativePlugins.get('client')!;
    const replacement = new originalNativeConstructor(...args);
    expect(replacement).not.toBe(nativePlugin);
    const bundlerConfigs = [
      { name: 'client', plugins: [companionPlugin, replacement] },
    ];
    for (const callback of result.beforeCompiler)
      await expect(callback({ bundlerConfigs } as never)).rejects.toThrow(
        'React receiver native compiler plugin was replaced',
      );
    expect(result.producerPreflights()).toBe(0);
  });

  it('rejects an enrolled native instance whose exact companion is missing from the final configuration', async () => {
    const app = fixture();
    const result = await integration(app);
    await configureChain(result, { dts: true }, true, true);
    const { nativePlugin } = result.compilerPluginInstances.get('client')!;
    const bundlerConfigs = [{ name: 'client', plugins: [nativePlugin] }];
    for (const callback of result.beforeCompiler)
      await expect(callback({ bundlerConfigs } as never)).rejects.toThrow(
        'React receiver native compiler plugin ownership changed',
      );
    expect(result.producerPreflights()).toBe(0);
  });

  it('rejects the exact companion moved into another final configuration', async () => {
    const app = fixture();
    const result = await integration(app);
    await configureChain(result, { dts: true }, true, true);
    const { nativePlugin, companionPlugin } =
      result.compilerPluginInstances.get('client')!;
    const bundlerConfigs = [
      { name: 'client', plugins: [nativePlugin] },
      { name: 'other', plugins: [companionPlugin] },
    ];
    for (const callback of result.beforeCompiler)
      await expect(callback({ bundlerConfigs } as never)).rejects.toThrow(
        'React receiver native compiler plugin ownership changed',
      );
    expect(result.producerPreflights()).toBe(0);
  });

  it('rejects the exact companion duplicated in the final plugin list', async () => {
    const app = fixture();
    const result = await integration(app);
    await configureChain(result, { dts: true }, true, true);
    const { nativePlugin, companionPlugin } =
      result.compilerPluginInstances.get('client')!;
    const bundlerConfigs = [
      {
        name: 'client',
        plugins: [companionPlugin, companionPlugin, nativePlugin],
      },
    ];
    for (const callback of result.beforeCompiler)
      await expect(callback({ bundlerConfigs } as never)).rejects.toThrow(
        'React receiver native compiler plugin ownership changed',
      );
    expect(result.producerPreflights()).toBe(0);
  });
});
