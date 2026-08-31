import path from 'node:path';
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
  createShellWorkerRemoteComponents,
} from '../demo-components';
import {
  appEmitsBrowserUi,
  appI18nNamespace,
  createShellHost,
  resolveRemoteRefs,
  shellApp,
} from '../descriptors';
import { readJsonFile, writeFileReplacing, writeJsonFile } from '../fs-io';
import { createAppPublicLocaleMessages } from '../locales';
import {
  createAppModernConfig,
  createShellModuleFederationConfig,
} from '../module-federation';
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
  additionalShells: WorkspaceApp[] = [],
) {
  const packagePath = path.join(workspaceRoot, 'package.json');
  const rootPackage = readJsonFile(packagePath);
  const generatedRootPackage = createRootPackageJson(
    scope,
    packageSource,
    remotes,
    bridge,
    additionalShells,
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
  shell: WorkspaceApp = shellApp,
  devPorts?: number[],
) {
  // Preserve the CALLER-RESOLVED descriptor (overlay port, directory) for
  // every shell — including the primary. Only the composition refs default is
  // derived here (UI-emitting units) when the descriptor carries none.
  const shellHost = {
    ...shell,
    verticalRefs:
      shell.verticalRefs ??
      remotes.filter(appEmitsBrowserUi).map(remote => remote.id),
  };
  const shellRemotes = resolveRemoteRefs(shellHost, remotes);
  // Only UI-emitting remotes appear in the shell's visible page/components
  // surface (G2a): headless api-only units are composed via API clients only.
  const uiRemotes = shellRemotes.filter(appEmitsBrowserUi);
  const publicWeb = createPublicWebAppArtifacts(shellHost);
  writeJsonFile(
    path.join(workspaceRoot, `${shellHost.directory}/package.json`),
    createAppPackage(
      scope,
      shellHost,
      packageSource,
      enableTailwind,
      // Pass the full vertical set so the shell declares plain workspace deps on
      // headless api-only verticals (their API is re-exported by the shell's
      // vertical-clients.ts) while MF/zephyr wiring stays verticalRefs-gated.
      remotes,
      bridge,
    ),
  );
  writeJsonFile(
    path.join(workspaceRoot, `${shellHost.directory}/tsconfig.json`),
    createAppTsConfig(shellHost, shellRemotes),
  );
  writeJsonFile(
    path.join(workspaceRoot, `${shellHost.directory}/tsconfig.mf-types.json`),
    createAppMfTypesTsConfig(shellHost),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellHost.directory}/src/modern-app-env.d.ts`,
    createAppEnvDts(shellHost, shellRemotes, scope),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellHost.directory}/modern.config.ts`,
    createAppModernConfig(
      scope,
      shellHost,
      shellRemotes,
      enableTailwind,
      devPorts,
    ),
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
    `${shellHost.directory}/src/modern.runtime.ts`,
    createAppRuntimeConfig(shellHost, scope, shellRemotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellHost.directory}/locales/en/translation.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'en', shellRemotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellHost.directory}/locales/en/${appI18nNamespace(shellHost)}.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'en', shellRemotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellHost.directory}/locales/cs/translation.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'cs', shellRemotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellHost.directory}/locales/cs/${appI18nNamespace(shellHost)}.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'cs', shellRemotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellHost.directory}/module-federation.config.ts`,
    createShellModuleFederationConfig(scope, shellHost, shellRemotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellHost.directory}/src/routes/[lang]/page.tsx`,
    createShellPage(shellHost, uiRemotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellHost.directory}/src/routes/vertical-components.tsx`,
    createShellRemoteComponents(shellHost, uiRemotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellHost.directory}/src/routes/vertical-components.worker.tsx`,
    createShellWorkerRemoteComponents(shellHost, uiRemotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellHost.directory}/src/routes/shell-frame.tsx`,
    createShellFrameComponent(shellHost),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellHost.directory}/src/api/vertical-clients.ts`,
    createShellApiClient(scope, remotes),
  );
}
