import { createSuperAppWorkloadCatalog } from '../shared/portfolio-state.js';
import {
  createSuperAppGeneratedWorkloadContract,
  createSuperAppGeneratedWorkloadDataset,
  GENERATED_WORKLOAD_ENTITIES,
  type GeneratedWorkloadEntityCounts,
} from '../shared/workload-generated-data.js';
import {
  createSuperAppWorkloadScenarioProfileContract,
  getWorkloadScenarioProfile,
  getWorkloadScenarioProfilesByCategory,
  getWorkloadTenantBoundaryProbes,
  SUPERAPP_WORKLOAD_SCENARIO_PROFILE_CATEGORIES,
  SUPERAPP_WORKLOAD_SCENARIO_PROFILE_IDS,
  selectWorkloadScenarioSampleRecords,
  selectWorkloadScenarioSampleWindows,
} from '../shared/workload-scenario-profiles.js';

const expectedTotals: GeneratedWorkloadEntityCounts = {
  orders: 6300,
  invoices: 4650,
  ledgerEntries: 11200,
  rides: 6300,
  dispatchAssignments: 6300,
  fleetVehicles: 1970,
  chatThreads: 3100,
  messages: 31000,
  auditEvents: 23000,
  users: 3060,
  roles: 1260,
  memberships: 6220,
  tenantResources: 2600,
};

const tenantPrefixes = {
  'superapp-global': 'sgl',
  'city-ops-eu': 'coe',
  'acme-global': 'acm',
  'platform-shell': 'psh',
  'security-root': 'sec',
  'chaos-lab': 'cha',
};

const generatedIdPattern =
  /^(ord|inv|led|rid|dsp|veh|thd|msg|aud|usr|rol|mem|res)-([a-z]{3})-\d{5}$/;

describe('superapp generated workload data', () => {
  test('publishes deterministic counts, high-watermarks, and stable samples', () => {
    const first = createSuperAppGeneratedWorkloadContract();
    const second = createSuperAppGeneratedWorkloadContract();

    expect(first).toEqual(second);
    expect(first.metadata.totals).toEqual(expectedTotals);
    expect(first.metadata.totalRecords).toBe(106960);
    for (const entity of GENERATED_WORKLOAD_ENTITIES) {
      expect(first.metadata.totals[entity]).toBeGreaterThanOrEqual(1000);
    }
    expect(first.metadata.highWatermarks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'orders',
          count: 6300,
          firstId: 'ord-sgl-00001',
          lastId: 'ord-coe-03900',
        }),
        expect.objectContaining({
          entity: 'messages',
          count: 31000,
          firstId: 'msg-sgl-00001',
          lastId: 'msg-psh-10000',
        }),
        expect.objectContaining({
          entity: 'roles',
          count: 1260,
          firstId: 'rol-sgl-00001',
          lastId: 'rol-cha-00140',
        }),
      ]),
    );
    expect(first.helperIds.stableRecords).toMatchObject({
      orderId: 'ord-coe-01025',
      invoiceId: 'inv-acm-00513',
      ledgerEntryId: 'led-acm-02049',
      rideId: 'rid-coe-01501',
      dispatchAssignmentId: 'dsp-coe-01501',
      fleetVehicleId: 'veh-coe-00129',
      chatThreadId: 'thd-psh-00065',
      messageId: 'msg-psh-04097',
      auditEventId: 'aud-sec-02049',
      userId: 'usr-sgl-00129',
      roleId: 'rol-sec-00033',
      membershipId: 'mem-acm-00257',
      tenantResourceId: 'res-cha-00081',
    });
    expect(first.samples.orders.map(record => record.id)).toEqual([
      'ord-coe-01025',
      'ord-coe-01026',
      'ord-coe-01027',
      'ord-coe-01028',
    ]);
    expect(
      Object.values(first.samples).reduce(
        (sum, records) => sum + records.length,
        0,
      ),
    ).toBe(52);
  });

  test('generates full arrays without cross-tenant ID or domain leakage', () => {
    const catalog = createSuperAppWorkloadCatalog();
    const dataset = createSuperAppGeneratedWorkloadDataset(catalog);
    const domainTenantIds = new Map(
      catalog.domains.map(domain => [domain.id, domain.tenantIds]),
    );
    const leaks: string[] = [];

    expect(dataset.records.orders).toHaveLength(expectedTotals.orders);
    expect(dataset.records.invoices).toHaveLength(expectedTotals.invoices);
    expect(dataset.records.rides).toHaveLength(expectedTotals.rides);
    expect(dataset.records.messages).toHaveLength(expectedTotals.messages);
    expect(dataset.records.auditEvents).toHaveLength(
      expectedTotals.auditEvents,
    );

    for (const entity of GENERATED_WORKLOAD_ENTITIES) {
      for (const record of dataset.records[entity]) {
        const tenantPrefix = tenantPrefixes[record.tenantId];
        if (!record.id.includes(`-${tenantPrefix}-`)) {
          leaks.push(`${record.id}:id-prefix`);
        }
        if (!record.partitionKey.startsWith(record.tenantId)) {
          leaks.push(`${record.id}:partition:${record.partitionKey}`);
        }
        if (!domainTenantIds.get(record.domainId)?.includes(record.tenantId)) {
          leaks.push(`${record.id}:domain:${record.domainId}`);
        }
        for (const relatedId of record.relatedIds) {
          const match = generatedIdPattern.exec(relatedId);
          if (match && match[2] !== tenantPrefix) {
            leaks.push(`${record.id}:related:${relatedId}`);
          }
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});

describe('superapp workload scenario profiles', () => {
  test('publishes deterministic required categories and profile ids', () => {
    const first = createSuperAppWorkloadScenarioProfileContract();
    const second = createSuperAppWorkloadScenarioProfileContract();

    expect(first).toEqual(second);
    expect(first.categories).toEqual([
      'read-heavy',
      'write-heavy',
      'mixed',
      'search-filter-sort',
      'chat-pagination',
      'tenant-boundary',
    ]);
    expect(first.categories).toEqual(
      SUPERAPP_WORKLOAD_SCENARIO_PROFILE_CATEGORIES,
    );
    expect(first.profileIds).toEqual(SUPERAPP_WORKLOAD_SCENARIO_PROFILE_IDS);
    expect(first.profileIds).toEqual([
      'read-heavy-command-center',
      'write-heavy-order-ledger',
      'mixed-cross-app-journey',
      'search-filter-sort-ledger',
      'chat-pagination-history',
      'tenant-boundary-probes',
    ]);
    expect(first.helperMetadata.categoryCounts).toEqual(
      first.categories.map(category => ({
        category,
        count: 1,
      })),
    );

    for (const profile of first.profiles) {
      const mixTotal = Object.values(profile.operationMix).reduce(
        (sum, weight) => sum + weight,
        0,
      );
      const stepTotal = profile.steps.reduce(
        (sum, step) => sum + step.weight,
        0,
      );
      expect(mixTotal).toBe(100);
      expect(stepTotal).toBe(100);
      expect(profile.mutationCapable).toBe(
        profile.steps.some(step => step.mutatesData),
      );
    }
  });

  test('references existing tenants, domains, personas, and sample windows', () => {
    const catalog = createSuperAppWorkloadCatalog();
    const generated = createSuperAppGeneratedWorkloadContract(catalog);
    const scenarioProfiles = createSuperAppWorkloadScenarioProfileContract();
    const tenantIds = new Set(catalog.tenants.map(tenant => tenant.id));
    const domainIds = new Set(catalog.domains.map(domain => domain.id));
    const personaIds = new Set(catalog.users.map(user => user.id));
    const catalogScenarioIds = new Set(
      catalog.scenarios.map(scenario => scenario.id),
    );
    const sampleWindowsById = new Map(
      generated.metadata.sampleWindows.map(window => [window.id, window]),
    );

    for (const profile of scenarioProfiles.profiles) {
      expect(getWorkloadScenarioProfile(profile.id)).toMatchObject({
        id: profile.id,
        category: profile.category,
      });
      expect(getWorkloadScenarioProfilesByCategory(profile.category)).toEqual([
        expect.objectContaining({ id: profile.id }),
      ]);
      for (const tenantId of profile.tenantIds) {
        expect(tenantIds.has(tenantId)).toBe(true);
      }
      for (const domainId of profile.domainIds) {
        expect(domainIds.has(domainId)).toBe(true);
      }
      for (const scenarioId of profile.catalogScenarioIds) {
        expect(catalogScenarioIds.has(scenarioId)).toBe(true);
      }

      const selectorIds = new Set(
        profile.sampleSelectors.map(selector => selector.id),
      );
      for (const step of profile.steps) {
        const domain = catalog.domains.find(item => item.id === step.domainId);
        expect(domain).toBeDefined();
        expect(tenantIds.has(step.tenantId)).toBe(true);
        expect(domain?.tenantIds).toContain(step.tenantId);
        expect(personaIds.has(step.personaId)).toBe(true);
        expect(step.route.startsWith('/')).toBe(true);
        for (const sampleSelectorId of step.sampleSelectorIds) {
          expect(selectorIds.has(sampleSelectorId)).toBe(true);
        }
      }

      const selectedWindows = selectWorkloadScenarioSampleWindows(
        profile,
        generated,
      );
      expect(selectedWindows.map(window => window.id)).toEqual(
        profile.sampleWindowIds,
      );
      for (const sampleSelector of profile.sampleSelectors) {
        const sampleWindow = sampleWindowsById.get(
          sampleSelector.sampleWindowId,
        );
        const domain = catalog.domains.find(
          item => item.id === sampleSelector.domainId,
        );
        expect(sampleWindow).toMatchObject({
          id: sampleSelector.sampleWindowId,
          entity: sampleSelector.entity,
          tenantId: sampleSelector.tenantId,
        });
        expect(domain?.tenantIds).toContain(sampleSelector.tenantId);
      }

      for (const selected of selectWorkloadScenarioSampleRecords(
        profile,
        generated,
      )) {
        expect(selected.records.map(record => record.id)).toEqual(
          selected.selector.expectedRecordIds,
        );
      }
    }
  });

  test('tenant-boundary probes include allowed and denied read-only cases', () => {
    const generated = createSuperAppGeneratedWorkloadContract();
    const before = JSON.stringify(generated);
    const profile = getWorkloadScenarioProfile('tenant-boundary-probes');
    const probes = getWorkloadTenantBoundaryProbes();

    expect(profile).toMatchObject({
      category: 'tenant-boundary',
      mutationCapable: false,
    });
    expect(probes.map(probe => probe.expectedAllowed)).toEqual([
      true,
      false,
      false,
    ]);
    expect(probes.every(probe => probe.mutation === false)).toBe(true);
    expect(probes.every(probe => probe.expectedNoMutation)).toBe(true);
    expect(profile?.steps.every(step => !step.mutatesData)).toBe(true);
    selectWorkloadScenarioSampleRecords('tenant-boundary-probes', generated);
    expect(JSON.stringify(generated)).toBe(before);
  });
});
