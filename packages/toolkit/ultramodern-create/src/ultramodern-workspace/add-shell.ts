import fs from 'node:fs';
import path from 'node:path';
import {
  assertConfigSourceSnapshotUnchanged,
  captureConfigSourceSnapshot,
} from '@modern-js/ultramodern-app-tools/config-evaluator';
import { normalizeWorkspaceInputs } from '../ultramodern-tooling/config';
import {
  DEVELOPMENT_OVERLAY_PATH,
  OWNERSHIP_PATH,
  TOPOLOGY_PATH,
} from './add-vertical/constants';
import {
  assertSupportedRendererComposition,
  assertValidWorkspaceMembership,
  readRequiredJsonObject,
} from './add-vertical/preflight';
import { describeJsonChanges } from './add-vertical/preview';
import { updateRootWorkspaceScripts } from './add-vertical/shell-files';
import { ownershipEntry } from './add-vertical/topology';
import {
  recoverWorkspaceTransactions,
  runWorkspaceTransaction,
} from './add-vertical/transaction';
import {
  assertGlobalPortUniqueness,
  nextAvailablePort,
  workspaceOperationSettings,
} from './add-vertical/workspace-state';
import {
  createGeneratedConfigProjections,
  type GeneratedConfigProjection,
} from './config-generated-projections';
import { stampDeliveryUnitIdentity } from './delivery-unit-stamp';
import { appEmitsBrowserUi, resolveRemoteRefs } from './descriptors';
import { projectAddedShellDevelopmentOverlay } from './development-overlay-projection';
import {
  formatGeneratedWorkspaceFiles,
  writeFileReplacing,
  writeJsonFile,
} from './fs-io';
import {
  createFileSnapshot,
  createGenerationResult,
  diffFileSnapshots,
} from './generation-result';
import {
  createAppModernConfig,
  createUltramodernBuildArtifactJson,
} from './module-federation';
import {
  assertUniqueTailwindPrefixes,
  packageName,
  toPackageScope,
} from './naming';
import { runCodeSmithOverlays } from './overlays';
import { createCloudflareDeployContract } from './policy';
import { trackWorkspacePublicationInputs } from './publication-inputs';
import { captureWorkspaceRendererEvaluations } from './renderer-config-evaluation';
import { reconcileWorkspaceRendererIdentities } from './renderer-identity';
import {
  captureExistingWorkspaceOverlayGuard,
  replaceRendererIdentityProjections,
} from './renderer-identity-projections';
import { initializeGeneratedRendererIdentity } from './renderer-initial-identity';
import {
  appSupportsFederation,
  getRendererGenerationProfile,
  resolveWorkspaceRenderer,
} from './renderer-profile';
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
} from './workspace-artifact-ownership';
import { writeGeneratedWorkspaceScripts } from './workspace-scripts';
import { writeApp } from './write-app';
import { createZeropsYaml } from './zerops';

type AddUltramodernShellPreflight = {
  assertInputsUnchanged(): void;
  assertPublicationInputsUnchanged(): void;
  assertConsumedInputsUnchanged(
    stagedWorkspaceRoot: string,
    generatedProjections?: readonly GeneratedConfigProjection[],
  ): void;
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

async function prepareAddUltramodernShell(
  options: AddUltramodernShellOptions,
): Promise<AddUltramodernShellPreflight> {
  const sourceSnapshot = captureConfigSourceSnapshot({
    sourceRoots: [path.resolve(options.workspaceRoot)],
  });
  const name = assertValidShellName(options.name);
  const overlayPath = path.join(
    options.workspaceRoot,
    DEVELOPMENT_OVERLAY_PATH,
  );
  const topologyPath = path.join(options.workspaceRoot, TOPOLOGY_PATH);
  const ownershipPath = path.join(options.workspaceRoot, OWNERSHIP_PATH);
  const publicationInputs = trackWorkspacePublicationInputs(
    options.workspaceRoot,
    sourceSnapshot,
  );
  const readPreflightJson = (input: string) => {
    const value = readRequiredJsonObject(input);
    publicationInputs.observe(input, 'content', true);
    return value;
  };

  const rootPackage = readPreflightJson(
    path.join(options.workspaceRoot, 'package.json'),
  );
  const overlay = readPreflightJson(overlayPath);
  const topology = readPreflightJson(topologyPath);
  const ownership = readPreflightJson(ownershipPath);
  overlay.ports ??= {};

  const scope = toPackageScope(
    String(rootPackage.name ?? path.basename(options.workspaceRoot)),
  );

  const workspace = normalizeWorkspaceInputs(
    options.workspaceRoot,
    {
      topology,
      overlay,
    },
    publicationInputs.observe,
  );
  assertValidWorkspaceMembership(workspace.apps);
  const { packageSource, enableTailwind, bridge } = workspaceOperationSettings(
    options,
    workspace.config,
  );
  const shellId = `shell-${name}`;
  if (
    shellId === PRIMARY_SHELL_ID ||
    workspace.additionalShells.some(existing => existing.id === shellId)
  ) {
    throw new Error(`Shell "${shellId}" already exists in this workspace.`);
  }
  if (fs.existsSync(path.join(options.workspaceRoot, `apps/${shellId}`))) {
    throw new Error(`Refusing to overwrite existing path: apps/${shellId}`);
  }
  const configEvaluations = await captureWorkspaceRendererEvaluations(
    options.workspaceRoot,
    workspace.apps,
    { sourceRoots: [path.resolve(options.workspaceRoot)] },
  );
  const assertInputsUnchanged = () => {
    assertConfigSourceSnapshotUnchanged(sourceSnapshot);
    configEvaluations.assertUnchanged();
  };
  assertInputsUnchanged();
  const resolvedApps = await reconcileWorkspaceRendererIdentities(
    options.workspaceRoot,
    scope,
    workspace.apps,
    { evaluations: configEvaluations.evaluations },
  );
  const primaryShell = resolvedApps.find(
    app => app.id === workspace.primaryShell!.id,
  )!;
  const existingVerticals = resolvedApps.filter(app => app.kind === 'vertical');
  const existingAdditionalShells = resolvedApps.filter(
    app => app.kind === 'shell' && app.id !== primaryShell.id,
  );

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
  const renderer = resolveWorkspaceRenderer(primaryShell);
  if (renderer === 'none') {
    throw new Error(`Primary shell ${primaryShell.id} requires a UI renderer.`);
  }
  const generation = getRendererGenerationProfile(renderer);
  shell.renderer = renderer;
  shell.rendererProfile = generation.profile;
  shell.rendererGenerationProfile = generation;
  Object.assign(shell, initializeGeneratedRendererIdentity(scope, shell));

  // A shell composes only UI-emitting units by default (G2a): headless
  // api-only verticals never join composition refs.
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
    if (!appEmitsBrowserUi(vertical)) {
      throw new Error(
        `Headless unit ${vertical.id} exposes API/backend capabilities, not UI, and cannot join shell ${shellId} composition.`,
      );
    }
    return vertical;
  });
  shell.verticalRefs = composedVerticals.map(vertical => vertical.id);
  for (const existingShell of [primaryShell, ...existingAdditionalShells]) {
    assertSupportedRendererComposition(
      existingShell,
      resolveRemoteRefs(existingShell, existingVerticals),
    );
  }
  assertSupportedRendererComposition(shell, composedVerticals);

  assertUniqueTailwindPrefixes([
    primaryShell,
    ...existingAdditionalShells,
    shell,
    ...existingVerticals,
  ]);
  assertInputsUnchanged();

  return {
    assertInputsUnchanged,
    assertPublicationInputsUnchanged() {
      publicationInputs.assertUnchanged();
      configEvaluations.assertConsumedInputsUnchanged();
    },
    assertConsumedInputsUnchanged:
      configEvaluations.assertConsumedInputsUnchanged,
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

function stageAddUltramodernShellPreflight(
  preflight: AddUltramodernShellPreflight,
  stagingRoot: string,
): AddUltramodernShellPreflight {
  return {
    ...preflight,
    topologyPath: path.join(stagingRoot, TOPOLOGY_PATH),
    ownershipPath: path.join(stagingRoot, OWNERSHIP_PATH),
    overlayPath: path.join(stagingRoot, DEVELOPMENT_OVERLAY_PATH),
    topology: structuredClone(preflight.topology),
    ownership: structuredClone(preflight.ownership),
    overlay: structuredClone(preflight.overlay),
  };
}

/**
 * Add an additional thin shell to an existing workspace (G28). Transactional:
 * the whole write-set is applied inside {@link runWorkspaceTransaction}; any
 * failure restores the workspace byte-identical to its pre-call state.
 */
export async function addUltramodernShell(
  options: AddUltramodernShellOptions,
): Promise<UltramodernGenerationResult> {
  recoverWorkspaceTransactions(path.resolve(options.workspaceRoot));
  const preflight = await prepareAddUltramodernShell(options);
  let stagedPreflight: AddUltramodernShellPreflight | undefined;
  return runWorkspaceTransaction(
    options.workspaceRoot,
    stagingRoot => {
      stagedPreflight = stageAddUltramodernShellPreflight(
        preflight,
        stagingRoot,
      );
      return executeAddUltramodernShell(
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

async function executeAddUltramodernShell(
  options: AddUltramodernShellOptions,
  logicalWorkspaceRoot = options.workspaceRoot,
  prepared?: AddUltramodernShellPreflight,
): Promise<UltramodernGenerationResult> {
  const preflight = prepared ?? (await prepareAddUltramodernShell(options));
  preflight.assertInputsUnchanged();
  const beforeFiles = createFileSnapshot(options.workspaceRoot);
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
  const previousApps = [
    primaryShell,
    ...existingVerticals,
    ...existingAdditionalShells,
  ];
  const generatedProjections = createGeneratedConfigProjections({
    workspaceRoot: options.workspaceRoot,
    scope,
    beforeApps: previousApps,
    afterApps: [...previousApps, shell],
    packageSource,
    beforeTailwind: enableTailwind,
    afterTailwind: enableTailwind,
    bridge,
  });
  const assertConsumedInputsUnchanged = preflight.assertConsumedInputsUnchanged;
  preflight.assertConsumedInputsUnchanged = stagedRoot =>
    assertConsumedInputsUnchanged(stagedRoot, generatedProjections);
  const { io: ownedIo } = preserveConsumerWorkspaceArtifacts(
    options.workspaceRoot,
    workspaceArtifactCandidates(scope, previousApps, enableTailwind),
  );

  writeApp(
    options.workspaceRoot,
    scope,
    shell,
    packageSource,
    enableTailwind,
    existingVerticals,
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

  topology.shells ??= [];
  topology.shells.push({
    id: shell.id,
    kind: 'shell',
    ...(shell.surfaceProfile ? { surfaceProfile: shell.surfaceProfile } : {}),
    package: packageName(scope, shell.packageSuffix),
    path: shell.directory,
    displayName: shell.displayName,
    portEnv: shell.portEnv,
    verticalRefs: shell.verticalRefs,
    ...(appSupportsFederation(shell)
      ? {
          moduleFederation: {
            role: 'host',
            name: shell.mfName,
            verticalRefs: shell.verticalRefs,
            remotes: resolveRemoteRefs(shell, existingVerticals).map(
              remote => ({
                id: remote.id,
                name: remote.mfName,
                manifestUrl: `http://localhost:${remote.port}/mf-manifest.json`,
              }),
            ),
            ssr: true,
            sharedContractVersion: 'mf-ssr-contract-v1',
          },
        }
      : {}),
    deliveryUnit: shellDeliveryUnitBlock(scope, shell),
    ...(shell.rendererGenerationProfile?.capabilities.workers
      ? {
          cloudflare: createCloudflareDeployContract(scope, shell),
        }
      : {}),
    ownership: shell.ownership,
  });
  stampDeliveryUnitIdentity(
    topology.shells.at(-1),
    scope,
    shell,
    shell.deliveryUnit?.version ?? '0.1.0',
    'source-authoring',
  );
  writeJsonFile(topologyPath, topology as JsonValue);
  ownership.owners ??= [];
  ownership.owners.push(ownershipEntry(scope, shell));
  writeJsonFile(ownershipPath, ownership as JsonValue);
  Object.assign(
    preflight.overlay,
    projectAddedShellDevelopmentOverlay(preflight.overlay, shell),
  );
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
    primaryShell,
  );
  ownedIo.write(
    path.join(options.workspaceRoot, 'tsconfig.json'),
    `${JSON.stringify(createRootTsConfig([primaryShell, ...existingVerticals, ...allAdditionalShells]), null, 2)}\n`,
  );

  writeGeneratedWorkspaceScripts(options.workspaceRoot, {
    io: { writeGenerated: ownedIo.write },
    renderer: primaryShell.rendererGenerationProfile!.renderer,
  });

  ownedIo.write(
    path.join(options.workspaceRoot, 'zerops.yaml'),
    `${createZeropsYaml(scope, [
      primaryShell,
      ...existingVerticals,
      ...allAdditionalShells,
    ])}\n`,
  );

  const preliminaryAfterFiles = createFileSnapshot(options.workspaceRoot);
  const preliminaryDiff = diffFileSnapshots(beforeFiles, preliminaryAfterFiles);
  const preliminaryResult = createGenerationResult({
    phase: 'source-authoring',
    operation: 'shell',
    workspaceRoot: logicalWorkspaceRoot,
    packageScope: scope,
    packageSource,
    createdApps: [shell],
    createdPaths: preliminaryDiff.createdPaths,
    rewrittenPaths: preliminaryDiff.rewrittenPaths,
  });
  const assertExistingOverlayInputsUnchanged = options.overlays?.length
    ? captureExistingWorkspaceOverlayGuard(
        options.workspaceRoot,
        shell.directory,
      )
    : undefined;
  const deferredUiArtifactPaths = new Set([
    `${shell.directory}/shared/ultramodern-build.json`,
  ]);
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

  preflight.assertInputsUnchanged();
  const capturedConfig = await captureWorkspaceRendererEvaluations(
    options.workspaceRoot,
    [shell],
    {
      command: 'generate',
      dependencyRoots: [path.resolve(logicalWorkspaceRoot)],
    },
  );
  const finalRenderer = capturedConfig.evaluations.get(shell.id)?.renderer;
  if (finalRenderer !== shell.renderer) {
    throw new Error(
      `Generated application ${shell.id} uses ${shell.renderer} templates, but its final modern.config resolves ${finalRenderer}. Changing the renderer requires matching compiler and source templates.`,
    );
  }
  const [resolvedShell] = await reconcileWorkspaceRendererIdentities(
    options.workspaceRoot,
    scope,
    [shell],
    { evaluations: capturedConfig.evaluations },
  );
  const version = resolvedShell?.deliveryUnit?.version;
  if (!resolvedShell || typeof version !== 'string') {
    throw new Error(
      `Generated application ${shell.id} has no resolved delivery-unit version.`,
    );
  }
  assertSupportedRendererComposition(
    resolvedShell,
    resolveRemoteRefs(resolvedShell, existingVerticals),
  );
  const finalTopology = readRequiredJsonObject(topologyPath);
  const finalEntry = finalTopology.shells?.find(
    (entry: Record<string, any>) => entry.id === resolvedShell.id,
  );
  if (!finalEntry) {
    throw new Error(
      `Generated application ${resolvedShell.id} is missing from the final topology.`,
    );
  }
  stampDeliveryUnitIdentity(finalEntry, scope, resolvedShell, version);
  const finalSourceSnapshot = replaceRendererIdentityProjections(
    options.workspaceRoot,
    capturedConfig.sourceSnapshots[0]!,
    new Map([
      [TOPOLOGY_PATH, `${JSON.stringify(finalTopology, null, 2)}\n`],
      [
        `${resolvedShell.directory}/shared/ultramodern-build.json`,
        createUltramodernBuildArtifactJson(scope, resolvedShell),
      ],
    ]),
    deferredUiArtifactPaths,
  );
  capturedConfig.assertConsumedInputsUnchanged();
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
  Object.assign(shell, resolvedShell);
  preflight.assertInputsUnchanged();

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
export async function planUltramodernShell(
  options: AddUltramodernShellOptions,
): Promise<UltramodernVerticalPlan> {
  const originalPreflight = await prepareAddUltramodernShell(options);
  let stagedPreflight: AddUltramodernShellPreflight | undefined;
  let jsonMutations: UltramodernVerticalPlan['jsonMutations'] = [];
  const { preflight, plannedResult } = await runWorkspaceTransaction(
    options.workspaceRoot,
    async stagingRoot => {
      const stagedOptions = { ...options, workspaceRoot: stagingRoot };
      const preflight = stageAddUltramodernShellPreflight(
        originalPreflight,
        stagingRoot,
      );
      stagedPreflight = preflight;
      const plannedResult = await executeAddUltramodernShell(
        stagedOptions,
        options.workspaceRoot,
        preflight,
      );
      return { preflight, plannedResult };
    },
    {
      mode: 'preview',
      assertInputsUnchanged: () =>
        (stagedPreflight ?? originalPreflight).assertInputsUnchanged(),
      inspectChanges: changes => {
        (stagedPreflight ?? originalPreflight).assertInputsUnchanged();
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
    ...(appSupportsFederation(preflight.shell)
      ? {
          moduleFederationRemote: {
            id: shell?.id ?? '',
            name: shell?.moduleFederationName ?? '',
            manifestUrl: `http://localhost:${shell?.port ?? 0}/mf-manifest.json`,
          },
        }
      : {}),
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
