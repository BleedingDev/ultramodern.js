import {
  createDispatchWorkerNameEnv,
  createWorkerBindingEnv,
  createWorkerBindingName,
} from '../backend-federation';
import {
  appEmitsBrowserUi,
  appHasApi,
  createBackendFederationName,
  createCloudflarePublicUrlEnv,
  createCloudflareWorkerName,
  createShellHost,
  resolveApiPrefix,
  resolveApiProtocol,
  resolveRemoteRefs,
  shellApp,
} from '../descriptors';
import { renderFileTemplate } from '../fs-io';
import {
  createRspackChunkLoadingGlobal,
  createRspackUniqueName,
} from '../naming';
import { createCloudflareSecurityContract, formatTsJsonValue } from '../policy';
import type { WorkspaceApp } from '../types';
import { sortJsonValue } from '../types';
import { CLOUDFLARE_COMPATIBILITY_DATE } from '../versions';
import {
  createModuleFederationRemotesConfig,
  createModuleFederationRemoteUrlHelpers,
} from './remote-refs';
import {
  createSharedModuleFederationConfig,
  formatTsObjectLiteral,
} from './shared-config';

export function createAppModernConfig(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
  enableTailwind = true,
  configuredDevPorts?: number[],
): string {
  const emitsUi = appEmitsBrowserUi(app);
  const bffImport = appHasApi(app)
    ? "import { bffPlugin } from '@modern-js/plugin-bff';\n"
    : '';
  // A headless (api-only) unit has no browser MF surface, no Zephyr build and
  // no generated route metadata — its config must not import or register them.
  const uiImports = emitsUi
    ? `import { moduleFederationPlugin } from '@module-federation/modern-js-v3';
import { withZephyr as withZephyrRspack } from 'zephyr-rspack-plugin';
import { ultramodernLocalisedUrls } from './src/routes/ultramodern-route-metadata';
`
    : '';
  const zephyrPluginSource = emitsUi
    ? `const zephyrRspackPlugin = () => ({
  name: 'ultramodern-zephyr-rspack-plugin',
  pre: ['@modern-js/plugin-module-federation-config'],
  setup(api: {
    modifyRspackConfig: (
      handler: ReturnType<typeof withZephyrRspack>,
    ) => void;
  }) {
    api.modifyRspackConfig(
      withBuildConfigEnvironment(
        'ZE_FAIL_BUILD',
        'true',
        withZephyrRspack(),
      ),
    );
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
  const tailwindBuilderPluginsConfig = enableTailwind
    ? '  builderPlugins: [pluginTailwindcss()],\n'
    : '';
  const bffPluginEntry = appHasApi(app) ? '        bffPlugin(),\n' : '';
  const serviceBindings =
    app.kind === 'shell'
      ? resolveRemoteRefs(app, remotes).filter(appHasApi)
      : [];
  const serviceBindingsConfig =
    serviceBindings.length > 0
      ? `          services: [
${serviceBindings
  .map(
    service => `            {
              binding:
                envValue('${createWorkerBindingEnv(service)}') ??
                '${createWorkerBindingName(service)}',
              prefix: '${resolveApiPrefix(service)}',
              service:
                envValue('${createDispatchWorkerNameEnv(service)}') ??
                '${createCloudflareWorkerName(scope, service)}',
            },`,
  )
  .join('\n')}
          ],
`
      : '';
  const defaultAssetPrefixSource =
    app.kind === 'shell'
      ? "const defaultAssetPrefix = '/';"
      : `const remoteAssetOrigin =
  configuredCloudflareUrl ||
  inferredCloudflareUrl ||
  (cloudflareDeployEnabled ? '/' : \`http://localhost:\${port}\`);
const defaultRemoteAssetPrefix = \`\${remoteAssetOrigin.replace(/\\/+$/u, '')}/\`;
const defaultAssetPrefix = defaultRemoteAssetPrefix;`;
  const devAssetPrefixSource =
    app.kind === 'shell'
      ? `        // Keep shell dev assets origin-relative so the shell works through
        // tunnels and local previews without rewriting its own chunks.
        assetPrefix: '/',`
      : `        // Remote dev manifests must publish an absolute publicPath so host
        // shells load remoteEntry.js and exposed chunks from this dev server.
        assetPrefix,`;
  const developmentPorts = [
    ...new Set(
      (
        configuredDevPorts ?? [
          shellApp.port,
          app.port,
          ...remotes.map(remote => remote.port),
        ]
      ).filter(port => typeof port === 'number' && Number.isFinite(port)),
    ),
  ].toSorted((left, right) => left - right);
  const legacyCorsSource = `const moduleFederationDevServerOrigin =
  envValue('ULTRAMODERN_MF_DEV_ORIGIN') || 'http://localhost:${shellApp.port}';`;
  const configuredCorsSource = `const moduleFederationDevServerAllowedOrigins = [
${developmentPorts.map(port => `  'http://localhost:${port}',`).join('\n')}
];`;
  const configuredCorsDevServer = `        // MF assets are non-credentialed and only permit configured local app origins.
        server: {
          cors: {
            credentials: false,
            origin: moduleFederationDevServerAllowedOrigins,
          },
        },`;
  const useConfiguredCorsAllowlist = configuredDevPorts !== undefined;
  const configuredCorsHeader = useConfiguredCorsAllowlist
    ? developmentPorts.length === 1
      ? "'Access-Control-Allow-Origin': moduleFederationDevServerAllowedOrigins[0],"
      : ''
    : "'Access-Control-Allow-Origin': moduleFederationDevServerOrigin,";
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
    value19: useConfiguredCorsAllowlist
      ? configuredCorsSource
      : legacyCorsSource,
    value20: useConfiguredCorsAllowlist ? configuredCorsDevServer : '',
    value21: configuredCorsHeader,
    value22: uiImports,
    value23: zephyrPluginSource,
    value24: localisedUrlsEntry,
    value25: uiPluginEntries,
  });
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
${createModuleFederationDtsConfig(false)}
  filename: 'remoteEntry.js',
  name: '${shell.mfName}',
${createModuleFederationRemotesConfig(scope, shellHost, remotes)}${createSharedModuleFederationConfig()},
});

export default moduleFederationConfig;
`;
}

export function createBackendModuleFederationConfig(app: WorkspaceApp): string {
  return `import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const bffVersion = (
  require('@modern-js/plugin-bff/package.json') as { version: string }
).version;
const effectVersion = (
  require('effect/package.json') as { version: string }
).version;

const moduleFederationConfig: Parameters<
  typeof createModuleFederationConfig
>[0] = createModuleFederationConfig({
  dts: false,
  exposes: {
    './effect-api': './api/effect-api.ts',
  },
  filename: 'backendRemoteEntry.mjs',
  name: '${createBackendFederationName(app)}',
  shared: {
    '@modern-js/plugin-bff': {
      requiredVersion: bffVersion,
      singleton: true,
      treeShaking: false,
    },
    '@module-federation/runtime': {
      requiredVersion: dependencies['@module-federation/runtime'],
      singleton: true,
      treeShaking: false,
    },
    effect: {
      requiredVersion: effectVersion,
      singleton: true,
      treeShaking: false,
    },
  },
});

export default moduleFederationConfig;
`;
}

export function createRemoteModuleFederationConfig(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  const exposes = formatTsObjectLiteral(app.exposes ?? {});
  const hasExposes = Object.keys(app.exposes ?? {}).length > 0;
  const hostOnlyMarker = hasExposes ? '' : '\n// ultramodern-mf: no-exposes';
  const tsgoCompilerImport = hasExposes
    ? "import { resolveEffectTsgoCompiler } from '@modern-js/app-tools/config';\n"
    : '';
  const tsgoCompilerInstance = hasExposes
    ? `
const tsgoCompilerInstance =
  resolveEffectTsgoCompiler({ from: import.meta.url });
`
    : '';
  return `${hostOnlyMarker}
${tsgoCompilerImport}import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

${createModuleFederationRemoteUrlHelpers(app, remotes)}
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
${createModuleFederationDtsConfig(hasExposes)}
  exposes: ${exposes},
  filename: 'remoteEntry.js',
  name: '${app.mfName}',
${createModuleFederationRemotesConfig(scope, app, remotes)}${createSharedModuleFederationConfig()},
});

export default moduleFederationConfig;
`;
}
