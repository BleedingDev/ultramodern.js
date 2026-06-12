import fs from 'node:fs';
import {
  createAppEnvDts,
  createAppRuntimeConfig,
  createAppStyles,
  createPostcssConfig,
  createSharedDesignTokensCss,
  createShellFrameComponent,
  createTailwindConfig,
} from './app-files';
import {
  createDevelopmentOverlay,
  createGeneratedContract,
  createOwnership,
  createPackageSourceMetadata,
  createTemplateManifest,
  createTopology,
} from './contracts';
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
  appHasEffectApi,
  appI18nNamespace,
  createShellHost,
  GENERATED_CONTRACT_PATH,
  sharedPackages,
  shellApp,
} from './descriptors';
import {
  createEffectClient,
  createEffectServiceEntry,
  createEffectSharedApi,
  createShellEffectClient,
} from './effect-api';
import { copyRootTemplate, writeFile, writeJson } from './fs-io';
import { createAppPublicLocaleMessages } from './locales';
import {
  createAppModernConfig,
  createRemoteModuleFederationConfig,
  createShellModuleFederationConfig,
  createUltramodernBuildModule,
} from './module-federation';
import {
  assertUniqueTailwindPrefixes,
  relativeRootFor,
  toPackageScope,
} from './naming';
import {
  createAppPackage,
  createPackageTsConfig,
  createRootPackageJson,
  createSharedContractsIndex,
  createSharedPackage,
  createTsConfigBase,
} from './package-json';
import { resolvePackageSource } from './package-source';
import { createPublicWebAppArtifacts } from './public-surface';
import type {
  ResolvedPackageSource,
  UltramodernWorkspaceOptions,
  WorkspaceApp,
} from './types';
import {
  NODE_FETCH_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
  TANSTACK_ROUTER_VERSION,
} from './versions';
import { writeGeneratedWorkspaceScripts } from './workspace-scripts';

export function writeApp(
  targetDir: string,
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
) {
  const resolvedApp = app.kind === 'shell' ? createShellHost(remotes) : app;
  const publicWeb = createPublicWebAppArtifacts(resolvedApp);
  const writeAppFile = (relativePath: string, content: string) => {
    writeFile(targetDir, `${resolvedApp.directory}/${relativePath}`, content);
  };

  writeJson(
    targetDir,
    `${resolvedApp.directory}/package.json`,
    createAppPackage(
      scope,
      resolvedApp,
      packageSource,
      enableTailwind,
      remotes,
    ),
  );
  writeJson(
    targetDir,
    `${resolvedApp.directory}/tsconfig.json`,
    createPackageTsConfig(resolvedApp.directory, appHasEffectApi(resolvedApp)),
  );
  writeFile(
    targetDir,
    `${resolvedApp.directory}/src/modern-app-env.d.ts`,
    createAppEnvDts(resolvedApp, remotes),
  );
  writeFile(
    targetDir,
    `${resolvedApp.directory}/src/ultramodern-build.ts`,
    createUltramodernBuildModule(scope, resolvedApp),
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
  writeFile(
    targetDir,
    `${resolvedApp.directory}/modern.config.ts`,
    createAppModernConfig(scope, resolvedApp),
  );
  writeFile(
    targetDir,
    `${resolvedApp.directory}/src/modern.runtime.ts`,
    createAppRuntimeConfig(resolvedApp, scope, remotes),
  );
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
  writeFile(
    targetDir,
    `${resolvedApp.directory}/src/routes/index.css`,
    createAppStyles(enableTailwind, scope, resolvedApp),
  );
  if (enableTailwind) {
    writeFile(
      targetDir,
      `${resolvedApp.directory}/postcss.config.mjs`,
      createPostcssConfig(),
    );
    writeFile(
      targetDir,
      `${resolvedApp.directory}/tailwind.config.ts`,
      createTailwindConfig(),
    );
  }
  writeFile(
    targetDir,
    `${resolvedApp.directory}/module-federation.config.ts`,
    resolvedApp.kind === 'shell'
      ? createShellModuleFederationConfig(scope, remotes)
      : createRemoteModuleFederationConfig(scope, resolvedApp, remotes),
  );
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
      createShellRemoteComponents(scope, remotes),
    );
    writeAppFile('src/routes/shell-frame.tsx', createShellFrameComponent());
    writeFile(
      targetDir,
      `${resolvedApp.directory}/src/effect/vertical-clients.ts`,
      createShellEffectClient(scope, remotes),
    );
  }

  if (appHasEffectApi(resolvedApp)) {
    writeFile(
      targetDir,
      `${resolvedApp.directory}/shared/effect/api.ts`,
      createEffectSharedApi(resolvedApp),
    );
    writeFile(
      targetDir,
      `${resolvedApp.directory}/api/effect/index.ts`,
      createEffectServiceEntry(resolvedApp, '../../shared/effect/api.ts'),
    );
    writeFile(
      targetDir,
      `${resolvedApp.directory}/src/effect/${resolvedApp.effectApi.stem}-client.ts`,
      createEffectClient(resolvedApp, '../../shared/effect/api'),
    );
  }

  if (resolvedApp.kind === 'vertical') {
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

export function writeSharedPackages(targetDir: string, scope: string) {
  for (const sharedPackage of sharedPackages) {
    writeJson(
      targetDir,
      `${sharedPackage.directory}/package.json`,
      createSharedPackage(scope, sharedPackage.id, sharedPackage.description),
    );
    writeJson(targetDir, `${sharedPackage.directory}/tsconfig.json`, {
      extends: `${relativeRootFor(sharedPackage.directory)}/tsconfig.base.json`,
      include: ['src'],
    });
  }

  writeFile(
    targetDir,
    'packages/shared-contracts/src/index.ts',
    createSharedContractsIndex(),
  );
  writeFile(
    targetDir,
    'packages/shared-design-tokens/src/index.ts',
    `export const sharedDesignTokens = {
  color: {
    accent: '#2f8f68',
    foreground: '#133225',
    surface: '#f6fbf7',
  },
} as const;
`,
  );
  writeFile(
    targetDir,
    'packages/shared-design-tokens/src/tokens.css',
    createSharedDesignTokensCss(),
  );
}

export function generateUltramodernWorkspace(
  options: UltramodernWorkspaceOptions,
) {
  const scope = toPackageScope(options.packageName);
  const packageSource = resolvePackageSource(options);
  const enableTailwind = options.enableTailwind !== false;
  const initialVerticals: WorkspaceApp[] = [];
  assertUniqueTailwindPrefixes([shellApp, ...initialVerticals]);
  fs.mkdirSync(options.targetDir, { recursive: true });

  copyRootTemplate(options.targetDir, {
    packageName: options.packageName,
    packageScope: scope,
    nodeVersion: NODE_VERSION,
    pnpmVersion: PNPM_VERSION,
    nodeFetchVersion: NODE_FETCH_VERSION,
    tanstackRouterVersion: TANSTACK_ROUTER_VERSION,
    tailwindEnabled: String(enableTailwind),
  });

  writeJson(
    options.targetDir,
    'package.json',
    createRootPackageJson(scope, packageSource, initialVerticals),
  );
  writeJson(options.targetDir, 'tsconfig.base.json', createTsConfigBase());
  writeJson(
    options.targetDir,
    'topology/reference-topology.json',
    createTopology(scope, initialVerticals),
  );
  writeJson(
    options.targetDir,
    'topology/ownership.json',
    createOwnership(scope, initialVerticals),
  );
  writeJson(
    options.targetDir,
    'topology/local-overlays/development.json',
    createDevelopmentOverlay(initialVerticals),
  );
  writeJson(
    options.targetDir,
    '.modernjs/ultramodern-workspace-template-manifest.json',
    createTemplateManifest(options.modernVersion, packageSource),
  );
  writeJson(
    options.targetDir,
    '.modernjs/ultramodern-package-source.json',
    createPackageSourceMetadata(scope, packageSource),
  );
  writeJson(
    options.targetDir,
    GENERATED_CONTRACT_PATH,
    createGeneratedContract(
      scope,
      [createShellHost(initialVerticals), ...initialVerticals],
      enableTailwind,
    ),
  );

  writeApp(
    options.targetDir,
    scope,
    shellApp,
    packageSource,
    enableTailwind,
    initialVerticals,
  );
  for (const remote of initialVerticals) {
    writeApp(
      options.targetDir,
      scope,
      remote,
      packageSource,
      enableTailwind,
      initialVerticals,
    );
  }
  writeSharedPackages(options.targetDir, scope);
  writeGeneratedWorkspaceScripts(
    options.targetDir,
    scope,
    enableTailwind,
    initialVerticals,
  );
}
