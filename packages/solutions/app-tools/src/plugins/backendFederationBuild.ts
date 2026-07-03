import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppTools, CliPlugin } from '../types';

const COMPACT_CONFIG_PATH = '.modernjs/ultramodern.json';
const BACKEND_MANIFEST_FILE = 'backend-mf-manifest.json';
const BACKEND_REMOTE_ENTRY_FILE = 'backendRemoteEntry.mjs';
const CONTRACT_VERSION = 'microvertical-server-effect-v1';
const NODE_ADAPTER_VERSION = 'backend-mf-effect-v1';
const BACKEND_EXPOSE = './effect-api';

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
  port: number;
  apiPrefix: string;
  apiStem: string;
  backendName: string;
  manifestUrl: string;
  containerEntry: string;
  remoteType: string;
  uiManifestUrl?: string;
};

type BackendFederationBuildIdentity = {
  packageName?: string;
  version?: string;
  buildVersion?: string;
};

export type BackendFederationArtifactResult = {
  appId: string;
  manifestPath: string;
  containerPath: string;
  remoteName: string;
  remoteType: string;
};

const normalizeRelativePath = (value: string) =>
  value.replace(/\\/gu, '/').replace(/^\.\/+/u, '');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readJsonFile = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await fs.readFile(filePath, 'utf8')) as T;

const readBuildIdentity = async (
  appDirectory: string,
): Promise<BackendFederationBuildIdentity> => {
  const buildModulePath = path.join(
    appDirectory,
    'shared/ultramodern-build.ts',
  );
  if (!existsSync(buildModulePath)) {
    return {};
  }

  const source = await fs.readFile(buildModulePath, 'utf8');
  return {
    buildVersion: source.match(/\bbuild:\s*['"]([^'"]+)['"]/u)?.[1],
    packageName: source.match(/\bpackageName:\s*['"]([^'"]+)['"]/u)?.[1],
    version: source.match(/\bversion:\s*['"]([^'"]+)['"]/u)?.[1],
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
      versionBoundary: {
        invariant: 'web-and-api-same-build',
        packageName: app.packageName,
        version: app.version,
        buildVersion: app.buildVersion,
        ...(app.uiManifestUrl ? { uiManifestUrl: app.uiManifestUrl } : {}),
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
  const resolvedApp = {
    ...app,
    ...buildIdentity,
    packageName: buildIdentity.packageName ?? app.packageName,
  };

  const manifestPath = path.join(distDirectory, BACKEND_MANIFEST_FILE);
  const entryPath = path.join(distDirectory, BACKEND_REMOTE_ENTRY_FILE);
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

  return {
    appId: resolvedApp.id,
    manifestPath,
    containerPath: entryPath,
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
