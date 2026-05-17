// @effect-diagnostics strictBooleanExpressions:off
import {
  getWorkloadChaosFailureCase,
  SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS,
  type WorkloadChaosExpectedStatus,
  type WorkloadChaosFailureCase,
  type WorkloadChaosFailureErrorCode,
  type WorkloadChaosFailureId,
  type WorkloadChaosFailureKind,
} from './workload-chaos-failure-taxonomy.js';

export const SUPERAPP_LEGACY_FAILURE_MODES = [
  'remote-down',
  'api-timeout',
  'chunk-404',
] as const;

export const SUPERAPP_CHAOS_TOGGLE_SCOPES = ['request', 'until-reset'] as const;

export const SUPERAPP_CHAOS_TOGGLE_ENDPOINTS = [
  'portfolio.workflow',
  'portfolio.pilot',
  'portfolio.security',
] as const;

export type SuperAppLegacyFailureMode =
  (typeof SUPERAPP_LEGACY_FAILURE_MODES)[number];

export type SuperAppChaosToggleScope =
  (typeof SUPERAPP_CHAOS_TOGGLE_SCOPES)[number];

export type SuperAppChaosToggleEndpoint =
  (typeof SUPERAPP_CHAOS_TOGGLE_ENDPOINTS)[number];

export type SuperAppChaosToggleStatus = 'armed' | 'consumed';

export type SuperAppChaosToggleDescriptor = {
  id: WorkloadChaosFailureId;
  kind: WorkloadChaosFailureKind;
  status: SuperAppChaosToggleStatus;
  scope: SuperAppChaosToggleScope;
  targetRequestId: string;
  targetEndpoint: SuperAppChaosToggleEndpoint;
  expectedHttpStatus: number;
  responseKind: WorkloadChaosExpectedStatus['responseKind'];
  applicationStatus: WorkloadChaosExpectedStatus['applicationStatus'];
  errorCode: WorkloadChaosFailureErrorCode;
  messageKey: string;
  retryable: boolean;
  resetRequired: boolean;
  retryAfterMs?: number;
  armedBy: string;
  reason: string;
  armedAtEventId: string;
  idempotencyKey: string;
  payloadSeed: string;
  attemptCount: number;
  clockOffsetMs: number;
  legacyFailureMode?: SuperAppLegacyFailureMode;
};

export type SuperAppChaosFailureEnvelope = {
  error: {
    code: WorkloadChaosFailureErrorCode;
    message: string;
    messageKey: string;
    requestId: string;
    failureId: WorkloadChaosFailureId;
    kind: WorkloadChaosFailureKind;
    tenantId: string;
    retryable: boolean;
    resetRequired: boolean;
    httpStatus: number;
    applicationStatus: WorkloadChaosExpectedStatus['applicationStatus'];
    responseKind: WorkloadChaosExpectedStatus['responseKind'];
    retryAfterMs?: number;
  };
  chaos: SuperAppChaosToggleDescriptor;
};

export function isSuperAppLegacyFailureMode(
  value: string,
): value is SuperAppLegacyFailureMode {
  return (SUPERAPP_LEGACY_FAILURE_MODES as readonly string[]).includes(value);
}

export function isWorkloadChaosFailureId(
  value: string,
): value is WorkloadChaosFailureId {
  return (SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS as readonly string[]).includes(
    value,
  );
}

export function getRequiredWorkloadChaosFailureCase(
  id: WorkloadChaosFailureId,
): WorkloadChaosFailureCase {
  const failure = getWorkloadChaosFailureCase(id);
  if (!failure) {
    throw new Error(`Unknown workload chaos failure id: ${id}`);
  }

  return failure;
}

export function defaultEndpointForChaosFailure(
  failure: WorkloadChaosFailureCase,
): SuperAppChaosToggleEndpoint {
  if (failure.kind === 'auth-expiry' || failure.kind === 'tenant-violation') {
    return 'portfolio.security';
  }

  if (
    failure.kind === 'partial-module-error' ||
    failure.kind === 'stale-remote-manifest' ||
    failure.kind === 'down-remote'
  ) {
    return 'portfolio.pilot';
  }

  return 'portfolio.workflow';
}

export function legacyFailureModeForChaosFailure(
  failure: WorkloadChaosFailureCase,
): SuperAppLegacyFailureMode | undefined {
  if (
    failure.kind === 'stale-remote-manifest' ||
    failure.kind === 'down-remote'
  ) {
    return 'remote-down';
  }

  if (failure.kind === 'downstream-timeout') {
    return 'api-timeout';
  }

  return undefined;
}

export function createSuperAppChaosToggleDescriptor(input: {
  id: WorkloadChaosFailureId;
  scope?: SuperAppChaosToggleScope;
  targetRequestId?: string;
  targetEndpoint?: SuperAppChaosToggleEndpoint;
  armedBy: string;
  reason: string;
  armedAtEventId: string;
}): SuperAppChaosToggleDescriptor {
  const failure = getRequiredWorkloadChaosFailureCase(input.id);
  const expectedStatus = failure.expectedStatus;

  return {
    id: failure.id,
    kind: failure.kind,
    status: 'armed',
    scope: input.scope ?? 'request',
    targetRequestId:
      input.targetRequestId ?? failure.deterministicInput.requestId,
    targetEndpoint:
      input.targetEndpoint ?? defaultEndpointForChaosFailure(failure),
    expectedHttpStatus: expectedStatus.httpStatus,
    responseKind: expectedStatus.responseKind,
    applicationStatus: expectedStatus.applicationStatus,
    errorCode: failure.expectedErrorEnvelope.code,
    messageKey: failure.expectedErrorEnvelope.messageKey,
    retryable: expectedStatus.retryable,
    resetRequired: failure.resetExpectation.required,
    retryAfterMs: expectedStatus.retryAfterMs,
    armedBy: input.armedBy,
    reason: input.reason,
    armedAtEventId: input.armedAtEventId,
    idempotencyKey: failure.deterministicInput.idempotencyKey,
    payloadSeed: failure.deterministicInput.payloadSeed,
    attemptCount: failure.deterministicInput.attemptCount,
    clockOffsetMs: failure.deterministicInput.clockOffsetMs,
    legacyFailureMode: legacyFailureModeForChaosFailure(failure),
  };
}

export function createSuperAppChaosFailureEnvelope(input: {
  toggle: SuperAppChaosToggleDescriptor;
  requestId: string;
  tenantId: string;
}): SuperAppChaosFailureEnvelope {
  const failure = getRequiredWorkloadChaosFailureCase(input.toggle.id);
  const error = {
    code: input.toggle.errorCode,
    message: failure.label,
    messageKey: input.toggle.messageKey,
    requestId: input.requestId,
    failureId: input.toggle.id,
    kind: input.toggle.kind,
    tenantId: input.tenantId,
    retryable: input.toggle.retryable,
    resetRequired: input.toggle.resetRequired,
    httpStatus: input.toggle.expectedHttpStatus,
    applicationStatus: input.toggle.applicationStatus,
    responseKind: input.toggle.responseKind,
    ...(input.toggle.retryAfterMs
      ? { retryAfterMs: input.toggle.retryAfterMs }
      : {}),
  };

  return {
    error,
    chaos: {
      ...input.toggle,
      status: 'consumed',
    },
  };
}
