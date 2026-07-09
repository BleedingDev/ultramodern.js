import fs from 'node:fs';
import { createSharedDesignTokensCss } from './app-files';
import type { UltramodernBridgeConfig } from './bridge-config';
import { normalizeUltramodernBridgeConfig } from './bridge-config';
import {
  createDevelopmentOverlay,
  createOwnership,
  createTopology,
  createUltramodernConfig,
} from './contracts';
import {
  createShellHost,
  sharedPackages,
  shellApp,
  ULTRAMODERN_CONFIG_PATH,
} from './descriptors';
import {
  copyRootTemplate,
  formatGeneratedWorkspaceFiles,
  writeFile,
  writeFileReplacing,
  writeJson,
} from './fs-io';
import {
  createFileSnapshot,
  createGenerationResult,
  diffFileSnapshots,
} from './generation-result';
import { assertUniqueTailwindPrefixes, toPackageScope } from './naming';
import { runCodeSmithOverlays } from './overlays';
import {
  createRootPackageJson,
  createRootTsConfig,
  createSharedContractsIndex,
  createSharedPackage,
  createSharedPackageTsConfig,
  createTsConfigBase,
} from './package-json';
import { resolvePackageSource } from './package-source';
import type {
  JsonValue,
  ResolvedPackageSource,
  UltramodernGenerationResult,
  UltramodernWorkspaceOptions,
  WorkspaceApp,
} from './types';
import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_FETCH_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TANSTACK_ROUTER_VERSION,
  TYPESCRIPT_COMPILER_API_VERSION,
  TYPESCRIPT_VERSION,
} from './versions';
import { writeGeneratedWorkspaceScripts } from './workspace-scripts';
import { writeApp } from './write-app';
import { createZeropsYaml } from './zerops';

export { writeApp };

function writeSharedPackages(targetDir: string, scope: string) {
  for (const sharedPackage of sharedPackages) {
    writeJson(
      targetDir,
      `${sharedPackage.directory}/package.json`,
      createSharedPackage(scope, sharedPackage.id, sharedPackage.description),
    );
    writeJson(
      targetDir,
      `${sharedPackage.directory}/tsconfig.json`,
      createSharedPackageTsConfig(sharedPackage.directory),
    );
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

function createCompactRootPackageJson(
  scope: string,
  packageSource: ResolvedPackageSource,
  remotes: WorkspaceApp[],
  bridge?: UltramodernBridgeConfig,
) {
  const rootPackage = createRootPackageJson(
    scope,
    packageSource,
    remotes,
    bridge,
  ) as Record<string, any>;

  if (
    rootPackage.modernjs?.packageSource &&
    typeof rootPackage.modernjs.packageSource === 'object'
  ) {
    rootPackage.modernjs.packageSource.config = `./${ULTRAMODERN_CONFIG_PATH}`;
  }

  return rootPackage as JsonValue;
}

export function createCompactUltramodernConfig(
  scope: string,
  modernVersion: string,
  packageSource: ResolvedPackageSource,
  apps: WorkspaceApp[] = [createShellHost()],
  enableTailwind = true,
  bridge?: UltramodernBridgeConfig,
): JsonValue {
  const config = createUltramodernConfig(
    scope,
    modernVersion,
    packageSource,
    apps,
    enableTailwind,
    bridge,
  ) as Record<string, any>;

  if (
    config.packageSource &&
    typeof config.packageSource === 'object' &&
    !Array.isArray(config.packageSource)
  ) {
    delete config.packageSource.metadata;
  }

  return config as JsonValue;
}

function writePnpmWorkspacePackages(
  targetDir: string,
  bridge: UltramodernBridgeConfig | undefined,
) {
  if (!bridge) {
    return;
  }

  const pnpmWorkspacePath = `${targetDir}/pnpm-workspace.yaml`;
  const pnpmWorkspace = fs.readFileSync(pnpmWorkspacePath, 'utf-8');
  const packages = [
    'apps/*',
    'verticals/*',
    'packages/*',
    ...bridge.workspacePackages.map(entry => entry.pattern),
  ];
  const renderedPackages = packages.map(pattern => `  - ${pattern}`).join('\n');

  writeFileReplacing(
    targetDir,
    'pnpm-workspace.yaml',
    pnpmWorkspace.replace(
      /^packages:\r?\n(?: {2}- .+\r?\n)+/u,
      `packages:\n${renderedPackages}\n`,
    ),
  );
}

export function generateUltramodernWorkspace(
  options: UltramodernWorkspaceOptions,
): UltramodernGenerationResult {
  const beforeFiles = createFileSnapshot(options.targetDir);
  const scope = toPackageScope(options.packageName);
  const packageSource = resolvePackageSource(options);
  const bridge = normalizeUltramodernBridgeConfig(options.bridge);
  const enableTailwind = options.enableTailwind !== false;
  const initialVerticals: WorkspaceApp[] = [];
  const createdApps = [createShellHost(initialVerticals), ...initialVerticals];
  assertUniqueTailwindPrefixes([shellApp, ...initialVerticals]);
  fs.mkdirSync(options.targetDir, { recursive: true });

  copyRootTemplate(options.targetDir, {
    packageName: options.packageName,
    packageScope: scope,
    nodeVersion: NODE_VERSION,
    pnpmVersion: PNPM_VERSION,
    nodeFetchVersion: NODE_FETCH_VERSION,
    drizzleOrmVersion: DRIZZLE_ORM_VERSION,
    effectVersion: EFFECT_VERSION,
    effectVitestVersion: EFFECT_VITEST_VERSION,
    moduleFederationVersion: MODULE_FEDERATION_VERSION,
    tanstackRouterCoreVersion: TANSTACK_ROUTER_CORE_VERSION,
    tanstackRouterVersion: TANSTACK_ROUTER_VERSION,
    typescriptCompilerApiVersion: TYPESCRIPT_COMPILER_API_VERSION,
    typescriptVersion: TYPESCRIPT_VERSION,
    tailwindEnabled: String(enableTailwind),
  });
  writePnpmWorkspacePackages(options.targetDir, bridge);

  writeJson(
    options.targetDir,
    'package.json',
    createCompactRootPackageJson(
      scope,
      packageSource,
      initialVerticals,
      bridge,
    ),
  );
  writeFile(
    options.targetDir,
    'zerops.yaml',
    `${createZeropsYaml(scope, createdApps)}\n`,
  );
  writeJson(options.targetDir, 'tsconfig.base.json', createTsConfigBase());
  writeJson(
    options.targetDir,
    'tsconfig.json',
    createRootTsConfig(createdApps),
  );
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
    createDevelopmentOverlay(scope, initialVerticals),
  );
  writeJson(
    options.targetDir,
    ULTRAMODERN_CONFIG_PATH,
    createCompactUltramodernConfig(
      scope,
      options.modernVersion,
      packageSource,
      createdApps,
      enableTailwind,
      bridge,
    ),
  );

  writeApp(
    options.targetDir,
    scope,
    shellApp,
    packageSource,
    enableTailwind,
    initialVerticals,
    bridge,
  );
  for (const remote of initialVerticals) {
    writeApp(
      options.targetDir,
      scope,
      remote,
      packageSource,
      enableTailwind,
      initialVerticals,
      bridge,
    );
  }
  writeSharedPackages(options.targetDir, scope);
  writeGeneratedWorkspaceScripts(
    options.targetDir,
    scope,
    enableTailwind,
    initialVerticals,
  );

  const preliminaryAfterFiles = createFileSnapshot(options.targetDir);
  const preliminaryDiff = diffFileSnapshots(beforeFiles, preliminaryAfterFiles);
  const preliminaryResult = createGenerationResult({
    operation: 'workspace',
    workspaceRoot: options.targetDir,
    packageScope: scope,
    packageSource,
    createdApps,
    createdPaths: preliminaryDiff.createdPaths,
    rewrittenPaths: preliminaryDiff.rewrittenPaths,
  });
  runCodeSmithOverlays({
    workspaceRoot: options.targetDir,
    overlays: options.overlays,
    result: preliminaryResult,
  });
  formatGeneratedWorkspaceFiles(options.targetDir);

  const afterFiles = createFileSnapshot(options.targetDir);
  const { createdPaths, rewrittenPaths } = diffFileSnapshots(
    beforeFiles,
    afterFiles,
  );

  return createGenerationResult({
    operation: 'workspace',
    workspaceRoot: options.targetDir,
    packageScope: scope,
    packageSource,
    createdApps,
    createdPaths,
    rewrittenPaths,
  });
}
