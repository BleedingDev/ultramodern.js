import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createSuperAppWorkloadChaosFailureTaxonomy,
  type WorkloadChaosFailureCase,
} from '../shared/workload-chaos-failure-taxonomy';
import {
  createSuperAppChaosMatrixArtifact,
  type SuperAppChaosMatrixObservation,
  serializeSuperAppChaosMatrixArtifact,
} from '../shared/workload-chaos-matrix-artifact';

const artifactDir = '/tmp/modernjs-superapp-chaos-matrix-artifact';

function passingObservation(
  failure: WorkloadChaosFailureCase,
): SuperAppChaosMatrixObservation {
  return {
    failureId: failure.id,
    actualStatus: {
      httpStatus: failure.expectedStatus.httpStatus,
      applicationStatus: failure.expectedStatus.applicationStatus,
      responseKind: failure.expectedStatus.responseKind,
      requestId: failure.deterministicInput.requestId,
      errorCode: failure.expectedErrorEnvelope.code,
    },
    cleanupResult: {
      resetRequired: failure.resetExpectation.required,
      resetInvoked: true,
      healthyFollowUpStatus: 200,
      postResetStatus: failure.resetExpectation.expectedPostResetStatus,
      sharedStatePoisoned: false,
      passed: true,
    },
    telemetryRedactionResult: {
      checked: true,
      redactedAttributes: failure.telemetryRedaction.redactedAttributes,
      forbiddenRawSubstringsPresent: [],
      forbiddenFieldsPresent: [],
      passed: true,
    },
  };
}

describe('superapp chaos matrix artifact', () => {
  afterEach(() => {
    rmSync(artifactDir, { recursive: true, force: true });
  });

  test('derives rows, summary, and status from taxonomy observations', () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();
    const observations = taxonomy.failures.map(failure =>
      passingObservation(failure),
    );
    const first = createSuperAppChaosMatrixArtifact({
      taxonomy,
      observations,
    });
    const second = createSuperAppChaosMatrixArtifact({
      taxonomy,
      observations,
    });

    expect(first).toEqual(second);
    expect(first.fingerprint).toMatch(/^fnv1a-[0-9a-f]{8}$/);
    expect(first.taxonomyVersion).toBe(taxonomy.taxonomyVersion);
    expect(first.taxonomyFingerprint).toBe(taxonomy.fingerprint);
    expect(first.status).toBe('passed');
    expect(first.summary).toEqual({
      rowCount: taxonomy.failures.length,
      passedRows: taxonomy.failures.length,
      failedRows: 0,
      cleanupPassedRows: taxonomy.failures.length,
      telemetryRedactionPassedRows: taxonomy.failures.length,
    });
    expect(first.rows.map(row => row.injectedFault.id)).toEqual(
      taxonomy.failureIds,
    );

    for (const [index, row] of first.rows.entries()) {
      const failure = taxonomy.failures[index];

      expect(failure).toBeDefined();
      expect(row.scenario).toMatchObject({
        id: failure.scenarioId,
        profileId: failure.profileId,
        tenantId: failure.tenantId,
        route: failure.route,
        operationHint: failure.operationHint,
        requestId: failure.deterministicInput.requestId,
      });
      expect(row.injectedFault).toMatchObject({
        id: failure.id,
        kind: failure.kind,
        severity: failure.severity,
        resetRequired: failure.resetExpectation.required,
        retryable: failure.expectedStatus.retryable,
      });
      expect(row.expectedStatus).toMatchObject({
        httpStatus: failure.expectedStatus.httpStatus,
        applicationStatus: failure.expectedStatus.applicationStatus,
        responseKind: failure.expectedStatus.responseKind,
        retryable: failure.expectedStatus.retryable,
        errorEnvelopePresent: failure.expectedErrorEnvelope.present,
        errorCode: failure.expectedErrorEnvelope.code,
      });
      expect(row.actualStatus.matchesExpected).toBe(true);
      expect(row.cleanupResult.passed).toBe(true);
      expect(row.telemetryRedactionResult.passed).toBe(true);
    }
  });

  test('serializes compact JSON and reflects failed observations', () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();
    const observations = taxonomy.failures.map(failure =>
      passingObservation(failure),
    );
    const firstObservation = observations[0];

    if (!firstObservation) {
      throw new Error(
        'Expected chaos taxonomy to include at least one failure',
      );
    }

    const failedObservations = [
      {
        ...firstObservation,
        actualStatus: {
          ...firstObservation.actualStatus,
          httpStatus: firstObservation.actualStatus.httpStatus + 1,
        },
        cleanupResult: {
          ...firstObservation.cleanupResult,
          sharedStatePoisoned: true,
          passed: false,
        },
        telemetryRedactionResult: {
          ...firstObservation.telemetryRedactionResult,
          forbiddenRawSubstringsPresent: ['Bearer '],
          passed: false,
        },
      },
      ...observations.slice(1),
    ];
    const artifact = createSuperAppChaosMatrixArtifact({
      taxonomy,
      observations: failedObservations,
    });
    const serialized = serializeSuperAppChaosMatrixArtifact(artifact);
    const artifactPath = path.join(artifactDir, 'chaos-matrix.json');

    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(artifactPath, serialized);

    expect(artifact.status).toBe('failed');
    expect(artifact.summary).toEqual({
      rowCount: taxonomy.failures.length,
      passedRows: taxonomy.failures.length - 1,
      failedRows: 1,
      cleanupPassedRows: taxonomy.failures.length - 1,
      telemetryRedactionPassedRows: taxonomy.failures.length - 1,
    });
    expect(artifact.rows[0]?.actualStatus.matchesExpected).toBe(false);
    expect(artifact.rows[0]?.cleanupResult.sharedStatePoisoned).toBe(true);
    expect(
      artifact.rows[0]?.telemetryRedactionResult.forbiddenRawSubstringsPresent,
    ).toEqual(['Bearer ']);
    expect(serialized).toBe(`${JSON.stringify(JSON.parse(serialized))}\n`);
    expect(serialized).not.toContain('\n ');
    expect(JSON.parse(readFileSync(artifactPath, 'utf8'))).toEqual(artifact);
  });

  test('rejects incomplete observation sets', () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();
    const observations = taxonomy.failures
      .slice(1)
      .map(failure => passingObservation(failure));
    const missingFailure = taxonomy.failures[0];

    if (!missingFailure) {
      throw new Error(
        'Expected chaos taxonomy to include at least one failure',
      );
    }

    expect(() =>
      createSuperAppChaosMatrixArtifact({ taxonomy, observations }),
    ).toThrow(`Missing chaos matrix observation for ${missingFailure.id}`);
  });
});
