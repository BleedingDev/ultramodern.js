import path from 'node:path';

import {
  createPrimaryShellDescriptor,
  verticalsFromTopology,
} from '../../ultramodern-workspace/add-vertical/topology';

import { normalizeUltramodernBridgeConfig } from '../../ultramodern-workspace/bridge-config';
import {
  appEmitsBrowserUi,
  createNeutralOwnership,
  shellApp,
  ULTRAMODERN_CONFIG_PATH,
} from '../../ultramodern-workspace/descriptors';
import { readModuleFederationExposePaths } from '../../ultramodern-workspace/mf-validation';
import { toKebabCase } from '../../ultramodern-workspace/naming';
import { resolveConfiguredAdditionalShells } from '../../ultramodern-workspace/shells';
import type {
  ResolvedPackageSource,
  WorkspaceApp,
} from '../../ultramodern-workspace/types';
import {
  isVerticalApiProtocol,
  isVerticalPreset,
  isWorkspaceDeliveryUnitKind,
} from '../../ultramodern-workspace/types';
import { packageScopeFromRoot } from './metadata';
import type { UltramodernToolingConfig } from './types';

type UnsupportedUltramodernConfigIssue =
  | {
      field: 'schemaVersion';
      value: unknown;
      reason: 'missing' | 'non-integer' | 'unsupported';
    }
  | {
      field: 'topology.apps.kind';
      index: number;
      value: unknown;
    };

export class UnsupportedUltramodernConfigError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly issue: UnsupportedUltramodernConfigIssue,
  ) {
    const value = formatUnsupportedConfigValue(issue.value);
    const message =
      issue.field === 'schemaVersion'
        ? formatSchemaVersionError(sourcePath, issue.reason, value)
        : `Unsupported UltraModern config app kind ${value} at ${sourcePath} topology.apps[${issue.index}].kind. Supported kinds: shell, vertical.`;

    super(message);
    this.name = 'UnsupportedUltramodernConfigError';
  }
}

export function normalizeCompactConfig(
  workspaceRoot: string,
  sourcePath: string,
  config: Record<string, any>,
): UltramodernToolingConfig {
  const schemaVersion = config.schemaVersion;
  if (schemaVersion !== 1) {
    throw new UnsupportedUltramodernConfigError(sourcePath, {
      field: 'schemaVersion',
      value: schemaVersion,
      reason:
        schemaVersion === undefined
          ? 'missing'
          : Number.isInteger(schemaVersion)
            ? 'unsupported'
            : 'non-integer',
    });
  }

  return normalizeCompactConfigV1(workspaceRoot, sourcePath, config);
}

function normalizeCompactConfigV1(
  workspaceRoot: string,
  sourcePath: string,
  config: Record<string, any>,
): UltramodernToolingConfig {
  const packageSource =
    config.packageSource && typeof config.packageSource === 'object'
      ? ({
          strategy:
            config.packageSource.strategy === 'install'
              ? 'install'
              : 'workspace',
          modernPackageVersion:
            typeof config.packageSource.modernPackageVersion === 'string'
              ? config.packageSource.modernPackageVersion
              : 'workspace:*',
          registry:
            typeof config.packageSource.registry === 'string'
              ? config.packageSource.registry
              : undefined,
          aliasScope:
            typeof config.packageSource.aliasScope === 'string'
              ? config.packageSource.aliasScope
              : undefined,
          aliasPackageNamePrefix:
            typeof config.packageSource.aliasPackageNamePrefix === 'string'
              ? config.packageSource.aliasPackageNamePrefix
              : undefined,
        } satisfies ResolvedPackageSource)
      : undefined;

  return {
    schemaVersion: 1,
    profile: typeof config.profile === 'string' ? config.profile : undefined,
    source: 'compact',
    sourcePath,
    workspace: {
      packageScope:
        typeof config.workspace?.packageScope === 'string'
          ? config.workspace.packageScope
          : packageScopeFromRoot(workspaceRoot),
    },
    packageSource,
    features: {
      tailwind: config.features?.tailwind !== false,
    },
    bridge: normalizeUltramodernBridgeConfig(config.bridge as any),
    topology: {
      apps: Array.isArray(config.topology?.apps)
        ? config.topology.apps.map(
            (app: Record<string, any>, index: number) => {
              if (app.kind !== 'shell' && app.kind !== 'vertical') {
                throw new UnsupportedUltramodernConfigError(sourcePath, {
                  field: 'topology.apps.kind',
                  index,
                  value: app.kind,
                });
              }

              return {
                id: String(app.id),
                ...(app.deliveryUnit ? { deliveryUnit: app.deliveryUnit } : {}),
                kind: app.kind,
                path: typeof app.path === 'string' ? app.path : '.',
                package:
                  typeof app.package === 'string' ? app.package : undefined,
                packageSuffix:
                  typeof app.packageSuffix === 'string'
                    ? app.packageSuffix
                    : undefined,
                displayName:
                  typeof app.displayName === 'string'
                    ? app.displayName
                    : undefined,
                domain: typeof app.domain === 'string' ? app.domain : undefined,
                ...(isVerticalPreset(app.surfaceProfile)
                  ? { surfaceProfile: app.surfaceProfile }
                  : {}),
                ...(isWorkspaceDeliveryUnitKind(app.deliveryUnitKind)
                  ? { deliveryUnitKind: app.deliveryUnitKind }
                  : {}),
                port: typeof app.port === 'number' ? app.port : undefined,
                portEnv:
                  typeof app.portEnv === 'string' ? app.portEnv : undefined,
                moduleFederation:
                  app.moduleFederation &&
                  typeof app.moduleFederation === 'object'
                    ? {
                        role:
                          app.moduleFederation.role === 'remote'
                            ? 'remote'
                            : 'host',
                        name:
                          typeof app.moduleFederation.name === 'string'
                            ? app.moduleFederation.name
                            : undefined,
                        exposes: Array.isArray(app.moduleFederation.exposes)
                          ? app.moduleFederation.exposes.filter(
                              (expose: unknown): expose is string =>
                                typeof expose === 'string',
                            )
                          : undefined,
                        exposePaths:
                          app.moduleFederation.exposePaths !== null &&
                          typeof app.moduleFederation.exposePaths ===
                            'object' &&
                          !Array.isArray(app.moduleFederation.exposePaths)
                            ? Object.fromEntries(
                                Object.entries(
                                  app.moduleFederation.exposePaths,
                                ).filter(
                                  (entry): entry is [string, string] =>
                                    typeof entry[0] === 'string' &&
                                    typeof entry[1] === 'string',
                                ),
                              )
                            : undefined,
                        verticalRefs: Array.isArray(
                          app.moduleFederation.verticalRefs,
                        )
                          ? app.moduleFederation.verticalRefs.filter(
                              (ref: unknown): ref is string =>
                                typeof ref === 'string',
                            )
                          : undefined,
                        hostOnly: app.moduleFederation.hostOnly === true,
                        noExposes: app.moduleFederation.noExposes === true,
                      }
                    : undefined,
                api:
                  app.api && typeof app.api === 'object'
                    ? {
                        stem:
                          typeof app.api.stem === 'string'
                            ? app.api.stem
                            : String(app.id),
                        prefix:
                          typeof app.api.prefix === 'string'
                            ? app.api.prefix
                            : `/${String(app.id)}-api`,
                        consumedBy: Array.isArray(app.api.consumedBy)
                          ? app.api.consumedBy.filter(
                              (consumer: unknown): consumer is string =>
                                typeof consumer === 'string',
                            )
                          : [shellApp.id, String(app.id)],
                        ...(isVerticalApiProtocol(app.api.protocol)
                          ? { protocol: app.api.protocol }
                          : {}),
                      }
                    : undefined,
              };
            },
          )
        : [],
    },
    ...(Array.isArray(config.shells) && config.shells.length > 0
      ? {
          shells: config.shells.filter(
            (shell: unknown): shell is Record<string, unknown> =>
              shell !== null &&
              typeof shell === 'object' &&
              !Array.isArray(shell),
          ),
        }
      : {}),
  };
}

function formatUnsupportedConfigValue(value: unknown) {
  if (value === undefined) {
    return 'missing';
  }

  return JSON.stringify(value) ?? String(value);
}

function formatSchemaVersionError(
  sourcePath: string,
  reason: 'missing' | 'non-integer' | 'unsupported',
  value: string,
) {
  switch (reason) {
    case 'missing':
      return `UltraModern config schemaVersion is required in ${sourcePath}. Versionless v1 configs are not supported; set schemaVersion to the integer 1.`;
    case 'non-integer':
      return `Invalid UltraModern config schemaVersion ${value} in ${sourcePath}. schemaVersion must be the integer 1; versionless v1 configs are not supported.`;
    case 'unsupported':
      return `Unsupported UltraModern config schemaVersion ${value} in ${sourcePath}. Supported schema versions: 1. Versionless v1 configs are not supported.`;
  }
}

export function normalizeCompactUltramodernConfig(
  workspaceRoot: string,
  compact: Record<string, any>,
): UltramodernToolingConfig {
  return normalizeCompactConfig(
    workspaceRoot,
    path.join(workspaceRoot, ULTRAMODERN_CONFIG_PATH),
    compact,
  );
}

/**
 * `workspaceRoot` lets each vertical's federated surface paths come from the
 * Module Federation config it actually ships. Without it the surface falls back
 * to the generator's `src/components` layout.
 */
export function workspaceAppsFromToolingConfig(
  config: UltramodernToolingConfig,
  workspaceRoot?: string,
): WorkspaceApp[] {
  return config.topology.apps.map(app => {
    if (app.kind === 'shell') {
      return {
        ...shellApp,
        ...(app.deliveryUnit ? { deliveryUnit: app.deliveryUnit } : {}),
        directory: app.path,
        packageSuffix: app.packageSuffix ?? shellApp.packageSuffix,
        displayName: app.displayName ?? shellApp.displayName,
        port: app.port ?? shellApp.port,
        portEnv: app.portEnv ?? shellApp.portEnv,
        mfName: app.moduleFederation?.name ?? shellApp.mfName,
        verticalRefs: app.moduleFederation?.verticalRefs ?? [],
      };
    }

    const domain = app.domain ?? app.id;
    const packageSuffix = app.packageSuffix ?? domain;
    const exposePaths = app.moduleFederation?.exposePaths ?? {};
    // A vertical may expose its federated surface from any directory it likes;
    // its own Module Federation config is the authority on where each surface
    // lives, so consult that before assuming the generated `src/components`
    // layout. Nothing else about the surface expectation changes.
    const federatedPaths =
      workspaceRoot === undefined
        ? undefined
        : readModuleFederationExposePaths(workspaceRoot, app.path);
    const exposes = Object.fromEntries(
      (app.moduleFederation?.exposes ?? []).map(expose => {
        const configuredPath = federatedPaths?.[expose] ?? exposePaths[expose];
        const inferredPath =
          expose === './Route'
            ? './src/federation-entry.tsx'
            : expose === './Widget'
              ? `./src/components/${domain}-widget.tsx`
              : `./src/components/${toKebabCase(
                  expose.replace(/^\.\//u, ''),
                )}.tsx`;

        return [expose, configuredPath ?? inferredPath];
      }),
    );

    return {
      id: app.id,
      ...(app.deliveryUnit ? { deliveryUnit: app.deliveryUnit } : {}),
      directory: app.path,
      packageSuffix,
      displayName: app.displayName ?? `${domain} Vertical`,
      kind: 'vertical',
      domain,
      portEnv:
        app.portEnv ??
        `VERTICAL_${domain.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_PORT`,
      port: app.port ?? 0,
      mfName: app.moduleFederation?.name ?? app.id,
      exposes,
      ...(app.moduleFederation?.verticalRefs
        ? { verticalRefs: app.moduleFederation.verticalRefs }
        : {}),
      ...(app.surfaceProfile === undefined
        ? {}
        : { surfaceProfile: app.surfaceProfile }),
      ...(app.deliveryUnitKind === undefined
        ? {}
        : { deliveryUnitKind: app.deliveryUnitKind }),
      ...(app.api ? { api: app.api } : {}),
      ownership: createNeutralOwnership(app.id),
    };
  });
}

export function additionalShellsFromToolingConfig(
  config: UltramodernToolingConfig,
): WorkspaceApp[] {
  return resolveConfiguredAdditionalShells(
    config as unknown as Record<string, unknown>,
  );
}

export function allWorkspaceAppsFromToolingConfig(
  config: UltramodernToolingConfig,
  workspaceRoot?: string,
): WorkspaceApp[] {
  return [
    ...workspaceAppsFromToolingConfig(config, workspaceRoot),
    ...additionalShellsFromToolingConfig(config),
  ];
}

export type UltramodernWorkspaceInputs = {
  config: Record<string, any>;
  topology?: Record<string, any>;
  overlay?: Record<string, any>;
};

/**
 * Read projections from the existing consumer inputs without rewriting them.
 * Raw inputs retain unknown fields; normalized descriptors are not a replacement
 * for consumer-owned configuration. Additive shells retain their config ports.
 */
export function normalizeWorkspaceInputs(
  workspaceRoot: string,
  inputs: UltramodernWorkspaceInputs,
  sourcePath = path.join(workspaceRoot, ULTRAMODERN_CONFIG_PATH),
  options: { primaryComposition?: 'topology' | 'compact' } = {},
) {
  const config = normalizeCompactConfig(
    workspaceRoot,
    sourcePath,
    inputs.config,
  );
  const ports = inputs.overlay?.ports ?? {};
  const additionalShells = additionalShellsFromToolingConfig(config);
  const topologyApps = inputs.topology
    ? [
        createPrimaryShellDescriptor(inputs.topology, inputs.config),
        ...verticalsFromTopology(inputs.topology, ports),
      ]
    : workspaceAppsFromToolingConfig(config, workspaceRoot);
  if (options.primaryComposition === 'compact') {
    const primary = topologyApps.find(app => app.id === shellApp.id);
    if (primary) {
      const configured = createPrimaryShellDescriptor({}, inputs.config);
      const refs = inputs.config.topology?.apps?.find(
        (app: { id?: unknown }) => app.id === shellApp.id,
      )?.moduleFederation?.verticalRefs;
      Object.assign(primary, configured, {
        verticalRefs: Array.isArray(refs)
          ? configured.verticalRefs
          : topologyApps
              .filter(app => app.kind === 'vertical' && appEmitsBrowserUi(app))
              .map(app => app.id),
      });
    }
  }
  const apps = [
    ...topologyApps.map(app => ({
      ...app,
      port: typeof ports[app.id] === 'number' ? ports[app.id] : app.port,
    })),
    ...additionalShells,
  ];
  return {
    raw: inputs,
    config,
    apps,
    primaryShell: apps.find(app => app.id === shellApp.id),
    verticals: apps.filter(app => app.kind === 'vertical'),
    additionalShells,
  };
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
