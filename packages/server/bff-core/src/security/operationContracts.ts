import { createRequire } from 'node:module';
import { createHash } from 'crypto';
import 'reflect-metadata';
import type { ApiHandler } from '../router/types';
import { HttpMetadata } from '../types';

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
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => typeof entryValue !== 'undefined')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
      );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

type ZodToJSONSchema = (schema: unknown, options?: unknown) => unknown;

let cachedZodToJSONSchema: ZodToJSONSchema | null | undefined;

// FORK: the specifier is assembled at runtime so the bundler cannot see it.
// A literal require of the zod specifier here is externalized by rslib/rspack
// into a TOP-LEVEL static import of it in the esm-node output, which makes
// this OPTIONAL peer a hard runtime requirement: every consumer of
// @modern-js/bff-core (and therefore of @modern-js/plugin-bff's root, ./cli,
// ./server-plugin and ./hono-server entries) crashed with
// ERR_MODULE_NOT_FOUND: zod unless they happened to install zod.
// Guard: tests/optionalZodPeer.test.ts. Do NOT inline this back to a literal.
const ZOD_SPECIFIER = ['z', 'o', 'd'].join('');

const resolveZodToJSONSchema = (): ZodToJSONSchema | null => {
  if (typeof cachedZodToJSONSchema !== 'undefined') {
    return cachedZodToJSONSchema;
  }
  try {
    // zod is an optional peer dependency: schema serialization degrades to a
    // route-identity hash when it is absent.
    const load = createRequire(
      typeof __filename === 'string' ? __filename : import.meta.url,
    );
    const zod = load(ZOD_SPECIFIER) as Record<string, unknown> & {
      z?: Record<string, unknown>;
    };
    const candidate = zod?.toJSONSchema ?? zod?.z?.toJSONSchema;
    cachedZodToJSONSchema =
      typeof candidate === 'function' ? (candidate as ZodToJSONSchema) : null;
  } catch {
    cachedZodToJSONSchema = null;
  }
  return cachedZodToJSONSchema;
};

const INPUT_SCHEMA_METADATA_KEYS = [
  HttpMetadata.Data,
  HttpMetadata.Query,
  HttpMetadata.Params,
  HttpMetadata.Headers,
  HttpMetadata.Files,
] as const;

const serializeSchema = (schema: unknown): unknown => {
  const toJSONSchema = resolveZodToJSONSchema();
  if (toJSONSchema) {
    try {
      return toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
    } catch {
      // fall through to the opaque marker below
    }
  }
  // The schema cannot be serialized (non-zod schema, exotic zod type or zod
  // not installed). Contribute a stable marker so the hash still reflects
  // that *a* schema constraint exists on this slot.
  return { __unserializableSchema: true };
};

/**
 * Serializes the zod input schemas attached to an operator-decorated handler
 * (`Data`/`Query`/`Params`/`Headers`/`Upload` metadata) into JSON-schema
 * documents. Returns `undefined` for handlers without schema metadata
 * (plain handlers, farrow schema-mode handlers).
 */
export const serializeOperationSchemas = (
  handler: ApiHandler | undefined,
): Record<string, unknown> | undefined => {
  if (typeof handler !== 'function') {
    return undefined;
  }
  const serialized: Record<string, unknown> = {};
  for (const metadataKey of INPUT_SCHEMA_METADATA_KEYS) {
    let schema: unknown;
    try {
      schema = Reflect.getMetadata(metadataKey, handler);
    } catch {
      schema = undefined;
    }
    if (typeof schema === 'undefined' || schema === null) {
      continue;
    }
    serialized[metadataKey] = serializeSchema(schema);
  }
  return Object.keys(serialized).length > 0 ? serialized : undefined;
};

export type OperationContractHashInput = OperationContractEntry & {
  /** Serialized schema documents; omit for schema-less operations. */
  schemas?: Record<string, unknown> | undefined;
};

/**
 * Per-operation contract hash. The hash covers the operation identity
 * (name, method, route, producer requestId) plus the serialized input
 * schemas, so:
 *
 * - changing an input schema changes the hash of exactly that operation;
 * - reordering routes or adding unrelated operations never rotates the hash
 *   of other operations (each operation is hashed independently).
 */
export const createOperationContractHash = (
  operation: OperationContractHashInput,
  requestId: string,
): string =>
  sha256(
    stableStringify({
      httpMethod: String(operation.httpMethod || '').toUpperCase(),
      name: operation.name,
      requestId,
      routePath: operation.routePath,
      ...(operation.schemas ? { schemas: operation.schemas } : {}),
    }),
  );

export const createOperationEntries = (
  handlers: Array<{
    name: string;
    httpMethod: string;
    routePath: string;
  }>,
): OperationContractEntry[] =>
  handlers
    .map(item => ({
      name: item.name,
      httpMethod: String(item.httpMethod || '').toUpperCase(),
      routePath: item.routePath,
    }))
    .sort((a, b) => {
      const keyA = `${a.routePath}:${a.httpMethod}:${a.name}`;
      const keyB = `${b.routePath}:${b.httpMethod}:${b.name}`;
      return keyA.localeCompare(keyB);
    });

/**
 * Aggregate hash over a set of per-operation contract hashes. Used for the
 * module-level `operationSchemaHash` manifest export; stable across route
 * reordering because the per-operation hashes are sorted before hashing.
 */
export const createOperationSchemaHash = (
  operationEntries: Array<OperationContractEntry & { schemaHash?: string }>,
  requestId: string,
): string =>
  sha256(
    stableStringify({
      operations: [...operationEntries]
        .map(item => ({
          hash:
            item.schemaHash ??
            createOperationContractHash(
              {
                name: item.name,
                httpMethod: item.httpMethod,
                routePath: item.routePath,
              },
              requestId,
            ),
        }))
        .sort((a, b) => a.hash.localeCompare(b.hash)),
      requestId,
    }),
  );

export type OperationContractSource = {
  name: string;
  httpMethod: string;
  routePath: string;
  filename?: string;
  /**
   * Optional handler function used to serialize schema metadata. Sources
   * without a handler (e.g. reflected Effect HttpApi endpoints) hash the
   * route identity only.
   */
  handler?: ApiHandler;
};

export const buildOperationContractMap = ({
  handlers,
  requestId,
  operationVersion,
}: {
  handlers: OperationContractSource[];
  requestId?: string;
  /**
   * Producer contract version, usually `deriveOperationVersion(pkg.version)`.
   * Defaults to {@link DEFAULT_OPERATION_VERSION}.
   */
  operationVersion?: number;
}): OperationContractMap => {
  const normalizedRequestId =
    typeof requestId === 'string' && requestId.trim().length > 0
      ? requestId.trim()
      : 'default';
  const normalizedOperationVersion =
    typeof operationVersion === 'number' && Number.isInteger(operationVersion)
      ? operationVersion
      : DEFAULT_OPERATION_VERSION;

  const contracts: OperationContractMap = {};
  handlers.forEach(item => {
    const httpMethod = String(item.httpMethod || '').toUpperCase();
    const schemaHash = createOperationContractHash(
      {
        name: item.name,
        httpMethod,
        routePath: item.routePath,
        schemas: serializeOperationSchemas(item.handler),
      },
      normalizedRequestId,
    );
    const operationId = `${normalizedRequestId}:${item.name}`;
    const contract: OperationContractDefinition = {
      requestId: normalizedRequestId,
      operationVersion: normalizedOperationVersion,
      schemaHash,
      method: httpMethod,
      routePath: item.routePath,
      operationId,
      handlerName: item.name,
      filename: item.filename,
    };
    contracts[`${httpMethod}:${item.routePath}`] = contract;
    contracts[`operation:${operationId}`] = contract;
  });

  return contracts;
};
