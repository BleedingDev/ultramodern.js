import fs from 'node:fs';
import path from 'node:path';
import { normalizeWorkspaceInputs } from '../ultramodern-tooling/config';
import {
  DEVELOPMENT_OVERLAY_PATH,
  OWNERSHIP_PATH,
  TOPOLOGY_PATH,
} from './add-vertical/constants';
import { readRequiredJsonObject } from './add-vertical/preflight';
import { describeJsonChanges } from './add-vertical/preview';
import { updateRootWorkspaceScripts } from './add-vertical/shell-files';
import { ownershipEntry } from './add-vertical/topology';
import { runWorkspaceTransaction } from './add-vertical/transaction';
import {
  assertGlobalPortUniqueness,
  nextAvailablePort,
  workspaceOperationSettings,
} from './add-vertical/workspace-state';
import { appEmitsBrowserUi, resolveRemoteRefs, shellApp } from './descriptors';
import { formatGeneratedWorkspaceFiles, writeJsonFile } from './fs-io';
import {
  createFileSnapshot,
  createGenerationResult,
  diffFileSnapshots,
} from './generation-result';
import { createAppModernConfig } from './module-federation';
import {
  assertUniqueTailwindPrefixes,
  packageName,
  toPackageScope,
} from './naming';
import { createCloudflareDeployContract } from './policy';
import {
  assertValidShellName,
  createShellDescriptor,
  FIRST_ADDITIONAL_SHELL_PORT,
  PRIMARY_SHELL_ID,
  shellDeliveryUnitBlock,
} from './shells';
import { createRootTsConfig } from './tsconfigs';
import type {
  AddUltramodernShellOptions,
  JsonValue,
  UltramodernGenerationResult,
  UltramodernVerticalPlan,
  WorkspaceApp,
} from './types';
import {
  preserveConsumerWorkspaceArtifacts,
  workspaceArtifactCandidates,
  workspaceDevelopmentPorts,
} from './workspace-artifact-ownership';
import { writeGeneratedWorkspaceScripts } from './workspace-scripts';
import { writeApp } from './write-app';
import { createZeropsYaml } from './zerops';

type AddUltramodernShellPreflight = {
  scope: string;
  topologyPath: string;
  ownershipPath: string;
  overlayPath: string;
  config: ReturnType<typeof normalizeWorkspaceInputs>['config'];
  topology: Record<string, any>;
  ownership: Record<string, any>;
  overlay: Record<string, any>;
  packageSource: ReturnType<typeof workspaceOperationSettings>['packageSource'];
  enableTailwind: boolean;
  bridge: ReturnType<typeof workspaceOperationSettings>['bridge'];
  primaryShell: WorkspaceApp;
  existingVerticals: WorkspaceApp[];
  existingAdditionalShells: WorkspaceApp[];
  shell: WorkspaceApp;
};

function prepareAddUltramodernShell(
  options: AddUltramodernShellOptions,
): AddUltramodernShellPreflight {
  const name = assertValidShellName(options.name);
  const overlayPath = path.join(
    options.workspaceRoot,
    DEVELOPMENT_OVERLAY_PATH,
  );
  const topologyPath = path.join(options.workspaceRoot, TOPOLOGY_PATH);
  const ownershipPath = path.join(options.workspaceRoot, OWNERSHIP_PATH);

  const rootPackage = readRequiredJsonObject(
    path.join(options.workspaceRoot, 'package.json'),
  );
  const overlay = readRequiredJsonObject(overlayPath);
  const topology = readRequiredJsonObject(topologyPath);
  const ownership = readRequiredJsonObject(ownershipPath);
  overlay.ports ??= {};

  const scope = toPackageScope(
    String(rootPackage.name ?? path.basename(options.workspaceRoot)),
  );

  const workspace = normalizeWorkspaceInputs(options.workspaceRoot, {
    topology,
    overlay,
  });
  const { packageSource, enableTailwind, bridge } = workspaceOperationSettings(
    options,
    workspace.config,
  );
  const {
    primaryShell: resolvedPrimaryShell,
    verticals: existingVerticals,
    additionalShells: existingAdditionalShells,
  } = workspace;
  const primaryShell = resolvedPrimaryShell!;

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

  const portsWithPrimary = {
    ...overlay.ports,
    [primaryShell.id]: primaryShell.port,
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

  // A shell composes only UI-emitting units by default (G2a): headless
  // api-only verticals never join composition refs. An explicit list is
  // still validated below but keeps the caller's intent.
  const requestedVerticalIds =
    options.verticals ??
    existingVerticals.filter(appEmitsBrowserUi).map(vertical => vertical.id);
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
    topologyPath,
    ownershipPath,
    overlayPath,
    config: workspace.config,
    topology,
    ownership,
    overlay,
    packageSource,
    enableTailwind,
    bridge,
    primaryShell,
    existingVerticals,
    existingAdditionalShells,
    shell,
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
  return runWorkspaceTransaction(options.workspaceRoot, stagingRoot =>
    executeAddUltramodernShell(
      {
        ...options,
        workspaceRoot: stagingRoot,
      },
      options.workspaceRoot,
    ),
  );
}

function executeAddUltramodernShell(
  options: AddUltramodernShellOptions,
  logicalWorkspaceRoot = options.workspaceRoot,
): UltramodernGenerationResult {
  const beforeFiles = createFileSnapshot(options.workspaceRoot);
  const preflight = prepareAddUltramodernShell(options);
  const {
    scope,
    topologyPath,
    ownershipPath,
    topology,
    ownership,
    config,
    packageSource,
    enableTailwind,
    bridge,
    primaryShell,
    existingVerticals,
    existingAdditionalShells,
    shell,
  } = preflight;

  const allAdditionalShells = [...existingAdditionalShells, shell];
  const configuredDevPorts = workspaceDevelopmentPorts(
    [primaryShell, ...existingVerticals, ...allAdditionalShells],
    preflight.overlay.ports,
  );

  const previousApps = [
    primaryShell,
    ...existingVerticals,
    ...existingAdditionalShells,
  ];
  const { io: ownedIo } = preserveConsumerWorkspaceArtifacts(
    options.workspaceRoot,
    workspaceArtifactCandidates(
      scope,
      previousApps,
      enableTailwind,
      previousApps,
    ),
  );

  writeApp(
    options.workspaceRoot,
    scope,
    shell,
    packageSource,
    enableTailwind,
    existingVerticals,
    bridge,
    configuredDevPorts,
  );

  topology.shells ??= [];
  topology.shells.push({
    id: shell.id,
    kind: 'shell',
    package: packageName(scope, shell.packageSuffix),
    path: shell.directory,
    displayName: shell.displayName,
    portEnv: shell.portEnv,
    verticalRefs: shell.verticalRefs,
    moduleFederation: {
      role: 'host',
      name: shell.mfName,
      verticalRefs: shell.verticalRefs,
      remotes: resolveRemoteRefs(shell, existingVerticals).map(remote => ({
        id: remote.id,
        name: remote.mfName,
        manifestUrl: `http://localhost:${remote.port}/mf-manifest.json`,
      })),
      ssr: true,
      sharedContractVersion: 'mf-ssr-contract-v1',
    },
    deliveryUnit: shellDeliveryUnitBlock(scope, shell),
    cloudflare: createCloudflareDeployContract(scope, shell),
    ownership: shell.ownership,
  });
  writeJsonFile(topologyPath, topology as JsonValue);
  ownership.owners ??= [];
  ownership.owners.push(ownershipEntry(scope, shell));
  writeJsonFile(ownershipPath, ownership as JsonValue);
  preflight.overlay.ports[shell.id] = shell.port;
  writeJsonFile(preflight.overlayPath, preflight.overlay as JsonValue);
  const newPackagePath = path.join(
    options.workspaceRoot,
    shell.directory,
    'package.json',
  );
  const newPackage = readRequiredJsonObject(newPackagePath);
  newPackage.dependencies = {
    ...newPackage.dependencies,
    ...config.inheritedWorkspaceDependencies,
  };
  writeJsonFile(newPackagePath, newPackage as JsonValue);

  for (const app of previousApps) {
    ownedIo.write(
      path.join(options.workspaceRoot, app.directory, 'modern.config.ts'),
      createAppModernConfig(
        scope,
        app,
        app.kind === 'shell'
          ? resolveRemoteRefs(app, existingVerticals)
          : existingVerticals,
        enableTailwind,
        configuredDevPorts,
      ),
    );
  }
  updateRootWorkspaceScripts(
    options.workspaceRoot,
    scope,
    packageSource,
    existingVerticals,
    bridge,
    allAdditionalShells,
    existingVerticals,
    primaryShell,
    existingAdditionalShells,
  );
  ownedIo.write(
    path.join(options.workspaceRoot, 'tsconfig.json'),
    `${JSON.stringify(createRootTsConfig([primaryShell, ...existingVerticals, ...allAdditionalShells]), null, 2)}\n`,
  );

  writeGeneratedWorkspaceScripts(options.workspaceRoot, {
    io: { writeGenerated: ownedIo.write },
  });

  ownedIo.write(
    path.join(options.workspaceRoot, 'zerops.yaml'),
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
    workspaceRoot: logicalWorkspaceRoot,
    packageScope: scope,
    packageSource,
    createdApps: [shell],
    createdPaths,
    rewrittenPaths,
  });
}

/**
 * Dry-run parity for {@link addUltramodernShell} (G28). Applies the operation
 * through the shared transaction preparation path and returns the planned result
 * (created/rewritten paths, delivery-unit identity) without touching the real
 * workspace.
 */
export function planUltramodernShell(
  options: AddUltramodernShellOptions,
): UltramodernVerticalPlan {
  const preflight = prepareAddUltramodernShell(options);
  let jsonMutations: UltramodernVerticalPlan['jsonMutations'] = [];
  const plannedResult = runWorkspaceTransaction(
    options.workspaceRoot,
    stagingRoot =>
      executeAddUltramodernShell(
        { ...options, workspaceRoot: stagingRoot },
        options.workspaceRoot,
      ),
    {
      mode: 'preview',
      inspectChanges: changes => {
        jsonMutations = describeJsonChanges(changes);
      },
    },
  );
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
    jsonMutations,
    shellDependencyChanges: [],
    generatedContractChanges: [
      {
        path: 'topology/reference-topology.json',
        addedAppIds: [shell?.id ?? ''],
        shellVerticalRefs: preflight.shell.verticalRefs ?? [],
      },
    ],
  };
}
