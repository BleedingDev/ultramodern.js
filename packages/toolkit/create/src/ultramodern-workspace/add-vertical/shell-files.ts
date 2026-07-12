import path from 'node:path';
import { WORKSPACE_PACKAGE_VERSION } from '../../ultramodern-package-source';
import { createShellApiClient } from '../api';
import {
  createAppEnvDts,
  createAppRuntimeConfig,
  createShellFrameComponent,
} from '../app-files';
import type { UltramodernBridgeConfig } from '../bridge-config';
import {
  createShellPage,
  createShellRemoteComponents,
} from '../demo-components';
import {
  appEmitsBrowserUi,
  appHasApi,
  appI18nNamespace,
  createShellHost,
  remoteDependencyAlias,
  shellApp,
  zephyrRemoteDependency,
} from '../descriptors';
import { readJsonFile, writeFileReplacing, writeJsonFile } from '../fs-io';
import { createAppPublicLocaleMessages } from '../locales';
import {
  createAppModernConfig,
  createShellModuleFederationConfig,
} from '../module-federation';
import { packageName } from '../naming';
import {
  createAppMfTypesTsConfig,
  createAppPackage,
  createAppTsConfig,
  createRootPackageJson,
} from '../package-json';
import {
  createPublicWebAppArtifacts,
  rewriteWorkspaceAssetsForApp,
} from '../public-surface';
import type { JsonValue, ResolvedPackageSource, WorkspaceApp } from '../types';

export function updateRootWorkspaceScripts(
  workspaceRoot: string,
  scope: string,
  packageSource: ResolvedPackageSource,
  remotes: WorkspaceApp[],
  bridge?: UltramodernBridgeConfig,
) {
  const packagePath = path.join(workspaceRoot, 'package.json');
  const rootPackage = readJsonFile(packagePath);
  const generatedRootPackage = createRootPackageJson(
    scope,
    packageSource,
    remotes,
    bridge,
  ) as Record<string, any>;
  rootPackage.scripts = generatedRootPackage.scripts;
  writeJsonFile(packagePath, rootPackage as JsonValue);
}

export function rewriteShellAppFiles(
  workspaceRoot: string,
  scope: string,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  remotes: WorkspaceApp[],
  bridge?: UltramodernBridgeConfig,
) {
  const shellHost = createShellHost(remotes);
  const uiRemotes = remotes.filter(appEmitsBrowserUi);
  const publicWeb = createPublicWebAppArtifacts(shellHost);
  writeJsonFile(
    path.join(workspaceRoot, `${shellApp.directory}/package.json`),
    createAppPackage(
      scope,
      shellHost,
      packageSource,
      enableTailwind,
      remotes,
      bridge,
    ),
  );
  writeJsonFile(
    path.join(workspaceRoot, `${shellApp.directory}/tsconfig.json`),
    createAppTsConfig(shellHost, remotes),
  );
  writeJsonFile(
    path.join(workspaceRoot, `${shellApp.directory}/tsconfig.mf-types.json`),
    createAppMfTypesTsConfig(shellHost),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/modern-app-env.d.ts`,
    createAppEnvDts(shellHost, remotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/modern.config.ts`,
    createAppModernConfig(scope, shellHost, remotes, enableTailwind),
  );
  writeFileReplacing(
    workspaceRoot,
    publicWeb.jsonLdHelperFile.path,
    publicWeb.jsonLdHelperFile.content,
  );
  writeFileReplacing(
    workspaceRoot,
    publicWeb.routeMetadataFile.path,
    publicWeb.routeMetadataFile.content,
  );
  writeFileReplacing(
    workspaceRoot,
    publicWeb.routeHeadFile.path,
    publicWeb.routeHeadFile.content,
  );
  for (const generatedFile of publicWeb.routeMetaFiles) {
    writeFileReplacing(
      workspaceRoot,
      generatedFile.path,
      generatedFile.content,
    );
  }
  rewriteWorkspaceAssetsForApp(workspaceRoot, shellHost);
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/modern.runtime.ts`,
    createAppRuntimeConfig(shellHost, scope, remotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellApp.directory}/locales/en/translation.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'en', remotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellApp.directory}/locales/en/${appI18nNamespace(shellHost)}.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'en', remotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellApp.directory}/locales/cs/translation.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'cs', remotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellApp.directory}/locales/cs/${appI18nNamespace(shellHost)}.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'cs', remotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/module-federation.config.ts`,
    createShellModuleFederationConfig(scope, remotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/routes/[lang]/page.tsx`,
    createShellPage(uiRemotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/routes/vertical-components.tsx`,
    createShellRemoteComponents(uiRemotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/routes/shell-frame.tsx`,
    createShellFrameComponent(),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/api/vertical-clients.ts`,
    createShellApiClient(scope, remotes),
  );
}

export function addShellZephyrDependency(
  workspaceRoot: string,
  scope: string,
  remote: WorkspaceApp,
) {
  const packagePath = path.join(
    workspaceRoot,
    shellApp.directory,
    'package.json',
  );
  const shellPackage = readJsonFile(packagePath);
  shellPackage['zephyr:dependencies'] ??= {};
  shellPackage['zephyr:dependencies'][remoteDependencyAlias(remote)] =
    zephyrRemoteDependency(scope, remote);
  writeJsonFile(packagePath, shellPackage as JsonValue);
}

export function addShellWorkspaceDependency(
  workspaceRoot: string,
  scope: string,
  remote: WorkspaceApp,
) {
  if (!appHasApi(remote)) {
    return;
  }

  const packagePath = path.join(
    workspaceRoot,
    shellApp.directory,
    'package.json',
  );
  const shellPackage = readJsonFile(packagePath);
  shellPackage.dependencies ??= {};
  shellPackage.dependencies[packageName(scope, remote.packageSuffix)] =
    WORKSPACE_PACKAGE_VERSION;
  writeJsonFile(packagePath, shellPackage as JsonValue);
}
