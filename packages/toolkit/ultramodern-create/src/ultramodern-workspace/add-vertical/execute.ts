import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeWorkspaceInputs,
  preserveUnknownProjectionFields,
  reconcileGeneratedOverlayUrls,
} from '../../ultramodern-tooling/config';
import { rpcPath } from '../api/rpc';
import { createServerExecutionOverlay } from '../backend-federation';
import { createDevelopmentOverlay } from '../contracts';
import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from '../delivery-unit';
import {
  appEmitsBrowserUi,
  appHasApi,
  createModuleFederationRemoteContracts,
  resolveApiPrefix,
  resolveApiProtocol,
  resolveRemoteRefs,
} from '../descriptors';
import { formatGeneratedWorkspaceFiles, writeJsonFile } from '../fs-io';
import {
  createFileSnapshot,
  createGenerationResult,
  diffFileSnapshots,
} from '../generation-result';
import { createAppModernConfig } from '../module-federation';
import { runCodeSmithOverlays } from '../overlays';
import { createRootTsConfig } from '../package-json';
import type {
  AddUltramodernVerticalOptions,
  JsonValue,
  UltramodernGenerationResult,
  WorkspaceApp,
} from '../types';
import {
  preserveConsumerWorkspaceArtifacts,
  workspaceArtifactCandidates,
  workspaceDevelopmentPorts,
} from '../workspace-artifact-ownership';
import { writeGeneratedWorkspaceScripts } from '../workspace-scripts';
import { writeApp } from '../write-workspace';
import { createZeropsYaml } from '../zerops';
import { prepareAddUltramodernVertical } from './preflight';
import {
  rewriteShellAppFiles,
  updateRootWorkspaceScripts,
} from './shell-files';
import { ownershipEntry, verticalTopologyEntry } from './topology';
import { runWorkspaceTransaction } from './transaction';

/**
 * Add a MicroVertical to an existing workspace. Transactional (G1c): the
 * whole write-set is applied inside {@link runWorkspaceTransaction}; if any
 * step throws (preflight rejection, write failure, overlay failure,
 * formatting failure) the workspace is restored byte-identical to its
 * pre-call state and the error is rethrown.
 */
export function addUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): UltramodernGenerationResult {
  return runWorkspaceTransaction(options.workspaceRoot, stagingRoot =>
    executeAddUltramodernVertical(
      {
        ...options,
        workspaceRoot: stagingRoot,
      },
      options.workspaceRoot,
    ),
  );
}

export function executeAddUltramodernVertical(
  options: AddUltramodernVerticalOptions,
  logicalWorkspaceRoot = options.workspaceRoot,
): UltramodernGenerationResult {
  const beforeFiles = createFileSnapshot(options.workspaceRoot);
  const {
    scope,
    config,
    topologyPath,
    ownershipPath,
    overlayPath,
    topology,
    ownership,
    overlay,
    packageSource,
    enableTailwind,
    bridge,
    primaryShell,
    additionalShells,
    targetShell,
    targetVerticals,
    vertical,
    updatedVerticals,
  } = prepareAddUltramodernVertical(options);

  const previousTailwind = config.features?.tailwind !== false;
  const existingVerticals = updatedVerticals.filter(
    app => app.id !== vertical.id,
  );
  const existingIds = new Set(existingVerticals.map(app => app.id));
  // Ownership recognition renders the workspace before this addition. The
  // target shell may already reference the new vertical in stale topology.
  const previousProjection = (apps: WorkspaceApp[]) =>
    apps.map(app =>
      app.id === targetShell.id
        ? {
            ...app,
            verticalRefs: app.verticalRefs?.filter(id => existingIds.has(id)),
          }
        : app,
    );
  const previousApps = normalizeWorkspaceInputs(options.workspaceRoot, {
    topology,
    overlay,
  }).apps;
  const previousDevPorts = workspaceDevelopmentPorts(previousApps);
  const { io: ownedIo } = preserveConsumerWorkspaceArtifacts(
    options.workspaceRoot,
    workspaceArtifactCandidates(
      scope,
      previousProjection(previousApps),
      previousTailwind,
      previousProjection([
        primaryShell,
        ...existingVerticals,
        ...additionalShells,
      ]),
    ),
  );

  const nextTargetShell = {
    ...targetShell,
    // Only UI-emitting units join a shell's composition refs (G2a): headless
    // api-only units are consumed via API clients, never as MF remotes.
    verticalRefs: targetVerticals
      .filter(appEmitsBrowserUi)
      .map(remote => remote.id),
  };
  const nextPrimaryShell =
    targetShell.id === primaryShell.id
      ? { ...primaryShell, verticalRefs: nextTargetShell.verticalRefs }
      : primaryShell;
  const nextAdditionalShells = additionalShells.map(shell =>
    shell.id === nextTargetShell.id ? nextTargetShell : shell,
  );
  const configuredDevPorts = workspaceDevelopmentPorts(
    [nextPrimaryShell, ...updatedVerticals, ...nextAdditionalShells],
    overlay.ports,
  );

  writeApp(
    options.workspaceRoot,
    scope,
    vertical,
    packageSource,
    enableTailwind,
    updatedVerticals,
    bridge,
    configuredDevPorts,
  );
  const newPackagePath = path.join(
    options.workspaceRoot,
    vertical.directory,
    'package.json',
  );
  const newPackage = JSON.parse(fs.readFileSync(newPackagePath, 'utf-8'));
  newPackage.dependencies = {
    ...newPackage.dependencies,
    ...config.inheritedWorkspaceDependencies,
  };
  writeJsonFile(newPackagePath, newPackage as JsonValue);
  if (targetShell.id === primaryShell.id) {
    topology.shell ??= {};
    // The primary shell is its own delivery unit (G29): stamp identity too.
    topology.shell.deliveryUnit = {
      ...deliveryUnitContractBlock(
        createDeliveryUnitRecord(scope, primaryShell),
      ),
      ...primaryShell.deliveryUnit,
      ...topology.shell.deliveryUnit,
    };
    topology.shell.verticalRefs = nextTargetShell.verticalRefs;
    topology.shell.moduleFederation ??= {};
    topology.shell.moduleFederation.remotes = preserveAuthoredRemoteUrls(
      topology.shell.moduleFederation.remotes,
      createModuleFederationRemoteContracts(
        {
          ...primaryShell,
          verticalRefs: primaryShell.verticalRefs?.filter(id =>
            existingIds.has(id),
          ),
        },
        existingVerticals,
      ),
      createModuleFederationRemoteContracts(nextPrimaryShell, updatedVerticals),
    ).map(remote => ({
      id: remote.id,
      name: remote.name,
      manifestUrl: remote.manifestUrl,
    }));
  }
  topology.verticals ??= [];
  topology.verticals = topology.verticals.map((entry: Record<string, any>) => {
    const app = existingVerticals.find(app => app.id === entry.id);
    if (!app) return entry;
    const projected = verticalTopologyEntry(
      scope,
      app,
      updatedVerticals,
    ) as Record<string, any>;
    return {
      ...entry,
      moduleFederation: preserveUnknownProjectionFields(
        entry.moduleFederation,
        projected.moduleFederation,
      ),
      ...(projected.backendFederation
        ? {
            backendFederation: preserveUnknownProjectionFields(
              entry.backendFederation,
              projected.backendFederation,
            ),
          }
        : {}),
    };
  });
  topology.verticals.push(verticalTopologyEntry(scope, vertical));
  ownership.owners ??= [];
  ownership.owners.push(ownershipEntry(scope, vertical));
  const projectedOverlay = createDevelopmentOverlay(
    scope,
    existingVerticals,
  ) as Record<string, any>;
  Object.assign(
    overlay,
    reconcileGeneratedOverlayUrls(
      overlay,
      createDevelopmentOverlay(
        scope,
        previousApps.filter(app => app.kind !== 'shell'),
      ) as Record<string, any>,
      projectedOverlay,
    ),
  );
  overlay.serverExecution = preserveUnknownProjectionFields(
    overlay.serverExecution,
    projectedOverlay.serverExecution,
  );
  overlay.ports[vertical.id] = vertical.port;
  overlay.manifests ??= {};
  if (appEmitsBrowserUi(vertical)) {
    overlay.manifests[vertical.id] =
      `http://localhost:${vertical.port}/mf-manifest.json`;
  } else {
    delete overlay.manifests[vertical.id];
  }
  // API-scoped overlay entries only exist for units that ship an API surface
  // (skipped for `ui-only` and horizontal-remote units — G2a/G2H).
  if (appHasApi(vertical)) {
    overlay.serverExecution ??= {};
    overlay.serverExecution[vertical.id] = createServerExecutionOverlay(
      scope,
      vertical,
    );
    overlay.apis ??= {};
    overlay.apis[vertical.id] = `http://localhost:${vertical.port}${
      resolveApiProtocol(vertical) === 'rpc'
        ? rpcPath(vertical)
        : resolveApiPrefix(vertical)
    }`;
  }
  writeJsonFile(topologyPath, topology as JsonValue);
  writeJsonFile(ownershipPath, ownership as JsonValue);
  writeJsonFile(overlayPath, overlay as JsonValue);
  if (targetShell.id !== primaryShell.id) {
    topology.shells = (topology.shells ?? []).map(
      (entry: Record<string, any>) =>
        entry.id === nextTargetShell.id
          ? updateShellComposition(entry, {
              verticalRefs: nextTargetShell.verticalRefs,
              moduleFederation: {
                verticalRefs: nextTargetShell.verticalRefs,
                remotes: preserveAuthoredRemoteUrls(
                  entry.moduleFederation?.remotes,
                  createModuleFederationRemoteContracts(
                    {
                      ...targetShell,
                      verticalRefs: targetShell.verticalRefs?.filter(id =>
                        existingIds.has(id),
                      ),
                    },
                    existingVerticals,
                  ),
                  createModuleFederationRemoteContracts(
                    nextTargetShell,
                    updatedVerticals,
                  ),
                ),
              },
            })
          : entry,
    );
    writeJsonFile(topologyPath, topology as JsonValue);
  }
  ownedIo.write(
    path.join(options.workspaceRoot, 'zerops.yaml'),
    `${createZeropsYaml(scope, [nextPrimaryShell, ...updatedVerticals, ...nextAdditionalShells])}\n`,
  );
  // Regenerate EVERY shell, not only the target: the API surface is full
  // mesh (CONTEXT.md), so each shell's vertical-clients re-exports and its
  // plain workspace deps must include the new API unit even when the unit
  // composes into a different shell. Non-target shells keep their own
  // verticalRefs, so their UI composition output is byte-stable.
  for (const shellToRefresh of [nextPrimaryShell, ...nextAdditionalShells]) {
    rewriteShellAppFiles(
      options.workspaceRoot,
      scope,
      packageSource,
      enableTailwind,
      updatedVerticals,
      bridge,
      shellToRefresh.id === nextTargetShell.id
        ? nextTargetShell
        : shellToRefresh,
      configuredDevPorts,
      {
        shell: previousProjection(previousApps).find(
          app => app.id === shellToRefresh.id,
        )!,
        remotes: existingVerticals,
        devPorts: previousDevPorts,
        enableTailwind: previousTailwind,
      },
    );
  }
  writeGeneratedWorkspaceScripts(options.workspaceRoot, {
    io: { writeGenerated: ownedIo.write },
  });
  updateRootWorkspaceScripts(
    options.workspaceRoot,
    scope,
    packageSource,
    updatedVerticals,
    bridge,
    nextAdditionalShells,
    existingVerticals,
    nextPrimaryShell,
  );
  ownedIo.write(
    path.join(options.workspaceRoot, 'tsconfig.json'),
    `${JSON.stringify(
      createRootTsConfig([
        nextPrimaryShell,
        ...updatedVerticals,
        ...nextAdditionalShells,
      ]),
      null,
      2,
    )}\n`,
  );
  if (configuredDevPorts) {
    for (const app of [
      nextPrimaryShell,
      ...updatedVerticals,
      ...nextAdditionalShells,
    ]) {
      if (app.id === vertical.id || app.id === nextTargetShell.id) {
        continue;
      }
      ownedIo.write(
        path.join(options.workspaceRoot, app.directory, 'modern.config.ts'),
        createAppModernConfig(
          scope,
          app,
          app.kind === 'shell'
            ? resolveRemoteRefs(app, updatedVerticals)
            : updatedVerticals,
          enableTailwind,
          configuredDevPorts,
        ),
      );
    }
  }
  const preliminaryAfterFiles = createFileSnapshot(options.workspaceRoot);
  const preliminaryDiff = diffFileSnapshots(beforeFiles, preliminaryAfterFiles);

  const preliminaryResult = createGenerationResult({
    operation: 'vertical',
    workspaceRoot: logicalWorkspaceRoot,
    packageScope: scope,
    packageSource,
    createdApps: [vertical],
    createdPaths: preliminaryDiff.createdPaths,
    rewrittenPaths: preliminaryDiff.rewrittenPaths,
  });
  runCodeSmithOverlays({
    workspaceRoot: options.workspaceRoot,
    overlays: options.overlays,
    result: preliminaryResult,
  });
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
    operation: 'vertical',
    workspaceRoot: logicalWorkspaceRoot,
    packageScope: scope,
    packageSource,
    createdApps: [vertical],
    createdPaths,
    rewrittenPaths,
  });
}

function updateShellComposition(
  current: Record<string, any>,
  generated: Record<string, any>,
) {
  const previousRemotes = Array.isArray(current.moduleFederation?.remotes)
    ? current.moduleFederation.remotes
    : [];
  return {
    ...current,
    ...(Array.isArray(generated.verticalRefs)
      ? { verticalRefs: generated.verticalRefs }
      : {}),
    moduleFederation: {
      ...current.moduleFederation,
      verticalRefs: generated.moduleFederation.verticalRefs,
      remotes: generated.moduleFederation.remotes.map(
        (remote: Record<string, any>) => ({
          ...previousRemotes.find(
            (previous: Record<string, any>) => previous.id === remote.id,
          ),
          ...remote,
        }),
      ),
    },
  };
}

function preserveAuthoredRemoteUrls<
  T extends { id: string; manifestUrl: string },
>(current: any, previousGenerated: T[], nextGenerated: T[]) {
  return nextGenerated.map(remote => {
    const previous = Array.isArray(current)
      ? current.find((entry: { id?: string }) => entry.id === remote.id)
      : undefined;
    const generated = previousGenerated.find(entry => entry.id === remote.id);
    return previous?.manifestUrl &&
      previous.manifestUrl !== generated?.manifestUrl
      ? { ...remote, manifestUrl: previous.manifestUrl }
      : remote;
  });
}
