import { createSuperAppWorkloadCatalog } from '../shared/portfolio-state.js';
import {
  createSuperAppGeneratedWorkloadContract,
  createSuperAppGeneratedWorkloadDataset,
  GENERATED_WORKLOAD_ENTITIES,
  type GeneratedWorkloadEntityCounts,
} from '../shared/workload-generated-data.js';

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
