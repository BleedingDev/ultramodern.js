const DEFAULT_ENVELOPE_HEADER = 'x-modernjs-bff-envelope';
const DEFAULT_OPERATION_CONTEXT_HEADER = 'x-operation-id';
const DEFAULT_DENY_STATUS = 403;

export interface CrossProjectPolicyConfig {
  enabled?: boolean;
  requireEnvelope?: boolean;
  requireOperationContext?: boolean;
  allowedNamespaces?: string[];
  envelopeHeader?: string;
  operationContextHeader?: string;
  denyStatus?: number;
}

export interface CrossProjectPolicyViolation {
  code: 'BFF_CROSS_PROJECT_POLICY_DENIED';
  reason:
    | 'missing_envelope'
    | 'invalid_envelope'
    | 'missing_request_id'
    | 'namespace_not_allowed'
    | 'missing_operation_context'
    | 'operation_context_mismatch';
  message: string;
  status: number;
}

const normalizeHeaderName = (headerName: string | undefined, fallback: string) =>
  (headerName || fallback).trim().toLowerCase();

const normalizeStatusCode = (statusCode: number | undefined) => {
  if (
    typeof statusCode === 'number' &&
    Number.isFinite(statusCode) &&
    statusCode >= 400 &&
    statusCode <= 599
  ) {
    return Math.floor(statusCode);
  }
  return DEFAULT_DENY_STATUS;
};

const readHeader = (
  headers: Record<string, unknown>,
  headerName: string,
): string | undefined => {
  const lowerHeaderName = headerName.toLowerCase();
  for (const [name, value] of Object.entries(headers || {})) {
    if (name.toLowerCase() !== lowerHeaderName) {
      continue;
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? String(value[0]) : undefined;
    }
    if (typeof value === 'undefined' || value === null) {
      return undefined;
    }
    return String(value);
  }
  return undefined;
};

const extractNamespace = (requestId: string) =>
  requestId.split(/[/:.]/)[0]?.trim().toLowerCase();

const createViolation = (
  reason: CrossProjectPolicyViolation['reason'],
  message: string,
  status: number,
): CrossProjectPolicyViolation => ({
  code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
  reason,
  message,
  status,
});

export const evaluateCrossProjectPolicy = (
  headers: Record<string, unknown>,
  policy?: CrossProjectPolicyConfig,
): CrossProjectPolicyViolation | null => {
  if (!policy?.enabled) {
    return null;
  }

  const status = normalizeStatusCode(policy.denyStatus);
  const requireEnvelope = policy.requireEnvelope ?? true;
  const requireOperationContext = policy.requireOperationContext ?? true;
  const envelopeHeader = normalizeHeaderName(
    policy.envelopeHeader,
    DEFAULT_ENVELOPE_HEADER,
  );
  const operationContextHeader = normalizeHeaderName(
    policy.operationContextHeader,
    DEFAULT_OPERATION_CONTEXT_HEADER,
  );

  const envelopeRaw = readHeader(headers, envelopeHeader);
  if (!envelopeRaw) {
    if (!requireEnvelope) {
      return null;
    }
    return createViolation(
      'missing_envelope',
      `Missing cross-project envelope header "${envelopeHeader}"`,
      status,
    );
  }

  let envelope: Record<string, unknown>;
  try {
    const parsed = JSON.parse(envelopeRaw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('invalid envelope object');
    }
    envelope = parsed as Record<string, unknown>;
  } catch (_error) {
    return createViolation(
      'invalid_envelope',
      `Invalid cross-project envelope header "${envelopeHeader}"`,
      status,
    );
  }

  const requestId = String(envelope.requestId || '').trim();
  if (!requestId) {
    return createViolation(
      'missing_request_id',
      'Cross-project envelope does not include a valid requestId',
      status,
    );
  }

  const namespaces = (policy.allowedNamespaces || [])
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  if (namespaces.length > 0) {
    const namespace = extractNamespace(requestId);
    if (!namespace || !namespaces.includes(namespace)) {
      return createViolation(
        'namespace_not_allowed',
        `Producer namespace "${namespace || 'unknown'}" is not allowed`,
        status,
      );
    }
  }

  if (requireOperationContext) {
    const operationContext = readHeader(headers, operationContextHeader);
    if (!operationContext) {
      return createViolation(
        'missing_operation_context',
        `Missing operation context header "${operationContextHeader}"`,
        status,
      );
    }

    if (!operationContext.startsWith(`${requestId}:`)) {
      return createViolation(
        'operation_context_mismatch',
        `Operation context header "${operationContextHeader}" does not match requestId "${requestId}"`,
        status,
      );
    }
  }

  return null;
};
