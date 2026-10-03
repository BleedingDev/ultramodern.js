import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type RendererBuildIdentities,
  resolveRendererBuildIdentities,
} from '@modern-js/app-tools-extensions/renderer-build-identity';
import { findHostingModuleDirectory } from '@modern-js/app-tools-extensions/runtime-package-resolution';
import { createRequestSession } from '@modern-js/renderer-core/session';
import type { Entrypoint } from '@modern-js/types/cli/base';
import {
  createRsbuild,
  type RsbuildPlugin,
  type RsbuildPluginAPI,
  type Rspack,
  rspack,
} from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import { nativeClientAssetsPlugin } from '../../src/native-composition/native-assets';
import {
  RENDERER_BUILD_MANIFEST_FILE,
  RENDERER_DEVELOPMENT_DIRECTORY,
  type RendererDevelopmentBuildManifest,
  readRendererDevelopmentBuildManifest,
  validateRendererBuildManifest,
} from '../../src/native-composition/native-build-manifest';
import {
  NativeDevelopment,
  nativeDevelopmentOutputDirectory,
} from '../../src/native-composition/native-development';
import { createNativeEntryGenerator } from '../../src/native-composition/native-entry';
import type { NativeEntryGeneration } from '../../src/native-composition/native-infrastructure';
import type { NativeDevelopmentSnapshot } from '../../src/native-composition/native-server-plugin';
import { resolveRendererProfileMetadata } from '../../src/native-composition/renderer-profile';
import { resolveEntrypointRouterBindings } from '../../src/native-composition/renderer-router-resolution';
import { nativeRendererIsolationPlugin } from '../../src/native-composition/renderer-selection';
import { createOctaneCompilerPlugin } from '../../src/renderers/octane/compiler';
import { pluginSolidRenderer } from '../../src/renderers/solid/compiler';

const roots: string[] = [];
const closes: (() => Promise<void>)[] = [];

afterEach(async () => {
  const failures: unknown[] = [];
  try {
    for (const close of closes.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
  } finally {
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true });
  }
  if (failures.length)
    throw new AggregateError(failures, 'Native fixture cleanup failed');
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

function queue<T>(name: string, events: () => readonly string[]) {
  const values: T[] = [];
  const waiting: ((value: T) => void)[] = [];
  return {
    push(value: T) {
      const deliver = waiting.shift();
      if (deliver) deliver(value);
      else values.push(value);
    },
    async until(predicate: (value: T) => boolean): Promise<T> {
      for (;;) {
        const value = values.length
          ? values.shift()!
          : await new Promise<T>((resolve, reject) => {
              const deliver = (value: T) => {
                clearTimeout(timer);
                resolve(value);
              };
              const timer = setTimeout(() => {
                const index = waiting.indexOf(deliver);
                if (index !== -1) waiting.splice(index, 1);
                reject(
                  new Error(
                    `Timed out waiting for actual ${name}; recent compiler events: ${events().join(' | ')}`,
                  ),
                );
              }, 90_000);
              waiting.push(deliver);
            });
        if (predicate(value)) return value;
      }
    },
  };
}

function results(stats: Rspack.Stats | Rspack.MultiStats) {
  return 'stats' in stats ? stats.stats : [stats];
}

function compilation(stats: Rspack.Stats | Rspack.MultiStats, name: string) {
  const result = results(stats).find(item => item.compilation.name === name);
  if (!result) throw new Error(`Missing actual ${name} compilation`);
  return result.compilation;
}

function actualHashes(stats: Rspack.Stats | Rspack.MultiStats) {
  return Object.fromEntries(
    results(stats).map(result => [
      result.compilation.name,
      result.compilation.hash,
    ]),
  );
}

function view(marker: string) {
  return `import './style.css';\nexport default function App() { return <main data-native-wave="${marker}">${marker}</main>; }\n`;
}

interface Receipt {
  stats: Rspack.Stats | Rspack.MultiStats;
  metadata: RendererDevelopmentBuildManifest;
  snapshot: NativeDevelopmentSnapshot;
}

type GuardAttack = 'manifest' | 'exports' | 'source';

interface PoisonReceipt {
  readonly attack: Exclude<GuardAttack, 'source'>;
  readonly compilerName: string;
  readonly compilation: Rspack.Compilation;
  readonly assetName: string;
  readonly afterBytesSha: string;
}

interface EmittedPoisonObservation {
  readonly filename: string;
  readonly bytesSha: string;
  readonly size: number;
}

function readEmittedPoison(
  poison: PoisonReceipt,
): Promise<EmittedPoisonObservation> {
  const output = poison.compilation.outputOptions.path;
  const filesystem = poison.compilation.compiler.outputFileSystem;
  if (!output || !filesystem)
    throw new Error('Actual poisoned compiler output filesystem is missing');
  const filename = path.join(output, poison.assetName);
  return new Promise((resolve, reject) => {
    filesystem.readFile(filename, (error, bytes) => {
      if (error) return reject(error);
      if (!bytes)
        return reject(new Error(`Actual poisoned output missing: ${filename}`));
      const emitted = Buffer.from(bytes);
      resolve(
        Object.freeze({
          filename,
          bytesSha: createHash('sha256').update(emitted).digest('hex'),
          size: emitted.length,
        }),
      );
    });
  });
}

interface GuardCompletionObservation {
  readonly sequence: number;
  readonly hasErrors: boolean;
  readonly compilationHashes: Readonly<Record<string, string | undefined>>;
  readonly children: readonly {
    readonly compilerName: string | undefined;
    readonly compilation: Rspack.Compilation;
    readonly poison: PoisonReceipt | undefined;
    readonly emittedPoison?: EmittedPoisonObservation;
    readonly emissionError?: string;
  }[];
  readonly serverEntryFiles: readonly string[];
  readonly sourceMutation:
    | {
        readonly filename: string;
        readonly afterBytesSha: string;
      }
    | undefined;
  readonly compilerEvents: readonly string[];
}

interface GuardCompletionReceipt {
  readonly observation: GuardCompletionObservation;
  readonly published: RendererDevelopmentBuildManifest | undefined;
  readonly publicationError: unknown;
  readonly checkpoint:
    | {
        readonly filename: string;
        readonly bytesSha: string;
        readonly size: number;
        readonly namespaceExports: readonly string[];
      }
    | undefined;
  readonly checkpointObservationError: string | undefined;
}

/** All successful manifests below come from the native compiler and asset producer. */
async function fixture(
  renderer: 'solid' | 'octane',
  module: boolean,
  absoluteDevPrefix = false,
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'native-memory-dev-',
      ),
    ),
  );
  roots.push(root);
  const metadata = resolveRendererProfileMetadata(renderer);
  const dependencies: Record<string, string> = {};
  const bindings = new Map(
    metadata.frameworkPackages.map(owner => [owner.specifier, owner.directory]),
  );
  // Declare and link the actual observed owners, including Ultra's physical owner.
  for (const specifier of new Set([
    ...bindings.keys(),
    ...Object.keys(metadata.profile.dependencies),
    '@modern-js/renderer-core',
  ])) {
    let directory = bindings.get(specifier);
    if (!directory) {
      const hosting = metadata.frameworkPackages
        .map(owner => findHostingModuleDirectory(specifier, owner.directory))
        .find(Boolean);
      if (!hosting)
        throw new Error(`No installed native owner for ${specifier}`);
      directory = fs.realpathSync(path.join(hosting, specifier));
    }
    const owner: { name: string; version: string } = JSON.parse(
      fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
    );
    dependencies[specifier] =
      owner.name === specifier
        ? owner.version
        : `npm:${owner.name}@${owner.version}`;
    const link = path.join(root, 'node_modules', specifier);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(directory, link, 'dir');
  }
  const packageName = `native-${renderer}-${module ? 'esm' : 'commonjs'}-development`;
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: packageName, private: true, dependencies }),
  );
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        jsx: 'preserve',
        jsxImportSource: metadata.profile.jsxImportSource,
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
    }),
  );
  fs.mkdirSync(path.join(root, 'src'));
  const app = path.join(root, 'src', 'App.tsx');
  const css = path.join(root, 'src', 'style.css');
  fs.writeFileSync(app, view('first'));
  fs.writeFileSync(css, 'main { color: rebeccapurple; }\n');
  const extraWeb = renderer === 'solid' && !module;
  const nativeLazyTest = (candidate: Rspack.Module) =>
    candidate.nameForCondition()?.includes('application.client') ?? false;
  const extraLazyTest = () => true;
  const extraEntry = path.join(root, 'src', 'extra.js');
  if (extraWeb)
    fs.writeFileSync(extraEntry, 'globalThis.extraNativePolicyProof = true;\n');
  const internalDirectory = path.join(root, 'node_modules', '.modern-js');
  const distDirectory = path.join(root, 'dist');
  const entrypoint: Entrypoint = {
    entryName: 'main',
    entry: app,
    isAutoMount: true,
    isMainEntry: true,
  };
  const routerBindings = await resolveEntrypointRouterBindings(
    renderer,
    [entrypoint],
    [`@modern-js/renderer-${renderer}-infrastructure`],
    metadata,
  );
  const resolveInputs = (mode: 'development' | 'production') =>
    resolveRendererBuildIdentities({
      projectRoot: root,
      packageName,
      renderer,
      profile: metadata.profile,
      mode,
      entryNames: ['main'],
      configuration: {
        renderer,
        mode,
        serverModule: module,
        absoluteDevPrefix,
        extraWeb,
      },
      excludedDirectories: [internalDirectory, distDirectory],
      packageResolutionRoots: metadata.frameworkPackages.map(
        owner => owner.directory,
      ),
      frameworkPackages: metadata.frameworkPackages.map(owner => owner.name),
      frameworkPackageBindings: metadata.frameworkPackages,
      routerBindings,
    });
  const session = await resolveInputs('development');
  const identity = session.identities.main;
  if (!identity) throw new Error('Owning resolver did not resolve main');
  const production = validateRendererBuildManifest(
    {
      ...(await resolveInputs('production')),
      schema: 'ultramodern-renderer-build',
      version: 1,
      profile: metadata.profile,
    },
    metadata.profile,
  );
  fs.mkdirSync(distDirectory);
  const productionFile = path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE);
  fs.writeFileSync(productionFile, JSON.stringify(production));
  const productionBytes = fs.readFileSync(productionFile);
  const generator = createNativeEntryGenerator(renderer);
  const context: NativeEntryGeneration = {
    renderer,
    profile: metadata.profile,
    rendererIdentity: identity,
    appDirectory: root,
    internalDirectory,
    entrypoint,
    documentSSR: true,
    basePath: '/',
    modifyRoutes: async routes => routes,
  };
  const entryDirectory = path.join(internalDirectory, renderer, 'main');
  const clientEntry = path.join(entryDirectory, 'index.ts');
  const serverEntry = path.join(entryDirectory, 'index.server.ts');
  await fs.promises.mkdir(entryDirectory, { recursive: true });
  await fs.promises.writeFile(clientEntry, await generator.client(context));
  await fs.promises.writeFile(serverEntry, await generator.server(context));
  const completedInputs: RendererBuildIdentities[] = [];
  let completionGate:
    | {
        entered: ReturnType<typeof deferred>;
        release: ReturnType<typeof deferred>;
      }
    | undefined;
  let atCompletion = false;
  const authority = new NativeDevelopment({
    renderer,
    profile: metadata.profile,
    distDirectory,
    getSessionIdentities: () => session,
    resolveWaveInputs: async () => {
      if (atCompletion && completionGate) {
        completionGate.entered.resolve();
        await completionGate.release.promise;
      }
      const inputs = await resolveInputs('development');
      if (atCompletion) completedInputs.push(inputs);
      return inputs;
    },
  });
  closes.push(() => authority.close());
  const compilerEvents: string[] = [];
  const recordCompilerEvent = (event: string) => {
    compilerEvents.push(event);
    if (compilerEvents.length > 16) compilerEvents.shift();
  };
  const recentCompilerEvents = () => compilerEvents;
  const raw = queue<Rspack.Stats | Rspack.MultiStats>(
    'completed Stats receipt',
    recentCompilerEvents,
  );
  const compilerFailures = queue<{ compilerName: string; error: Error }>(
    'fatal compiler failed-hook receipt',
    recentCompilerEvents,
  );
  const ready = queue<Receipt>(
    'published native checkpoint',
    recentCompilerEvents,
  );
  const publicationFailures: {
    stats: Rspack.Stats | Rspack.MultiStats;
    error: unknown;
  }[] = [];
  // MultiStats retains Rsbuild's mutable child array. Seal event values at the
  // real callback without changing the genuine Stats used by the other cases.
  let guardSequence = 0;
  const poisonedCompilations = new WeakMap<Rspack.Compilation, PoisonReceipt>();
  const guardObservations = new WeakMap<
    Rspack.Stats | Rspack.MultiStats,
    GuardCompletionObservation
  >();
  const guardCompleted = queue<GuardCompletionReceipt>(
    'sealed guard completion after native publication',
    recentCompilerEvents,
  );
  const recordPoison = (
    current: Rspack.Compilation,
    attack: Exclude<GuardAttack, 'source'>,
    compilerName: string,
    assetName: string,
  ) => {
    const asset = current.getAsset(assetName);
    if (!asset) throw new Error('Actual poisoned asset disappeared');
    const afterBytesSha = createHash('sha256')
      .update(asset.source.source())
      .digest('hex');
    poisonedCompilations.set(
      current,
      Object.freeze({
        attack,
        compilerName,
        compilation: current,
        assetName,
        afterBytesSha,
      }),
    );
    recordCompilerEvent(
      `guard:poison:${attack}:${compilerName}:${assetName}:sha=${afterBytesSha}`,
    );
  };
  const observePublishedCheckpoint = async (
    observation: GuardCompletionObservation,
    published: RendererDevelopmentBuildManifest,
  ): Promise<NonNullable<GuardCompletionReceipt['checkpoint']>> => {
    const directory = path.join(distDirectory, RENDERER_DEVELOPMENT_DIRECTORY);
    const owner: unknown = JSON.parse(
      await fs.promises.readFile(
        path.join(directory, '.native-development-owner.json'),
        'utf8',
      ),
    );
    if (
      !owner ||
      typeof owner !== 'object' ||
      !('session' in owner) ||
      typeof owner.session !== 'string' ||
      !/^[a-f\d-]{36}$/u.test(owner.session) ||
      !('pid' in owner) ||
      owner.pid !== process.pid
    )
      throw new Error(
        'Actual checkpoint does not belong to this fixture session',
      );
    const serverHash = published.devCompilation.compilationHashes.server;
    if (serverHash !== observation.compilationHashes.server)
      throw new Error(
        'Published server hash differs from the sealed guard callback',
      );
    if (observation.serverEntryFiles.length !== 1)
      throw new Error(
        'Actual guard server entry does not have one selected JS file',
      );
    const ownedRoot = path.join(directory, 'compilations', owner.session);
    const prefix = `${published.devCompilation.generation}-`;
    const suffix = `-${serverHash}`;
    const checkpoints = (
      await fs.promises.readdir(ownedRoot, { withFileTypes: true })
    ).filter(
      entry =>
        entry.isDirectory() &&
        entry.name.startsWith(prefix) &&
        entry.name.endsWith(suffix),
    );
    if (checkpoints.length !== 1)
      throw new Error(
        'Actual published checkpoint is not unique in the owned session',
      );
    const filename = path.join(
      ownedRoot,
      checkpoints[0].name,
      'server',
      observation.serverEntryFiles[0],
    );
    const bytes = await fs.promises.readFile(filename);
    const namespace = await import(pathToFileURL(filename).href);
    return Object.freeze({
      filename,
      bytesSha: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      namespaceExports: Object.freeze(Object.keys(namespace).sort()),
    });
  };
  let poison: 'manifest' | 'exports' | undefined;
  let changeInputDuringCompletion = false;
  const adversary: RsbuildPlugin = {
    name: 'test-native-compiler-rejection-inputs',
    setup(api) {
      api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
        const client = bundlerConfigs.find(config => config.name === 'client');
        if (!client) throw new Error('Actual final client config is missing');
        const native = client.lazyCompilation;
        if (!native || native === true)
          throw new Error('Actual native client lazy policy is not explicit');
        expect(native.entries).toBe(false);
        expect(native.imports).toBe(false);
        if (extraWeb) {
          const originalNative =
            api.getNormalizedConfig().environments.client?.dev.lazyCompilation;
          if (!originalNative || typeof originalNative === 'boolean')
            throw new Error(
              'Normalized original native lazy policy is missing',
            );
          expect([originalNative.test].flat()).toContain(nativeLazyTest);
          expect(native.test).toEqual(originalNative.test);
          const extra = bundlerConfigs.find(
            config => config.name === 'extraWeb',
          );
          const ordinary = extra?.lazyCompilation;
          if (!ordinary || ordinary === true)
            throw new Error('Actual extra web lazy policy is missing');
          expect(ordinary.entries).toBe(true);
          expect(ordinary.imports).toBe(true);
          const originalExtra =
            api.getNormalizedConfig().environments.extraWeb?.dev
              .lazyCompilation;
          if (!originalExtra || typeof originalExtra === 'boolean')
            throw new Error(
              'Normalized original extra web lazy policy is missing',
            );
          expect([originalExtra.test].flat()).toContain(extraLazyTest);
          expect(ordinary.test).toEqual(originalExtra.test);
        }
      });
      api.onAfterCreateCompiler(({ compiler }) => {
        const compilers =
          'compilers' in compiler ? compiler.compilers : [compiler];
        for (const candidate of compilers) {
          const compilerName = candidate.options.name;
          if (!compilerName)
            throw new Error('Actual native compiler name is missing');
          candidate.hooks.invalid.tap('NativeCompilerReceipt', () => {
            recordCompilerEvent(`${compilerName}:invalid`);
          });
          candidate.hooks.done.tap('NativeCompilerReceipt', stats => {
            recordCompilerEvent(
              `${compilerName}:done:errors=${stats.hasErrors()}:hash=${stats.hash}`,
            );
          });
          candidate.hooks.failed.tap('NativeFailureReceipt', error => {
            recordCompilerEvent(`${compilerName}:failed:${error.message}`);
            compilerFailures.push({ compilerName, error });
          });
        }
      });
      api.modifyRspackConfig(config => {
        config.plugins ??= [];
        config.plugins.push({
          apply(compiler: Rspack.Compiler) {
            compiler.hooks.thisCompilation.tap(
              'NativeNegativeProof',
              (current: Rspack.Compilation) => {
                current.hooks.processAssets.tap(
                  {
                    name: 'NativeNegativeProof',
                    stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
                  },
                  () => {
                    if (poison === 'manifest' && current.name === 'client') {
                      const name = `${renderer}-module-manifest.main.json`;
                      const asset = current.getAsset(name);
                      if (!asset)
                        throw new Error('Genuine native manifest missing');
                      const manifest = JSON.parse(
                        asset.source.source().toString(),
                      );
                      manifest.schemaVersion = -1;
                      current.updateAsset(
                        name,
                        new rspack.sources.RawSource(JSON.stringify(manifest)),
                      );
                      recordPoison(current, 'manifest', 'client', name);
                    }
                    if (poison === 'exports' && current.name === 'server') {
                      const chunk = current.entrypoints
                        .get('main')
                        ?.getEntrypointChunk();
                      const name = [...(chunk?.files ?? [])].find(file =>
                        /\.[cm]?js$/u.test(file),
                      );
                      if (!name)
                        throw new Error('Genuine native server entry missing');
                      // Negative attack after genuine compilation; never successful evidence.
                      current.updateAsset(
                        name,
                        new rspack.sources.RawSource(
                          module
                            ? `export const rendererIdentity = ${JSON.stringify(identity)};`
                            : `module.exports = { rendererIdentity: ${JSON.stringify(identity)} };`,
                        ),
                        // Reset Rspack's emission metadata so this negative input
                        // reaches outputFileSystem rather than its version cache.
                        info => ({ ...info, immutable: false }),
                      );
                      recordPoison(current, 'exports', 'server', name);
                    }
                  },
                );
              },
            );
          },
        });
      });
      api.onBeforeDevCompile({
        order: 'pre',
        handler: () => {
          atCompletion = false;
        },
      });
      api.onDevCompileDone({
        order: 'pre',
        handler: ({ stats }) => {
          atCompletion = true;
          recordCompilerEvent(`all:completed:errors=${stats.hasErrors()}`);
          let sourceMutation: GuardCompletionObservation['sourceMutation'];
          if (changeInputDuringCompletion) {
            const filename = path.join(root, 'readset-input.txt');
            fs.writeFileSync(filename, randomUUID());
            const afterBytesSha = createHash('sha256')
              .update(fs.readFileSync(filename))
              .digest('hex');
            sourceMutation = Object.freeze({ filename, afterBytesSha });
            recordCompilerEvent(
              `guard:source:${filename}:sha=${afterBytesSha}`,
            );
          }
          const serverChunk = compilation(stats, 'server')
            .entrypoints.get('main')
            ?.getEntrypointChunk();
          const observation: GuardCompletionObservation = Object.freeze({
            sequence: ++guardSequence,
            hasErrors: stats.hasErrors(),
            compilationHashes: Object.freeze(actualHashes(stats)),
            children: Object.freeze(
              results(stats).map(result =>
                Object.freeze({
                  compilerName: result.compilation.name,
                  compilation: result.compilation,
                  poison: poisonedCompilations.get(result.compilation),
                }),
              ),
            ),
            serverEntryFiles: Object.freeze(
              [...(serverChunk?.files ?? [])].filter(file =>
                /\.[cm]?js$/u.test(file),
              ),
            ),
            sourceMutation,
            compilerEvents: Object.freeze([...compilerEvents]),
          });
          guardObservations.set(stats, observation);
          raw.push(stats);
          if (
            !observation.children.some(
              child => child.poison?.attack === 'exports',
            )
          )
            return;
          return Promise.all(
            observation.children.map(async child => {
              if (child.poison?.attack !== 'exports') return child;
              try {
                const emittedPoison = await readEmittedPoison(child.poison);
                return Object.freeze({ ...child, emittedPoison });
              } catch (error) {
                return Object.freeze({
                  ...child,
                  emissionError:
                    error instanceof Error ? error.message : String(error),
                });
              }
            }),
          ).then(children => {
            guardObservations.set(
              stats,
              Object.freeze({
                ...observation,
                children: Object.freeze(children),
              }),
            );
          });
        },
      });
    },
  };
  const rsbuild = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      plugins: [
        nativeRendererIsolationPlugin(renderer),
        nativeClientAssetsPlugin(renderer, () => session.identities),
        renderer === 'solid'
          ? pluginSolidRenderer({
              rendererIdentities: () => session.identities,
            })
          : createOctaneCompilerPlugin({
              rendererIdentities: () => session.identities,
            }),
        adversary,
        authority.plugin,
        {
          name: 'test-native-published-generation',
          setup(api: RsbuildPluginAPI) {
            api.onDevCompileDone({
              order: 'post',
              handler: async ({ stats }) => {
                let published: RendererDevelopmentBuildManifest | undefined;
                let publicationError: unknown;
                try {
                  if (stats.hasErrors()) return;
                  const manifest = await readRendererDevelopmentBuildManifest(
                    distDirectory,
                    metadata.profile,
                  );
                  recordCompilerEvent(
                    `checkpoint:published:generation=${manifest.devCompilation.generation}`,
                  );
                  ready.push({
                    stats,
                    metadata: manifest,
                    snapshot: await authority.resolveSnapshot(
                      identity,
                      AbortSignal.timeout(30_000),
                    ),
                  });
                  published = manifest;
                } catch (error) {
                  // Rejected and closed compiler waves have no published checkpoint.
                  publicationError = error;
                  publicationFailures.push({ stats, error });
                } finally {
                  const observation = guardObservations.get(stats);
                  if (observation) {
                    guardObservations.delete(stats);
                    let checkpoint: GuardCompletionReceipt['checkpoint'];
                    let checkpointObservationError: string | undefined;
                    if (
                      published &&
                      observation.children.some(
                        child => child.poison?.attack === 'exports',
                      )
                    ) {
                      try {
                        checkpoint = await observePublishedCheckpoint(
                          observation,
                          published,
                        );
                      } catch (error) {
                        checkpointObservationError =
                          error instanceof Error
                            ? error.message
                            : String(error);
                      }
                    }
                    // Deliver only after the owning authority's completion hook.
                    guardCompleted.push(
                      Object.freeze({
                        observation,
                        published,
                        publicationError,
                        checkpoint,
                        checkpointObservationError,
                      }),
                    );
                  }
                }
              },
            });
          },
        },
      ],
      server: { host: '127.0.0.1', port: 0, printUrls: false },
      dev: {
        writeToDisk: false,
        hmr: true,
        liveReload: false,
        ...(absoluteDevPrefix ? { assetPrefix: true } : {}),
      },
      output: {
        minify: false,
        sourceMap: false,
        injectStyles: false,
      },
      performance: { printFileSize: false },
      environments: {
        ...(extraWeb
          ? {
              extraWeb: {
                source: { entry: { main: extraEntry } },
                dev: {
                  lazyCompilation: {
                    entries: true,
                    imports: true,
                    test: extraLazyTest,
                  },
                },
                output: { target: 'web' as const },
                tools: { htmlPlugin: false },
              },
            }
          : {}),
        client: {
          source: { entry: { main: clientEntry } },
          ...(extraWeb
            ? {
                dev: {
                  lazyCompilation: {
                    entries: true,
                    imports: true,
                    test: nativeLazyTest,
                  },
                },
              }
            : {}),
          output: {
            target: 'web',
            assetPrefix: '/native-assets/',
            distPath: {
              root: nativeDevelopmentOutputDirectory(distDirectory, 'client'),
            },
          },
          tools: { htmlPlugin: false },
        },
        server: {
          source: { entry: { main: serverEntry } },
          output: {
            target: 'node',
            module,
            distPath: {
              root: nativeDevelopmentOutputDirectory(distDirectory, 'server'),
            },
            filename: { js: module ? '[name].mjs' : '[name].js' },
          },
          tools: { htmlPlugin: false, rspack: { externals: [] } },
        },
      },
    },
  });
  const dev = await rsbuild.createDevServer({ getPortSilently: true });
  closes.push(() => {
    completionGate?.release.resolve();
    return dev.close();
  });
  const listening = await dev.listen();
  const address = new URL(listening.urls[0]);
  return {
    root,
    app,
    css,
    session,
    identity,
    metadata,
    authority,
    raw,
    compilerFailures,
    ready,
    address,
    completedInputs,
    publicationFailures,
    guardCompleted,
    guardSequence: () => guardSequence,
    productionFile,
    productionBytes,
    poison(value: typeof poison) {
      poison = value;
    },
    changeInput(value: boolean) {
      changeInputDuringCompletion = value;
    },
    gateCompletion() {
      completionGate = { entered: deferred(), release: deferred() };
      return completionGate;
    },
    async edit(marker: string) {
      fs.writeFileSync(app, view(marker));
    },
    async html(snapshot: NativeDevelopmentSnapshot) {
      const request = new Request(address);
      const requestSession = createRequestSession({
        request,
        identity,
        platform: {
          kind: 'node',
          bindings: { loaderContext: new Map<string, unknown>() },
        },
      });
      try {
        const response = await snapshot.manifest.nativeRequestHandler(request, {
          session: requestSession,
          entry: identity,
          assets: snapshot.assets,
          nativeManifest: snapshot.nativeManifest,
          serverConfig: { ssr: true },
        });
        const html = await response.text();
        await requestSession.completion;
        return html;
      } finally {
        requestSession.abort();
      }
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function assertPublished(appFixture: Fixture, receipt: Receipt) {
  expect(receipt.metadata.identities).toEqual(appFixture.session.identities);
  expect(receipt.metadata.devCompilation.compilationHashes).toEqual(
    actualHashes(receipt.stats),
  );
  expect(receipt.metadata.devCompilation.sourceInputDigest).toBe(
    appFixture.completedInputs.at(-1)?.inputDigest,
  );
  expect(receipt.metadata.cacheAllowed).toBe(false);
  expect(receipt.metadata.promotable).toBe(false);
  expect(fs.readFileSync(appFixture.productionFile)).toEqual(
    appFixture.productionBytes,
  );
  for (const name of ['client', 'server']) {
    const output = compilation(receipt.stats, name).outputOptions.path;
    expect(output).toBe(
      nativeDevelopmentOutputDirectory(
        path.join(appFixture.root, 'dist'),
        name,
      ),
    );
    expect(fs.existsSync(output!)).toBe(false);
  }
  expect(receipt.snapshot.manifest.rendererIdentity).toEqual(
    appFixture.identity,
  );
}

async function retainedAssets(appFixture: Fixture, receipt: Receipt) {
  const assets = new Map<string, Buffer>();
  const client = compilation(receipt.stats, 'client');
  const prefix = client.outputOptions.publicPath;
  if (typeof prefix !== 'string')
    throw new Error('Actual client publicPath is missing');
  const emitted = client
    .getAssets()
    .filter(
      asset =>
        /\.(?:css|[cm]?js)$/u.test(asset.name) &&
        !asset.info.hotModuleReplacement,
    );
  // The native bootstrap dynamically imports its application. Its extracted CSS
  // belongs to that genuine async closure, beyond the document's startup assets.
  for (const asset of emitted) {
    const href = `${prefix}${prefix.endsWith('/') ? '' : '/'}${asset.name}`;
    const response = await fetch(new URL(href, appFixture.address));
    expect(response.status).toBe(200);
    assets.set(href, Buffer.from(await response.arrayBuffer()));
  }
  expect([...assets.keys()].some(name => /\.css$/u.test(name))).toBe(true);
  expect([...assets.keys()].some(name => /\.[cm]?js$/u.test(name))).toBe(true);
  return assets;
}

describe('native memory development checkpoints', () => {
  it.each([
    false,
    true,
  ])('publishes genuine Solid server format=%s and retains immutable assets across same-instance HMR', async module => {
    const app = await fixture('solid', module, module);
    const first = await app.ready.until(() => true);
    assertPublished(app, first);
    const compiler = compilation(first.stats, 'client').compiler;
    expect(await app.html(first.snapshot)).toContain('first');
    const oldAssets = await retainedAssets(app, first);
    expect(
      first.snapshot.assets.every(asset =>
        module
          ? new URL(asset.href).origin === app.address.origin
          : asset.href.startsWith('/'),
      ),
    ).toBe(true);
    const checkpoint = path.join(
      app.root,
      'dist',
      RENDERER_DEVELOPMENT_DIRECTORY,
      'compilations',
    );
    const packages: string[] = [];
    const visit = (directory: string) => {
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) visit(file);
        else if (item.name === 'package.json') packages.push(file);
      }
    };
    visit(checkpoint);
    expect(packages.length).toBeGreaterThan(0);
    expect(
      packages.every(
        file =>
          JSON.parse(fs.readFileSync(file, 'utf8')).type ===
          (module ? 'module' : 'commonjs'),
      ),
    ).toBe(true);
    expect(
      compilation(first.stats, 'server')
        .getAssets()
        .filter(asset => /\.[cm]?js$/u.test(asset.name)).length,
    ).toBeGreaterThan(1);

    // Require the real edited source/digest and both actual environment hashes.
    fs.writeFileSync(app.css, 'main { color: darkorange; }\n');
    await app.edit('second');
    const second = await app.ready.until(
      receipt =>
        receipt.metadata.devCompilation.sourceInputDigest !==
          first.metadata.devCompilation.sourceInputDigest &&
        receipt.metadata.devCompilation.compilationHashes.client !==
          first.metadata.devCompilation.compilationHashes.client &&
        receipt.metadata.devCompilation.compilationHashes.server !==
          first.metadata.devCompilation.compilationHashes.server,
    );
    assertPublished(app, second);
    expect(compilation(second.stats, 'client').compiler).toBe(compiler);
    expect(second.metadata.devCompilation.generation).toBeGreaterThan(
      first.metadata.devCompilation.generation,
    );
    expect(await app.html(second.snapshot)).toContain('second');
    expect(await app.html(first.snapshot)).toContain('first');
    const newAssets = await retainedAssets(app, second);
    for (const [url, bytes] of oldAssets) {
      const retained = await fetch(new URL(url, app.address));
      expect(Buffer.from(await retained.arrayBuffer())).toEqual(bytes);
      const head = await fetch(new URL(url, app.address), { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe(String(bytes.length));
      expect(await head.text()).toBe('');
    }
    const oldCSS = [...oldAssets.keys()].find(name => /\.css$/u.test(name))!;
    const newCSS = [...newAssets.keys()].find(name => /\.css$/u.test(name))!;
    expect(newCSS).not.toBe(oldCSS);
    expect(
      createHash('sha256').update(newAssets.get(newCSS)!).digest('hex'),
    ).not.toBe(
      createHash('sha256').update(oldAssets.get(oldCSS)!).digest('hex'),
    );

    fs.writeFileSync(
      app.app,
      'export default function App( { invalid native syntax\n',
    );
    // Recoverable entry-scan errors must produce genuine Stats without closing watchers.
    const failedStats = await app.raw.until(stats => stats.hasErrors());
    expect(
      results(failedStats)
        .flatMap(stats => stats.compilation.errors.map(error => error.message))
        .join('\n'),
    ).toContain('Expected');
    await expect(
      app.authority.resolveSnapshot(app.identity, AbortSignal.timeout(30_000)),
    ).rejects.toThrow('compilation failed');
    expect(
      fs.existsSync(
        path.join(
          app.root,
          'dist',
          RENDERER_DEVELOPMENT_DIRECTORY,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
      ),
    ).toBe(false);
    await app.edit('recovered');
    const recovered = await app.ready.until(
      receipt =>
        receipt.metadata.devCompilation.sourceInputDigest !==
        second.metadata.devCompilation.sourceInputDigest,
    );
    assertPublished(app, recovered);
    expect(compilation(recovered.stats, 'client').compiler).toBe(compiler);
    expect(await app.html(recovered.snapshot)).toContain('recovered');

    const gate = app.gateCompletion();
    await app.edit('closed-before-publication');
    await gate.entered.promise;
    const close = app.authority.close();
    await expect(
      app.authority.resolveSnapshot(app.identity, AbortSignal.timeout(30_000)),
    ).rejects.toThrow('closed');
    gate.release.resolve();
    await close;
    expect(
      fs.existsSync(
        path.join(
          app.root,
          'dist',
          RENDERER_DEVELOPMENT_DIRECTORY,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
      ),
    ).toBe(false);
    expect(fs.readFileSync(app.productionFile)).toEqual(app.productionBytes);
  }, 300_000);

  it('rejects actual malformed native manifests, missing transport exports, and source drift before recovering', async () => {
    const app = await fixture('solid', true);
    let last = await app.ready.until(() => true);
    for (const attack of ['manifest', 'exports', 'source'] as const) {
      const baseline = {
        sequence: app.guardSequence(),
        generation: last.metadata.devCompilation.generation,
        compilationHashes: last.metadata.devCompilation.compilationHashes,
        sourceInputDigest: last.metadata.devCompilation.sourceInputDigest,
      };
      let stage = 'editing attack source';
      let completion: GuardCompletionReceipt | undefined;
      try {
        app.poison(attack === 'source' ? undefined : attack);
        app.changeInput(attack === 'source');
        await app.edit(`rejected-${attack}`);
        stage = 'waiting for this attack compilation to complete publication';
        completion = await app.guardCompleted.until(({ observation }) => {
          if (
            observation.sequence <= baseline.sequence ||
            observation.hasErrors ||
            observation.compilationHashes.server ===
              baseline.compilationHashes.server
          )
            return false;
          if (attack === 'source') return Boolean(observation.sourceMutation);
          const compilerName = attack === 'manifest' ? 'client' : 'server';
          return observation.children.some(
            child =>
              child.compilerName === compilerName &&
              child.poison?.attack === attack &&
              child.poison.compilerName === compilerName &&
              child.poison.compilation === child.compilation,
          );
        });
        if (attack === 'exports') {
          stage =
            'asserting fixture poison reached the actual output filesystem';
          const child = completion.observation.children.find(
            candidate => candidate.poison?.attack === attack,
          );
          if (
            !child?.poison ||
            !child.emittedPoison ||
            child.emittedPoison.bytesSha !== child.poison.afterBytesSha
          )
            throw new Error(
              'Actual fixture poison not emitted: the selected server output bytes do not match the processAssets mutation',
            );
        }
        stage = 'asserting actual provider rejection';
        await expect(
          app.authority.resolveSnapshot(
            app.identity,
            AbortSignal.timeout(30_000),
          ),
        ).rejects.toThrow(
          attack === 'manifest'
            ? /manifest/iu
            : attack === 'exports'
              ? /transport handlers/iu
              : /inputs changed/iu,
        );
        stage = 'asserting failed checkpoint is absent';
        expect(
          fs.existsSync(
            path.join(
              app.root,
              'dist',
              RENDERER_DEVELOPMENT_DIRECTORY,
              RENDERER_BUILD_MANIFEST_FILE,
            ),
          ),
        ).toBe(false);
        app.poison(undefined);
        app.changeInput(false);
        await app.edit(`recovered-${attack}`);
        stage = 'waiting for genuine recovery publication';
        const receipt = await app.ready.until(
          asyncReceipt =>
            asyncReceipt.metadata.devCompilation.generation >
            last.metadata.devCompilation.generation,
        );
        assertPublished(app, receipt);
        stage = 'asserting recovered server output';
        expect(await app.html(receipt.snapshot)).toContain(
          `recovered-${attack}`,
        );
        last = receipt;
      } catch (error) {
        const observation = completion?.observation;
        throw new Error(
          `Actual native guard failed: ${JSON.stringify({
            attack,
            stage,
            failure: error instanceof Error ? error.message : String(error),
            sourceMarker: `rejected-${attack}`,
            baseline,
            completion: observation && {
              sequence: observation.sequence,
              hasErrors: observation.hasErrors,
              compilationHashes: observation.compilationHashes,
              serverEntryFiles: observation.serverEntryFiles,
              poisons: observation.children.flatMap(child =>
                child.poison
                  ? [
                      {
                        attack: child.poison.attack,
                        compilerName: child.poison.compilerName,
                        assetName: child.poison.assetName,
                        afterBytesSha: child.poison.afterBytesSha,
                        emittedPoison: child.emittedPoison,
                        emissionError: child.emissionError,
                        matchesCompilation:
                          child.poison.compilation === child.compilation,
                      },
                    ]
                  : [],
              ),
              sourceMutation: observation.sourceMutation,
              compilerEvents: observation.compilerEvents,
            },
            publication: completion?.published?.devCompilation,
            checkpoint: completion?.checkpoint,
            checkpointObservationError: completion?.checkpointObservationError,
            publicationError:
              completion?.publicationError instanceof Error
                ? completion.publicationError.message
                : String(completion?.publicationError),
          })}`,
          { cause: error },
        );
      }
    }
  }, 300_000);

  it('binds the actual Octane native manifest to the changing client hash while the session identity stays fixed', async () => {
    const app = await fixture('octane', true);
    const first = await app.ready.until(() => true);
    assertPublished(app, first);
    expect(first.snapshot.hydrationBuildId).toBe(
      first.metadata.devCompilation.compilationHashes.client,
    );
    expect(await app.html(first.snapshot)).toContain('first');
    await app.edit('octane-second');
    const second = await app.ready.until(
      receipt =>
        receipt.metadata.devCompilation.compilationHashes.client !==
          first.metadata.devCompilation.compilationHashes.client &&
        receipt.metadata.devCompilation.sourceInputDigest !==
          first.metadata.devCompilation.sourceInputDigest,
    );
    assertPublished(app, second);
    expect(second.snapshot.hydrationBuildId).toBe(
      second.metadata.devCompilation.compilationHashes.client,
    );
    expect(second.snapshot.hydrationBuildId).not.toBe(
      first.snapshot.hydrationBuildId,
    );
    expect(compilation(second.stats, 'client').compiler).toBe(
      compilation(first.stats, 'client').compiler,
    );
    expect(await app.html(second.snapshot)).toContain('octane-second');
  }, 300_000);

  it('preserves a foreign replacement of a genuine development checkpoint when the owning session closes', async () => {
    const app = await fixture('solid', true);
    const initial = await app.ready.until(() => true);
    assertPublished(app, initial);
    const filename = path.join(
      app.root,
      'dist',
      RENDERER_DEVELOPMENT_DIRECTORY,
      RENDERER_BUILD_MANIFEST_FILE,
    );
    fs.renameSync(filename, `${filename}.previous-owned`);
    const foreign = Buffer.from('foreign-owner-checkpoint');
    fs.writeFileSync(filename, foreign, { flag: 'wx' });
    await expect(app.authority.close()).rejects.toThrow(
      /ownership|changed|owner/iu,
    );
    expect(fs.readFileSync(filename)).toEqual(foreign);
    expect(fs.readFileSync(app.productionFile)).toEqual(app.productionBytes);
  }, 300_000);
});
