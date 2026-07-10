import path from 'node:path';

import { normalizeUltramodernBridgeConfig } from '../../ultramodern-workspace/bridge-config';
import {
  createNeutralOwnership,
  shellApp,
  ULTRAMODERN_CONFIG_PATH,
} from '../../ultramodern-workspace/descriptors';
import { toKebabCase } from '../../ultramodern-workspace/naming';
import type {
  ResolvedPackageSource,
  WorkspaceApp,
} from '../../ultramodern-workspace/types';
import { packageScopeFromRoot } from './metadata';
import type { UltramodernToolingConfig } from './types';

type UnsupportedUltramodernConfigIssue =
  | {
      field: 'schemaVersion';
      value: unknown;
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
        ? `Unsupported UltraModern config schemaVersion ${value} in ${sourcePath}. Supported schema versions: 1.`
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
  switch (config.schemaVersion) {
    case 1:
      return normalizeCompactConfigV1(workspaceRoot, sourcePath, config);
    default:
      throw new UnsupportedUltramodernConfigError(sourcePath, {
        field: 'schemaVersion',
        value: config.schemaVersion,
      });
  }
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
                      }
                    : undefined,
              };
            },
          )
        : [],
    },
  };
}

function formatUnsupportedConfigValue(value: unknown) {
  if (value === undefined) {
    return 'missing';
  }

  return JSON.stringify(value) ?? String(value);
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

export function workspaceAppsFromToolingConfig(
  config: UltramodernToolingConfig,
): WorkspaceApp[] {
  return config.topology.apps.map(app => {
    if (app.kind === 'shell') {
      return {
        ...shellApp,
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
    const exposes = Object.fromEntries(
      (app.moduleFederation?.exposes ?? []).map(expose => {
        const configuredPath = exposePaths[expose];
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
      ...(app.api ? { api: app.api } : {}),
      ownership: createNeutralOwnership(app.id),
    };
  });
}
