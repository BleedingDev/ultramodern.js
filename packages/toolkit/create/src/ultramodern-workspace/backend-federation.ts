import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
  type DeliveryUnitRecord,
  formatBackendFederationValidationErrors,
  validateBackendFederationMetadata,
} from '@modern-js/utils/universal';
import { verticalApiExport, verticalApiGroupName } from './api';
import {
  rpcPath,
  verticalRpcContractExport,
  verticalRpcGroupExport,
} from './api/rpc';
import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from './delivery-unit';
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
  resolveApiProtocol,
  resolveApiStem,
} from './descriptors';
import { packageName, toEnvSegment } from './naming';
import type { JsonValue, WorkspaceApp } from './types';
import { EFFECT_VERSION, MODULE_FEDERATION_VERSION } from './versions';

export {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
};

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
): Record<string, JsonValue> {
  const apiStem = resolveApiStem(app);

  if (resolveApiProtocol(app) === 'rpc') {
    return {
      contract: `${app.directory}/shared/rpc.ts`,
      runtime: `${app.directory}/api/index.ts`,
      client: `${app.directory}/src/api/${app.api.stem}-rpc-client.ts`,
      rpc: rpcPath(app),
      serialization: 'json',
    };
  }

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

function createNodeExecutionSurface(
  app: WorkspaceApp,
  deliveryUnit?: DeliveryUnitRecord,
) {
  return {
    kind: 'node-mf-runtime',
    adapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
    remoteName: createBackendFederationName(app),
    manifestEnv: createBackendFederationManifestEnv(app),
    manifestUrl: createBackendFederationManifestUrl(app),
    containerEntry: createBackendFederationContainerEntry(app),
    remoteType: 'commonjs-module',
    expose: BACKEND_FEDERATION_EFFECT_EXPOSE,
    runtimePackage: '@modern-js/plugin-bff/effect',
    ...(deliveryUnit
      ? {
          expected: {
            unitId: deliveryUnit.unitId,
            buildMarker: deliveryUnit.buildMarker,
          },
        }
      : {}),
  };
}

export function createServerExecutionOverlay(
  scope: string,
  app: WorkspaceApp,
): JsonValue | undefined {
  if (!appHasApi(app)) {
    return undefined;
  }

  const deliveryUnit = createDeliveryUnitRecord(scope, app);

  return {
    apiBaseUrl: `http://localhost:${app.port}${
      resolveApiProtocol(app) === 'rpc' ? rpcPath(app) : resolveApiPrefix(app)
    }`,
    versionBoundary: 'web-and-api-same-build',
    deliveryUnit: {
      unitId: deliveryUnit.unitId,
      buildMarker: deliveryUnit.buildMarker,
    },
    cloudflare: createCloudflareExecutionSurface(scope, app),
    node: createNodeExecutionSurface(app, deliveryUnit),
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
  const rpc = resolveApiProtocol(app) === 'rpc';
  const deliveryUnit = createDeliveryUnitRecord(scope, app);

  const contract = {
    role: 'microvertical-server',
    name: createBackendFederationName(app),
    runtimeFramework: 'effect',
    strictEffectApproach: true,
    deliveryUnit: deliveryUnitContractBlock(deliveryUnit),
    exposes: {
      [BACKEND_FEDERATION_EFFECT_EXPOSE]: createEffectExpose(app),
    },
    versionBoundary: {
      invariant: 'web-and-api-same-build',
      identityRoot: 'deliveryUnit',
      packageName: packageName(scope, app.packageSuffix),
      ui: {
        manifestEnv: createRemoteManifestEnv(app),
        manifestUrl: `http://localhost:${app.port}/mf-manifest.json`,
        buildMarker: `${app.directory}/src/routes/ultramodern-route-metadata.ts`,
      },
      api: {
        ...(rpc
          ? {
              rpc: rpcPath(app),
              serialization: 'json',
            }
          : { readiness }),
        buildMarker: `${app.directory}/shared/ultramodern-build.ts`,
        publicUrlEnv: createCloudflarePublicUrlEnv(app),
      },
    },
    executionSurfaces: {
      cloudflare: createCloudflareExecutionSurface(scope, app),
      node: createNodeExecutionSurface(app, deliveryUnit),
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
  const validation = validateBackendFederationMetadata(contract, {
    path: `${app.id}.backendFederation`,
    requireEffectExpose: true,
    requireEffectRuntime: true,
    requireVersionFields: true,
  });

  if (!validation.ok) {
    throw new Error(
      `Backend federation contract invalid for ${app.id}: ${formatBackendFederationValidationErrors(
        validation.errors,
      )}.`,
    );
  }

  return contract;
}

export function createBackendFederationMetadata(
  scope: string,
  app: WorkspaceApp,
): JsonValue | undefined {
  if (!appHasApi(app)) {
    return undefined;
  }

  const rpc = resolveApiProtocol(app) === 'rpc';
  return {
    contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
    deliveryUnit: deliveryUnitContractBlock(
      createDeliveryUnitRecord(scope, app),
    ),
    executionSurfaces: ['node-mf-runtime'],
    exposes: [BACKEND_FEDERATION_EFFECT_EXPOSE],
    name: createBackendFederationName(app),
    nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
    ...(rpc
      ? {
          rpcPath: rpcPath(app),
          rpcSerialization: 'json',
        }
      : {
          openapiPath: `${app.api.prefix}/openapi.json`,
          readinessPath: `${app.api.prefix}/${resolveApiStem(app)}/readiness`,
        }),
    role: 'microvertical-server',
    runtimeFramework: 'effect',
    strictEffectApproach: true,
  };
}

export function createBackendFederationContractFile(app: WorkspaceApp) {
  if (!app.api) {
    throw new Error(`App ${app.id} does not define an Effect API.`);
  }

  if (resolveApiProtocol(app) === 'rpc') {
    const groupExport = verticalRpcGroupExport(app);
    const contractExport = verticalRpcContractExport(app);

    return `import { ultramodernApiMarker } from '../shared/ultramodern-build.ts';

export const backendFederationContract = {
  compatibility: {
    build: ultramodernApiMarker.build,
    contractVersion: '${BACKEND_FEDERATION_CONTRACT_VERSION}',
    nodeAdapterVersion: '${BACKEND_FEDERATION_NODE_ADAPTER_VERSION}',
    packageName: ultramodernApiMarker.packageName,
    sourceRevision: ultramodernApiMarker.sourceRevision,
    unitId: ultramodernApiMarker.unitId,
  },
  contractVersion: '${BACKEND_FEDERATION_CONTRACT_VERSION}',
  executionSurfaces: ['node-mf-runtime'],
  exposes: ['${BACKEND_FEDERATION_EFFECT_EXPOSE}'],
  name: '${createBackendFederationName(app)}',
  nodeAdapterVersion: '${BACKEND_FEDERATION_NODE_ADAPTER_VERSION}',
  rpcPath: '${rpcPath(app)}',
  rpcSerialization: 'json',
  role: 'microvertical-server',
  runtimeFramework: 'effect',
  strictEffectApproach: true,
} as const;

export { default, default as runtime } from './index.ts';
export {
  ${groupExport} as api,
  ${contractExport} as contract,
} from '../shared/rpc.ts';
`;
  }

  const apiExport = verticalApiExport(app);
  const groupName = verticalApiGroupName(app);
  const readinessPath = `${app.api.prefix}/${resolveApiStem(app)}/readiness`;

  return `import { ultramodernApiMarker } from '../shared/ultramodern-build.ts';

export const backendFederationContract = {
  compatibility: {
    build: ultramodernApiMarker.build,
    contractVersion: '${BACKEND_FEDERATION_CONTRACT_VERSION}',
    nodeAdapterVersion: '${BACKEND_FEDERATION_NODE_ADAPTER_VERSION}',
    packageName: ultramodernApiMarker.packageName,
    sourceRevision: ultramodernApiMarker.sourceRevision,
    unitId: ultramodernApiMarker.unitId,
  },
  contractVersion: '${BACKEND_FEDERATION_CONTRACT_VERSION}',
  executionSurfaces: ['node-mf-runtime'],
  exposes: ['${BACKEND_FEDERATION_EFFECT_EXPOSE}'],
  name: '${createBackendFederationName(app)}',
  nodeAdapterVersion: '${BACKEND_FEDERATION_NODE_ADAPTER_VERSION}',
  openapiPath: '${app.api.prefix}/openapi.json',
  readinessPath: '${readinessPath}',
  role: 'microvertical-server',
  runtimeFramework: 'effect',
  strictEffectApproach: true,
} as const;

export { default, default as runtime } from './index.ts';
export {
  ${apiExport} as api,
  ${groupName}ApiContract as contract,
  ${groupName}OperationContexts as operationContexts,
} from '../shared/api.ts';
`;
}

export function createBackendFederationSummary(
  scope: string,
  app: WorkspaceApp,
): JsonValue | undefined {
  if (!appHasApi(app)) {
    return undefined;
  }

  const deliveryUnit = createDeliveryUnitRecord(scope, app);

  return {
    id: app.id,
    path: app.directory,
    role: 'microvertical-server',
    name: createBackendFederationName(app),
    runtimeFramework: 'effect',
    strictEffectApproach: true,
    contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
    deliveryUnit: deliveryUnitContractBlock(deliveryUnit),
    executionSurfaces: {
      cloudflare: createCloudflareExecutionSurface(scope, app),
      node: createNodeExecutionSurface(app, deliveryUnit),
    },
  };
}
