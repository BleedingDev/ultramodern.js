// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
/**
 * Shared Effect HttpApi endpoint reflection used by BOTH sides of the
 * cross-project contract:
 *
 * - the client generator (`utils/effectClientGenerator`) stamps each
 *   generated operation with a per-endpoint contract hash;
 * - the effect server adapter derives the expected operation-contract map
 *   for the cross-project policy from the same endpoints.
 *
 * Keeping route-path normalization and the endpoint -> contract mapping in
 * one module is what guarantees the two hashes agree.
 */
import {
  createOperationContractHash,
  type OperationContractSource,
} from '@modern-js/bff-core';

export type EffectEndpointMeta = {
  apiId: string;
  groupName: string;
  endpointName: string;
  method: string;
  routePath: string;
};

export type HttpApiLike = {
  identifier?: unknown;
};

export type HttpApiGroupLike = {
  identifier?: unknown;
};

export type HttpApiEndpointLike = {
  name?: unknown;
  method?: unknown;
  path?: unknown;
};

export type HttpApiReflect = (
  api: unknown,
  handlers: {
    /** Group metadata is unused by contract collection; kept as a no-op. */
    onGroup?: () => void;
    onEndpoint: (input: {
      group: HttpApiGroupLike;
      endpoint: HttpApiEndpointLike;
    }) => void;
  },
) => void;

export function ensureLeadingSlash(pathname: string) {
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export function normalizeEffectPrefix(prefix: string) {
  if (prefix === '/') {
    return '';
  }
  return ensureLeadingSlash(prefix || '/api');
}

export function getEffectRoutePath(prefix: string, endpointPath: string) {
  const normalizedPrefix = normalizeEffectPrefix(prefix);
  const normalizedEndpointPath = ensureLeadingSlash(endpointPath);
  const finalEndpointPath = normalizedEndpointPath === '/' ? '' : endpointPath;
  if (!normalizedPrefix && !finalEndpointPath) {
    return '/';
  }
  return `${normalizedPrefix}${finalEndpointPath || ''}`;
}

export function resolveEffectApiId(api: HttpApiLike): string {
  const fallback = 'EffectHttpApi';
  if (
    'identifier' in api &&
    typeof api.identifier === 'string' &&
    api.identifier
  ) {
    return api.identifier;
  }
  return fallback;
}

export function collectEffectEndpoints(
  reflect: HttpApiReflect,
  api: HttpApiLike,
  prefix: string,
): EffectEndpointMeta[] {
  const endpoints: EffectEndpointMeta[] = [];
  const apiId = resolveEffectApiId(api);
  reflect(api, {
    onGroup: () => {
      // no-op
    },
    onEndpoint: ({ group, endpoint }) => {
      endpoints.push({
        apiId,
        groupName: String(group.identifier),
        endpointName: String(endpoint.name),
        method: String(endpoint.method).toUpperCase(),
        routePath: getEffectRoutePath(prefix, String(endpoint.path)),
      });
    },
  });
  return endpoints.sort((a, b) => {
    if (a.groupName === b.groupName) {
      return a.endpointName.localeCompare(b.endpointName);
    }
    return a.groupName.localeCompare(b.groupName);
  });
}

/**
 * Maps reflected endpoints onto operation-contract sources for
 * `buildOperationContractMap`/`resolveCrossProjectPolicy`. Effect endpoints
 * carry no zod metadata, so the contract hash covers the endpoint identity.
 */
export function toOperationContractSources(
  endpoints: EffectEndpointMeta[],
): OperationContractSource[] {
  return endpoints.map(endpoint => ({
    name: endpoint.endpointName,
    httpMethod: endpoint.method,
    routePath: endpoint.routePath,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extracts the HttpApi instance from a loaded effect entry module. Mirrors
 * the module shapes accepted by `resolveEffectBffModuleHandler`:
 * `{ api }`, `{ default: { api } }` and zero-arg default factories.
 */
export async function extractHttpApiFromModule(
  mod: unknown,
  isHttpApi: (value: unknown) => boolean,
): Promise<HttpApiLike | null> {
  if (!isRecord(mod)) {
    return null;
  }
  if (isHttpApi(mod.api)) {
    return mod.api as HttpApiLike;
  }
  const entry = mod.default;
  if (isRecord(entry) && isHttpApi(entry.api)) {
    return entry.api as HttpApiLike;
  }
  if (typeof entry === 'function' && entry.length === 0) {
    try {
      const output = await (entry as () => unknown | Promise<unknown>)();
      if (isRecord(output) && isHttpApi(output.api)) {
        return output.api as HttpApiLike;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Per-endpoint contract hash; MUST stay in sync with the server-side
 * contract map (it is the same bff-core hash over the same inputs).
 */
export function createEffectEndpointContractHash(
  endpoint: EffectEndpointMeta,
  requestId: string,
): string {
  return createOperationContractHash(
    {
      name: endpoint.endpointName,
      httpMethod: endpoint.method,
      routePath: endpoint.routePath,
    },
    requestId,
  );
}
