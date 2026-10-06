import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import type { Renderer } from '@modern-js/renderer-core';
import { NATIVE_MODULE_FEDERATION_PLUGIN } from './module-federation-renderer-plugin';
import { resolveRendererRegistration } from './renderer-registration';

export const NATIVE_FEDERATION_CONFIG_FILES = [
  'module-federation.config.ts',
  'module-federation.config.mts',
  'module-federation.config.js',
  'module-federation.config.mjs',
] as const;

/** Chain keys shared with the React MF plugin, so publication stamping applies. */
export const NATIVE_FEDERATION_CHAIN_KEY = 'plugin-module-federation';

type NativeRenderer = Exclude<Renderer, 'react'>;
type FederationOptions = Record<string, unknown>;

interface NativeFederationProfile {
  /** The renderer bootstrap package whose dependencies are shared. */
  readonly bootstrap: string;
  /** Container format, matching the renderer's client chunk format. */
  readonly library: 'module';
  /** Runtime singletons the host and every remote must share. */
  readonly shared: readonly string[];
}

const NATIVE_FEDERATION_PROFILES: Readonly<
  Partial<Record<NativeRenderer, NativeFederationProfile>>
> = {
  solid: {
    bootstrap: '@modern-js/renderer-solid',
    library: 'module',
    shared: [
      'solid-js',
      '@solidjs/web',
      '@solidjs/signals',
      'seroval',
      'seroval-plugins',
      '@modern-js/renderer-solid',
      '@modern-js/renderer-solid/client',
      '@modern-js/renderer-solid/router',
      '@modern-js/renderer-solid/federation',
      '@modern-js/renderer-core',
      '@modern-js/renderer-core/',
      '@tanstack/router-core',
      '@tanstack/history',
    ],
  },
};

/** Options the native renderer owns; a config cannot replace them. */
const OWNED_OPTIONS = ['library', 'remoteType', 'runtime'] as const;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const federationError = (message: string): Error =>
  new Error(`Native Module Federation: ${message}`);

export function findNativeFederationConfig(
  appDirectory: string,
): string | undefined {
  const found = NATIVE_FEDERATION_CONFIG_FILES.map(name =>
    path.join(appDirectory, name),
  ).filter(file => fs.existsSync(file));
  if (found.length > 1)
    throw federationError(
      `choose one configuration file: ${found.map(file => path.basename(file)).join(', ')}`,
    );
  return found[0];
}

/** Remote request prefixes, keyed by alias, for `name@url` manifest remotes. */
export function readNativeFederationRemotes(
  options: FederationOptions,
): Readonly<Record<string, string>> {
  const remotes = options.remotes;
  if (remotes === undefined) return {};
  if (!Array.isArray(remotes) && !record(remotes))
    throw federationError('remotes must be a record or an array.');
  const entries: [string, unknown][] = Array.isArray(remotes)
    ? remotes.map(remote => {
        if (typeof remote !== 'string')
          throw federationError('array remotes must be name@url strings.');
        return [remote.slice(0, remote.indexOf('@')), remote];
      })
    : Object.entries(remotes);
  const result: Record<string, string> = {};
  for (const [alias, remote] of entries) {
    const entry =
      typeof remote === 'string'
        ? remote
        : record(remote) && typeof remote.entry === 'string'
          ? `${String(remote.name ?? alias)}@${remote.entry}`
          : undefined;
    const separator = entry?.indexOf('@') ?? -1;
    const url = entry && separator > 0 ? entry.slice(separator + 1) : '';
    if (!alias || !/^[a-z0-9_@][\w@./-]*$/iu.test(alias))
      throw federationError(`remote alias ${alias} is not a module request.`);
    if (
      !/^(?:https?:)?\/\/[^?#]+\.json(?:[?#].*)?$|^\/[^?#]*\.json$/u.test(url)
    )
      throw federationError(
        `remote ${alias} must name its native manifest (name@https://host/mf-manifest.json); direct remote entries skip renderer admission.`,
      );
    result[alias] = entry!;
  }
  return result;
}

export async function loadNativeFederationConfig(
  file: string,
): Promise<FederationOptions> {
  const version = fs.statSync(file).mtimeMs;
  const module = await import(`${pathToFileURL(file).href}?mtime=${version}`);
  let value: unknown = module.default ?? module;
  if (typeof value === 'function') value = await value();
  if (!record(value))
    throw federationError(
      `${path.basename(file)} must default-export Module Federation options.`,
    );
  if (typeof value.name !== 'string' || !value.name)
    throw federationError('options require a container name.');
  for (const key of OWNED_OPTIONS)
    if (value[key] !== undefined)
      throw federationError(
        `${key} is owned by the native renderer output format; remove it.`,
      );
  if (record(value.experiments) && 'asyncStartup' in value.experiments)
    throw federationError(
      'experiments.asyncStartup is owned by the native renderer bootstrap.',
    );
  if (value.manifest === false)
    throw federationError(
      'renderer components require native manifest publication.',
    );
  readNativeFederationRemotes(value);
  return value;
}

/** The package that owns a share key, e.g. `@scope/name` for `@scope/name/sub/`. */
export function sharedPackageName(key: string): string {
  const parts = key.split('/');
  return parts.slice(0, key.startsWith('@') ? 2 : 1).join('/');
}

/** Read the installed version by Node's node_modules lookup, ignoring exports. */
function installedPackageVersion(
  name: string,
  from: readonly string[],
): string | undefined {
  for (const base of from)
    for (let directory = base; ; directory = path.dirname(directory)) {
      const manifest = path.join(
        directory,
        'node_modules',
        name,
        'package.json',
      );
      if (fs.existsSync(manifest)) {
        const version: unknown = JSON.parse(
          fs.readFileSync(manifest, 'utf8'),
        ).version;
        if (typeof version === 'string') return version;
      }
      if (path.dirname(directory) === directory) break;
    }
  return undefined;
}

/**
 * Exact installed versions of the renderer singletons. The application's own
 * dependency on the renderer bootstrap decides which copies it shares.
 */
export function resolveNativeSharedVersions(
  renderer: NativeRenderer,
  appDirectory: string,
): Readonly<Record<string, string>> {
  const profile = NATIVE_FEDERATION_PROFILES[renderer];
  if (!profile)
    throw federationError(`renderer ${renderer} has no federation profile.`);
  const bootstrapManifest = path.join(
    appDirectory,
    'node_modules',
    profile.bootstrap,
    'package.json',
  );
  const from = [
    appDirectory,
    ...(fs.existsSync(bootstrapManifest)
      ? [path.dirname(fs.realpathSync(bootstrapManifest))]
      : []),
  ];
  const versions: Record<string, string> = {};
  for (const key of profile.shared) {
    const version = installedPackageVersion(sharedPackageName(key), from);
    if (!version)
      throw federationError(
        `cannot find the installed ${sharedPackageName(key)} that ${renderer} shares.`,
      );
    versions[key] = version;
  }
  return versions;
}

/** Merge renderer singletons; a config may add packages but not weaken them. */
export function createNativeSharedConfig(
  renderer: NativeRenderer,
  shared: unknown,
  versions: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const profile = NATIVE_FEDERATION_PROFILES[renderer];
  if (!profile)
    throw federationError(`renderer ${renderer} has no federation profile.`);
  const authored: Record<string, unknown> =
    shared === undefined
      ? {}
      : Array.isArray(shared)
        ? Object.fromEntries(
            shared.map(name => {
              if (typeof name !== 'string')
                throw federationError('array shared entries must be names.');
              return [name, {}];
            }),
          )
        : record(shared)
          ? shared
          : (() => {
              throw federationError('shared must be a record or an array.');
            })();
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(authored)) {
    if (profile.shared.includes(name))
      throw federationError(
        `${name} is a ${renderer} runtime singleton owned by the renderer; remove it from shared.`,
      );
    result[name] = value;
  }
  // Exact versions: workspace and alias ranges in manifests are not semver.
  for (const name of profile.shared) {
    const version = versions[name];
    if (!version)
      throw federationError(`shared ${name} has no installed version.`);
    result[name] = {
      singleton: true,
      strictVersion: true,
      requiredVersion: version,
      eager: false,
    };
  }
  return result;
}

/** Browser container options for a native renderer client compilation. */
export function createNativeClientFederationOptions(
  renderer: NativeRenderer,
  authored: FederationOptions,
  versions: Readonly<Record<string, string>>,
  runtimePlugin?: string,
): FederationOptions {
  const profile = NATIVE_FEDERATION_PROFILES[renderer];
  if (!profile)
    throw federationError(`renderer ${renderer} has no federation profile.`);
  const { remotes: _remotes, ...container } = authored;
  if (
    authored.runtimePlugins !== undefined &&
    !Array.isArray(authored.runtimePlugins)
  )
    throw federationError('runtimePlugins must be an array.');
  return {
    ...container,
    // Remotes register at runtime; see nativeFederationRuntimePluginSource.
    runtimePlugins: [
      ...((authored.runtimePlugins as unknown[] | undefined) ?? []),
      ...(runtimePlugin ? [runtimePlugin] : []),
    ],
    filename: authored.filename ?? 'remoteEntry.js',
    library: { type: profile.library },
    // The renderer splits its runtime chunk; the container must carry its own.
    runtime: false,
    // A host must start without contacting remotes it has not rendered yet.
    shareStrategy: authored.shareStrategy ?? 'loaded-first',
    manifest: authored.manifest ?? true,
    dts: authored.dts ?? false,
    shared: createNativeSharedConfig(renderer, authored.shared, versions),
    experiments: {
      ...(record(authored.experiments) ? authored.experiments : {}),
      // Entries start through an import() bootstrap instead. Async startup
      // with remotes drops the ESM runtime chunk's __webpack_require__ export.
      asyncStartup: false,
    },
  };
}

/** The import() boundary that lets an entry consume shared singletons. */
export function nativeFederationBootstrapSource(entry: string): string {
  return `import(${JSON.stringify(entry)});\n`;
}

/**
 * Start every generated application entry through an async boundary, so the
 * share scope is initialized before the renderer runtime is consumed.
 */
async function splitClientEntries(
  chain: {
    entryPoints: { entries(): Record<string, unknown> | undefined };
    entry(name: string): any;
  },
  internalDirectory: string,
): Promise<void> {
  for (const name of Object.keys(chain.entryPoints.entries() ?? {})) {
    const entry = chain.entry(name);
    const values: unknown[] = entry.values();
    const next: unknown[] = [];
    for (const value of values) {
      if (
        typeof value !== 'string' ||
        !path.isAbsolute(value) ||
        path.relative(internalDirectory, value).startsWith('..')
      ) {
        next.push(value);
        continue;
      }
      const bootstrap = path.join(
        path.dirname(value),
        `${path.basename(value, path.extname(value))}.federation.js`,
      );
      await fs.promises.writeFile(
        bootstrap,
        nativeFederationBootstrapSource(value),
      );
      next.push(bootstrap);
    }
    entry.clear();
    for (const value of next) entry.add(value);
  }
}

/** Runtime remote registrations for `alias -> name@manifest` remotes. */
export function createNativeRuntimeRemotes(
  remotes: Readonly<Record<string, string>>,
): { name: string; alias: string; entry: string }[] {
  return Object.entries(remotes).map(([alias, remote]) => {
    const separator = remote.indexOf('@');
    return {
      name: remote.slice(0, separator),
      alias,
      entry: remote.slice(separator + 1),
    };
  });
}

/**
 * The application's runtime plugin. It registers the configured remotes when
 * its federation instance initializes, and publishes the first (page-owning)
 * instance for federatedComponent(). Build-time remotes would compile remote
 * externals into the ESM runtime chunk, which rspack 2.2.7 renders without its
 * chunk loading runtime; federated components load by id instead.
 */
export function nativeFederationRuntimePluginSource(
  remotes: ReturnType<typeof createNativeRuntimeRemotes>,
): string {
  return `const remotes = ${JSON.stringify(remotes)};
const hostInstance = Symbol.for('ultramodern.federation.host-instance');
export default function ultramodernNativeFederation() {
  return {
    name: 'ultramodern-native-federation',
    beforeInit(args) {
      globalThis[hostInstance] ??= args.origin;
      const registered = args.userOptions.remotes ?? [];
      const known = new Set(registered.map(remote => remote.alias ?? remote.name));
      args.userOptions.remotes = [
        ...registered,
        ...remotes.filter(remote => !known.has(remote.alias)).map(remote => ({ ...remote })),
      ];
      return args;
    },
  };
}
`;
}

function resolveModuleFederationPlugin(appDirectory: string): unknown {
  const require = createRequire(path.join(appDirectory, 'package.json'));
  let file: string;
  try {
    file = require.resolve('@module-federation/enhanced/rspack');
  } catch (error) {
    throw Object.assign(
      federationError(
        'install @module-federation/enhanced in the application to use module-federation.config.',
      ),
      { cause: error },
    );
  }
  const { ModuleFederationPlugin } = require(file) as {
    ModuleFederationPlugin?: unknown;
  };
  if (typeof ModuleFederationPlugin !== 'function')
    throw federationError(
      '@module-federation/enhanced/rspack has no ModuleFederationPlugin.',
    );
  return ModuleFederationPlugin;
}

/**
 * Same-renderer Module Federation for native renderers. The plugin is inert
 * without a module-federation.config file; with one, the client compilation
 * publishes and consumes ESM containers whose renderer runtime is shared.
 */
export function nativeModuleFederationPlugin(
  renderer: NativeRenderer,
): CliPlugin<AppTools> {
  return {
    name: NATIVE_MODULE_FEDERATION_PLUGIN,
    setup(api) {
      let loaded: Promise<FederationOptions | undefined> | undefined;
      const load = () =>
        (loaded ??= (async () => {
          const file = findNativeFederationConfig(
            api.getAppContext().appDirectory,
          );
          if (!file) return undefined;
          const capability =
            resolveRendererRegistration(renderer).candidateProfile.capabilities
              .moduleFederation;
          if (capability === false || !NATIVE_FEDERATION_PROFILES[renderer])
            throw new Error(
              `unsupported-renderer-capability: renderer ${renderer} does not support Module Federation; remove ${path.basename(file)}`,
            );
          return loadNativeFederationConfig(file);
        })());

      api.modifyBundlerChain(async (chain, { environment }) => {
        const authored = await load();
        if (!authored || environment.name !== 'client') return;
        const { appDirectory, internalDirectory } = api.getAppContext();
        const Plugin = resolveModuleFederationPlugin(appDirectory);
        const remotes = createNativeRuntimeRemotes(
          readNativeFederationRemotes(authored),
        );
        const runtimePlugin = path.join(
          internalDirectory,
          'federation',
          'native-runtime.mjs',
        );
        await fs.promises.mkdir(path.dirname(runtimePlugin), {
          recursive: true,
        });
        await fs.promises.writeFile(
          runtimePlugin,
          nativeFederationRuntimePluginSource(remotes),
        );
        chain
          .plugin(NATIVE_FEDERATION_CHAIN_KEY)
          .use(
            Plugin as never,
            [
              createNativeClientFederationOptions(
                renderer,
                authored,
                resolveNativeSharedVersions(renderer, appDirectory),
                runtimePlugin,
              ),
            ] as never,
          );
        await splitClientEntries(chain as never, internalDirectory);
      });
    },
  };
}
