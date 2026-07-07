import {
  createSuperAppQueryKey,
  getSuperAppEffectEndpoint,
  getSuperAppInvalidationBoundary,
  SUPERAPP_CONTRACT_ARTIFACT_LINKS,
  SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS,
  SUPERAPP_PILOT_CONTRACT_VALUES,
  SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS,
  SUPERAPP_REQUEST_CONTEXT_FIELDS,
  SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES,
  SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_ROUTE_CONTRACTS,
} from '../shared/effect-tanstack-contract-map';
import { createInitialPortfolioState } from '../shared/portfolio-state';
import { createSuperAppWorkloadValidationArtifact } from '../shared/workload-validation-artifact';

function expectUnique(values: readonly string[]) {
  expect(new Set(values).size).toBe(values.length);
}

function placeholderValues(parts: readonly string[]) {
  return Object.fromEntries(
    parts
      .filter(part => part.startsWith(':'))
      .map(part => [part.slice(1), `${part.slice(1)}-value`]),
  );
}

describe('superapp Effect and TanStack contract map', () => {
  test('keeps endpoint contracts unique, routable, and internally linked', () => {
    const endpointIds = SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(
      endpoint => endpoint.id,
    );
    const queryKeyIds = new Set(
      SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(template => template.id),
    );
    const mutationKeyIds = new Set(
      SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES.map(template => template.id),
    );
    const boundaryIds = new Set(
      SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES.map(boundary => boundary.id),
    );
    const artifactLinkIds = new Set(
      Object.keys(SUPERAPP_CONTRACT_ARTIFACT_LINKS),
    );

    expectUnique(endpointIds);

    for (const endpoint of SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS) {
      expect(getSuperAppEffectEndpoint(endpoint.id)).toBe(endpoint);
      expect(endpoint.publicPath.startsWith('/')).toBe(true);
      expect(endpoint.effectPath.startsWith('/')).toBe(true);
      expect(endpoint.sourceFile.endsWith('portfolio-api.ts')).toBe(true);
      expect(endpoint.handler.length).toBeGreaterThan(0);
      expect(endpoint.successFields.length).toBeGreaterThan(0);
      expect(['GET', 'POST']).toContain(endpoint.method);
      expect(['query', 'mutation']).toContain(endpoint.kind);

      for (const fieldGroup of [
        endpoint.params,
        endpoint.headers,
        endpoint.payload,
      ]) {
        for (const field of fieldGroup) {
          expect(field.name.length).toBeGreaterThan(0);
          expect(['params', 'headers', 'payload']).toContain(field.source);
        }
      }

      for (const queryKeyId of endpoint.queryKeyIds) {
        expect(queryKeyIds.has(queryKeyId)).toBe(true);
      }
      if (endpoint.mutationKeyId) {
        expect(mutationKeyIds.has(endpoint.mutationKeyId)).toBe(true);
      }
      if (endpoint.invalidationBoundaryId) {
        expect(boundaryIds.has(endpoint.invalidationBoundaryId)).toBe(true);
      }
      for (const artifactLinkId of endpoint.artifactLinkIds) {
        expect(artifactLinkIds.has(artifactLinkId)).toBe(true);
      }
    }
  });

  test('keeps query and mutation templates resolvable without hand-listed ids', () => {
    const queryKeyIds = SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(
      template => template.id,
    );
    const endpointIds = new Set(
      SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(endpoint => endpoint.id),
    );

    expectUnique(queryKeyIds);
    expectUnique(
      SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES.map(template => template.id),
    );

    for (const template of SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES) {
      const values = placeholderValues(template.parts);
      const key = createSuperAppQueryKey(template.id, values);

      expect(template.owner).toBe('tanstack-query');
      expect(template.source).toBe('contract-defined');
      expect(template.parts.length).toBeGreaterThan(0);
      expect(key).toHaveLength(template.parts.length);
      expect(key).toEqual(
        template.parts.map(part =>
          part.startsWith(':') ? values[part.slice(1)] : part,
        ),
      );
    }

    for (const template of SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES) {
      expect(template.parts.length).toBeGreaterThan(0);
      expect(endpointIds.has(template.endpointId)).toBe(true);
      expect(template.scope.length).toBeGreaterThan(0);
    }
  });

  test('links invalidation boundaries, TanStack routes, and portfolio routes', () => {
    const state = createInitialPortfolioState();
    const endpointIds = new Set(
      SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(endpoint => endpoint.id),
    );
    const queryKeyIds = new Set(
      SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(template => template.id),
    );
    const mutationKeyIds = new Set(
      SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES.map(template => template.id),
    );
    const routeIds = new Set(
      SUPERAPP_TANSTACK_ROUTE_CONTRACTS.map(route => route.id),
    );
    const appIds = new Set(state.apps.map(app => app.id));
    const tenantIds = new Set(
      state.workloadCatalog.tenants.map(tenant => tenant.id),
    );

    expectUnique([...routeIds]);
    expectUnique(
      SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES.map(boundary => boundary.id),
    );

    for (const boundary of SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES) {
      expect(getSuperAppInvalidationBoundary(boundary.id)).toBe(boundary);
      expect(endpointIds.has(boundary.endpointId)).toBe(true);
      expect(mutationKeyIds.has(boundary.mutationKeyId)).toBe(true);
      expect(boundary.invalidatesQueryKeyIds.length).toBeGreaterThan(0);
      for (const queryKeyId of boundary.invalidatesQueryKeyIds) {
        expect(queryKeyIds.has(queryKeyId)).toBe(true);
      }
      for (const routeId of boundary.currentRuntimeRefresh) {
        expect(routeIds.has(routeId)).toBe(true);
      }
    }

    for (const route of SUPERAPP_TANSTACK_ROUTE_CONTRACTS) {
      expect(route.path).toBe(route.id);
      expect(route.sourceFiles.length).toBeGreaterThan(0);
      for (const endpointId of route.bffEndpointIds) {
        expect(endpointIds.has(endpointId)).toBe(true);
      }
      for (const queryKeyId of route.queryKeyIds) {
        expect(queryKeyIds.has(queryKeyId)).toBe(true);
      }
      for (const mutationKeyId of route.mutationKeyIds) {
        expect(mutationKeyIds.has(mutationKeyId)).toBe(true);
      }
    }

    for (const route of SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS) {
      expect(route.path.startsWith('/')).toBe(true);
      expect(appIds.has(route.ownerAppId)).toBe(true);
      expect(tenantIds.has(route.tenantId)).toBe(true);
      for (const queryKeyId of route.queryKeyIds) {
        expect(queryKeyIds.has(queryKeyId)).toBe(true);
      }
    }
  });

  test('keeps artifact links and request-context constants connected to runtime data', () => {
    const validationArtifact = createSuperAppWorkloadValidationArtifact();

    expect(
      SUPERAPP_CONTRACT_ARTIFACT_LINKS.workloadValidationArtifact,
    ).toMatchObject({
      artifactVersion: validationArtifact.artifactVersion,
      artifactSeed: validationArtifact.artifactSeed,
    });
    const artifactLinkValuesArePresent = Object.values(
      SUPERAPP_CONTRACT_ARTIFACT_LINKS,
    ).every(link => Object.values(link).every(Boolean));

    expect(artifactLinkValuesArePresent).toBe(true);
    expect(Object.values(SUPERAPP_REQUEST_CONTEXT_FIELDS).every(Boolean)).toBe(
      true,
    );
    expect(Object.values(SUPERAPP_PILOT_CONTRACT_VALUES).every(Boolean)).toBe(
      true,
    );
    expect(() => getSuperAppEffectEndpoint('missing' as never)).toThrow(
      'Unknown SuperApp Effect endpoint contract',
    );
    expect(() => getSuperAppInvalidationBoundary('missing' as never)).toThrow(
      'Unknown SuperApp invalidation boundary',
    );
    const dynamicQueryTemplate = SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.find(
      template => template.parts.some(part => part.startsWith(':')),
    );

    expect(dynamicQueryTemplate).toBeDefined();
    expect(() => createSuperAppQueryKey(dynamicQueryTemplate!.id)).toThrow(
      'Missing SuperApp query key value',
    );
  });
});
