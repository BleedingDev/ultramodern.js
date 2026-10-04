import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import {
  createRequire,
  findPackageJSON,
  isBuiltin,
  syncBuiltinESMExports,
} from 'node:module';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import {
  installEffectCompilerSelectionValidator,
  resolveEffectCompilerSelection,
} from '@modern-js/app-tools-extensions/internal-effect-discovery';
import type {
  RendererGeneratedOutputMetadata,
  RendererGeneratedOutputNode,
} from '@modern-js/app-tools-extensions/renderer-generated-outputs';
import {
  type ConfigPackageMetadataRead,
  createConfigOptions,
  createLoadedConfig,
  type LoadedConfig,
} from '@modern-js/plugin/cli';
import type { Renderer } from '@modern-js/renderer-core';
import { CONFIG_FILE_EXTENSIONS, isMonorepo } from '@modern-js/utils';
import {
  isConfigInstalledDependencyPath,
  withConfigDependencyResolution,
} from './config-evaluator/dependency-resolution';
import {
  initializeOwningConfigNativeBinding,
  initializeOwningReleaseIdentity,
} from './config-evaluator/native-bootstrap';
import {
  type ObservedConfigSourceInputs,
  observeConfigSourceInputs,
} from './config-evaluator/observed-inputs';
import {
  assertConfigSourceSnapshotUnchanged,
  type ConfigSourceSnapshot,
  type ConfigSourceState,
  captureConfigSourceSnapshot,
  createConfigSourceCoverageMatcher,
} from './config-evaluator/source-snapshot';
import { withEntryMetadataRead } from './config-read-context';
import {
  type ConfigurationSourceNode,
  retainConfigurationSourceSnapshot,
} from './configuration-read-context';
import { resolveRendererRegistration } from './renderer-registration';
import { resolveEntrypointRouterBindings } from './renderer-router-resolution';
import {
  assertCapturedRenderer,
  assertNoAdditionalBasePlugins,
  ULTRAMODERN_BASE_PLUGIN,
} from './renderer-selection';
import type {
  UltramodernAppUserConfig,
  UltramodernConfigLoader,
} from './types';

export interface ConfigParams {
  env: string;
  command: string;
}

export type UserConfigExport<Config> =
  | Config
  | ((context: ConfigParams) => Config | Promise<Config>);

export type SelectedCompositionFactory = (
  renderer: Renderer,
  consumerPlugins: readonly CliPlugin<AppTools>[],
) => CliPlugin<AppTools>;

const selectedRenderer = Symbol.for('ultramodern.selected-renderer');

function isConfigPromise(
  value: UltramodernAppUserConfig | Promise<UltramodernAppUserConfig>,
): value is Promise<UltramodernAppUserConfig> {
  return 'then' in value && typeof value.then === 'function';
}

function selectConfig(
  config: UltramodernAppUserConfig,
  factory: SelectedCompositionFactory,
): UltramodernAppUserConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('UltraModern configuration must be an object');
  }
  const renderer = resolveRendererRegistration(config.renderer).renderer;
  const plugins = config.plugins ?? [];
  assertNoAdditionalBasePlugins(plugins);
  const base = factory(renderer, plugins);
  Object.defineProperty(base, selectedRenderer, {
    value: renderer,
    enumerable: true,
  });
  return {
    ...config,
    renderer,
    plugins: [base, ...plugins],
  };
}

/** Used by the public export and the plain-TS owning admission fixture. */
export function createDefineConfig(factory: SelectedCompositionFactory) {
  return (config: UserConfigExport<UltramodernAppUserConfig>) => {
    if (typeof config !== 'function') return selectConfig(config, factory);
    return (context: ConfigParams) => {
      const result = config(context);
      return result && isConfigPromise(result)
        ? Promise.resolve(result).then(value => selectConfig(value, factory))
        : selectConfig(result, factory);
    };
  };
}

/** Evaluate a configuration callback once with its caller's exact context. */
export async function resolveUltramodernConfig(
  config: UserConfigExport<UltramodernAppUserConfig>,
  context: ConfigParams,
): Promise<UltramodernAppUserConfig> {
  const resolved =
    typeof config === 'function' ? await config(context) : config;
  const renderer = resolveRendererRegistration(resolved.renderer).renderer;
  return resolved.renderer === undefined ? { ...resolved, renderer } : resolved;
}

export interface LoadUltramodernConfigOptions extends ConfigParams {
  appDirectory: string;
  configFile?: string;
  config?: UltramodernAppUserConfig;
  /** Capture the ordinary CLI load; the isolated evaluator owns its own scope. */
  observeSourceInputs?: boolean;
  /** Additional authored roots used by the captured configuration. */
  sourceRoots?: readonly string[];
  packageMetadataRead?: ConfigPackageMetadataRead;
}

export type LoadedUltramodernConfig = LoadedConfig<UltramodernAppUserConfig> & {
  readonly consumedSourceInputs?: ObservedConfigSourceInputs;
};

export interface ConfigurationReadOptions {
  appDirectory: string;
  configFile?: string | false;
  sourceRoots?: readonly string[];
}

function declaredInstalledConfigRoots(
  appDirectory: string,
  authoredRoots: readonly string[],
): string[] {
  const manifestFile = path.join(appDirectory, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    throw new Error(`Invalid config application manifest: ${manifestFile}`);
  const appRequire = createRequire(manifestFile);
  const canonicalSources = authoredRoots.map(root => fs.realpathSync(root));
  const roots = new Set<string>();
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ] as const) {
    const declarations = manifest[field];
    if (declarations === undefined) continue;
    if (
      !declarations ||
      typeof declarations !== 'object' ||
      Array.isArray(declarations)
    )
      throw new Error(
        `Invalid ${field} in config application: ${manifestFile}`,
      );
    for (const [name, version] of Object.entries(declarations)) {
      const segments = name.split('/');
      if (
        typeof version !== 'string' ||
        isBuiltin(name) ||
        /[\\:#]/.test(name) ||
        segments.some(segment => !segment || segment.startsWith('.')) ||
        (name.startsWith('@')
          ? segments.length !== 2 || segments[0].length === 1
          : segments.length !== 1)
      )
        throw new Error(`Invalid declared config dependency: ${name}`);
      if (name === manifest.name)
        throw new Error(
          `Config dependency cannot own its application: ${name}`,
        );
      let installed: string | undefined;
      for (const directory of appRequire.resolve.paths(name) ?? []) {
        const candidate = path.join(directory, name);
        try {
          fs.lstatSync(candidate);
          installed = candidate;
          break;
        } catch (error) {
          if (
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            !['ENOENT', 'ENOTDIR'].includes(String(error.code))
          )
            throw error;
        }
      }
      // Uninstalled declarations do not authorize another provider. The real
      // native load retains its own missing-package behavior if it uses one.
      if (!installed) continue;
      const selectedManifest = findPackageJSON(name, manifestFile);
      const installedManifest = path.join(installed, 'package.json');
      if (
        !selectedManifest ||
        fs.realpathSync(selectedManifest) !== fs.realpathSync(installedManifest)
      )
        throw new Error(
          `Config dependency owner does not match its installed slot: ${name}`,
        );
      const canonical = fs.realpathSync(installed);
      const owner = JSON.parse(fs.readFileSync(installedManifest, 'utf8'));
      const ownerSegments =
        typeof owner?.name === 'string' ? owner.name.split('/') : [];
      if (
        !ownerSegments.length ||
        isBuiltin(owner.name) ||
        /[\\:#]/.test(owner.name) ||
        ownerSegments.some(
          (segment: string) => !segment || segment.startsWith('.'),
        ) ||
        (owner.name.startsWith('@')
          ? ownerSegments.length !== 2 || ownerSegments[0].length === 1
          : ownerSegments.length !== 1)
      )
        throw new Error(
          `Invalid installed config dependency identity: ${name}`,
        );
      for (const source of canonicalSources) {
        const relative = path.relative(canonical, source);
        if (
          relative === '' ||
          (relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
        )
          throw new Error(
            `Config dependency cannot own an authored root: ${name}`,
          );
      }
      // Node's lexical slot establishes the declared alias; the existing
      // dependency session validates the canonical package's own identity.
      roots.add(installed);
    }
  }
  return [...roots];
}

function sourceNodeMetadata(
  stat: fs.BigIntStats,
): RendererGeneratedOutputMetadata {
  return Object.freeze({
    device: String(stat.dev),
    inode: String(stat.ino),
    mode: Number(stat.mode),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
    size: Number(stat.size),
    nlink: Number(stat.nlink),
    blocks: Number(stat.blocks),
    birthtimeNs: String(stat.birthtimeNs),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  });
}

function originalSourceNode(
  state: ConfigSourceState,
): RendererGeneratedOutputNode {
  const canonical = state.resolvedPath ?? state.path;
  const nodePath = Object.freeze({ lexical: canonical, canonical });
  const changed = () =>
    new Error(`Config source changed before its native load: ${state.path}`);
  let before: fs.BigIntStats;
  try {
    before = fs.lstatSync(canonical, { bigint: true });
  } catch (error) {
    if (
      state.kind === 'missing' &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR'].includes(String(error.code))
    )
      return Object.freeze({ path: nodePath, kind: 'missing' });
    throw error;
  }
  if (
    state.kind === 'missing' ||
    before.isSymbolicLink() ||
    Number(before.mode) !== state.mode ||
    fs.realpathSync.native(canonical) !== canonical
  )
    throw changed();
  const metadata = sourceNodeMetadata(before);
  if (state.kind === 'file' && before.isFile()) {
    if (
      String(before.dev) !== state.dev ||
      String(before.ino) !== state.ino ||
      String(before.ctimeNs) !== state.ctimeNs
    )
      throw changed();
    const descriptor = fs.openSync(
      canonical,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const opened = sourceNodeMetadata(
        fs.fstatSync(descriptor, { bigint: true }),
      );
      const byteDigest = createHash('sha256')
        .update(fs.readFileSync(descriptor))
        .digest('hex');
      const after = sourceNodeMetadata(
        fs.fstatSync(descriptor, { bigint: true }),
      );
      const named = sourceNodeMetadata(
        fs.lstatSync(canonical, { bigint: true }),
      );
      if (
        byteDigest !== state.sha256 ||
        [opened, after, named].some(
          current => JSON.stringify(current) !== JSON.stringify(metadata),
        )
      )
        throw changed();
      return Object.freeze({
        path: nodePath,
        kind: 'file',
        byteDigest,
        metadata,
      });
    } finally {
      fs.closeSync(descriptor);
    }
  }
  if (state.kind !== 'directory' || !before.isDirectory()) throw changed();
  const readEntries = () =>
    Object.freeze(
      fs
        .readdirSync(canonical, { withFileTypes: true })
        .map(entry => {
          const kind = entry.isSymbolicLink()
            ? 'symlink'
            : entry.isDirectory()
              ? 'directory'
              : entry.isFile()
                ? 'file'
                : undefined;
          if (!kind)
            throw new Error(
              `Unsupported original config directory entry: ${entry.name}`,
            );
          return Object.freeze({ name: entry.name, kind });
        })
        .sort((left, right) =>
          left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
        ),
    );
  const entries = readEntries();
  const repeatedEntries = readEntries();
  const after = sourceNodeMetadata(fs.lstatSync(canonical, { bigint: true }));
  if (
    JSON.stringify(entries) !== JSON.stringify(repeatedEntries) ||
    JSON.stringify(metadata) !== JSON.stringify(after)
  )
    throw changed();
  return Object.freeze({
    path: nodePath,
    kind: 'directory',
    entries,
    metadata,
  });
}

function originalSourceNodes(
  snapshot: ConfigSourceSnapshot,
): ReadonlyMap<string, RendererGeneratedOutputNode> {
  const nodes = new Map<string, RendererGeneratedOutputNode>();
  for (const state of snapshot.states) {
    if (state.kind === 'symlink') continue;
    const canonical = state.resolvedPath ?? state.path;
    if (!nodes.has(canonical)) nodes.set(canonical, originalSourceNode(state));
  }
  // This validation precedes the native load. Later HMR is checked only against
  // actual configuration reads, using these original values.
  assertConfigSourceSnapshotUnchanged(snapshot);
  return nodes;
}

function selectedSourceNodes(
  snapshot: ConfigSourceSnapshot,
  inputs: ObservedConfigSourceInputs,
  originals: ReadonlyMap<string, RendererGeneratedOutputNode>,
): readonly ConfigurationSourceNode[] {
  const covered = createConfigSourceCoverageMatcher(snapshot.coverage);
  return Object.freeze(
    [
      ...inputs.observations,
      ...inputs.packageMetadata.map(input =>
        Object.freeze({
          path: input.path,
          canonicalPath: input.canonicalPath,
          operation: 'metadata' as const,
          existed: true,
        }),
      ),
    ].map(observation => {
      let original = originals.get(observation.canonicalPath);
      let requiredAncestors: readonly RendererGeneratedOutputNode[] | undefined;
      if (
        (!original || original.kind === 'missing') &&
        covered(observation.canonicalPath)
      ) {
        let child = observation.canonicalPath;
        const intermediates: RendererGeneratedOutputNode[] = [];
        for (;;) {
          const parent = path.dirname(child);
          if (parent === child) break;
          const ancestor = originals.get(parent);
          if (ancestor && ancestor.kind !== 'missing') {
            if (
              ancestor.kind !== 'directory' ||
              !ancestor.entries.some(
                entry => entry.name === path.basename(child),
              )
            ) {
              original ??= Object.freeze({
                kind: 'missing',
                path: Object.freeze({
                  lexical: observation.path,
                  canonical: observation.canonicalPath,
                }),
              });
              requiredAncestors = Object.freeze([
                ancestor,
                ...intermediates.reverse(),
              ]);
            }
            break;
          }
          intermediates.push(
            ancestor ??
              Object.freeze({
                kind: 'missing',
                path: Object.freeze({ lexical: parent, canonical: parent }),
              }),
          );
          child = parent;
        }
      }
      if (!original || (original.kind === 'missing' && !requiredAncestors))
        throw new Error(
          `No original configuration read baseline: ${observation.path}`,
        );
      const node = Object.freeze({
        ...original,
        path: Object.freeze({
          lexical: observation.path,
          canonical: observation.canonicalPath,
        }),
      });
      return Object.freeze({
        observation,
        node,
        ...(requiredAncestors ? { requiredAncestors } : {}),
      });
    }),
  );
}

async function withImmediateDirectoryReads<T>(
  load: () => Promise<T>,
): Promise<T> {
  const restores: Array<() => void> = [];
  let failure: Error | undefined;
  let completion: { value: T } | undefined;
  let evaluationError: unknown;
  try {
    for (const [target, names] of [
      [fs, ['readdir', 'readdirSync', 'opendir', 'opendirSync']],
      [fsPromises, ['readdir', 'opendir']],
    ] as const) {
      for (const name of names) {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (!descriptor || typeof descriptor.value !== 'function') continue;
        const original = descriptor.value;
        const wrapped = function (this: unknown, ...args: unknown[]) {
          const options = args[1];
          if (
            options &&
            typeof options === 'object' &&
            !utilTypes.isProxy(options)
          ) {
            const prototype = Object.getPrototypeOf(options);
            if (prototype === null || prototype === Object.prototype) {
              const recursive =
                Object.getOwnPropertyDescriptor(options, 'recursive') ??
                (prototype &&
                  Object.getOwnPropertyDescriptor(prototype, 'recursive'));
              if (
                recursive &&
                (!('value' in recursive) || recursive.value === true)
              )
                failure ??= new Error(
                  `Unsupported configuration read mode: recursive fs.${name}`,
                );
            }
          }
          // Preserve native values, errors, promises, and callback ordering.
          return Reflect.apply(original, this, args);
        };
        Object.defineProperties(
          wrapped,
          Object.getOwnPropertyDescriptors(original),
        );
        Object.defineProperty(target, name, { ...descriptor, value: wrapped });
        restores.push(() => {
          if (Object.getOwnPropertyDescriptor(target, name)?.value !== wrapped)
            failure ??= new Error(
              `Configuration directory reader lost ownership of ${name}`,
            );
          Object.defineProperty(target, name, descriptor);
        });
      }
    }
    syncBuiltinESMExports();
    completion = { value: await load() };
  } catch (error) {
    evaluationError = error;
  } finally {
    for (const restore of restores.reverse()) {
      try {
        restore();
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error));
      }
    }
    syncBuiltinESMExports();
  }
  if (!completion) throw evaluationError;
  if (failure) throw failure;
  return completion.value;
}

function findConfigurationWorkspaceRoot(
  appDirectory: string,
): string | undefined {
  let current = fs.realpathSync(appDirectory);
  while (true) {
    if (isMonorepo(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Observe the supplied owning load once without replacing its result. */
export async function observeUltramodernConfigLoad<T>(
  {
    appDirectory: requestedAppDirectory,
    configFile,
    sourceRoots = [],
  }: ConfigurationReadOptions,
  load: (packageMetadataRead?: ConfigPackageMetadataRead) => Promise<T>,
): Promise<{ value: T; consumedSourceInputs: ObservedConfigSourceInputs }> {
  const appDirectory = path.resolve(requestedAppDirectory);
  const nativeBinding = initializeOwningConfigNativeBinding();
  await initializeOwningReleaseIdentity();
  const owningModule =
    process.env.MODERN_LIB_FORMAT === 'esm' ? import.meta.url : __filename;
  const owningManifest = findPackageJSON(owningModule, owningModule);
  if (!owningManifest)
    throw new Error('Cannot find the owning UltraModern configuration package');
  const workspaceRoot = findConfigurationWorkspaceRoot(appDirectory);
  const authoredRoots = [
    ...new Set([
      path.resolve(appDirectory),
      ...(workspaceRoot ? [workspaceRoot] : []),
      ...sourceRoots.map(root => path.resolve(root)),
      ...(configFile
        ? [path.dirname(path.resolve(appDirectory, configFile))]
        : []),
    ]),
  ];
  const dependencyRoots = [
    path.dirname(owningManifest),
    ...declaredInstalledConfigRoots(path.resolve(appDirectory), authoredRoots),
  ];
  const sourceSnapshot = captureConfigSourceSnapshot({
    sourceRoots: authoredRoots,
    extraInputs: [
      owningManifest,
      ...dependencyRoots.map(root => path.join(root, 'package.json')),
    ],
  });
  const originalNodes = originalSourceNodes(sourceSnapshot);
  const ownershipSnapshot = captureConfigSourceSnapshot({
    sourceRoots: [],
    extraInputs: [
      path.join(appDirectory, 'package.json'),
      ...dependencyRoots.map(root => path.join(root, 'package.json')),
    ],
  });
  return withConfigDependencyResolution(
    // This phase records installed provenance. An empty fallback-origin list
    // preserves the native loader's missing/present-package resolution.
    { sourceRoots: [], dependencyRoots },
    async () => {
      const selections = [];
      for (const from of [
        configFile ? path.resolve(appDirectory, configFile) : undefined,
        path.join(appDirectory, 'package.json'),
      ]) {
        if (!from) continue;
        try {
          selections.push(resolveEffectCompilerSelection(from));
        } catch {
          /* Actual compiler use must match the selected installed owner. */
        }
      }
      const previousCache = process.env.JITI_FS_CACHE;
      process.env.JITI_FS_CACHE = 'false';
      try {
        const observed = await observeConfigSourceInputs(
          sourceSnapshot,
          packageMetadataRead =>
            withImmediateDirectoryReads(() => load(packageMetadataRead)),
          isConfigInstalledDependencyPath,
          { selections, install: installEffectCompilerSelectionValidator },
          nativeBinding,
        );
        assertConfigSourceSnapshotUnchanged(ownershipSnapshot);
        retainConfigurationSourceSnapshot(
          observed.consumedSourceInputs,
          sourceSnapshot,
          selectedSourceNodes(
            sourceSnapshot,
            observed.consumedSourceInputs,
            originalNodes,
          ),
        );
        return observed;
      } finally {
        if (previousCache === undefined) delete process.env.JITI_FS_CACHE;
        else process.env.JITI_FS_CACHE = previousCache;
      }
    },
  );
}

/** Load and evaluate authored TS/JS config through the owning Modern loader. */
export async function loadUltramodernConfigFile({
  appDirectory,
  configFile,
  config,
  env,
  command,
  observeSourceInputs = false,
  sourceRoots = [],
  packageMetadataRead,
}: LoadUltramodernConfigOptions): Promise<LoadedUltramodernConfig> {
  const load = async (nativePackageMetadataRead = packageMetadataRead) => {
    const resolvedFile = configFile
      ? path.resolve(appDirectory, configFile)
      : CONFIG_FILE_EXTENSIONS.map(extension =>
          path.join(appDirectory, `modern.config${extension}`),
        ).find(file => fs.existsSync(file));
    if (!resolvedFile) {
      throw new Error(`Cannot find modern.config in ${appDirectory}`);
    }
    const loaded = await createLoadedConfig<UltramodernAppUserConfig>(
      appDirectory,
      resolvedFile,
      config,
      { env, command },
      nativePackageMetadataRead,
    );
    const renderer = resolveRendererRegistration(
      loaded.config.renderer,
    ).renderer;
    loaded.config = { ...loaded.config, renderer };
    const bases = (loaded.config.plugins ?? []).filter(
      plugin => plugin.name === ULTRAMODERN_BASE_PLUGIN,
    );
    if (bases.length !== 1) {
      throw new Error('Exactly one UltraModern base composition is required');
    }
    const captured = (
      bases[0] as CliPlugin<AppTools> & {
        [selectedRenderer]?: Renderer;
      }
    )[selectedRenderer];
    if (
      resolveRendererRegistration(renderer).kind === 'native' &&
      captured === undefined
    )
      throw new Error(
        'Native renderer selection must use UltraModern defineConfig; an unselected legacy base cannot own native compilation',
      );
    if (captured !== undefined) assertCapturedRenderer(loaded.config, captured);
    assertNoAdditionalBasePlugins(
      (loaded.config.plugins ?? []).filter(plugin => plugin !== bases[0]),
    );
    assertCapturedRenderer(loaded.config, renderer);
    return loaded;
  };
  if (!observeSourceInputs) return load();

  const observed = await observeUltramodernConfigLoad(
    { appDirectory, configFile, sourceRoots },
    load,
  );
  return {
    ...observed.value,
    consumedSourceInputs: observed.consumedSourceInputs,
  };
}

export async function loadUltramodernConfig(
  options: LoadUltramodernConfigOptions,
): Promise<UltramodernAppUserConfig> {
  return (await loadUltramodernConfigFile(options)).config;
}

/** Resolve the real convention/custom entries without invoking output hooks. */
export async function resolveUltramodernEntryIdentities({
  appDirectory,
  config,
  command = 'metadata',
  configFile = false,
  packageMetadataRead,
}: {
  appDirectory: string;
  config: UltramodernAppUserConfig;
  command?: string;
  configFile?: string | false;
  packageMetadataRead?: ConfigPackageMetadataRead;
}) {
  return withEntryMetadataRead(async () => {
    const contextPlugin: CliPlugin<UltramodernConfigLoader> = {
      name: '@modern-js/ultramodern-entry-config-context',
      setup(api) {
        api.updateAppContext({ configFile });
      },
    };
    const resolved = await createConfigOptions<UltramodernConfigLoader>({
      cwd: appDirectory,
      configFile: false,
      command,
      config,
      packageMetadataRead,
      internalPlugins: [contextPlugin],
    });
    const context = resolved.getAppContext();
    const hooks = context._internalContext.pluginAPI?.getHooks();
    if (!hooks) throw new Error('The owning entry hooks are unavailable');
    const { getBundleEntry } = await import('@modern-js/app-tools/builder');
    const { entrypoints } = await hooks.modifyEntrypoints.call({
      entrypoints: await getBundleEntry(hooks, context, resolved.config),
    });
    const entries = entrypoints.map(({ entryName, isMainEntry }) => ({
      entryName,
      isMainEntry,
    }));
    const primary = entries.find(entry => entry.isMainEntry) ?? entries[0];
    if (!primary)
      throw new Error('UltraModern configuration has no application entries');
    const renderer = resolveRendererRegistration(config.renderer).renderer;
    const routerBindings = await resolveEntrypointRouterBindings(
      renderer,
      entrypoints,
      context.plugins.map(plugin => plugin.name),
    );
    return { entries, primaryEntryName: primary.entryName, routerBindings };
  });
}
