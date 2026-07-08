import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BACKEND_FEDERATION_MANIFEST_FILE as BACKEND_MANIFEST_FILE,
  BACKEND_FEDERATION_REMOTE_ENTRY_FILE as BACKEND_REMOTE_ENTRY_FILE,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitContractBlock,
  type DeliveryUnitRecord,
  deliveryUnitContractBlock,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
  ULTRAMODERN_BUILD_MODULE_PATH,
  type UltramodernBuildArtifact,
  validateDeliveryUnitRecord,
  validateUltramodernBuildArtifact,
} from '@modern-js/utils/universal';

export const COMPACT_CONFIG_PATH = '.modernjs/ultramodern.json';
const execFileAsync = promisify(execFile);

export type CompactApp = {
  id?: unknown;
  kind?: unknown;
  path?: unknown;
  package?: unknown;
  port?: unknown;
  api?: {
    prefix?: unknown;
    stem?: unknown;
  };
  moduleFederation?: {
    name?: unknown;
    manifestUrl?: unknown;
  };
  backendFederation?: {
    name?: unknown;
    versionBoundary?: {
      ui?: {
        manifestUrl?: unknown;
      };
    };
    executionSurfaces?: {
      node?: {
        remoteName?: unknown;
        manifestUrl?: unknown;
        containerEntry?: unknown;
        remoteType?: unknown;
      };
    };
  };
  deliveryUnit?: {
    unitId?: unknown;
    buildMarker?: unknown;
    sourceRevision?: unknown;
    packageName?: unknown;
    version?: unknown;
  };
  serverExecution?: {
    node?: {
      remoteName?: unknown;
      manifestUrl?: unknown;
      containerEntry?: unknown;
      remoteType?: unknown;
    };
  };
};

export type CompactConfig = {
  topology?: {
    apps?: CompactApp[];
  };
};

export type BackendFederationApp = {
  id: string;
  directory: string;
  packageName?: string;
  version?: string;
  buildVersion?: string;
  unitId?: string;
  sourceRevision?: string;
  deliveryUnit?: DeliveryUnitContractBlock;
  port: number;
  apiPrefix: string;
  apiStem: string;
  backendName: string;
  manifestUrl: string;
  containerEntry: string;
  remoteType: string;
  uiManifestUrl?: string;
  compactDeliveryUnit?: {
    unitId?: string;
    buildMarker?: string;
    sourceRevision?: string;
    packageName?: string;
    version?: string;
  };
};

export type BackendFederationBuildIdentity = {
  appId?: string;
  packageName?: string;
  version?: string;
  buildVersion?: string;
  unitId?: string;
  sourceRevision?: string;
  artifact?: UltramodernBuildArtifact;
};

export const normalizeRelativePath = (value: string) =>
  value.replace(/\\/gu, '/').replace(/^\.\/+/u, '');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readJsonFile = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await fs.readFile(filePath, 'utf8')) as T;

export const buildArtifactPathFor = (appDirectory: string) =>
  path.join(appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH);

export const buildModulePathFor = (appDirectory: string) =>
  path.join(appDirectory, ULTRAMODERN_BUILD_MODULE_PATH);

export const readBuildIdentity = async (
  appDirectory: string,
): Promise<BackendFederationBuildIdentity> => {
  const buildArtifactPath = buildArtifactPathFor(appDirectory);
  if (existsSync(buildArtifactPath)) {
    const artifact = await readJsonFile<unknown>(buildArtifactPath);
    const artifactValidation = validateUltramodernBuildArtifact(
      artifact,
      buildArtifactPath,
    );
    if (!artifactValidation.ok) {
      throw new Error(
        `[backend-federation-build] Invalid delivery-unit build artifact at ${buildArtifactPath}.`,
      );
    }

    const deliveryUnit = artifact.deliveryUnit;
    return {
      artifact,
      appId: deliveryUnit.appId,
      buildVersion: deliveryUnit.buildMarker,
      packageName: deliveryUnit.packageName,
      version: deliveryUnit.version,
      unitId: deliveryUnit.unitId,
      sourceRevision: deliveryUnit.sourceRevision,
    };
  }

  const buildModulePath = buildModulePathFor(appDirectory);
  if (!existsSync(buildModulePath)) {
    return {};
  }

  console.warn(
    `[backend-federation-build] ${buildArtifactPath} missing; falling back to legacy regex parsing of ${buildModulePath}. Regenerate the workspace to emit ${ULTRAMODERN_BUILD_ARTIFACT_FILE}.`,
  );

  const source = await fs.readFile(buildModulePath, 'utf8');
  return {
    appId: source.match(/\bappId:\s*['"]([^'"]+)['"]/u)?.[1],
    buildVersion: source.match(/\bbuild:\s*['"]([^'"]+)['"]/u)?.[1],
    packageName: source.match(/\bpackageName:\s*['"]([^'"]+)['"]/u)?.[1],
    version: source.match(/\bversion:\s*['"]([^'"]+)['"]/u)?.[1],
    unitId: source.match(/\bunitId:\s*['"]([^'"]+)['"]/u)?.[1],
    sourceRevision: source.match(/\bsourceRevision:\s*['"]([^'"]+)['"]/u)?.[1],
  };
};

const toPascalCase = (value: string) =>
  value
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const createBackendName = (app: CompactApp, id: string) => {
  const configuredName =
    stringValue(app.backendFederation?.name) ??
    stringValue(app.backendFederation?.executionSurfaces?.node?.remoteName) ??
    stringValue(app.serverExecution?.node?.remoteName);

  if (configuredName) {
    return configuredName;
  }

  const mfName = stringValue(app.moduleFederation?.name);
  return mfName ? `${mfName}Backend` : `vertical${toPascalCase(id)}Backend`;
};

export const findWorkspaceRoot = (appDirectory: string) => {
  let current = appDirectory;

  while (true) {
    if (existsSync(path.join(current, COMPACT_CONFIG_PATH))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};

export const resolveWorkspaceSourceRevision = async (workspaceRoot: string) => {
  const envRevision = process.env.ULTRAMODERN_SOURCE_REVISION?.trim();
  if (envRevision) {
    return envRevision;
  }

  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      workspaceRoot,
      'rev-parse',
      'HEAD',
    ]);
    const revision = stdout.trim();
    if (revision.length > 0) {
      return revision;
    }
  } catch {
    // Fall through to the deterministic workspace marker below.
  }

  console.warn(
    '[backend-federation-build] Could not resolve git source revision; stamping sourceRevision as "workspace". Set ULTRAMODERN_SOURCE_REVISION to override.',
  );
  return 'workspace';
};

export const createStampedDeliveryUnit = (input: {
  appId: string;
  unitId?: string;
  buildMarker?: string;
  packageName?: string;
  version?: string;
  sourceRevision: string;
}): DeliveryUnitContractBlock | undefined => {
  if (
    !input.unitId ||
    !input.buildMarker ||
    !input.packageName ||
    !input.version
  ) {
    return undefined;
  }

  const record = {
    schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
    kind: DELIVERY_UNIT_KIND,
    appId: input.appId,
    unitId: input.unitId,
    packageName: input.packageName,
    version: input.version,
    buildMarker: input.buildMarker,
    sourceRevision: input.sourceRevision,
    deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
  };
  const validation = validateDeliveryUnitRecord(record);

  if (!validation.ok) {
    return undefined;
  }

  return deliveryUnitContractBlock(record as DeliveryUnitRecord);
};

export const createAppFromCompactMetadata = (
  workspaceRoot: string,
  appDirectory: string,
  compactApp: CompactApp,
): BackendFederationApp | undefined => {
  const id = stringValue(compactApp.id);
  const appPath = stringValue(compactApp.path);

  if (!id || compactApp.kind !== 'vertical' || !isRecord(compactApp.api)) {
    return undefined;
  }

  const directory = appPath
    ? normalizeRelativePath(appPath)
    : `verticals/${id}`;
  if (path.resolve(workspaceRoot, directory) !== path.resolve(appDirectory)) {
    return undefined;
  }

  const port =
    typeof compactApp.port === 'number' ? compactApp.port : undefined;
  if (port === undefined) {
    return undefined;
  }

  const apiPrefix = stringValue(compactApp.api.prefix) ?? `/${id}-api`;
  const apiStem = stringValue(compactApp.api.stem) ?? id;
  const backendName = createBackendName(compactApp, id);
  const manifestUrl =
    stringValue(
      compactApp.backendFederation?.executionSurfaces?.node?.manifestUrl,
    ) ??
    stringValue(compactApp.serverExecution?.node?.manifestUrl) ??
    `http://localhost:${port}/${BACKEND_MANIFEST_FILE}`;
  const containerEntry =
    stringValue(
      compactApp.backendFederation?.executionSurfaces?.node?.containerEntry,
    ) ??
    stringValue(compactApp.serverExecution?.node?.containerEntry) ??
    `http://localhost:${port}/${BACKEND_REMOTE_ENTRY_FILE}`;
  const remoteType =
    stringValue(
      compactApp.backendFederation?.executionSurfaces?.node?.remoteType,
    ) ??
    stringValue(compactApp.serverExecution?.node?.remoteType) ??
    'module';
  const packageName = stringValue(compactApp.package);
  const uiManifestUrl =
    stringValue(
      compactApp.backendFederation?.versionBoundary?.ui?.manifestUrl,
    ) ?? stringValue(compactApp.moduleFederation?.manifestUrl);
  const compactDeliveryUnit = isRecord(compactApp.deliveryUnit)
    ? {
        unitId: stringValue(compactApp.deliveryUnit.unitId),
        buildMarker: stringValue(compactApp.deliveryUnit.buildMarker),
        sourceRevision: stringValue(compactApp.deliveryUnit.sourceRevision),
        packageName: stringValue(compactApp.deliveryUnit.packageName),
        version: stringValue(compactApp.deliveryUnit.version),
      }
    : undefined;

  return {
    id,
    directory,
    packageName,
    port,
    apiPrefix,
    apiStem,
    backendName,
    manifestUrl,
    containerEntry,
    remoteType,
    uiManifestUrl,
    compactDeliveryUnit,
  };
};

export const findBackendFederationApp = async (
  workspaceRoot: string,
  appDirectory: string,
) => {
  const compactConfigPath = path.join(workspaceRoot, COMPACT_CONFIG_PATH);
  const compactConfig = await readJsonFile<CompactConfig>(compactConfigPath);
  const apps = Array.isArray(compactConfig.topology?.apps)
    ? compactConfig.topology.apps
    : [];

  for (const app of apps) {
    const resolved = createAppFromCompactMetadata(
      workspaceRoot,
      appDirectory,
      app,
    );
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
};
