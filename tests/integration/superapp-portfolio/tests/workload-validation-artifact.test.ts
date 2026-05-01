import { createSuperAppWorkloadResetSeedMetadata } from '../shared/workload-reset-seed.js';
import { createSuperAppWorkloadValidationArtifact } from '../shared/workload-validation-artifact.js';

const expectedEntityCounts = {
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

function hasObjectKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some(item => hasObjectKey(item, key));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    Object.hasOwn(value, key) ||
    Object.values(value).some(item => hasObjectKey(item, key))
  );
}

describe('superapp workload validation artifact', () => {
  test('publishes deterministic dataset size and stable sample metadata', () => {
    const first = createSuperAppWorkloadValidationArtifact();
    const second = createSuperAppWorkloadValidationArtifact();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      artifactVersion: 'superapp-workload-validation-artifact-v1',
      artifactSeed: 'superapp-portfolio-validation-artifact-v1',
      fingerprint: expect.stringMatching(/^fnv1a-[0-9a-f]{8}$/),
      dataset: {
        datasetVersion: 'superapp-generated-workload-v1',
        seed: 'superapp-portfolio-generated-workload-v1',
        clockStartIso: '2026-01-15T08:00:00.000Z',
        clockStepMs: 17000,
        totalRecords: 106960,
        entityCounts: expectedEntityCounts,
      },
      sampleWindows: {
        totalCount: 13,
      },
    });
    expect(first.dataset.entityIds).toEqual(Object.keys(expectedEntityCounts));
    expect(first.dataset.highWatermarks).toEqual(
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
      ]),
    );
    expect(first.sampleWindows.sampleWindowIds).toEqual(
      Object.values(first.resetIntegrity.stableHelperIds.sampleWindows),
    );
    expect(first.sampleWindows.windows[0]).toEqual({
      id: 'orders:city-ops-eu:checkout-surge',
      entity: 'orders',
      tenantId: 'city-ops-eu',
      start: 1024,
      limit: 4,
      count: 4,
      firstId: 'ord-coe-01025',
      lastId: 'ord-coe-01028',
    });
  });

  test('records complete tenant, domain, scenario, profile, and consumer coverage', () => {
    const artifact = createSuperAppWorkloadValidationArtifact();

    expect(artifact.tenantCoverage.tenantIds).toEqual([
      'superapp-global',
      'city-ops-eu',
      'acme-global',
      'platform-shell',
      'security-root',
      'chaos-lab',
    ]);
    expect(artifact.domainCoverage.domainIds).toEqual([
      'erp-finance',
      'dispatch-mobility',
      'marketplace-orders',
      'fleet-mobility',
      'chat-threads',
      'audit-events',
      'users-roles',
      'admin-operations',
    ]);
    expect(artifact.scenarioCoverage.scenarioIds).toEqual([
      'marketplace-surge-to-ledger',
      'fleet-incident-refund',
      'erp-close-admin-rotation',
      'tenant-boundary-audit',
    ]);
    expect(artifact.profileCoverage.profileIds).toEqual([
      'read-heavy-command-center',
      'write-heavy-order-ledger',
      'mixed-cross-app-journey',
      'search-filter-sort-ledger',
      'chat-pagination-history',
      'tenant-boundary-probes',
    ]);
    expect(artifact.profileCoverage.categoryCounts).toEqual(
      artifact.profileCoverage.categories.map(category => ({
        category,
        count: 1,
      })),
    );
    expect(
      artifact.scenarioCoverage.scenarios.every(
        scenario => scenario.profileIds.length > 0,
      ),
    ).toBe(true);
    expect(
      artifact.domainCoverage.domains.every(
        domain => domain.profileIds.length > 0,
      ),
    ).toBe(true);
    expect(artifact.consumerTargetCoverage.k6.profileIds).toEqual([
      'read-heavy-command-center',
      'write-heavy-order-ledger',
      'mixed-cross-app-journey',
      'chat-pagination-history',
    ]);
    expect(artifact.consumerTargetCoverage.load.profileIds).toEqual([
      'read-heavy-command-center',
      'write-heavy-order-ledger',
      'mixed-cross-app-journey',
      'search-filter-sort-ledger',
      'chat-pagination-history',
    ]);
    expect(artifact.consumerTargetCoverage.contract.profileIds).toEqual(
      artifact.profileCoverage.profileIds,
    );
    expect(artifact.consumerTargetCoverage.browser.categoryIds).toEqual([
      'read-heavy',
      'mixed',
      'search-filter-sort',
      'chat-pagination',
      'tenant-boundary',
    ]);
  });

  test('links reset integrity fingerprints, helpers, and default seed coverage', () => {
    const artifact = createSuperAppWorkloadValidationArtifact();
    const resetMetadata = createSuperAppWorkloadResetSeedMetadata();

    expect(artifact.resetIntegrity).toMatchObject({
      resetVersion: 'superapp-workload-reset-seed-v1',
      resetSeed: 'superapp-portfolio-reset-seed-v1',
      catalogSeed: 'superapp-portfolio-workload-data-v1',
      generatedSeed: 'superapp-portfolio-generated-workload-v1',
      scenarioProfileSeed: 'superapp-portfolio-scenario-profiles-v1',
      clockStartIso: '2026-01-15T08:00:00.000Z',
      clockStepMs: 17000,
      eventIdPrefix: 'evt',
      pilotRunIdPrefix: 'pilot',
      initialEventCounter: 0,
      initialPilotRunCounter: 0,
    });
    expect(Object.values(artifact.resetIntegrity.linkage)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(artifact.resetIntegrity.stableHelperIds).toEqual(
      resetMetadata.helperIds,
    );
    expect(artifact.resetIntegrity.sampleWindowIds).toEqual(
      resetMetadata.sampleWindows.map(window => window.id),
    );
    expect(artifact.resetIntegrity.defaultSeeds.browser).toMatchObject({
      target: 'browser',
      fingerprint: resetMetadata.defaultSeeds.browser.fingerprint,
      scenarioId: 'marketplace-surge-to-ledger',
      profileId: 'mixed-cross-app-journey',
      tenantId: 'city-ops-eu',
      selectedSampleWindowCount: 7,
      selectedSampleRecordCount: 14,
    });
    expect(artifact.consumerTargetCoverage.k6.resetSeedTarget).toBe('stress');
    expect(artifact.consumerTargetCoverage.load.resetFingerprint).toBe(
      resetMetadata.defaultSeeds.stress.fingerprint,
    );
    expect(artifact.consumerTargetCoverage.chaos.resetFingerprint).toBe(
      resetMetadata.defaultSeeds.chaos.fingerprint,
    );
    expect(artifact.consumerTargetCoverage.contract.resetFingerprint).toBe(
      resetMetadata.defaultSeeds.contract.fingerprint,
    );
  });

  test('stays compact and intentionally omits large generated arrays', () => {
    const artifact = createSuperAppWorkloadValidationArtifact();

    expect(artifact.compactness).toEqual({
      fullGeneratedRecordArraysOmitted: true,
      fullGeneratedSamplePayloadsOmitted: true,
      fullCatalogPayloadsOmitted: true,
      includesOnlyIdsCountsFingerprintsAndWindows: true,
      omittedPaths: [
        'workloadData.records',
        'workloadData.samples.*.recordPayloads',
        'workloadCatalog.tenants',
        'workloadCatalog.roles',
        'workloadCatalog.users',
        'workloadCatalog.domains',
        'workloadCatalog.scenarios',
        'workloadCatalog.adminOperations',
        'workloadResetSeedMetadata.defaultSeeds.*.selectedSampleWindows',
      ],
      note: expect.stringContaining('intentionally omitted'),
    });
    expect(hasObjectKey(artifact, 'records')).toBe(false);
    expect(hasObjectKey(artifact, 'samples')).toBe(false);
    expect(hasObjectKey(artifact, 'selectedSampleWindows')).toBe(false);
    expect(hasObjectKey(artifact, 'amountCents')).toBe(false);
    expect(hasObjectKey(artifact, 'relatedIds')).toBe(false);
    expect(Object.keys(artifact.resetIntegrity.defaultSeeds.browser)).toEqual([
      'target',
      'seed',
      'fingerprint',
      'scenarioId',
      'profileId',
      'tenantId',
      'requestIdPrefix',
      'idempotencyKeyPrefix',
      'sampleWindowIds',
      'sampleRecordIds',
      'selectedSampleWindowCount',
      'selectedSampleRecordCount',
    ]);
  });
});
