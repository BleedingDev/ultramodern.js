import fs from 'node:fs';
import {
  modernPackageSpecifier,
  ULTRAMODERN_WORKSPACE_MODERN_PACKAGES,
} from '../ultramodern-package-source';
import { isCreatePackageSourceCheckout } from '../ultramodern-release-cohort';
import { runFreshWorkspaceTransaction } from './add-vertical/transaction';
import { createSharedDesignTokensCss } from './app-files';
import type { UltramodernBridgeConfig } from './bridge-config';
import { normalizeUltramodernBridgeConfig } from './bridge-config';
import {
  createDevelopmentOverlay,
  createOwnership,
  createTopology,
} from './contracts';
import { createShellHost, sharedPackages, shellApp } from './descriptors';
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
import {
  resolvePackageSource,
  resolveWorkspacePackageLinkingPolicy,
} from './package-source';
import type {
  ResolvedPackageSource,
  UltramodernGenerationResult,
  UltramodernWorkspaceOptions,
  WorkspaceApp,
} from './types';
import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  I18NEXT_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_FETCH_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
  TANSTACK_HISTORY_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TANSTACK_ROUTER_VERSION,
  TYPESCRIPT_VERSION,
  WRANGLER_VERSION,
  ZOD_VERSION,
} from './versions';
import { writeGeneratedWorkspaceScripts } from './workspace-scripts';
import { writeApp } from './write-app';
import { createZeropsYaml } from './zerops';

export { writeApp };

function hasExplicitInstallRequest(options: UltramodernWorkspaceOptions) {
  return (
    options.packageSource !== undefined &&
    options.packageSource.strategy !== 'workspace'
  );
}

function writeSharedPackages(
  targetDir: string,
  scope: string,
  packageSource: ResolvedPackageSource,
) {
  for (const sharedPackage of sharedPackages) {
    writeJson(
      targetDir,
      `${sharedPackage.directory}/package.json`,
      createSharedPackage(
        scope,
        sharedPackage.id,
        sharedPackage.description,
        packageSource,
      ),
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

function writePnpmWorkspacePackages(
  targetDir: string,
  bridge: UltramodernBridgeConfig | undefined,
  packageSource: ResolvedPackageSource,
) {
  const pnpmWorkspacePath = `${targetDir}/pnpm-workspace.yaml`;
  const pnpmWorkspace = fs.readFileSync(pnpmWorkspacePath, 'utf-8');
  const packages = [
    'apps/*',
    'verticals/*',
    'packages/*',
    ...(bridge?.workspacePackages.map(entry => entry.pattern) ?? []),
  ];
  const renderedPackages = packages.map(pattern => `  - ${pattern}`).join('\n');

  const catalog =
    packageSource.strategy === 'install'
      ? `catalogs:\n  ultramodern:\n${ULTRAMODERN_WORKSPACE_MODERN_PACKAGES.map(
          name =>
            `    ${JSON.stringify(name)}: ${JSON.stringify(modernPackageSpecifier(name, packageSource))}`,
        ).join('\n')}\n\n`
      : '';
  writeFileReplacing(
    targetDir,
    'pnpm-workspace.yaml',
    `${catalog}${pnpmWorkspace.replace(
      /^packages:\r?\n(?: {2}- .+\r?\n)+/u,
      `packages:\n${renderedPackages}\n`,
    )}`,
  );
}

export function generateUltramodernWorkspace(
  options: UltramodernWorkspaceOptions,
): UltramodernGenerationResult {
  const result = runFreshWorkspaceTransaction(options.targetDir, stagingRoot =>
    generateUltramodernWorkspaceInPlace(
      {
        ...options,
        targetDir: stagingRoot,
      },
      options.targetDir,
    ),
  );
  return result;
}

function generateUltramodernWorkspaceInPlace(
  options: UltramodernWorkspaceOptions,
  logicalWorkspaceRoot = options.targetDir,
): UltramodernGenerationResult {
  const beforeFiles = createFileSnapshot(options.targetDir);
  const scope = toPackageScope(options.packageName);
  let packageSource: ResolvedPackageSource;
  if (isCreatePackageSourceCheckout()) {
    if (hasExplicitInstallRequest(options)) {
      throw new Error(
        'A local @modern-js/ultramodern-create source checkout cannot satisfy an explicit install package source. Use workspace mode locally or run the packed published package.',
      );
    }
    // A source checkout has no shipped release identity. Do this before any
    // projection lookup so an untracked asset cannot authorize registry policy.
    packageSource = resolvePackageSource({
      ...options,
      packageSource: { strategy: 'workspace' },
    });
  } else {
    packageSource = resolvePackageSource(options);
  }
  const bridge = normalizeUltramodernBridgeConfig(options.bridge);
  const enableTailwind = options.enableTailwind !== false;
  const initialVerticals: WorkspaceApp[] = [];
  const createdApps = [createShellHost(initialVerticals), ...initialVerticals];
  assertUniqueTailwindPrefixes([shellApp, ...initialVerticals]);
  fs.mkdirSync(options.targetDir, { recursive: true });

  const workspacePackageLinkingPolicy =
    resolveWorkspacePackageLinkingPolicy(packageSource);

  const excludedRootTemplates = new Set([
    'scripts/setup-agent-reference-repos.mjs',
  ]);
  if (options.generateAgentFiles === false) {
    excludedRootTemplates.add('AGENTS.md.handlebars');
    excludedRootTemplates.add('CLAUDE.md.handlebars');
  }

  copyRootTemplate(
    options.targetDir,
    {
      packageName: options.packageName,
      packageScope: scope,
      nodeVersion: NODE_VERSION,
      pnpmVersion: PNPM_VERSION,
      nodeFetchVersion: NODE_FETCH_VERSION,
      drizzleOrmVersion: DRIZZLE_ORM_VERSION,
      effectVersion: EFFECT_VERSION,
      effectVitestVersion: EFFECT_VITEST_VERSION,
      i18nextVersion: I18NEXT_VERSION,
      moduleFederationVersion: MODULE_FEDERATION_VERSION,
      zodVersion: ZOD_VERSION,
      tanstackHistoryVersion: TANSTACK_HISTORY_VERSION,
      tanstackRouterCoreVersion: TANSTACK_ROUTER_CORE_VERSION,
      tanstackRouterVersion: TANSTACK_ROUTER_VERSION,
      typescriptVersion: TYPESCRIPT_VERSION,
      wranglerVersion: WRANGLER_VERSION,
      workspacePackageLinkingYaml: Object.entries(workspacePackageLinkingPolicy)
        .map(([key, value]) => `${key}: ${String(value)}\n`)
        .join(''),
      tailwindEnabled: String(enableTailwind),
    },
    excludedRootTemplates,
  );
  writePnpmWorkspacePackages(options.targetDir, bridge, packageSource);

  writeJson(
    options.targetDir,
    'package.json',
    createRootPackageJson(scope, packageSource, initialVerticals, bridge),
  );
  // Zerops materialization is a delivery-unit capability. Fresh workspaces
  // start with the shell alone; add-vertical writes the manifest together
  // with the materializer and its package scripts when the first deployable
  // vertical is added.
  if (initialVerticals.length > 0) {
    writeFile(
      options.targetDir,
      'zerops.yaml',
      `${createZeropsYaml(scope, createdApps)}\n`,
    );
  }
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
  writeSharedPackages(options.targetDir, scope, packageSource);
  writeGeneratedWorkspaceScripts(options.targetDir);

  const preliminaryAfterFiles = createFileSnapshot(options.targetDir);
  const preliminaryDiff = diffFileSnapshots(beforeFiles, preliminaryAfterFiles);
  const preliminaryResult = createGenerationResult({
    operation: 'workspace',
    workspaceRoot: logicalWorkspaceRoot,
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
    workspaceRoot: logicalWorkspaceRoot,
    packageScope: scope,
    packageSource,
    createdApps,
    createdPaths,
    rewrittenPaths,
  });
}
