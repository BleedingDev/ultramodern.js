import fs from 'node:fs';
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
  appHasApi,
  appI18nNamespace,
  resolveRemoteRefs,
  shellApp,
} from '../descriptors';
import { readJsonFile, writeJsonFile } from '../fs-io';
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
import { resolveWorkspaceRenderer } from '../renderer-profile';
import type { JsonValue, ResolvedPackageSource, WorkspaceApp } from '../types';
import { preserveConsumerWorkspaceArtifacts } from '../workspace-artifact-ownership';

export function updateRootWorkspaceScripts(
  workspaceRoot: string,
  scope: string,
  packageSource: ResolvedPackageSource,
  remotes: WorkspaceApp[],
  bridge?: UltramodernBridgeConfig,
  additionalShells: WorkspaceApp[] = [],
  previousRemotes: WorkspaceApp[] = remotes,
  primaryShell: WorkspaceApp = shellApp,
  previousAdditionalShells: WorkspaceApp[] = additionalShells,
  previousPrimaryShell: WorkspaceApp = primaryShell,
) {
  const packagePath = path.join(workspaceRoot, 'package.json');
  const rootPackage = readJsonFile(packagePath);
  const generatedRootPackage = createRootPackageJson(
    scope,
    packageSource,
    remotes,
    bridge,
    additionalShells,
    primaryShell,
  ) as Record<string, any>;
  const previousRootPackage = createRootPackageJson(
    scope,
    packageSource,
    previousRemotes,
    bridge,
    previousAdditionalShells,
    previousPrimaryShell,
  ) as Record<string, any>;
  const existingScripts = rootPackage.scripts ?? {};
  rootPackage.scripts = { ...generatedRootPackage.scripts, ...existingScripts };
  if (existingScripts.dev === previousRootPackage.scripts.dev) {
    rootPackage.scripts.dev = generatedRootPackage.scripts.dev;
  }
  for (const [name, command] of Object.entries(generatedRootPackage.scripts)) {
    if (
      existingScripts[name] === undefined ||
      existingScripts[name] === previousRootPackage.scripts[name]
    ) {
      rootPackage.scripts[name] = command;
    }
  }
  for (const [name, command] of Object.entries(previousRootPackage.scripts)) {
    if (
      generatedRootPackage.scripts[name] === undefined &&
      existingScripts[name] === command
    ) {
      delete rootPackage.scripts[name];
    }
  }
  writeJsonFile(packagePath, rootPackage as JsonValue);
}

function shellAppArtifacts(
  scope: string,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  remotes: WorkspaceApp[],
  bridge: UltramodernBridgeConfig | undefined,
  shell: WorkspaceApp,
) {
  const shellHost = {
    ...shell,
    verticalRefs:
      shell.verticalRefs ??
      remotes.filter(appEmitsBrowserUi).map(remote => remote.id),
  };
  const shellRemotes = resolveRemoteRefs(shellHost, remotes);
  if (resolveWorkspaceRenderer(shellHost) !== 'react') {
    const files = {
      [`${shellHost.directory}/modern.config.ts`]: createAppModernConfig(
        shellHost,
        enableTailwind,
      ),
      [`${shellHost.directory}/tsconfig.json`]: `${JSON.stringify(
        createAppTsConfig(shellHost, shellRemotes),
        null,
        2,
      )}\n`,
      ...(remotes.some(appHasApi)
        ? {
            [`${shellHost.directory}/src/api/vertical-clients.ts`]:
              createShellApiClient(scope, remotes),
          }
        : {}),
    };
    return {
      shellHost,
      packageJson: createAppPackage(
        scope,
        shellHost,
        packageSource,
        enableTailwind,
        remotes,
        bridge,
      ) as Record<string, any>,
      artifacts: Object.entries(files).map(([relativePath, content]) => ({
        relativePath,
        content,
      })),
    };
  }
  const uiRemotes = shellRemotes.filter(appEmitsBrowserUi);
  const publicWeb = createPublicWebAppArtifacts(shellHost);
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const files: Record<string, string> = {
    [`${shellHost.directory}/tsconfig.json`]: json(
      createAppTsConfig(shellHost, shellRemotes),
    ),
    [`${shellHost.directory}/tsconfig.mf-types.json`]: json(
      createAppMfTypesTsConfig(shellHost),
    ),
    [`${shellHost.directory}/src/modern-app-env.d.ts`]: createAppEnvDts(
      shellHost,
      shellRemotes,
      scope,
    ),
    [publicWeb.jsonLdHelperFile.path]: publicWeb.jsonLdHelperFile.content,
    [publicWeb.routeMetadataFile.path]: publicWeb.routeMetadataFile.content,
    [publicWeb.routeHeadFile.path]: publicWeb.routeHeadFile.content,
    ...Object.fromEntries(
      publicWeb.routeMetaFiles.map(file => [file.path, file.content]),
    ),
    [`${shellHost.directory}/src/modern.runtime.ts`]: createAppRuntimeConfig(
      shellHost,
      scope,
      shellRemotes,
    ),
    ...Object.fromEntries(
      (['en', 'cs'] as const).flatMap(language =>
        ['translation', appI18nNamespace(shellHost)].map(namespace => [
          `${shellHost.directory}/locales/${language}/${namespace}.json`,
          json(
            createAppPublicLocaleMessages(shellHost, language, shellRemotes),
          ),
        ]),
      ),
    ),
    [`${shellHost.directory}/module-federation.config.ts`]:
      createShellModuleFederationConfig(scope, shellHost, shellRemotes),
    [`${shellHost.directory}/src/routes/[lang]/page.tsx`]: createShellPage(
      shellHost,
      uiRemotes,
    ),
    [`${shellHost.directory}/src/routes/vertical-components.tsx`]:
      createShellRemoteComponents(shellHost, uiRemotes),
    [`${shellHost.directory}/src/routes/vertical-components.worker.tsx`]:
      createShellWorkerRemoteComponents(shellHost, uiRemotes),
    [`${shellHost.directory}/src/routes/shell-frame.tsx`]:
      createShellFrameComponent(shellHost),
    [`${shellHost.directory}/src/api/vertical-clients.ts`]:
      createShellApiClient(scope, remotes),
  };
  return {
    shellHost,
    packageJson: createAppPackage(
      scope,
      shellHost,
      packageSource,
      enableTailwind,
      remotes,
      bridge,
    ) as Record<string, any>,
    artifacts: Object.entries(files).map(([relativePath, content]) => ({
      relativePath,
      content,
    })),
  };
}

export function rewriteShellAppFiles(
  workspaceRoot: string,
  scope: string,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  remotes: WorkspaceApp[],
  bridge?: UltramodernBridgeConfig,
  shell: WorkspaceApp = shellApp,
  previous: {
    shell: WorkspaceApp;
    remotes: WorkspaceApp[];
    enableTailwind?: boolean;
  } = { shell, remotes },
) {
  const before = shellAppArtifacts(
    scope,
    packageSource,
    previous.enableTailwind ?? enableTailwind,
    previous.remotes,
    bridge,
    previous.shell,
  );
  const next = shellAppArtifacts(
    scope,
    packageSource,
    enableTailwind,
    remotes,
    bridge,
    shell,
  );
  const { io } = preserveConsumerWorkspaceArtifacts(
    workspaceRoot,
    before.artifacts,
  );
  for (const artifact of next.artifacts) {
    io.write(path.join(workspaceRoot, artifact.relativePath), artifact.content);
  }
  const packagePath = path.join(workspaceRoot, shell.directory, 'package.json');
  const existing = fs.existsSync(packagePath) ? readJsonFile(packagePath) : {};
  const packageJson = {
    ...next.packageJson,
    ...existing,
    ...(resolveWorkspaceRenderer(next.shellHost) === 'react'
      ? {
          'zephyr:dependencies': {
            ...next.packageJson['zephyr:dependencies'],
            ...Object.fromEntries(
              Object.entries(existing['zephyr:dependencies'] ?? {}).filter(
                ([key, value]) =>
                  before.packageJson['zephyr:dependencies']?.[key] !== value,
              ),
            ),
          },
        }
      : {}),
    dependencies: {
      ...next.packageJson.dependencies,
      ...existing.dependencies,
    },
    devDependencies: {
      ...next.packageJson.devDependencies,
      ...existing.devDependencies,
    },
    scripts: { ...next.packageJson.scripts, ...existing.scripts },
  };
  for (const [name, command] of Object.entries(next.packageJson.scripts)) {
    if (
      existing.scripts?.[name] === undefined ||
      existing.scripts[name] === before.packageJson.scripts?.[name]
    ) {
      packageJson.scripts[name] = command;
    }
  }
  writeJsonFile(packagePath, packageJson as JsonValue);
  if (resolveWorkspaceRenderer(next.shellHost) === 'react') {
    rewriteWorkspaceAssetsForApp(workspaceRoot, next.shellHost);
  }
}
