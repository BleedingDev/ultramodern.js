import fs from 'node:fs';
import type { RsbuildPlugin, Rspack } from '@modern-js/builder';
import path from 'path';
import type { BuilderOptions } from '../shared';
import { createCopyInfo } from '../shared';
import { createPublicPattern } from './createCopyPattern';

/**
 * The copy plugin registers each pattern context as a context dependency even
 * when the directory is absent. The watcher reports an absent context as
 * removed right after the first build, which rebuilds every dev session once.
 * Watch an absent context, and its absent parents, as missing instead: their
 * later creation still rebuilds and copies.
 */
export class MissingCopyContextPlugin {
  constructor(private readonly contexts: readonly string[]) {}

  apply(compiler: Rspack.Compiler): void {
    compiler.hooks.afterCompile.tap('MissingCopyContextPlugin', compilation => {
      for (const context of this.contexts) {
        if (fs.existsSync(context)) continue;
        compilation.contextDependencies.delete(context);
        compilation.missingDependencies.add(context);
        for (
          let parent = path.dirname(context);
          parent !== path.dirname(parent) && !fs.existsSync(parent);
          parent = path.dirname(parent)
        ) {
          compilation.missingDependencies.add(parent);
        }
      }
    });
  }
}

export const builderPluginAdapterCopy = (
  options: BuilderOptions,
): RsbuildPlugin => ({
  name: 'builder-plugin-adapter-copy',

  setup(api) {
    const { normalizedConfig: modernConfig, appContext } = options;

    api.modifyBundlerChain((chain, { CHAIN_ID }) => {
      // apply copy plugin
      if (chain.plugins.has(CHAIN_ID.PLUGIN.COPY)) {
        const defaultCopyPattern = createPublicPattern(
          appContext,
          modernConfig,
          chain,
        );

        const { customPublicDirs } = createCopyInfo(appContext, modernConfig);

        // Create copy patterns for custom public dirs
        const customCopyPatterns = customPublicDirs.map(customPublicDir => {
          // Get the relative path from app directory to determine the output directory name
          const relativePath = path.relative(
            appContext.appDirectory,
            customPublicDir,
          );
          const outputDir = relativePath || path.basename(customPublicDir);

          return {
            from: '**/*',
            to: outputDir,
            context: customPublicDir,
            noErrorOnMissing: true,
          };
        });

        chain.plugin(CHAIN_ID.PLUGIN.COPY).tap(args => [
          {
            patterns: [
              ...(args[0]?.patterns || []),
              defaultCopyPattern,
              ...customCopyPatterns,
            ],
          },
        ]);

        const patterns: unknown[] =
          chain.plugin(CHAIN_ID.PLUGIN.COPY).get('args')?.[0]?.patterns ?? [];
        const optionalContexts = patterns.flatMap(pattern =>
          pattern &&
          typeof pattern === 'object' &&
          'noErrorOnMissing' in pattern &&
          pattern.noErrorOnMissing &&
          'context' in pattern &&
          typeof pattern.context === 'string'
            ? [path.resolve(appContext.appDirectory, pattern.context)]
            : [],
        );
        if (optionalContexts.length)
          chain
            .plugin('modern-missing-copy-context')
            .use(MissingCopyContextPlugin, [optionalContexts]);
      }
    });
  },
});
