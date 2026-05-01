import {
  createSuperAppQueryKey,
  getSuperAppInvalidationBoundary,
  SUPERAPP_CONTRACT_ARTIFACT_LINKS,
  SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS,
  SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS,
  SUPERAPP_REQUEST_CONTEXT_FIELDS,
  SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES,
  SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_ROUTE_CONTRACTS,
} from '../shared/effect-tanstack-contract-map.js';
import { createInitialPortfolioState } from '../shared/portfolio-state.js';
import { createSuperAppWorkloadValidationArtifact } from '../shared/workload-validation-artifact.js';

describe('superapp effect and tanstack contract map', () => {
  test('maps every current Effect BFF endpoint to stable cache and mutation boundaries', () => {
    expect(
      SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(endpoint => endpoint.id),
    ).toEqual([
      'effect.bootstrap',
      'effect.runWorkflow',
      'effect.runPilot',
      'effect.securityProbe',
      'effect.injectFailure',
      'effect.reset',
    ]);
    expect(
      SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(
        endpoint => endpoint.publicPath,
      ),
    ).toEqual([
      '/bff-api/effect/bootstrap',
      '/bff-api/effect/apps/:appId/workflow',
      '/bff-api/effect/pilot/:scenario/run',
      '/bff-api/effect/security/probe',
      '/bff-api/effect/failure/:mode',
      '/bff-api/effect/reset',
    ]);

    const queryKeyIds = new Set(
      SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(template => template.id),
    );
    const mutationKeyIds = new Set(
      SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES.map(template => template.id),
    );
    const boundaryIds = new Set(
      SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES.map(boundary => boundary.id),
    );

    for (const endpoint of SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS) {
      expect(endpoint.sourceFile).toBe(
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      );
      for (const queryKeyId of endpoint.queryKeyIds) {
        expect(queryKeyIds.has(queryKeyId)).toBe(true);
      }

      if (endpoint.kind === 'query') {
        expect(endpoint.mutationKeyId).toBeUndefined();
        expect(endpoint.invalidationBoundaryId).toBeUndefined();
        expect(endpoint.queryKeyIds.length).toBeGreaterThan(0);
      } else {
        expect(mutationKeyIds.has(endpoint.mutationKeyId!)).toBe(true);
        expect(boundaryIds.has(endpoint.invalidationBoundaryId!)).toBe(true);
        const boundary = getSuperAppInvalidationBoundary(
          endpoint.invalidationBoundaryId!,
        );
        expect(boundary.endpointId).toBe(endpoint.id);
        expect(boundary.mutationKeyId).toBe(endpoint.mutationKeyId);
      }
    }

    const securityProbe = SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.find(
      endpoint => endpoint.id === 'effect.securityProbe',
    )!;
    expect(securityProbe.headers.map(header => header.name)).toEqual([
      'authorization',
      'origin',
      'x-csrf-token',
      'x-tenant-id',
      'x-user-role',
    ]);
    expect(securityProbe.requestContextFields).toEqual(
      expect.arrayContaining([
        ...SUPERAPP_REQUEST_CONTEXT_FIELDS.securityHeaders,
        'targetTenant',
        'targetAppId',
        'requestId',
      ]),
    );
  });

  test('links current TanStack Router paths and portfolio domain routes to query keys', () => {
    const state = createInitialPortfolioState();

    expect(SUPERAPP_TANSTACK_ROUTE_CONTRACTS.map(route => route.path)).toEqual([
      '__root__',
      '/',
      '/apps/$appId',
    ]);
    expect(
      SUPERAPP_TANSTACK_ROUTE_CONTRACTS.find(route => route.path === '/')
        ?.bffEndpointIds,
    ).toEqual(['effect.bootstrap', 'effect.runPilot', 'effect.reset']);
    expect(
      SUPERAPP_TANSTACK_ROUTE_CONTRACTS.find(
        route => route.path === '/apps/$appId',
      )?.mutationKeyIds,
    ).toEqual(['portfolio.workflow.run']);

    const mappedDomainRoutes = SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS.map(
      route => ({
        path: route.path,
        ownerAppId: route.ownerAppId,
        tenantId: route.tenantId,
      }),
    );
    const stateDomainRoutes = state.apps.flatMap(app =>
      app.routes.map(route => ({
        path: route,
        ownerAppId: app.id,
        tenantId: app.tenant,
      })),
    );
    expect(mappedDomainRoutes).toEqual(stateDomainRoutes);

    const mappedPaths = new Set(
      SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS.map(route => route.path),
    );
    const scenarioRoutes = new Set(
      state.pilotScenarios.flatMap(scenario => scenario.routeTransitions),
    );
    for (const route of scenarioRoutes) {
      expect(mappedPaths.has(route)).toBe(true);
    }
  });

  test('keeps invalidation boundaries deterministic without exercising behavior', () => {
    const invalidationByEndpoint = new Map(
      SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES.map(boundary => [
        boundary.endpointId,
        boundary,
      ]),
    );

    expect(invalidationByEndpoint.get('effect.securityProbe')).toMatchObject({
      id: 'security-decision-readonly',
      stateMutation: false,
      invalidatesQueryKeyIds: ['portfolio.security.decision'],
      stateScopes: [],
    });
    expect(
      invalidationByEndpoint.get('effect.reset')?.invalidatesQueryKeyIds,
    ).toEqual(
      SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(template => template.id),
    );
    expect(
      invalidationByEndpoint.get('effect.runPilot')?.currentRuntimeRefresh,
    ).toEqual(['/']);
    expect(
      invalidationByEndpoint.get('effect.runWorkflow')?.stateScopes,
    ).toEqual(['events', 'apps.openWork', 'summary.eventCount']);

    expect(
      SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES.map(template => [
        template.id,
        template.endpointId,
      ]),
    ).toEqual([
      ['portfolio.workflow.run', 'effect.runWorkflow'],
      ['portfolio.pilot.run', 'effect.runPilot'],
      ['portfolio.security.probe', 'effect.securityProbe'],
      ['portfolio.failure.inject', 'effect.injectFailure'],
      ['portfolio.reset', 'effect.reset'],
    ]);
  });

  test('links workload reset and validation artifacts for later contract suites', () => {
    const state = createInitialPortfolioState();
    const artifact = createSuperAppWorkloadValidationArtifact();
    const linkIds = new Set(Object.keys(SUPERAPP_CONTRACT_ARTIFACT_LINKS));

    expect(SUPERAPP_CONTRACT_ARTIFACT_LINKS).toMatchObject({
      workloadCatalog: {
        catalogVersion: state.workloadCatalog.catalogVersion,
        seed: state.workloadCatalog.seed,
        requestIdPrefix: state.workloadCatalog.requestIdPrefix,
      },
      workloadData: {
        datasetVersion: state.workloadData.datasetVersion,
        seed: state.workloadData.seed,
      },
      workloadScenarioProfiles: {
        profileVersion: state.workloadScenarioProfileMetadata.profileVersion,
        seed: state.workloadScenarioProfileMetadata.seed,
        tenantBoundaryProfileId:
          state.workloadScenarioProfileMetadata.helperMetadata
            .tenantBoundaryProfileId,
      },
      workloadResetSeed: {
        resetVersion: state.workloadResetSeedMetadata.resetVersion,
        seed: state.workloadResetSeedMetadata.resetSeed,
        defaultTarget:
          state.workloadResetSeedMetadata.defaultSeeds.contract.target,
        defaultScenarioId:
          state.workloadResetSeedMetadata.defaultSeeds.contract.scenarioId,
        defaultProfileId:
          state.workloadResetSeedMetadata.defaultSeeds.contract.profileId,
        defaultTenantId:
          state.workloadResetSeedMetadata.defaultSeeds.contract.tenantId,
      },
      workloadValidationArtifact: {
        artifactVersion: artifact.artifactVersion,
        artifactSeed: artifact.artifactSeed,
      },
    });

    for (const endpoint of SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS) {
      expect(endpoint.artifactLinkIds.length).toBeGreaterThan(0);
      for (const artifactLinkId of endpoint.artifactLinkIds) {
        expect(linkIds.has(artifactLinkId)).toBe(true);
      }
    }
    for (const boundary of SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES) {
      expect(boundary.artifactLinkIds.length).toBeGreaterThan(0);
      for (const artifactLinkId of boundary.artifactLinkIds) {
        expect(linkIds.has(artifactLinkId)).toBe(true);
      }
    }
  });

  test('creates stable query keys from templates', () => {
    expect(createSuperAppQueryKey('portfolio.bootstrap')).toEqual([
      'superapp-portfolio',
      'bootstrap',
    ]);
    expect(
      createSuperAppQueryKey('portfolio.app.detail', {
        appId: 'mobility-marketplace',
      }),
    ).toEqual(['superapp-portfolio', 'apps', 'mobility-marketplace']);
    expect(
      createSuperAppQueryKey('portfolio.security.decision', {
        targetTenant: 'security-root',
        targetAppId: 'tenant-security',
        requestId: 'swl-v1-boundary-audit-001',
      }),
    ).toEqual([
      'superapp-portfolio',
      'security',
      'decision',
      'security-root',
      'tenant-security',
      'swl-v1-boundary-audit-001',
    ]);
    expect(() => createSuperAppQueryKey('portfolio.app.detail')).toThrow(
      'Missing SuperApp query key value: appId',
    );
  });
});
