import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createSuperAppWorkloadChaosFailureTaxonomy,
  type WorkloadChaosFailureCase,
} from '../shared/workload-chaos-failure-taxonomy.js';
import {
  createSuperAppChaosMatrixArtifact,
  type SuperAppChaosMatrixObservation,
  serializeSuperAppChaosMatrixArtifact,
} from '../shared/workload-chaos-matrix-artifact.js';

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
  test('publishes deterministic rows with scenario, fault, status, cleanup, and redaction results', () => {
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
    expect(first).toMatchObject({
      artifactVersion: 'superapp-chaos-matrix-artifact-v1',
      artifactSeed: 'superapp-portfolio-chaos-matrix-artifact-v1',
      taxonomyVersion: 'superapp-workload-chaos-failure-taxonomy-v1',
      taxonomyFingerprint: taxonomy.fingerprint,
      fingerprint: expect.stringMatching(/^fnv1a-[0-9a-f]{8}$/),
      status: 'passed',
      summary: {
        rowCount: 10,
        passedRows: 10,
        failedRows: 0,
        cleanupPassedRows: 10,
        telemetryRedactionPassedRows: 10,
      },
    });
    expect(first.rows).toHaveLength(taxonomy.failures.length);
    expect(first.rows.map(row => row.injectedFault.id)).toEqual(
      taxonomy.failureIds,
    );

    for (const row of first.rows) {
      expect(row).toHaveProperty('scenario');
      expect(row).toHaveProperty('injectedFault');
      expect(row).toHaveProperty('expectedStatus');
      expect(row).toHaveProperty('actualStatus');
      expect(row).toHaveProperty('cleanupResult');
      expect(row).toHaveProperty('telemetryRedactionResult');
      expect(row.actualStatus.matchesExpected).toBe(true);
      expect(row.cleanupResult.passed).toBe(true);
      expect(row.telemetryRedactionResult.passed).toBe(true);
    }

    expect(first.rows[0]).toMatchObject({
      scenario: {
        id: 'fleet-incident-refund',
        profileId: 'write-heavy-order-ledger',
        tenantId: 'city-ops-eu',
        requestId:
          'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:01:downstream:timeout',
      },
      injectedFault: {
        id: 'chaos.downstream-timeout.v1',
        kind: 'downstream-timeout',
        resetRequired: true,
      },
      expectedStatus: {
        httpStatus: 504,
        applicationStatus: 'failed',
        responseKind: 'error-envelope',
        errorEnvelopePresent: true,
        errorCode: 'DOWNSTREAM_TIMEOUT',
      },
      actualStatus: {
        httpStatus: 504,
        applicationStatus: 'failed',
        responseKind: 'error-envelope',
        errorCode: 'DOWNSTREAM_TIMEOUT',
        matchesExpected: true,
      },
      cleanupResult: {
        healthyFollowUpStatus: 200,
        postResetStatus: 200,
        sharedStatePoisoned: false,
      },
      telemetryRedactionResult: {
        checked: true,
        forbiddenRawSubstringsPresent: [],
        forbiddenFieldsPresent: [],
      },
    });
  });

  test('emits compact JSON and records failed actual, cleanup, and redaction results', () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();
    const observations = taxonomy.failures.map(failure =>
      passingObservation(failure),
    );
    observations[0] = {
      ...observations[0],
      actualStatus: {
        ...observations[0].actualStatus,
        httpStatus: 500,
      },
      cleanupResult: {
        ...observations[0].cleanupResult,
        sharedStatePoisoned: true,
        passed: false,
      },
      telemetryRedactionResult: {
        ...observations[0].telemetryRedactionResult,
        forbiddenRawSubstringsPresent: ['Bearer '],
        passed: false,
      },
    };

    const artifact = createSuperAppChaosMatrixArtifact({
      taxonomy,
      observations,
    });
    const serialized = serializeSuperAppChaosMatrixArtifact(artifact);

    rmSync(artifactDir, { force: true, recursive: true });
    mkdirSync(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, 'chaos-matrix.json');
    writeFileSync(artifactPath, serialized);

    expect(artifact.status).toBe('failed');
    expect(artifact.summary).toMatchObject({
      rowCount: 10,
      passedRows: 9,
      failedRows: 1,
      cleanupPassedRows: 9,
      telemetryRedactionPassedRows: 9,
    });
    expect(artifact.rows[0].actualStatus.matchesExpected).toBe(false);
    expect(artifact.rows[0].cleanupResult.sharedStatePoisoned).toBe(true);
    expect(
      artifact.rows[0].telemetryRedactionResult.forbiddenRawSubstringsPresent,
    ).toEqual(['Bearer ']);
    expect(serialized).not.toContain('\n  ');
    expect(JSON.parse(readFileSync(artifactPath, 'utf8'))).toEqual(artifact);
  });

  test('rejects incomplete observation sets', () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();
    const observations = taxonomy.failures
      .slice(1)
      .map(failure => passingObservation(failure));

    expect(() =>
      createSuperAppChaosMatrixArtifact({ taxonomy, observations }),
    ).toThrow(
      'Missing chaos matrix observation for chaos.downstream-timeout.v1',
    );
  });
});
