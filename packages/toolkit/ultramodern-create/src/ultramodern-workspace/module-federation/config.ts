import {
  appEmitsBrowserUi,
  appHasApi,
  createBackendFederationName,
  resolveApiPrefix,
  resolveApiProtocol,
  resolveRemoteRefs,
} from '../descriptors';
import { renderFileTemplate } from '../fs-io';
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
    return `import { defineConfig } from '@modern-js/ultramodern-app-tools';
${enableTailwind ? "import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss';\n" : ''}
export default defineConfig({
${enableTailwind ? '  builderPlugins: [pluginTailwindcss()],\n' : ''}  renderer: ${JSON.stringify(renderer)},
  server: { port: ${app.port}, ssr: ${generation.capabilities.ssr} },
  source: { mainEntryName: 'main' },
});
`;
  }
  // Workspace policy (deploy, dev server, output, delivery identity, Zephyr)
  // is owned by presetUltramodernWorkspace from the declared topology; the
  // React config only authors its app-local plugins and BFF surface.
  const emitsUi = appEmitsBrowserUi(app);
  const bffImport = appHasApi(app)
    ? "import { bffPlugin } from '@modern-js/plugin-bff-build-extensions';\n"
    : '';
  const uiImports = emitsUi
    ? `import { i18nPlugin } from '@modern-js/plugin-i18n';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';
import { ultramodernLocalisedUrls } from './src/routes/ultramodern-route-metadata';
`
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
    imports: `${bffImport}${tailwindImport}${uiImports}`,
    appId: app.id,
    bffConfig,
    builderPlugins: enableTailwind
      ? '      builderPlugins: [pluginTailwindcss()],\n'
      : '',
    uiPlugins: emitsUi
      ? renderFileTemplate('workspace/apps/modern.config.ui-plugins.ts', {
          apiPrefix: resolveApiPrefix(app),
          localisedUrls:
            '            localisedUrls: ultramodernLocalisedUrls as Record<string, Record<string, string>>,\n',
        })
      : '',
    bffPlugin: appHasApi(app) ? '        bffPlugin(),\n' : '',
    federationPlugin: emitsUi ? '        moduleFederationPlugin(),\n' : '',
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
