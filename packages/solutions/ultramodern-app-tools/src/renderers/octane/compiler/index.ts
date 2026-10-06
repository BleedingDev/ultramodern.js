import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import type { RendererIdentity } from '@modern-js/renderer-core';
import {
  inferRspackEnvironment,
  OctaneRspackPlugin,
} from '@octanejs/rspack-plugin';
import type { RsbuildPlugin } from '@rsbuild/core';
import { attachRendererCompilerClaim } from '../../../native-composition/renderer-selection';
import {
  applyNativeSvgComponents,
  type SvgDefaultExport,
} from '../../../native-composition/svg-components';
import {
  OCTANE_COMPILER_VERSION,
  OCTANE_RUNTIME_VERSION,
  octaneModuleManifestFileName,
  validateOctaneModuleManifest,
} from './manifest';

export * from './manifest';

export interface OctaneRendererCompilerOptions {
  rendererIdentities(): Readonly<Record<string, RendererIdentity>>;
  readonly svgDefaultExport?: SvgDefaultExport;
}

function privateCompilerDirectory(): string {
  let directory =
    typeof __dirname === 'string'
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const compiler = path.join(directory, 'src/renderers/octane/compiler');
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
  options: OctaneRendererCompilerOptions,
): RsbuildPlugin {
  return attachRendererCompilerClaim(
    {
      name: 'ultramodern:octane:compiler',
      setup(api) {
        const directory = privateCompilerDirectory();
        const require = createRequire(path.join(directory, 'index.cjs'));
        const {
          OctaneCompilerManifestPlugin,
        } = require('./compiler-manifest.cjs');
        applyNativeSvgComponents(api, {
          renderer: 'octane',
          loader: path.join(directory, 'svg-component-loader.cjs'),
          defaultExport: options.svgDefaultExport,
        });
        api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
          mergeRsbuildConfig(config, {
            source: {
              // Released native bindings export raw TypeScript and TSRX.
              include: [/[/\\]@octanejs[/\\]/u],
            },
          }),
        );
        api.modifyRspackConfig(
          (config, { environment: rsbuildEnvironment }) => {
            // The Cloudflare SSR worker targets `webworker`; it still renders
            // the server document rather than a client hydration bundle.
            const environment =
              rsbuildEnvironment.name === SERVICE_WORKER_ENVIRONMENT_NAME
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
              Math.max(extensions.indexOf('.ts'), extensions.indexOf('.tsx')) +
                1,
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
                sourceLoader: path.join(
                  directory,
                  'source-provenance-loader.cjs',
                ),
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
          },
        );
      },
    },
    {
      renderer: 'octane',
      sourceExtensions: ['.tsrx', '.tsx', '.ts', '.js'],
      transform: 'native',
      refresh: 'native',
      svg: 'component',
    },
  );
}
