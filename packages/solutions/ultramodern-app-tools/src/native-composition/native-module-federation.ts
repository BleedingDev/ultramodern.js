import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import type { Renderer } from '@modern-js/renderer-core';
import { SERVER_BUNDLE_DIRECTORY } from '@modern-js/utils';
import { NATIVE_MODULE_FEDERATION_PLUGIN } from './module-federation-renderer-plugin';
import { findNativeFederationConfig } from './native-federation-files';
import { resolveNativeRendererAdapter } from './renderer-registration';

export {
  findNativeFederationConfig,
  NATIVE_FEDERATION_CONFIG_FILES,
} from './native-federation-files';

/** Chain keys shared with the React MF plugin, so publication stamping applies. */
export const NATIVE_FEDERATION_CHAIN_KEY = 'plugin-module-federation';

/** The Node container format a server-rendering host loads over HTTP. */
export const NATIVE_SERVER_CONTAINER_TYPE = 'commonjs-module';

type NativeRenderer = Exclude<Renderer, 'react'>;
type FederationOptions = Record<string, unknown>;

/** The selected adapter's federation descriptor and its bootstrap package. */
function nativeFederationProfile(renderer: NativeRenderer) {
  const adapter = resolveNativeRendererAdapter(renderer);
  if (!adapter.federation)
    throw federationError(`renderer ${renderer} has no federation profile.`);
  return { ...adapter.federation, bootstrap: adapter.runtime.bootstrap };
}

/** Options the native renderer owns; a config cannot replace them. */
const OWNED_OPTIONS = ['library', 'remoteType', 'runtime'] as const;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const federationError = (message: string): Error =>
  new Error(`Native Module Federation: ${message}`);

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
  const profile = nativeFederationProfile(renderer);
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
  const profile = nativeFederationProfile(renderer);
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

/**
 * Publish the server container beside the browser one, as the MF SSR snapshot
 * expects: the manifest's ssrRemoteEntry and ssrPublicPath name the Node
 * container a server-rendering host loads.
 */
export function withNativeServerContainer(
  manifest: unknown,
  serverDirectory: string,
  filename: string,
): Record<string, unknown> {
  if (manifest === false)
    throw federationError(
      'renderer components require native manifest publication.',
    );
  const options = record(manifest) ? manifest : {};
  const previous = options.additionalData;
  if (previous !== undefined && typeof previous !== 'function')
    throw federationError('manifest additionalData must be callable.');
  return {
    ...options,
    async additionalData(input: { stats: Record<string, unknown> }) {
      const stats =
        ((await (previous as ((value: typeof input) => unknown) | undefined)?.(
          input,
        )) as Record<string, unknown> | undefined) ?? input.stats;
      const metaData = stats.metaData;
      if (!record(metaData) || typeof metaData.publicPath !== 'string')
        throw federationError(
          'a server container requires an explicit browser publicPath.',
        );
      metaData.ssrRemoteEntry = {
        name: filename,
        path: '',
        type: NATIVE_SERVER_CONTAINER_TYPE,
      };
      metaData.ssrPublicPath = `${metaData.publicPath}${metaData.publicPath.endsWith('/') ? '' : '/'}${serverDirectory}/`;
      return stats;
    },
  };
}

/** Browser container options for a native renderer client compilation. */
export function createNativeClientFederationOptions(
  renderer: NativeRenderer,
  authored: FederationOptions,
  versions: Readonly<Record<string, string>>,
  runtimePlugin?: string,
  serverDirectory?: string,
): FederationOptions {
  const profile = nativeFederationProfile(renderer);
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
    manifest:
      serverDirectory && authored.exposes !== undefined
        ? withNativeServerContainer(
            authored.manifest,
            serverDirectory,
            String(authored.filename ?? 'remoteEntry.js'),
          )
        : (authored.manifest ?? true),
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

/**
 * Node container options for a native renderer server compilation. Shares
 * stay non-eager: the generated server entry reaches the renderer through an
 * import() boundary, so the host's singletons serve every remote it renders.
 */
export function createNativeServerFederationOptions(
  renderer: NativeRenderer,
  authored: FederationOptions,
  versions: Readonly<Record<string, string>>,
  runtimePlugins: readonly string[],
): FederationOptions {
  const { remotes: _remotes, ...container } = authored;
  if (
    authored.runtimePlugins !== undefined &&
    !Array.isArray(authored.runtimePlugins)
  )
    throw federationError('runtimePlugins must be an array.');
  return {
    ...container,
    runtimePlugins: [
      ...((authored.runtimePlugins as unknown[] | undefined) ?? []),
      ...runtimePlugins,
    ],
    filename: authored.filename ?? 'remoteEntry.js',
    library: { type: NATIVE_SERVER_CONTAINER_TYPE, name: authored.name },
    remoteType: 'script',
    shareStrategy: authored.shareStrategy ?? 'loaded-first',
    // The browser manifest publishes this container as its ssrRemoteEntry.
    manifest: authored.manifest ?? true,
    dts: false,
    dev: false,
    shared: createNativeSharedConfig(renderer, authored.shared, versions),
    experiments: {
      ...(record(authored.experiments) ? authored.experiments : {}),
      asyncStartup: false,
      optimization: {
        ...(record(authored.experiments) &&
        record(authored.experiments.optimization)
          ? authored.experiments.optimization
          : {}),
        target: 'node',
      },
    },
  };
}

/**
 * The host client module that loads a remote through the host's federation
 * instance. Solid imports it, by the asset key the server rendered, before it
 * hydrates the boundary holding that remote.
 */
export const nativeFederationHydrationSource = `const id = new URL(import.meta.url).searchParams.get('id');
const host = globalThis[Symbol.for('ultramodern.federation.host-instance')];
if (!id || !host) throw new Error('Cannot hydrate the federated component ' + id + ': the host federation runtime has not started');
const module = await host.loadRemote(id);
if (!module || typeof module.default !== 'function') throw new TypeError('Remote module ' + id + ' has no default component to hydrate');
export default module.default;
`;

/** Content-addressed client path of the hydration module. */
export const NATIVE_FEDERATION_HYDRATION_MODULE = `static/js/ultramodern-federation-hydration.${createHash(
  'sha256',
)
  .update(nativeFederationHydrationSource)
  .digest('hex')
  .slice(0, 8)}.js`;

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
  server?: { readonly hydrationModule: string },
): string {
  return `const remotes = ${JSON.stringify(remotes)};
const hostInstance = Symbol.for('ultramodern.federation.host-instance');
${
  server
    ? `const ssr = Symbol.for('ultramodern.federation.ssr');
const hydrationModule = ${JSON.stringify(server.hydrationModule)};
`
    : ''
}export default function ultramodernNativeFederation() {
  return {
    name: 'ultramodern-native-federation',
    beforeInit(args) {
      if (!globalThis[hostInstance]) {
        globalThis[hostInstance] = args.origin;${
          server
            ? `
        // federatedComponent() records the browser assets of the remotes it
        // server-renders here; the document resolves them by asset key.
        globalThis[ssr] = { hydrationModule, assets: new Map() };`
            : ''
        }
      }
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

/** The Node runtime plugin that loads remote containers and chunks over HTTP. */
function resolveNodeRuntimePlugin(appDirectory: string): string {
  const require = createRequire(path.join(appDirectory, 'package.json'));
  try {
    return require.resolve('@module-federation/node/runtimePlugin');
  } catch (error) {
    throw Object.assign(
      federationError(
        'install @module-federation/node in the application: server rendering and server containers load remotes through it.',
      ),
      { cause: error },
    );
  }
}

const STATIC_ASSET_MODULE_TYPES = ['asset', 'asset/resource'] as const;

/** Emit the hydration module beside the client's own scripts. */
class NativeFederationHydrationModulePlugin {
  apply(compiler: {
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: number };
      sources: { RawSource: new (source: string) => unknown };
    };
    hooks: {
      thisCompilation: {
        tap(
          name: string,
          callback: (compilation: {
            hooks: {
              processAssets: {
                tap(
                  options: { name: string; stage: number },
                  callback: () => void,
                ): void;
              };
            };
            emitAsset(file: string, source: unknown): void;
          }) => void,
        ): void;
      };
    };
  }): void {
    const name = 'UltraModernFederationHydrationModule';
    compiler.hooks.thisCompilation.tap(name, compilation => {
      compilation.hooks.processAssets.tap(
        {
          name,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () =>
          compilation.emitAsset(
            NATIVE_FEDERATION_HYDRATION_MODULE,
            new compiler.webpack.sources.RawSource(
              nativeFederationHydrationSource,
            ),
          ),
      );
    });
  }
}

/**
 * Same-renderer Module Federation for native renderers. The plugin is inert
 * without a module-federation.config file; with one, the client compilation
 * publishes and consumes ESM containers whose renderer runtime is shared.
 * When the application server-renders, or exposes modules a host may
 * server-render, the server compilation publishes and consumes Node
 * containers with the same singletons.
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
          if (!resolveNativeRendererAdapter(renderer).federation)
            throw new Error(
              `unsupported-renderer-capability: renderer ${renderer} does not support Module Federation; remove ${path.basename(file)}`,
            );
          return loadNativeFederationConfig(file);
        })());
      const serverRendered = (authored: FederationOptions): boolean => {
        // Client-only federation never publishes or consumes Node containers.
        if (!resolveNativeRendererAdapter(renderer).federation?.ssr)
          return false;
        if (authored.exposes !== undefined) return true;
        const { server } = api.getNormalizedConfig();
        return Boolean(
          server?.ssr ||
            Object.values(server?.ssrByEntries ?? {}).some(Boolean),
        );
      };
      const writeRuntimePlugin = async (
        name: string,
        source: string,
      ): Promise<string> => {
        const file = path.join(
          api.getAppContext().internalDirectory,
          'federation',
          name,
        );
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, source);
        return file;
      };

      api.modifyBundlerChain(async (chain, { environment }) => {
        const authored = await load();
        if (!authored) return;
        const server = environment.name === 'server';
        if (!server && environment.name !== 'client') return;
        const ssr = serverRendered(authored);
        if (server && !ssr) return;
        const { appDirectory, internalDirectory } = api.getAppContext();
        const Plugin = resolveModuleFederationPlugin(appDirectory);
        const remotes = createNativeRuntimeRemotes(
          readNativeFederationRemotes(authored),
        );
        const versions = resolveNativeSharedVersions(renderer, appDirectory);
        if (server) {
          const runtimePlugin = await writeRuntimePlugin(
            'native-runtime.server.mjs',
            nativeFederationRuntimePluginSource(remotes, {
              hydrationModule: NATIVE_FEDERATION_HYDRATION_MODULE,
            }),
          );
          // Remote chunks load through the Node runtime plugin's readFileVm.
          chain.target('async-node');
          chain
            .plugin(NATIVE_FEDERATION_CHAIN_KEY)
            .use(
              Plugin as never,
              [
                createNativeServerFederationOptions(
                  renderer,
                  authored,
                  versions,
                  [resolveNodeRuntimePlugin(appDirectory), runtimePlugin],
                ),
              ] as never,
            );
          return;
        }
        const runtimePlugin = await writeRuntimePlugin(
          'native-runtime.mjs',
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
                versions,
                runtimePlugin,
                ssr ? SERVER_BUNDLE_DIRECTORY : undefined,
              ),
            ] as never,
          );
        if (ssr)
          chain
            .plugin('ultramodern-federation-hydration-module')
            .use(NativeFederationHydrationModulePlugin);
        await splitClientEntries(chain as never, internalDirectory);
      });

      // A server container resolves its chunks from its own public path,
      // while server-rendered asset URLs keep the client's.
      api.modifyRspackConfig(async (config, { environment }) => {
        if (environment.name !== 'server') return;
        const authored = await load();
        if (!authored || !serverRendered(authored)) return;
        const publicPath = config.output?.publicPath;
        if (
          typeof publicPath !== 'string' ||
          !publicPath ||
          publicPath === 'auto'
        )
          throw federationError(
            'server containers require an explicit output.assetPrefix.',
          );
        config.module ??= {};
        const generator = (config.module.generator ??= {}) as Record<
          string,
          Record<string, unknown>
        >;
        for (const type of STATIC_ASSET_MODULE_TYPES) {
          generator[type] ??= {};
          generator[type].publicPath ??= publicPath;
        }
        config.output!.publicPath = `${publicPath}${publicPath.endsWith('/') ? '' : '/'}${SERVER_BUNDLE_DIRECTORY}/`;
      });
    },
  };
}
