import path from 'node:path';
import { createServerExecutionOverlay } from '../backend-federation';
import {
  appHasApi,
  resolveApiPrefix,
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
import { createCompactUltramodernConfig, writeApp } from '../write-workspace';
import { createZeropsYaml } from '../zerops';
import { prepareAddUltramodernVertical } from './preflight';
import {
  addShellWorkspaceDependency,
  addShellZephyrDependency,
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
    vertical,
    updatedVerticals,
  } = prepareAddUltramodernVertical(options);

  writeApp(
    options.workspaceRoot,
    scope,
    vertical,
    packageSource,
    enableTailwind,
    updatedVerticals,
    bridge,
  );
  topology.shell ??= {};
  topology.shell.verticalRefs ??= [];
  topology.shell.verticalRefs = topology.shell.verticalRefs.filter(
    (id: unknown) => id !== vertical.id,
  );
  topology.shell.verticalRefs.push(vertical.id);
  topology.shell.moduleFederation ??= {};
  topology.shell.moduleFederation.remotes ??= [];
  topology.shell.moduleFederation.remotes =
    topology.shell.moduleFederation.remotes.filter(
      (remote: { id?: unknown } | null) => remote?.id !== vertical.id,
    );
  topology.shell.moduleFederation.remotes.push({
    id: vertical.id,
    name: vertical.mfName,
    manifestUrl: `http://localhost:${vertical.port}/mf-manifest.json`,
  });
  topology.verticals ??= [];
  topology.verticals.push(verticalTopologyEntry(scope, vertical));
  ownership.owners ??= [];
  ownership.owners.push(ownershipEntry(scope, vertical));
  overlay.ports[vertical.id] = vertical.port;
  overlay.manifests ??= {};
  overlay.manifests[vertical.id] =
    `http://localhost:${vertical.port}/mf-manifest.json`;
  // API-scoped overlay entries only exist for units that ship an API surface
  // (skipped for `ui-only` and horizontal-remote units — G2a/G2H).
  if (appHasApi(vertical)) {
    overlay.serverExecution ??= {};
    overlay.serverExecution[vertical.id] = createServerExecutionOverlay(
      scope,
      vertical,
    );
    overlay.apis ??= {};
    overlay.apis[vertical.id] =
      `http://localhost:${vertical.port}${resolveApiPrefix(vertical)}`;
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
          ...shellApp,
          verticalRefs: updatedVerticals.map(vertical => vertical.id),
        },
        ...updatedVerticals,
      ],
      enableTailwind,
      bridge,
    ),
  );
  writeFileReplacing(
    options.workspaceRoot,
    'zerops.yaml',
    `${createZeropsYaml(scope, [
      {
        ...shellApp,
        verticalRefs: updatedVerticals.map(vertical => vertical.id),
      },
      ...updatedVerticals,
    ])}\n`,
  );
  rewriteShellAppFiles(
    options.workspaceRoot,
    scope,
    packageSource,
    enableTailwind,
    updatedVerticals,
    bridge,
  );
  writeGeneratedWorkspaceScripts(
    options.workspaceRoot,
    scope,
    enableTailwind,
    updatedVerticals,
  );
  addShellZephyrDependency(options.workspaceRoot, scope, vertical);
  addShellWorkspaceDependency(options.workspaceRoot, scope, vertical);
  updateRootWorkspaceScripts(
    options.workspaceRoot,
    scope,
    packageSource,
    updatedVerticals,
    bridge,
  );
  writeJsonFile(
    path.join(options.workspaceRoot, 'tsconfig.json'),
    createRootTsConfig([
      {
        ...shellApp,
        verticalRefs: updatedVerticals.map(vertical => vertical.id),
      },
      ...updatedVerticals,
    ]),
  );
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
