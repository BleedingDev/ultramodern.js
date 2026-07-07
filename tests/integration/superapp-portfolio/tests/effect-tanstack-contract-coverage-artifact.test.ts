import {
  createSuperAppEffectTanStackContractCoverageArtifact,
  serializeSuperAppEffectTanStackContractCoverageArtifact,
} from '../shared/effect-tanstack-contract-coverage-artifact';
import {
  SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS,
  SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS,
  SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES,
  SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_ROUTE_CONTRACTS,
} from '../shared/effect-tanstack-contract-map';

function idsFor(kind: string, sourceIds: readonly string[]) {
  return sourceIds.map(sourceId => `${kind}:${sourceId}`);
}

function expectBlockingBudget(row: {
  regressionBudget: {
    maxAllowedContractRegressions: number;
    maxAllowedOrphans: number;
    destroyReadinessGate: string;
  };
}) {
  expect(row.regressionBudget.maxAllowedContractRegressions).toBe(0);
  expect(row.regressionBudget.maxAllowedOrphans).toBe(0);
  expect(row.regressionBudget.destroyReadinessGate).toBe('blocking');
}

describe('superapp Effect and TanStack contract coverage artifact', () => {
  test('derives summary and source maps from the contract map', () => {
    const first = createSuperAppEffectTanStackContractCoverageArtifact();
    const second = createSuperAppEffectTanStackContractCoverageArtifact();
    const serialized =
      serializeSuperAppEffectTanStackContractCoverageArtifact(first);

    expect(first).toEqual(second);
    expect(first.fingerprint).toMatch(/^fnv1a-[0-9a-f]{8}$/);
    expect(first.sourceMapFingerprint).toMatch(/^fnv1a-[0-9a-f]{8}$/);
    expect(serialized).toBe(`${JSON.stringify(JSON.parse(serialized))}\n`);
    expect(serialized).not.toContain('\n ');

    expect(first.sourceMapIds).toEqual({
      effectEndpointIds: SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(
        endpoint => endpoint.id,
      ),
      queryKeyTemplateIds: SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(
        template => template.id,
      ),
      mutationKeyTemplateIds: SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES.map(
        template => template.id,
      ),
      invalidationBoundaryIds: SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES.map(
        boundary => boundary.id,
      ),
      tanStackRouteIds: SUPERAPP_TANSTACK_ROUTE_CONTRACTS.map(
        route => route.id,
      ),
      portfolioDomainRouteIds: SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS.map(
        route => route.path,
      ),
    });
    expect(first.summary).toEqual({
      effectEndpointCount: first.sourceMapIds.effectEndpointIds.length,
      queryKeyTemplateCount: first.sourceMapIds.queryKeyTemplateIds.length,
      mutationKeyTemplateCount:
        first.sourceMapIds.mutationKeyTemplateIds.length,
      invalidationBoundaryCount:
        first.sourceMapIds.invalidationBoundaryIds.length,
      tanStackRouteCount: first.sourceMapIds.tanStackRouteIds.length,
      portfolioDomainRouteCount:
        first.sourceMapIds.portfolioDomainRouteIds.length,
      contractRowCount: first.contractRows.length,
      scenarioCount: first.scenarioRows.length,
    });
  });

  test('derives contract row ids and budgets from source map ids', () => {
    const artifact = createSuperAppEffectTanStackContractCoverageArtifact();
    const contractIds = artifact.contractRows.map(row => row.contractId);
    const expectedContractIds = [
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
    ];

    expect(contractIds).toEqual(expectedContractIds);
    expect(new Set(contractIds).size).toBe(contractIds.length);
    expect(
      artifact.contractRows.every(row => row.expectedBehavior.length > 0),
    ).toBe(true);
    for (const row of artifact.contractRows) {
      expectBlockingBudget(row);
    }
    expect(artifact.contracts.effectEndpoints).toHaveLength(
      artifact.sourceMapIds.effectEndpointIds.length,
    );
    expect(artifact.contracts.queryKeyTemplates).toHaveLength(
      artifact.sourceMapIds.queryKeyTemplateIds.length,
    );
    expect(artifact.contracts.mutationKeyTemplates).toHaveLength(
      artifact.sourceMapIds.mutationKeyTemplateIds.length,
    );
    expect(artifact.contracts.invalidationBoundaries).toHaveLength(
      artifact.sourceMapIds.invalidationBoundaryIds.length,
    );
    expect(artifact.contracts.tanStackRoutes).toHaveLength(
      artifact.sourceMapIds.tanStackRouteIds.length,
    );
    expect(artifact.contracts.portfolioDomainRoutes).toHaveLength(
      artifact.sourceMapIds.portfolioDomainRouteIds.length,
    );
  });

  test('links every scenario row to known contracts and compact artifacts', () => {
    const artifact = createSuperAppEffectTanStackContractCoverageArtifact();
    const knownContractIds = new Set(
      artifact.contractRows.map(row => row.contractId),
    );
    const scenarioIds = artifact.scenarioRows.map(row => row.scenarioId);

    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    for (const scenario of artifact.scenarioRows) {
      expect(scenario.expectedBehavior.length).toBeGreaterThan(0);
      expect(scenario.contractIds.length).toBeGreaterThan(0);
      expectBlockingBudget(scenario);
      for (const contractId of scenario.contractIds) {
        expect(knownContractIds.has(contractId)).toBe(true);
      }
    }

    expect(artifact.compactness).toMatchObject({
      fullSourceContractsOmitted: true,
      includesOnlyIdsTemplatesBudgetsAndExpectedBehavior: true,
    });
    expect(new Set(artifact.compactness.omittedPaths).size).toBe(
      artifact.compactness.omittedPaths.length,
    );
  });
});
