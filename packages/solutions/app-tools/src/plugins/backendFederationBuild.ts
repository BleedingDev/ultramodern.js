import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BACKEND_FEDERATION_EFFECT_EXPOSE as BACKEND_EXPOSE,
  BACKEND_FEDERATION_MANIFEST_FILE as BACKEND_MANIFEST_FILE,
  BACKEND_FEDERATION_REMOTE_ENTRY_FILE as BACKEND_REMOTE_ENTRY_FILE,
  BACKEND_FEDERATION_CONTRACT_VERSION as CONTRACT_VERSION,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitContractBlock,
  deliveryUnitContractBlock,
  isUltramodernBuildArtifact,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION as NODE_ADAPTER_VERSION,
  stampUltramodernBuildArtifactSourceRevision,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
  ULTRAMODERN_BUILD_MODULE_PATH,
  type UltramodernBuildArtifact,
} from '@modern-js/utils/universal';
import type { AppTools, CliPlugin } from '../types';

const COMPACT_CONFIG_PATH = '.modernjs/ultramodern.json';
const execFileAsync = promisify(execFile);

type CompactApp = {
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

type CompactConfig = {
  topology?: {
    apps?: CompactApp[];
  };
};

type BackendFederationApp = {
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

type BackendFederationBuildIdentity = {
  packageName?: string;
  version?: string;
  buildVersion?: string;
  unitId?: string;
  sourceRevision?: string;
  artifact?: UltramodernBuildArtifact;
};

export type BackendFederationArtifactResult = {
  appId: string;
  manifestPath: string;
  containerPath: string;
  deliveryUnitArtifactPath?: string;
  remoteName: string;
  remoteType: string;
};

const normalizeRelativePath = (value: string) =>
  value.replace(/\\/gu, '/').replace(/^\.\/+/u, '');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readJsonFile = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await fs.readFile(filePath, 'utf8')) as T;

const buildArtifactPathFor = (appDirectory: string) =>
  path.join(appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH);

const buildModulePathFor = (appDirectory: string) =>
  path.join(appDirectory, ULTRAMODERN_BUILD_MODULE_PATH);

const readBuildIdentity = async (
  appDirectory: string,
): Promise<BackendFederationBuildIdentity> => {
  const buildArtifactPath = buildArtifactPathFor(appDirectory);
  if (existsSync(buildArtifactPath)) {
    const artifact = await readJsonFile<unknown>(buildArtifactPath);
    if (!isUltramodernBuildArtifact(artifact)) {
      throw new Error(
        `[backend-federation-build] Invalid delivery-unit build artifact at ${buildArtifactPath}.`,
      );
    }

    const deliveryUnit = artifact.deliveryUnit;
    return {
      artifact,
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

const findWorkspaceRoot = (appDirectory: string) => {
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

const resolveWorkspaceSourceRevision = async (workspaceRoot: string) => {
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
    // Fall through to explicit environment override below.
  }

  const envRevision = process.env.ULTRAMODERN_SOURCE_REVISION?.trim();
  if (envRevision) {
    return envRevision;
  }

  console.warn(
    '[backend-federation-build] Could not resolve git source revision; stamping sourceRevision as "workspace". Set ULTRAMODERN_SOURCE_REVISION to override.',
  );
  return 'workspace';
};

const createStampedDeliveryUnit = (input: {
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

  return deliveryUnitContractBlock({
    schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
    kind: DELIVERY_UNIT_KIND,
    appId: input.appId,
    unitId: input.unitId,
    packageName: input.packageName,
    version: input.version,
    buildMarker: input.buildMarker,
    sourceRevision: input.sourceRevision,
    deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
  });
};

const createAppFromCompactMetadata = (
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

const findBackendFederationApp = async (
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

const createRelativeImportSpecifier = (
  fromDirectory: string,
  toFile: string,
) => {
  const relativePath = normalizeRelativePath(
    path.relative(fromDirectory, toFile),
  );
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
};

const createBackendRemoteEntrySource = (
  workspaceRoot: string,
  app: BackendFederationApp,
  effectApiPath: string,
  entryPath: string,
) => {
  const effectApiSpecifier = createRelativeImportSpecifier(
    path.dirname(entryPath),
    effectApiPath,
  );

  return `// Generated by Modern.js backend federation build.
const exposedModules = {
  ${JSON.stringify(BACKEND_EXPOSE)}: () =>
    import(new URL(${JSON.stringify(effectApiSpecifier)}, import.meta.url).href),
};

export const __modernjsBackendFederation = ${JSON.stringify(
    {
      buildVersion: app.buildVersion,
      expose: BACKEND_EXPOSE,
      name: app.backendName,
      packageName: app.packageName,
      remoteType: app.remoteType,
      source: normalizeRelativePath(
        path.relative(workspaceRoot, effectApiPath),
      ),
      version: app.version,
      ...(app.unitId ? { unitId: app.unitId } : {}),
      ...(app.sourceRevision ? { sourceRevision: app.sourceRevision } : {}),
    },
    null,
    2,
  )};

export function init() {}

export function get(id) {
  const load = exposedModules[id];
  if (!load) {
    throw new Error(\`Unexpected backend federation expose: \${id}\`);
  }

  return async () => load();
}

export default { get, init };
`;
};

const createBackendManifest = (
  workspaceRoot: string,
  distDirectory: string,
  app: BackendFederationApp,
) => {
  const sourceModule = `${app.directory}/api/effect-api.ts`;
  const publicPath = `http://localhost:${app.port}/`;

  return {
    schemaVersion: 1,
    id: app.backendName,
    name: app.backendName,
    version: app.version,
    buildVersion: app.buildVersion,
    metaData: {
      name: app.backendName,
      type: 'backend',
      buildInfo: {
        buildVersion: app.buildVersion,
        buildName: app.packageName,
      },
      remoteEntry: {
        name: BACKEND_REMOTE_ENTRY_FILE,
        path: '',
        type: app.remoteType,
      },
      globalName: app.backendName,
      publicPath,
      ssrRemoteEntry: {
        name: BACKEND_REMOTE_ENTRY_FILE,
        path: '',
        type: app.remoteType,
      },
      ssrPublicPath: publicPath,
    },
    entry: {
      file: BACKEND_REMOTE_ENTRY_FILE,
      path: normalizeRelativePath(
        path.relative(
          workspaceRoot,
          path.join(distDirectory, BACKEND_REMOTE_ENTRY_FILE),
        ),
      ),
      type: app.remoteType,
      url: app.containerEntry,
    },
    exposes: [
      {
        id: `${app.backendName}:${BACKEND_EXPOSE}`,
        name: BACKEND_EXPOSE,
        path: '',
        assets: {
          js: {
            async: [],
            sync: [BACKEND_REMOTE_ENTRY_FILE],
          },
          css: {
            async: [],
            sync: [],
          },
        },
      },
    ],
    shared: [],
    backendFederation: {
      role: 'microvertical-server',
      name: app.backendName,
      runtimeFramework: 'effect',
      strictEffectApproach: true,
      contractVersion: CONTRACT_VERSION,
      nodeAdapterVersion: NODE_ADAPTER_VERSION,
      remoteType: app.remoteType,
      expose: BACKEND_EXPOSE,
      manifestUrl: app.manifestUrl,
      containerEntry: app.containerEntry,
      source: {
        module: sourceModule,
      },
      readinessPath: `${app.apiPrefix}/${app.apiStem}/readiness`,
      openapiPath: `${app.apiPrefix}/openapi.json`,
      ...(app.deliveryUnit ? { deliveryUnit: app.deliveryUnit } : {}),
      versionBoundary: {
        invariant: 'web-and-api-same-build',
        packageName: app.packageName,
        version: app.version,
        buildVersion: app.buildVersion,
        ...(app.uiManifestUrl ? { uiManifestUrl: app.uiManifestUrl } : {}),
        ...(app.deliveryUnit
          ? {
              deliveryUnit: {
                unitId: app.deliveryUnit.unitId,
                buildMarker: app.deliveryUnit.buildMarker,
              },
            }
          : {}),
      },
    },
  };
};

export const emitBackendFederationArtifacts = async (
  appDirectory: string,
  distDirectory: string,
): Promise<BackendFederationArtifactResult | undefined> => {
  const workspaceRoot = findWorkspaceRoot(appDirectory);
  if (!workspaceRoot) {
    return undefined;
  }

  const effectApiPath = path.join(appDirectory, 'api/effect-api.ts');
  const backendFederationConfigPath = path.join(
    appDirectory,
    'backend-federation.config.ts',
  );
  if (!existsSync(effectApiPath) || !existsSync(backendFederationConfigPath)) {
    return undefined;
  }

  const app = await findBackendFederationApp(workspaceRoot, appDirectory);
  if (!app) {
    return undefined;
  }
  const buildIdentity = await readBuildIdentity(appDirectory);
  const compactDeliveryUnit = app.compactDeliveryUnit;
  const hasCompactDeliveryUnit =
    compactDeliveryUnit !== undefined &&
    (compactDeliveryUnit.unitId !== undefined ||
      compactDeliveryUnit.buildMarker !== undefined ||
      compactDeliveryUnit.packageName !== undefined ||
      compactDeliveryUnit.version !== undefined);
  const hasBuildIdentity =
    buildIdentity.unitId !== undefined ||
    buildIdentity.buildVersion !== undefined ||
    buildIdentity.packageName !== undefined ||
    buildIdentity.version !== undefined;

  if (hasCompactDeliveryUnit && hasBuildIdentity) {
    const compactConfigPath = path.join(workspaceRoot, COMPACT_CONFIG_PATH);
    const buildIdentityPath = existsSync(buildArtifactPathFor(appDirectory))
      ? buildArtifactPathFor(appDirectory)
      : buildModulePathFor(appDirectory);
    const mismatches: string[] = [];
    const compare = (label: string, a?: string, b?: string) => {
      if (a !== undefined && b !== undefined && a !== b) {
        mismatches.push(
          `${label}: deliveryUnit=${a} vs ultramodern-build=${b}`,
        );
      }
    };
    compare('unitId', compactDeliveryUnit?.unitId, buildIdentity.unitId);
    compare(
      'buildMarker/build',
      compactDeliveryUnit?.buildMarker,
      buildIdentity.buildVersion,
    );
    compare(
      'packageName',
      compactDeliveryUnit?.packageName,
      buildIdentity.packageName,
    );
    compare('version', compactDeliveryUnit?.version, buildIdentity.version);

    if (mismatches.length > 0) {
      throw new Error(
        `[backend-federation-build] Delivery-unit identity drift between ${compactConfigPath} (deliveryUnit) and ${buildIdentityPath}: ${mismatches.join('; ')}`,
      );
    }
  }

  const unitId = compactDeliveryUnit?.unitId ?? buildIdentity.unitId;
  const buildVersion =
    compactDeliveryUnit?.buildMarker ?? buildIdentity.buildVersion;
  const sourceRevision = await resolveWorkspaceSourceRevision(workspaceRoot);
  const packageName =
    compactDeliveryUnit?.packageName ??
    buildIdentity.packageName ??
    app.packageName;
  const version = compactDeliveryUnit?.version ?? buildIdentity.version;
  const deliveryUnit = createStampedDeliveryUnit({
    appId: app.id,
    unitId,
    buildMarker: buildVersion,
    packageName,
    version,
    sourceRevision,
  });
  const stampedBuildArtifact = buildIdentity.artifact
    ? stampUltramodernBuildArtifactSourceRevision(
        buildIdentity.artifact,
        sourceRevision,
      )
    : undefined;

  const resolvedApp: BackendFederationApp = {
    ...app,
    packageName,
    version,
    buildVersion,
    unitId,
    sourceRevision,
    deliveryUnit,
  };

  const manifestPath = path.join(distDirectory, BACKEND_MANIFEST_FILE);
  const entryPath = path.join(distDirectory, BACKEND_REMOTE_ENTRY_FILE);
  const deliveryUnitArtifactPath = stampedBuildArtifact
    ? path.join(distDirectory, ULTRAMODERN_BUILD_ARTIFACT_FILE)
    : undefined;
  await fs.mkdir(distDirectory, { recursive: true });
  await fs.writeFile(
    entryPath,
    createBackendRemoteEntrySource(
      workspaceRoot,
      resolvedApp,
      effectApiPath,
      entryPath,
    ),
  );
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(createBackendManifest(workspaceRoot, distDirectory, resolvedApp), null, 2)}\n`,
  );
  if (stampedBuildArtifact && deliveryUnitArtifactPath) {
    await fs.writeFile(
      deliveryUnitArtifactPath,
      `${JSON.stringify(stampedBuildArtifact, null, 2)}\n`,
    );
  }

  return {
    appId: resolvedApp.id,
    manifestPath,
    containerPath: entryPath,
    ...(deliveryUnitArtifactPath ? { deliveryUnitArtifactPath } : {}),
    remoteName: resolvedApp.backendName,
    remoteType: resolvedApp.remoteType,
  };
};

export default (): CliPlugin<AppTools> => ({
  name: '@modern-js/backend-federation-build',
  setup(api) {
    api.onAfterBuild(async () => {
      const { appDirectory, distDirectory } = api.getAppContext();
      await emitBackendFederationArtifacts(appDirectory, distDirectory);
    });
  },
});
