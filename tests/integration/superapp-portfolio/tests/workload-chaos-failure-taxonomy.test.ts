import {
  createSuperAppWorkloadCatalog,
  type WorkloadScenarioConsumerTarget,
} from '../shared/portfolio-state.js';
import {
  createSuperAppWorkloadChaosFailureTaxonomy,
  getWorkloadChaosFailureCase,
  getWorkloadChaosFailuresForConsumerTarget,
  SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS,
} from '../shared/workload-chaos-failure-taxonomy.js';
import { createSuperAppWorkloadScenarioProfileMetadata } from '../shared/workload-scenario-profiles.js';

const expectedStatusById = {
  'chaos.downstream-timeout.v1': 504,
  'chaos.partial-module-error.v1': 207,
  'chaos.stale-remote-manifest.v1': 409,
  'chaos.down-remote.v1': 503,
  'chaos.malformed-json.v1': 400,
  'chaos.auth-expiry.v1': 401,
  'chaos.tenant-violation.v1': 403,
  'chaos.retry-storm.v1': 429,
  'chaos.slow-stream.v1': 504,
  'chaos.duplicate-request.v1': 200,
};

describe('superapp workload chaos failure taxonomy', () => {
  test('publishes a deterministic machine-readable taxonomy', () => {
    const first = createSuperAppWorkloadChaosFailureTaxonomy();
    const second = createSuperAppWorkloadChaosFailureTaxonomy();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      taxonomyVersion: 'superapp-workload-chaos-failure-taxonomy-v1',
      seed: 'superapp-portfolio-chaos-failure-taxonomy-v1',
      fingerprint: expect.stringMatching(/^fnv1a-[0-9a-f]{8}$/),
      failureIds: SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS,
      resetSeed: {
        target: 'chaos',
        scenarioId: 'fleet-incident-refund',
        profileId: 'write-heavy-order-ledger',
        tenantId: 'city-ops-eu',
      },
    });
    expect(first.failures).toHaveLength(10);
    expect(first.failures.map(failure => failure.id)).toEqual(
      SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS,
    );
    expect(
      Object.fromEntries(
        first.failures.map(failure => [
          failure.id,
          failure.expectedStatus.httpStatus,
        ]),
      ),
    ).toEqual(expectedStatusById);
  });

  test('references only catalog tenants, domains, scenarios, modules, and profiles', () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();
    const catalog = createSuperAppWorkloadCatalog();
    const profileMetadata = createSuperAppWorkloadScenarioProfileMetadata();
    const tenantIds = catalog.tenants.map(tenant => tenant.id);
    const scenarioIds = catalog.scenarios.map(scenario => scenario.id);
    const domainIds = catalog.domains.map(domain => domain.id);

    for (const failure of taxonomy.failures) {
      const scenario = catalog.scenarios.find(
        item => item.id === failure.scenarioId,
      );

      expect(scenarioIds).toContain(failure.scenarioId);
      expect(profileMetadata.profileIds).toContain(failure.profileId);
      expect(tenantIds).toContain(failure.tenantId);
      expect(tenantIds).toContain(failure.tenantSafety.sourceTenantId);
      expect(tenantIds).toContain(failure.tenantSafety.targetTenantId);
      expect(
        failure.domainIds.every(domainId => domainIds.includes(domainId)),
      ).toBe(true);
      expect(
        failure.moduleIds.every(moduleId =>
          scenario?.modules.includes(moduleId),
        ),
      ).toBe(true);
      expect(failure.sampleWindowIds.length).toBeGreaterThan(0);
    }
  });

  test('defines envelope, reset, tenant-safety, and redaction expectations for every failure', () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();

    for (const failure of taxonomy.failures) {
      expect(failure.expectedErrorEnvelope.requiredFields).toEqual(
        expect.arrayContaining([
          'error.code',
          'error.message',
          'error.requestId',
          'error.failureId',
          'error.tenantId',
          'error.retryable',
          'error.resetRequired',
        ]),
      );
      expect(failure.expectedErrorEnvelope.forbiddenFields).toEqual(
        expect.arrayContaining([
          'error.stack',
          'error.authorization',
          'error.cookie',
          'error.csrfToken',
          'error.crossTenantRecordIds',
        ]),
      );
      expect(failure.resetExpectation).toMatchObject({
        seedTarget: 'chaos',
        resetEndpoint: 'portfolio.reset',
        restoresFailureMode: 'healthy',
        verifiesHealthyFollowUp: true,
        verifiesNoSharedStatePoisoning: true,
        expectedPostResetStatus: 200,
      });
      expect(failure.tenantSafety).toMatchObject({
        tenantScoped: true,
        requiresTenantHeader: true,
        crossTenantReadsAllowed: false,
        crossTenantMutationsAllowed: false,
        preservesHealthyTenantTraffic: true,
      });
      expect(failure.telemetryRedaction).toMatchObject({
        required: true,
      });
      expect(failure.telemetryRedaction.redactedAttributes).toEqual(
        expect.arrayContaining(['authorization', 'cookie', 'csrfToken']),
      );
      expect(failure.telemetryRedaction.forbiddenRawSubstrings).toEqual(
        expect.arrayContaining(['Bearer ', 'superapp-valid-csrf']),
      );
    }

    expect(
      getWorkloadChaosFailureCase('chaos.duplicate-request.v1')
        ?.expectedErrorEnvelope.present,
    ).toBe(false);
    expect(
      getWorkloadChaosFailureCase('chaos.tenant-violation.v1')?.tenantSafety,
    ).toMatchObject({
      expectedTenantViolation: true,
      sourceTenantId: 'acme-global',
      targetTenantId: 'platform-shell',
    });
  });

  test('provides deterministic target hints and request inputs for later matrix artifacts', () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();
    const targetCoverage = taxonomy.consumerTargetCoverage;
    const targetIds: WorkloadScenarioConsumerTarget[] = [
      'k6',
      'load',
      'chaos',
      'browser',
      'contract',
    ];

    expect(Object.keys(targetCoverage)).toEqual(targetIds);
    for (const target of targetIds) {
      expect(targetCoverage[target].length).toBeGreaterThan(0);
      expect(
        getWorkloadChaosFailuresForConsumerTarget(target).map(
          failure => failure.id,
        ),
      ).toEqual(targetCoverage[target]);
    }

    expect(taxonomy.consumerTargetCoverage.chaos).toEqual(
      SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS,
    );
    expect(taxonomy.consumerTargetCoverage.k6).toEqual([
      'chaos.retry-storm.v1',
      'chaos.duplicate-request.v1',
    ]);

    expect(
      taxonomy.failures.map(failure => failure.deterministicInput.requestId),
    ).toEqual([
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:01:downstream:timeout',
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:02:partial:module:error',
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:03:stale:remote:manifest',
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:04:down:remote',
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:05:malformed:json',
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:06:auth:expiry',
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:07:tenant:violation',
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:08:retry:storm',
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:09:slow:stream',
      'swl-v1:chaos:fleet-incident-refund:write-heavy-order-ledger:city-ops-eu:failure:10:duplicate:request',
    ]);
    expect(
      getWorkloadChaosFailureCase('chaos.retry-storm.v1')?.deterministicInput
        .attemptCount,
    ).toBe(8);
  });
});
