import {
  appEmitsBrowserUi,
  appHasApi,
  createBackendFederationName,
  createCloudflarePublicUrlEnv,
  createRemoteManifestEnv,
  resolveApiPrefix,
  resolveApiProtocol,
  resolveRemoteRefs,
} from '../descriptors';
import { renderFileTemplate } from '../fs-io';
import {
  createRspackChunkLoadingGlobal,
  createRspackUniqueName,
  relativeRootFor,
} from '../naming';
import { createCloudflareSecurityContract, formatTsJsonValue } from '../policy';
import { hasNativeAppGeneration } from '../renderer-generations';
import {
  resolveAppGenerationProfile,
  resolveWorkspaceRenderer,
} from '../renderer-profile';
import type { WorkspaceApp } from '../types';
import {
  createModuleFederationRemotesConfig,
  createModuleFederationRemoteUrlHelpers,
} from './remote-refs';
import {
  createSharedModuleFederationConfig,
  formatTsObjectLiteral,
} from './shared-config';

export function createAppModernConfig(
  app: WorkspaceApp,
  enableTailwind = true,
): string {
  const renderer = resolveWorkspaceRenderer(app);
  if (hasNativeAppGeneration(renderer)) {
    const generation = resolveAppGenerationProfile(app)!;
    const exposes = Object.keys(app.exposes ?? {}).length > 0;
    return `import { defineConfig } from '@modern-js/ultramodern-app-tools';
${exposes ? "import { createRemoteManifestUrl } from '@modern-js/app-tools-extensions/config';\n" : ''}
${appHasApi(app) ? "import { bffPlugin } from '@modern-js/plugin-bff-build-extensions';\n" : ''}
${enableTailwind ? "import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss';\n" : ''}
${
  exposes
    ? `// Set ${createCloudflarePublicUrlEnv(app)} to this remote's public origin when deploying.
const remoteAddress = createRemoteManifestUrl({
  manifestEnv: ${JSON.stringify(createRemoteManifestEnv(app))},
  publicUrlEnv: ${JSON.stringify(createCloudflarePublicUrlEnv(app))},
  mfName: ${JSON.stringify(app.mfName)},
  port: ${app.port},
});
const assetPrefix = new URL('.', remoteAddress.replace(/^[^@]+@(?=https?:\\/\\/)/u, '')).href;

`
    : ''
}
export default defineConfig({
${enableTailwind ? '  builderPlugins: [pluginTailwindcss()],\n' : ''}  renderer: ${JSON.stringify(renderer)},
${appHasApi(app) ? '  plugins: [bffPlugin()],\n' : ''}
${exposes ? '  output: { assetPrefix },\n' : ''}
  server: { port: ${app.port}, ssr: ${generation.capabilities.ssr}${
    appHasApi(app)
      ? `,
    bff: {
      effect: {
        entry: './api/index',
${resolveApiProtocol(app) === 'rest' ? "        openapi: { path: '/openapi.json' },\n" : ''}        strictEffectApproach: true,
      },
      prefix: ${JSON.stringify(resolveApiPrefix(app))},
      runtimeFramework: 'effect',
    }`
      : ''
  } },
  source: { mainEntryName: 'main' },
});
`;
  }
  // Source config is authored before entry discovery. Its generation seed must
  // remain reproducible after the owning router binding has been captured;
  // finalized delivery/build identities still bind that actual discovered ABI.
  const deliveryUnit = createDeliveryUnitRecord(scope, {
    ...app,
    routerBindings: undefined,
    rendererIdentity: app.rendererIdentity
      ? { ...app.rendererIdentity, entryName: 'index' }
      : undefined,
  });
  const emitsUi = appEmitsBrowserUi(app);
  const bffImport = appHasApi(app)
    ? "import { bffPlugin } from '@modern-js/plugin-bff-build-extensions';\n"
    : '';
  const uiImports = emitsUi
    ? `import { getBuildConfigEnvironment, withBuildConfigEnvironment } from '@modern-js/app-tools-extensions/config';
import { i18nPlugin } from '@modern-js/plugin-i18n';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';
import type { withZephyr as withZephyrRspack } from 'zephyr-rspack-plugin';
import { ultramodernLocalisedUrls } from './src/routes/ultramodern-route-metadata';
`
    : "import { getBuildConfigEnvironment } from '@modern-js/app-tools-extensions/config';\n";
  const zephyrPluginSource = emitsUi
    ? `const zephyrRspackPlugin = () => ({
  name: 'ultramodern-zephyr-rspack-plugin',
  pre: ['@modern-js/plugin-module-federation-config'],
  setup(api: {
    modifyRspackConfig: (
      handler: ReturnType<typeof withZephyrRspack>,
    ) => void;
  }) {
    // Zephyr uploads federated build artifacts to Zephyr Cloud (the fast
    // rollback path). Uploading REQUIRES a Zephyr Cloud account and, in CI, a
    // deploy-scoped ZE_CI_TOKEN; without it Zephyr fatally fails to load its
    // application configuration. Zephyr therefore engages ONLY for such an
    // authoritative deploy — a plain build never contacts Zephyr Cloud, needs
    // no account, and is never blocked. This is the framework's "works with or
    // without Zephyr" contract. The plugin stays registered unconditionally
    // (this gate keys on Zephyr's native deploy token, not any UltraModern
    // opt-out). When deploying, ZE_FAIL_BUILD=true makes an upload failure a
    // hard build failure.
    const zephyrCiDeploy =
      (getBuildConfigEnvironment('ZE_CI_TOKEN') ?? '').length > 0;
    if (!zephyrCiDeploy) {
      return;
    }
    api.modifyRspackConfig(async config => {
      const { withZephyr: withZephyrRspack } = await import('zephyr-rspack-plugin');
      return withBuildConfigEnvironment(
        'ZE_FAIL_BUILD',
        'true',
        withZephyrRspack(),
      )(config);
    });
  },
});

`
    : '';
  const localisedUrlsEntry = emitsUi
    ? '            localisedUrls: ultramodernLocalisedUrls as Record<string, Record<string, string>>,\n'
    : '';
  const uiPluginEntries = emitsUi
    ? '        moduleFederationPlugin(),\n        zephyrRspackPlugin(),\n'
    : '';
  const tailwindImport = enableTailwind
    ? "import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss';\n"
    : '';
  const bffConfig = appHasApi(app)
    ? `      bff: {
        effect: {
          entry: './api/index',
${resolveApiProtocol(app) === 'rest' ? "          openapi: {\n            path: '/openapi.json',\n          },\n" : ''}
          strictEffectApproach: true,
        },
        prefix: '${resolveApiPrefix(app)}',
        runtimeFramework: 'effect',
      },
`
    : '';
  return renderFileTemplate('workspace/apps/modern.config.ts', {
    value0: `${bffImport}${tailwindImport}`,
    value1: app.id,
    value2: createCloudflareWorkerName(scope, app),
    value3: app.portEnv,
    value4: String(app.port),
    value5: createCloudflarePublicUrlEnv(app),
    value6: String(shellApp.port),
    value7: defaultAssetPrefixSource,
    value8: createCloudflarePublicUrlEnv(app),
    value9: bffConfig,
    value10: CLOUDFLARE_COMPATIBILITY_DATE,
    value11: formatTsJsonValue(
      sortJsonValue(createCloudflareSecurityContract()),
      16,
    ),
    value12: serviceBindingsConfig,
    value13: devAssetPrefixSource,
    value14: resolveApiPrefix(app),
    value15: bffPluginEntry,
    value16: createRspackUniqueName(app),
    value17: createRspackChunkLoadingGlobal(app),
    value18: tailwindBuilderPluginsConfig,
    value19: configuredCorsSource,
    value20: configuredCorsDevServer,
    value21: configuredCorsHeader,
    value22: uiImports,
    value23: zephyrPluginSource,
    value24: localisedUrlsEntry,
    value25: uiPluginEntries,
    value26: deliveryUnit.unitId,
    value27: deliveryUnit.buildMarker,
    value28: deliveryUnit.version,
    value29: relativeRootFor(app.directory),
    value30: emitsUi
      ? renderFileTemplate('workspace/apps/modern.config.ui-plugins.ts', {
          value14: resolveApiPrefix(app),
          value24: localisedUrlsEntry,
        })
      : '',
    value31: emitsUi
      ? "        alias: {\n          '@modern-js/plugin-i18n/runtime$':\n            '@modern-js/plugin-i18n/runtime/no-react-i18next',\n        },\n"
      : '',
  });
}

// TanStack Router is the frontend router of every generated workspace, so no
// generated app installs react-router. `@module-federation/bridge-react` is
// still a generated dependency (the patched `@module-federation/modern-js-v3`
// runtime re-exports it), and its default entry imports `react-router-dom`.
// `enableBridgeRouter: false` is the supported escape hatch: the MF plugin then
// skips the React bridge plugin — which would alias `react-router-dom` — and
// aliases `@module-federation/bridge-react` to its router-free `base` entry
// instead. The MF plugin never inspects react-router itself, so an app that
// genuinely brings React Router only gets the bridge router back by declaring
// `enableBridgeRouter: true` — which is why the flag is emitted from the app's
// own declared dependencies rather than assumed.
function createModuleFederationBridgeConfig(
  enableBridgeRouter: boolean,
): string {
  return `  bridge: {
    enableBridgeRouter: ${enableBridgeRouter},
  },`;
}

function createModuleFederationDtsConfig(hasExposes: boolean): string {
  return hasExposes
    ? `  dts: {
    displayErrorInTerminal: true,
    generateTypes: {
      compilerInstance: tsgoCompilerInstance,
    },
    tsConfigPath: './tsconfig.mf-types.json',
  },`
    : `  dts: {
    consumeTypes: true,
    generateTypes: false,
    tsConfigPath: './tsconfig.mf-types.json',
  },`;
}

export function createShellModuleFederationConfig(
  scope: string,
  shell: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
  enableBridgeRouter = false,
): string {
  const shellHost = {
    ...shell,
    verticalRefs: shell.verticalRefs ?? remotes.map(remote => remote.id),
  };

  return `// ultramodern-mf: host-only
import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

${createModuleFederationRemoteUrlHelpers(shellHost, remotes)}
const require = createRequire(import.meta.url);
const pluginI18nVersion = (require('@modern-js/plugin-i18n/package.json') as { version: string }).version;
const pluginTanstackVersion = (require('@modern-js/plugin-tanstack/package.json') as { version: string }).version;
const runtimeVersion = (require('@modern-js/runtime/package.json') as { version: string }).version;
const reactVersion = (require('react/package.json') as { version: string }).version;
const reactDomVersion = (require('react-dom/package.json') as { version: string }).version;

const moduleFederationConfig: Parameters<
  typeof createModuleFederationConfig
>[0] = createModuleFederationConfig({
${createModuleFederationBridgeConfig(enableBridgeRouter)}
${createModuleFederationDtsConfig(false)}
  filename: 'remoteEntry.js',
  name: '${shell.mfName}',
${createModuleFederationRemotesConfig(scope, shellHost, remotes)}${createSharedModuleFederationConfig()},
});

export default moduleFederationConfig;
`;
}

export function createBackendModuleFederationConfig(app: WorkspaceApp): string {
  const plainConfig = resolveWorkspaceRenderer(app) !== 'react';
  return `import { createRequire } from 'node:module';
${plainConfig ? '' : "import { createModuleFederationConfig } from '@module-federation/modern-js-v3';\n"}
${plainConfig ? '' : "import { dependencies } from './package.json';\n"}

const require = createRequire(import.meta.url);
const bffVersion = (
  require('@modern-js/plugin-bff/package.json') as { version: string }
).version;
const effectVersion = (
  require('effect/package.json') as { version: string }
).version;
${
  plainConfig
    ? `const federationRuntimeVersion = (
  require('@module-federation/runtime/package.json') as { version: string }
).version;
`
    : ''
}

const moduleFederationConfig${
    plainConfig
      ? ''
      : `: Parameters<
  typeof createModuleFederationConfig
>[0]`
  } = ${plainConfig ? '' : 'createModuleFederationConfig('}{
  dts: false,
  exposes: {
    './effect-api': './api/effect-api.ts',
  },
  filename: 'backendRemoteEntry.cjs',
  library: {
    type: 'commonjs-module',
  },
  name: '${createBackendFederationName(app)}',
  shared: {
    '@modern-js/plugin-bff': {
      requiredVersion: bffVersion,
      singleton: true,
      treeShaking: false,
    },
    '@module-federation/runtime': {
      requiredVersion: ${plainConfig ? 'federationRuntimeVersion' : "dependencies['@module-federation/runtime']"},
      singleton: true,
      treeShaking: false,
    },
    effect: {
      requiredVersion: effectVersion,
      singleton: true,
      treeShaking: false,
    },
  },
}${plainConfig ? '' : ')'};

export default moduleFederationConfig;
`;
}

/** Native MF owns runtime sharing through the selected renderer adapter. */
export function createNativeModuleFederationConfig(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  return `${createModuleFederationRemoteUrlHelpers(app, remotes)}export default {
  name: ${JSON.stringify(app.mfName)},
  filename: 'remoteEntry.js',
  exposes: ${formatTsObjectLiteral(app.exposes ?? {})},
${createModuleFederationRemotesConfig(scope, app, remotes)}};
`;
}

export function createRemoteModuleFederationConfig(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
  enableBridgeRouter = false,
): string {
  const exposes = formatTsObjectLiteral(app.exposes ?? {});
  const hasExposes = Object.keys(app.exposes ?? {}).length > 0;
  const hasRemoteRefs = resolveRemoteRefs(app, remotes).length > 0;
  const hostOnlyMarker = hasExposes ? '' : '\n// ultramodern-mf: no-exposes';
  const appToolsConfigImports = [
    ...(hasRemoteRefs ? ['createRemoteManifestUrl'] : []),
    ...(hasExposes ? ['resolveEffectTsgoCompiler'] : []),
  ];
  const appToolsConfigImport =
    appToolsConfigImports.length > 0
      ? `import { ${appToolsConfigImports.join(', ')} } from '@modern-js/app-tools-extensions/config';\n`
      : '';
  const tsgoCompilerInstance = hasExposes
    ? `
const tsgoCompilerInstance =
  resolveEffectTsgoCompiler({ from: import.meta.url });
`
    : '';
  return `${hostOnlyMarker}
${appToolsConfigImport}import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

${createModuleFederationRemoteUrlHelpers(app, remotes, false)}
const require = createRequire(import.meta.url);
const pluginI18nVersion = (require('@modern-js/plugin-i18n/package.json') as { version: string }).version;
const pluginTanstackVersion = (require('@modern-js/plugin-tanstack/package.json') as { version: string }).version;
const runtimeVersion = (require('@modern-js/runtime/package.json') as { version: string }).version;
const reactVersion = (require('react/package.json') as { version: string }).version;
const reactDomVersion = (require('react-dom/package.json') as { version: string }).version;
${tsgoCompilerInstance}
const moduleFederationConfig: Parameters<
  typeof createModuleFederationConfig
>[0] = createModuleFederationConfig({
${createModuleFederationBridgeConfig(enableBridgeRouter)}
${createModuleFederationDtsConfig(hasExposes)}
  exposes: ${exposes},
  filename: 'remoteEntry.js',
  name: '${app.mfName}',
${createModuleFederationRemotesConfig(scope, app, remotes)}${createSharedModuleFederationConfig()},
});

export default moduleFederationConfig;
`;
}
