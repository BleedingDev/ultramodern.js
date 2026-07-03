import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeUltramodernBridgeConfig,
  type UltramodernBridgeConfig,
} from '../ultramodern-workspace/bridge-config';
import {
  createNeutralOwnership,
  shellApp,
  ULTRAMODERN_CONFIG_PATH,
} from '../ultramodern-workspace/descriptors';
import { toKebabCase } from '../ultramodern-workspace/naming';
import type {
  ResolvedPackageSource,
  WorkspaceApi,
  WorkspaceApp,
} from '../ultramodern-workspace/types';

const LEGACY_GENERATED_CONTRACT_PATH =
  '.modernjs/ultramodern-generated-contract.json';
const LEGACY_PACKAGE_SOURCE_METADATA_PATH =
  '.modernjs/ultramodern-package-source.json';
const LEGACY_DEVELOPMENT_OVERLAY_PATH =
  'topology/local-overlays/development.json';

export type UltramodernToolingConfigSource = 'compact';

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
  api?: WorkspaceApi;
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
  const metadataPath = path.join(
    workspaceRoot,
    LEGACY_PACKAGE_SOURCE_METADATA_PATH,
  );
  if (!fs.existsSync(metadataPath)) {
    return undefined;
  }

  const metadata = readJsonObject(metadataPath);
  const aliases = metadata.modernPackages?.aliases ?? {};
  // Pick package + alias from the SAME entry so the derived prefix cannot
  // mix two different alias mappings.
  const firstAliasEntry = Object.entries(aliases).find(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  const firstPackage = firstAliasEntry?.[0];
  const firstAlias = firstAliasEntry?.[1];
  const aliasScope = firstAlias?.match(/^@([^/]+)\//u)?.[1];
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
  const overlayPath = path.join(workspaceRoot, LEGACY_DEVELOPMENT_OVERLAY_PATH);
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
      : undefined;

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
          }))
        : [],
    },
  };
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

export function synthesizeCompactUltramodernConfig(workspaceRoot: string):
  | {
      compact: Record<string, any>;
      missing: string[];
      sources: string[];
    }
  | undefined {
  const contractPath = path.join(workspaceRoot, LEGACY_GENERATED_CONTRACT_PATH);
  if (!fs.existsSync(contractPath)) {
    return undefined;
  }

  const contract = readJsonObject(contractPath);
  const sources: string[] = [LEGACY_GENERATED_CONTRACT_PATH];
  const missing: string[] = [];

  const packageSource = packageSourceFromMetadata(workspaceRoot);
  if (packageSource) {
    sources.push(LEGACY_PACKAGE_SOURCE_METADATA_PATH);
  } else {
    missing.push(LEGACY_PACKAGE_SOURCE_METADATA_PATH);
  }

  const ports = readOverlayPorts(workspaceRoot);
  if (
    fs.existsSync(path.join(workspaceRoot, LEGACY_DEVELOPMENT_OVERLAY_PATH))
  ) {
    sources.push(LEGACY_DEVELOPMENT_OVERLAY_PATH);
  } else {
    missing.push(LEGACY_DEVELOPMENT_OVERLAY_PATH);
  }

  const apps = Array.isArray(contract.apps) ? contract.apps : [];
  const shell = apps.find(
    (app: Record<string, any>) => app?.id === shellApp.id,
  );

  const compact: Record<string, any> = {
    schemaVersion:
      typeof contract.schemaVersion === 'number' ? contract.schemaVersion : 1,
    ...(typeof contract.profile === 'string'
      ? { profile: contract.profile }
      : {}),
    workspace: {
      packageScope: packageScopeFromRoot(workspaceRoot),
    },
    ...(packageSource
      ? {
          packageSource: {
            strategy: packageSource.strategy,
            modernPackageVersion: packageSource.modernPackageVersion,
            ...(packageSource.registry
              ? { registry: packageSource.registry }
              : {}),
            ...(packageSource.aliasScope
              ? { aliasScope: packageSource.aliasScope }
              : {}),
            ...(packageSource.aliasPackageNamePrefix
              ? { aliasPackageNamePrefix: packageSource.aliasPackageNamePrefix }
              : {}),
          },
        }
      : {}),
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

        const moduleFederation =
          app.moduleFederation && typeof app.moduleFederation === 'object'
            ? {
                role: app.kind === 'vertical' ? 'remote' : 'host',
                ...(typeof app.moduleFederation.name === 'string'
                  ? { name: app.moduleFederation.name }
                  : {}),
                ...(Array.isArray(app.moduleFederation.exposes)
                  ? {
                      exposes: app.moduleFederation.exposes.filter(
                        (expose: unknown): expose is string =>
                          typeof expose === 'string',
                      ),
                    }
                  : {}),
                ...(Array.isArray(app.moduleFederation.verticalRefs)
                  ? {
                      verticalRefs: app.moduleFederation.verticalRefs.filter(
                        (ref: unknown): ref is string =>
                          typeof ref === 'string',
                      ),
                    }
                  : {}),
              }
            : undefined;

        const api =
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
            : undefined;

        return {
          id,
          kind: app.kind === 'vertical' ? 'vertical' : 'shell',
          path: appPath,
          ...(typeof app.package === 'string' ? { package: app.package } : {}),
          packageSuffix:
            typeof app.package === 'string'
              ? app.package.split('/').at(-1)
              : appPath.split('/').at(-1),
          ...(id === shellApp.id ? { displayName: shellApp.displayName } : {}),
          ...(domain ? { domain } : {}),
          ...(typeof ports[id] === 'number' ? { port: ports[id] } : {}),
          ...(moduleFederation ? { moduleFederation } : {}),
          ...(api ? { api } : {}),
        };
      }),
    },
  };

  return { compact, missing, sources };
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

  if (fs.existsSync(path.join(workspaceRoot, LEGACY_GENERATED_CONTRACT_PATH))) {
    throw new Error(
      `Missing ${ULTRAMODERN_CONFIG_PATH}. Legacy UltraModern metadata detected — run \`modern-js-create ultramodern migrate-strict-effect\` to synthesize it.`,
    );
  }

  throw new Error(
    `Missing UltraModern config. Expected ${ULTRAMODERN_CONFIG_PATH}. Run \`modern-js-create ultramodern migrate-strict-effect\` if you have legacy UltraModern metadata to migrate.`,
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
