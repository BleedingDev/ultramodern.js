import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeUltramodernBridgeConfig,
  type UltramodernBridgeConfig,
} from '../ultramodern-workspace/bridge-config';
import {
  createNeutralOwnership,
  GENERATED_CONTRACT_PATH,
  shellApp,
  ULTRAMODERN_CONFIG_PATH,
} from '../ultramodern-workspace/descriptors';
import { toKebabCase } from '../ultramodern-workspace/naming';
import type {
  ResolvedPackageSource,
  WorkspaceApp,
  WorkspaceEffectApi,
} from '../ultramodern-workspace/types';

const PACKAGE_SOURCE_METADATA_PATH =
  '.modernjs/ultramodern-package-source.json';
const DEVELOPMENT_OVERLAY_PATH = 'topology/local-overlays/development.json';

export type UltramodernToolingConfigSource = 'compact' | 'legacy';

export type UltramodernToolingConfigApp = {
  id: string;
  kind: WorkspaceApp['kind'];
  path: string;
  package?: string;
  packageSuffix?: string;
  displayName?: string;
  domain?: string;
  port?: number;
  portEnv?: string;
  moduleFederation?: {
    role?: 'host' | 'remote';
    name?: string;
    exposes?: string[];
    exposePaths?: Record<string, string>;
    verticalRefs?: string[];
    hostOnly?: boolean;
    noExposes?: boolean;
  };
  effectApi?: WorkspaceEffectApi;
};

export type UltramodernToolingConfig = {
  schemaVersion: number;
  profile?: string;
  source: UltramodernToolingConfigSource;
  sourcePath: string;
  workspace: {
    packageScope: string;
  };
  packageSource?: ResolvedPackageSource;
  features: {
    tailwind: boolean;
  };
  bridge?: UltramodernBridgeConfig;
  topology: {
    apps: UltramodernToolingConfigApp[];
  };
  legacyContract?: Record<string, any>;
};

function readJsonObject(filePath: string): Record<string, any> {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `UltraModern config must contain a JSON object: ${filePath}`,
    );
  }
  return value;
}

function readOptionalJsonObject(filePath: string): Record<string, any> {
  return fs.existsSync(filePath) ? readJsonObject(filePath) : {};
}

function packageScopeFromRoot(workspaceRoot: string): string {
  const rootPackage = readOptionalJsonObject(
    path.join(workspaceRoot, 'package.json'),
  );
  return typeof rootPackage.name === 'string' && rootPackage.name.length > 0
    ? rootPackage.name
    : path.basename(workspaceRoot);
}

function packageSourceFromMetadata(
  workspaceRoot: string,
): ResolvedPackageSource | undefined {
  const metadataPath = path.join(workspaceRoot, PACKAGE_SOURCE_METADATA_PATH);
  if (!fs.existsSync(metadataPath)) {
    return undefined;
  }

  const metadata = readJsonObject(metadataPath);
  const aliases = metadata.modernPackages?.aliases ?? {};
  const firstAlias = Object.values(aliases).find(
    (value): value is string => typeof value === 'string',
  );
  const firstPackage = Object.keys(aliases)[0];
  const aliasScope = firstAlias?.match(/^@([^/]+)\//)?.[1];
  const unscopedName = firstPackage?.split('/').at(-1) ?? '';
  const aliasUnscopedName = firstAlias?.split('/').at(-1) ?? '';
  const aliasPackageNamePrefix =
    aliasUnscopedName &&
    unscopedName &&
    aliasUnscopedName.endsWith(unscopedName)
      ? aliasUnscopedName.slice(0, -unscopedName.length)
      : undefined;

  return {
    strategy: metadata.strategy === 'install' ? 'install' : 'workspace',
    modernPackageVersion:
      typeof metadata.modernPackages?.specifier === 'string'
        ? metadata.modernPackages.specifier
        : 'workspace:*',
    registry:
      typeof metadata.modernPackages?.registry === 'string'
        ? metadata.modernPackages.registry
        : undefined,
    aliasScope,
    aliasPackageNamePrefix,
  };
}

function readOverlayPorts(workspaceRoot: string): Record<string, number> {
  const overlayPath = path.join(workspaceRoot, DEVELOPMENT_OVERLAY_PATH);
  if (!fs.existsSync(overlayPath)) {
    return {};
  }

  const overlay = readJsonObject(overlayPath);
  const ports = overlay.ports;
  if (ports === null || typeof ports !== 'object' || Array.isArray(ports)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(ports).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
}

function normalizeCompactConfig(
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
      : packageSourceFromMetadata(workspaceRoot);

  return {
    schemaVersion:
      typeof config.schemaVersion === 'number' ? config.schemaVersion : 1,
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
        ? config.topology.apps.map((app: Record<string, any>) => ({
            id: String(app.id),
            kind: app.kind === 'vertical' ? 'vertical' : 'shell',
            path: typeof app.path === 'string' ? app.path : '.',
            package: typeof app.package === 'string' ? app.package : undefined,
            packageSuffix:
              typeof app.packageSuffix === 'string'
                ? app.packageSuffix
                : undefined,
            displayName:
              typeof app.displayName === 'string' ? app.displayName : undefined,
            domain: typeof app.domain === 'string' ? app.domain : undefined,
            port: typeof app.port === 'number' ? app.port : undefined,
            portEnv: typeof app.portEnv === 'string' ? app.portEnv : undefined,
            moduleFederation:
              app.moduleFederation && typeof app.moduleFederation === 'object'
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
                      typeof app.moduleFederation.exposePaths === 'object' &&
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
            effectApi:
              app.effectApi && typeof app.effectApi === 'object'
                ? {
                    stem:
                      typeof app.effectApi.stem === 'string'
                        ? app.effectApi.stem
                        : String(app.id),
                    prefix:
                      typeof app.effectApi.prefix === 'string'
                        ? app.effectApi.prefix
                        : `/${String(app.id)}-api`,
                    consumedBy: Array.isArray(app.effectApi.consumedBy)
                      ? app.effectApi.consumedBy.filter(
                          (consumer: unknown): consumer is string =>
                            typeof consumer === 'string',
                        )
                      : [shellApp.id, String(app.id)],
                  }
                : undefined,
          }))
        : [],
    },
  };
}

function adaptLegacyContract(
  workspaceRoot: string,
  sourcePath: string,
  contract: Record<string, any>,
): UltramodernToolingConfig {
  const ports = readOverlayPorts(workspaceRoot);
  const apps = Array.isArray(contract.apps) ? contract.apps : [];
  const shell = apps.find(
    (app: Record<string, any>) => app?.id === shellApp.id,
  );

  return {
    schemaVersion:
      typeof contract.schemaVersion === 'number' ? contract.schemaVersion : 1,
    profile:
      typeof contract.profile === 'string' ? contract.profile : undefined,
    source: 'legacy',
    sourcePath,
    workspace: {
      packageScope: packageScopeFromRoot(workspaceRoot),
    },
    packageSource: packageSourceFromMetadata(workspaceRoot),
    features: {
      tailwind: shell?.styling?.tailwind !== false,
    },
    topology: {
      apps: apps.map((app: Record<string, any>) => {
        const id = String(app.id);
        const appPath =
          typeof app.path === 'string'
            ? app.path
            : id === shellApp.id
              ? shellApp.directory
              : `verticals/${toKebabCase(id)}`;
        const domain =
          typeof app.i18n?.namespace === 'string' &&
          app.i18n.namespace !== 'shell'
            ? app.i18n.namespace
            : appPath.split('/').at(-1);

        return {
          id,
          kind: app.kind === 'vertical' ? 'vertical' : 'shell',
          path: appPath,
          package: typeof app.package === 'string' ? app.package : undefined,
          packageSuffix:
            typeof app.package === 'string'
              ? app.package.split('/').at(-1)
              : appPath.split('/').at(-1),
          displayName: id === shellApp.id ? shellApp.displayName : undefined,
          domain,
          port: ports[id],
          moduleFederation:
            app.moduleFederation && typeof app.moduleFederation === 'object'
              ? {
                  role: app.kind === 'vertical' ? 'remote' : 'host',
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
                  verticalRefs: Array.isArray(app.moduleFederation.verticalRefs)
                    ? app.moduleFederation.verticalRefs.filter(
                        (ref: unknown): ref is string =>
                          typeof ref === 'string',
                      )
                    : undefined,
                  hostOnly: app.kind !== 'vertical',
                }
              : undefined,
          effectApi:
            app.effect && typeof app.effect === 'object'
              ? {
                  stem:
                    typeof app.effect.prefix === 'string'
                      ? (app.effect.prefix.split('/').filter(Boolean).at(-1) ??
                        domain ??
                        id)
                      : (domain ?? id),
                  prefix:
                    typeof app.effect.prefix === 'string'
                      ? app.effect.prefix
                      : `/${domain ?? id}-api`,
                  consumedBy: [shellApp.id, id],
                }
              : undefined,
        };
      }),
    },
    legacyContract: contract,
  };
}

export function readUltramodernConfig(
  workspaceRoot = process.cwd(),
): UltramodernToolingConfig {
  const compactPath = path.join(workspaceRoot, ULTRAMODERN_CONFIG_PATH);
  if (fs.existsSync(compactPath)) {
    return normalizeCompactConfig(
      workspaceRoot,
      compactPath,
      readJsonObject(compactPath),
    );
  }

  const legacyPath = path.join(workspaceRoot, GENERATED_CONTRACT_PATH);
  if (fs.existsSync(legacyPath)) {
    return adaptLegacyContract(
      workspaceRoot,
      legacyPath,
      readJsonObject(legacyPath),
    );
  }

  throw new Error(
    `Missing UltraModern config. Expected ${ULTRAMODERN_CONFIG_PATH} or ${GENERATED_CONTRACT_PATH}.`,
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
      ...(app.effectApi ? { effectApi: app.effectApi } : {}),
      ownership: createNeutralOwnership(app.id),
    };
  });
}
