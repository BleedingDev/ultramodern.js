/**
 * Cross-project BFF policy evaluator.
 *
 * THREAT MODEL — read before relying on this module:
 *
 * Every header this evaluator inspects (envelope, operation id, operation
 * context details) is constructed by the CLIENT from public, open-source
 * formats. Without an out-of-band identity binding the checks below are a
 * version-skew and misconfiguration gate, not an authentication or
 * authorization boundary: any caller can echo an allowed `requestId` and a
 * matching operation context.
 *
 * To use `allowedNamespaces`, supply
 * {@link CrossProjectPolicyConfig.verifyProducerIdentity}: a server-side
 * hook that derives the producer namespace from a VERIFIED channel (mTLS
 * peer identity, gateway-authenticated JWT claims, service-mesh headers
 * stripped at the edge, ...). Requests fail closed when a namespace allowlist
 * is configured without this hook unless `allowClientAssertedNamespace` is
 * explicitly enabled. That escape hatch keeps legacy local/demo ergonomics:
 * the client-asserted namespace must match the allowlist. When the hook is
 * present, the client-asserted namespace must match the verified namespace
 * and the allowlist is checked against the verified value.
 *
 * Client-side counterparts in `@modern-js/create-request` (identity binding,
 * operation contract validation) are developer-experience aids that fail
 * fast in well-behaved clients; they protect nothing against a malicious
 * caller.
 */
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
  | 'operation_version_mismatch'
  | 'producer_identity_mismatch';

export type CrossProjectPolicyViolation = {
  code: 'BFF_CROSS_PROJECT_POLICY_DENIED';
  reason: CrossProjectPolicyViolationReason;
  message: string;
  status: number;
};

const DEFAULT_DENY_STATUS = 403;
const NAMESPACE_ALLOWLIST_REQUIRES_VERIFIER_MESSAGE =
  'cross-project namespace allowlist requires verifyProducerIdentity';
let hasWarnedAdvisoryNamespaceAllowlist = false;

export interface CrossProjectPolicyConfig {
  enabled?: boolean;
  requireEnvelope?: boolean;
  requireOperationContext?: boolean;
  requireOperationContextDetails?: boolean;
  requireOperationSchemaHash?: boolean;
  requireOperationVersion?: boolean;
  allowedNamespaces?: string[];
  /**
   * Explicit local/demo escape hatch for legacy clients that only provide
   * client-built requestId namespaces. Defaults to false. Enabling this keeps
   * `allowedNamespaces` advisory and must not be used as authorization.
   */
  allowClientAssertedNamespace?: boolean;
  envelopeHeader?: string;
  operationContextHeader?: string;
  operationContextDetailHeader?: string;
  expectedOperationContracts?: Record<string, CrossProjectOperationContract>;
  allowUnknownOperations?: boolean;
  denyStatus?: number;
  /**
   * Server-side hook binding producer namespace to VERIFIED identity
   * channel (mTLS peer, gateway-authenticated JWT, mesh identity headers).
   *
   * When provided, the namespace asserted by the client envelope must match
   * the namespace returned by this hook, and `allowedNamespaces` is checked
   * against the verified value instead of the client-asserted one. Returning
   * `undefined` (identity could not be verified) denies the request.
   *
   * By default, `allowedNamespaces` requires this hook and fails closed
   * without it. Set `allowClientAssertedNamespace` only for local/demo
   * ergonomics where advisory client-asserted namespace checks are acceptable.
   */
  verifyProducerIdentity?: (
    headers: Record<string, unknown>,
  ) => string | undefined;
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

const warnAdvisoryNamespaceAllowlist = () => {
  if (hasWarnedAdvisoryNamespaceAllowlist) {
    return;
  }
  hasWarnedAdvisoryNamespaceAllowlist = true;
  console.warn(
    `[Modern.js BFF] ${NAMESPACE_ALLOWLIST_REQUIRES_VERIFIER_MESSAGE}. ` +
      'allowClientAssertedNamespace=true will continue to evaluate allowlist ' +
      'against client-asserted requestId namespaces only.',
  );
};

type ProducerIdentityVerifier = NonNullable<
  CrossProjectPolicyConfig['verifyProducerIdentity']
>;

type CrossProjectPolicyEvaluationState = {
  headers: Record<string, unknown>;
  policy: CrossProjectPolicyConfig;
  status: number;
  requireEnvelope: boolean;
  requireOperationContext: boolean;
  requireOperationContextDetails: boolean;
  requireOperationSchemaHash: boolean;
  requireOperationVersion: boolean;
  allowUnknownOperations: boolean;
  allowClientAssertedNamespace: boolean;
  verifyProducerIdentity?: ProducerIdentityVerifier;
  allowedNamespaces: string[];
  envelopeHeader: string;
  operationContextHeader: string;
  operationContextDetailHeader: string;
  operationContext?: string;
  requestId: string;
  claimedNamespace?: string;
  effectiveNamespace?: string;
  operationContextDetails?: Record<string, unknown>;
  detailSchemaHash: string;
  detailOperationVersion: unknown;
  complete: boolean;
};

type CrossProjectPolicyCheck = (
  state: CrossProjectPolicyEvaluationState,
) => CrossProjectPolicyViolation | undefined;

const createCrossProjectPolicyEvaluationState = (
  headers: Record<string, unknown>,
  policy: CrossProjectPolicyConfig,
): CrossProjectPolicyEvaluationState => ({
  headers,
  policy,
  status: normalizeStatusCode(policy.denyStatus),
  requireEnvelope: policy.requireEnvelope ?? true,
  requireOperationContext: policy.requireOperationContext ?? true,
  requireOperationContextDetails: policy.requireOperationContextDetails ?? true,
  requireOperationSchemaHash: policy.requireOperationSchemaHash ?? true,
  requireOperationVersion: policy.requireOperationVersion ?? true,
  allowUnknownOperations: policy.allowUnknownOperations ?? false,
  allowClientAssertedNamespace: policy.allowClientAssertedNamespace ?? false,
  verifyProducerIdentity:
    typeof policy.verifyProducerIdentity === 'function'
      ? policy.verifyProducerIdentity
      : undefined,
  allowedNamespaces: (policy.allowedNamespaces || [])
    .map(item => item.trim().toLowerCase())
    .filter(Boolean),
  envelopeHeader: normalizeHeaderName(
    policy.envelopeHeader,
    BFF_ENVELOPE_HEADER,
  ),
  operationContextHeader: normalizeHeaderName(
    policy.operationContextHeader,
    BFF_OPERATION_CONTEXT_HEADER,
  ),
  operationContextDetailHeader: normalizeHeaderName(
    policy.operationContextDetailHeader,
    BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  ),
  requestId: '',
  detailSchemaHash: '',
  detailOperationVersion: undefined,
  complete: false,
});

const checkNamespaceAllowlistVerifier: CrossProjectPolicyCheck = state => {
  if (
    state.allowedNamespaces.length > 0 &&
    state.verifyProducerIdentity === undefined
  ) {
    if (!state.allowClientAssertedNamespace) {
      return createViolation(
        'producer_identity_mismatch',
        NAMESPACE_ALLOWLIST_REQUIRES_VERIFIER_MESSAGE,
        state.status,
      );
    }
    warnAdvisoryNamespaceAllowlist();
  }
  return undefined;
};

const checkEnvelopeHeader: CrossProjectPolicyCheck = state => {
  const envelopeRaw = readHeader(state.headers, state.envelopeHeader);
  if (!envelopeRaw) {
    if (!state.requireEnvelope) {
      state.complete = true;
      return undefined;
    }
    return createViolation(
      'missing_envelope',
      `Missing cross-project envelope header "${state.envelopeHeader}"`,
      state.status,
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
      `Invalid cross-project envelope header "${state.envelopeHeader}"`,
      state.status,
    );
  }

  const requestId = String(envelope.requestId || '').trim();
  if (!requestId) {
    return createViolation(
      'missing_request_id',
      'Cross-project envelope does not include a valid requestId',
      state.status,
    );
  }

  state.requestId = requestId;
  state.claimedNamespace = extractNamespace(requestId);
  state.effectiveNamespace = state.claimedNamespace;
  return undefined;
};

const checkProducerIdentity: CrossProjectPolicyCheck = state => {
  if (!state.verifyProducerIdentity) {
    return undefined;
  }

  const verifiedNamespaceRaw = state.verifyProducerIdentity(state.headers);
  const verifiedNamespace =
    typeof verifiedNamespaceRaw === 'string'
      ? verifiedNamespaceRaw.trim().toLowerCase()
      : undefined;
  if (!verifiedNamespace) {
    return createViolation(
      'producer_identity_mismatch',
      'Producer identity could not be verified for request',
      state.status,
    );
  }
  if (verifiedNamespace !== state.claimedNamespace) {
    return createViolation(
      'producer_identity_mismatch',
      `Envelope namespace "${state.claimedNamespace || 'unknown'}" does not match verified producer identity "${verifiedNamespace}"`,
      state.status,
    );
  }

  // From here on, authorization decisions use verified namespace, not
  // the client-asserted envelope value.
  state.effectiveNamespace = verifiedNamespace;
  return undefined;
};

const checkNamespaceAllowlist: CrossProjectPolicyCheck = state => {
  if (state.allowedNamespaces.length > 0) {
    if (
      !state.effectiveNamespace ||
      !state.allowedNamespaces.includes(state.effectiveNamespace)
    ) {
      return createViolation(
        'namespace_not_allowed',
        `Producer namespace "${state.effectiveNamespace || 'unknown'}" not allowed`,
        state.status,
      );
    }
  }
  return undefined;
};

const checkOperationContext: CrossProjectPolicyCheck = state => {
  if (!state.requireOperationContext) {
    state.complete = true;
    return undefined;
  }

  const operationContext = readHeader(
    state.headers,
    state.operationContextHeader,
  );
  if (!operationContext) {
    return createViolation(
      'missing_operation_context',
      `Missing operation context header "${state.operationContextHeader}"`,
      state.status,
    );
  }
  if (!operationContext.startsWith(`${state.requestId}:`)) {
    return createViolation(
      'operation_context_mismatch',
      `Operation context header "${state.operationContextHeader}" does not match requestId "${state.requestId}"`,
      state.status,
    );
  }
  state.operationContext = operationContext;
  return undefined;
};

const checkOperationContextDetails: CrossProjectPolicyCheck = state => {
  const operationContextDetailsRaw = readHeader(
    state.headers,
    state.operationContextDetailHeader,
  );
  if (!operationContextDetailsRaw) {
    if (state.requireOperationContextDetails) {
      return createViolation(
        'missing_operation_context_details',
        `Missing operation context details header "${state.operationContextDetailHeader}"`,
        state.status,
      );
    }
    state.complete = true;
    return undefined;
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
      `Invalid operation context details header "${state.operationContextDetailHeader}"`,
      state.status,
    );
  }

  const detailRequestId = String(
    operationContextDetails.requestId || '',
  ).trim();
  if (detailRequestId && detailRequestId !== state.requestId) {
    return createViolation(
      'operation_context_details_request_id_mismatch',
      `Operation context details requestId "${detailRequestId}" does not match envelope requestId "${state.requestId}"`,
      state.status,
    );
  }
  const detailOperationId = String(
    operationContextDetails.operationId || '',
  ).trim();
  if (
    state.operationContext &&
    detailOperationId &&
    detailOperationId !== state.operationContext
  ) {
    return createViolation(
      'operation_context_mismatch',
      `Operation context details operationId "${detailOperationId}" does not match operation context "${state.operationContext}"`,
      state.status,
    );
  }

  state.operationContextDetails = operationContextDetails;
  state.detailSchemaHash = String(
    operationContextDetails.schemaHash || '',
  ).trim();
  if (state.requireOperationSchemaHash && !state.detailSchemaHash) {
    return createViolation(
      'missing_operation_schema_hash',
      `Operation context details header "${state.operationContextDetailHeader}" must include schemaHash`,
      state.status,
    );
  }

  state.detailOperationVersion = operationContextDetails.operationVersion;
  if (
    state.requireOperationVersion &&
    typeof state.detailOperationVersion !== 'number'
  ) {
    return createViolation(
      'missing_operation_version',
      `Operation context details header "${state.operationContextDetailHeader}" must include operationVersion`,
      state.status,
    );
  }

  return undefined;
};

const checkOperationContract: CrossProjectPolicyCheck = state => {
  if (!state.operationContextDetails) {
    return undefined;
  }

  const expectedContracts = state.policy.expectedOperationContracts;
  if (expectedContracts && typeof expectedContracts === 'object') {
    const method = String(
      state.operationContextDetails.method || '',
    ).toUpperCase();
    const routePath = String(
      state.operationContextDetails.routePath || '',
    ).trim();
    const operationId = String(
      state.operationContextDetails.operationId || '',
    ).trim();
    const expectedContract =
      expectedContracts[`${method}:${routePath}`] ||
      expectedContracts[`operation:${operationId}`];

    if (!expectedContract) {
      if (!state.allowUnknownOperations) {
        return createViolation(
          'unknown_operation_contract',
          `No expected operation contract found for operation "${operationId || `${method}:${routePath}`}"`,
          state.status,
        );
      }
    } else {
      if (
        expectedContract.schemaHash &&
        state.detailSchemaHash &&
        expectedContract.schemaHash !== state.detailSchemaHash
      ) {
        return createViolation(
          'operation_schema_hash_mismatch',
          `Operation schema hash mismatch for "${operationId || `${method}:${routePath}`}"`,
          state.status,
        );
      }
      if (
        typeof expectedContract.operationVersion === 'number' &&
        typeof state.detailOperationVersion === 'number' &&
        expectedContract.operationVersion !== state.detailOperationVersion
      ) {
        return createViolation(
          'operation_version_mismatch',
          `Operation version mismatch for "${operationId || `${method}:${routePath}`}"`,
          state.status,
        );
      }
    }
  }

  return undefined;
};

const CROSS_PROJECT_POLICY_CHECKS: CrossProjectPolicyCheck[] = [
  checkNamespaceAllowlistVerifier,
  checkEnvelopeHeader,
  checkProducerIdentity,
  checkNamespaceAllowlist,
  checkOperationContext,
  checkOperationContextDetails,
  checkOperationContract,
];

export const evaluateCrossProjectPolicy = (
  headers: Record<string, unknown>,
  policy?: CrossProjectPolicyConfig,
): CrossProjectPolicyViolation | null => {
  if (!policy?.enabled) {
    return null;
  }

  const state = createCrossProjectPolicyEvaluationState(headers, policy);
  for (const check of CROSS_PROJECT_POLICY_CHECKS) {
    const violation = check(state);
    if (violation) {
      return violation;
    }
    if (state.complete) {
      return null;
    }
  }

  return null;
};
