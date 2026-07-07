import {
  createUltramodernBuildArtifact,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
} from '@modern-js/utils/universal';
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
import { renderFileTemplate } from './fs-io';
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
  return renderFileTemplate('workspace/apps/modern.config.ts', {
    value0: bffImport,
    value1: app.id,
    value2: createCloudflareWorkerName(scope, app),
    value3: app.portEnv,
    value4: app.port,
    value5: createCloudflarePublicUrlEnv(app),
    value6: shellApp.port,
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
  });
}

export function createSharedModuleFederationConfig(): string {
  return renderFileTemplate(
    'workspace/apps/modern.config.shared-module-federation.ts',
    {},
  );
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

export function createUltramodernBuildArtifactJson(
  scope: string,
  app: WorkspaceApp,
): string {
  const record = createDeliveryUnitRecord(scope, app);
  return `${JSON.stringify(createUltramodernBuildArtifact(record), null, 2)}\n`;
}

export function createUltramodernBuildModule(): string {
  return `import ultramodernBuildArtifact from './${ULTRAMODERN_BUILD_ARTIFACT_FILE}' with { type: 'json' };

export { ultramodernBuildArtifact };

export const ultramodernDeliveryUnit =
  ultramodernBuildArtifact.deliveryUnit;
export const ultramodernVerticalIdentity = ultramodernDeliveryUnit;
export const ultramodernUiMarker = ultramodernBuildArtifact.surfaces.ui;
export const ultramodernApiMarker = ultramodernBuildArtifact.surfaces.api;
`;
}

export function createUltramodernBuildReexportModule(): string {
  return `export {
  ultramodernBuildArtifact,
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
