// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off
import { deriveOperationVersion } from '@modern-js/bff-core';
import type { HttpMethodDecider } from '@modern-js/types';
import { compatibleRequire, findExists, fs, logger } from '@modern-js/utils';
import path from 'path';
import {
  collectEffectEndpoints,
  createEffectEndpointContractHash,
  type EffectEndpointMeta,
  ensureLeadingSlash,
  extractHttpApiFromModule,
  type HttpApiLike,
  type HttpApiReflect,
  normalizeEffectPrefix,
} from '../runtime/effect/endpoint-contracts';

const JS_OR_TS_EXTS = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
] as const;

const DEFAULT_REQUEST_CREATOR = '@modern-js/plugin-bff/client';
const EFFECT_CLIENT_RUNTIME_IMPORT =
  '@modern-js/plugin-bff/effect-client-runtime';

type HttpApiRuntime = {
  isHttpApi: (value: unknown) => boolean;
  reflect: HttpApiReflect;
};

let httpApiRuntimePromise: Promise<HttpApiRuntime> | undefined;

export type EffectClientCodegenOptions = {
  appDir: string;
  apiDir: string;
  resourcePath: string;
  prefix: string;
  port: number;
  target?: string;
  requestCreator?: string;
  httpMethodDecider?: HttpMethodDecider;
  dataPlatformBatch?: {
    enabled?: boolean;
    endpoint?: string;
    flushIntervalMs?: number;
    maxBatchSize?: number;
    maxBatchBytes?: number;
    requestTimeoutMs?: number;
    allowedMethods?: string[];
  };
};

export type GeneratedEffectClientArtifacts = {
  code: string;
  declaration: string;
  endpoints: EffectEndpointMeta[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbsoluteUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function resolveBatchEndpoint(prefix: string, endpoint: string | undefined) {
  const value = endpoint || '/_data/batch';
  if (isAbsoluteUrl(value)) {
    return value;
  }

  const normalizedPrefix = normalizeEffectPrefix(prefix);
  const normalizedEndpoint = ensureLeadingSlash(value);
  if (!normalizedPrefix) {
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

function getPackageInfo(appDir: string): { name?: string; version?: string } {
  try {
    const packageJsonPath = path.resolve(appDir, './package.json');
    const packageJson = fs.readJSONSync(packageJsonPath) as {
      name?: string;
      version?: string;
    };
    return { name: packageJson.name, version: packageJson.version };
  } catch {
    return {};
  }
}

async function getHttpApiRuntime(): Promise<HttpApiRuntime> {
  if (!httpApiRuntimePromise) {
    httpApiRuntimePromise = (async () => {
      let mod: unknown;
      try {
        mod = await compatibleRequire('effect/unstable/httpapi', false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Cannot find module 'effect/unstable/httpapi'")) {
          throw error;
        }
        // Fallback for CJS paths where the effect package does not expose a require condition.
        const effectPackageJson = require.resolve('effect/package.json');
        const effectHttpApiRuntimePath = path.join(
          path.dirname(effectPackageJson),
          'dist',
          'unstable',
          'httpapi',
          'index.js',
        );
        mod = await compatibleRequire(effectHttpApiRuntimePath, false);
      }

      if (isRecord(mod) && isRecord(mod.HttpApi)) {
        const maybeHttpApi = mod.HttpApi as Partial<HttpApiRuntime>;
        if (
          typeof maybeHttpApi.isHttpApi === 'function' &&
          typeof maybeHttpApi.reflect === 'function'
        ) {
          return maybeHttpApi as HttpApiRuntime;
        }
      }
      throw new Error(
        '[BFF][Effect] Unable to resolve HttpApi runtime from effect/unstable/httpapi.',
      );
    })();
  }

  return httpApiRuntimePromise;
}

async function loadEffectApi(
  resourcePath: string,
): Promise<HttpApiLike | null> {
  const httpApiRuntime = await getHttpApiRuntime();
  const mod = (await compatibleRequire(resourcePath, false)) as unknown;
  return extractHttpApiFromModule(mod, httpApiRuntime.isHttpApi);
}

function renderEffectClientCode(
  endpoints: EffectEndpointMeta[],
  options: EffectClientCodegenOptions,
) {
  const requestCreator = options.requestCreator || DEFAULT_REQUEST_CREATOR;
  const httpMethodDecider = options.httpMethodDecider || 'functionName';
  const packageInfo = getPackageInfo(options.appDir);
  const packageName = packageInfo.name;
  const dataPlatformAppNamespace = packageName || 'unknown-app';
  const requestId =
    options.target === 'bundle'
      ? packageName || process.env.npm_package_name
      : undefined;
  const normalizedRequestId = requestId || 'default';
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
    ...(requestId ? { requestId } : {}),
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
        batchConfig?.allowedMethods && batchConfig.allowedMethods.length > 0
          ? batchConfig.allowedMethods
          : ['GET'],
    },
  };

  return `import * as __requestRuntime from ${JSON.stringify(requestCreator)};
import { createGeneratedEffectClient } from ${JSON.stringify(
    EFFECT_CLIENT_RUNTIME_IMPORT,
  )};

const __manifest = ${JSON.stringify(manifest, null, 2)};

const __config = ${JSON.stringify(config, null, 2)};

const __generated = createGeneratedEffectClient(__manifest, __config, __requestRuntime);

const client = __generated.client;
const operationManifest = __generated.operationManifest;
const createEffectRequestContext = __generated.createEffectRequestContext;
const effectBffModule = {
  client,
  operationManifest,
  createEffectRequestContext,
};

export { client, createEffectRequestContext, operationManifest };
export default effectBffModule;
`;
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
declare const effectBffModule: {
  client: GeneratedEffectClient;
  createEffectRequestContext: typeof createEffectRequestContext;
  operationManifest: GeneratedEffectOperationManifest;
};

export default effectBffModule;
`;
}

/**
 * Generates the Effect client module plus its type declaration. The module
 * body is a thin manifest + one call into
 * `@modern-js/plugin-bff/effect-client-runtime`; the declaration preserves
 * the group/endpoint structure of the HttpApi instead of erasing it to
 * `Record<string, ...>`.
 */
export async function generateEffectClient(
  options: EffectClientCodegenOptions,
): Promise<GeneratedEffectClientArtifacts | null> {
  const api = await loadEffectApi(options.resourcePath);
  if (!api) {
    logger.warn(
      `[BFF][Effect] Failed to generate client for ${options.resourcePath}: unable to resolve exported HttpApi.`,
    );
    return null;
  }

  const httpApiRuntime = await getHttpApiRuntime();
  const endpoints = collectEffectEndpoints(
    httpApiRuntime.reflect,
    api,
    options.prefix,
  );
  return {
    code: renderEffectClientCode(endpoints, options),
    declaration: renderEffectClientDeclaration(endpoints),
    endpoints,
  };
}

export async function generateEffectClientCode(
  options: EffectClientCodegenOptions,
) {
  const artifacts = await generateEffectClient(options);
  return artifacts ? artifacts.code : null;
}

export function resolveEffectEntryFile(options: {
  appDir: string;
  apiDir: string;
  effectEntry?: string;
}) {
  const { appDir, apiDir, effectEntry } = options;

  const defaultEntry = path.resolve(apiDir, 'effect', 'index');
  const entryWithoutExt = effectEntry
    ? path.isAbsolute(effectEntry)
      ? effectEntry
      : path.resolve(appDir, effectEntry)
    : defaultEntry;

  if (path.extname(entryWithoutExt)) {
    return fs.existsSync(entryWithoutExt) ? entryWithoutExt : undefined;
  }

  return findExists(JS_OR_TS_EXTS.map(ext => `${entryWithoutExt}${ext}`));
}
