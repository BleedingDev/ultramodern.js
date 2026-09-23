import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveUltramodernSourceRevision } from '@modern-js/app-tools-extensions/release-identity';
import {
  BACKEND_FEDERATION_MANIFEST_FILE as BACKEND_MANIFEST_FILE,
  BACKEND_FEDERATION_REMOTE_ENTRY_FILE as BACKEND_REMOTE_ENTRY_FILE,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitContractBlock,
  type DeliveryUnitRecord,
  deliveryUnitContractBlock,
  isUltramodernBuildArtifact,
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
  type UltramodernBuildArtifact,
  validateDeliveryUnitRecord,
  validateUltramodernBuildArtifact,
} from '@modern-js/backend-federation-contracts';

export const REFERENCE_TOPOLOGY_PATH = 'topology/reference-topology.json';
export const DEVELOPMENT_OVERLAY_PATH =
  'topology/local-overlays/development.json';

export type TopologyApp = {
  id?: unknown;
  domain?: unknown;
  kind?: unknown;
  path?: unknown;
  package?: unknown;
  portEnv?: unknown;
  cloudflare?: { publicUrlEnv?: unknown };
  api?: {
    bff?: { prefix?: unknown };
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
};

export type DevelopmentOverlay = {
  ports?: Record<string, unknown>;
  manifests?: Record<string, unknown>;
  serverExecution?: Record<
    string,
    {
      node?: {
        remoteName?: unknown;
        manifestUrl?: unknown;
        containerEntry?: unknown;
        remoteType?: unknown;
      };
    }
  >;
};

export type ReferenceTopology = {
  shell?: TopologyApp;
  shells?: TopologyApp[];
  verticals?: TopologyApp[];
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
  topologyDeliveryUnit?: {
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
    if (!isUltramodernBuildArtifact(artifact)) {
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

  throw new Error(
    `[backend-federation-build] Missing delivery-unit build artifact at ${buildArtifactPath}.`,
  );
};

const toPascalCase = (value: string) =>
  value
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const createBackendName = (app: TopologyApp, id: string) => {
  const configuredName =
    stringValue(app.backendFederation?.name) ??
    stringValue(app.backendFederation?.executionSurfaces?.node?.remoteName);

  if (configuredName) {
    return configuredName;
  }

  const mfName = stringValue(app.moduleFederation?.name);
  return mfName ? `${mfName}Backend` : `vertical${toPascalCase(id)}Backend`;
};

const rebaseDefaultLocalUrl = (
  value: string,
  defaultPort: number,
  publicOrigin: string,
) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== 'localhost' ||
    Number(url.port) !== defaultPort ||
    url.username ||
    url.password
  ) {
    return value;
  }
  return `${publicOrigin}${url.pathname}${url.search}${url.hash}`;
};

export const findWorkspaceRoot = (appDirectory: string) => {
  let current = appDirectory;

  while (true) {
    if (existsSync(path.join(current, REFERENCE_TOPOLOGY_PATH))) {
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
  return resolveUltramodernSourceRevision(workspaceRoot);
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

export const createAppFromTopology = (
  workspaceRoot: string,
  appDirectory: string,
  topologyApp: TopologyApp,
  overlay: DevelopmentOverlay,
  packageManifest: { name?: unknown; version?: unknown },
): BackendFederationApp | undefined => {
  const id = stringValue(topologyApp.id);
  const appPath = stringValue(topologyApp.path);

  if (
    !id ||
    !appPath ||
    topologyApp.kind !== 'vertical' ||
    !isRecord(topologyApp.api) ||
    !isRecord(topologyApp.backendFederation)
  ) {
    return undefined;
  }

  const directory = normalizeRelativePath(appPath);
  if (path.resolve(workspaceRoot, directory) !== path.resolve(appDirectory)) {
    return undefined;
  }

  const defaultPort = overlay.ports?.[id];
  if (
    typeof defaultPort !== 'number' ||
    !Number.isInteger(defaultPort) ||
    defaultPort < 1 ||
    defaultPort > 65535
  ) {
    throw new Error(
      `[backend-federation-build] Invalid development port for ${id}.`,
    );
  }
  const portEnv =
    stringValue(topologyApp.portEnv) ??
    `VERTICAL_${(stringValue(topologyApp.domain) ?? id)
      .replace(/[^a-zA-Z0-9]/gu, '_')
      .toUpperCase()}_PORT`;
  const port = Number(process.env[portEnv] ?? defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `[backend-federation-build] Invalid ${portEnv} development port for ${id}.`,
    );
  }
  const publicUrlEnv = stringValue(topologyApp.cloudflare?.publicUrlEnv);
  const configuredPublicUrl = publicUrlEnv
    ? process.env[publicUrlEnv]?.trim()
    : undefined;
  let publicOrigin = `http://localhost:${port}`;
  if (configuredPublicUrl) {
    let url: URL;
    try {
      url = new URL(configuredPublicUrl);
    } catch {
      throw new Error(
        `[backend-federation-build] Invalid ${publicUrlEnv} public URL for ${id}.`,
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        `[backend-federation-build] Invalid ${publicUrlEnv} public URL for ${id}.`,
      );
    }
    publicOrigin = url.origin;
  }

  const apiPrefix = stringValue(topologyApp.api.bff?.prefix) ?? `/${id}-api`;
  const apiStem = stringValue(topologyApp.api.stem) ?? id;
  const backendName = createBackendName(topologyApp, id);
  const nodeOverlay = overlay.serverExecution?.[id]?.node;
  if (!isRecord(nodeOverlay)) {
    throw new Error(
      `[backend-federation-build] Missing declared Node server execution for ${id}.`,
    );
  }
  const manifestUrl = rebaseDefaultLocalUrl(
    stringValue(nodeOverlay?.manifestUrl) ??
      `http://localhost:${defaultPort}/${BACKEND_MANIFEST_FILE}`,
    defaultPort,
    publicOrigin,
  );
  const containerEntry = rebaseDefaultLocalUrl(
    stringValue(nodeOverlay?.containerEntry) ??
      `http://localhost:${defaultPort}/${BACKEND_REMOTE_ENTRY_FILE}`,
    defaultPort,
    publicOrigin,
  );
  const configuredRemoteType =
    stringValue(nodeOverlay?.remoteType) ??
    stringValue(
      topologyApp.backendFederation?.executionSurfaces?.node?.remoteType,
    );
  if (
    configuredRemoteType !== undefined &&
    configuredRemoteType !== 'commonjs-module'
  ) {
    throw new Error(
      `[backend-federation-build] Node backend federation remoteType must be "commonjs-module"; received "${configuredRemoteType}" for ${id}.`,
    );
  }
  if (
    !new URL(containerEntry).pathname.endsWith(`/${BACKEND_REMOTE_ENTRY_FILE}`)
  ) {
    throw new Error(
      `[backend-federation-build] Node backend federation containerEntry must end with "/${BACKEND_REMOTE_ENTRY_FILE}"; received "${containerEntry}" for ${id}.`,
    );
  }
  const remoteType = 'commonjs-module';
  const packageName = stringValue(packageManifest.name);
  const version = stringValue(packageManifest.version);
  if (stringValue(topologyApp.package) !== packageName || !version) {
    throw new Error(
      `[backend-federation-build] Topology package identity must match package.json for ${id}.`,
    );
  }
  const declaredUiManifestUrl = stringValue(overlay.manifests?.[id]);
  const uiManifestUrl = declaredUiManifestUrl
    ? rebaseDefaultLocalUrl(declaredUiManifestUrl, defaultPort, publicOrigin)
    : undefined;
  const topologyDeliveryUnit = isRecord(topologyApp.deliveryUnit)
    ? {
        unitId: stringValue(topologyApp.deliveryUnit.unitId),
        buildMarker: stringValue(topologyApp.deliveryUnit.buildMarker),
        sourceRevision: stringValue(topologyApp.deliveryUnit.sourceRevision),
        packageName: stringValue(topologyApp.deliveryUnit.packageName),
        version: stringValue(topologyApp.deliveryUnit.version),
      }
    : undefined;

  return {
    id,
    directory,
    packageName,
    version,
    port,
    apiPrefix,
    apiStem,
    backendName,
    manifestUrl,
    containerEntry,
    remoteType,
    uiManifestUrl,
    topologyDeliveryUnit,
  };
};

export const findBackendFederationApp = async (
  workspaceRoot: string,
  appDirectory: string,
) => {
  const topologyPath = path.join(workspaceRoot, REFERENCE_TOPOLOGY_PATH);
  const topology = await readJsonFile<ReferenceTopology>(topologyPath);
  if (!isRecord(topology) || !Array.isArray(topology.verticals)) {
    throw new Error(
      `[backend-federation-build] Invalid declared topology at ${topologyPath}.`,
    );
  }
  const overlayPath = path.join(workspaceRoot, DEVELOPMENT_OVERLAY_PATH);
  const overlay = await readJsonFile<DevelopmentOverlay>(overlayPath);
  if (!isRecord(overlay) || !isRecord(overlay.ports)) {
    throw new Error(
      `[backend-federation-build] Invalid development overlay at ${overlayPath}.`,
    );
  }
  const packageManifest = await readJsonFile<{
    name?: unknown;
    version?: unknown;
  }>(path.join(appDirectory, 'package.json'));

  for (const app of topology.verticals) {
    const resolved = createAppFromTopology(
      workspaceRoot,
      appDirectory,
      app,
      overlay,
      packageManifest,
    );
    if (resolved) {
      return resolved;
    }
  }

  throw new Error(
    `[backend-federation-build] ${appDirectory} is missing from the declared reference topology.`,
  );
};
