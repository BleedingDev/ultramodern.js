import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEVELOPMENT_OVERLAY_PATH,
  TOPOLOGY_PATH,
} from './add-vertical/constants';
import { verticalsFromTopology } from './add-vertical/topology';
import { runWorkspaceTransaction } from './add-vertical/transaction';
import {
  assertGlobalPortUniqueness,
  configuredDevelopmentPorts,
  existingBridgeConfig,
  existingPackageSource,
  existingTailwindEnabled,
  nextAvailablePort,
} from './add-vertical/workspace-state';
import { shellApp, ULTRAMODERN_CONFIG_PATH } from './descriptors';
import {
  formatGeneratedWorkspaceFiles,
  readJsonFile,
  writeFileReplacing,
  writeJsonFile,
} from './fs-io';
import {
  createFileSnapshot,
  createGenerationResult,
  diffFileSnapshots,
} from './generation-result';
import { assertUniqueTailwindPrefixes, toPackageScope } from './naming';
import { createRootPackageJson } from './package-json';
import {
  assertValidShellName,
  createAdditionalShellConfigEntry,
  createShellDescriptor,
  FIRST_ADDITIONAL_SHELL_PORT,
  PRIMARY_SHELL_ID,
  resolveConfiguredAdditionalShells,
} from './shells';
import { createRootTsConfig } from './tsconfigs';
import type {
  AddUltramodernShellOptions,
  JsonValue,
  UltramodernGenerationResult,
  UltramodernVerticalPlan,
  WorkspaceApp,
} from './types';
import { isRecord } from './types';
import { writeGeneratedWorkspaceScripts } from './workspace-scripts';
import { rewriteAppModernConfig, writeApp } from './write-app';
import { createZeropsYaml } from './zerops';

type AddUltramodernShellPreflight = {
  scope: string;
  configPath: string;
  overlayPath: string;
  config: Record<string, any>;
  overlay: Record<string, any>;
  packageSource: ReturnType<typeof existingPackageSource>;
  enableTailwind: boolean;
  bridge: ReturnType<typeof existingBridgeConfig>;
  existingVerticals: WorkspaceApp[];
  existingAdditionalShells: WorkspaceApp[];
  shell: WorkspaceApp;
  composedVerticals: WorkspaceApp[];
};

function readRequiredJsonObject(filePath: string): Record<string, any> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing UltraModern workspace file: ${filePath}`);
  }
  const value = readJsonFile(filePath);
  if (!isRecord(value)) {
    throw new Error(
      `UltraModern workspace file must contain a JSON object: ${filePath}`,
    );
  }
  return value;
}

function prepareAddUltramodernShell(
  options: AddUltramodernShellOptions,
): AddUltramodernShellPreflight {
  const name = assertValidShellName(options.name);
  const configPath = path.join(options.workspaceRoot, ULTRAMODERN_CONFIG_PATH);
  const overlayPath = path.join(
    options.workspaceRoot,
    DEVELOPMENT_OVERLAY_PATH,
  );
  const topologyPath = path.join(options.workspaceRoot, TOPOLOGY_PATH);

  const rootPackage = readRequiredJsonObject(
    path.join(options.workspaceRoot, 'package.json'),
  );
  const config = readRequiredJsonObject(configPath);
  const overlay = readRequiredJsonObject(overlayPath);
  const topology = readRequiredJsonObject(topologyPath);
  overlay.ports ??= {};

  const scope = toPackageScope(
    String(rootPackage.name ?? path.basename(options.workspaceRoot)),
  );
  const packageSource = existingPackageSource(
    options.workspaceRoot,
    options.modernVersion,
    options.packageSource,
  );
  const enableTailwind =
    options.enableTailwind ?? existingTailwindEnabled(options.workspaceRoot);
  const bridge = existingBridgeConfig(options.workspaceRoot);

  const existingVerticals = verticalsFromTopology(topology, overlay.ports);
  const existingAdditionalShells = resolveConfiguredAdditionalShells(config);

  const shellId = `shell-${name}`;
  if (
    shellId === PRIMARY_SHELL_ID ||
    existingAdditionalShells.some(existing => existing.id === shellId)
  ) {
    throw new Error(`Shell "${shellId}" already exists in this workspace.`);
  }
  if (fs.existsSync(path.join(options.workspaceRoot, `apps/${shellId}`))) {
    throw new Error(`Refusing to overwrite existing path: apps/${shellId}`);
  }

  // Feed the primary shell's ACTUAL development port into the unified
  // allocation set. Never clobber a customized overlay port with the hardcoded
  // default (3020) — doing so would let a newly allocated additional shell
  // collide with a primary shell that operators moved (e.g. to 3120). Fall back
  // to the descriptor default only when the overlay does not record it.
  const overlayPorts = overlay.ports ?? {};
  const portsWithPrimary = {
    ...overlayPorts,
    [shellApp.id]:
      typeof overlayPorts[shellApp.id] === 'number'
        ? overlayPorts[shellApp.id]
        : shellApp.port,
  };
  assertGlobalPortUniqueness(portsWithPrimary, existingAdditionalShells);
  const shell = createShellDescriptor(
    name,
    nextAvailablePort(
      portsWithPrimary,
      existingAdditionalShells,
      FIRST_ADDITIONAL_SHELL_PORT,
    ),
  );

  const requestedVerticalIds =
    options.verticals ?? existingVerticals.map(vertical => vertical.id);
  const verticalsById = new Map(
    existingVerticals.map(vertical => [vertical.id, vertical]),
  );
  const composedVerticals = requestedVerticalIds.map(id => {
    const vertical = verticalsById.get(id);
    if (!vertical) {
      const available =
        existingVerticals.map(candidate => candidate.id).join(', ') || 'none';
      throw new Error(
        `Unknown vertical "${id}" for shell ${shellId}. Available verticals: ${available}.`,
      );
    }
    return vertical;
  });
  shell.verticalRefs = composedVerticals.map(vertical => vertical.id);

  assertUniqueTailwindPrefixes([
    shellApp,
    ...existingAdditionalShells,
    shell,
    ...existingVerticals,
  ]);

  return {
    scope,
    configPath,
    overlayPath,
    config,
    overlay,
    packageSource,
    enableTailwind,
    bridge,
    existingVerticals,
    existingAdditionalShells,
    shell,
    composedVerticals,
  };
}

/**
 * Add an additional thin shell to an existing workspace (G28). Transactional:
 * the whole write-set is applied inside {@link runWorkspaceTransaction}; any
 * failure restores the workspace byte-identical to its pre-call state.
 */
export function addUltramodernShell(
  options: AddUltramodernShellOptions,
): UltramodernGenerationResult {
  return runWorkspaceTransaction(options.workspaceRoot, () =>
    executeAddUltramodernShell(options),
  );
}

function executeAddUltramodernShell(
  options: AddUltramodernShellOptions,
): UltramodernGenerationResult {
  const beforeFiles = createFileSnapshot(options.workspaceRoot);
  const preflight = prepareAddUltramodernShell(options);
  const {
    scope,
    configPath,
    config,
    packageSource,
    enableTailwind,
    bridge,
    existingVerticals,
    existingAdditionalShells,
    shell,
    composedVerticals,
  } = preflight;

  const primaryShell = {
    ...shellApp,
    verticalRefs: existingVerticals.map(vertical => vertical.id),
  };
  const allAdditionalShells = [...existingAdditionalShells, shell];
  const configuredDevPorts = configuredDevelopmentPorts(
    { ...preflight.overlay.ports, [shell.id]: shell.port },
    allAdditionalShells,
  ).toSorted((left, right) => left - right);

  writeApp(
    options.workspaceRoot,
    scope,
    shell,
    packageSource,
    enableTailwind,
    composedVerticals,
    bridge,
    configuredDevPorts,
  );

  // Register the additional shell in the additive `shells` collection of the
  // compact config. It is deliberately kept out of the strict topology.apps /
  // ownership cohort so a single-shell workspace stays byte-identical.
  const shellsCollection = Array.isArray(config.shells)
    ? config.shells.filter((entry: { id?: unknown }) => entry?.id !== shell.id)
    : [];
  shellsCollection.push(
    createAdditionalShellConfigEntry(scope, shell, existingVerticals),
  );
  config.shells = shellsCollection;
  writeJsonFile(configPath, config as JsonValue);

  for (const app of [
    primaryShell,
    ...existingVerticals,
    ...existingAdditionalShells,
  ]) {
    rewriteAppModernConfig(
      options.workspaceRoot,
      scope,
      app,
      existingVerticals,
      enableTailwind,
      configuredDevPorts,
    );
  }

  const rootPackagePath = path.join(options.workspaceRoot, 'package.json');
  const rootPackage = readJsonFile(rootPackagePath);
  const generatedRootPackage = createRootPackageJson(
    scope,
    packageSource,
    existingVerticals,
    bridge,
    allAdditionalShells,
  ) as Record<string, any>;
  rootPackage.scripts = generatedRootPackage.scripts;
  writeJsonFile(rootPackagePath, rootPackage as JsonValue);

  writeJsonFile(
    path.join(options.workspaceRoot, 'tsconfig.json'),
    createRootTsConfig([
      primaryShell,
      ...existingVerticals,
      ...allAdditionalShells,
    ]),
  );

  writeGeneratedWorkspaceScripts(
    options.workspaceRoot,
    scope,
    enableTailwind,
    existingVerticals,
    undefined,
    allAdditionalShells,
    primaryShell,
  );

  writeFileReplacing(
    options.workspaceRoot,
    'zerops.yaml',
    `${createZeropsYaml(scope, [
      primaryShell,
      ...existingVerticals,
      ...allAdditionalShells,
    ])}\n`,
  );

  const afterOverlaysFiles = createFileSnapshot(options.workspaceRoot);
  const changedPaths = diffFileSnapshots(beforeFiles, afterOverlaysFiles);
  formatGeneratedWorkspaceFiles(options.workspaceRoot, [
    ...changedPaths.createdPaths,
    ...changedPaths.rewrittenPaths,
  ]);

  const afterFiles = createFileSnapshot(options.workspaceRoot);
  const { createdPaths, rewrittenPaths } = diffFileSnapshots(
    beforeFiles,
    afterFiles,
  );

  return createGenerationResult({
    operation: 'shell',
    workspaceRoot: options.workspaceRoot,
    packageScope: scope,
    packageSource,
    createdApps: [shell],
    createdPaths,
    rewrittenPaths,
  });
}

/**
 * Dry-run parity for {@link addUltramodernShell} (G28). Applies the operation
 * against a throwaway copy of the workspace and returns the planned result
 * (created/rewritten paths, delivery-unit identity) without touching the real
 * workspace.
 */
export function planUltramodernShell(
  options: AddUltramodernShellOptions,
): UltramodernVerticalPlan {
  prepareAddUltramodernShell(options);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-shell-plan-'));
  const copiedWorkspaceRoot = path.join(tempRoot, 'workspace');
  const skippedDirectories = new Set([
    '.git',
    '.nx',
    '.output',
    'coverage',
    'dist',
    'node_modules',
  ]);

  try {
    fs.cpSync(options.workspaceRoot, copiedWorkspaceRoot, {
      recursive: true,
      filter: sourcePath => !skippedDirectories.has(path.basename(sourcePath)),
    });
    const plannedResult = addUltramodernShell({
      ...options,
      workspaceRoot: copiedWorkspaceRoot,
    });
    const shell = plannedResult.createdApps[0];

    return {
      ...plannedResult,
      workspaceRoot: options.workspaceRoot,
      dryRun: true,
      selectedPort: shell?.port ?? 0,
      moduleFederationRemote: {
        id: shell?.id ?? '',
        name: shell?.moduleFederationName ?? '',
        manifestUrl: `http://localhost:${shell?.port ?? 0}/mf-manifest.json`,
      },
      jsonMutations: [
        {
          path: ULTRAMODERN_CONFIG_PATH,
          pointer: '/shells/-',
          description: `Register additional shell ${shell?.id}`,
        },
        {
          path: 'package.json',
          pointer: '/scripts',
          description: 'Enumerate all configured shells in workspace scripts',
        },
        {
          path: 'tsconfig.json',
          pointer: '/references',
          description: `Add ${shell?.id} to the root TS-Go build graph`,
        },
      ],
      shellDependencyChanges: [],
      generatedContractChanges: [
        {
          path: ULTRAMODERN_CONFIG_PATH,
          addedAppIds: [shell?.id ?? ''],
          shellVerticalRefs: options.verticals ?? [],
        },
      ],
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
