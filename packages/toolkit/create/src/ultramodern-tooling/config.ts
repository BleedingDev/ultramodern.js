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
  WorkspaceApp,
  WorkspaceEffectApi,
} from '../ultramodern-workspace/types';

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

function normalizeCompactConfig(
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

export function readUltramodernConfig(
  workspaceRoot = process.cwd(),
): UltramodernToolingConfig {
  const compactPath = path.join(workspaceRoot, ULTRAMODERN_CONFIG_PATH);
  if (fs.existsSync(compactPath)) {
    return normalizeCompactConfig(compactPath, readJsonObject(compactPath));
  }

  throw new Error(
    `Missing UltraModern config. Expected ${ULTRAMODERN_CONFIG_PATH}.`,
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
