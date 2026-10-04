import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type {
  RendererBuildIdentities,
  RendererGeneratedOutputIdentityLease,
} from '@modern-js/app-tools-extensions/renderer-build-identity';
import {
  assertRendererGeneratedOutputReceiptNodesCurrent,
  rendererGeneratedOutputPermission,
} from '@modern-js/app-tools-extensions/renderer-generated-outputs';
import { escapeInlineDataJSON } from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  type EnvironmentContext,
  type RsbuildPluginAPI,
  type Rspack,
  rspack,
} from '@rsbuild/core';
import {
  type ConfigSourceSnapshot,
  captureConfigSourceSnapshot,
  resolveConfigSourcePhysicalPath,
} from './config-evaluator/source-snapshot';
import { assertRendererBuildInputsUnchanged } from './native-build-manifest';
import { isUltramodernReleaseIdentityBannerPlugin } from './preset';
import {
  reactInputGitPathspecs,
  reactWorkspaceCatalogInputs,
} from './react-authored-inputs';
import {
  installReactBuildMarkerBinding,
  REACT_BUILD_MARKER_EXPRESSION,
  REACT_SOURCE_REVISION_EXPRESSION,
} from './react-build-marker-binding';

const RECORD_KEY = 'ultramodernReactTypedCss';
const PRODUCER_VERSION = '1.2.4';

interface ProducerRecord {
  version: 1;
  producerPath: string;
  producerDigest: string;
  producerVersion: string;
  sourcePath: string;
  sourceDigest: string;
  produced: boolean;
  outputPath?: string;
  outputDigest?: string;
}

/** Loaders are shipped in src, as with the owning Solid compiler. */
function privateLoader(): string {
  let directory =
    typeof __dirname === 'string'
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const loader = path.join(
      directory,
      'src/native-composition/react-typed-css-loader.cjs',
    );
    if (
      fs.existsSync(path.join(directory, 'package.json')) &&
      fs.existsSync(loader)
    )
      return loader;
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error('Cannot locate the UltraModern React typed CSS loader');
    directory = parent;
  }
}

function digest(filename: string): string {
  const descriptor = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile())
      throw new Error(`React typed CSS file is not regular: ${filename}`);
    const hash = createHash('sha256')
      .update(fs.readFileSync(descriptor))
      .digest('hex');
    const after = fs.fstatSync(descriptor, { bigint: true });
    const named = fs.lstatSync(filename, { bigint: true });
    if (
      before.dev !== named.dev ||
      before.ino !== named.ino ||
      before.ctimeNs !== named.ctimeNs ||
      before.size !== after.size ||
      before.ctimeNs !== after.ctimeNs ||
      before.mode !== after.mode
    )
      throw new Error(`React typed CSS file changed during read: ${filename}`);
    return hash;
  } finally {
    fs.closeSync(descriptor);
  }
}

function inside(directory: string, filename: string): boolean {
  const relative = path.relative(directory, filename);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export interface ReactGeneratedOutputGeneration {
  readonly generation: number;
  readonly snapshot: ConfigSourceSnapshot;
  assertCurrent(): void;
}

export interface ReactGeneratedOutputPhaseController {
  waitForIdle(): Promise<void>;
  pinReceipts(): Promise<RendererGeneratedOutputIdentityLease>;
  bindGeneration?(generation: ReactGeneratedOutputGeneration): void;
  assertCompilerGraph?(stats: Rspack.Stats | Rspack.MultiStats): void;
}

export interface ReactTypedCssPhaseOptions {
  appDirectory: string;
  internalDirectory: string;
  distDirectory: string;
  inputPaths?: readonly string[];
  configurationSourceSnapshot?: ConfigSourceSnapshot;
  produceTypedCss?: boolean;
  /** The UI metadata owner requires a complete private graph before emission. */
  bindRuntimeIdentity?: boolean;
  generatedOutputs?: ReactGeneratedOutputPhaseController;
  finalize(
    stats: Rspack.Stats | Rspack.MultiStats,
    generatedOutputs?: RendererGeneratedOutputIdentityLease,
  ): Promise<RendererBuildIdentities>;
  publishMetadata?(
    stats: Rspack.Stats | Rspack.MultiStats,
    identities: RendererBuildIdentities,
    assertCurrent: () => void,
  ): Promise<void>;
  publishDevelopment?(
    stats: Rspack.Stats | Rspack.MultiStats,
    identities: RendererBuildIdentities,
    assertCurrent: () => void,
  ): Promise<void>;
}

/** Finalize each compiler generation; only acknowledged producer paths may change. */
export class ReactTypedCssPhase {
  private readonly loader = privateLoader();
  private readonly producers = new Map<string, string>();
  private snapshot: ConfigSourceSnapshot;
  private outputs = new Set<string>();
  private readyPromise!: Promise<RendererBuildIdentities>;
  private resolveReady!: (value: RendererBuildIdentities) => void;
  private rejectReady!: (error: Error) => void;
  private finalized = false;
  private started = false;
  private completed = false;
  private finalization: Promise<void> = Promise.resolve();
  private epoch = 0;
  private closed = false;
  private discovering = false;
  private runtimeIdentities: RendererBuildIdentities | undefined;
  private reservedGeneration: ReactGeneratedOutputGeneration | undefined;
  private receiptLease: RendererGeneratedOutputIdentityLease | undefined;
  private preparation: Promise<void> | undefined;
  private trackedInputs = new Set<string>();
  private currentGeneration: ReactGeneratedOutputGeneration | undefined;
  private finalizingEpoch: number | undefined;
  private compilerGeneration:
    | {
        epoch: number;
        resolveReady: (value: RendererBuildIdentities) => void;
        rejectReady: (error: Error) => void;
      }
    | undefined;
  private readonly htmlOutputs = new Map<
    string,
    { entryName: string; token: string }
  >();

  constructor(private readonly options: ReactTypedCssPhaseOptions) {
    this.snapshot = this.capture();
    this.resetReady();
  }

  private resetReady(): void {
    this.finalized = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Compilation can fail before any server request awaits this generation.
    void this.readyPromise.catch(() => {});
  }

  resolveIdentities = (): Promise<RendererBuildIdentities> => this.readyPromise;

  /** BEGIN calls this before receiver IO; native watch consumes it unchanged. */
  reserveGeneratedOutputGeneration(): ReactGeneratedOutputGeneration {
    if (this.closed)
      throw new Error(
        'React compiler closed before receiver generation reservation',
      );
    if (this.reservedGeneration) return this.reservedGeneration;
    if (this.completed || this.finalizingEpoch === this.epoch) {
      this.epoch++;
      this.currentGeneration = undefined;
      this.snapshot = this.capture();
      this.outputs = new Set();
      this.started = false;
      this.completed = false;
      this.receiptLease = undefined;
      this.resetReady();
    }
    const reservation = this.currentGeneratedOutputGeneration();
    this.reservedGeneration = reservation;
    return reservation;
  }

  /** A receiver joining the current native wave must not request another one. */
  shouldScheduleGeneratedOutputWatch(
    reservation: ReactGeneratedOutputGeneration,
  ): boolean {
    reservation.assertCurrent();
    return (
      this.reservedGeneration === reservation &&
      reservation.generation > 1 &&
      !this.started &&
      !this.preparation
    );
  }

  currentGeneratedOutputGeneration(): ReactGeneratedOutputGeneration {
    if (this.currentGeneration) return this.currentGeneration;
    const epoch = this.epoch;
    this.currentGeneration = Object.freeze({
      generation: epoch + 1,
      snapshot: this.snapshot,
      assertCurrent: () => {
        if (this.closed || epoch !== this.epoch)
          throw new Error(
            'React receiver generation reservation is no longer active',
          );
      },
    });
    return this.currentGeneration;
  }

  pendingHTML(
    filename: string,
    entryName: string,
    sessionIdentity?: RendererIdentity,
  ): string {
    if (sessionIdentity && sessionIdentity.entryName !== entryName)
      throw new Error(
        'React document identity conflicts with its analyzed entry',
      );
    const token = escapeInlineDataJSON(
      JSON.stringify(
        sessionIdentity ??
          (!this.discovering
            ? this.runtimeIdentities?.identities[entryName]
            : undefined) ?? { ultramodernPendingReactIdentity: randomUUID() },
      ),
    );
    this.htmlOutputs.set(filename, { entryName, token });
    return token;
  }

  private capture(): ConfigSourceSnapshot {
    let extraInputs = [
      ...(this.options.inputPaths ?? []),
      ...reactWorkspaceCatalogInputs(
        this.options.appDirectory,
        this.options.configurationSourceSnapshot,
      ),
    ];
    try {
      const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: this.options.appDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const pathspecs = reactInputGitPathspecs(gitRoot, [
        this.options.appDirectory,
        ...extraInputs,
      ]);
      this.trackedInputs = new Set([
        ...this.trackedInputs,
        ...execFileSync(
          'git',
          ['ls-files', '--cached', '-z', '--', ...pathspecs],
          {
            cwd: gitRoot,
            encoding: 'utf8',
          },
        )
          .split('\0')
          .filter(Boolean)
          .map(file => path.join(gitRoot, file)),
      ]);
      extraInputs = [
        ...extraInputs,
        ...execFileSync(
          'git',
          [
            'ls-files',
            '--cached',
            '--others',
            '--exclude-standard',
            '-z',
            '--',
            ...pathspecs,
          ],
          { cwd: gitRoot, encoding: 'utf8' },
        )
          .split('\0')
          .filter(Boolean)
          .map(file => path.join(gitRoot, file)),
      ];
    } catch (error) {
      if (
        !(
          error &&
          typeof error === 'object' &&
          'status' in error &&
          error.status === 128
        )
      )
        throw error;
    }
    const snapshot = captureConfigSourceSnapshot({
      sourceRoots: [this.options.appDirectory],
      extraInputs,
    });
    for (const item of [...snapshot.states, ...snapshot.coverage])
      Object.freeze(item);
    for (const collection of [
      snapshot.sourceRoots,
      snapshot.extraInputs,
      snapshot.exclusions,
      snapshot.coverage,
      snapshot.states,
    ])
      Object.freeze(collection);
    return Object.freeze(snapshot);
  }

  private hasGeneratedOutputPermission(
    state: ConfigSourceSnapshot['states'][number],
  ): boolean {
    const lease = this.receiptLease;
    if (
      !lease ||
      state.kind === 'symlink' ||
      this.trackedInputs.has(state.path) ||
      this.trackedInputs.has(state.resolvedPath ?? state.path)
    )
      return false;
    const permission = lease.permission(state.path);
    if (!permission) return false;
    const owned = lease.receipts.some(({ receipt }) =>
      isDeepStrictEqual(
        rendererGeneratedOutputPermission(receipt, state.path),
        permission,
      ),
    );
    if (!owned)
      throw new Error(
        'React receiver permission differs from its exact pinned receipt',
      );
    return true;
  }

  private assertSelectedReceiptMembers(
    lease?: RendererGeneratedOutputIdentityLease,
  ): void {
    for (const { registration, receipt } of lease?.receipts ?? [])
      assertRendererGeneratedOutputReceiptNodesCurrent(registration, receipt, {
        generation: receipt.generation,
        nodes: receipt.nodes.filter(node =>
          isDeepStrictEqual(lease?.permission(node.path.lexical), node),
        ),
      });
  }

  private authoredStates(
    snapshot: ConfigSourceSnapshot,
    outputs: ReadonlySet<string>,
  ): string {
    const ignored = [
      this.options.internalDirectory,
      this.options.distDirectory,
      ...['.modern-js', '.ultramodern', '.modern'].map(name =>
        path.join(this.options.appDirectory, name),
      ),
    ].flatMap(directory => [
      directory,
      resolveConfigSourcePhysicalPath(directory),
    ]);
    return JSON.stringify(
      snapshot.states.filter(
        state =>
          !outputs.has(state.path) &&
          !this.hasGeneratedOutputPermission(state) &&
          !(
            state.kind === 'file' &&
            state.resolvedPath &&
            outputs.has(state.resolvedPath)
          ) &&
          !ignored.some(directory => inside(directory, state.path)),
      ),
    );
  }

  assertAuthoredInputsUnchanged(): void {
    const previous = this.authoredStates(this.snapshot, this.outputs);
    const current = this.authoredStates(this.capture(), this.outputs);
    if (previous !== current) {
      const old = new Map(
        (JSON.parse(previous) as ConfigSourceSnapshot['states']).map(state => [
          state.path,
          JSON.stringify(state),
        ]),
      );
      const next = new Map(
        (JSON.parse(current) as ConfigSourceSnapshot['states']).map(state => [
          state.path,
          JSON.stringify(state),
        ]),
      );
      const changed = [...new Set([...old.keys(), ...next.keys()])].filter(
        filename => old.get(filename) !== next.get(filename),
      );
      throw new Error(
        `React authored inputs changed during typed CSS production: ${changed.slice(0, 10).join(', ')}`,
      );
    }
  }

  install(api: RsbuildPluginAPI): void {
    let completeNative:
      | ((stats: Rspack.Stats | Rspack.MultiStats) => Promise<void>)
      | undefined;
    let checkpointNative: typeof completeNative;
    if (this.options.bindRuntimeIdentity) {
      api.onBeforeBuild(({ isWatch }) => {
        if (isWatch)
          throw new Error(
            'React production build --watch cannot publish a finalized runtime identity; use dev for watched compilation',
          );
      });
      api.modifyBundlerChain({
        order: 'post',
        handler: chain => {
          if (chain.plugins.has('globalVars'))
            chain.plugin('globalVars').tap(args => {
              const definitions = { ...args[0] };
              delete definitions.ULTRAMODERN_BUILD_MARKER;
              delete definitions.ULTRAMODERN_SOURCE_REVISION;
              return [definitions, ...args.slice(1)];
            });
          chain
            .plugin('ultramodern-react-runtime-identity')
            .use(rspack.DefinePlugin, [
              {
                ULTRAMODERN_BUILD_MARKER: REACT_BUILD_MARKER_EXPRESSION,
                ULTRAMODERN_SOURCE_REVISION: REACT_SOURCE_REVISION_EXPRESSION,
              },
            ]);
        },
      });
      api.modifyRspackConfig({
        order: 'post',
        handler: config => {
          config.plugins = config.plugins?.filter(
            plugin => !isUltramodernReleaseIdentityBannerPlugin(plugin),
          );
          config.plugins ??= [];
          config.plugins.push(
            new rspack.BannerPlugin({
              banner: () => {
                if (this.discovering) return '';
                const identity = this.runtimeIdentities;
                if (!identity)
                  throw new Error(
                    'React emitting asset has no finalized runtime identity',
                  );
                return `void ${JSON.stringify(identity.buildMarker)};void ${JSON.stringify(identity.sourceRevision)};`;
              },
              raw: true,
              stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
              test: /\.(?:c|m)?js$/u,
            }),
          );
          return config;
        },
      });
    }
    if (this.options.publishDevelopment) {
      api.modifyRsbuildConfig(config => {
        if (config.mode !== undefined && config.mode !== 'development')
          throw new Error(
            'React development metadata requires a development build configuration',
          );
        // The native dev action owns mode before Rsbuild's ambient NODE_ENV
        // fallback; an externally set production value must not relabel dev.
        return { ...config, mode: 'development' };
      });
      api.onDevCompileDone({
        order: 'pre',
        handler: async ({ stats }) => {
          if (this.discovering) return;
          if (!completeNative)
            throw new Error(
              'React development metadata has no owning compiler',
            );
          // Ordinary compile errors must leave native watch active. Returning
          // normally here lets the compiler rearm for the next authored edit.
          if (stats.hasErrors()) {
            this.options.generatedOutputs?.assertCompilerGraph?.(stats);
            const generation = this.compilerGeneration;
            if (!generation)
              throw new Error(
                'React metadata has no owning native compiler generation',
              );
            generation.rejectReady(
              new Error('React development compilation failed'),
            );
            if (this.reservedGeneration?.generation === generation.epoch + 1)
              this.reservedGeneration = undefined;
            if (this.compilerGeneration === generation)
              this.compilerGeneration = undefined;
            if (generation.epoch === this.epoch) {
              this.completed = true;
              this.started = false;
            }
            return;
          }
          await completeNative(stats);
        },
      });
    } else {
      api.onAfterBuild({
        order: 'pre',
        handler: async ({ stats }) => {
          if (this.discovering) return;
          if (!completeNative || !stats)
            throw new Error(
              'React build metadata requires a completed native compiler',
            );
          // Rsbuild owns this completion before MultiCompiler.done. Waiting
          // for aggregate done here would hold the child done callbacks open.
          await completeNative(stats);
        },
      });
    }
    api.onAfterBuild(async () => {
      if (this.discovering) return;
      await this.resolveIdentities();
    });
    api.modifyRspackConfig((config, { environment }) => {
      if (this.options.produceTypedCss === false) return config;
      if (environment.config.output.target !== 'web') return config;
      let matches = 0;
      const visit = (
        rules: NonNullable<
          NonNullable<Rspack.Configuration['module']>['rules']
        >,
      ): void => {
        for (const rule of rules) {
          if (!rule || typeof rule !== 'object') continue;
          if (rule.rules) visit(rule.rules);
          if (rule.oneOf) visit(rule.oneOf);
          if (!Array.isArray(rule.use)) continue;
          rule.use = rule.use.map(use => {
            if (
              !use ||
              typeof use !== 'object' ||
              typeof use.loader !== 'string' ||
              !/[\\/]plugin-typed-css-modules[\\/]dist[\\/]loader\.cjs$/u.test(
                use.loader,
              )
            )
              return use;
            const producerPath = fs.realpathSync(use.loader);
            const manifest = JSON.parse(
              fs.readFileSync(
                path.join(path.dirname(producerPath), '..', 'package.json'),
                'utf8',
              ),
            );
            if (
              manifest.name !== '@rsbuild/plugin-typed-css-modules' ||
              manifest.version !== PRODUCER_VERSION
            )
              throw new Error(
                'React typed CSS metadata requires its supported native producer',
              );
            if (typeof use.options !== 'object' || use.options === null)
              throw new Error(
                'React typed CSS producer has unsupported loader options',
              );
            const producerDigest = digest(producerPath);
            this.producers.set(producerPath, producerDigest);
            matches++;
            return {
              ...use,
              loader: this.loader,
              options: {
                producerPath,
                producerDigest,
                producerVersion: PRODUCER_VERSION,
                producerOptions: use.options,
              },
            };
          });
        }
      };
      visit(config.module?.rules ?? []);
      if (!matches)
        throw new Error(
          'React typed CSS metadata found no configured native producer',
        );
      return config;
    });

    const installCompiler = (
      compiler: Rspack.Compiler | Rspack.MultiCompiler,
      environments: Record<string, EnvironmentContext>,
    ) => {
      if (this.options.publishDevelopment && api.context.action !== 'dev')
        throw new Error(
          'React development metadata requires a native dev compiler',
        );
      const compilers =
        'compilers' in compiler ? compiler.compilers : [compiler];
      if (this.options.bindRuntimeIdentity)
        for (const candidate of compilers)
          installReactBuildMarkerBinding(candidate, rspack, {
            getBinding: () => this.runtimeIdentities,
            shouldEmit: () => !this.discovering,
          });
      const web = compilers.filter(
        candidate =>
          environments[candidate.options.name ?? '']?.config.output.target ===
          'web',
      );
      const client = web.find(candidate => candidate.options.name === 'client');
      const observed = new Map<string, ProducerRecord[]>();
      const currentCompilations = new Map<
        Rspack.Compiler,
        Rspack.Compilation
      >();
      let observedPass: boolean | undefined;
      let discoveryCompletion: Promise<void> | undefined;
      let failedGeneration: typeof this.compilerGeneration;
      const finishFailedGeneration = () => {
        const generation = failedGeneration;
        if (
          !generation ||
          compilers.some(candidate =>
            candidate.watching ? candidate.watching.running : candidate.running,
          )
        )
          return;
        failedGeneration = undefined;
        if (this.reservedGeneration?.generation === generation.epoch + 1)
          this.reservedGeneration = undefined;
        if (this.compilerGeneration === generation)
          this.compilerGeneration = undefined;
        if (generation.epoch === this.epoch) {
          this.completed = true;
          this.started = false;
        }
      };
      if (
        !client ||
        compilers.some(candidate => !environments[candidate.options.name ?? ''])
      )
        throw new Error(
          'React typed CSS metadata requires the actual client and named compiler environments',
        );
      const prepareGeneration = async () => {
        await this.finalization.catch(() => {});
        if (this.closed)
          throw new Error('React compiler closed before metadata preparation');
        if (this.started) {
          if (!this.discovering) {
            await this.options.generatedOutputs?.waitForIdle();
            const lease = await this.options.generatedOutputs?.pinReceipts();
            this.receiptLease = lease;
            try {
              await lease?.assertCurrent();
              this.assertSelectedReceiptMembers(lease);
              this.assertAuthoredInputsUnchanged();
              await lease?.assertCurrent();
            } finally {
              lease?.release();
              if (this.receiptLease === lease) this.receiptLease = undefined;
            }
          }
          return;
        }
        // Unfinished receiver IO must settle before a native generation may
        // capture a fresh baseline. A BEGIN reservation already owns its
        // pre-write baseline and must never be recaptured here.
        await this.options.generatedOutputs?.waitForIdle();
        if (this.closed)
          throw new Error('React compiler closed before receiver completion');
        if (this.completed && !this.reservedGeneration) {
          this.epoch++;
          this.currentGeneration = undefined;
          this.snapshot = this.capture();
          this.outputs = new Set();
          this.completed = false;
          this.resetReady();
        }
        const generation =
          this.reservedGeneration ?? this.currentGeneratedOutputGeneration();
        generation.assertCurrent();
        this.options.generatedOutputs?.bindGeneration?.(generation);
        this.reservedGeneration = undefined;
        const epoch = this.epoch;
        const lease = await this.options.generatedOutputs?.pinReceipts();
        if (this.closed || epoch !== this.epoch) {
          lease?.release();
          throw new Error(
            'React receiver generation changed during preparation',
          );
        }
        this.receiptLease = lease;
        try {
          await lease?.assertCurrent();
          this.assertSelectedReceiptMembers(lease);
          this.assertAuthoredInputsUnchanged();
          await lease?.assertCurrent();
          generation.assertCurrent();
          this.started = true;
          this.compilerGeneration = {
            epoch,
            resolveReady: this.resolveReady,
            rejectReady: this.rejectReady,
          };
        } finally {
          // Native receiver IO can begin later in processAssets. This lease
          // guards preparation only; finalization pins its completed revision.
          lease?.release();
          if (this.receiptLease === lease) this.receiptLease = undefined;
        }
      };
      const prepare = () => {
        if (!this.preparation) {
          const pending = prepareGeneration();
          this.preparation = pending;
          void pending
            .finally(() => {
              if (this.preparation === pending) this.preparation = undefined;
            })
            .catch(() => {});
        }
        return this.preparation;
      };
      const finalize = async (inputStats: Rspack.Stats | Rspack.MultiStats) => {
        const discovery = this.discovering;
        // Native aggregates retain an array that later child completions reuse.
        // Keep this callback bound to the actual member compilations it began.
        const stats =
          'stats' in inputStats
            ? new rspack.MultiStats([...inputStats.stats])
            : inputStats;
        const compilerGeneration = this.compilerGeneration;
        if (!compilerGeneration)
          throw new Error(
            'React metadata has no owning native compiler generation',
          );
        const { epoch, resolveReady, rejectReady } = compilerGeneration;
        let lease: RendererGeneratedOutputIdentityLease | undefined;
        this.finalizingEpoch = epoch;
        if (this.reservedGeneration?.generation === epoch + 1)
          this.reservedGeneration = undefined;
        const assertCurrent = () => {
          if (this.closed || epoch !== this.epoch)
            throw new Error(
              'React compiler metadata generation is no longer active',
            );
        };
        const assertPinned = async () => {
          assertCurrent();
          this.options.generatedOutputs?.assertCompilerGraph?.(stats);
          await lease?.assertCurrent();
          assertCurrent();
          this.options.generatedOutputs?.assertCompilerGraph?.(stats);
        };
        try {
          assertCurrent();
          if (stats.hasErrors())
            throw new Error('React typed CSS compilation failed');
          this.options.generatedOutputs?.assertCompilerGraph?.(stats);
          await this.options.generatedOutputs?.waitForIdle();
          assertCurrent();
          lease = await this.options.generatedOutputs?.pinReceipts();
          assertCurrent();
          this.receiptLease = lease;
          const finalizeAndPublish = async () => {
            await assertPinned();
            this.assertSelectedReceiptMembers(lease);
            const results = 'stats' in stats ? stats.stats : [stats];
            const outputs = new Set<string>();
            for (const producer of this.options.produceTypedCss === false
              ? []
              : web) {
              const records = observed.get(producer.options.name!);
              if (!records)
                throw new Error(
                  'React typed CSS compiler has no completed native producer observation',
                );
              for (const record of records) {
                if (
                  !record ||
                  record.version !== 1 ||
                  record.producerVersion !== PRODUCER_VERSION ||
                  this.producers.get(record.producerPath) !==
                    record.producerDigest ||
                  typeof record.produced !== 'boolean' ||
                  digest(record.sourcePath) !== record.sourceDigest
                )
                  throw new Error(
                    'React typed CSS cached module has no supported native producer acknowledgment',
                  );
                if (!record.produced) continue;
                if (
                  record.outputPath !== `${record.sourcePath}.d.ts` ||
                  !record.outputDigest ||
                  digest(record.outputPath) !== record.outputDigest
                )
                  throw new Error(
                    `React typed CSS cached producer output is missing or changed (${producer.options.name}, discovery=${discovery}, recorded=${record.outputDigest}, actual=${record.outputPath ? digest(record.outputPath) : 'missing'})`,
                  );
                if (
                  !this.snapshot.states.some(
                    state =>
                      state.kind === 'file' &&
                      (state.path === record.sourcePath ||
                        state.resolvedPath === record.sourcePath),
                  )
                )
                  throw new Error(
                    'React typed CSS producer source is outside the authored input capture',
                  );
                outputs.add(record.outputPath);
              }
            }
            await assertPinned();
            this.outputs = outputs;
            this.assertAuthoredInputsUnchanged();
            await assertPinned();
            const identities = await this.options.finalize(stats, lease);
            await assertPinned();
            this.assertAuthoredInputsUnchanged();
            if (discovery) {
              this.runtimeIdentities = identities;
              return identities;
            }
            if (this.options.bindRuntimeIdentity) {
              if (!this.runtimeIdentities)
                throw new Error(
                  'React emitting compiler has no private discovery identity',
                );
              assertRendererBuildInputsUnchanged(
                this.runtimeIdentities,
                identities,
              );
            }
            await assertPinned();
            const clientCompilation = results.find(
              result => result.compilation.name === 'client',
            )?.compilation;
            if (!clientCompilation)
              throw new Error(
                'React typed CSS metadata has no completed client compilation',
              );
            for (const [filename, outputMetadata] of this.htmlOutputs) {
              assertCurrent();
              const { entryName, token } = outputMetadata;
              const identity = identities.identities[entryName];
              const asset = clientCompilation.getAsset(filename);
              if (!identity || !asset)
                throw new Error(
                  `React typed CSS HTML output has no final entry identity: ${filename}`,
                );
              const original = asset.source.source().toString();
              if (original.split(token).length !== 2)
                throw new Error(
                  `React typed CSS HTML output lost its owning metadata token: ${filename}`,
                );
              const serialized = escapeInlineDataJSON(JSON.stringify(identity));
              const html = original.replace(token, serialized);
              clientCompilation.updateAsset(
                filename,
                new rspack.sources.RawSource(html),
              );
              const output = path.join(
                clientCompilation.outputOptions.path!,
                filename,
              );
              const outputFileSystem = client.outputFileSystem;
              if (!outputFileSystem?.writeFile)
                throw new Error(
                  'React typed CSS metadata has no native output filesystem',
                );
              await assertPinned();
              await new Promise<void>((resolve, reject) =>
                outputFileSystem.writeFile(output, html, error =>
                  error ? reject(error) : resolve(),
                ),
              );
              await assertPinned();
              // Native HTML caching may reuse this asset in a later HMR wave.
              // Retain the actual owned identity bytes until the HTML hook emits
              // a fresh token, so an unchanged entry receives the new identity.
              outputMetadata.token = serialized;
            }
            this.assertAuthoredInputsUnchanged();
            await assertPinned();
            await (
              this.options.publishDevelopment ?? this.options.publishMetadata
            )?.(stats, identities, assertCurrent);
            await assertPinned();
            this.assertAuthoredInputsUnchanged();
            await assertPinned();
            return identities;
          };
          const identities = lease
            ? await lease.withPublication(finalizeAndPublish)
            : await finalizeAndPublish();
          if (discovery) return;
          // BEGIN admission resumes when the fence releases. A queued next
          // generation may already own current fields; settle this wave's
          // captured readiness without overwriting that new generation.
          if (epoch === this.epoch) this.finalized = true;
          resolveReady(identities);
        } catch (error) {
          rejectReady(
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        } finally {
          lease?.release();
          if (this.receiptLease === lease) this.receiptLease = undefined;
          if (this.finalizingEpoch === epoch) this.finalizingEpoch = undefined;
          if (!discovery && this.compilerGeneration === compilerGeneration)
            this.compilerGeneration = undefined;
          if (!discovery && epoch === this.epoch) {
            this.completed = true;
            this.started = false;
          }
        }
      };
      const complete = (stats: Rspack.Stats | Rspack.MultiStats) => {
        if (this.discovering && discoveryCompletion) return discoveryCompletion;
        if (!this.compilerGeneration) return this.finalization;
        if (this.finalizingEpoch === this.compilerGeneration.epoch)
          return this.finalization;
        this.finalization = finalize(stats);
        if (this.discovering) discoveryCompletion = this.finalization;
        void this.finalization.catch(() => {});
        return this.finalization;
      };
      completeNative = complete;
      checkpointNative = complete;
      if (!this.options.publishDevelopment && 'compilers' in compiler)
        compiler.hooks.done.tap('ultramodern:react:typed-css', stats => {
          // MultiCompiler retains earlier child stats across public run calls.
          // A dependent child may not have started this pass when done fires.
          if (
            currentCompilations.size !== compilers.length ||
            stats.stats.some(
              result =>
                currentCompilations.get(result.compilation.compiler) !==
                result.compilation,
            )
          )
            return;
          void complete(stats);
        });
      else if (!this.options.publishDevelopment)
        compiler.hooks.done.tapPromise('ultramodern:react:typed-css', complete);
      for (const candidate of compilers) {
        let nativeGeneration: typeof this.compilerGeneration;
        const prepareCandidate = async () => {
          nativeGeneration = undefined;
          if (observedPass !== this.discovering) {
            observedPass = this.discovering;
            observed.clear();
            currentCompilations.clear();
          }
          try {
            await prepare();
          } finally {
            nativeGeneration = this.compilerGeneration ?? {
              epoch: this.epoch,
              resolveReady: this.resolveReady,
              rejectReady: this.rejectReady,
            };
          }
        };
        candidate.hooks.beforeRun.tapPromise(
          'ultramodern:react:typed-css',
          prepareCandidate,
        );
        candidate.hooks.watchRun.tapPromise(
          'ultramodern:react:typed-css',
          prepareCandidate,
        );
        candidate.hooks.thisCompilation.tap(
          'ultramodern:react:graph-pass',
          compilation => {
            currentCompilations.set(candidate, compilation);
          },
        );
        if (this.options.produceTypedCss !== false && web.includes(candidate))
          candidate.hooks.thisCompilation.tap(
            'ultramodern:react:typed-css',
            compilation => {
              const fresh = new Map<string, ProducerRecord>();
              const owners = new Map<string, Set<Rspack.Module['buildInfo']>>();
              rspack.NormalModule.getCompilationHooks(compilation).loader.tap(
                'ultramodern:react:typed-css',
                (loaderContext, module) => {
                  if (
                    loaderContext.loaders.some(
                      loader => loader.path === this.loader,
                    )
                  ) {
                    const records =
                      owners.get(loaderContext.resource) ??
                      new Set<Rspack.Module['buildInfo']>();
                    records.add(module.buildInfo);
                    owners.set(loaderContext.resource, records);
                  }
                  Object.defineProperty(
                    loaderContext,
                    'ultramodernReactTypedCssProduced',
                    {
                      value: (record: ProducerRecord) => {
                        fresh.set(loaderContext.resource, record);
                        for (const buildInfo of owners.get(
                          loaderContext.resource,
                        ) ?? [])
                          buildInfo[RECORD_KEY] = record;
                      },
                      configurable: true,
                    },
                  );
                },
              );
              compilation.hooks.finishModules.tap(
                'ultramodern:react:typed-css',
                modules => {
                  if (compilation.errors.length) return;
                  const records: ProducerRecord[] = [];
                  for (const module of modules) {
                    const normal = module as Rspack.NormalModule;
                    if (
                      !normal.loaders?.some(
                        loader =>
                          loader.loader === this.loader ||
                          loader.loader.startsWith(`${this.loader}?`),
                      )
                    )
                      continue;
                    const record =
                      (normal.buildInfo[RECORD_KEY] as
                        | ProducerRecord
                        | undefined) ?? fresh.get(normal.resource);
                    if (
                      !record ||
                      !(
                        normal.resource === record.sourcePath ||
                        normal.resource?.startsWith(`${record.sourcePath}?`) ||
                        normal.resource?.startsWith(`${record.sourcePath}#`)
                      )
                    )
                      throw new Error(
                        `React typed CSS cached module has no supported native producer acknowledgment (fresh=${fresh.size}, resource=${normal.resource}, record=${record?.sourcePath})`,
                      );
                    records.push({ ...record });
                  }
                  observed.set(candidate.options.name!, records);
                },
              );
            },
          );
        candidate.hooks.failed.tap('ultramodern:react:typed-css', error => {
          if ('compilers' in compiler) {
            const generation = nativeGeneration ?? {
              epoch: this.epoch,
              resolveReady: this.resolveReady,
              rejectReady: this.rejectReady,
            };
            generation.rejectReady(error);
            failedGeneration = generation;
            finishFailedGeneration();
          } else {
            this.fail(error);
            this.completed = true;
            this.started = false;
          }
        });
        if ('compilers' in compiler) {
          candidate.hooks.afterDone.tap(
            'ultramodern:react:typed-css',
            finishFailedGeneration,
          );
          candidate.hooks.watchClose.tap(
            'ultramodern:react:typed-css',
            finishFailedGeneration,
          );
        }
        candidate.hooks.done.tap('ultramodern:react:typed-css', stats => {
          if (stats.hasErrors()) {
            const generation = nativeGeneration;
            generation?.rejectReady(
              new Error('React typed CSS compilation failed'),
            );
            // A sibling may still be in processAssets. The aggregate graph
            // owns completion; advancing here would recapture its baseline.
            if (
              !('compilers' in compiler) &&
              generation?.epoch === this.epoch
            ) {
              this.completed = true;
              this.started = false;
            }
          }
        });
        candidate.hooks.shutdown.tap('ultramodern:react:typed-css', () => {
          this.closed = true;
          this.receiptLease?.release();
          this.receiptLease = undefined;
          if (!this.finalized)
            this.fail(
              new Error(
                'React typed CSS compiler closed before identity finalization',
              ),
            );
        });
      }
    };
    api.onAfterCreateCompiler(({ compiler, environments }) =>
      installCompiler(compiler, environments),
    );
    const discover = async (
      compiler: Rspack.Compiler | Rspack.MultiCompiler,
    ) => {
      const stats = await new Promise<Rspack.Stats | Rspack.MultiStats>(
        (resolve, reject) =>
          compiler.run((error, result) => {
            if (error) reject(error);
            else if (!result)
              reject(new Error('React discovery compiler returned no graph'));
            else resolve(result);
          }),
      );
      if (!checkpointNative)
        throw new Error('React discovery has no owning compiler checkpoint');
      await checkpointNative(stats);
      if (!this.runtimeIdentities)
        throw new Error(
          'React discovery did not finalize its runtime identity',
        );
    };
    const closeCompiler = (compiler: Rspack.Compiler | Rspack.MultiCompiler) =>
      new Promise<void>((resolve, reject) =>
        compiler.close(error => (error ? reject(error) : resolve())),
      );
    const discoverPreparedCompiler = async (
      { compiler }: { compiler: Rspack.Compiler | Rspack.MultiCompiler },
      closeOnFailure: boolean,
    ) => {
      this.discovering = true;
      try {
        await discover(compiler);
      } catch (error) {
        this.fail(error);
        if (closeOnFailure)
          try {
            await closeCompiler(compiler);
          } catch (closeError) {
            throw new AggregateError(
              [error, closeError],
              'React discovery failed and its native compiler could not close',
            );
          }
        throw error;
      } finally {
        this.discovering = false;
      }
    };
    if (this.options.bindRuntimeIdentity) {
      if (this.options.publishDevelopment)
        api.onAfterPrepareDevCompiler({
          order: 'post',
          // The native prepared-dev boundary owns compiler cleanup on failure.
          handler: args => discoverPreparedCompiler(args, false),
        });
      else
        api.onAfterCreateCompiler({
          order: 'post',
          handler: args => discoverPreparedCompiler(args, true),
        });
    }
  }

  private fail(error: unknown): void {
    this.rejectReady(error instanceof Error ? error : new Error(String(error)));
  }
}
