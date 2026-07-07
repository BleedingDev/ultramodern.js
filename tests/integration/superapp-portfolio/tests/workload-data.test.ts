import { createSuperAppWorkloadCatalog } from '../shared/portfolio-state';
import {
  createSuperAppGeneratedWorkloadContract,
  createSuperAppGeneratedWorkloadDataset,
  GENERATED_WORKLOAD_ENTITIES,
} from '../shared/workload-generated-data';
import {
  createSuperAppWorkloadScenarioProfileContract,
  getWorkloadScenarioProfile,
  getWorkloadScenarioProfilesByCategory,
  SUPERAPP_WORKLOAD_SCENARIO_PROFILE_CATEGORIES,
  SUPERAPP_WORKLOAD_SCENARIO_PROFILE_IDS,
  selectWorkloadScenarioSampleRecords,
  selectWorkloadScenarioSampleWindows,
} from '../shared/workload-scenario-profiles';

function sum(values: Iterable<number>) {
  return [...values].reduce((total, value) => total + value, 0);
}

function expectUnique(values: readonly string[]) {
  expect(new Set(values).size).toBe(values.length);
}

describe('superapp generated workload data', () => {
  test('derives deterministic totals and high-watermarks from generated records', () => {
    const catalog = createSuperAppWorkloadCatalog();
    const first = createSuperAppGeneratedWorkloadContract(catalog);
    const second = createSuperAppGeneratedWorkloadContract(catalog);
    const dataset = createSuperAppGeneratedWorkloadDataset(catalog);

    expect(first).toEqual(second);
    expectUnique(GENERATED_WORKLOAD_ENTITIES);

    const recordIds = new Set<string>();
    const derivedTotals = Object.fromEntries(
      GENERATED_WORKLOAD_ENTITIES.map(entity => {
        const records = dataset.records[entity];
        for (const record of records) {
          expect(recordIds.has(record.id)).toBe(false);
          recordIds.add(record.id);
        }
        return [entity, records.length];
      }),
    );

    expect(first.metadata.totals).toEqual(derivedTotals);
    expect(first.metadata.totalRecords).toBe(
      sum(Object.values(first.metadata.totals)),
    );

    for (const entity of GENERATED_WORKLOAD_ENTITIES) {
      const records = dataset.records[entity];
      const highWatermark = first.metadata.highWatermarks.find(
        mark => mark.entity === entity,
      );

      expect(highWatermark).toMatchObject({
        entity,
        count: records.length,
        firstId: records[0]?.id,
        lastId: records.at(-1)?.id,
      });
    }
  });

  test('keeps tenant, domain, helper, and sample-window references resolvable', () => {
    const catalog = createSuperAppWorkloadCatalog();
    const generated = createSuperAppGeneratedWorkloadContract(catalog);
    const dataset = createSuperAppGeneratedWorkloadDataset(catalog);
    const tenantIds = new Set(catalog.tenants.map(tenant => tenant.id));
    const domainTenantIds = new Map(
      catalog.domains.map(domain => [domain.id, new Set(domain.tenantIds)]),
    );
    const recordsById = new Map(
      GENERATED_WORKLOAD_ENTITIES.flatMap(entity =>
        dataset.records[entity].map(record => [record.id, record] as const),
      ),
    );

    for (const summary of generated.metadata.tenantSummaries) {
      expect(tenantIds.has(summary.tenantId)).toBe(true);
      expect(summary.totalRecords).toBe(sum(Object.values(summary.totals)));

      for (const sampleId of summary.sampleIds) {
        expect(recordsById.has(sampleId)).toBe(true);
      }
    }

    for (const entity of GENERATED_WORKLOAD_ENTITIES) {
      for (const record of dataset.records[entity]) {
        expect(tenantIds.has(record.tenantId)).toBe(true);
        expect(record.partitionKey.startsWith(record.tenantId)).toBe(true);
        expect(domainTenantIds.get(record.domainId)?.has(record.tenantId)).toBe(
          true,
        );

        for (const relatedId of record.relatedIds) {
          expect(relatedId.length).toBeGreaterThan(0);
          expect(relatedId).toContain('-');
        }
      }
    }

    for (const id of Object.values(generated.helperIds.stableRecords)) {
      expect(recordsById.has(id)).toBe(true);
    }

    expect(
      new Set(generated.metadata.sampleWindows.map(window => window.id)),
    ).toEqual(new Set(Object.values(generated.helperIds.sampleWindows)));
  });

  test('scenario profiles resolve catalog and generated sample selectors', () => {
    const catalog = createSuperAppWorkloadCatalog();
    const generated = createSuperAppGeneratedWorkloadContract(catalog);
    const scenarioProfiles = createSuperAppWorkloadScenarioProfileContract();
    const tenantIds = new Set(catalog.tenants.map(tenant => tenant.id));
    const domainIds = new Set(catalog.domains.map(domain => domain.id));
    const personaIds = new Set(catalog.users.map(user => user.id));
    const scenarioIds = new Set(catalog.scenarios.map(scenario => scenario.id));
    const sampleWindowIds = new Set(
      generated.metadata.sampleWindows.map(window => window.id),
    );

    expect(scenarioProfiles.categories).toEqual(
      SUPERAPP_WORKLOAD_SCENARIO_PROFILE_CATEGORIES,
    );
    expect(scenarioProfiles.profileIds).toEqual(
      SUPERAPP_WORKLOAD_SCENARIO_PROFILE_IDS,
    );
    expectUnique(scenarioProfiles.profileIds);
    expect(scenarioProfiles.helperMetadata.categoryCounts).toEqual(
      scenarioProfiles.categories.map(category => ({
        category,
        count: scenarioProfiles.profiles.filter(
          profile => profile.category === category,
        ).length,
      })),
    );

    for (const profile of scenarioProfiles.profiles) {
      expect(getWorkloadScenarioProfile(profile.id)).toMatchObject({
        id: profile.id,
        category: profile.category,
      });
      expect(getWorkloadScenarioProfilesByCategory(profile.category)).toEqual(
        scenarioProfiles.profiles.filter(
          candidate => candidate.category === profile.category,
        ),
      );

      for (const tenantId of profile.tenantIds) {
        expect(tenantIds.has(tenantId)).toBe(true);
      }
      for (const domainId of profile.domainIds) {
        expect(domainIds.has(domainId)).toBe(true);
      }
      for (const catalogScenarioId of profile.catalogScenarioIds) {
        expect(scenarioIds.has(catalogScenarioId)).toBe(true);
      }

      for (const step of profile.steps) {
        expect(tenantIds.has(step.tenantId)).toBe(true);
        expect(domainIds.has(step.domainId)).toBe(true);
        expect(personaIds.has(step.personaId)).toBe(true);
        expect(step.route.startsWith('/')).toBe(true);
      }

      for (const selector of profile.sampleSelectors) {
        expect(sampleWindowIds.has(selector.sampleWindowId)).toBe(true);
      }

      expect(
        selectWorkloadScenarioSampleWindows(profile, generated).map(
          window => window.id,
        ),
      ).toEqual(profile.sampleWindowIds);
      expect(
        selectWorkloadScenarioSampleRecords(profile, generated).flatMap(
          selection => selection.records,
        ).length,
      ).toBeGreaterThan(0);
    }
  });
});
