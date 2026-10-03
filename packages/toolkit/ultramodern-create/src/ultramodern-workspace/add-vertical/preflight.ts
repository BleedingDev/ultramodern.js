import fs from 'node:fs';
import path from 'node:path';
import {
  assertConfigSourceSnapshotUnchanged,
  captureConfigSourceSnapshot,
} from '@modern-js/ultramodern-app-tools/config-evaluator';
import { normalizeWorkspaceInputs } from '../../ultramodern-tooling/config';
import type { UltramodernBridgeConfig } from '../bridge-config';
import type { GeneratedConfigProjection } from '../config-generated-projections';
import {
  appEmitsBrowserUi,
  createRemoteManifestEnv,
  createVerticalDescriptor,
  resolveRemoteRefs,
} from '../descriptors';
import { readJsonFile } from '../fs-io';
import {
  assertUniqueTailwindPrefixes,
  normalizePath,
  toPackageScope,
} from '../naming';
import { trackWorkspacePublicationInputs } from '../publication-inputs';
import { captureWorkspaceRendererEvaluations } from '../renderer-config-evaluation';
import { reconcileWorkspaceRendererIdentities } from '../renderer-identity';
import { initializeGeneratedRendererIdentity } from '../renderer-initial-identity';
import {
  appSupportsFederation,
  getRendererGenerationProfile,
  resolveWorkspaceRenderer,
} from '../renderer-profile';
import type {
  AddUltramodernVerticalOptions,
  JsonValue,
  ResolvedPackageSource,
  WorkspaceApp,
} from '../types';
import { isRecord } from '../types';
import {
  DEVELOPMENT_OVERLAY_PATH,
  OWNERSHIP_PATH,
  TOPOLOGY_PATH,
} from './constants';
import {
  assertCanCreate,
  assertGlobalPortUniqueness,
  assertValidVerticalName,
  nextAvailablePort,
  workspaceOperationSettings,
} from './workspace-state';

export type AddUltramodernVerticalPreflight = {
  assertInputsUnchanged(): void;
  assertPublicationInputsUnchanged(): void;
  assertConsumedInputsUnchanged(
    stagedWorkspaceRoot: string,
    generatedProjections?: readonly GeneratedConfigProjection[],
  ): void;
  name: string;
  scope: string;
  topologyPath: string;
  ownershipPath: string;
  overlayPath: string;
  rootPackage: Record<string, any>;
  topology: Record<string, any>;
  ownership: Record<string, any>;
  overlay: Record<string, any>;
  packageSource: ResolvedPackageSource;
  enableTailwind: boolean;
  bridge?: UltramodernBridgeConfig;
  config: ReturnType<typeof normalizeWorkspaceInputs>['config'];
  primaryShell: WorkspaceApp;
  additionalShells: WorkspaceApp[];
  targetShell: WorkspaceApp;
  targetVerticals: WorkspaceApp[];
  vertical: WorkspaceApp;
  updatedVerticals: WorkspaceApp[];
};

export type UnknownUltramodernShellIssue = {
  field: 'shell';
  value: string;
  reason: 'unknown';
  available: string[];
};

/**
 * Typed preflight rejection for an add-vertical request whose shell target is
 * not present in the workspace topology's shells collection.
 */
export class UnknownUltramodernShellError extends Error {
  readonly code = 'ULTRAMODERN_UNKNOWN_TARGET_SHELL';
  readonly issue: UnknownUltramodernShellIssue;

  constructor(
    readonly sourcePath: string,
    requestedShellId: string,
    available: string[],
  ) {
    const issue: UnknownUltramodernShellIssue = {
      field: 'shell',
      value: requestedShellId,
      reason: 'unknown',
      available,
    };
    super(
      `Unknown target shell "${requestedShellId}" in ${sourcePath}. Available shells: ${available.join(', ') || 'none'}.`,
    );
    this.name = 'UnknownUltramodernShellError';
    this.issue = issue;
  }
}

export function resolveAddedVerticalComposition(
  targetShell: WorkspaceApp,
  existingVerticals: WorkspaceApp[],
  vertical: WorkspaceApp,
): WorkspaceApp[] {
  return [
    ...resolveRemoteRefs(
      {
        ...targetShell,
        verticalRefs: targetShell.verticalRefs?.filter(
          id => id !== vertical.id,
        ),
      },
      existingVerticals,
    ),
    vertical,
  ];
}

export async function prepareAddUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): Promise<AddUltramodernVerticalPreflight> {
  const sourceSnapshot = captureConfigSourceSnapshot({
    sourceRoots: [path.resolve(options.workspaceRoot)],
  });
  const name = assertValidVerticalName(options.name);
  const topologyPath = path.join(options.workspaceRoot, TOPOLOGY_PATH);
  const ownershipPath = path.join(options.workspaceRoot, OWNERSHIP_PATH);
  const overlayPath = path.join(
    options.workspaceRoot,
    DEVELOPMENT_OVERLAY_PATH,
  );

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
  const topology = readPreflightJson(topologyPath);
  const ownership = readPreflightJson(ownershipPath);
  const overlay = readPreflightJson(overlayPath);

  assertOptionalJsonObject(topology.shell, 'topology.shell', topologyPath);
  assertOptionalJsonArray(
    topology.verticals,
    'topology.verticals',
    topologyPath,
  );
  assertOptionalJsonArray(ownership.owners, 'ownership.owners', ownershipPath);
  assertOptionalJsonObject(overlay.ports, 'overlay.ports', overlayPath);
  assertOptionalJsonObject(overlay.manifests, 'overlay.manifests', overlayPath);
  assertOptionalJsonObject(overlay.apis, 'overlay.apis', overlayPath);

  const workspace = normalizeWorkspaceInputs(
    options.workspaceRoot,
    {
      topology,
      overlay,
    },
    publicationInputs.observe,
  );
  assertValidWorkspaceMembership(workspace.apps);
  assertGlobalPortUniqueness(
    {
      ...overlay.ports,
      [workspace.primaryShell!.id]: workspace.primaryShell!.port,
    },
    workspace.additionalShells,
  );
  const { packageSource, enableTailwind, bridge } = workspaceOperationSettings(
    options,
    workspace.config,
  );

  overlay.ports ??= {};
  const scope = toPackageScope(
    String(rootPackage.name ?? path.basename(options.workspaceRoot)),
  );
  const targetShellId = resolveTargetShell(
    options.shell,
    workspace.primaryShell!,
    workspace.additionalShells,
    topologyPath,
  ).id;

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
  const existingVerticals = resolvedApps.filter(app => app.kind === 'vertical');
  const additionalShells = resolvedApps.filter(
    app => app.kind === 'shell' && app.id !== workspace.primaryShell!.id,
  );
  // Supplying topology always resolves the primary shell, including defaults.
  const resolvedPrimaryShell = resolvedApps.find(
    app => app.id === workspace.primaryShell!.id,
  )!;
  const targetShell = resolvedApps.find(app => app.id === targetShellId)!;
  const portsWithPrimary = {
    ...overlay.ports,
    [resolvedPrimaryShell.id]: resolvedPrimaryShell.port,
  };
  assertGlobalPortUniqueness(portsWithPrimary, additionalShells);
  const port = nextAvailablePort(portsWithPrimary, additionalShells);
  const renderer = resolveWorkspaceRenderer(targetShell);
  const vertical = createVerticalDescriptor(name, port, {
    preset: options.preset,
    apiProtocol: options.apiProtocol,
    horizontalRemote: options.horizontalRemote,
    ...(renderer !== 'none' ? { renderer } : {}),
  });
  if (appEmitsBrowserUi(vertical)) {
    if (renderer === 'none') {
      throw new Error(`Target shell ${targetShell.id} requires a UI renderer.`);
    }
    const generation = getRendererGenerationProfile(renderer);
    vertical.renderer = renderer;
    vertical.rendererProfile = generation.profile;
    vertical.rendererGenerationProfile = generation;
  } else {
    vertical.renderer = 'none';
  }
  Object.assign(vertical, initializeGeneratedRendererIdentity(scope, vertical));
  const updatedVerticals = [...existingVerticals, vertical];
  const targetVerticals = resolveAddedVerticalComposition(
    targetShell,
    existingVerticals,
    vertical,
  );
  const allApps = [
    resolvedPrimaryShell,
    ...updatedVerticals,
    ...additionalShells,
  ];

  assertCanCreate(options.workspaceRoot, vertical.directory);
  for (const shell of [resolvedPrimaryShell, ...additionalShells]) {
    assertSupportedRendererComposition(
      shell,
      shell.id === targetShell.id
        ? targetVerticals
        : resolveRemoteRefs(shell, existingVerticals),
    );
  }
  assertValidWorkspaceMembership(allApps);
  assertInputsUnchanged();

  return {
    assertInputsUnchanged,
    assertPublicationInputsUnchanged() {
      publicationInputs.assertUnchanged();
      configEvaluations.assertConsumedInputsUnchanged();
    },
    assertConsumedInputsUnchanged:
      configEvaluations.assertConsumedInputsUnchanged,
    name,
    scope,
    topologyPath,
    ownershipPath,
    overlayPath,
    rootPackage,
    config: workspace.config,
    topology,
    ownership,
    overlay,
    packageSource,
    enableTailwind,
    bridge,
    primaryShell: resolvedPrimaryShell,
    additionalShells,
    targetShell,
    targetVerticals,
    vertical,
    updatedVerticals,
  };
}

/** Keep source evaluation guards while directing all mutable output to stage. */
export function stageAddUltramodernVerticalPreflight(
  preflight: AddUltramodernVerticalPreflight,
  stagingRoot: string,
): AddUltramodernVerticalPreflight {
  return {
    ...preflight,
    topologyPath: path.join(stagingRoot, TOPOLOGY_PATH),
    ownershipPath: path.join(stagingRoot, OWNERSHIP_PATH),
    overlayPath: path.join(stagingRoot, DEVELOPMENT_OVERLAY_PATH),
    rootPackage: structuredClone(preflight.rootPackage),
    topology: structuredClone(preflight.topology),
    ownership: structuredClone(preflight.ownership),
    overlay: structuredClone(preflight.overlay),
  };
}

/** Validate paths and membership before resolving any application config. */
export function assertValidWorkspaceMembership(apps: WorkspaceApp[]): void {
  validateWorkspaceAppDescriptors(apps);
  validateUniqueWorkspaceAppDescriptors(apps);
  assertUniqueTailwindPrefixes(apps);
}

/** Composition must use selected adapters with matching renderer identities. */
export function assertSupportedRendererComposition(
  shell: WorkspaceApp,
  verticals: readonly WorkspaceApp[],
): void {
  for (const vertical of verticals) {
    if (
      !appEmitsBrowserUi(vertical) &&
      shell.verticalRefs?.includes(vertical.id)
    ) {
      throw new Error(
        `Headless unit ${vertical.id} exposes API/backend capabilities, not UI, and cannot join shell ${shell.id} composition.`,
      );
    }
  }
  const uiVerticals = verticals.filter(appEmitsBrowserUi);
  if (uiVerticals.length === 0) return;
  const renderer = resolveWorkspaceRenderer(shell);
  for (const vertical of uiVerticals) {
    const remoteRenderer = resolveWorkspaceRenderer(vertical);
    if (remoteRenderer !== renderer) {
      throw new Error(
        `Unsupported renderer composition: shell ${shell.id} uses ${renderer}, but vertical ${vertical.id} uses ${remoteRenderer}. Cross-renderer UI composition is not supported.`,
      );
    }
  }
  if (
    !appSupportsFederation(shell) ||
    uiVerticals.some(app => !appSupportsFederation(app))
  ) {
    throw new Error(
      `Unsupported renderer capability: ${renderer} Module Federation UI composition is not certified for shell ${shell.id}.`,
    );
  }
}

export function readRequiredJsonObject(filePath: string): Record<string, any> {
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

function resolveTargetShell(
  requestedShellId: string | undefined,
  primaryShell: WorkspaceApp,
  additionalShells: WorkspaceApp[],
  sourcePath: string,
): WorkspaceApp {
  if (requestedShellId === undefined || requestedShellId === primaryShell.id) {
    return primaryShell;
  }
  const targetShell = additionalShells.find(
    shell => shell.id === requestedShellId,
  );
  if (!targetShell) {
    const available = [primaryShell, ...additionalShells].map(
      shell => shell.id,
    );
    throw new UnknownUltramodernShellError(
      sourcePath,
      requestedShellId,
      available,
    );
  }
  return targetShell;
}

function assertOptionalJsonObject(
  value: JsonValue | undefined,
  label: string,
  filePath: string,
) {
  if (value !== undefined && !isRecord(value)) {
    throw new Error(`${label} in ${filePath} must be a JSON object`);
  }
}

function assertOptionalJsonArray(
  value: JsonValue | undefined,
  label: string,
  filePath: string,
) {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`${label} in ${filePath} must be a JSON array`);
  }
}

function validateWorkspaceAppDescriptors(apps: WorkspaceApp[]) {
  for (const app of apps) {
    const appLabel =
      typeof app.id === 'string' && app.id ? app.id : '<unknown>';
    assertNonEmptyString(app.id, `app id for ${appLabel}`);
    assertNonEmptyString(app.directory, `directory for ${appLabel}`);
    assertSafeOutputPath(app.directory, appLabel);
    assertNonEmptyString(app.packageSuffix, `package suffix for ${appLabel}`);
    assertNonEmptyString(app.displayName, `display name for ${appLabel}`);
    if (app.kind !== 'shell' && app.kind !== 'vertical') {
      throw new Error(`Invalid app kind for ${appLabel}: ${String(app.kind)}`);
    }
    assertNonEmptyString(app.portEnv, `port env for ${appLabel}`);
    if (
      typeof app.port !== 'number' ||
      !Number.isFinite(app.port) ||
      app.port <= 0
    ) {
      throw new Error(`Invalid development port for ${appLabel}`);
    }
    assertNonEmptyString(app.mfName, `Module Federation name for ${appLabel}`);
    if (app.api) {
      assertNonEmptyString(app.api.prefix, `API prefix for ${appLabel}`);
      if (!app.api.prefix.startsWith('/')) {
        throw new Error(`API prefix for ${appLabel} must start with "/"`);
      }
    }
  }
}

function validateUniqueWorkspaceAppDescriptors(apps: WorkspaceApp[]) {
  assertUniqueAppField(apps, 'app id', app => app.id);
  assertUniqueAppField(apps, 'package suffix', app => app.packageSuffix);
  assertUniqueAppField(apps, 'output path', app =>
    normalizePath(app.directory),
  );
  assertUniqueAppField(apps, 'Module Federation name', app => app.mfName);
  assertUniqueAppField(apps, 'development port', app => String(app.port));
  assertUniqueAppField(apps, 'API prefix', app => app.api?.prefix);
  assertUniqueAppField(apps, 'manifest environment name', app =>
    app.kind === 'vertical' ? createRemoteManifestEnv(app) : undefined,
  );
}

function assertUniqueAppField(
  apps: WorkspaceApp[],
  label: string,
  readValue: (app: WorkspaceApp) => string | undefined,
) {
  const seen = new Map<string, string>();

  for (const app of apps) {
    const value = readValue(app);
    if (!value) {
      continue;
    }

    const previousId = seen.get(value);
    if (previousId) {
      throw new Error(
        `Duplicate ${label} "${value}" for ${previousId} and ${app.id}`,
      );
    }
    seen.set(value, app.id);
  }
}

export function assertNonEmptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertSafeOutputPath(relativePath: string, appId: string) {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/u).includes('..')
  ) {
    throw new Error(`Unsafe output path for ${appId}: ${relativePath}`);
  }
}
