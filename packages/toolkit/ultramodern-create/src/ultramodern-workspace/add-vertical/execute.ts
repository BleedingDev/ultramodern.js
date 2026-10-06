import fs from 'node:fs';
import path from 'node:path';
import { assertUltramodernBuildArtifact } from '@modern-js/backend-federation-contracts';
import {
  assertConfigSourceSnapshotUnchanged,
  captureConfigSourceSnapshot,
} from '@modern-js/ultramodern-app-tools/config-evaluator';
import { yaml } from '@modern-js/utils';
import { preserveUnknownProjectionFields } from '../../ultramodern-tooling/config';
import {
  createGeneratedConfigProjections,
  projectGeneratedWorkspacePolicy,
  projectWrittenWorkspacePolicy,
} from '../config-generated-projections';
import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from '../delivery-unit';
import { stampDeliveryUnitIdentity } from '../delivery-unit-stamp';
import {
  appEmitsBrowserUi,
  createModuleFederationRemoteContracts,
} from '../descriptors';
import {
  projectAddedVerticalDevelopmentOverlay,
  projectResolvedDevelopmentOverlay,
} from '../development-overlay-projection';
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
import { createUltramodernBuildArtifactJson } from '../module-federation';
import { runCodeSmithOverlays } from '../overlays';
import { createRootTsConfig } from '../package-json';
import { captureWorkspaceRendererEvaluations } from '../renderer-config-evaluation';
import {
  assertWorkspaceRendererArtifact,
  reconcileWorkspaceRendererIdentities,
} from '../renderer-identity';
import {
  captureExistingWorkspaceOverlayGuard,
  replaceRendererIdentityProjections,
} from '../renderer-identity-projections';
import { appSupportsFederation } from '../renderer-profile';
import type {
  AddUltramodernVerticalOptions,
  JsonValue,
  UltramodernGenerationResult,
  WorkspaceApp,
} from '../types';
import {
  assertRendererDependencies,
  assertRendererProjection,
  validateApiOnlySourceSurface,
} from '../validation/renderer';
import {
  preserveConsumerWorkspaceArtifacts,
  workspaceArtifactCandidates,
} from '../workspace-artifact-ownership';
import { writeGeneratedWorkspaceScripts } from '../workspace-scripts';
import { writeApp } from '../write-workspace';
import { createZeropsYaml } from '../zerops';
import { DEVELOPMENT_OVERLAY_PATH, TOPOLOGY_PATH } from './constants';
import {
  type AddUltramodernVerticalPreflight,
  assertSupportedRendererComposition,
  prepareAddUltramodernVertical,
  readRequiredJsonObject,
  resolveAddedVerticalComposition,
  stageAddUltramodernVerticalPreflight,
} from './preflight';
import {
  rewriteShellAppFiles,
  updateRootWorkspaceScripts,
} from './shell-files';
import { ownershipEntry, verticalTopologyEntry } from './topology';
import {
  recoverWorkspaceTransactions,
  runWorkspaceTransaction,
} from './transaction';

/**
 * Add a MicroVertical to an existing workspace. Transactional (G1c): the
 * whole write-set is applied inside {@link runWorkspaceTransaction}; if any
 * step throws (preflight rejection, write failure, overlay failure,
 * formatting failure) the workspace is restored byte-identical to its
 * pre-call state and the error is rethrown.
 */
export async function addUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): Promise<UltramodernGenerationResult> {
  recoverWorkspaceTransactions(path.resolve(options.workspaceRoot));
  const preflight = await prepareAddUltramodernVertical(options);
  let stagedPreflight: AddUltramodernVerticalPreflight | undefined;
  return runWorkspaceTransaction(
    options.workspaceRoot,
    stagingRoot => {
      stagedPreflight = stageAddUltramodernVerticalPreflight(
        preflight,
        stagingRoot,
      );
      return executeAddUltramodernVertical(
        {
          ...options,
          workspaceRoot: stagingRoot,
        },
        options.workspaceRoot,
        stagedPreflight,
      );
    },
    {
      assertInputsUnchanged: () =>
        (stagedPreflight ?? preflight).assertPublicationInputsUnchanged(),
    },
  );
}

export async function executeAddUltramodernVertical(
  options: AddUltramodernVerticalOptions,
  logicalWorkspaceRoot = options.workspaceRoot,
  prepared?: AddUltramodernVerticalPreflight,
): Promise<UltramodernGenerationResult> {
  const preflight = prepared ?? (await prepareAddUltramodernVertical(options));
  preflight.assertInputsUnchanged();
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
  } = preflight;

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
  const previousApps = [
    primaryShell,
    ...existingVerticals,
    ...additionalShells,
  ];
  const { io: ownedIo } = preserveConsumerWorkspaceArtifacts(
    options.workspaceRoot,
    workspaceArtifactCandidates(scope, previousProjection(previousApps)),
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
  const generatedProjections = createGeneratedConfigProjections({
    workspaceRoot: options.workspaceRoot,
    scope,
    beforeApps: previousProjection(previousApps),
    afterApps: [nextPrimaryShell, ...updatedVerticals, ...nextAdditionalShells],
    packageSource,
    beforeTailwind: previousTailwind,
    afterTailwind: enableTailwind,
    bridge,
  });
  const assertConsumedInputsUnchanged = preflight.assertConsumedInputsUnchanged;
  preflight.assertConsumedInputsUnchanged = stagedRoot =>
    assertConsumedInputsUnchanged(stagedRoot, generatedProjections);

  writeApp(
    options.workspaceRoot,
    scope,
    vertical,
    packageSource,
    enableTailwind,
    updatedVerticals,
    bridge,
  );
  for (const app of previousApps) {
    const entry =
      app.id === primaryShell.id
        ? topology.shell
        : (app.kind === 'shell' ? topology.shells : topology.verticals)?.find(
            (candidate: Record<string, any>) => candidate.id === app.id,
          );
    if (entry) {
      stampDeliveryUnitIdentity(
        entry,
        scope,
        app,
        app.deliveryUnit?.version ?? '0.1.0',
      );
      if (!appSupportsFederation(app)) delete entry.moduleFederation;
      if (
        app.rendererGenerationProfile &&
        !app.rendererGenerationProfile.capabilities.workers
      ) {
        delete entry.cloudflare;
      }
    }
    writeFileReplacing(
      options.workspaceRoot,
      `${app.directory}/shared/ultramodern-build.json`,
      createUltramodernBuildArtifactJson(scope, app),
    );
  }
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
    if (appSupportsFederation(nextPrimaryShell)) {
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
        createModuleFederationRemoteContracts(
          nextPrimaryShell,
          updatedVerticals,
        ),
      ).map(remote => ({
        id: remote.id,
        name: remote.name,
        manifestUrl: remote.manifestUrl,
      }));
    }
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
  topology.verticals.push(
    verticalTopologyEntry(scope, vertical, [], 'source-authoring'),
  );
  ownership.owners ??= [];
  ownership.owners.push(ownershipEntry(scope, vertical));
  Object.assign(
    overlay,
    projectAddedVerticalDevelopmentOverlay(
      scope,
      overlay,
      existingVerticals,
      vertical,
    ),
  );
  writeJsonFile(topologyPath, topology as JsonValue);
  writeJsonFile(ownershipPath, ownership as JsonValue);
  writeJsonFile(overlayPath, overlay as JsonValue);
  if (targetShell.id !== primaryShell.id) {
    topology.shells = (topology.shells ?? []).map(
      (entry: Record<string, any>) =>
        entry.id === nextTargetShell.id
          ? updateShellComposition(entry, {
              verticalRefs: nextTargetShell.verticalRefs,
              ...(appSupportsFederation(nextTargetShell)
                ? {
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
                  }
                : {}),
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
      {
        shell: previousProjection(previousApps).find(
          app => app.id === shellToRefresh.id,
        )!,
        remotes: existingVerticals,
        enableTailwind: previousTailwind,
      },
    );
  }
  writeGeneratedWorkspaceScripts(options.workspaceRoot, {
    io: { writeGenerated: ownedIo.write },
    renderer: nextPrimaryShell.rendererGenerationProfile!.renderer,
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
    additionalShells,
    primaryShell,
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
  const preliminaryAfterFiles = createFileSnapshot(options.workspaceRoot);
  const preliminaryDiff = diffFileSnapshots(beforeFiles, preliminaryAfterFiles);

  const preliminaryResult = createGenerationResult({
    phase: 'source-authoring',
    operation: 'vertical',
    workspaceRoot: logicalWorkspaceRoot,
    packageScope: scope,
    packageSource,
    createdApps: [vertical],
    createdPaths: preliminaryDiff.createdPaths,
    rewrittenPaths: preliminaryDiff.rewrittenPaths,
  });
  const assertExistingOverlayInputsUnchanged = options.overlays?.length
    ? captureExistingWorkspaceOverlayGuard(
        options.workspaceRoot,
        vertical.directory,
      )
    : undefined;
  const deferredUiArtifactPaths = new Set(
    appEmitsBrowserUi(vertical)
      ? [`${vertical.directory}/shared/ultramodern-build.json`]
      : [],
  );
  projectWrittenWorkspacePolicy(generatedProjections, options.workspaceRoot);
  preflight.assertConsumedInputsUnchanged(options.workspaceRoot);
  runCodeSmithOverlays({
    workspaceRoot: options.workspaceRoot,
    deferredUiArtifactPaths,
    overlays: options.overlays,
    result: preliminaryResult,
  });
  assertExistingOverlayInputsUnchanged?.();
  const afterOverlaysFiles = createFileSnapshot(options.workspaceRoot);
  const changedPaths = diffFileSnapshots(beforeFiles, afterOverlaysFiles);
  formatGeneratedWorkspaceFiles(options.workspaceRoot, [
    ...changedPaths.createdPaths,
    ...changedPaths.rewrittenPaths,
  ]);
  if (appEmitsBrowserUi(vertical)) {
    preflight.assertInputsUnchanged();
    const capturedConfig = await captureWorkspaceRendererEvaluations(
      options.workspaceRoot,
      [vertical],
      {
        command: 'generate',
        dependencyRoots: [path.resolve(logicalWorkspaceRoot)],
      },
    );
    const selectedRenderer = vertical.renderer;
    const finalRenderer = capturedConfig.evaluations.get(vertical.id)?.renderer;
    if (finalRenderer !== selectedRenderer) {
      throw new Error(
        `Generated application ${vertical.id} uses ${selectedRenderer} templates, but its final modern.config resolves ${finalRenderer}. Changing the renderer requires matching compiler and source templates.`,
      );
    }
    const [resolvedVertical] = await reconcileWorkspaceRendererIdentities(
      options.workspaceRoot,
      scope,
      [vertical],
      { evaluations: capturedConfig.evaluations },
    );
    const version = resolvedVertical?.deliveryUnit?.version;
    if (!resolvedVertical || typeof version !== 'string') {
      throw new Error(
        `Generated application ${vertical.id} has no resolved delivery-unit version.`,
      );
    }
    assertSupportedRendererComposition(
      targetShell,
      resolveAddedVerticalComposition(
        targetShell,
        existingVerticals,
        resolvedVertical,
      ),
    );
    const finalTopology = readRequiredJsonObject(topologyPath);
    const finalEntry = finalTopology.verticals?.find(
      (entry: Record<string, any>) => entry.id === resolvedVertical.id,
    );
    if (!finalEntry) {
      throw new Error(
        `Generated application ${resolvedVertical.id} is missing from the final topology.`,
      );
    }
    stampDeliveryUnitIdentity(finalEntry, scope, resolvedVertical, version);
    const beforeIdentityApps = [
      nextPrimaryShell,
      ...updatedVerticals,
      ...nextAdditionalShells,
    ];
    const finalApps = beforeIdentityApps.map(app =>
      app.id === resolvedVertical.id ? resolvedVertical : app,
    );
    const identityProjections = createGeneratedConfigProjections({
      workspaceRoot: options.workspaceRoot,
      scope,
      beforeApps: beforeIdentityApps,
      afterApps: finalApps,
      packageSource,
      beforeTailwind: enableTailwind,
      afterTailwind: enableTailwind,
      bridge,
      finalizeIdentities: true,
    });
    const finalOverlay = projectResolvedDevelopmentOverlay(
      scope,
      readRequiredJsonObject(overlayPath),
      [resolvedVertical],
    );
    generatedProjections.push(
      ...createGeneratedConfigProjections({
        workspaceRoot: logicalWorkspaceRoot,
        scope,
        beforeApps: previousProjection(previousApps),
        afterApps: finalApps,
        packageSource,
        beforeTailwind: previousTailwind,
        afterTailwind: enableTailwind,
        bridge,
      }),
    );
    const finalTopologySource = `${JSON.stringify(finalTopology, null, 2)}\n`;
    projectGeneratedWorkspacePolicy(
      [...generatedProjections, ...identityProjections],
      finalTopologySource,
    );
    const finalSourceSnapshot = replaceRendererIdentityProjections(
      options.workspaceRoot,
      capturedConfig.sourceSnapshots[0]!,
      new Map([
        [TOPOLOGY_PATH, finalTopologySource],
        [
          DEVELOPMENT_OVERLAY_PATH,
          `${JSON.stringify(finalOverlay, null, 2)}\n`,
        ],
        [
          `${resolvedVertical.directory}/shared/ultramodern-build.json`,
          createUltramodernBuildArtifactJson(scope, resolvedVertical),
        ],
      ]),
      deferredUiArtifactPaths,
    );
    capturedConfig.assertConsumedInputsUnchanged(
      options.workspaceRoot,
      identityProjections,
    );
    preflight.assertConsumedInputsUnchanged(options.workspaceRoot);
    const assertOriginalInputsUnchanged = preflight.assertInputsUnchanged;
    const assertPublicationInputsUnchanged =
      preflight.assertPublicationInputsUnchanged;
    preflight.assertPublicationInputsUnchanged = () => {
      assertPublicationInputsUnchanged();
      preflight.assertConsumedInputsUnchanged(options.workspaceRoot);
      assertConfigSourceSnapshotUnchanged(finalSourceSnapshot);
    };
    preflight.assertInputsUnchanged = () => {
      assertOriginalInputsUnchanged();
      preflight.assertConsumedInputsUnchanged(options.workspaceRoot);
      assertConfigSourceSnapshotUnchanged(finalSourceSnapshot);
    };
    Object.assign(vertical, resolvedVertical);
    preflight.assertInputsUnchanged();
  } else {
    const authoredArtifact = readRequiredJsonObject(
      path.join(
        options.workspaceRoot,
        vertical.directory,
        'shared/ultramodern-build.json',
      ),
    );
    assertUltramodernBuildArtifact(authoredArtifact);
    if (Object.hasOwn(authoredArtifact.surfaces, 'ui'))
      throw new Error(
        `Headless application ${vertical.id} must omit its UI surface.`,
      );
    const [resolvedVertical] = await reconcileWorkspaceRendererIdentities(
      options.workspaceRoot,
      scope,
      [vertical],
      { evaluations: new Map() },
    );
    if (!resolvedVertical?.deliveryUnit?.version)
      throw new Error(
        `Headless application ${vertical.id} requires its package version.`,
      );
    const finalTopology = readRequiredJsonObject(topologyPath);
    const entry = finalTopology.verticals?.find(
      (entry: Record<string, any>) => entry.id === vertical.id,
    );
    if (!entry)
      throw new Error(
        `Headless application ${vertical.id} is missing from topology.`,
      );
    stampDeliveryUnitIdentity(
      entry,
      scope,
      resolvedVertical,
      resolvedVertical.deliveryUnit.version,
    );
    const capturedSource = captureConfigSourceSnapshot({
      sourceRoots: [options.workspaceRoot],
    });
    const finalTopologySource = `${JSON.stringify(finalTopology, null, 2)}\n`;
    projectGeneratedWorkspacePolicy(generatedProjections, finalTopologySource);
    const finalSourceSnapshot = replaceRendererIdentityProjections(
      options.workspaceRoot,
      capturedSource,
      new Map([
        [TOPOLOGY_PATH, finalTopologySource],
        [
          `${vertical.directory}/shared/ultramodern-build.json`,
          createUltramodernBuildArtifactJson(scope, resolvedVertical),
        ],
      ]),
    );
    Object.assign(vertical, resolvedVertical);
    assertRendererProjection(entry);
    const catalogs = yaml.load(
      fs.readFileSync(
        path.join(options.workspaceRoot, 'pnpm-workspace.yaml'),
        'utf8',
      ),
    ) as {
      catalog?: Record<string, string>;
      catalogs?: Record<string, Record<string, string>>;
    };
    assertRendererDependencies(
      readRequiredJsonObject(newPackagePath),
      'none',
      undefined,
      catalogs,
    );
    validateApiOnlySourceSurface(options.workspaceRoot, entry);
    const artifact = readRequiredJsonObject(
      path.join(
        options.workspaceRoot,
        vertical.directory,
        'shared/ultramodern-build.json',
      ),
    );
    assertUltramodernBuildArtifact(artifact);
    assertWorkspaceRendererArtifact(vertical, artifact);
    const assertOriginalInputsUnchanged = preflight.assertInputsUnchanged;
    const assertPublicationInputsUnchanged =
      preflight.assertPublicationInputsUnchanged;
    preflight.assertPublicationInputsUnchanged = () => {
      assertPublicationInputsUnchanged();
      preflight.assertConsumedInputsUnchanged(options.workspaceRoot);
      assertConfigSourceSnapshotUnchanged(finalSourceSnapshot);
    };
    preflight.assertInputsUnchanged = () => {
      assertOriginalInputsUnchanged();
      preflight.assertConsumedInputsUnchanged(options.workspaceRoot);
      assertConfigSourceSnapshotUnchanged(finalSourceSnapshot);
    };
    preflight.assertInputsUnchanged();
  }
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
  const updated = {
    ...current,
    ...(Array.isArray(generated.verticalRefs)
      ? { verticalRefs: generated.verticalRefs }
      : {}),
    ...(generated.moduleFederation
      ? {
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
        }
      : {}),
  };
  if (!generated.moduleFederation) delete updated.moduleFederation;
  return updated;
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
