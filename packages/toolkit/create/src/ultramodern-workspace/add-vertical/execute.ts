import path from 'node:path';
import { rpcPath } from '../api/rpc';
import { createServerExecutionOverlay } from '../backend-federation';
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
  shellApp,
  ULTRAMODERN_CONFIG_PATH,
} from '../descriptors';
import {
  formatGeneratedWorkspaceFiles,
  writeFileReplacing,
  writeJsonFile,
} from '../fs-io';
import {
  createFileSnapshot,
  createGenerationResult,
  diffFileSnapshots,
} from '../generation-result';
import { runCodeSmithOverlays } from '../overlays';
import { createRootTsConfig } from '../package-json';
import type {
  AddUltramodernVerticalOptions,
  JsonValue,
  UltramodernGenerationResult,
} from '../types';
import { writeGeneratedWorkspaceScripts } from '../workspace-scripts';
import { rewriteAppModernConfig } from '../write-app';
import { createCompactUltramodernConfig, writeApp } from '../write-workspace';
import { createZeropsYaml } from '../zerops';
import { prepareAddUltramodernVertical } from './preflight';
import {
  rewriteShellAppFiles,
  updateRootWorkspaceScripts,
} from './shell-files';
import { ownershipEntry, verticalTopologyEntry } from './topology';
import { runWorkspaceTransaction } from './transaction';
import { configuredDevelopmentPorts } from './workspace-state';

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
  return runWorkspaceTransaction(options.workspaceRoot, () =>
    executeAddUltramodernVertical(options),
  );
}

function executeAddUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): UltramodernGenerationResult {
  const beforeFiles = createFileSnapshot(options.workspaceRoot);
  const {
    scope,
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
  const configuredDevPorts =
    nextAdditionalShells.length > 0
      ? configuredDevelopmentPorts(
          {
            ...overlay.ports,
            [primaryShell.id]: primaryShell.port,
            [vertical.id]: vertical.port,
          },
          nextAdditionalShells,
        ).toSorted((left, right) => left - right)
      : undefined;

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
  if (targetShell.id === primaryShell.id) {
    topology.shell ??= {};
    // The primary shell is its own delivery unit (G29): stamp identity too.
    topology.shell.deliveryUnit = deliveryUnitContractBlock(
      createDeliveryUnitRecord(scope, shellApp),
    );
    topology.shell.verticalRefs = nextTargetShell.verticalRefs;
    topology.shell.moduleFederation ??= {};
    topology.shell.moduleFederation.remotes =
      createModuleFederationRemoteContracts(
        nextPrimaryShell,
        updatedVerticals,
      ).map(remote => ({
        id: remote.id,
        name: remote.name,
        manifestUrl: remote.manifestUrl,
      }));
  }
  topology.verticals ??= [];
  topology.verticals.push(verticalTopologyEntry(scope, vertical));
  ownership.owners ??= [];
  ownership.owners.push(ownershipEntry(scope, vertical));
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
  writeJsonFile(
    path.join(options.workspaceRoot, ULTRAMODERN_CONFIG_PATH),
    createCompactUltramodernConfig(
      scope,
      options.modernVersion,
      packageSource,
      [
        {
          ...nextPrimaryShell,
        },
        ...updatedVerticals,
      ],
      enableTailwind,
      bridge,
      nextAdditionalShells,
      nextPrimaryShell,
    ),
  );
  writeFileReplacing(
    options.workspaceRoot,
    'zerops.yaml',
    `${createZeropsYaml(scope, [
      nextPrimaryShell,
      ...updatedVerticals,
      ...nextAdditionalShells,
    ])}\n`,
  );
  rewriteShellAppFiles(
    options.workspaceRoot,
    scope,
    packageSource,
    enableTailwind,
    updatedVerticals,
    bridge,
    nextTargetShell,
    configuredDevPorts,
  );
  writeGeneratedWorkspaceScripts(
    options.workspaceRoot,
    scope,
    enableTailwind,
    updatedVerticals,
    undefined,
    nextAdditionalShells,
    nextPrimaryShell,
  );
  updateRootWorkspaceScripts(
    options.workspaceRoot,
    scope,
    packageSource,
    updatedVerticals,
    bridge,
    nextAdditionalShells,
  );
  writeJsonFile(
    path.join(options.workspaceRoot, 'tsconfig.json'),
    createRootTsConfig([
      nextPrimaryShell,
      ...updatedVerticals,
      ...nextAdditionalShells,
    ]),
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
      rewriteAppModernConfig(
        options.workspaceRoot,
        scope,
        app,
        updatedVerticals,
        enableTailwind,
        configuredDevPorts,
      );
    }
  }
  const preliminaryAfterFiles = createFileSnapshot(options.workspaceRoot);
  const preliminaryDiff = diffFileSnapshots(beforeFiles, preliminaryAfterFiles);

  const preliminaryResult = createGenerationResult({
    operation: 'vertical',
    workspaceRoot: options.workspaceRoot,
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
    workspaceRoot: options.workspaceRoot,
    packageScope: scope,
    packageSource,
    createdApps: [vertical],
    createdPaths,
    rewrittenPaths,
  });
}
