import {
  assertRendererIdentity,
  type Renderer,
  type RendererIdentity,
} from '@modern-js/renderer-core';
import type { NativeRendererAdapter } from '@modern-js/renderer-core/adapter';
import type { DocumentAsset } from '@modern-js/renderer-core/document';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import { rspack } from '@rsbuild/core';
import { NATIVE_APPLICATION_CLIENT_REQUEST } from './native-entry';

const assetOrder: readonly DocumentAsset['kind'][] = [
  'stylesheet',
  'modulepreload',
  'script',
];

/**
 * The chunk groups the generated entry's application import() loads, also
 * behind the Module Federation bootstrap import(). Lazy modules the
 * application imports later are not part of them.
 */
function applicationChunkGroups(
  entrypoint: Rspack.ChunkGroup,
): Rspack.ChunkGroup[] {
  const found: Rspack.ChunkGroup[] = [];
  const visited = new Set<Rspack.ChunkGroup>();
  const visit = (group: Rspack.ChunkGroup) => {
    for (const child of group.childrenIterable) {
      if (visited.has(child)) continue;
      visited.add(child);
      if (
        child.origins.some(
          origin => origin.request === NATIVE_APPLICATION_CLIENT_REQUEST,
        )
      )
        found.push(child);
      else visit(child);
    }
  };
  visit(entrypoint);
  return found;
}

/** Every chunk group the application can load later through import(). */
function lazyChunkGroups(
  application: readonly Rspack.ChunkGroup[],
): Rspack.ChunkGroup[] {
  const found = new Set<Rspack.ChunkGroup>();
  const visit = (group: Rspack.ChunkGroup) => {
    for (const child of group.childrenIterable) {
      if (found.has(child) || application.includes(child)) continue;
      found.add(child);
      visit(child);
    }
  };
  for (const group of application) visit(group);
  return [...found];
}

/** Produce document assets from the actual selected client compilation. */
export function nativeClientAssetsPlugin(
  renderer: Exclude<Renderer, 'react'>,
  identities: () => Readonly<Record<string, RendererIdentity>>,
  lazyStyles: NativeRendererAdapter['lazyStyles'],
): RsbuildPlugin {
  return {
    name: `ultramodern:${renderer}:client-assets`,
    setup(api) {
      api.modifyRspackConfig((config, { environment }) => {
        if (environment.name === 'server') {
          config.output ??= {};
          config.output.library = {
            type: config.output.module ? 'module' : 'commonjs2',
          };
          const format = config.output.module ? 'module' : 'commonjs';
          config.plugins ??= [];
          config.plugins.push({
            apply(compiler: Rspack.Compiler) {
              compiler.hooks.thisCompilation.tap(
                'UltraModernNativeServerFormat',
                compilation => {
                  compilation.hooks.processAssets.tap(
                    {
                      name: 'UltraModernNativeServerFormat',
                      stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
                    },
                    () => {
                      compilation.emitAsset(
                        'package.json',
                        new rspack.sources.RawSource(
                          JSON.stringify({ type: format }),
                        ),
                      );
                    },
                  );
                },
              );
            },
          });
          return;
        }
        if (environment.name !== 'client') return;
        if (
          !config.entry ||
          typeof config.entry !== 'object' ||
          Array.isArray(config.entry)
        )
          throw new Error(
            'Native client assets require explicit application entry names',
          );
        // Capture owning application entries before selected compilers add their
        // auxiliary lazy-module facades. Those facades are not document roots.
        const applicationEntryNames = Object.keys(config.entry);
        config.plugins ??= [];
        config.plugins.push({
          apply(compiler: Rspack.Compiler) {
            compiler.hooks.thisCompilation.tap(
              'UltraModernNativeClientAssets',
              compilation => {
                compilation.hooks.processAssets.tap(
                  {
                    name: 'UltraModernNativeClientAssets',
                    stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
                  },
                  () => {
                    const resolved = identities();
                    const publicPath = compilation.outputOptions.publicPath;
                    if (
                      typeof publicPath !== 'string' ||
                      publicPath === 'auto' ||
                      !(
                        publicPath.startsWith('/') ||
                        /^https?:\/\//u.test(publicPath)
                      )
                    ) {
                      throw new Error(
                        'Native Node document assets require an explicit output.assetPrefix rooted at / or an HTTP URL; relative and automatic publicPath cannot identify server document URLs',
                      );
                    }
                    const scriptType =
                      compilation.outputOptions.module ||
                      compilation.outputOptions.scriptType === 'module'
                        ? 'module'
                        : 'classic';
                    const crossOrigin =
                      compilation.outputOptions.crossOriginLoading;
                    const entries: Record<string, unknown> = {};
                    for (const entryName of applicationEntryNames) {
                      const entrypoint = compilation.entrypoints.get(entryName);
                      if (!entrypoint)
                        throw new Error(
                          `Native application entry ${entryName} was not emitted`,
                        );
                      const rendererIdentity = resolved[entryName];
                      if (
                        !rendererIdentity ||
                        rendererIdentity.renderer !== renderer
                      ) {
                        throw new Error(
                          `Native client compilation has no resolved identity for ${entryName}`,
                        );
                      }
                      assertRendererIdentity(rendererIdentity, {
                        ...rendererIdentity,
                        entryName,
                      });
                      const documentAssets = (
                        files: readonly string[],
                        scripts: 'script' | 'modulepreload' | undefined,
                      ) =>
                        files.flatMap<DocumentAsset>(file => {
                          const emitted = compilation.getAsset(file);
                          if (!emitted)
                            throw new Error(
                              `Native entry references an unemitted asset ${file}`,
                            );
                          // HMR deltas need the already initialized runtime;
                          // they are never roots for a fresh server document.
                          if (emitted.info.hotModuleReplacement) return [];
                          const href = `${publicPath}${publicPath && !publicPath.endsWith('/') ? '/' : ''}${file}`;
                          const common = {
                            href,
                            ...(crossOrigin ? { crossOrigin } : {}),
                          };
                          if (/\.[cm]?js$/u.test(file)) {
                            if (scripts === 'script')
                              return [
                                { kind: 'script', ...common, scriptType },
                              ];
                            if (scripts === 'modulepreload')
                              return [{ kind: 'modulepreload', ...common }];
                            return [];
                          }
                          if (/\.css$/u.test(file))
                            return [{ kind: 'stylesheet', ...common }];
                          return [];
                        });
                      const entryFiles = entrypoint.getFiles();
                      // The entry loads the application (routes, layouts and
                      // their styles) through import(). Link its stylesheets
                      // so the first paint is styled, and preload its modules.
                      const application = applicationChunkGroups(entrypoint);
                      const applicationFiles = [
                        ...new Set(
                          application.flatMap(group => group.getFiles()),
                        ),
                      ].filter(file => !entryFiles.includes(file));
                      // A server render that cannot link the styles of the
                      // lazy components it renders gets them all up front.
                      const lazyStyleFiles =
                        lazyStyles === 'document'
                          ? [
                              ...new Set(
                                lazyChunkGroups(application).flatMap(group =>
                                  group.getFiles(),
                                ),
                              ),
                            ].filter(
                              file =>
                                /\.css$/u.test(file) &&
                                !entryFiles.includes(file) &&
                                !applicationFiles.includes(file),
                            )
                          : [];
                      // Stylesheets come first, then module preloads; the
                      // stable sort keeps each kind in chunk order.
                      const assets = [
                        ...documentAssets(entryFiles, 'script'),
                        ...documentAssets(
                          applicationFiles,
                          scriptType === 'module' ? 'modulepreload' : undefined,
                        ),
                        ...documentAssets(lazyStyleFiles, undefined),
                      ].sort(
                        (a, b) =>
                          assetOrder.indexOf(a.kind) -
                          assetOrder.indexOf(b.kind),
                      );
                      entries[entryName] = { rendererIdentity, assets };
                    }
                    compilation.emitAsset(
                      'renderer-assets.json',
                      new rspack.sources.RawSource(
                        JSON.stringify({
                          schema: 'ultramodern-renderer-assets',
                          version: 1,
                          renderer,
                          entries,
                        }),
                      ),
                    );
                  },
                );
              },
            );
          },
        });
      });
    },
  };
}
