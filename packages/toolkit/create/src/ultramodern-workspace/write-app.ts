import {
  createApiClient,
  createApiServiceEntry,
  createBackendEffectApiExpose,
  createSharedApi,
  createShellApiClient,
} from './api';
import { createRpcClientFile, createRpcContractFile } from './api/rpc';
import {
  createAppEnvDts,
  createAppRuntimeConfig,
  createAppStyles,
  createShellFrameComponent,
  createTailwindConfig,
} from './app-files';
import { createBackendFederationContractFile } from './backend-federation';
import type { UltramodernBridgeConfig } from './bridge-config';
import {
  createLayout,
  createRemoteEntry,
  createRemoteExposeComponent,
  createRemotePage,
  createShellPage,
  createShellRemoteComponents,
  remoteComponentOutputPath,
} from './demo-components';
import {
  appEmitsBrowserUi,
  appHasApi,
  appI18nNamespace,
  createShellHost,
  resolveApiProtocol,
} from './descriptors';
import { writeFile, writeJson } from './fs-io';
import { createAppPublicLocaleMessages } from './locales';
import {
  createAppModernConfig,
  createBackendModuleFederationConfig,
  createRemoteModuleFederationConfig,
  createShellModuleFederationConfig,
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
  createUltramodernBuildReexportModule,
} from './module-federation';
import {
  createAppMfTypesTsConfig,
  createAppPackage,
  createAppTsConfig,
} from './package-json';
import { createPublicWebAppArtifacts } from './public-surface';
import type { ResolvedPackageSource, WorkspaceApp } from './types';

type WriteAppContext = {
  targetDir: string;
  scope: string;
  resolvedApp: WorkspaceApp;
  packageSource: ResolvedPackageSource;
  enableTailwind: boolean;
  /** Whether this app emits browser/UI artifacts (false for `api-only`). */
  emitsUi: boolean;
  remotes: WorkspaceApp[];
  bridge: UltramodernBridgeConfig | undefined;
  publicWeb: ReturnType<typeof createPublicWebAppArtifacts>;
  writeAppFile: (relativePath: string, content: string) => void;
};
export function writeApp(
  targetDir: string,
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
  bridge?: UltramodernBridgeConfig,
) {
  const resolvedApp = app.kind === 'shell' ? createShellHost(remotes) : app;
  const emitsUi = appEmitsBrowserUi(resolvedApp);
  // A headless (api-only) unit never emits Tailwind CSS (G2a).
  const appTailwind = enableTailwind && emitsUi;
  const publicWeb = createPublicWebAppArtifacts(resolvedApp);
  const writeAppFile = (relativePath: string, content: string) => {
    writeFile(targetDir, `${resolvedApp.directory}/${relativePath}`, content);
  };
  const context: WriteAppContext = {
    targetDir,
    scope,
    resolvedApp,
    packageSource,
    enableTailwind: appTailwind,
    emitsUi,
    remotes,
    bridge,
    publicWeb,
    writeAppFile,
  };

  writeAppConfigFiles(context);
  writeAppLocaleAndStyleFiles(context);
  writeAppFederationConfigFiles(context);
  writeAppRouteAndShellFiles(context);
  writeAppApiAndRemoteExposeFiles(context);
}
function writeAppConfigFiles({
  targetDir,
  scope,
  resolvedApp,
  packageSource,
  enableTailwind,
  emitsUi,
  remotes,
  bridge,
  publicWeb,
}: WriteAppContext) {
  writeJson(
    targetDir,
    `${resolvedApp.directory}/package.json`,
    createAppPackage(
      scope,
      resolvedApp,
      packageSource,
      enableTailwind,
      remotes,
      bridge,
    ),
  );
  writeJson(
    targetDir,
    `${resolvedApp.directory}/tsconfig.json`,
    createAppTsConfig(resolvedApp, remotes),
  );
  writeJson(
    targetDir,
    `${resolvedApp.directory}/tsconfig.mf-types.json`,
    createAppMfTypesTsConfig(resolvedApp),
  );
  writeFile(
    targetDir,
    `${resolvedApp.directory}/src/modern-app-env.d.ts`,
    createAppEnvDts(resolvedApp, remotes),
  );
  writeFile(
    targetDir,
    `${resolvedApp.directory}/src/ultramodern-build.ts`,
    createUltramodernBuildReexportModule(),
  );
  writeFile(
    targetDir,
    `${resolvedApp.directory}/shared/ultramodern-build.ts`,
    createUltramodernBuildModule(scope, resolvedApp),
  );
  writeFile(
    targetDir,
    `${resolvedApp.directory}/shared/ultramodern-build.json`,
    createUltramodernBuildArtifactJson(scope, resolvedApp),
  );
  if (emitsUi) {
    writeFile(
      targetDir,
      publicWeb.jsonLdHelperFile.path,
      publicWeb.jsonLdHelperFile.content,
    );
    writeFile(
      targetDir,
      publicWeb.routeMetadataFile.path,
      publicWeb.routeMetadataFile.content,
    );
    writeFile(
      targetDir,
      publicWeb.routeHeadFile.path,
      publicWeb.routeHeadFile.content,
    );
  }
  writeFile(
    targetDir,
    `${resolvedApp.directory}/modern.config.ts`,
    createAppModernConfig(scope, resolvedApp, remotes, enableTailwind),
  );
  writeFile(
    targetDir,
    `${resolvedApp.directory}/src/modern.runtime.ts`,
    createAppRuntimeConfig(resolvedApp, scope, remotes),
  );
}

function writeAppLocaleAndStyleFiles({
  targetDir,
  scope,
  resolvedApp,
  enableTailwind,
  emitsUi,
  remotes,
}: WriteAppContext) {
  writeJson(
    targetDir,
    `${resolvedApp.directory}/locales/en/translation.json`,
    createAppPublicLocaleMessages(resolvedApp, 'en', remotes),
  );
  writeJson(
    targetDir,
    `${resolvedApp.directory}/locales/en/${appI18nNamespace(resolvedApp)}.json`,
    createAppPublicLocaleMessages(resolvedApp, 'en', remotes),
  );
  writeJson(
    targetDir,
    `${resolvedApp.directory}/locales/cs/translation.json`,
    createAppPublicLocaleMessages(resolvedApp, 'cs', remotes),
  );
  writeJson(
    targetDir,
    `${resolvedApp.directory}/locales/cs/${appI18nNamespace(resolvedApp)}.json`,
    createAppPublicLocaleMessages(resolvedApp, 'cs', remotes),
  );
  if (emitsUi) {
    writeFile(
      targetDir,
      `${resolvedApp.directory}/src/routes/index.css`,
      createAppStyles(enableTailwind, scope, resolvedApp),
    );
  }
  if (enableTailwind) {
    writeFile(
      targetDir,
      `${resolvedApp.directory}/tailwind.config.ts`,
      createTailwindConfig(),
    );
  }
}

function writeAppFederationConfigFiles({
  targetDir,
  scope,
  resolvedApp,
  emitsUi,
  remotes,
}: WriteAppContext) {
  // A headless (api-only) unit exposes no browser Module Federation surface, so
  // it emits no browser `module-federation.config.ts` (G2a). It still exposes
  // its backend federation container below.
  if (emitsUi) {
    writeFile(
      targetDir,
      `${resolvedApp.directory}/module-federation.config.ts`,
      resolvedApp.kind === 'shell'
        ? createShellModuleFederationConfig(scope, remotes)
        : createRemoteModuleFederationConfig(scope, resolvedApp, remotes),
    );
  }
  if (appHasApi(resolvedApp)) {
    writeFile(
      targetDir,
      `${resolvedApp.directory}/backend-federation.config.ts`,
      createBackendModuleFederationConfig(resolvedApp),
    );
  }
}

function writeAppRouteAndShellFiles({
  targetDir,
  scope,
  resolvedApp,
  emitsUi,
  remotes,
  publicWeb,
  writeAppFile,
}: WriteAppContext) {
  // A headless (api-only) unit emits no UI routes/pages/public surfaces (G2a).
  if (!emitsUi) {
    return;
  }
  writeAppFile('src/routes/layout.tsx', createLayout(resolvedApp.id));
  writeAppFile(
    'src/routes/[lang]/page.tsx',
    resolvedApp.kind === 'shell'
      ? createShellPage(remotes)
      : createRemotePage(resolvedApp),
  );
  for (const generatedFile of publicWeb.routeMetaFiles) {
    writeFile(targetDir, generatedFile.path, generatedFile.content);
  }
  for (const generatedFile of publicWeb.routeAliasFiles) {
    writeFile(targetDir, generatedFile.path, generatedFile.content);
  }

  if (resolvedApp.kind === 'shell') {
    writeAppFile(
      'src/routes/vertical-components.tsx',
      createShellRemoteComponents(remotes),
    );
    writeAppFile('src/routes/shell-frame.tsx', createShellFrameComponent());
    writeFile(
      targetDir,
      `${resolvedApp.directory}/src/api/vertical-clients.ts`,
      createShellApiClient(scope, remotes),
    );
  }
}

function writeAppApiAndRemoteExposeFiles({
  targetDir,
  scope,
  resolvedApp,
  emitsUi,
  writeAppFile,
}: WriteAppContext) {
  if (appHasApi(resolvedApp)) {
    const rpcProtocol = resolveApiProtocol(resolvedApp) === 'rpc';
    if (rpcProtocol) {
      writeFile(
        targetDir,
        `${resolvedApp.directory}/shared/rpc.ts`,
        createRpcContractFile(resolvedApp),
      );
    } else {
      writeFile(
        targetDir,
        `${resolvedApp.directory}/shared/api.ts`,
        createSharedApi(resolvedApp),
      );
    }
    writeFile(
      targetDir,
      `${resolvedApp.directory}/api/index.ts`,
      createApiServiceEntry(
        resolvedApp,
        rpcProtocol ? '../shared/rpc.ts' : '../shared/api.ts',
      ),
    );
    writeFile(
      targetDir,
      `${resolvedApp.directory}/api/backend-federation.ts`,
      createBackendFederationContractFile(resolvedApp),
    );
    writeFile(
      targetDir,
      `${resolvedApp.directory}/api/effect-api.ts`,
      createBackendEffectApiExpose(scope, resolvedApp),
    );
    if (rpcProtocol) {
      writeFile(
        targetDir,
        `${resolvedApp.directory}/src/api/${resolvedApp.api.stem}-rpc-client.ts`,
        createRpcClientFile(resolvedApp),
      );
    } else {
      writeFile(
        targetDir,
        `${resolvedApp.directory}/src/api/${resolvedApp.api.stem}-client.ts`,
        createApiClient(resolvedApp, '../../shared/api'),
      );
    }
  }

  if (resolvedApp.kind === 'vertical' && emitsUi) {
    writeAppFile('src/federation-entry.tsx', createRemoteEntry(resolvedApp));
    for (const expose of Object.keys(resolvedApp.exposes ?? {})) {
      const outputPath = remoteComponentOutputPath(resolvedApp, expose);

      if (outputPath) {
        writeAppFile(
          outputPath.slice(resolvedApp.directory.length + 1),
          createRemoteExposeComponent(resolvedApp, expose),
        );
      }
    }
  }
}
