// @effect-diagnostics strictBooleanExpressions:off
import {
  createSuperAppWorkloadChaosFailureTaxonomy,
  type WorkloadChaosExpectedStatus,
  type WorkloadChaosFailureCase,
  type WorkloadChaosFailureErrorCode,
  type WorkloadChaosFailureId,
  type WorkloadChaosFailureKind,
  type WorkloadChaosFailureSeverity,
  type WorkloadChaosFailureTaxonomy,
  type WorkloadChaosTelemetryRedactionExpectation,
} from './workload-chaos-failure-taxonomy.js';
import type {
  WorkloadScenarioId,
  WorkloadTenantId,
} from './workload-domain-catalog.js';
import type { WorkloadScenarioProfileId } from './workload-scenario-profiles.js';

export type SuperAppChaosMatrixArtifactStatus = 'passed' | 'failed';

export type SuperAppChaosMatrixExpectedStatus = WorkloadChaosExpectedStatus & {
  errorEnvelopePresent: boolean;
  errorCode: WorkloadChaosFailureErrorCode;
};

export type SuperAppChaosMatrixActualStatus = {
  httpStatus: number;
  applicationStatus: WorkloadChaosExpectedStatus['applicationStatus'];
  responseKind: WorkloadChaosExpectedStatus['responseKind'];
  requestId: string;
  errorCode?: WorkloadChaosFailureErrorCode;
  matchesExpected: boolean;
};

export type SuperAppChaosMatrixCleanupResult = {
  resetRequired: boolean;
  resetInvoked: boolean;
  healthyFollowUpStatus: number;
  postResetStatus: number;
  sharedStatePoisoned: boolean;
  passed: boolean;
};

export type SuperAppChaosMatrixTelemetryRedactionResult = {
  checked: boolean;
  redactedAttributes: WorkloadChaosTelemetryRedactionExpectation['redactedAttributes'];
  forbiddenRawSubstringsPresent: string[];
  forbiddenFieldsPresent: string[];
  passed: boolean;
};

export type SuperAppChaosMatrixObservation = {
  failureId: WorkloadChaosFailureId;
  actualStatus: Omit<SuperAppChaosMatrixActualStatus, 'matchesExpected'>;
  cleanupResult: SuperAppChaosMatrixCleanupResult;
  telemetryRedactionResult: SuperAppChaosMatrixTelemetryRedactionResult;
};

export type SuperAppChaosMatrixScenario = {
  id: WorkloadScenarioId;
  profileId: WorkloadScenarioProfileId;
  tenantId: WorkloadTenantId;
  route: string;
  operationHint: string;
  requestId: string;
};

export type SuperAppChaosMatrixInjectedFault = {
  id: WorkloadChaosFailureId;
  kind: WorkloadChaosFailureKind;
  label: string;
  severity: WorkloadChaosFailureSeverity;
  resetRequired: boolean;
  retryable: boolean;
};

export type SuperAppChaosMatrixRow = {
  scenario: SuperAppChaosMatrixScenario;
  injectedFault: SuperAppChaosMatrixInjectedFault;
  expectedStatus: SuperAppChaosMatrixExpectedStatus;
  actualStatus: SuperAppChaosMatrixActualStatus;
  cleanupResult: SuperAppChaosMatrixCleanupResult;
  telemetryRedactionResult: SuperAppChaosMatrixTelemetryRedactionResult;
};

export type SuperAppChaosMatrixSummary = {
  rowCount: number;
  passedRows: number;
  failedRows: number;
  cleanupPassedRows: number;
  telemetryRedactionPassedRows: number;
};

export type SuperAppChaosMatrixArtifact = {
  artifactVersion: 'superapp-chaos-matrix-artifact-v1';
  artifactSeed: 'superapp-portfolio-chaos-matrix-artifact-v1';
  taxonomyVersion: WorkloadChaosFailureTaxonomy['taxonomyVersion'];
  taxonomyFingerprint: string;
  fingerprint: string;
  status: SuperAppChaosMatrixArtifactStatus;
  summary: SuperAppChaosMatrixSummary;
  rows: SuperAppChaosMatrixRow[];
};

type SuperAppChaosMatrixArtifactInput = {
  taxonomy?: WorkloadChaosFailureTaxonomy;
  observations: SuperAppChaosMatrixObservation[];
};

const ARTIFACT_VERSION = 'superapp-chaos-matrix-artifact-v1' as const;
const ARTIFACT_SEED = 'superapp-portfolio-chaos-matrix-artifact-v1' as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function fingerprintFor(value: unknown) {
  const input = stableStringify(value);
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function indexObservations(
  observations: SuperAppChaosMatrixObservation[],
): Map<WorkloadChaosFailureId, SuperAppChaosMatrixObservation> {
  const indexed = new Map<
    WorkloadChaosFailureId,
    SuperAppChaosMatrixObservation
  >();

  for (const observation of observations) {
    if (indexed.has(observation.failureId)) {
      throw new Error(
        `Duplicate chaos matrix observation for ${observation.failureId}`,
      );
    }
    indexed.set(observation.failureId, observation);
  }

  return indexed;
}

function matchesExpectedStatus(
  failure: WorkloadChaosFailureCase,
  actualStatus: SuperAppChaosMatrixObservation['actualStatus'],
) {
  return (
    actualStatus.httpStatus === failure.expectedStatus.httpStatus &&
    actualStatus.applicationStatus ===
      failure.expectedStatus.applicationStatus &&
    actualStatus.responseKind === failure.expectedStatus.responseKind &&
    actualStatus.requestId === failure.deterministicInput.requestId &&
    actualStatus.errorCode === failure.expectedErrorEnvelope.code
  );
}

function expectedStatusFor(
  failure: WorkloadChaosFailureCase,
): SuperAppChaosMatrixExpectedStatus {
  return {
    httpStatus: failure.expectedStatus.httpStatus,
    responseKind: failure.expectedStatus.responseKind,
    applicationStatus: failure.expectedStatus.applicationStatus,
    retryable: failure.expectedStatus.retryable,
    ...(failure.expectedStatus.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: failure.expectedStatus.retryAfterMs }),
    errorEnvelopePresent: failure.expectedErrorEnvelope.present,
    errorCode: failure.expectedErrorEnvelope.code,
  };
}

function rowFor(
  failure: WorkloadChaosFailureCase,
  observation: SuperAppChaosMatrixObservation,
): SuperAppChaosMatrixRow {
  return {
    scenario: {
      id: failure.scenarioId,
      profileId: failure.profileId,
      tenantId: failure.tenantId,
      route: failure.route,
      operationHint: failure.operationHint,
      requestId: failure.deterministicInput.requestId,
    },
    injectedFault: {
      id: failure.id,
      kind: failure.kind,
      label: failure.label,
      severity: failure.severity,
      resetRequired: failure.resetExpectation.required,
      retryable: failure.expectedStatus.retryable,
    },
    expectedStatus: expectedStatusFor(failure),
    actualStatus: {
      httpStatus: observation.actualStatus.httpStatus,
      applicationStatus: observation.actualStatus.applicationStatus,
      responseKind: observation.actualStatus.responseKind,
      requestId: observation.actualStatus.requestId,
      errorCode: observation.actualStatus.errorCode,
      matchesExpected: matchesExpectedStatus(failure, observation.actualStatus),
    },
    cleanupResult: observation.cleanupResult,
    telemetryRedactionResult: observation.telemetryRedactionResult,
  };
}

function artifactStatusFor(
  rows: SuperAppChaosMatrixRow[],
): SuperAppChaosMatrixArtifactStatus {
  return rows.every(
    row =>
      row.actualStatus.matchesExpected &&
      row.cleanupResult.passed &&
      row.telemetryRedactionResult.passed,
  )
    ? 'passed'
    : 'failed';
}

function summaryFor(
  rows: SuperAppChaosMatrixRow[],
): SuperAppChaosMatrixSummary {
  const passedRows = rows.filter(
    row =>
      row.actualStatus.matchesExpected &&
      row.cleanupResult.passed &&
      row.telemetryRedactionResult.passed,
  ).length;

  return {
    rowCount: rows.length,
    passedRows,
    failedRows: rows.length - passedRows,
    cleanupPassedRows: rows.filter(row => row.cleanupResult.passed).length,
    telemetryRedactionPassedRows: rows.filter(
      row => row.telemetryRedactionResult.passed,
    ).length,
  };
}

export function createSuperAppChaosMatrixArtifact(
  input: SuperAppChaosMatrixArtifactInput,
): SuperAppChaosMatrixArtifact {
  const taxonomy =
    input.taxonomy ?? createSuperAppWorkloadChaosFailureTaxonomy();
  const observationsById = indexObservations(input.observations);
  const rows = taxonomy.failures.map(failure => {
    const observation = observationsById.get(failure.id);
    if (!observation) {
      throw new Error(`Missing chaos matrix observation for ${failure.id}`);
    }

    return rowFor(failure, observation);
  });

  if (observationsById.size !== taxonomy.failures.length) {
    const knownIds = new Set(taxonomy.failureIds);
    const unknownIds = [...observationsById.keys()].filter(
      failureId => !knownIds.has(failureId),
    );
    throw new Error(
      `Unknown chaos matrix observation ids: ${unknownIds.join(', ')}`,
    );
  }

  const artifactWithoutFingerprint = {
    artifactVersion: ARTIFACT_VERSION,
    artifactSeed: ARTIFACT_SEED,
    taxonomyVersion: taxonomy.taxonomyVersion,
    taxonomyFingerprint: taxonomy.fingerprint,
    status: artifactStatusFor(rows),
    summary: summaryFor(rows),
    rows,
  };

  return clone({
    ...artifactWithoutFingerprint,
    fingerprint: fingerprintFor(artifactWithoutFingerprint),
  });
}

export function serializeSuperAppChaosMatrixArtifact(
  artifact: SuperAppChaosMatrixArtifact,
) {
  return `${stableStringify(artifact)}\n`;
}
