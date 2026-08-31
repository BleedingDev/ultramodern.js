// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import type {
  CacheScope,
  DataRequestMode,
  OperationDescriptor,
  RequestEnvelope,
  SelectionPlan,
} from './types';

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => canonicalize(item));
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function encodeRequestEnvelopeHeader(envelope: RequestEnvelope): string {
  return encodeURIComponent(stableStringify(envelope));
}

function isRequestEnvelopeShape(value: unknown): value is RequestEnvelope {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    value.protocolVersion === 1 &&
    typeof value.operationId === 'string' &&
    typeof value.appNamespace === 'string' &&
    typeof value.origin === 'string' &&
    typeof value.scopeKey === 'string' &&
    typeof value.inputHash === 'string' &&
    typeof value.timestamp === 'number'
  );
}

export function decodeRequestEnvelopeHeader(
  value: string,
): RequestEnvelope | null {
  try {
    const decoded = decodeURIComponent(value);
    const parsed = JSON.parse(decoded);
    if (!isRequestEnvelopeShape(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function sanitizeSegment(segment: string): string {
  const normalized = segment.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
  return normalized.length > 0 ? normalized : 'unknown';
}

export function normalizeOrigin(origin: string): string {
  const normalized = origin.trim();
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

function normalizeOperationDescriptor(input: OperationDescriptor) {
  return {
    appNamespace: sanitizeSegment(input.appNamespace),
    apiId: sanitizeSegment(input.apiId),
    group: sanitizeSegment(input.group),
    endpoint: sanitizeSegment(input.endpoint),
    schemaHash: input.schemaHash || null,
    version: input.version ?? 1,
  };
}

export function createOperationId(input: OperationDescriptor): string {
  const descriptor = normalizeOperationDescriptor(input);
  const readable = `${descriptor.appNamespace}.${descriptor.apiId}.${descriptor.group}.${descriptor.endpoint}.v${String(descriptor.version)}`;
  return `${readable}:${hashString(stableStringify(descriptor))}`;
}

export function buildScopeKey(scope: CacheScope): string {
  const canonical = {
    appNamespace: sanitizeSegment(scope.appNamespace),
    origin: normalizeOrigin(scope.origin),
    tenantId: scope.tenantId ?? null,
    userId: scope.userId ?? null,
    sessionId: scope.sessionId ?? null,
  };
  return `${canonical.appNamespace}:${hashString(stableStringify(canonical))}`;
}

export function buildQueryKey(input: {
  operationId: string;
  scopeKey: string;
  requestMode?: DataRequestMode;
  requestInput?: unknown;
  selectionPlan?: SelectionPlan;
}): string {
  const canonical = {
    operationId: input.operationId,
    scopeKey: input.scopeKey,
    requestMode: input.requestMode ?? 'cache-first',
    requestInput: input.requestInput ?? null,
    selectionPlan: input.selectionPlan ?? null,
  };

  return `${input.operationId}:${hashString(stableStringify(canonical))}`;
}
