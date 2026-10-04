import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type {
  RendererBuildIdentities,
  RendererGeneratedOutputIdentityLease,
} from '@modern-js/app-tools-extensions/renderer-build-identity';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import type {
  BffRuntimeBuildIdentityProvider,
  WithBffRuntimeBuildIdentity,
} from '@modern-js/plugin-bff-build-extensions';
import {
  assertRendererIdentity,
  type Renderer,
  type RendererIdentity,
} from '@modern-js/renderer-core';
import {
  type FileSystemRouteIR,
  projectFileSystemRoutes,
} from '@modern-js/renderer-core/data';
import { validateNativeClientAssetManifest } from '@modern-js/renderer-core/server';
import type { Entrypoint } from '@modern-js/types/cli/base';
import { getArgv, SERVER_BUNDLE_DIRECTORY } from '@modern-js/utils';
import type { ConfigSourceSnapshot } from './config-evaluator/source-snapshot';
import { isEntryMetadataRead } from './config-read-context';
import {
  type ConfigurationSourceNode,
  getConfigurationSourceInputs,
  getConfigurationSourceNodes,
  getConfigurationSourceSnapshot,
  type ObservedConfigSourceInputs,
} from './configuration-read-context';
import {
  assertRendererBuildInputsUnchanged,
  RENDERER_BUILD_MANIFEST_FILE,
  RENDERER_DEVELOPMENT_DIRECTORY,
  readRendererBuildManifest,
  validateRendererBuildManifest,
} from './native-build-manifest';
import {
  NativeDevelopment,
  nativeDevelopmentOutputDirectory,
} from './native-development';
import {
  type RendererBuildProfile,
  resolveRendererProfile,
} from './renderer-profile';

export interface NativeEntryGeneration {
  renderer: Exclude<Renderer, 'react'>;
  entrypoint: Entrypoint;
  appDirectory: string;
  internalDirectory: string;
  profile: RendererBuildProfile;
  rendererIdentity?: RendererIdentity;
  documentSSR: boolean;
  basePath: string;
  modifyRoutes(routes: FileSystemRouteIR[]): Promise<FileSystemRouteIR[]>;
}

/** Native adapters own their bootstrap and server module source. */
export interface NativeEntryGenerator {
  client(context: NativeEntryGeneration): string | Promise<string>;
  server(context: NativeEntryGeneration): string | Promise<string>;
}

export interface NativeInfrastructureOptions {
  resolveBuildIdentities?(context: {
    entrypoints: readonly Entrypoint[];
    appDirectory: string;
    internalDirectory: string;
    distDirectory: string;
    configFile?: string | false;
    consumedSourceInputs?: ObservedConfigSourceInputs;
    configurationSourceSnapshot?: ConfigSourceSnapshot;
    configurationSourceNodes?: readonly ConfigurationSourceNode[];
    /** Exact dependency graph, classified from the completed native filesystem. */
    compilerInputs?: readonly {
      readonly path: string;
      readonly kind: 'file' | 'directory';
    }[];
    /** Regular files from that completed compiler graph. */
    inputFiles?: readonly string[];
    generatedOutputs?: RendererGeneratedOutputIdentityLease;
    config: ReturnType<
      Parameters<
        NonNullable<CliPlugin<AppTools>['setup']>
      >[0]['getNormalizedConfig']
    >;
    packageName: string;
    pluginNames?: readonly string[];
    mode?: 'development' | 'production';
  }): Promise<RendererBuildIdentities>;
}

async function findSource(
  directory: string,
  name: string,
  extensions: readonly string[],
): Promise<string | undefined> {
  for (const extension of extensions) {
    const file = path.join(directory, `${name}${extension}`);
    try {
      if ((await fs.stat(file)).isFile()) return file;
    } catch {}
  }
  return undefined;
}

/** Own native entry discovery and generated paths through existing CLI hooks. */
export function nativeRendererInfrastructurePlugin(
  renderer: Exclude<Renderer, 'react'>,
  generator?: NativeEntryGenerator,
  options: NativeInfrastructureOptions = {},
): CliPlugin<WithBffRuntimeBuildIdentity<AppTools>> {
  const profile = resolveRendererProfile(renderer);
  const serverEntries = new Map<string, string>();
  let buildIdentities: RendererBuildIdentities | undefined;
  let completedBuildIdentities: RendererBuildIdentities | undefined;
  let development: NativeDevelopment | undefined;
  let buildIdentityContext:
    | Parameters<
        NonNullable<NativeInfrastructureOptions['resolveBuildIdentities']>
      >[0]
    | undefined;
  return {
    name: `@modern-js/renderer-${renderer}-infrastructure`,
    post: ['@modern-js/plugin-analyze', '@modern-js/plugin-bff'],
    setup(api) {
      const { appDirectory, command } = api.getAppContext();
      if (
        options.resolveBuildIdentities &&
        (command === 'build' || command === 'deploy')
      ) {
        const resolveBffRuntimeBuildIdentity: BffRuntimeBuildIdentityProvider =
          async compilation => {
            if (
              compilation.appDirectory !== appDirectory ||
              api.getAppContext().appDirectory !== appDirectory
            )
              throw new Error(
                'Native BFF runtime identity requires its owning application compilation',
              );
            if (!completedBuildIdentities)
              throw new Error(
                'Native BFF runtime identity requires a completed renderer build',
              );
            return Object.freeze({
              buildMarker: completedBuildIdentities.buildMarker,
              sourceRevision: completedBuildIdentities.sourceRevision,
            });
          };
        api.updateAppContext({ resolveBffRuntimeBuildIdentity });
        api.onBeforeBuild(() => {
          completedBuildIdentities = undefined;
        });
      }
      if (options.resolveBuildIdentities)
        api.modifyResolvedConfig(config => {
          const { command, distDirectory, apiOnly } = api.getAppContext();
          if (command !== 'dev' || apiOnly) return config;
          development ??= new NativeDevelopment({
            renderer,
            profile,
            distDirectory,
            getSessionIdentities() {
              if (!buildIdentities)
                throw new Error(
                  'Native development session identity is not prepared',
                );
              return buildIdentities;
            },
            async resolveWaveInputs() {
              if (!buildIdentityContext)
                throw new Error(
                  'Native development source context is not prepared',
                );
              return options.resolveBuildIdentities!({
                ...buildIdentityContext,
                mode: 'development',
              });
            },
          });
          return {
            ...config,
            builderPlugins: [
              ...(config.builderPlugins ?? []),
              development.plugin,
            ],
          };
        });
      api.checkEntryPoint(async ({ path: directory, entry }) => {
        if (entry) return { path: directory, entry };
        const app = await findSource(
          directory,
          'App',
          profile.sourceExtensions,
        );
        if (app) return { path: directory, entry: app };
        const routes = path.join(directory, 'routes');
        try {
          const { packageMetadataRead } = api.getAppContext();
          const isDirectory = async () => (await fs.stat(routes)).isDirectory();
          if (
            await (packageMetadataRead?.entryPathRead
              ? packageMetadataRead.entryPathRead(isDirectory)
              : isDirectory())
          ) {
            return { path: directory, entry: routes };
          }
        } catch {}
        // The upstream fallback already recognizes ordinary JS/TS entries.
        // Native-only extensions need discovery here as well.
        const custom = await findSource(
          directory,
          'index',
          profile.sourceExtensions,
        );
        return { path: directory, entry: custom ?? false };
      });

      api.modifyEntrypoints(async ({ entrypoints }) => {
        const { internalDirectory } = api.getAppContext();
        const owned = await Promise.all(
          entrypoints.map(async entrypoint => {
            const directory =
              entrypoint.absoluteEntryDir ?? path.dirname(entrypoint.entry);
            const customServerEntry =
              entrypoint.customServerEntry ||
              (await findSource(
                directory,
                'index.server',
                profile.sourceExtensions,
              ));
            const customEntry = /^index\.[a-z]+$/u.test(
              path.basename(entrypoint.entry),
            );
            const next = {
              ...entrypoint,
              customEntry,
              isAutoMount: !customEntry,
              customServerEntry,
              internalEntry: path.join(
                internalDirectory,
                renderer,
                entrypoint.entryName,
                'index.ts',
              ),
            };
            return next;
          }),
        );
        return { entrypoints: owned };
      });

      api.generateEntryCode(async ({ entrypoints }) => {
        const {
          appDirectory,
          internalDirectory,
          distDirectory,
          packageName,
          serverRoutes,
        } = api.getAppContext();
        // Consumer entry hooks have all completed. Reconcile the owned paths
        // here so renamed, added and removed entries share this final identity
        // and compiler map, rather than the earlier discovery projection.
        serverEntries.clear();
        const entryBasePaths = new Map<string, string>();
        for (const entrypoint of entrypoints) {
          const directory =
            entrypoint.absoluteEntryDir ?? path.dirname(entrypoint.entry);
          entrypoint.customEntry = /^index\.[a-z]+$/u.test(
            path.basename(entrypoint.entry),
          );
          entrypoint.isAutoMount = !entrypoint.customEntry;
          entrypoint.customServerEntry ||= await findSource(
            directory,
            'index.server',
            profile.sourceExtensions,
          );
          const basePaths = [
            ...new Set(
              (serverRoutes ?? [])
                .filter(
                  route =>
                    route.entryName === entrypoint.entryName && !route.isApi,
                )
                .map(route => route.urlPath),
            ),
          ];
          if (options.resolveBuildIdentities && basePaths.length !== 1)
            throw new Error(
              `Native entry ${entrypoint.entryName} requires exactly one analyzed public route prefix`,
            );
          if (
            options.resolveBuildIdentities &&
            entrypoint.customEntry &&
            !entrypoint.customServerEntry
          )
            throw new Error(
              `Native custom client entry ${entrypoint.entryName} requires an explicit index.server Fetch handler for its Node transport`,
            );
          entryBasePaths.set(entrypoint.entryName, basePaths[0] ?? '/');
          entrypoint.internalEntry = path.join(
            internalDirectory,
            renderer,
            entrypoint.entryName,
            'index.ts',
          );
          serverEntries.set(
            entrypoint.entryName,
            path.join(
              path.dirname(entrypoint.internalEntry),
              'index.server.ts',
            ),
          );
        }
        if (options.resolveBuildIdentities && !isEntryMetadataRead()) {
          // Development keeps this source-bound identity for the running CLI
          // session. Native compiler hydration IDs still change per compile;
          // development cache/promotion stay disabled. Config changes restart
          // the graph. Production certifies the same inputs again after build.
          buildIdentityContext = {
            entrypoints: entrypoints.map(entrypoint => ({ ...entrypoint })),
            appDirectory,
            internalDirectory,
            distDirectory,
            packageName,
            pluginNames: api.getAppContext().plugins.map(plugin => plugin.name),
            config: api.getNormalizedConfig(),
            consumedSourceInputs: getConfigurationSourceInputs(api),
            configurationSourceSnapshot: getConfigurationSourceSnapshot(api),
            configurationSourceNodes: getConfigurationSourceNodes(api),
            ...(api.getAppContext().command === 'dev'
              ? { mode: 'development' as const }
              : {}),
          };
          buildIdentities =
            await options.resolveBuildIdentities(buildIdentityContext);
        }
        for (const entrypoint of entrypoints) {
          const context: NativeEntryGeneration = {
            renderer,
            entrypoint,
            appDirectory,
            internalDirectory,
            profile,
            basePath: entryBasePaths.get(entrypoint.entryName)!,
            rendererIdentity: buildIdentities?.identities[entrypoint.entryName],
            documentSSR: Boolean(
              api.getNormalizedConfig().server?.ssrByEntries?.[
                entrypoint.entryName
              ] ?? api.getNormalizedConfig().server?.ssr,
            ),
            async modifyRoutes(routes) {
              const exposeModules = (
                route: FileSystemRouteIR,
              ): Record<string, unknown> => ({
                ...route,
                ...route.modules,
                children: route.children.map(exposeModules),
              });
              const { routes: modified } = await api
                .getHooks()
                .modifyFileSystemRoutes.call({
                  entrypoint,
                  routes: routes.map(exposeModules) as Parameters<
                    Parameters<typeof api.modifyFileSystemRoutes>[0]
                  >[0]['routes'],
                });
              return projectFileSystemRoutes(modified);
            },
          };
          const client = entrypoint.customEntry
            ? `import ${JSON.stringify(entrypoint.entry)};\n`
            : generator
              ? await generator.client(context)
              : undefined;
          const server = entrypoint.customServerEntry
            ? context.rendererIdentity
              ? `import { assertRendererIdentity } from '@modern-js/renderer-core/identity';
import { rejectNativeRscRequest } from '@modern-js/renderer-core/server';
export const rendererIdentity = ${JSON.stringify(context.rendererIdentity)};
export async function nativeRequestHandler(request, context) {
  const rejection = rejectNativeRscRequest(request);
  if (rejection) return rejection;
  assertRendererIdentity(context.entry, rendererIdentity);
  assertRendererIdentity(context.session.identity, rendererIdentity);
  const handler = await import(${JSON.stringify(entrypoint.customServerEntry)});
  const execute = handler.nativeRequestHandler ?? handler.default;
  if (typeof execute !== 'function') throw new Error('The native custom server entry must export a Fetch handler');
  return execute(request, context);
}
export const nativeCSRRequestHandler = nativeRequestHandler;
export default nativeRequestHandler;
`
              : `export { default } from ${JSON.stringify(entrypoint.customServerEntry)};\nexport * from ${JSON.stringify(entrypoint.customServerEntry)};\n`
            : generator
              ? await generator.server(context)
              : undefined;
          if (!client) {
            throw new Error(
              `Renderer ${renderer} has no admitted bootstrap generator for ${entrypoint.entryName}`,
            );
          }
          if (
            !server &&
            (options.resolveBuildIdentities ||
              api.getNormalizedConfig().server?.ssr)
          ) {
            throw new Error(
              `Renderer ${renderer} requires a native server handler for ${entrypoint.entryName}`,
            );
          }
          const clientPath = entrypoint.internalEntry!;
          await fs.mkdir(path.dirname(clientPath), { recursive: true });
          await fs.writeFile(clientPath, client);
          if (server) {
            await fs.writeFile(
              serverEntries.get(entrypoint.entryName)!,
              server,
            );
          }
        }
      });

      if (options.resolveBuildIdentities) {
        api.modifyServerRoutes(({ routes }) => ({
          routes: routes.map(route =>
            route.entryName && !route.isApi
              ? {
                  ...route,
                  // The owning dev provider executes the immutable compiler
                  // checkpoint. Do not let the host import old production disk.
                  bundle:
                    api.getAppContext().command === 'dev'
                      ? undefined
                      : `${SERVER_BUNDLE_DIRECTORY}/${route.entryName}.js`,
                }
              : route,
          ),
        }));
      }

      api.modifyBuilderEnvironments(({ environments }) => {
        const { checkedEntries, distDirectory, command } = api.getAppContext();
        const entries = Object.fromEntries(
          [...serverEntries].filter(
            ([entryName]) =>
              !checkedEntries || checkedEntries.includes(entryName),
          ),
        );
        if (options.resolveBuildIdentities) {
          const server = environments.server;
          const authored = api.getConfig().environments?.server;
          const authoredRoot =
            typeof authored?.output?.distPath === 'string'
              ? authored.output.distPath
              : authored?.output?.distPath?.root;
          if (
            (authored?.output?.filename?.js &&
              authored.output.filename.js !== '[name].js') ||
            (authoredRoot &&
              path.resolve(api.getAppContext().appDirectory, authoredRoot) !==
                path.join(distDirectory, SERVER_BUNDLE_DIRECTORY))
          )
            throw new Error(
              'Native server entry filenames and output directory are owned by the Node transport contract',
            );
          const rspack = server?.tools?.rspack;
          if (
            rspack &&
            typeof rspack === 'object' &&
            !Array.isArray(rspack) &&
            rspack.output?.filename &&
            rspack.output.filename !== '[name].js'
          )
            throw new Error(
              'Native server entry filenames are owned by the Node transport contract',
            );
        }
        const withServer =
          options.resolveBuildIdentities && !environments.server
            ? {
                ...environments,
                server: {
                  output: { target: 'node' as const },
                  source: { entry: entries },
                  tools: { htmlPlugin: false },
                },
              }
            : environments;
        const selected = Object.fromEntries(
          Object.entries(withServer).map(([name, environment]) => [
            name,
            {
              ...(name === 'server' || name === SERVICE_WORKER_ENVIRONMENT_NAME
                ? {
                    ...environment,
                    source: { ...environment.source, entry: entries },
                    ...(options.resolveBuildIdentities && name === 'server'
                      ? {
                          output: {
                            ...environment.output,
                            target: 'node' as const,
                            filename: {
                              ...environment.output?.filename,
                              js: '[name].js',
                            },
                            distPath: {
                              ...(typeof environment.output?.distPath ===
                              'object'
                                ? environment.output.distPath
                                : {}),
                              root: path.join(
                                distDirectory,
                                ...(api.getAppContext().command === 'dev'
                                  ? [RENDERER_DEVELOPMENT_DIRECTORY]
                                  : []),
                                SERVER_BUNDLE_DIRECTORY,
                              ),
                              js: '',
                              jsAsync: '',
                              css: '',
                              cssAsync: '',
                            },
                          },
                        }
                      : {}),
                  }
                : options.resolveBuildIdentities &&
                    command === 'dev' &&
                    name === 'client'
                  ? {
                      ...environment,
                      output: {
                        ...environment.output,
                        distPath: {
                          ...(typeof environment.output?.distPath === 'object'
                            ? environment.output.distPath
                            : {}),
                          root: path.join(
                            distDirectory,
                            RENDERER_DEVELOPMENT_DIRECTORY,
                            'client',
                          ),
                        },
                      },
                    }
                  : environment),
              ...(buildIdentities
                ? {
                    performance: {
                      ...environment.performance,
                      buildCache:
                        !buildIdentities.cacheAllowed ||
                        environment.performance?.buildCache === false
                          ? false
                          : {
                              ...(typeof environment.performance?.buildCache ===
                              'object'
                                ? environment.performance.buildCache
                                : {}),
                              cacheDigest: [
                                ...(typeof environment.performance
                                  ?.buildCache === 'object'
                                  ? (environment.performance.buildCache
                                      .cacheDigest ?? [])
                                  : []),
                                renderer,
                                buildIdentities.buildMarker,
                                buildIdentities.profileDigest,
                                buildIdentities.compilerDigest,
                              ],
                            },
                    },
                  }
                : {}),
            },
          ]),
        );
        return {
          environments:
            options.resolveBuildIdentities && command === 'dev'
              ? Object.fromEntries(
                  Object.entries(selected).map(([name, environment]) => [
                    name,
                    {
                      ...environment,
                      output: {
                        ...environment.output,
                        distPath: {
                          ...(typeof environment.output?.distPath === 'object'
                            ? environment.output.distPath
                            : {}),
                          root: nativeDevelopmentOutputDirectory(
                            distDirectory,
                            name,
                          ),
                        },
                      },
                    },
                  ]),
                )
              : selected,
        };
      });

      if (options.resolveBuildIdentities) {
        api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
          if (api.getAppContext().apiOnly) return;
          const server = bundlerConfigs?.find(
            config => config.name === 'server',
          );
          if (
            !server ||
            server.output?.filename !== '[name].js' ||
            server.output.path !==
              path.join(
                api.getAppContext().distDirectory,
                ...(api.getAppContext().command === 'dev'
                  ? [RENDERER_DEVELOPMENT_DIRECTORY]
                  : []),
                SERVER_BUNDLE_DIRECTORY,
              )
          )
            throw new Error(
              'Native Node transport requires its registered bundles/[name].js compiler output contract',
            );
        });
        api._internalServerPlugins(async ({ plugins }) => {
          const { command, distDirectory, apiOnly } = api.getAppContext();
          const reuseBuilt =
            command === 'serve' ||
            (command === 'deploy' &&
              getArgv().some(
                argument => argument === '--skip-build' || argument === '-s',
              ));
          if (reuseBuilt && !apiOnly)
            buildIdentities = await readRendererBuildManifest(
              distDirectory,
              profile,
            );
          if (!buildIdentities && !apiOnly)
            throw new Error(
              'Native server plugins require resolved build identities',
            );
          const name = '@modern-js/ultramodern-app-tools/native-server-plugin';
          if (plugins.some(plugin => plugin.name === name)) {
            throw new Error('Duplicate native server dispatcher');
          }
          return {
            plugins: [
              ...plugins,
              {
                name,
                options: {
                  renderer,
                  entries: buildIdentities?.identities ?? {},
                  cacheAllowed: buildIdentities?.cacheAllowed ?? false,
                  ...(command === 'dev' && !apiOnly
                    ? {
                        resolveDevelopmentSnapshot: (
                          identity: RendererIdentity,
                          signal: AbortSignal,
                        ) => {
                          if (!development)
                            throw new Error(
                              'Native development compiler authority is not registered',
                            );
                          return development.resolveSnapshot(identity, signal);
                        },
                      }
                    : {}),
                  ...(!apiOnly
                    ? {
                        assetManifestFile: 'renderer-assets.json',
                        nativeManifestFiles: Object.fromEntries(
                          Object.keys(buildIdentities!.identities).map(
                            entryName => [
                              entryName,
                              `${renderer}-module-manifest.${encodeURIComponent(entryName)}.json`,
                            ],
                          ),
                        ),
                      }
                    : {}),
                },
              },
            ],
          };
        });
        api.onAfterBuild(async ({ stats }) => {
          if (api.getAppContext().command === 'dev') return;
          if (api.getAppContext().apiOnly) return;
          if (!buildIdentities)
            throw new Error(
              'A successful native build requires its resolved identities',
            );
          if (!stats)
            throw new Error(
              'Native build identity requires actual compiler stats',
            );
          const results = 'stats' in stats ? stats.stats : [stats];
          const server = results.find(
            result => result.compilation.name === 'server',
          );
          const client = results.find(
            result => result.compilation.name === 'client',
          );
          if (!client)
            throw new Error(
              'Native build requires its actual client compilation',
            );
          const clientCompilationHash = client.compilation.hash;
          if (!clientCompilationHash)
            throw new Error(
              'Native build requires its completed client compilation hash',
            );
          if (!server)
            throw new Error(
              'Native build requires its emitted Node transport compilation',
            );
          const assets = JSON.parse(
            await fs.readFile(
              path.join(
                api.getAppContext().distDirectory,
                'renderer-assets.json',
              ),
              'utf8',
            ),
          );
          for (const [entryName, identity] of Object.entries(
            buildIdentities.identities,
          )) {
            validateNativeClientAssetManifest(assets, identity);
            const nativeManifest = JSON.parse(
              await fs.readFile(
                path.join(
                  client.compilation.outputOptions.path!,
                  `${renderer}-module-manifest.${encodeURIComponent(entryName)}.json`,
                ),
                'utf8',
              ),
            );
            if (renderer === 'solid') {
              (
                await import('@modern-js/renderer-solid/manifest')
              ).validateSolidModuleManifest(nativeManifest, identity);
            } else {
              (
                await import('@modern-js/renderer-octane/manifest')
              ).validateOctaneModuleManifest(
                nativeManifest,
                identity,
                clientCompilationHash,
              );
            }
            const chunk = server.compilation.entrypoints
              .get(entryName)
              ?.getEntrypointChunk();
            const files = chunk
              ? [...chunk.files].filter(file => /\.[cm]?js$/u.test(file))
              : [];
            if (files.length !== 1)
              throw new Error(
                `Native server entry ${entryName} requires exactly one emitted entry module`,
              );
            if (
              path
                .relative(
                  api.getAppContext().distDirectory,
                  path.join(server.compilation.outputOptions.path!, files[0]),
                )
                .split(path.sep)
                .join('/') !== `${SERVER_BUNDLE_DIRECTORY}/${entryName}.js`
            )
              throw new Error(
                `Native Node entry ${entryName} was emitted outside its registered server route bundle`,
              );
            const module = await import(
              `${pathToFileURL(path.join(server.compilation.outputOptions.path!, files[0])).href}?build=${identity.buildId}`
            );
            const exported = module.rendererIdentity ? module : module.default;
            assertRendererIdentity(exported?.rendererIdentity, identity);
            if (
              typeof exported?.nativeRequestHandler !== 'function' ||
              typeof exported?.nativeCSRRequestHandler !== 'function'
            )
              throw new Error(
                `Native server entry ${entryName} does not export its required native transport handlers`,
              );
          }
          if (!buildIdentityContext)
            throw new Error(
              'Native build input context is unavailable for completed compilation',
            );
          assertRendererBuildInputsUnchanged(
            buildIdentities,
            await options.resolveBuildIdentities!(buildIdentityContext),
          );
          const manifest = validateRendererBuildManifest(
            {
              ...buildIdentities,
              schema: 'ultramodern-renderer-build',
              version: 1,
              profile,
            },
            profile,
          );
          const output = path.join(
            api.getAppContext().distDirectory,
            RENDERER_BUILD_MANIFEST_FILE,
          );
          await fs.mkdir(path.dirname(output), { recursive: true });
          const temporary = `${output}.${process.pid}.tmp`;
          try {
            await fs.writeFile(temporary, JSON.stringify(manifest));
            await fs.rename(temporary, output);
          } finally {
            await fs.rm(temporary, { force: true });
          }
          completedBuildIdentities = manifest;
        });
      }
    },
  };
}
