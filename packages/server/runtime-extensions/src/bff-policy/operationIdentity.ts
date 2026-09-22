export type OperationContractEntry = {
  name: string;
  httpMethod: string;
  routePath: string;
};

export type OperationContractDefinition = {
  requestId: string;
  operationVersion: number;
  schemaHash: string;
  method: string;
  routePath: string;
  operationId: string;
  handlerName: string;
  filename?: string;
};

export type OperationContractMap = Record<string, OperationContractDefinition>;

export const DEFAULT_OPERATION_VERSION = 1;

/**
 * Derives the operation version from a producer package version: the semver
 * major is the contract version, so consumers regenerated against an older
 * producer major fail the `operation_version_mismatch` gate instead of
 * silently calling an incompatible API.
 *
 * Falls back to {@link DEFAULT_OPERATION_VERSION} when no parseable version
 * is available.
 */
export const deriveOperationVersion = (packageVersion?: unknown): number => {
  if (typeof packageVersion !== 'string') {
    return DEFAULT_OPERATION_VERSION;
  }
  const match = packageVersion.trim().match(/^v?(\d+)\./);
  if (!match) {
    return DEFAULT_OPERATION_VERSION;
  }
  const major = Number.parseInt(match[1]!, 10);
  return Number.isInteger(major) && major >= 0
    ? major
    : DEFAULT_OPERATION_VERSION;
};

/** JSON.stringify with recursively sorted object keys for stable hashing. */
export const stableOperationStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableOperationStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => typeof entryValue !== 'undefined')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableOperationStringify(entryValue)}`,
      );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export type OperationContractHashInput = OperationContractEntry & {
  schemas?: Record<string, unknown>;
};

export const serializeOperationContract = (
  operation: OperationContractHashInput,
  requestId: string,
): string =>
  stableOperationStringify({
    httpMethod: String(operation.httpMethod || '').toUpperCase(),
    name: operation.name,
    requestId,
    routePath: operation.routePath,
    ...(operation.schemas ? { schemas: operation.schemas } : {}),
  });

export async function digestOperationContract(
  operation: OperationContractHashInput,
  requestId: string,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serializeOperationContract(operation, requestId)),
  );
  return Array.from(new Uint8Array(digest), value =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}
