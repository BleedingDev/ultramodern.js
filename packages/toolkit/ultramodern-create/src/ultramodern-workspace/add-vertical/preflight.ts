import fs from 'node:fs';
import path from 'node:path';
import { normalizeCompactConfig } from '../../ultramodern-tooling/config';
import type { UltramodernBridgeConfig } from '../bridge-config';
import {
  createRemoteManifestEnv,
  createVerticalDescriptor,
  shellApp,
  ULTRAMODERN_CONFIG_PATH,
} from '../descriptors';
import { readJsonFile } from '../fs-io';
import {
  assertUniqueTailwindPrefixes,
  normalizePath,
  toPackageScope,
} from '../naming';
import { resolveConfiguredAdditionalShells } from '../shells';
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
import { verticalsFromTopology } from './topology';
import {
  assertCanCreate,
  assertGlobalPortUniqueness,
  assertValidVerticalName,
  existingBridgeConfig,
  existingPackageSource,
  existingTailwindEnabled,
  nextAvailablePort,
} from './workspace-state';

export type AddUltramodernVerticalPreflight = {
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
  config: Record<string, any>;
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
 * not present in the workspace's additive config.shells collection.
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

export function prepareAddUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): AddUltramodernVerticalPreflight {
  const name = assertValidVerticalName(options.name);
  const topologyPath = path.join(options.workspaceRoot, TOPOLOGY_PATH);
  const ownershipPath = path.join(options.workspaceRoot, OWNERSHIP_PATH);
  const overlayPath = path.join(
    options.workspaceRoot,
    DEVELOPMENT_OVERLAY_PATH,
  );

  const rootPackage = readRequiredJsonObject(
    path.join(options.workspaceRoot, 'package.json'),
  );
  const topology = readRequiredJsonObject(topologyPath);
  const ownership = readRequiredJsonObject(ownershipPath);
  const overlay = readRequiredJsonObject(overlayPath);
  const config = readRequiredWorkspaceConfig(options.workspaceRoot);

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
  const additionalShells = resolveConfiguredAdditionalShells(config);
  const primaryShell = createPrimaryShellDescriptor(topology, config);
  // Prefer the LIVE overlay port for the primary shell: operators may have
  // moved it (e.g. to 3120), and the compact/default descriptor port would
  // silently reintroduce a collision window.
  const primaryShellPort =
    typeof overlay.ports[primaryShell.id] === 'number'
      ? (overlay.ports[primaryShell.id] as number)
      : primaryShell.port;
  const resolvedPrimaryShell = { ...primaryShell, port: primaryShellPort };
  const targetShell = resolveTargetShell(
    options.shell,
    resolvedPrimaryShell,
    additionalShells,
    path.join(options.workspaceRoot, ULTRAMODERN_CONFIG_PATH),
  );
  const portsWithPrimary = {
    ...overlay.ports,
    [primaryShell.id]: primaryShellPort,
  };
  assertGlobalPortUniqueness(portsWithPrimary, additionalShells);
  const port = nextAvailablePort(portsWithPrimary, additionalShells);
  const vertical = createVerticalDescriptor(name, port, {
    preset: options.preset,
    apiProtocol: options.apiProtocol,
    horizontalRemote: options.horizontalRemote,
  });
  const updatedVerticals = [...existingVerticals, vertical];
  const targetVerticals = [
    ...existingVerticals.filter(id =>
      (targetShell.verticalRefs ?? []).includes(id.id),
    ),
    vertical,
  ];
  const allApps = [
    resolvedPrimaryShell,
    ...updatedVerticals,
    ...additionalShells,
  ];

  assertCanCreate(options.workspaceRoot, vertical.directory);
  validateWorkspaceAppDescriptors(allApps);
  validateUniqueWorkspaceAppDescriptors(allApps);
  assertUniqueTailwindPrefixes(allApps);

  return {
    name,
    scope,
    topologyPath,
    ownershipPath,
    overlayPath,
    rootPackage,
    config,
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

function readRequiredWorkspaceConfig(workspaceRoot: string) {
  const compactPath = path.join(workspaceRoot, ULTRAMODERN_CONFIG_PATH);
  const config = readRequiredJsonObject(compactPath);
  normalizeCompactConfig(workspaceRoot, compactPath, config);
  return config;
}

export function createPrimaryShellDescriptor(
  topology: Record<string, any>,
  config: Record<string, any>,
): WorkspaceApp {
  const compactShell = config.topology?.apps?.find(
    (app: { id?: unknown }) => app?.id === shellApp.id,
  );
  const verticalRefs = Array.isArray(topology.shell?.verticalRefs)
    ? topology.shell.verticalRefs.filter(
        (id: unknown): id is string => typeof id === 'string',
      )
    : Array.isArray(compactShell?.moduleFederation?.verticalRefs)
      ? compactShell.moduleFederation.verticalRefs.filter(
          (id: unknown): id is string => typeof id === 'string',
        )
      : [];
  return {
    ...shellApp,
    verticalRefs,
    ...(typeof compactShell?.path === 'string'
      ? { directory: compactShell.path }
      : {}),
    ...(typeof compactShell?.port === 'number'
      ? { port: compactShell.port }
      : {}),
    ...(typeof compactShell?.portEnv === 'string'
      ? { portEnv: compactShell.portEnv }
      : {}),
    ...(typeof compactShell?.moduleFederation?.name === 'string'
      ? { mfName: compactShell.moduleFederation.name }
      : {}),
  };
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
