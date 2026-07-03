import { verticalApiExport, verticalApiGroupName } from './api';
import {
  appHasApi,
  createBackendFederationContainerEntry,
  createBackendFederationManifestEnv,
  createBackendFederationManifestUrl,
  createBackendFederationName,
  createCloudflarePublicUrlEnv,
  createCloudflareWorkerName,
  createRemoteManifestEnv,
  resolveApiPrefix,
  resolveApiStem,
} from './descriptors';
import { packageName, toEnvSegment } from './naming';
import type { JsonValue, WorkspaceApp } from './types';
import { EFFECT_VERSION, MODULE_FEDERATION_VERSION } from './versions';

export const BACKEND_FEDERATION_CONTRACT_VERSION =
  'microvertical-server-effect-v1';
export const BACKEND_FEDERATION_NODE_ADAPTER_VERSION = 'backend-mf-effect-v1';

function createZephyrEnv(app: WorkspaceApp, suffix: string) {
  return `ZEPHYR_${toEnvSegment(app.domain ?? app.id)}_${suffix}`;
}

export function createWorkerBindingName(app: WorkspaceApp) {
  return `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_WORKER`;
}

export function createWorkerBindingEnv(app: WorkspaceApp) {
  return `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_WORKER_BINDING`;
}

function createDispatchNamespaceEnv(app: WorkspaceApp) {
  return `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_DISPATCH_NAMESPACE`;
}

export function createDispatchWorkerNameEnv(app: WorkspaceApp) {
  return `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_WORKER_NAME`;
}

function createEffectExpose(
  app: WorkspaceApp & { api: NonNullable<WorkspaceApp['api']> },
) {
  const apiStem = resolveApiStem(app);

  return {
    contract: `${app.directory}/shared/api.ts`,
    runtime: `${app.directory}/api/index.ts`,
    client: `${app.directory}/src/api/${app.api.stem}-client.ts`,
    openapi: `${app.api.prefix}/openapi.json`,
    readiness: `${app.api.prefix}/${apiStem}/readiness`,
  };
}

function createCloudflareExecutionSurface(scope: string, app: WorkspaceApp) {
  return {
    kind: 'cloudflare-worker-snapshot',
    workerName: createCloudflareWorkerName(scope, app),
    publicUrlEnv: createCloudflarePublicUrlEnv(app),
    ssr: {
      workerEntry: '.output/server/index.mjs',
      workerManifest: '.output/server/modern-worker-manifest.json',
      routeManifest: '.output/server/route.json',
      ssrBundle: '.output/worker/index.js',
      effectBffBundle: '.output/worker/__modern_bff_effect.js',
      assetsBinding: 'ASSETS',
    },
    zephyr: {
      runtime: 'ssr-worker',
      integration: 'managed-cloudflare',
      snapshotIdEnv: createZephyrEnv(app, 'SNAPSHOT_ID'),
      versionIdEnv: createZephyrEnv(app, 'VERSION_ID'),
      applicationUidEnv: createZephyrEnv(app, 'APPLICATION_UID'),
    },
    workerDispatch: {
      preferred: 'service-binding',
      serviceBinding: createWorkerBindingName(app),
      serviceBindingEnv: createWorkerBindingEnv(app),
      dispatchNamespaceEnv: createDispatchNamespaceEnv(app),
      dispatchWorkerNameEnv: createDispatchWorkerNameEnv(app),
      requestInterface: 'fetch',
    },
  };
}

function createNodeExecutionSurface(app: WorkspaceApp) {
  return {
    kind: 'node-mf-runtime',
    adapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
    remoteName: createBackendFederationName(app),
    manifestEnv: createBackendFederationManifestEnv(app),
    manifestUrl: createBackendFederationManifestUrl(app),
    containerEntry: createBackendFederationContainerEntry(app),
    remoteType: 'module',
    expose: './effect-api',
    runtimePackage: '@modern-js/plugin-bff/effect',
  };
}

export function createServerExecutionOverlay(
  scope: string,
  app: WorkspaceApp,
): JsonValue | undefined {
  if (!appHasApi(app)) {
    return undefined;
  }

  return {
    apiBaseUrl: `http://localhost:${app.port}${resolveApiPrefix(app)}`,
    versionBoundary: 'web-and-api-same-build',
    cloudflare: createCloudflareExecutionSurface(scope, app),
    node: createNodeExecutionSurface(app),
  };
}

export function createBackendFederationContract(
  scope: string,
  app: WorkspaceApp,
): JsonValue | undefined {
  if (!appHasApi(app)) {
    return undefined;
  }

  const readiness = `${app.api.prefix}/${resolveApiStem(app)}/readiness`;

  return {
    role: 'microvertical-server',
    name: createBackendFederationName(app),
    runtimeFramework: 'effect',
    strictEffectApproach: true,
    exposes: {
      './effect-api': createEffectExpose(app),
    },
    versionBoundary: {
      invariant: 'web-and-api-same-build',
      packageName: packageName(scope, app.packageSuffix),
      ui: {
        manifestEnv: createRemoteManifestEnv(app),
        manifestUrl: `http://localhost:${app.port}/mf-manifest.json`,
        buildMarker: `${app.directory}/src/routes/ultramodern-route-metadata.ts`,
      },
      api: {
        readiness,
        buildMarker: `${app.directory}/shared/ultramodern-build.ts`,
        publicUrlEnv: createCloudflarePublicUrlEnv(app),
      },
    },
    executionSurfaces: {
      cloudflare: createCloudflareExecutionSurface(scope, app),
      node: createNodeExecutionSurface(app),
    },
    compatibility: {
      contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
      packageName: packageName(scope, app.packageSuffix),
      effectVersion: EFFECT_VERSION,
      moduleFederationVersion: MODULE_FEDERATION_VERSION,
    },
    cache: {
      cloudflareSnapshot: 'immutable',
      nodeManifest: 'no-store',
      nodeVersionedContainer: 'immutable',
      nodeUnpinnedContainer: 'revalidate',
    },
    fallback: {
      timeoutMs: 1500,
      failureEvent: 'modernjs:microvertical-server-fallback',
      strategy: 'typed-effect-error',
    },
  };
}

export function createBackendFederationMetadata(
  app: WorkspaceApp,
): JsonValue | undefined {
  if (!appHasApi(app)) {
    return undefined;
  }

  return {
    contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
    executionSurfaces: ['node-mf-runtime'],
    exposes: ['./effect-api'],
    name: createBackendFederationName(app),
    nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
    openapiPath: `${app.api.prefix}/openapi.json`,
    readinessPath: `${app.api.prefix}/${resolveApiStem(app)}/readiness`,
    role: 'microvertical-server',
    runtimeFramework: 'effect',
    strictEffectApproach: true,
  };
}

export function createBackendFederationContractFile(app: WorkspaceApp) {
  if (!app.api) {
    throw new Error(`App ${app.id} does not define an Effect API.`);
  }

  const apiExport = verticalApiExport(app);
  const groupName = verticalApiGroupName(app);
  const readinessPath = `${app.api.prefix}/${resolveApiStem(app)}/readiness`;

  return `import runtime from './index.ts';
import { ultramodernApiMarker } from '../shared/ultramodern-build.ts';
import {
  ${apiExport} as api,
  ${groupName}ApiContract as contract,
  ${groupName}OperationContexts as operationContexts,
} from '../shared/api.ts';

export const backendFederationContract = {
  compatibility: {
    build: ultramodernApiMarker.build,
    contractVersion: '${BACKEND_FEDERATION_CONTRACT_VERSION}',
    nodeAdapterVersion: '${BACKEND_FEDERATION_NODE_ADAPTER_VERSION}',
    packageName: ultramodernApiMarker.packageName,
  },
  contractVersion: '${BACKEND_FEDERATION_CONTRACT_VERSION}',
  executionSurfaces: ['node-mf-runtime'],
  exposes: ['./effect-api'],
  name: '${createBackendFederationName(app)}',
  nodeAdapterVersion: '${BACKEND_FEDERATION_NODE_ADAPTER_VERSION}',
  openapiPath: '${app.api.prefix}/openapi.json',
  readinessPath: '${readinessPath}',
  role: 'microvertical-server',
  runtimeFramework: 'effect',
  strictEffectApproach: true,
} as const;

export { api, contract, operationContexts, runtime };

export default runtime;
`;
}

export function createBackendFederationSummary(
  scope: string,
  app: WorkspaceApp,
): JsonValue | undefined {
  if (!appHasApi(app)) {
    return undefined;
  }

  return {
    id: app.id,
    path: app.directory,
    role: 'microvertical-server',
    name: createBackendFederationName(app),
    runtimeFramework: 'effect',
    strictEffectApproach: true,
    contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
    executionSurfaces: {
      cloudflare: createCloudflareExecutionSurface(scope, app),
      node: createNodeExecutionSurface(app),
    },
  };
}
