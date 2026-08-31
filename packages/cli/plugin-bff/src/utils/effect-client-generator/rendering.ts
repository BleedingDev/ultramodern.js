import {
  buildOperationContractMap,
  deriveOperationVersion,
  type OperationContractMap,
} from '@modern-js/bff-core';
import { fs, upath as path } from '@modern-js/utils';
import {
  createEffectEndpointContractHash,
  type EffectEndpointMeta,
  ensureLeadingSlash,
  normalizeEffectPrefix,
  toOperationContractSources,
} from '../../runtime/effect/endpoint-contracts';
import type { EffectClientCodegenOptions } from './types';

const DEFAULT_REQUEST_CREATOR = '@modern-js/plugin-bff/client';
const EFFECT_CLIENT_RUNTIME_IMPORT =
  '@modern-js/plugin-bff/effect-client-runtime';

function isAbsoluteUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function resolveBatchEndpoint(prefix: string, endpoint: string | undefined) {
  const value =
    endpoint === undefined || endpoint === '' ? '/_data/batch' : endpoint;
  if (isAbsoluteUrl(value)) {
    return value;
  }

  const normalizedPrefix = normalizeEffectPrefix(prefix);
  const normalizedEndpoint = ensureLeadingSlash(value);
  if (normalizedPrefix === '') {
    return normalizedEndpoint;
  }

  if (
    normalizedEndpoint === normalizedPrefix ||
    normalizedEndpoint.startsWith(`${normalizedPrefix}/`)
  ) {
    return normalizedEndpoint;
  }

  return `${normalizedPrefix}${normalizedEndpoint === '/' ? '' : normalizedEndpoint}`;
}

function getPackageInfo(
  resourcePath: string,
  appDir: string,
  onDependency?: (dependency: string) => void,
): { name?: string; version?: string } {
  for (const startDir of [path.dirname(resourcePath), appDir]) {
    let current = path.resolve(startDir);
    for (let depth = 0; depth < 32; depth += 1) {
      const packageJsonPath = path.join(current, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        onDependency?.(packageJsonPath);
        try {
          const packageJson = fs.readJSONSync(packageJsonPath) as {
            name?: string;
            version?: string;
          };
          return { name: packageJson.name, version: packageJson.version };
        } catch {
          return {};
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  return {};
}

export function renderEffectClientCode(generation: EffectClientGeneration) {
  const { config, manifest } = generation;
  return `import * as __requestRuntime from ${JSON.stringify(
    generation.requestCreator,
  )};
import { createGeneratedEffectClient } from ${JSON.stringify(
    EFFECT_CLIENT_RUNTIME_IMPORT,
  )};

const __manifest = ${JSON.stringify(manifest, null, 2)};

const __config = ${JSON.stringify(config, null, 2)};

const __generated = createGeneratedEffectClient(__manifest, __config, __requestRuntime);

const client = __generated.client;
const operationManifest = __generated.operationManifest;
const createEffectRequestContext = __generated.createEffectRequestContext;
const apiModule = {
  client,
  operationManifest,
  createEffectRequestContext,
};

export { client, createEffectRequestContext, operationManifest };
export default apiModule;
`;
}

export type EffectClientGeneration = {
  config: Record<string, unknown>;
  manifest: {
    endpoints: Array<{
      apiId: string;
      group: string;
      endpoint: string;
      method: string;
      routePath: string;
      schemaHash: string;
      operationVersion: number;
    }>;
  };
  operationContracts: OperationContractMap;
  operationVersion: number;
  requestCreator: string;
  requestId: string;
};

export function createEffectClientGeneration(
  endpoints: EffectEndpointMeta[],
  options: EffectClientCodegenOptions,
): EffectClientGeneration {
  const requestCreator = options.requestCreator || DEFAULT_REQUEST_CREATOR;
  const httpMethodDecider = options.httpMethodDecider || 'functionName';
  const packageInfo = getPackageInfo(
    options.resourcePath,
    options.appDir,
    options.onDependency,
  );
  const packageName = packageInfo.name;
  const dataPlatformAppNamespace =
    packageName === undefined || packageName === ''
      ? 'unknown-app'
      : packageName;
  const requestId =
    options.target === 'bundle'
      ? options.requestId !== undefined && options.requestId.trim() !== ''
        ? options.requestId.trim()
        : packageName !== undefined && packageName !== ''
          ? packageName
          : undefined
      : undefined;
  const normalizedRequestId =
    requestId === undefined || requestId === '' ? 'default' : requestId;
  const operationVersion = deriveOperationVersion(packageInfo.version);
  const batchConfig = options.dataPlatformBatch;
  const batchEndpoint = resolveBatchEndpoint(
    options.prefix,
    batchConfig?.endpoint,
  );

  const manifest = {
    endpoints: endpoints.map(endpoint => ({
      apiId: endpoint.apiId,
      group: endpoint.groupName,
      endpoint: endpoint.endpointName,
      method: endpoint.method,
      routePath: endpoint.routePath,
      schemaHash: createEffectEndpointContractHash(
        endpoint,
        normalizedRequestId,
      ),
      operationVersion,
    })),
  };

  const config = {
    appNamespace: dataPlatformAppNamespace,
    ...(requestId !== undefined && requestId !== '' ? { requestId } : {}),
    port: options.port,
    useEnvPort: options.target === 'server',
    defaultOrigin: `http://localhost:${String(options.port)}`,
    httpMethodDecider,
    batch: {
      enabled: batchConfig?.enabled ?? true,
      endpoint: batchEndpoint,
      flushIntervalMs: batchConfig?.flushIntervalMs ?? 8,
      maxBatchSize: batchConfig?.maxBatchSize ?? 16,
      maxBatchBytes: batchConfig?.maxBatchBytes ?? 64 * 1024,
      requestTimeoutMs: batchConfig?.requestTimeoutMs ?? 10_000,
      allowedMethods:
        batchConfig?.allowedMethods !== undefined &&
        batchConfig.allowedMethods.length > 0
          ? batchConfig.allowedMethods
          : ['GET'],
    },
  };

  return {
    config,
    manifest,
    operationContracts: buildOperationContractMap({
      handlers: toOperationContractSources(endpoints),
      requestId: normalizedRequestId,
      operationVersion,
    }),
    operationVersion,
    requestCreator,
    requestId: normalizedRequestId,
  };
}

function renderClientShape(
  endpoints: EffectEndpointMeta[],
  valueType: string,
): string {
  if (endpoints.length === 0) {
    return `Record<string, Record<string, ${valueType}>>`;
  }
  const groups = new Map<string, string[]>();
  for (const endpoint of endpoints) {
    const group = groups.get(endpoint.groupName) || [];
    group.push(endpoint.endpointName);
    groups.set(endpoint.groupName, group);
  }
  const groupEntries = [...groups.entries()].map(([groupName, names]) => {
    const endpointEntries = names
      .map(name => `    ${JSON.stringify(name)}: ${valueType};`)
      .join('\n');
    return `  ${JSON.stringify(groupName)}: {\n${endpointEntries}\n  };`;
  });
  return `{\n${groupEntries.join('\n')}\n}`;
}

export function renderEffectClientDeclaration(
  endpoints: EffectEndpointMeta[] = [],
) {
  return `export type EffectClientOperation = (
  request?: unknown,
) => Promise<unknown>;
export type EffectClientGroup = Record<string, EffectClientOperation>;
export type EffectClient = Record<string, EffectClientGroup>;
export type EffectOperationDescriptor = {
  appNamespace: string;
  apiId: string;
  group: string;
  endpoint: string;
  operationId: string;
  routePath: string;
  method: string;
  operationVersion: number;
  schemaHash: string;
  version: number;
};
export type EffectOperationManifest = Record<
  string,
  Record<string, EffectOperationDescriptor>
>;
export type EffectOperationContext = {
  requestId?: string;
  operationId?: string;
  routePath?: string;
  method?: string;
  schemaHash?: string;
  operationVersion?: number;
  locale?: string;
  traceparent?: string;
  traceId?: string;
  spanId?: string;
  source?: string;
  scope?: Record<string, unknown>;
  sessionClaims?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
};
export type EffectRequestContext = {
  headers?: Record<string, string>;
  locale?: string;
  operationContext?: EffectOperationContext;
  traceparent?: string;
  traceId?: string;
  spanId?: string;
};
export type GeneratedEffectClient = ${renderClientShape(
    endpoints,
    'EffectClientOperation',
  )};
export type GeneratedEffectOperationManifest = ${renderClientShape(
    endpoints,
    'EffectOperationDescriptor',
  )};

export declare const client: GeneratedEffectClient;
export declare const createEffectRequestContext: (
  requestContext: Record<string, unknown>,
) => EffectRequestContext;
export declare const operationManifest: GeneratedEffectOperationManifest;
declare const apiModule: {
  client: GeneratedEffectClient;
  createEffectRequestContext: typeof createEffectRequestContext;
  operationManifest: GeneratedEffectOperationManifest;
};

export default apiModule;
`;
}
