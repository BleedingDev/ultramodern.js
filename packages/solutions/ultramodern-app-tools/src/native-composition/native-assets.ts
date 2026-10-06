import {
  assertRendererIdentity,
  type Renderer,
  type RendererIdentity,
} from '@modern-js/renderer-core';
import type { DocumentAsset } from '@modern-js/renderer-core/document';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import { rspack } from '@rsbuild/core';

/** Produce document assets from the actual selected client compilation. */
export function nativeClientAssetsPlugin(
  renderer: Exclude<Renderer, 'react'>,
  identities: () => Readonly<Record<string, RendererIdentity>>,
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
                      const assets = entrypoint
                        .getFiles()
                        .flatMap<DocumentAsset>(file => {
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
                          if (/\.[cm]?js$/u.test(file))
                            return [{ kind: 'script', ...common, scriptType }];
                          if (/\.css$/u.test(file))
                            return [{ kind: 'stylesheet', ...common }];
                          return [];
                        });
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
