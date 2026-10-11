import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeRendererCompilerOptions } from '@modern-js/renderer-core/adapter';
import type { RsbuildPlugin } from '@rsbuild/core';
import {
  OCTANE_COMPILER_VERSION,
  OCTANE_RUNTIME_VERSION,
  octaneModuleManifestFileName,
  validateOctaneModuleManifest,
} from '../manifest';

export function pluginSourceDirectory(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const compiler = path.join(directory, 'src/plugin');
    if (
      fs.existsSync(path.join(directory, 'package.json')) &&
      fs.existsSync(path.join(compiler, 'compiler-manifest.cjs'))
    )
      return compiler;
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error('Cannot locate the UltraModern Octane compiler package.');
    directory = parent;
  }
}

/** Octane owns native compilation; UltraModern retains the application host. */
export function createOctaneCompilerPlugin(
  options: NativeRendererCompilerOptions,
): RsbuildPlugin {
  return {
    name: 'ultramodern:octane:compiler',
    setup(api) {
      const directory = pluginSourceDirectory();
      const require = createRequire(path.join(directory, 'index.cjs'));
      const {
        OctaneCompilerManifestPlugin,
      } = require('./compiler-manifest.cjs');
      // The application installs the Octane compiler; resolve it lazily so
      // descriptor readers never load it.
      const {
        inferRspackEnvironment,
        OctaneRspackPlugin,
      }: typeof import('@octanejs/rspack-plugin') = require('@octanejs/rspack-plugin');
      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
        mergeRsbuildConfig(config, {
          source: {
            // Released native bindings export raw TypeScript and TSRX.
            include: [/[/\\]@octanejs[/\\]/u],
          },
        }),
      );
      api.modifyRspackConfig((config, { environment: rsbuildEnvironment }) => {
        // The Cloudflare SSR worker targets `webworker`; it still renders
        // the server document rather than a client hydration bundle.
        const environment =
          rsbuildEnvironment.name === options.workerEnvironmentName
            ? 'server'
            : inferRspackEnvironment(config.target);
        // Octane prepends '.tsrx' only when it is absent. Keep TypeScript
        // modules first so an extensionless './link' cannot select a
        // case-colliding Link.tsrx on case-insensitive file systems.
        config.resolve ??= {};
        const extensions = (config.resolve.extensions ?? []).filter(
          extension => extension !== '.tsrx',
        );
        extensions.splice(
          Math.max(extensions.indexOf('.ts'), extensions.indexOf('.tsx')) + 1,
          0,
          '.tsrx',
        );
        config.resolve.extensions = extensions;
        config.plugins ??= [];
        config.plugins.push(
          new OctaneRspackPlugin({
            root: api.context.rootPath,
            environment,
            transpile: false,
          }),
        );
        config.plugins.push(
          new OctaneCompilerManifestPlugin({
            emitClientManifest: environment === 'client',
            root: api.context.rootPath,
            runtimeVersion: OCTANE_RUNTIME_VERSION,
            compilerVersion: OCTANE_COMPILER_VERSION,
            rendererIdentities: options.rendererIdentities,
            manifestFilename: octaneModuleManifestFileName,
            validateManifest: validateOctaneModuleManifest,
          }),
        );
        config.module ??= {};
        config.module.rules ??= [];
        // Rsbuild's existing SWC rule handles ordinary .ts/.tsx sources.
        // TSRX needs the same stripping stage after Octane's pre-loader.
        config.module.rules.push({
          test: /\.tsrx$/u,
          type: 'javascript/auto',
          use: [
            {
              loader: 'builtin:swc-loader',
              options: { detectSyntax: 'auto' },
            },
          ],
        });
      });
    },
  };
}
