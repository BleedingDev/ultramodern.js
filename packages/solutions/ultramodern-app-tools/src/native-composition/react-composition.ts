import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { type AppTools, appTools, type CliPlugin } from '@modern-js/app-tools';
import { createBuilderGenerator } from '@modern-js/app-tools/builder';
import backendFederationBuildPlugin from '@modern-js/app-tools-extensions/backend-federation-build';
import { createCloudflareBuilderPlugin } from '@modern-js/app-tools-extensions/cloudflare-builder';
import { createDeployOutputAliasesPlugin } from '@modern-js/app-tools-extensions/deploy-output/plugin';
import { resolveDeployTarget } from '@modern-js/app-tools-extensions/deploy-output/target';
import {
  RENDERER_EXTENSIONS_PACKAGE,
  SERVER_EXTENSIONS_PLUGIN_NAME,
} from '@modern-js/app-tools-extensions/policy-defaults';
import {
  collectRuntimePackageModuleDirectories,
  createRuntimePackageResolutionPlugin,
} from '@modern-js/app-tools-extensions/runtime-package-resolution';
import { ultramodernI18nIntegrationPlugin } from '@modern-js/i18n-integration';
import { runtimePlugin } from '@modern-js/runtime/cli';
import type { ReactNode } from 'react';
import {
  type ConfigSourceSnapshot,
  captureConfigSourceSnapshot,
} from './config-evaluator/source-snapshot';
import { getConfigurationSourceSnapshot } from './configuration-read-context';
import { ultramodernModuleFederationRecoveryPlugin } from './module-federation-recovery-plugin';
import { nativeEntryCommandPlugin } from './native-entry-command';
import { reactRendererBuildMetadataPlugin } from './react-build-metadata';
import { createReactReceiverOutputIntegration } from './react-mf-dts-outputs';
import { createReactRscWorkerIntegrationPlugin } from './react-rsc-worker-integration';
import { ultramodernReleaseEnvelopePlugin } from './release-envelope-plugin';
import { createRendererBuildOutputResolver } from './renderer-build-output';
import { createRendererBuildIdentityResolver } from './renderer-build-resolution';
import { rendererSelectionGuard } from './renderer-selection';
import { ultramodernRouterIntegrationPlugin } from './router-integration-plugin';
import { rscDisabledRuntimePlugin } from './rsc-disabled-plugin';
import { ultramodernSSRIntegrationPlugin } from './ssr-integration-plugin';

declare module '@modern-js/app-tools/cli-config' {
  interface CLIElementTypes {
    react: ReactNode;
  }
}

/** A portable application import of this exact SDK owner's public server export. */
export function resolveReactServerPlugin(
  appDirectory: string,
  snapshot: ConfigSourceSnapshot | undefined,
  registrarUrl = import.meta.url,
): string {
  if (!snapshot)
    throw new Error(
      'React server plugin requires the original configuration source snapshot',
    );
  const original = new Map(snapshot.states.map(state => [state.path, state]));
  const assertOriginalDeclaration = (filename: string) => {
    const current = captureConfigSourceSnapshot({
      sourceRoots: [],
      extraInputs: [filename],
    });
    if (
      current.states.some(
        state => !isDeepStrictEqual(state, original.get(state.path)),
      )
    )
      throw new Error(
        'React server plugin declaration changed after configuration load',
      );
  };
  const appManifestFile = path.join(appDirectory, 'package.json');
  assertOriginalDeclaration(appManifestFile);
  const appManifest = JSON.parse(fs.readFileSync(appManifestFile, 'utf8'));
  assertOriginalDeclaration(appManifestFile);
  let owner = path.dirname(fileURLToPath(registrarUrl));
  let ownerName: string;
  for (;;) {
    const manifestFile = path.join(owner, 'package.json');
    if (fs.existsSync(manifestFile)) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (
        ![
          '@modern-js/ultramodern-app-tools',
          '@bleedingdev/modern-js-ultramodern-app-tools',
        ].includes(manifest.name) ||
        !manifest.exports?.['./server-plugin']
      )
        throw new Error('React server registrar is not its owning package');
      ownerName = manifest.name;
      break;
    }
    const parent = path.dirname(owner);
    if (parent === owner)
      throw new Error('React server registrar has no owning package');
    owner = parent;
  }
  const ownerRequire = createRequire(path.join(owner, 'package.json'));
  const ownerExport = fs.realpathSync(
    ownerRequire.resolve(`${ownerName}/server-plugin`),
  );
  const appRequire = createRequire(appManifestFile);
  const declared = {
    ...appManifest.dependencies,
    ...appManifest.devDependencies,
    ...appManifest.optionalDependencies,
  };
  for (const name of new Set(['@modern-js/ultramodern-app-tools', ownerName])) {
    if (typeof declared[name] !== 'string') continue;
    const slot = appRequire.resolve
      .paths(name)
      ?.map(directory => path.join(directory, name))
      .find(directory => fs.existsSync(directory));
    if (slot) assertOriginalDeclaration(path.join(slot, 'package.json'));
    const specifier = `${name}/server-plugin`;
    if (fs.realpathSync(appRequire.resolve(specifier)) === ownerExport)
      return specifier;
  }
  throw new Error(
    'React server plugin has no declared application import of its SDK owner',
  );
}

const headlessCloudflareWorkerPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/headless-cloudflare-worker',
  post: ['@modern-js/ultramodern-release-envelope'],
  setup(api) {
    api.onAfterBuild(async () => {
      const appContext = api.getAppContext();
      const normalizedConfig = api.getNormalizedConfig();
      if (
        !appContext.apiOnly ||
        resolveDeployTarget(normalizedConfig) !== 'cloudflare'
      ) {
        return;
      }

      // Native API-only builds intentionally skip their UI builder. Reuse the
      // same builder generator with the Cloudflare plugin's worker-only entry.
      const createBuilderForModern = await createBuilderGenerator();
      const builder = await createBuilderForModern({
        appContext,
        normalizedConfig,
      });
      // This compiler has only an Effect worker entry. The framework SSR
      // adapter filters page entries and requires a UI route, so it does not
      // apply to a headless API worker.
      builder.removePlugins(['builder-plugin-adapter-modern-ssr']);
      await builder.build();
    });
  },
});

/** Existing React composition, loaded only when React is selected. */
export const composeReactRenderer = (
  options: { consumerPlugins?: readonly CliPlugin<AppTools>[] } = {},
): CliPlugin<AppTools> => {
  const receiverOutputs = createReactReceiverOutputIntegration();
  const selected = [
    nativeEntryCommandPlugin(),
    appTools(),
    runtimePlugin(),
    receiverOutputs.plugin,
    reactRendererBuildMetadataPlugin({
      resolveBuildIdentities: createRendererBuildIdentityResolver('react'),
      generatedOutputs: receiverOutputs.controller,
    }),
    ultramodernI18nIntegrationPlugin(),
    ultramodernRouterIntegrationPlugin(),
    ultramodernSSRIntegrationPlugin(),
    ultramodernModuleFederationRecoveryPlugin(),
    backendFederationBuildPlugin({
      rendererBuildPlugin: '@modern-js/renderer-react-build-metadata',
      resolveRendererBuild: createRendererBuildOutputResolver('react'),
    }),
    createCloudflareBuilderPlugin(),
    createReactRscWorkerIntegrationPlugin(),
    headlessCloudflareWorkerPlugin(),
    createDeployOutputAliasesPlugin(),
    ultramodernReleaseEnvelopePlugin(),
  ];
  return {
    name: '@modern-js/ultramodern-app-tools',
    usePlugins: [
      rendererSelectionGuard('react', selected, options.consumerPlugins, true),
      ...selected,
    ],
    setup(api) {
      // The composed runtime packages are dependencies of this package, not of
      // the app that composes it. Contribute the directories that host them so
      // the generated `runtime-register.js` resolves them under an isolated
      // (pnpm) linker without the app having to declare them itself.
      const runtimeModuleDirectories = collectRuntimePackageModuleDirectories(
        [RENDERER_EXTENSIONS_PACKAGE, '@modern-js/i18n-integration'],
        import.meta.url,
      );

      api.modifyResolvedConfig(config => {
        const builderPlugins = [
          ...(config.builderPlugins ?? []),
          ...(runtimeModuleDirectories.length > 0
            ? [createRuntimePackageResolutionPlugin(runtimeModuleDirectories)]
            : []),
          ...(config.server?.rsc ? [] : [rscDisabledRuntimePlugin()]),
        ];
        return { ...config, builderPlugins };
      });
      api._internalServerPlugins(({ plugins }) => {
        // Preserve a public import for generated deploy handlers, including
        // applications that declare the mapped SDK without its canonical alias.
        const name = resolveReactServerPlugin(
          api.getAppContext().appDirectory,
          getConfigurationSourceSnapshot(api),
        );
        const renamed = plugins.map(plugin =>
          plugin.name === SERVER_EXTENSIONS_PLUGIN_NAME
            ? { ...plugin, name }
            : plugin,
        );
        if (!renamed.some(plugin => plugin.name === name)) {
          renamed.push({ name });
        }
        return { plugins: renamed };
      });
      api._internalRuntimePlugins(({ entrypoint, plugins }) => {
        // Same story for the renderer descriptor: `appTools()` already appended
        // it unless the app opted out.
        if (
          !plugins.some(plugin => plugin.path === RENDERER_EXTENSIONS_PACKAGE)
        ) {
          plugins.push({
            name: 'rendererHead',
            path: RENDERER_EXTENSIONS_PACKAGE,
            config: {},
          });
        }
        return { entrypoint, plugins };
      });
    },
  };
};
