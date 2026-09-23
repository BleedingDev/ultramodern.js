import fs from 'node:fs';
import path from 'node:path';
import { verticalsFromTopology } from '../../ultramodern-workspace/add-vertical/topology';
import {
  createNeutralOwnership,
  shellApp,
} from '../../ultramodern-workspace/descriptors';
import { readModuleFederationExposePaths } from '../../ultramodern-workspace/mf-validation';
import { toEnvSegment } from '../../ultramodern-workspace/naming';
import type { WorkspaceApp } from '../../ultramodern-workspace/types';
import { readJsonObject } from './json';
import { packageScopeFromRoot, readWorkspacePackageSource } from './metadata';
import type { UltramodernToolingConfig } from './types';

export type UltramodernWorkspaceInputs = {
  topology: Record<string, any>;
  overlay: Record<string, any>;
};

/** Resolve declarative application membership without executing application code. */
export function normalizeWorkspaceInputs(
  workspaceRoot: string,
  inputs: UltramodernWorkspaceInputs,
) {
  const { topology, overlay } = inputs;
  if (
    topology.schemaVersion !== 1 ||
    !topology.shell ||
    !Array.isArray(topology.verticals) ||
    (topology.shells !== undefined && !Array.isArray(topology.shells))
  ) {
    throw new Error(
      'Invalid topology/reference-topology.json: expected schemaVersion 1, shell, verticals and optional shells.',
    );
  }
  if (
    overlay.schemaVersion !== 1 ||
    !overlay.ports ||
    typeof overlay.ports !== 'object'
  ) {
    throw new Error(
      'Invalid development overlay: expected schemaVersion 1 and ports.',
    );
  }
  const records = [
    topology.shell,
    ...topology.verticals,
    ...(topology.shells ?? []),
  ];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const ports = new Map<number, string>();
  const root = fs.realpathSync(workspaceRoot);
  const manifests = new Map<string, Record<string, any>>();
  const apps: WorkspaceApp[] = records.map((entry, index) => {
    if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id))
      throw new Error(`Missing or duplicate topology app id: ${entry.id}.`);
    ids.add(entry.id);
    if (
      typeof entry.path !== 'string' ||
      !entry.path ||
      path.isAbsolute(entry.path)
    )
      throw new Error(`Topology ${entry.id} requires a relative path.`);
    const appRoot = fs.realpathSync(path.resolve(root, entry.path));
    const relative = path.relative(root, appRoot);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      paths.has(appRoot)
    ) {
      throw new Error(
        `Topology ${entry.id} has an unsafe or duplicate path: ${entry.path}.`,
      );
    }
    paths.add(appRoot);
    const manifest = readJsonObject(path.join(appRoot, 'package.json'));
    if (
      typeof manifest.name !== 'string' ||
      !manifest.name ||
      (entry.package !== undefined && manifest.name !== entry.package)
    ) {
      throw new Error(
        `Topology ${entry.id} package identity disagrees with ${entry.path}/package.json.`,
      );
    }
    manifests.set(entry.id, manifest);
    const port = overlay.ports[entry.id];
    if (!Number.isInteger(port) || port < 1 || port > 65535 || ports.has(port))
      throw new Error(
        `Invalid or duplicate development port for ${entry.id}: ${port}.`,
      );
    ports.set(port, entry.id);
    const isShell = index === 0 || index > topology.verticals.length;
    if (entry.kind !== (isShell ? 'shell' : 'vertical'))
      throw new Error(`Invalid topology app kind for ${entry.id}.`);
    const packageSuffix = manifest.name.split('/').at(-1)!;
    if (isShell) {
      return {
        ...shellApp,
        id: entry.id,
        directory: entry.path,
        packageSuffix,
        displayName: entry.displayName ?? entry.id,
        port,
        portEnv:
          entry.portEnv ??
          (entry.id === shellApp.id
            ? shellApp.portEnv
            : `SHELL_${toEnvSegment(entry.id.replace(/^shell-/u, ''))}_PORT`),
        mfName: entry.moduleFederation?.name ?? entry.id,
        verticalRefs:
          entry.verticalRefs ?? entry.moduleFederation?.verticalRefs ?? [],
        ...(entry.deliveryUnit ? { deliveryUnit: entry.deliveryUnit } : {}),
        ownership:
          entry.ownership ?? createNeutralOwnership(entry.id, 'tier-0-shell'),
      };
    }
    const [app] = verticalsFromTopology({ verticals: [entry] }, overlay.ports);
    const actualExposes = readModuleFederationExposePaths(
      workspaceRoot,
      entry.path,
    );
    return {
      ...app,
      packageSuffix,
      ...(actualExposes ? { exposes: actualExposes } : {}),
    };
  });
  const knownPackages = new Set([
    ...[...manifests.values()].map(manifest => manifest.name),
    ...(topology.sharedPackages ?? []).map(
      (entry: Record<string, any>) => entry.package,
    ),
  ]);
  const primaryManifest = manifests.get(apps[0].id)!;
  const inheritedWorkspaceDependencies = Object.fromEntries(
    Object.entries(primaryManifest.dependencies ?? {}).filter(
      ([name, value]) =>
        typeof value === 'string' &&
        value.startsWith('workspace:') &&
        !name.startsWith('@modern-js/') &&
        !knownPackages.has(name),
    ),
  ) as Record<string, string>;
  const config: UltramodernToolingConfig = {
    workspace: { packageScope: packageScopeFromRoot(workspaceRoot) },
    packageSource: readWorkspacePackageSource(workspaceRoot),
    features: {
      tailwind: Boolean(
        primaryManifest.devDependencies?.tailwindcss ??
          primaryManifest.dependencies?.tailwindcss,
      ),
    },
    inheritedWorkspaceDependencies,
    topology: {
      apps: apps.map(app => ({
        id: app.id,
        kind: app.kind,
        path: app.directory,
        package: manifests.get(app.id)!.name,
        packageSuffix: app.packageSuffix,
        displayName: app.displayName,
        domain: app.domain,
        port: app.port,
        portEnv: app.portEnv,
        surfaceProfile: app.surfaceProfile,
        deliveryUnitKind: app.deliveryUnitKind,
        deliveryUnit: app.deliveryUnit,
        moduleFederation: {
          role: app.kind === 'shell' ? 'host' : 'remote',
          name: app.mfName,
          exposes: Object.keys(app.exposes ?? {}),
          exposePaths: app.exposes,
          verticalRefs: app.verticalRefs,
        },
        api: app.api,
      })),
    },
  };
  return {
    raw: inputs,
    config,
    apps,
    primaryShell: apps[0],
    verticals: apps.filter(app => app.kind === 'vertical'),
    additionalShells: apps.filter(
      (app, index) => index > 0 && app.kind === 'shell',
    ),
  };
}

export function workspaceAppsFromToolingConfig(
  config: UltramodernToolingConfig,
  _workspaceRoot?: string,
): WorkspaceApp[] {
  return config.topology.apps.map(app => ({
    id: app.id,
    kind: app.kind,
    directory: app.path,
    packageSuffix: app.packageSuffix ?? app.id,
    displayName: app.displayName ?? app.id,
    port: app.port!,
    portEnv: app.portEnv!,
    mfName: app.moduleFederation?.name ?? app.id,
    domain: app.domain,
    surfaceProfile: app.surfaceProfile,
    deliveryUnitKind: app.deliveryUnitKind,
    deliveryUnit: app.deliveryUnit,
    exposes: app.moduleFederation?.exposePaths,
    verticalRefs: app.moduleFederation?.verticalRefs,
    api: app.api,
    ownership: createNeutralOwnership(app.id),
  }));
}

export function allWorkspaceAppsFromToolingConfig(
  config: UltramodernToolingConfig,
  workspaceRoot?: string,
) {
  return workspaceAppsFromToolingConfig(config, workspaceRoot);
}

/** Refresh only exact former generated URLs; authored overlay choices survive. */
export function reconcileGeneratedOverlayUrls(
  existing: Record<string, any>,
  previous: Record<string, any>,
  projected: Record<string, any>,
) {
  return Object.fromEntries(
    ['manifests', 'apis'].map(key => {
      const authored = { ...existing[key] };
      for (const [id, value] of Object.entries(authored)) {
        if (value === previous[key]?.[id]) delete authored[id];
      }
      return [key, { ...projected[key], ...authored }];
    }),
  );
}

// Projection keys remain framework-owned; fields outside that projection are
// carried through at every nesting level, including app/remote records by id.
export function preserveUnknownProjectionFields(
  current: any,
  projected: any,
): any {
  if (Array.isArray(projected)) {
    return projected.map(entry => {
      const previous =
        entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        Array.isArray(current)
          ? current.find(candidate => candidate?.id === entry.id)
          : undefined;
      return preserveUnknownProjectionFields(previous, entry);
    });
  }
  if (!projected || typeof projected !== 'object') return projected;
  const previous =
    current && typeof current === 'object' && !Array.isArray(current)
      ? current
      : {};
  return {
    ...previous,
    ...Object.fromEntries(
      Object.entries(projected).map(([key, value]) => [
        key,
        preserveUnknownProjectionFields(previous[key], value),
      ]),
    ),
  };
}
