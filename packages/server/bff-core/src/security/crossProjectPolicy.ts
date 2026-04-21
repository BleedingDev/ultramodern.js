export const BFF_ENVELOPE_HEADER = 'x-modernjs-bff-envelope';
export const BFF_OPERATION_CONTEXT_HEADER = 'x-operation-id';
export const BFF_OPERATION_CONTEXT_DETAIL_HEADER =
  'x-modernjs-bff-operation-context';

export type CrossProjectOperationContract = {
  schemaHash?: string;
  operationVersion?: number;
};

export type CrossProjectPolicyViolationReason =
  | 'missing_envelope'
  | 'invalid_envelope'
  | 'missing_request_id'
  | 'namespace_not_allowed'
  | 'missing_operation_context'
  | 'operation_context_mismatch'
  | 'missing_operation_context_details'
  | 'invalid_operation_context_details'
  | 'operation_context_details_request_id_mismatch'
  | 'missing_operation_schema_hash'
  | 'missing_operation_version'
  | 'unknown_operation_contract'
  | 'operation_schema_hash_mismatch'
  | 'operation_version_mismatch';

export type CrossProjectPolicyViolation = {
  code: 'BFF_CROSS_PROJECT_POLICY_DENIED';
  reason: CrossProjectPolicyViolationReason;
  message: string;
  status: number;
};

const DEFAULT_DENY_STATUS = 403;

export interface CrossProjectPolicyConfig {
  enabled?: boolean;
  requireEnvelope?: boolean;
  requireOperationContext?: boolean;
  requireOperationContextDetails?: boolean;
  requireOperationSchemaHash?: boolean;
  requireOperationVersion?: boolean;
  allowedNamespaces?: string[];
  envelopeHeader?: string;
  operationContextHeader?: string;
  operationContextDetailHeader?: string;
  expectedOperationContracts?: Record<string, CrossProjectOperationContract>;
  allowUnknownOperations?: boolean;
  denyStatus?: number;
}

const normalizeHeaderName = (
  headerName: string | undefined,
  fallback: string,
) => (headerName || fallback).trim().toLowerCase();

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
  const requireOperationContextDetails =
    policy.requireOperationContextDetails ?? true;
  const requireOperationSchemaHash = policy.requireOperationSchemaHash ?? true;
  const requireOperationVersion = policy.requireOperationVersion ?? true;
  const allowUnknownOperations = policy.allowUnknownOperations ?? false;
  const envelopeHeader = normalizeHeaderName(
    policy.envelopeHeader,
    BFF_ENVELOPE_HEADER,
  );
  const operationContextHeader = normalizeHeaderName(
    policy.operationContextHeader,
    BFF_OPERATION_CONTEXT_HEADER,
  );
  const operationContextDetailHeader = normalizeHeaderName(
    policy.operationContextDetailHeader,
    BFF_OPERATION_CONTEXT_DETAIL_HEADER,
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

    const operationContextDetailsRaw = readHeader(
      headers,
      operationContextDetailHeader,
    );

    if (!operationContextDetailsRaw) {
      if (requireOperationContextDetails) {
        return createViolation(
          'missing_operation_context_details',
          `Missing operation context details header "${operationContextDetailHeader}"`,
          status,
        );
      }
      return null;
    }

    let operationContextDetails: Record<string, unknown>;
    try {
      const parsed = JSON.parse(operationContextDetailsRaw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid operation context details object');
      }
      operationContextDetails = parsed as Record<string, unknown>;
    } catch (_error) {
      return createViolation(
        'invalid_operation_context_details',
        `Invalid operation context details header "${operationContextDetailHeader}"`,
        status,
      );
    }

    const detailRequestId = String(
      operationContextDetails.requestId || '',
    ).trim();
    if (detailRequestId && detailRequestId !== requestId) {
      return createViolation(
        'operation_context_details_request_id_mismatch',
        `Operation context details requestId "${detailRequestId}" does not match envelope requestId "${requestId}"`,
        status,
      );
    }

    const detailSchemaHash = String(
      operationContextDetails.schemaHash || '',
    ).trim();
    if (requireOperationSchemaHash && !detailSchemaHash) {
      return createViolation(
        'missing_operation_schema_hash',
        `Operation context details header "${operationContextDetailHeader}" must include schemaHash`,
        status,
      );
    }

    const detailOperationVersion = operationContextDetails.operationVersion;
    if (requireOperationVersion && typeof detailOperationVersion !== 'number') {
      return createViolation(
        'missing_operation_version',
        `Operation context details header "${operationContextDetailHeader}" must include operationVersion`,
        status,
      );
    }

    const expectedContracts = policy.expectedOperationContracts;
    if (
      expectedContracts &&
      typeof expectedContracts === 'object' &&
      Object.keys(expectedContracts).length > 0
    ) {
      const method = String(operationContextDetails.method || '').toUpperCase();
      const routePath = String(operationContextDetails.routePath || '').trim();
      const operationId = String(
        operationContextDetails.operationId || '',
      ).trim();
      const expectedContract =
        expectedContracts[`${method}:${routePath}`] ||
        expectedContracts[`operation:${operationId}`];

      if (!expectedContract) {
        if (!allowUnknownOperations) {
          return createViolation(
            'unknown_operation_contract',
            `No expected operation contract found for operation "${operationId || `${method}:${routePath}`}"`,
            status,
          );
        }
      } else {
        if (
          expectedContract.schemaHash &&
          detailSchemaHash &&
          expectedContract.schemaHash !== detailSchemaHash
        ) {
          return createViolation(
            'operation_schema_hash_mismatch',
            `Operation schema hash mismatch for "${operationId || `${method}:${routePath}`}"`,
            status,
          );
        }
        if (
          typeof expectedContract.operationVersion === 'number' &&
          typeof detailOperationVersion === 'number' &&
          expectedContract.operationVersion !== detailOperationVersion
        ) {
          return createViolation(
            'operation_version_mismatch',
            `Operation version mismatch for "${operationId || `${method}:${routePath}`}"`,
            status,
          );
        }
      }
    }
  }

  return null;
};
