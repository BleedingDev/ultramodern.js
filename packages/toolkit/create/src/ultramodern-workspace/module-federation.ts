import {
  createDispatchWorkerNameEnv,
  createWorkerBindingEnv,
  createWorkerBindingName,
} from './backend-federation';
import { createBuildMarker, createDeliveryUnitRecord } from './delivery-unit';
import {
  appHasApi,
  createBackendFederationName,
  createCloudflarePublicUrlEnv,
  createCloudflareWorkerName,
  createRemoteManifestEnv,
  remoteDependencyAlias,
  resolveApiPrefix,
  resolveRemoteRefs,
  shellApp,
} from './descriptors';
import {
  createRspackChunkLoadingGlobal,
  createRspackUniqueName,
} from './naming';
import { createCloudflareSecurityContract, formatTsJsonValue } from './policy';
import type { WorkspaceApp } from './types';
import { sortJsonValue } from './types';
import { CLOUDFLARE_COMPATIBILITY_DATE } from './versions';

export function createAppModernConfig(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  const bffImport = appHasApi(app)
    ? "import { bffPlugin } from '@modern-js/plugin-bff';\n"
    : '';
  const bffConfig = appHasApi(app)
    ? `      bff: {
        effect: {
          entry: './api/index',
          openapi: {
            path: '/openapi.json',
          },
          strictEffectApproach: true,
        },
        prefix: '${resolveApiPrefix(app)}',
        runtimeFramework: 'effect',
      },
`
    : '';
  const bffPluginEntry = appHasApi(app) ? '        bffPlugin(),\n' : '';
  const serviceBindings = app.kind === 'shell' ? remotes.filter(appHasApi) : [];
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
  return `// @effect-diagnostics processEnv:off
import {
  appTools,
  defineConfig,
  presetUltramodern,
} from '@modern-js/app-tools';
${bffImport}import { i18nPlugin } from '@modern-js/plugin-i18n';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';
import { withZephyr as withZephyrRspack } from 'zephyr-rspack-plugin';
import { ultramodernLocalisedUrls } from './src/routes/ultramodern-route-metadata';

type ZephyrRspackConfig = Parameters<ReturnType<typeof withZephyrRspack>>[0];

const zephyrEnabled = process.env['ULTRAMODERN_ZEPHYR'] !== 'false';
const cloudflareDeployEnabled =
  process.env['MODERNJS_DEPLOY'] === 'cloudflare';

const parsedZephyrTimeoutMs = Number.parseInt(
  process.env['ULTRAMODERN_ZEPHYR_TIMEOUT_MS'] ?? '',
  10,
);
const zephyrTimeoutMs =
  Number.isFinite(parsedZephyrTimeoutMs) && parsedZephyrTimeoutMs > 0
    ? parsedZephyrTimeoutMs
    : 45000;

const zephyrWarn = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(
    \`[ultramodern] zephyr-rspack-plugin failed; continuing without Zephyr (set ULTRAMODERN_ZEPHYR=false to disable it): \${message}\`,
  );
};

const zephyrRspackPlugin = () => ({
  name: 'ultramodern-zephyr-rspack-plugin',
  pre: ['@modern-js/plugin-module-federation-config'],
  setup(api: {
    modifyRspackConfig: (
      handler: (
        config: ZephyrRspackConfig,
      ) => ZephyrRspackConfig | Promise<ZephyrRspackConfig>,
    ) => void;
  }) {
    if (!zephyrEnabled) {
      return;
    }
    api.modifyRspackConfig(config => {
      try {
        // Zephyr can not only throw/reject but also hang on a stalled network
        // call, wedging the whole build. Race it against a watchdog so a hang
        // degrades to an unmodified config instead of blocking indefinitely.
        const zephyrConfig = Promise.resolve(withZephyrRspack()(config)).catch(
          error => {
            zephyrWarn(error);
            return config;
          },
        );
        const watchdog = new Promise<ZephyrRspackConfig>(resolve => {
          const timer = setTimeout(() => {
            zephyrWarn(
              \`timed out after \${zephyrTimeoutMs}ms (override with ULTRAMODERN_ZEPHYR_TIMEOUT_MS)\`,
            );
            resolve(config);
          }, zephyrTimeoutMs);
          if (typeof timer.unref === 'function') {
            timer.unref();
          }
        });
        return Promise.race([zephyrConfig, watchdog]);
      } catch (error) {
        zephyrWarn(error);
        return config;
      }
    });
  },
});

const appId = '${app.id}';
const cloudflareWorkerName = '${createCloudflareWorkerName(scope, app)}';
const port = Number(process.env['${app.portEnv}'] ?? ${app.port});
const envValue = (name: string) => {
  const value = process.env[name]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
};
const configuredSiteUrl = envValue('MODERN_PUBLIC_SITE_URL');
const configuredCloudflareUrl = envValue('${createCloudflarePublicUrlEnv(app)}');
const configuredUltramodernAssetPrefix = envValue('ULTRAMODERN_ASSET_PREFIX');
const configuredModernAssetPrefix = envValue('MODERN_ASSET_PREFIX');
const moduleFederationDevServerOrigin =
  envValue('ULTRAMODERN_MF_DEV_ORIGIN') || 'http://localhost:${shellApp.port}';
const cloudflareWorkersDevSubdomain = envValue(
  'ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN',
);
const inferredCloudflareUrl =
  cloudflareDeployEnabled && cloudflareWorkersDevSubdomain !== undefined
    ? \`https://\${cloudflareWorkerName}.\${cloudflareWorkersDevSubdomain}.workers.dev\`
    : undefined;
// Site origin (SEO: canonical/hreflang URLs) prefers the site-wide public URL;
// the per-app deployment URL only fills in when no site origin is configured.
const siteUrl =
  configuredSiteUrl ||
  configuredCloudflareUrl ||
  inferredCloudflareUrl ||
  \`http://localhost:\${port}\`;
${defaultAssetPrefixSource}
// Asset loading is intentionally independent from the canonical site URL.
// Module Federation remotes must publish an absolute publicPath so browsers
// load remoteEntry.js and exposed chunks from the remote origin, not the host.
const assetPrefix =
  configuredModernAssetPrefix || configuredUltramodernAssetPrefix || defaultAssetPrefix;
const buildTarget = cloudflareDeployEnabled ? 'cloudflare' : 'web';
const buildOutputRoot = cloudflareDeployEnabled ? 'dist-cloudflare' : 'dist';
const buildTempDirectory = \`node_modules/.modern-js-\${appId}-\${buildTarget}\`;
const buildCacheDirectory = \`node_modules/.cache/rspack-\${appId}-\${buildTarget}\`;

if (
  cloudflareDeployEnabled &&
  process.env['ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS'] === 'true' &&
  configuredCloudflareUrl === undefined &&
  configuredSiteUrl === undefined &&
  inferredCloudflareUrl === undefined
) {
  throw new Error(
    \`Cloudflare deploy for \${appId} needs ${createCloudflarePublicUrlEnv(
      app,
    )}, MODERN_PUBLIC_SITE_URL, or ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN.\`,
  );
}

export default defineConfig(
  presetUltramodern(
    {
${bffConfig}      ...(cloudflareDeployEnabled
        ? {
            deploy: {
              worker: {
              compatibilityDate: '${CLOUDFLARE_COMPATIBILITY_DATE}',
              name: cloudflareWorkerName,
              security: ${formatTsJsonValue(sortJsonValue(createCloudflareSecurityContract()), 16)},
${serviceBindingsConfig}              ssr: true,
            },
          },
          }
        : {}),
      dev: {
${devAssetPrefixSource}
      },
      html: {
        outputStructure: 'flat',
      },
      output: {
        assetPrefix,
        disableTsChecker: false,
        distPath: {
          html: './',
          root: buildOutputRoot,
        },
        polyfill: 'off',
        splitRouteChunks: true,
        tempDir: buildTempDirectory,
      },
      performance: {
        buildCache: {
          cacheDigest: [appId, buildTarget],
          cacheDirectory: buildCacheDirectory,
        },
        rsdoctor: {
          disableClientServer: true,
          enabled: process.env['ULTRAMODERN_RSDOCTOR'] === 'true',
        },
      },
      plugins: [
        appTools(),
        tanstackRouterPlugin(),
        i18nPlugin({
          backend: {
            enabled: true,
            loadPath: '/locales/{{lng}}/{{ns}}.json',
          },
          localeDetection: {
            fallbackLanguage: 'en',
            ignoreRedirectRoutes: [
              '/@mf-types',
              '/assets',
              '/bundles',
              '${resolveApiPrefix(app)}',
              '/locales',
              '/mf-manifest.json',
              '/mf-stats.json',
              '/remoteEntry.js',
              '/robots.txt',
              '/site.webmanifest',
              '/sitemap.xml',
              '/static',
              '/zephyr-manifest.json',
            ],
            languages: ['en', 'cs'],
            localePathRedirect: true,
            localisedUrls: ultramodernLocalisedUrls as Record<string, Record<string, string>>,
          },
          reactI18next: false,
        }),
${bffPluginEntry}        moduleFederationPlugin(),
        zephyrRspackPlugin(),
      ],
      server: {
        port,
        publicDir: ['./locales', './assets'],
        ssr: {
          mode: 'string',
          moduleFederationAppSSR: true,
        },
      },
      source: {
        alias: {
          '@modern-js/plugin-i18n/runtime':
            '@modern-js/plugin-i18n/runtime/no-react-i18next',
        },
        globalVars: {
          ULTRAMODERN_SITE_URL: siteUrl,
        },
        mainEntryName: 'index',
      },
      splitChunks: {
        chunks: 'async',
      },
      tools: {
        autoprefixer: {
          overrideBrowserslist: ['defaults'],
        },
        bundlerChain: chain => {
          chain.output
            .uniqueName('${createRspackUniqueName(app)}')
            .chunkLoadingGlobal('${createRspackChunkLoadingGlobal(app)}');
        },
        devServer: {
          headers: {
            'Access-Control-Allow-Headers':
              'Accept, Authorization, Content-Type, X-Requested-With',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Origin': moduleFederationDevServerOrigin,
          },
        },
      },
    },
    {
      appId,
      enableBffRequestId: true,
      enableModuleFederationSSR: true,
      enableTelemetryExporters: true,
      telemetryFailLoudStartup: false,
    },
  ),
);
`;
}

export function createSharedModuleFederationConfig(): string {
  return `  shared: {
    '@modern-js/plugin-i18n/runtime/no-react-i18next': {
      requiredVersion: pluginI18nVersion,
      singleton: true,
      treeShaking: false,
    },
    '@modern-js/plugin-tanstack/runtime': {
      requiredVersion: pluginTanstackVersion,
      singleton: true,
      treeShaking: false,
    },
    '@modern-js/runtime': {
      requiredVersion: runtimeVersion,
      singleton: true,
      treeShaking: false,
    },
    '@tanstack/react-router': {
      requiredVersion: dependencies['@tanstack/react-router'],
      singleton: true,
      treeShaking: false,
    },
    react: {
      requiredVersion: reactVersion,
      singleton: true,
      treeShaking: false,
    },
    'react-dom': {
      requiredVersion: reactDomVersion,
      singleton: true,
      treeShaking: false,
    },
    'react-dom/client': {
      requiredVersion: reactDomVersion,
      singleton: true,
      treeShaking: false,
    },
  }`;
}

export function formatTsObjectLiteral(value: Record<string, string>): string {
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  if (entries.length === 0) {
    return '{}';
  }

  return `{
${entries.map(([key, entryValue]) => `    '${key}': '${entryValue}',`).join('\n')}
  }`;
}

export function createModuleFederationRemoteUrlHelpers(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  if (resolveRemoteRefs(app, remotes).length === 0) {
    return '';
  }

  return `const cloudflareDeployEnabled =
  process.env['MODERNJS_DEPLOY'] === 'cloudflare';
const cloudflareWorkersDevSubdomain =
  process.env['ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN']?.trim();
const requireCloudflarePublicUrls =
  process.env['ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS'] === 'true';

const createRemoteManifestUrl = (options: {
  manifestEnv: string;
  mfName: string;
  port: number;
  publicUrlEnv: string;
  workerName: string;
}) => {
  const configuredManifest = process.env[options.manifestEnv]?.trim();
  if (configuredManifest !== undefined && configuredManifest.length > 0) {
    return configuredManifest;
  }

  const configuredPublicUrl = process.env[options.publicUrlEnv]?.trim();
  if (configuredPublicUrl !== undefined && configuredPublicUrl.length > 0) {
    return \`\${options.mfName}@\${configuredPublicUrl.replace(/\\/+$/u, '')}/mf-manifest.json\`;
  }

  if (cloudflareDeployEnabled && cloudflareWorkersDevSubdomain !== undefined) {
    return \`\${options.mfName}@https://\${options.workerName}.\${cloudflareWorkersDevSubdomain}.workers.dev/mf-manifest.json\`;
  }

  if (cloudflareDeployEnabled && requireCloudflarePublicUrls) {
    throw new Error(
      \`Cloudflare deploy needs \${options.publicUrlEnv}, \${options.manifestEnv}, or ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN for remote \${options.mfName}.\`,
    );
  }

  return \`\${options.mfName}@http://localhost:\${options.port}/mf-manifest.json\`;
};

`;
}

export function createModuleFederationRemotesConfig(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  const remoteEntries = resolveRemoteRefs(app, remotes)
    .toSorted((left, right) =>
      remoteDependencyAlias(left).localeCompare(remoteDependencyAlias(right)),
    )
    .map(remote => {
      const key = remoteDependencyAlias(remote);
      return `    ${key}: createRemoteManifestUrl({
      manifestEnv: '${createRemoteManifestEnv(remote)}',
      mfName: '${remote.mfName}',
      port: ${remote.port},
      publicUrlEnv: '${createCloudflarePublicUrlEnv(remote)}',
      workerName: '${createCloudflareWorkerName(scope, remote)}',
    }),`;
    })
    .join('\n');

  if (!remoteEntries) {
    return '';
  }

  return `  remotes: {
${remoteEntries}
  },
`;
}

function createModuleFederationDtsConfig(hasExposes: boolean): string {
  return hasExposes
    ? `  dts: {
    displayErrorInTerminal: true,
    generateTypes: {
      compilerInstance: 'tsgo',
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
  remotes: WorkspaceApp[] = [],
): string {
  const shellHost = {
    ...shellApp,
    verticalRefs: remotes.map(remote => remote.id),
  };

  return `// @effect-diagnostics nodeBuiltinImport:off processEnv:off
// ultramodern-mf: host-only
import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const pluginI18nVersion = (require('@modern-js/plugin-i18n/package.json') as { version: string }).version;
const pluginTanstackVersion = (require('@modern-js/plugin-tanstack/package.json') as { version: string }).version;
const runtimeVersion = (require('@modern-js/runtime/package.json') as { version: string }).version;
const reactVersion = (require('react/package.json') as { version: string }).version;
const reactDomVersion = (require('react-dom/package.json') as { version: string }).version;

${createModuleFederationRemoteUrlHelpers(shellHost, remotes)}
const moduleFederationConfig: Parameters<
  typeof createModuleFederationConfig
>[0] = createModuleFederationConfig({
  bridge: {
    enableBridgeRouter: false,
  },
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
${createModuleFederationDtsConfig(false)}
  filename: 'remoteEntry.js',
  name: '${shellApp.mfName}',
${createModuleFederationRemotesConfig(scope, shellHost, remotes)}${createSharedModuleFederationConfig()},
  treeShakingSharedExcludePlugins: ['RspackModuleFederationPlugin'],
});

export default moduleFederationConfig;
`;
}

export function createBackendModuleFederationConfig(app: WorkspaceApp): string {
  return `// @effect-diagnostics nodeBuiltinImport:off
import { createRequire } from 'node:module';
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
  treeShakingSharedExcludePlugins: ['RspackModuleFederationPlugin'],
});

export default moduleFederationConfig;
`;
}

export { createBuildMarker } from './delivery-unit';

export function createUltramodernBuildModule(
  scope: string,
  app: WorkspaceApp,
): string {
  const record = createDeliveryUnitRecord(scope, app);
  return `export const ultramodernDeliveryUnit = {
  appId: '${record.appId}',
  build: '${record.buildMarker}',
  deployProfile: '${record.deployProfile}',
  kind: '${record.kind}',
  packageName: '${record.packageName}',
  schemaVersion: ${record.schemaVersion},
  sourceRevision: '${record.sourceRevision}',
  unitId: '${record.unitId}',
  version: '${record.version}',
} as const;

export const ultramodernVerticalIdentity = ultramodernDeliveryUnit;

export const ultramodernUiMarker = {
  ...ultramodernDeliveryUnit,
  surface: 'ui',
} as const;

export const ultramodernApiMarker = {
  ...ultramodernDeliveryUnit,
  surface: 'api',
} as const;
`;
}

export function createUltramodernBuildReexportModule(): string {
  return `export {
  ultramodernApiMarker,
  ultramodernDeliveryUnit,
  ultramodernUiMarker,
  ultramodernVerticalIdentity,
} from '../shared/ultramodern-build';
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
  return `// @effect-diagnostics nodeBuiltinImport:off${hostOnlyMarker}
import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const pluginI18nVersion = (require('@modern-js/plugin-i18n/package.json') as { version: string }).version;
const pluginTanstackVersion = (require('@modern-js/plugin-tanstack/package.json') as { version: string }).version;
const runtimeVersion = (require('@modern-js/runtime/package.json') as { version: string }).version;
const reactVersion = (require('react/package.json') as { version: string }).version;
const reactDomVersion = (require('react-dom/package.json') as { version: string }).version;

${createModuleFederationRemoteUrlHelpers(app, remotes)}
const moduleFederationConfig: Parameters<
  typeof createModuleFederationConfig
>[0] = createModuleFederationConfig({
  bridge: {
    enableBridgeRouter: false,
  },
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
${createModuleFederationDtsConfig(hasExposes)}
  exposes: ${exposes},
  filename: 'remoteEntry.js',
  name: '${app.mfName}',
${createModuleFederationRemotesConfig(scope, app, remotes)}${createSharedModuleFederationConfig()},
  treeShakingSharedExcludePlugins: ['RspackModuleFederationPlugin'],
});

export default moduleFederationConfig;
`;
}
