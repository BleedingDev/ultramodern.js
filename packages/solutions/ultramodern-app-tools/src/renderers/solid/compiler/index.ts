import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import {
  identityCacheKey,
  type RendererIdentity,
} from '@modern-js/renderer-core';
import { type RsbuildPlugin, type Rspack, rspack } from '@rsbuild/core';
import { attachRendererCompilerClaim } from '../../../native-composition/renderer-selection';
import {
  SOLID_COMPILER_VERSION,
  type SolidAssetManifest,
  type SolidModuleManifest,
  solidModuleManifestFilename,
} from './manifest';

export type {
  SolidAssetChunk,
  SolidAssetManifest,
  SolidModuleManifest,
} from './manifest';
export {
  resolveSolidModuleAsset,
  SOLID_COMPILER_VERSION,
  solidModuleManifestFilename,
  validateSolidModuleManifest,
} from './manifest';

interface LazyModule {
  key: string;
  filename: string;
  request: string;
  entryName: string;
}

interface LazyDiscoveryDependencies {
  files: { add(filename: string): unknown };
  contexts: { add(directory: string): unknown };
  missing: { add(filename: string): unknown };
}

interface LazyDiscovery {
  compilation: Rspack.Compilation;
  modules: LazyModule[];
  applicationEntries: string[];
  failed: boolean;
}

const nativeDependencySources = [
  /[/\\]node_modules[/\\]\.modern-js[/\\]solid[/\\]/u,
  /[/\\]node_modules[/\\]@modern-js[/\\]renderer-solid[/\\]/u,
  /[/\\]node_modules[/\\]@tanstack[/\\]solid-router[/\\]/u,
];

export interface SolidRendererCompilerOptions {
  /** The selected native infrastructure owns these source-build identities. */
  rendererIdentities(): Readonly<Record<string, RendererIdentity>>;
}

/** Private loaders remain in the package's shipped src tree in every format. */
function privateCompilerDirectory(): string {
  let directory =
    typeof __dirname === 'string'
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifest = path.join(directory, 'package.json');
    const compiler = path.join(directory, 'src/renderers/solid/compiler');
    if (
      fs.existsSync(manifest) &&
      fs.existsSync(path.join(compiler, 'solid-loader.cjs'))
    ) {
      return compiler;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error('Cannot locate the UltraModern Solid compiler package');
    }
    directory = parent;
  }
}

/** Own Solid's native compiler, refresh, lazy assets and URL SVG policy. */
export function pluginSolidRenderer(
  options: SolidRendererCompilerOptions,
): RsbuildPlugin {
  return attachRendererCompilerClaim(
    {
      name: 'ultramodern:solid:compiler',
      setup(api) {
        if (typeof options?.rendererIdentities !== 'function') {
          throw new Error(
            'Solid compiler requires identities from the native UltraModern infrastructure. Select renderer: solid through defineConfig.',
          );
        }
        const directory = privateCompilerDirectory();
        const require = createRequire(path.join(directory, 'index.cjs'));
        const { collectLazyModules } = require('./lazy-modules.cjs') as {
          collectLazyModules(
            projectRoot: string,
            entryDirectories?: string[],
            sourceExtensions?: string[],
            dependencies?: LazyDiscoveryDependencies,
          ): LazyModule[];
        };
        const projectRoot = api.context.rootPath;
        api.modifyRsbuildConfig(config => {
          config.html ??= {};
          config.html.scriptLoading = 'module';
          config.source ??= {};
          config.source.include = [
            ...(config.source.include ?? []),
            ...nativeDependencySources,
          ];
          return config;
        });
        api.modifyRspackConfig((config, { environment, isProd }) => {
          const target = environment.config.output.target;
          // The Cloudflare SSR worker is a `web` module bundle that renders
          // server documents; select its transform by environment, not target.
          const ssrWorker =
            environment.name === SERVICE_WORKER_ENVIRONMENT_NAME;
          const client = target === 'web' && !ssrWorker;
          const worker = target === 'web-worker' || ssrWorker;
          const server = !client;
          config.resolve ??= {};
          config.resolve.conditionNames = [
            'solid',
            client ? 'browser' : worker ? 'worker' : 'node',
            ...(!isProd ? ['development'] : []),
            'import',
            'default',
          ];
          const sourceExtensions = (
            config.resolve.extensions ?? ['.tsx', '.ts', '.jsx', '.js']
          ).filter(extension =>
            ['.tsx', '.ts', '.jsx', '.js'].includes(extension),
          );
          config.module ??= {};
          config.module.rules ??= [];
          config.module.rules.unshift({
            test: /\.[jt]sx?$/u,
            exclude: /\.d\.[cm]?ts$/u,
            include: (filename: string) =>
              !filename.includes(`${path.sep}node_modules${path.sep}`) ||
              nativeDependencySources.some(source => source.test(filename)),
            enforce: 'pre',
            use: [
              {
                loader: path.join(directory, 'solid-loader.cjs'),
                options: { projectRoot, server, isProd, sourceExtensions },
              },
            ],
          });
          if (!client) return config;

          config.module.rules.unshift({
            test: /[/\\]@solidjs[/\\]web[/\\]dist[/\\]web(?:\.dev)?\.js$/u,
            enforce: 'pre',
            use: [path.join(directory, 'preserve-import-loader.cjs')],
          });
          config.output = {
            ...config.output,
            module: true,
            chunkFormat: 'module',
            chunkLoading: 'import',
            iife: false,
            scriptType: 'module',
            library: { type: 'module' },
          };
          config.optimization ??= {};
          config.optimization.runtimeChunk = { name: 'runtime' };

          let currentDiscovery: LazyDiscovery | undefined;
          const originalEntry = config.entry;
          config.entry = async () => {
            const discovery = currentDiscovery;
            if (!discovery) {
              throw new Error(
                'Solid lazy discovery requires an active Rspack compilation',
              );
            }
            const entries =
              typeof originalEntry === 'function'
                ? await originalEntry()
                : originalEntry;
            if (
              !entries ||
              typeof entries !== 'object' ||
              Array.isArray(entries)
            ) {
              throw new Error(
                'Solid lazy modules require named application entries',
              );
            }
            const entryDirectories = Object.values(entries).flatMap(entry => {
              const imports =
                typeof entry === 'object' && !Array.isArray(entry)
                  ? entry.import
                  : entry;
              return (Array.isArray(imports) ? imports : [imports])
                .filter(
                  (file): file is string =>
                    typeof file === 'string' && /\.[jt]sx?$/u.test(file),
                )
                .map(file => path.dirname(path.resolve(projectRoot, file)));
            });
            discovery.applicationEntries = Object.keys(entries);
            for (const directory of entryDirectories) {
              discovery.compilation.contextDependencies.add(directory);
            }
            try {
              discovery.modules = collectLazyModules(
                projectRoot,
                entryDirectories,
                sourceExtensions,
                {
                  files: discovery.compilation.fileDependencies,
                  contexts: discovery.compilation.contextDependencies,
                  missing: discovery.compilation.missingDependencies,
                },
              );
            } catch (error) {
              discovery.failed = true;
              discovery.modules = [];
              discovery.compilation.errors.push(
                error instanceof Error ? error : new Error(String(error)),
              );
              return entries;
            }
            const next = { ...entries };
            for (const module of discovery.modules) {
              if (Object.hasOwn(next, module.entryName)) {
                throw new Error(
                  `Reserved Solid lazy entry ${module.entryName} conflicts with an application entry`,
                );
              }
              next[module.entryName] = { import: module.request };
            }
            return next;
          };
          config.plugins ??= [];
          config.plugins.push({
            apply(compiler: Rspack.Compiler) {
              compiler.hooks.thisCompilation.tap(
                'UltraModernSolidModuleManifest',
                compilation => {
                  const discovery: LazyDiscovery = {
                    compilation,
                    modules: [],
                    applicationEntries: [],
                    failed: false,
                  };
                  currentDiscovery = discovery;
                  compilation.contextDependencies.add(
                    path.join(projectRoot, 'src'),
                  );
                  compilation.hooks.processAssets.tap(
                    {
                      name: 'UltraModernSolidModuleManifest',
                      stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
                    },
                    () => {
                      if (discovery.failed || compilation.errors.length > 0) {
                        return;
                      }
                      const assets: SolidAssetManifest = {};
                      const publicPath = compilation.outputOptions.publicPath;
                      if (
                        typeof publicPath === 'string' &&
                        publicPath !== 'auto'
                      ) {
                        assets._base = publicPath;
                      }
                      for (const module of discovery.modules) {
                        const entry = compilation.entrypoints.get(
                          module.entryName,
                        );
                        const files = entry?.getFiles() ?? [];
                        const chunk = entry?.getEntrypointChunk();
                        const entryFiles = chunk ? [...chunk.files] : [];
                        const file = entryFiles.find(asset =>
                          /\.(?:m)?js$/u.test(asset),
                        );
                        if (!file) {
                          throw new Error(
                            `Solid lazy module ${module.key} has no native ESM entry asset`,
                          );
                        }
                        const css = files.filter(asset =>
                          /\.css$/u.test(asset),
                        );
                        assets[module.key] = {
                          file,
                          ...(css.length ? { css } : {}),
                        };
                      }
                      const identities = options.rendererIdentities();
                      if (
                        !identities ||
                        typeof identities !== 'object' ||
                        Array.isArray(identities)
                      ) {
                        throw new Error(
                          'Solid compiler requires the current native application entry identity map',
                        );
                      }
                      for (const entryName of discovery.applicationEntries) {
                        const rendererIdentity = identities[entryName];
                        if (
                          !rendererIdentity ||
                          rendererIdentity.renderer !== 'solid' ||
                          rendererIdentity.entryName !== entryName
                        ) {
                          throw new Error(
                            `Solid compiler requires the current source-build identity for entry ${entryName}`,
                          );
                        }
                        identityCacheKey(rendererIdentity);
                        const manifest: SolidModuleManifest = {
                          schemaVersion: 1,
                          renderer: 'solid',
                          compilerVersion: SOLID_COMPILER_VERSION,
                          rendererIdentity,
                          modules: assets,
                        };
                        compilation.emitAsset(
                          solidModuleManifestFilename(entryName),
                          new rspack.sources.RawSource(
                            JSON.stringify(manifest, null, 2),
                          ),
                        );
                      }
                    },
                  );
                },
              );
            },
          });
          return config;
        });
      },
    },
    {
      renderer: 'solid',
      sourceExtensions: ['.jsx', '.tsx', '.js', '.ts'],
      transform: 'native',
      refresh: 'native',
      svg: 'url',
    },
  );
}
