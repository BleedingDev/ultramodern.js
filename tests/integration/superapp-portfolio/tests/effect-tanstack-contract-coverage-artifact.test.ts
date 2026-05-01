import {
  createSuperAppEffectTanStackContractCoverageArtifact,
  serializeSuperAppEffectTanStackContractCoverageArtifact,
} from '../shared/effect-tanstack-contract-coverage-artifact.js';
import {
  SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS,
  SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS,
  SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES,
  SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_ROUTE_CONTRACTS,
} from '../shared/effect-tanstack-contract-map.js';

const requiredScenarioIds = [
  'successful-read',
  'successful-write',
  'optimistic-mutation',
  'rollback',
  'duplicate-request-idempotency',
  'abort-cancellation',
  'timeout',
  'retry-classification',
  'effect-interruption-finalizers',
  'schema-decode-failures',
  'structured-defects',
  'request-context-propagation',
  'navigation-invalidation',
  'stale-data',
  'prefetch',
  'tenant-switch',
  'offline-to-online-recovery',
];

function idsFor(kind: string, sourceIds: readonly string[]) {
  return sourceIds.map(sourceId => `${kind}:${sourceId}`);
}

describe('superapp Effect and TanStack contract coverage artifact', () => {
  test('publishes a deterministic compact artifact with stable fingerprints', () => {
    const first = createSuperAppEffectTanStackContractCoverageArtifact();
    const second = createSuperAppEffectTanStackContractCoverageArtifact();
    const serialized =
      serializeSuperAppEffectTanStackContractCoverageArtifact(first);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      artifactVersion: 'superapp-effect-tanstack-contract-coverage-artifact-v1',
      artifactSeed: 'superapp-portfolio-effect-tanstack-contract-coverage-v1',
      fingerprint: expect.stringMatching(/^fnv1a-[0-9a-f]{8}$/),
      sourceMapFingerprint: expect.stringMatching(/^fnv1a-[0-9a-f]{8}$/),
      compactness: {
        fullSourceContractsOmitted: true,
        includesOnlyIdsTemplatesBudgetsAndExpectedBehavior: true,
      },
    });
    expect(serialized).toBe(`${JSON.stringify(JSON.parse(serialized))}\n`);
    expect(serialized).not.toContain('\n  ');
    expect(first.summary).toEqual({
      effectEndpointCount: 6,
      queryKeyTemplateCount: 13,
      mutationKeyTemplateCount: 5,
      invalidationBoundaryCount: 5,
      tanStackRouteCount: 3,
      portfolioDomainRouteCount: 15,
      contractRowCount: 47,
      scenarioCount: requiredScenarioIds.length,
    });
  });

  test('covers every current map entry without orphaned source contracts', () => {
    const artifact = createSuperAppEffectTanStackContractCoverageArtifact();

    expect(artifact.sourceMapIds.effectEndpointIds).toEqual(
      SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(endpoint => endpoint.id),
    );
    expect(artifact.sourceMapIds.queryKeyTemplateIds).toEqual(
      SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(template => template.id),
    );
    expect(artifact.sourceMapIds.mutationKeyTemplateIds).toEqual(
      SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES.map(template => template.id),
    );
    expect(artifact.sourceMapIds.invalidationBoundaryIds).toEqual(
      SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES.map(boundary => boundary.id),
    );
    expect(artifact.sourceMapIds.tanStackRouteIds).toEqual(
      SUPERAPP_TANSTACK_ROUTE_CONTRACTS.map(route => route.id),
    );
    expect(artifact.sourceMapIds.portfolioDomainRouteIds).toEqual(
      SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS.map(route => route.path),
    );

    const contractIds = artifact.contractRows.map(row => row.contractId);
    expect(contractIds).toEqual([
      ...idsFor('effect-endpoint', artifact.sourceMapIds.effectEndpointIds),
      ...idsFor(
        'tanstack-query-key',
        artifact.sourceMapIds.queryKeyTemplateIds,
      ),
      ...idsFor(
        'tanstack-mutation-key',
        artifact.sourceMapIds.mutationKeyTemplateIds,
      ),
      ...idsFor(
        'tanstack-invalidation-boundary',
        artifact.sourceMapIds.invalidationBoundaryIds,
      ),
      ...idsFor('tanstack-route', artifact.sourceMapIds.tanStackRouteIds),
      ...idsFor(
        'portfolio-domain-route',
        artifact.sourceMapIds.portfolioDomainRouteIds,
      ),
    ]);
    expect(new Set(contractIds).size).toBe(contractIds.length);
    expect(
      artifact.contractRows.every(row => row.expectedBehavior.length > 0),
    ).toBe(true);
    expect(
      artifact.contractRows.every(
        row =>
          row.regressionBudget.maxAllowedContractRegressions === 0 &&
          row.regressionBudget.maxAllowedOrphans === 0 &&
          row.regressionBudget.destroyReadinessGate === 'blocking',
      ),
    ).toBe(true);
  });

  test('links every required behavior scenario to known contracts and budgets', () => {
    const artifact = createSuperAppEffectTanStackContractCoverageArtifact();
    const knownContractIds = new Set(
      artifact.contractRows.map(row => row.contractId),
    );

    expect(artifact.scenarioRows.map(row => row.scenarioId)).toEqual(
      requiredScenarioIds,
    );

    for (const scenario of artifact.scenarioRows) {
      expect(scenario.expectedBehavior.length).toBeGreaterThan(0);
      expect(scenario.contractIds.length).toBeGreaterThan(0);
      expect(scenario.regressionBudget.maxAllowedContractRegressions).toBe(0);
      expect(scenario.regressionBudget.maxAllowedOrphans).toBe(0);
      for (const contractId of scenario.contractIds) {
        expect(knownContractIds.has(contractId)).toBe(true);
      }
    }

    expect(
      artifact.scenarioRows.find(
        row => row.scenarioId === 'effect-interruption-finalizers',
      ),
    ).toMatchObject({
      regressionBudget: {
        classification: 'effect-lifecycle',
      },
    });
    expect(
      artifact.scenarioRows.find(
        row => row.scenarioId === 'request-context-propagation',
      )?.contractIds,
    ).toEqual(
      expect.arrayContaining([
        'effect-endpoint:effect.runWorkflow',
        'effect-endpoint:effect.runPilot',
        'effect-endpoint:effect.securityProbe',
        'effect-endpoint:effect.injectFailure',
      ]),
    );
  });
});
