import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { RendererGeneratedOutputIdentityLease } from '@modern-js/app-tools-extensions/renderer-build-identity';
import type {
  RendererGeneratedOutputCurrentNodes,
  RendererGeneratedOutputGeneration,
  RendererGeneratedOutputNode,
  RendererGeneratedOutputPath,
  RendererGeneratedOutputRegistrationInput,
} from '@modern-js/app-tools-extensions/renderer-generated-outputs';
import type { Rspack } from '@rsbuild/core';
import type { ObservedConfigSourceInput } from './config-evaluator/observed-inputs';
import {
  assertConfigSourceSymlinkTraversal,
  resolveConfigSourcePhysicalPath,
} from './config-evaluator/source-snapshot';
import {
  getConfigurationSourceInputs,
  getConfigurationSourceNodes,
  getConfigurationSourceSnapshot,
} from './configuration-read-context';
import {
  reactAuthoredInputPaths,
  reactAuthoredSourceNamespaces,
  reactInputGitPathspecs,
} from './react-authored-inputs';
import type { ReactBuildMetadataOptions } from './react-build-metadata';
import {
  resolveReactReceiverDestinations,
  resolveReactReceiverImplementation,
  resolveReactReceiverProducer,
} from './react-mf-dts-producer';
import {
  createReceiverRegistry,
  type ReceiverBeginDetails,
  type ReceiverFrame,
  type ReceiverRegistry,
  type ReceiverSeed,
} from './react-mf-dts-registry';
import type {
  ReactGeneratedOutputGeneration,
  ReactTypedCssPhase,
} from './react-typed-css-phase';

const NATIVE_CLIENT_PLUGIN = 'plugin-module-federation';
const COMPILER_OWNER_PLUGIN = 'ultramodern-react-mf-receiver-owner';

type SourceNode = Readonly<{
  observation: ObservedConfigSourceInput;
  node: RendererGeneratedOutputNode;
  requiredAncestors?: readonly RendererGeneratedOutputNode[];
}>;

interface ReactReceiverNativePlugin {
  readonly name?: string;
  apply(compiler: Rspack.Compiler): void;
}

type ReactReceiverNativePluginConstructor = new (
  ...args: unknown[]
) => ReactReceiverNativePlugin;

export interface ReactReceiverImplementation {
  readonly EXTRA_OPTIONS_KEY: string;
  createIsolatedReactFederationPlugin(
    NativeConstructor: ReactReceiverNativePluginConstructor,
  ): ReactReceiverNativePluginConstructor;
  installReceiverRegistry(registry: ReceiverRegistry): () => void;
  observeReceiverNodes(
    registration: Pick<
      RendererGeneratedOutputRegistrationInput,
      'consumer' | 'generation'
    >,
    nodes: readonly RendererGeneratedOutputNode[],
  ): RendererGeneratedOutputCurrentNodes;
}

/** Internal dependency seams; these are not application configuration options. */
export interface ReactReceiverOutputIntegrationOptions {
  resolveImplementation?: () => string;
  loadImplementation?: (filename: string) => ReactReceiverImplementation;
  resolveProducer?: typeof resolveReactReceiverProducer;
  resolveDestinations?: typeof resolveReactReceiverDestinations;
  sourceNodes?: typeof getConfigurationSourceNodes;
  trackedInputs?: (
    appDirectory: string,
    inputPaths: readonly string[],
  ) => Promise<readonly string[]>;
}

type BuildContext = Parameters<
  NonNullable<ReactBuildMetadataOptions['generatedOutputs']>['bindPhase']
>[1];

interface CompilerOwner {
  readonly name: string;
  readonly seed: ReceiverSeed;
  readonly originalNativeConstructor: ReactReceiverNativePluginConstructor;
  readonly nativeConstructor: ReactReceiverNativePluginConstructor;
  readonly companionPlugins: Set<ReactReceiverNativePlugin>;
  readonly workers: Map<
    number,
    Readonly<{ pid: number; closed: Promise<void> }>
  >;
  nativePlugin?: ReactReceiverNativePlugin;
  companionPlugin?: ReactReceiverNativePlugin;
  compiler?: Rspack.Compiler;
}

function assertCompilerOwnerPlugins(
  owner: CompilerOwner,
  plugins: Rspack.Configuration['plugins'],
): void {
  if (
    !owner.nativePlugin ||
    !owner.companionPlugin ||
    plugins?.filter(plugin => plugin === owner.nativePlugin).length !== 1 ||
    plugins?.filter(plugin => plugin === owner.companionPlugin).length !== 1 ||
    plugins?.filter(
      plugin =>
        plugin instanceof owner.nativeConstructor ||
        plugin instanceof owner.originalNativeConstructor,
    ).length !== 1 ||
    plugins?.filter(plugin =>
      owner.companionPlugins.has(plugin as ReactReceiverNativePlugin),
    ).length !== 1
  )
    throw new Error('React receiver native compiler plugin ownership changed');
}

interface Wave {
  readonly reservation: ReactGeneratedOutputGeneration;
  readonly operationId: string;
  readonly revision: string;
}

type PriorReceipt = Pick<
  ReturnType<ReceiverRegistry['completedReceipts']>[number],
  'registration' | 'selectedNodes'
>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function runGit(
  appDirectory: string,
  args: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      { cwd: appDirectory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

async function trackedInputs(
  appDirectory: string,
  inputPaths: readonly string[],
): Promise<readonly string[]> {
  let root: string;
  try {
    root = (
      await runGit(appDirectory, ['rev-parse', '--show-toplevel'])
    ).trim();
  } catch (error) {
    if (record(error) && error.code === 128) return [];
    throw error;
  }
  return (
    await runGit(root, [
      'ls-files',
      '--cached',
      '-z',
      '--',
      ...reactInputGitPathspecs(root, inputPaths),
    ])
  )
    .split('\0')
    .filter(Boolean)
    .map(filename => path.join(root, filename));
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

/** Attribute native receiver IO to the existing React compiler and its baseline. */
export function createReactReceiverOutputIntegration(
  options: ReactReceiverOutputIntegrationOptions = {},
): {
  plugin: CliPlugin<AppTools>;
  controller: NonNullable<ReactBuildMetadataOptions['generatedOutputs']>;
} {
  const owners = new Map<string, CompilerOwner>();
  const frames = new Map<string, ReactGeneratedOutputGeneration>();
  const publications = new Set<Promise<unknown>>();
  let phase: ReactTypedCssPhase | undefined;
  let context: BuildContext | undefined;
  let wave: Wave | undefined;
  let implementation: ReactReceiverImplementation | undefined;
  let implementationPath: string | undefined;
  let restoreImplementation: (() => void) | undefined;
  let inputs: ReturnType<typeof getConfigurationSourceInputs>;
  let baseline: ReturnType<typeof getConfigurationSourceSnapshot>;
  let sourceNodes: readonly SourceNode[] | undefined;
  let preparing = 0;
  let graph:
    | Readonly<{
        authority: object;
        cohort: object;
        producer: RendererGeneratedOutputRegistrationInput['producer'];
      }>
    | undefined;
  let disposed = false;
  let exiting = false;
  let rejectExit!: (error: Error) => void;
  const exit = new Promise<never>((_resolve, reject) => {
    rejectExit = reject;
  });
  void exit.catch(() => {});

  function assertOpen(): void {
    if (disposed || exiting)
      throw new Error('React receiver output controller is closed');
  }

  function generation(owner: CompilerOwner): RendererGeneratedOutputGeneration {
    if (!wave) throw new Error('React receiver has no compiler generation');
    return {
      operationId: wave.operationId,
      compilerId: owner.seed.compilerId,
      generation: wave.reservation.generation,
      revision: wave.revision,
    };
  }

  function assertWave(): void {
    if (disposed)
      throw new Error('React receiver output controller is disposed');
    if (!wave) throw new Error('React receiver has no reserved generation');
    wave.reservation.assertCurrent();
  }

  function assertConfigurationCurrent(): void {
    if (owners.size === 0) return;
    if (!context || !inputs || !baseline || !sourceNodes || !implementation)
      throw new Error(
        'React receiver requires the original observed configuration baseline',
      );
    if (
      context.consumedSourceInputs !== inputs ||
      context.configurationSourceSnapshot !== baseline ||
      context.configurationSourceNodes !== sourceNodes ||
      sourceNodes.length !==
        inputs.observations.length + inputs.packageMetadata.length ||
      sourceNodes.some(({ observation }, index) => {
        if (index < inputs!.observations.length)
          return observation !== inputs!.observations[index];
        const metadata =
          inputs!.packageMetadata[index - inputs!.observations.length];
        return (
          !metadata ||
          !Object.isFrozen(observation) ||
          !isDeepStrictEqual(observation, {
            path: metadata.path,
            canonicalPath: metadata.canonicalPath,
            operation: 'metadata',
            existed: true,
          })
        );
      })
    )
      throw new Error('React receiver configuration provenance has changed');
    for (const { observation, node } of sourceNodes) {
      assertConfigSourceSymlinkTraversal(baseline, observation.path);
      if (
        resolveConfigSourcePhysicalPath(observation.path) !==
        observation.canonicalPath
      )
        throw new Error(
          `React receiver configuration path changed: ${observation.path}`,
        );
      // Configuration may have traversed a captured workspace link. Read the
      // physical node only after validating that original link chain; receiver
      // output traversal itself never follows links.
      const physical = {
        ...node,
        path: {
          lexical: node.path.canonical,
          canonical: node.path.canonical,
        },
      };
      const current = implementation.observeReceiverNodes(
        {
          consumer: { id: 'configuration', projectRoot: context.appDirectory },
          generation: {
            operationId: 'configuration',
            compilerId: 'configuration',
            generation: 1,
            revision: 'configuration',
          },
        },
        [physical],
      ).nodes[0];
      if (!current || !isDeepStrictEqual({ ...current, path: node.path }, node))
        throw new Error(
          `React receiver configuration input changed: ${observation.path}`,
        );
    }
    for (const { requiredAncestors } of sourceNodes) {
      for (const ancestor of requiredAncestors ?? []) {
        assertConfigSourceSymlinkTraversal(baseline, ancestor.path.lexical);
        const current = implementation.observeReceiverNodes(
          {
            consumer: {
              id: 'configuration',
              projectRoot: context.appDirectory,
            },
            generation: {
              operationId: 'configuration',
              compilerId: 'configuration',
              generation: 1,
              revision: 'configuration',
            },
          },
          [
            {
              ...ancestor,
              path: {
                lexical: ancestor.path.canonical,
                canonical: ancestor.path.canonical,
              },
            },
          ],
        ).nodes[0];
        const matches =
          ancestor.kind === 'directory' && current?.kind === 'directory'
            ? current.path.canonical === ancestor.path.canonical &&
              ['device', 'inode', 'mode', 'uid', 'gid', 'birthtimeNs'].every(
                name => current.metadata[name] === ancestor.metadata[name],
              )
            : current &&
              isDeepStrictEqual({ ...current, path: ancestor.path }, ancestor);
        if (!matches)
          throw new Error(
            `React receiver configuration ancestry changed: ${ancestor.path.lexical}`,
          );
      }
    }
  }

  function assertActive(frame: ReceiverFrame): void {
    assertWave();
    const owner = [...owners.values()].find(
      candidate => candidate.seed.registrationId === frame.registrationId,
    );
    if (
      !owner ||
      !isDeepStrictEqual(generation(owner), {
        operationId: frame.operationId,
        compilerId: frame.compilerId,
        generation: frame.generation,
        revision: frame.revision,
      })
    )
      throw new Error('React receiver frame has a stale compiler owner');
  }

  function acknowledgedSourceNodes(
    priorReceipts: readonly PriorReceipt[],
  ): ReadonlySet<string> {
    const acknowledged = new Set<string>();
    for (const { registration, selectedNodes } of priorReceipts) {
      const current = implementation!.observeReceiverNodes(
        registration,
        selectedNodes,
      );
      if (!isDeepStrictEqual(current.nodes, selectedNodes))
        throw new Error('React receiver acknowledged output changed before IO');
      for (const node of selectedNodes) {
        acknowledged.add(node.path.lexical);
        acknowledged.add(node.path.canonical);
      }
    }
    return acknowledged;
  }

  function authoredSourceInputs(
    reservation: ReactGeneratedOutputGeneration,
    priorReceipts: readonly PriorReceipt[],
  ): readonly string[] {
    const { entries, directories } = reactAuthoredSourceNamespaces(context!);
    const acknowledged = acknowledgedSourceNodes(priorReceipts);
    const remember = (filename: string, canonical: string) => {
      if (!acknowledged.has(filename) && !acknowledged.has(canonical))
        entries.add(filename);
    };
    for (const state of reservation.snapshot.states) {
      if (state.kind === 'directory') continue;
      if (
        [...directories].some(
          directory =>
            inside(directory, state.path) ||
            (state.resolvedPath && inside(directory, state.resolvedPath)),
        )
      )
        remember(state.path, state.resolvedPath ?? state.path);
    }
    const visit = (filename: string, active: Set<string>): void => {
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(filename);
      } catch (error) {
        if (
          record(error) &&
          (error.code === 'ENOENT' || error.code === 'ENOTDIR')
        )
          return;
        throw error;
      }
      assertConfigSourceSymlinkTraversal(reservation.snapshot, filename);
      const canonical = resolveConfigSourcePhysicalPath(filename);
      if (stat.isSymbolicLink()) {
        remember(filename, canonical);
        if (active.has(canonical))
          throw new Error(
            `React authored source namespace has a cycle: ${filename}`,
          );
        const target = fs.statSync(filename);
        if (target.isDirectory()) {
          const next = new Set(active).add(canonical);
          for (const entry of fs.readdirSync(filename))
            visit(path.join(filename, entry), next);
        }
      } else if (stat.isDirectory()) {
        const children = fs.readdirSync(filename);
        if (children.length === 0) remember(filename, canonical);
        const next = new Set(active).add(canonical);
        for (const entry of children) visit(path.join(filename, entry), next);
      } else remember(filename, canonical);
    };
    for (const directory of directories) visit(directory, new Set());
    return [...entries];
  }

  function authoredFileInputs(
    reservation: ReactGeneratedOutputGeneration,
    authoredPaths: readonly RendererGeneratedOutputPath[],
    currentGeneration: RendererGeneratedOutputGeneration,
  ): RendererGeneratedOutputRegistrationInput['protectedInputs'] {
    const authored = new Set(
      authoredPaths.flatMap(input => [input.lexical, input.canonical]),
    );
    const original: RendererGeneratedOutputNode[] = [];
    for (const state of reservation.snapshot.states) {
      if (
        state.kind !== 'file' ||
        (!authored.has(state.path) &&
          !authored.has(state.resolvedPath ?? state.path))
      )
        continue;
      if (
        typeof state.resolvedPath !== 'string' ||
        typeof state.sha256 !== 'string' ||
        typeof state.dev !== 'string' ||
        typeof state.ino !== 'string' ||
        typeof state.ctimeNs !== 'string' ||
        typeof state.mode !== 'number'
      )
        throw new Error(
          `React receiver authored file has no original metadata: ${state.path}`,
        );
      assertConfigSourceSymlinkTraversal(reservation.snapshot, state.path);
      if (resolveConfigSourcePhysicalPath(state.path) !== state.resolvedPath)
        throw new Error(
          `React receiver authored file path changed: ${state.path}`,
        );
      original.push({
        path: { lexical: state.path, canonical: state.resolvedPath },
        kind: 'file',
        byteDigest: state.sha256,
        metadata: {
          device: state.dev,
          inode: state.ino,
          mode: state.mode,
          ctimeNs: state.ctimeNs,
        },
      });
    }
    const current = implementation!.observeReceiverNodes(
      {
        consumer: {
          id: context!.packageName || context!.appDirectory,
          projectRoot: context!.appDirectory,
        },
        generation: currentGeneration,
      },
      original.map(node => ({
        ...node,
        path: { lexical: node.path.canonical, canonical: node.path.canonical },
      })),
    );
    if (
      current.nodes.length !== original.length ||
      original.some((node, index) => {
        const fresh = current.nodes[index];
        return (
          node.kind !== 'file' ||
          fresh?.kind !== 'file' ||
          fresh.path.lexical !== node.path.canonical ||
          fresh.path.canonical !== node.path.canonical ||
          fresh.byteDigest !== node.byteDigest ||
          Object.entries(node.metadata).some(
            ([name, value]) => fresh.metadata[name] !== value,
          )
        );
      })
    )
      throw new Error('React receiver authored file changed before IO');
    return original.map(node => ({ observation: 'content', node }));
  }

  function bindWave(
    reservation: ReactGeneratedOutputGeneration,
    advance: boolean,
  ): void {
    reservation.assertCurrent();
    if (wave?.reservation.generation === reservation.generation) {
      if (wave.reservation.snapshot !== reservation.snapshot)
        throw new Error('React receiver generation baseline was recaptured');
      return;
    }
    if (frames.size || preparing > (advance ? 0 : 1))
      throw new Error('React receiver IO must settle before a new generation');
    wave = Object.freeze({
      reservation,
      operationId: randomUUID(),
      revision: randomUUID(),
    });
    if (advance)
      for (const owner of owners.values())
        if (reservation.generation > owner.seed.generation)
          registry.advanceGeneration(
            generation(owner),
            owner.seed.registrationId,
          );
  }

  const registry = createReceiverRegistry({
    usePreparedGeneration: true,
    sourceNamespaces() {
      assertOpen();
      assertWave();
      assertConfigurationCurrent();
      const { entries, directories } = reactAuthoredSourceNamespaces(context!);
      const paths = (filenames: ReadonlySet<string>) =>
        Object.freeze(
          [...filenames].map(filename => {
            assertConfigSourceSymlinkTraversal(
              wave!.reservation.snapshot,
              filename,
            );
            return Object.freeze({
              lexical: filename,
              canonical: resolveConfigSourcePhysicalPath(filename),
            });
          }),
        );
      return Object.freeze({
        entries: paths(entries),
        dirs: paths(directories),
      });
    },
    graphEpoch() {
      if (!graph || !wave)
        throw new Error('React receiver compiler graph has not been sealed');
      assertWave();
      return {
        authority: graph.authority,
        cohort: graph.cohort,
        operationId: wave.operationId,
        generation: wave.reservation.generation,
        revision: wave.revision,
      };
    },
    async prepareRegistration(
      seed,
      details: ReceiverBeginDetails,
      priorReceipts,
    ) {
      assertOpen();
      const owner = [...owners.values()].find(
        candidate => candidate.seed.registrationId === seed.registrationId,
      );
      if (!owner || !isDeepStrictEqual(owner.seed, seed))
        throw new Error('React receiver seed is not an owning native compiler');
      if (!phase || !context || !implementation || !implementationPath)
        throw new Error(
          'React receiver began before its native phase was bound',
        );
      assertConfigurationCurrent();
      acknowledgedSourceNodes(priorReceipts);
      preparing++;
      try {
        const reservation =
          frames.size || preparing > 1
            ? wave?.reservation
            : phase.reserveGeneratedOutputGeneration();
        if (!reservation)
          throw new Error('React receiver has no pending initial generation');
        bindWave(reservation, false);
        assertConfigurationCurrent();
        // Invalidation schedules the public watch. Awaiting its completion
        // callback here would deadlock watchRun against this receiver frame.
        if (phase.shouldScheduleGeneratedOutputWatch(reservation))
          owner.compiler?.watching?.invalidate();
        const producer = await (
          options.resolveProducer ?? resolveReactReceiverProducer
        )({ appDirectory: context.appDirectory, implementationPath });
        assertOpen();
        assertWave();
        assertConfigurationCurrent();
        if (!graph || !isDeepStrictEqual(producer, graph.producer))
          throw new Error(
            'React receiver producer differs from its sealed graph',
          );
        const resolved = await (
          options.resolveDestinations ?? resolveReactReceiverDestinations
        )(details);
        assertOpen();
        assertWave();
        assertConfigurationCurrent();
        const tracked = await (options.trackedInputs ?? trackedInputs)(
          context.appDirectory,
          reactAuthoredInputPaths(context),
        );
        assertOpen();
        assertWave();
        assertConfigurationCurrent();
        const authoredPaths: RendererGeneratedOutputPath[] = [
          ...new Set([
            ...tracked,
            ...authoredSourceInputs(reservation, priorReceipts),
          ]),
        ].map(filename => {
          const lexical = path.resolve(filename);
          assertConfigSourceSymlinkTraversal(reservation.snapshot, lexical);
          return {
            lexical,
            canonical: resolveConfigSourcePhysicalPath(lexical),
          };
        });
        const protectedAuthoredFiles = authoredFileInputs(
          reservation,
          authoredPaths,
          generation(owner),
        );
        return {
          schemaVersion: 1,
          id: seed.registrationId,
          pathFlavor: path.sep === '\\' ? 'win32' : 'posix',
          producer,
          consumer: {
            id: context.packageName || context.appDirectory,
            projectRoot: context.appDirectory,
          },
          generation: generation(owner),
          effectiveOptions: resolved.effectiveOptions,
          context: resolved.context,
          destinations: resolved.destinations,
          authoredPaths,
          protectedInputs: [
            ...sourceNodes!.map(({ observation, node }) => ({
              observation: !observation.existed
                ? ('existence' as const)
                : observation.operation,
              node,
            })),
            ...protectedAuthoredFiles,
          ],
        };
      } finally {
        preparing--;
      }
    },
    assertActive,
    async observeCurrent(registration, expectedNodes) {
      assertWave();
      assertConfigurationCurrent();
      const current = implementation!.observeReceiverNodes(
        registration,
        expectedNodes,
      );
      assertWave();
      assertConfigurationCurrent();
      return current;
    },
    onStarted(_registration, frame) {
      assertOpen();
      assertActive(frame);
      frames.set(frame.frameId, wave!.reservation);
    },
    onCompleted(_registration, _receipt, frame) {
      assertActive(frame);
      frames.delete(frame.frameId);
    },
    onFailed(frame) {
      frames.delete(frame.frameId);
    },
  });

  async function pinReceipts(): Promise<RendererGeneratedOutputIdentityLease> {
    assertOpen();
    await Promise.race([registry.waitForIdle(), exit]);
    assertOpen();
    assertWave();
    assertConfigurationCurrent();
    const capturedWave = wave!;
    const pairs = registry.completedReceipts();
    const observations = pairs.map(
      ({ registration, receipt, selectedNodes }) => ({
        receipt,
        selectedNodes,
        current: implementation!.observeReceiverNodes(
          registration,
          selectedNodes,
        ),
      }),
    );
    const pinned = registry.pinReceipts(observations);
    let released = false;
    function assertPinned(): void {
      assertOpen();
      if (released || wave !== capturedWave)
        throw new Error('React receiver identity lease is released or stale');
      assertWave();
      pinned.assertEpochCurrent();
      if (
        context?.consumedSourceInputs !== inputs ||
        context?.configurationSourceSnapshot !== baseline ||
        context?.configurationSourceNodes !== sourceNodes
      )
        throw new Error('React receiver configuration provenance has changed');
    }
    const lease: RendererGeneratedOutputIdentityLease = Object.freeze({
      revision: `${capturedWave.reservation.generation}:${pinned.revision}`,
      receipts: Object.freeze(
        pairs.map(({ registration, receipt }) =>
          Object.freeze({ registration, receipt }),
        ),
      ),
      assertEpochCurrent: assertPinned,
      async assertCurrent() {
        assertPinned();
        assertConfigurationCurrent();
        const fresh = pairs.map(({ registration, receipt, selectedNodes }) => ({
          receipt,
          selectedNodes,
          current: implementation!.observeReceiverNodes(
            registration,
            selectedNodes,
          ),
        }));
        assertPinned();
        pinned.assertCurrent(fresh);
        assertConfigurationCurrent();
      },
      permission(filename: string) {
        assertPinned();
        return pinned.permission(filename);
      },
      async withPublication<T>(callback: () => Promise<T>): Promise<T> {
        return pinned.withPublication(async () => {
          await lease.assertCurrent();
          assertPinned();
          const publication = callback();
          publications.add(publication);
          void publication.then(
            () => publications.delete(publication),
            () => publications.delete(publication),
          );
          const result = await Promise.race([publication, exit]);
          await lease.assertCurrent();
          return result;
        });
      },
      release() {
        if (released) return;
        released = true;
        pinned.release();
      },
    });
    await lease.assertCurrent();
    return lease;
  }

  const controller: NonNullable<ReactBuildMetadataOptions['generatedOutputs']> =
    {
      bindPhase(value, captured) {
        assertOpen();
        if (phase && (phase !== value || context !== captured))
          throw new Error('React receiver phase already has an owner');
        phase = value;
        context = captured;
      },
      bindGeneration(reservation) {
        assertOpen();
        bindWave(reservation, true);
      },
      async waitForIdle() {
        assertOpen();
        // Drain is not validation: pinReceipts still rejects a failed wave.
        // This lets a subsequent real native watch own a fresh baseline after IO.
        await Promise.race([registry.waitForSettled(), exit]);
        assertOpen();
      },
      pinReceipts,
      assertCompilerGraph(stats) {
        assertOpen();
        if (owners.size === 0) return;
        if (!graph)
          throw new Error('React receiver compiler graph is unsealed');
        const children = 'stats' in stats ? stats.stats : [stats];
        for (const owner of owners.values())
          if (
            !owner.compiler ||
            children.filter(
              child => child.compilation.compiler === owner.compiler,
            ).length !== 1
          )
            throw new Error(
              `React receiver graph completion is missing compiler: ${owner.name}`,
            );
      },
    };

  const plugin: CliPlugin<AppTools> = {
    name: '@modern-js/ultramodern-react-mf-receiver-outputs',
    pre: [
      '@modern-js/plugin-module-federation-config',
      '@modern-js/plugin-module-federation',
    ],
    setup(api) {
      inputs = getConfigurationSourceInputs(api);
      baseline = getConfigurationSourceSnapshot(api);
      sourceNodes = (options.sourceNodes ?? getConfigurationSourceNodes)(api);
      api.modifyBundlerChain(async (chain, utils) => {
        if (!chain.plugins.has(NATIVE_CLIENT_PLUGIN)) return;
        let enabled = false;
        chain.plugin(NATIVE_CLIENT_PLUGIN).tap(args => {
          const config =
            record(args[0]) && record(args[0].mfConfig)
              ? args[0].mfConfig
              : args[0];
          if (!record(config))
            throw new Error('The native MF client configuration is absent');
          if (
            config.dts !== undefined &&
            typeof config.dts !== 'boolean' &&
            !record(config.dts)
          )
            throw new Error(
              'The native MF DTS configuration must be a boolean or record',
            );
          if (
            config.dts === false ||
            (record(config.dts) && config.dts.consumeTypes === false)
          )
            return args;
          enabled = true;
          return args;
        });
        if (!enabled) return;
        implementationPath ??= (
          options.resolveImplementation ?? resolveReactReceiverImplementation
        )();
        if (!implementation) {
          const loaded: ReactReceiverImplementation = (
            options.loadImplementation ??
            (filename => createRequire(import.meta.url)(filename))
          )(implementationPath);
          implementation = loaded;
          restoreImplementation = loaded.installReceiverRegistry(registry);
        }
        const receiverImplementation = implementation;
        const bridge = await registry.openBridge();
        const name = utils.environment.name;
        if (owners.has(name))
          throw new Error(
            `React native receiver compiler already exists: ${name}`,
          );
        const nativePlugin = chain.plugin(NATIVE_CLIENT_PLUGIN);
        const originalNativeConstructor = nativePlugin.get('plugin');
        const nativeConstructor =
          receiverImplementation.createIsolatedReactFederationPlugin(
            originalNativeConstructor,
          );
        const owner: CompilerOwner = {
          name,
          originalNativeConstructor,
          nativeConstructor,
          companionPlugins: new Set(),
          workers: new Map(),
          seed: Object.freeze({
            schemaVersion: 1,
            registrationId: randomUUID(),
            operationId: randomUUID(),
            compilerId: randomUUID(),
            generation: 1,
            revision: randomUUID(),
            receiverBridge: bridge,
          }),
        };
        owners.set(name, owner);
        chain
          .plugin(COMPILER_OWNER_PLUGIN)
          .before(NATIVE_CLIENT_PLUGIN)
          .use(
            class ReactReceiverCompilerOwner {
              constructor() {
                owner.companionPlugins.add(this);
              }

              apply(compiler: Rspack.Compiler): void {
                assertOpen();
                if (
                  owners.get(owner.name) !== owner ||
                  this !== owner.companionPlugin ||
                  compiler.options.name !== owner.name ||
                  (owner.compiler && owner.compiler !== compiler)
                )
                  throw new Error(
                    'React receiver public compiler owner changed',
                  );
                assertCompilerOwnerPlugins(owner, compiler.options.plugins);
                owner.compiler = compiler;
              }
            },
            [],
          );
        chain.plugin(NATIVE_CLIENT_PLUGIN).tap(args => {
          const config =
            record(args[0]) && record(args[0].mfConfig)
              ? args[0].mfConfig
              : args[0];
          if (!record(config))
            throw new Error('The native MF client configuration is absent');
          const dts = record(config.dts) ? config.dts : {};
          if (
            dts.implementation !== undefined &&
            dts.implementation !== implementationPath
          )
            throw new Error(
              'React receiver cannot audit a custom native DTS implementation',
            );
          if (dts.extraOptions !== undefined && !record(dts.extraOptions))
            throw new Error('The native MF DTS extraOptions must be a record');
          const extraOptions = record(dts.extraOptions) ? dts.extraOptions : {};
          if (Object.hasOwn(extraOptions, implementation!.EXTRA_OPTIONS_KEY))
            throw new Error('React receiver seed already has an owner');
          const onDevWorkerCreated = dts.onDevWorkerCreated;
          if (
            onDevWorkerCreated !== undefined &&
            typeof onDevWorkerCreated !== 'function'
          )
            throw new Error(
              'Native DTS worker lifecycle hook must be a function',
            );
          const ownedDts = {
            ...dts,
            implementation: implementationPath,
            onDevWorkerCreated(
              this: unknown,
              witness: Readonly<{ pid: number; closed: Promise<void> }>,
            ) {
              if (!graph)
                throw new Error(
                  'Native DTS worker began before graph enrollment',
                );
              const previous = owner.workers.get(witness.pid);
              if (previous && previous !== witness)
                throw new Error('Native DTS worker identity was reused');
              registry.bindReceiverWorker(
                owner.seed.compilerId,
                owner.seed.registrationId,
                witness,
              );
              owner.workers.set(witness.pid, witness);
              if (onDevWorkerCreated)
                Reflect.apply(onDevWorkerCreated, this, [witness]);
            },
            extraOptions: {
              ...extraOptions,
              [implementation!.EXTRA_OPTIONS_KEY]: owner.seed,
            },
          };
          const ownedConfig = { ...config, dts: ownedDts };
          return [
            record(args[0]) && record(args[0].mfConfig)
              ? { ...args[0], mfConfig: ownedConfig }
              : ownedConfig,
            ...args.slice(1),
          ];
        });
        nativePlugin.use(nativeConstructor, nativePlugin.get('args'));
      });
      api.onBeforeCreateCompiler(async ({ bundlerConfigs }) => {
        if (owners.size === 0) return;
        assertOpen();
        if (graph)
          throw new Error('React receiver compiler graph was already sealed');
        for (const owner of owners.values()) {
          const namedConfigs = bundlerConfigs.filter(
            config => config.name === owner.name,
          );
          if (namedConfigs.length !== 1)
            throw new Error(
              `React receiver has no named native configuration: ${owner.name}`,
            );
          const nativeInstances = bundlerConfigs.flatMap(config =>
            (config.plugins ?? [])
              .filter(
                (plugin): plugin is ReactReceiverNativePlugin =>
                  plugin instanceof owner.nativeConstructor,
              )
              .map(plugin => ({ config, plugin })),
          );
          const companions = bundlerConfigs.flatMap(config =>
            (config.plugins ?? [])
              .filter((plugin): plugin is ReactReceiverNativePlugin =>
                owner.companionPlugins.has(plugin as ReactReceiverNativePlugin),
              )
              .map(plugin => ({ config, plugin })),
          );
          if (nativeInstances.length === 0) {
            if (
              namedConfigs[0].plugins?.some(
                plugin => plugin instanceof owner.originalNativeConstructor,
              )
            )
              throw new Error(
                'React receiver native compiler plugin was replaced',
              );
            if (
              companions.length > 1 ||
              (companions.length === 1 &&
                companions[0].config !== namedConfigs[0])
            )
              throw new Error(
                'React receiver compiler companion ownership changed',
              );
            if (companions.length === 1)
              namedConfigs[0].plugins = namedConfigs[0].plugins?.filter(
                plugin => plugin !== companions[0].plugin,
              );
            owners.delete(owner.name);
            continue;
          }
          if (
            nativeInstances.length !== 1 ||
            companions.length !== 1 ||
            nativeInstances[0].config !== namedConfigs[0] ||
            companions[0].config !== namedConfigs[0]
          )
            throw new Error(
              'React receiver native compiler plugin ownership changed',
            );
          owner.nativePlugin = nativeInstances[0].plugin;
          owner.companionPlugin = companions[0].plugin;
        }
        if (owners.size === 0) return;
        const producer = await (
          options.resolveProducer ?? resolveReactReceiverProducer
        )({
          appDirectory: api.getAppContext().appDirectory,
          implementationPath: implementationPath!,
        });
        assertOpen();
        graph = Object.freeze({
          authority: Object.freeze({
            appDirectory: api.getAppContext().appDirectory,
            inputs,
            baseline,
            sourceNodes,
          }),
          cohort: Object.freeze({ producer }),
          producer,
        });
        registry.sealReceiverGraph({
          authority: graph.authority,
          cohort: graph.cohort,
          members: Object.freeze(
            [...owners.values()].map(owner =>
              Object.freeze({
                compilerId: owner.seed.compilerId,
                registrationId: owner.seed.registrationId,
              }),
            ),
          ),
        });
      });
      let oneShot = false;
      let closeBuildRegistered = false;
      api.onBeforeBuild(({ isWatch }) => {
        oneShot = api.getAppContext().command === 'build' && !isWatch;
      });
      api.onAfterCreateCompiler(({ compiler }) => {
        const compilers =
          'compilers' in compiler ? compiler.compilers : [compiler];
        for (const owner of owners.values()) {
          const matches = compilers.filter(
            candidate => candidate.options.name === owner.name,
          );
          if (matches.length !== 1)
            throw new Error(
              `React receiver has no unique native compiler: ${owner.name}`,
            );
          if (owner.compiler && owner.compiler !== matches[0])
            throw new Error(
              'React receiver compiler differs from its public apply owner',
            );
          assertCompilerOwnerPlugins(owner, matches[0].options.plugins);
          owner.compiler = matches[0];
          owner.compiler.hooks.shutdown.tapPromise(
            { name: COMPILER_OWNER_PLUGIN, stage: Number.POSITIVE_INFINITY },
            async () => {
              if (!oneShot || shutdown || disposed) return;
              try {
                await phase?.resolveIdentities();
              } catch {
                // A signal may have started public close while readiness was
                // pending. That close owns this hook; awaiting it here cycles.
                if (shutdown || disposed) return;
                // Failed builds never return a BuildResult, so onCloseBuild
                // cannot run. Native shutdown already owns compiler closure;
                // drain its worker witnesses without recursively closing it.
                await stop(true);
              }
            },
          );
        }
        if (!closeBuildRegistered) {
          const builder = api.getAppContext().builder;
          if (!builder)
            throw new Error('React receiver has no owning native builder');
          builder.onCloseBuild(async () => {
            if (!oneShot || disposed) return;
            let completionError: unknown;
            try {
              await Promise.race([phase?.resolveIdentities(), exit]);
              await Promise.race([registry.waitForSettled(), exit]);
            } catch (error) {
              completionError = error;
            }
            try {
              await stop(true);
            } catch (error) {
              if (completionError !== undefined)
                throw new AggregateError(
                  [completionError, error],
                  'React receiver completion and shutdown failed',
                  { cause: completionError },
                );
              throw error;
            }
            if (completionError !== undefined) throw completionError;
          });
          closeBuildRegistered = true;
        }
      });
      let shutdown: Promise<void> | undefined;
      const stop = (nativeCloseOwned = false) => {
        if (disposed) return Promise.resolve();
        if (shutdown) return shutdown;
        const pending = (async () => {
          if (disposed) return;
          exiting = true;
          // Reject only this controller's compiler-phase waiters. Their native
          // watch/done hooks can now finish and public close can reach shutdown;
          // actual receiver IO remains accounted for until child termination.
          rejectExit(new Error('React receiver compiler is exiting'));
          if (wave)
            for (const owner of owners.values())
              registry.closeGeneration(
                generation(owner),
                'owning native compiler is exiting',
              );
          const failures: unknown[] = [];
          for (const owner of owners.values()) {
            if (!owner.compiler) {
              if (
                registry
                  .quarantinedFrames()
                  .some(frame => frame.compilerId === owner.seed.compilerId)
              )
                failures.push(
                  new Error(
                    'React receiver has no public compiler shutdown owner',
                  ),
                );
              continue;
            }
            try {
              if (!nativeCloseOwned)
                await new Promise<void>((resolve, reject) => {
                  owner.compiler!.close(error => {
                    if (error) reject(error);
                    else resolve();
                  });
                });
              for (const witness of owner.workers.values())
                await witness.closed;
              for (const frame of registry.quarantinedFrames('bridge')) {
                if (frame.compilerId !== owner.seed.compilerId) continue;
                const receiverProcessId = registry.receiverProcessId(frame);
                if (
                  receiverProcessId !== undefined &&
                  owner.workers.has(receiverProcessId)
                )
                  registry.confirmReceiverTerminated(frame);
              }
              // Unmatched bridge and same-process IO retain their real lifetime.
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length)
            throw new AggregateError(
              failures,
              'React receiver shutdown failed',
            );
          // Exit rejects the phase-facing awaiter so native close can proceed.
          // An output filesystem write already in flight still owns its lifetime.
          await Promise.allSettled([...publications]);
          await registry.waitForSettled();
          await registry.dispose();
          restoreImplementation?.();
          restoreImplementation = undefined;
          disposed = true;
        })();
        shutdown = pending;
        void pending.then(
          () => {
            if (shutdown === pending) shutdown = undefined;
          },
          () => {
            if (shutdown === pending) shutdown = undefined;
          },
        );
        return pending;
      };
      api.onBeforeExit(() => stop());
    },
  };
  return { plugin, controller };
}
