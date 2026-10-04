import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type {
  RendererBuildIdentities,
  RendererGeneratedOutputIdentityLease,
} from '@modern-js/app-tools-extensions/renderer-build-identity';
import { findHostingModuleDirectory } from '@modern-js/app-tools-extensions/runtime-package-resolution';
import type {
  BffRuntimeBuildIdentityProvider,
  WithBffRuntimeBuildIdentity,
} from '@modern-js/plugin-bff-build-extensions';
import { escapeInlineDataJSON } from '@modern-js/renderer-core/data';
import { getArgv } from '@modern-js/utils';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import { isEntryMetadataRead } from './config-read-context';
import {
  getConfigurationSourceInputs,
  getConfigurationSourceNodes,
  getConfigurationSourceSnapshot,
} from './configuration-read-context';
import {
  assertRendererBuildInputsUnchanged,
  RENDERER_BUILD_MANIFEST_FILE,
  RENDERER_DEVELOPMENT_DIRECTORY,
  readRendererBuildManifest,
  validateRendererBuildManifest,
  validateRendererDevelopmentBuildManifest,
} from './native-build-manifest';
import type { NativeInfrastructureOptions } from './native-infrastructure';
import { reactAuthoredInputPaths } from './react-authored-inputs';
import {
  type ReactGeneratedOutputPhaseController,
  ReactTypedCssPhase,
} from './react-typed-css-phase';
import { resolveRendererProfile } from './renderer-profile';

export const REACT_RENDERER_IDENTITY_ELEMENT_ID =
  'ultramodern-renderer-identity';

export interface ReactBuildMetadataOptions {
  generatedOutputs?: ReactGeneratedOutputPhaseController & {
    bindPhase(
      phase: ReactTypedCssPhase,
      context: Parameters<
        NonNullable<NativeInfrastructureOptions['resolveBuildIdentities']>
      >[0],
    ): void;
  };
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

/** Bind the existing React output to its actual application and framework inputs. */
export function reactRendererBuildMetadataPlugin(
  options: ReactBuildMetadataOptions,
): CliPlugin<WithBffRuntimeBuildIdentity<AppTools>> {
  const profile = resolveRendererProfile('react');
  let identities: RendererBuildIdentities | undefined;
  let typedCssPhase: ReactTypedCssPhase | undefined;
  let developmentGeneration = 0;
  let developmentSession: RendererBuildIdentities | undefined;
  let developmentWave: RendererBuildIdentities | undefined;
  let inputContext:
    | Parameters<ReactBuildMetadataOptions['resolveBuildIdentities']>[0]
    | undefined;
  let initializePhase: (() => void) | undefined;
  const preparePhase = () => {
    const initialize = initializePhase;
    if (!initialize) return;
    initialize();
    if (initializePhase === initialize) initializePhase = undefined;
  };
  const builderPlugin: RsbuildPlugin = {
    name: 'ultramodern:react:build-metadata',
    setup(api) {
      preparePhase();
      typedCssPhase?.install(api);
      if (inputContext?.mode === 'development')
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
            // Native rendered HTML caching skips the tag hook and retains the
            // pending bytes captured before completed compiler metadata exists.
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
        if (!identity && !typedCssPhase)
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
          children: typedCssPhase
            ? typedCssPhase.pendingHTML(
                filename,
                entryName,
                developmentSession?.identities[entryName],
              )
            : escapeInlineDataJSON(JSON.stringify(identity)),
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
            const resolved = typedCssPhase
              ? await typedCssPhase.resolveIdentities()
              : identities;
            if (!resolved)
              throw new Error(
                'React BFF runtime identity requires a completed renderer build',
              );
            return Object.freeze({
              buildMarker: resolved.buildMarker,
              sourceRevision: resolved.sourceRevision,
            });
          };
        api.updateAppContext({ resolveBffRuntimeBuildIdentity });
      }
      const publishMetadata = async (
        stats: Rspack.Stats | Rspack.MultiStats | undefined,
        resolved: RendererBuildIdentities,
        development = false,
        assertCurrent: () => void = () => {},
      ) => {
        const { apiOnly, distDirectory } = api.getAppContext();
        if (apiOnly) return;
        if (!inputContext)
          throw new Error('React build metadata requires its analyzed inputs');
        const assertPinned = async () => {
          assertCurrent();
          await inputContext?.generatedOutputs?.assertCurrent();
          assertCurrent();
        };
        await assertPinned();
        if (!stats || stats.hasErrors())
          throw new Error(
            'React build metadata requires successful compiler stats',
          );
        if (development && (resolved.cacheAllowed || resolved.promotable))
          throw new Error(
            'React development metadata cannot be promoted or cached',
          );
        const results = 'stats' in stats ? stats.stats : [stats];
        const client = results.find(
          result => result.compilation.name === 'client',
        );
        if (!client?.compilation.hash)
          throw new Error(
            'React build metadata requires a completed client compilation',
          );
        const outputDirectory = client.compilation.outputOptions.path;
        if (!outputDirectory)
          throw new Error('React client compilation has no output directory');
        for (const entryName of Object.keys(resolved.identities)) {
          const entry = client.compilation.entrypoints.get(entryName);
          const files = entry?.getFiles() ?? [];
          if (!files.some(file => /\.[cm]?js$/u.test(file)))
            throw new Error(
              `React application entry ${entryName} was not emitted`,
            );
          for (const file of files) {
            const asset = client.compilation.getAsset(file);
            if (!asset)
              throw new Error(
                `React entry references an unemitted asset ${file}`,
              );
            if (development) {
              if (asset.source.size() === 0)
                throw new Error(
                  `React output asset ${file} is missing or empty`,
                );
            } else {
              await assertPinned();
              const output = await fs.stat(path.join(outputDirectory, file));
              await assertPinned();
              if (!output.isFile() || output.size === 0)
                throw new Error(
                  `React output asset ${file} is missing or empty`,
                );
            }
            assertCurrent();
          }
        }
        typedCssPhase?.assertAuthoredInputsUnchanged();
        await assertPinned();
        const completed = await options.resolveBuildIdentities(inputContext);
        await assertPinned();
        const captured = development ? developmentWave : resolved;
        if (!captured)
          throw new Error(
            'React development metadata has no captured compiler wave',
          );
        assertRendererBuildInputsUnchanged(captured, completed);
        const buildMetadata = {
          ...resolved,
          schema: 'ultramodern-renderer-build',
          version: 1,
          profile,
        };
        const generation = developmentGeneration + 1;
        const compilationHashes = development
          ? Object.fromEntries(
              results.map(result => {
                const { name, hash } = result.compilation;
                if (!name || !hash)
                  throw new Error(
                    'React development metadata requires completed named compiler hashes',
                  );
                return [name, hash];
              }),
            )
          : undefined;
        if (
          compilationHashes &&
          Object.keys(compilationHashes).length !== results.length
        )
          throw new Error('React development compiler names must be unique');
        const manifest = development
          ? validateRendererDevelopmentBuildManifest(
              {
                ...buildMetadata,
                devCompilation: {
                  compilationHashes,
                  generation,
                  sourceInputDigest: completed.inputDigest,
                },
              },
              profile,
            )
          : validateRendererBuildManifest(buildMetadata, profile);
        const output = path.join(
          distDirectory,
          ...(development ? [RENDERER_DEVELOPMENT_DIRECTORY] : []),
          RENDERER_BUILD_MANIFEST_FILE,
        );
        await assertPinned();
        await fs.mkdir(path.dirname(output), { recursive: true });
        await assertPinned();
        const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await assertPinned();
          await fs.writeFile(temporary, JSON.stringify(manifest));
          await assertPinned();
          typedCssPhase?.assertAuthoredInputsUnchanged();
          await assertPinned();
          await fs.rename(temporary, output);
          await assertPinned();
          if (development) developmentGeneration = generation;
        } finally {
          await fs.rm(temporary, { force: true });
        }
      };
      api.generateEntryCode(async ({ entrypoints }) => {
        const context = api.getAppContext();
        if (context.apiOnly || entrypoints.length === 0) return;
        inputContext = {
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
        };
        const captured = inputContext;
        const generatedOutputsController = captured.pluginNames?.includes(
          '@modern-js/plugin-module-federation-config',
        )
          ? options.generatedOutputs
          : undefined;
        const finalize = async (
          stats: Rspack.Stats | Rspack.MultiStats,
          generatedOutputs?: RendererGeneratedOutputIdentityLease,
        ) => {
          const results = 'stats' in stats ? stats.stats : [stats];
          await generatedOutputs?.assertCurrent();
          const dependencies = [
            ...new Set(
              results.flatMap(result => [
                ...result.compilation.fileDependencies,
              ]),
            ),
          ].sort();
          const compilerInputs = Object.freeze(
            await Promise.all(
              dependencies.map(async filename => {
                generatedOutputs?.assertEpochCurrent();
                const state = await fs.stat(filename);
                generatedOutputs?.assertEpochCurrent();
                const kind = state.isFile()
                  ? 'file'
                  : state.isDirectory()
                    ? 'directory'
                    : undefined;
                if (!kind)
                  throw new Error(
                    `React compiler dependency has an unsupported filesystem kind: ${filename}`,
                  );
                return Object.freeze({ path: filename, kind });
              }),
            ),
          );
          const inputFiles = Object.freeze(
            compilerInputs
              .filter(input => input.kind === 'file')
              .map(input => input.path),
          );
          const resolutionContext = {
            ...captured,
            generatedOutputs,
            compilerInputs,
            inputFiles,
          };
          inputContext = resolutionContext;
          await generatedOutputs?.assertCurrent();
          if (context.command === 'dev') {
            const client = results.find(
              result => result.compilation.name === 'client',
            );
            if (client?.compilation.options.mode !== 'development')
              throw new Error(
                'React development metadata requires an actual development compiler',
              );
          }
          const completed = validateRendererBuildManifest(
            {
              ...(await options.resolveBuildIdentities(resolutionContext)),
              schema: 'ultramodern-renderer-build',
              version: 1,
              profile,
            },
            profile,
          );
          await generatedOutputs?.assertCurrent();
          if (context.command === 'dev') {
            if (completed.cacheAllowed || completed.promotable)
              throw new Error(
                'React development inputs cannot be promoted or cached',
              );
            if (developmentSession) {
              // The private completed graph seeds the session. Its first live
              // wave must reproduce that entire graph before any publication.
              if (developmentGeneration === 0)
                assertRendererBuildInputsUnchanged(
                  developmentSession,
                  completed,
                );
              for (const key of [
                'profileDigest',
                'compilerDigest',
                'frameworkCohortDigest',
                'routerBindings',
              ] as const)
                if (!isDeepStrictEqual(developmentSession[key], completed[key]))
                  throw new Error(
                    `React development session ${key} changed; restart the CLI from the current framework and configuration`,
                  );
              const entryContracts = (value: RendererBuildIdentities) =>
                Object.fromEntries(
                  Object.entries(value.identities).map(([name, identity]) => [
                    name,
                    {
                      renderer: identity.renderer,
                      appId: identity.appId,
                      entryName: identity.entryName,
                      protocolVersion: identity.protocolVersion,
                    },
                  ]),
                );
              if (
                !isDeepStrictEqual(
                  entryContracts(developmentSession),
                  entryContracts(completed),
                )
              )
                throw new Error(
                  'React development session application entries changed; restart the CLI with the current entry graph',
                );
            } else developmentSession = completed;
            developmentWave = completed;
            identities = developmentSession;
          } else identities = completed;
          return identities;
        };
        // Analyze awaits the full native entry-generation bus before its
        // builder lifecycle. Capture producer bytes only at that boundary.
        initializePhase = () => {
          if (
            context.command === 'build' &&
            getArgv().some(
              argument => argument === '--watch' || argument === '-w',
            )
          )
            throw new Error(
              'React production build --watch cannot publish a finalized runtime identity; use dev for watched compilation',
            );
          typedCssPhase = new ReactTypedCssPhase({
            appDirectory: captured.appDirectory,
            internalDirectory: captured.internalDirectory,
            distDirectory: captured.distDirectory,
            inputPaths: reactAuthoredInputPaths(captured),
            configurationSourceSnapshot: captured.configurationSourceSnapshot,
            produceTypedCss:
              captured.config.output.enableCssModuleTSDeclaration === true,
            bindRuntimeIdentity: true,
            generatedOutputs: generatedOutputsController,
            finalize,
            ...(context.command !== 'dev'
              ? {
                  publishMetadata: (
                    stats: Rspack.Stats | Rspack.MultiStats,
                    resolved: RendererBuildIdentities,
                    assertCurrent: () => void,
                  ) => publishMetadata(stats, resolved, false, assertCurrent),
                }
              : {}),
            ...(context.command === 'dev'
              ? {
                  publishDevelopment: (
                    stats: Rspack.Stats | Rspack.MultiStats,
                    resolved: RendererBuildIdentities,
                    assertCurrent: () => void,
                  ) => publishMetadata(stats, resolved, true, assertCurrent),
                }
              : {}),
          });
          generatedOutputsController?.bindPhase(typedCssPhase, captured);
        };
      });

      api.modifyResolvedConfig(config => ({
        ...config,
        builderPlugins: [...(config.builderPlugins ?? []), builderPlugin],
      }));

      api.modifyBuilderEnvironments(({ environments }) => {
        preparePhase();
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
          identities = await readRendererBuildManifest(distDirectory, profile);
        else preparePhase();
        if (!identities && !typedCssPhase)
          throw new Error(
            'React server metadata requires resolved build identities',
          );
        const name = await resolveReactMetadataServerPlugin();
        const phase = typedCssPhase;
        if (plugins.some(plugin => plugin.name === name))
          throw new Error('Duplicate React server renderer identity plugin');
        return {
          plugins: [
            ...plugins,
            {
              name,
              options:
                phase && !reuseBuilt
                  ? {
                      resolveEntries: async () =>
                        (await phase.resolveIdentities()).identities,
                      manifestFile: RENDERER_BUILD_MANIFEST_FILE,
                      ...(command === 'dev'
                        ? { manifestMode: 'development' as const }
                        : {}),
                    }
                  : { entries: identities!.identities },
            },
          ],
        };
      });

      api.onAfterBuild(async ({ stats }) => {
        const { apiOnly } = api.getAppContext();
        if (apiOnly) return;
        const resolved = typedCssPhase
          ? await typedCssPhase.resolveIdentities()
          : identities;
        if (!resolved)
          throw new Error('React build metadata requires its analyzed inputs');
        if (!typedCssPhase) await publishMetadata(stats, resolved);
      });
    },
  };
}
