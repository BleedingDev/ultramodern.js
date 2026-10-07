import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { RendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import { findHostingModuleDirectory } from '@modern-js/app-tools-extensions/runtime-package-resolution';
import type {
  BffRuntimeBuildIdentityProvider,
  WithBffRuntimeBuildIdentity,
} from '@modern-js/plugin-bff-build-extensions';
import { escapeInlineDataJSON } from '@modern-js/renderer-core/data';
import { getArgv } from '@modern-js/utils';
import { type RsbuildPlugin, rspack } from '@rsbuild/core';
import { isEntryMetadataRead } from './config-read-context';
import {
  getConfigurationSourceInputs,
  getConfigurationSourceNodes,
  getConfigurationSourceSnapshot,
} from './configuration-read-context';
import {
  RENDERER_BUILD_MANIFEST_FILE,
  readRendererBuildManifest,
  validateRendererBuildManifest,
} from './native-build-manifest';
import type { NativeInfrastructureOptions } from './native-infrastructure';
import { isUltramodernReleaseIdentityBannerPlugin } from './preset';
import {
  resolveRendererProfile,
  resolveRendererRouterFrameworks,
} from './renderer-profile';

export const REACT_RENDERER_IDENTITY_ELEMENT_ID =
  'ultramodern-renderer-identity';

export interface ReactBuildMetadataOptions {
  /** Resolved identities, shared with the federation renderer integration. */
  onBuildIdentities?: (identities: RendererBuildIdentities) => void;
  resolveBuildIdentities: NonNullable<
    NativeInfrastructureOptions['resolveBuildIdentities']
  >;
}

/** Resolve the owning public export even when the dependency key is an npm alias. */
export async function resolveReactMetadataServerPlugin(
  registrarUrl = import.meta.url,
): Promise<string> {
  const registrar = path.dirname(fileURLToPath(registrarUrl));
  const names = [
    '@modern-js/ultramodern-app-tools',
    '@bleedingdev/modern-js-ultramodern-app-tools',
  ];
  let owner = registrar;
  for (;;) {
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(owner, 'package.json'), 'utf8'),
      );
      if (!names.includes(manifest.name) || !manifest.exports)
        throw new Error('React metadata registrar is not its owning package');
      // Find the package's real hosting root where present. Self-reference
      // resolution must be anchored to the owner, never to the application.
      const hosting = names
        .map(name => ({
          name,
          directory: findHostingModuleDirectory(name, registrar),
        }))
        .find(candidate => candidate.directory);
      if (hosting?.directory) {
        const candidate = path.join(hosting.directory, hosting.name);
        if ((await fs.realpath(candidate)) === (await fs.realpath(owner)))
          owner = candidate;
      }
      return createRequire(
        pathToFileURL(path.join(owner, 'package.json')),
      ).resolve(`${manifest.name}/react-build-metadata-server`);
    } catch (error) {
      if (
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      )
        throw error;
    }
    const parent = path.dirname(owner);
    if (parent === owner)
      throw new Error('React metadata registrar has no owning package');
    owner = parent;
  }
}

/** Bind the React output to identities resolved once before compilation. */
export function reactRendererBuildMetadataPlugin(
  options: ReactBuildMetadataOptions,
): CliPlugin<WithBffRuntimeBuildIdentity<AppTools>> {
  const profile = resolveRendererProfile('react');
  const manifestValidation = {
    routerFrameworks: resolveRendererRouterFrameworks('react'),
  };
  let identities: RendererBuildIdentities | undefined;
  let development = false;
  const builderPlugin: RsbuildPlugin = {
    name: 'ultramodern:react:build-metadata',
    setup(api) {
      if (development)
        api.modifyEnvironmentConfig({
          order: 'post',
          handler(config, { name }) {
            const configured = config.tools.htmlPlugin;
            if (
              api.context.action !== 'dev' ||
              name !== 'client' ||
              configured === false
            )
              return;
            // Development HTML is always rendered fresh.
            return {
              ...config,
              tools: {
                ...config.tools,
                htmlPlugin: [
                  ...(configured === undefined || configured === true
                    ? []
                    : Array.isArray(configured)
                      ? configured
                      : [configured]),
                  { cache: false },
                ],
              },
            };
          },
        });
      api.modifyBundlerChain({
        order: 'post',
        handler: chain => {
          if (!identities) return;
          if (chain.plugins.has('globalVars'))
            chain.plugin('globalVars').tap(args => {
              const definitions = { ...args[0] };
              delete definitions.ULTRAMODERN_BUILD_MARKER;
              delete definitions.ULTRAMODERN_SOURCE_REVISION;
              return [definitions, ...args.slice(1)];
            });
          chain
            .plugin('ultramodern-react-runtime-identity')
            .use(rspack.DefinePlugin, [
              {
                ULTRAMODERN_BUILD_MARKER: JSON.stringify(
                  identities.buildMarker,
                ),
                ULTRAMODERN_SOURCE_REVISION: JSON.stringify(
                  identities.sourceRevision,
                ),
              },
            ]);
        },
      });
      api.modifyRspackConfig({
        order: 'post',
        handler: config => {
          if (!identities) return config;
          const { buildMarker, sourceRevision } = identities;
          config.plugins = (config.plugins ?? []).filter(
            plugin => !isUltramodernReleaseIdentityBannerPlugin(plugin),
          );
          // After minimization and before asset hashing, so a changed
          // identity changes every emitted script's content hash.
          config.plugins.push(
            new rspack.BannerPlugin({
              banner: `void ${JSON.stringify(buildMarker)};void ${JSON.stringify(sourceRevision)};`,
              raw: true,
              stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
              test: /\.(?:c|m)?js$/u,
            }),
          );
          return config;
        },
      });
      api.modifyHTMLTags((tags, { filename, environment }) => {
        if (environment.name !== 'client') return tags;
        const entries = Object.entries(environment.htmlPaths).filter(
          ([, output]) => output === filename,
        );
        if (entries.length !== 1)
          throw new Error(
            `React HTML output ${filename} has no unambiguous analyzed entry`,
          );
        const entryName = entries[0][0];
        const identity = identities?.identities[entryName];
        if (!identity)
          throw new Error(
            `React HTML output has no resolved renderer identity for ${entryName}`,
          );
        if (
          [...tags.headTags, ...tags.bodyTags].some(
            tag => tag.attrs?.id === REACT_RENDERER_IDENTITY_ELEMENT_ID,
          )
        )
          throw new Error('Duplicate React document renderer identity');
        tags.bodyTags.push({
          tag: 'script',
          attrs: {
            id: REACT_RENDERER_IDENTITY_ELEMENT_ID,
            type: 'application/json',
          },
          children: escapeInlineDataJSON(JSON.stringify(identity)),
        });
        return tags;
      });
    },
  };
  return {
    name: '@modern-js/renderer-react-build-metadata',
    post: ['@modern-js/plugin-analyze', '@modern-js/plugin-bff'],
    setup(api) {
      if (isEntryMetadataRead()) return;
      const { appDirectory, command } = api.getAppContext();
      development = command === 'dev';
      if (command === 'build' || command === 'deploy') {
        const resolveBffRuntimeBuildIdentity: BffRuntimeBuildIdentityProvider =
          async compilation => {
            if (
              compilation.appDirectory !== appDirectory ||
              api.getAppContext().appDirectory !== appDirectory
            )
              throw new Error(
                'React BFF runtime identity requires its owning application compilation',
              );
            if (!identities)
              throw new Error(
                'React BFF runtime identity requires a completed renderer build',
              );
            return Object.freeze({
              buildMarker: identities.buildMarker,
              sourceRevision: identities.sourceRevision,
            });
          };
        api.updateAppContext({ resolveBffRuntimeBuildIdentity });
      }

      api.generateEntryCode(async ({ entrypoints }) => {
        const context = api.getAppContext();
        // A running dev session keeps its first identity; restart to change it.
        if (context.apiOnly || entrypoints.length === 0 || identities) return;
        identities = await options.resolveBuildIdentities({
          entrypoints: entrypoints.map(entrypoint => ({ ...entrypoint })),
          appDirectory: context.appDirectory,
          internalDirectory: context.internalDirectory,
          distDirectory: context.distDirectory,
          packageName: context.packageName,
          config: api.getNormalizedConfig(),
          pluginNames: context.plugins.map(plugin => plugin.name),
          consumedSourceInputs: getConfigurationSourceInputs(api),
          configurationSourceSnapshot: getConfigurationSourceSnapshot(api),
          configurationSourceNodes: getConfigurationSourceNodes(api),
          ...(context.command === 'dev'
            ? { mode: 'development' as const }
            : {}),
        });
        options.onBuildIdentities?.(identities);
      });

      api.modifyResolvedConfig(config => ({
        ...config,
        builderPlugins: [...(config.builderPlugins ?? []), builderPlugin],
      }));

      api.modifyBuilderEnvironments(({ environments }) => {
        const resolved = identities;
        return {
          environments: Object.fromEntries(
            Object.entries(environments).map(([name, environment]) => [
              name,
              {
                ...environment,
                performance: {
                  ...environment.performance,
                  buildCache:
                    !resolved?.cacheAllowed ||
                    environment.performance?.buildCache === false
                      ? false
                      : {
                          ...(typeof environment.performance?.buildCache ===
                          'object'
                            ? environment.performance.buildCache
                            : {}),
                          cacheDigest: [
                            ...(typeof environment.performance?.buildCache ===
                            'object'
                              ? (environment.performance.buildCache
                                  .cacheDigest ?? [])
                              : []),
                            'react',
                            resolved.buildMarker,
                            resolved.profileDigest,
                            resolved.compilerDigest,
                          ],
                        },
                },
              },
            ]),
          ),
        };
      });

      api._internalServerPlugins(async ({ plugins }) => {
        const { command, distDirectory, apiOnly } = api.getAppContext();
        if (apiOnly) return { plugins };
        const reuseBuilt =
          command === 'serve' ||
          (command === 'deploy' &&
            getArgv().some(argument =>
              ['--skip-build', '-s'].includes(argument),
            ));
        if (reuseBuilt)
          identities = await readRendererBuildManifest(
            distDirectory,
            profile,
            manifestValidation,
          );
        if (!identities)
          throw new Error(
            'React server metadata requires resolved build identities',
          );
        const name = await resolveReactMetadataServerPlugin();
        if (plugins.some(plugin => plugin.name === name))
          throw new Error('Duplicate React server renderer identity plugin');
        return {
          plugins: [
            ...plugins,
            { name, options: { entries: identities.identities } },
          ],
        };
      });

      api.onAfterBuild(async ({ stats }) => {
        const { apiOnly, distDirectory } = api.getAppContext();
        if (apiOnly) return;
        if (!identities)
          throw new Error('React build metadata requires its analyzed inputs');
        if (!stats || stats.hasErrors())
          throw new Error(
            'React build metadata requires successful compiler stats',
          );
        const manifest = validateRendererBuildManifest(
          {
            ...identities,
            schema: 'ultramodern-renderer-build',
            version: 1,
            profile,
          },
          profile,
          manifestValidation,
        );
        const output = path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE);
        await fs.mkdir(distDirectory, { recursive: true });
        const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, JSON.stringify(manifest));
          await fs.rename(temporary, output);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      });
    },
  };
}
