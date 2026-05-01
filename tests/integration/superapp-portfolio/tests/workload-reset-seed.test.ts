import {
  createInitialPortfolioState,
  summarizePortfolio,
} from '../shared/portfolio-state.js';
import {
  createSuperAppWorkloadResetSeedMetadata,
  createSuperAppWorkloadSeed,
} from '../shared/workload-reset-seed.js';

describe('superapp workload reset and seed metadata', () => {
  test('publishes deterministic reset metadata with stable helpers and sample windows', () => {
    const first = createInitialPortfolioState();
    const second = createInitialPortfolioState();
    const metadata = first.workloadResetSeedMetadata;

    expect(metadata).toEqual(second.workloadResetSeedMetadata);
    expect(metadata).toEqual(createSuperAppWorkloadResetSeedMetadata());
    expect(metadata).toMatchObject({
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
    expect(metadata.helperIds).toEqual(first.workloadData.helperIds);
    expect(metadata.sampleWindows.map(window => window.id)).toEqual(
      Object.values(first.workloadData.helperIds.sampleWindows),
    );
    expect(Object.keys(metadata.defaultSeeds)).toEqual([
      'stress',
      'chaos',
      'browser',
      'contract',
    ]);
    expect(metadata.defaultSeeds.stress).toMatchObject({
      target: 'stress',
      scenarioId: 'marketplace-surge-to-ledger',
      profileId: 'read-heavy-command-center',
      tenantId: 'city-ops-eu',
    });
    expect(metadata.defaultSeeds.contract).toMatchObject({
      target: 'contract',
      scenarioId: 'tenant-boundary-audit',
      profileId: 'tenant-boundary-probes',
      tenantId: 'security-root',
    });
    expect(JSON.stringify(metadata.defaultSeeds)).not.toContain('amountCents');
  });

  test('creates deterministic seeds by scenario, profile, and tenant', () => {
    const seedInput = {
      target: 'chaos' as const,
      scenarioId: 'fleet-incident-refund' as const,
      profileId: 'mixed-cross-app-journey' as const,
      tenantId: 'city-ops-eu' as const,
    };
    const first = createSuperAppWorkloadSeed(seedInput);
    const second = createSuperAppWorkloadSeed(seedInput);
    const tenantVariant = createSuperAppWorkloadSeed({
      ...seedInput,
      tenantId: 'acme-global',
    });

    expect(first).toEqual(second);
    expect(first.fingerprint).not.toBe(tenantVariant.fingerprint);
    expect(first.requestIdPrefix).toBe(
      'swl-v1:chaos:fleet-incident-refund:mixed-cross-app-journey:city-ops-eu',
    );
    expect(first.idempotencyKeyPrefix).toBe(`${first.requestIdPrefix}:idem`);
    expect(first.sampleWindowIds).toEqual([
      'rides:city-ops-eu:rush-hour',
      'orders:city-ops-eu:checkout-surge',
      'invoices:acme-global:month-close',
      'ledgerEntries:acme-global:reconciliation',
      'chatThreads:platform-shell:remote-fallback',
      'messages:platform-shell:pagination-window',
      'auditEvents:security-root:policy-stream',
    ]);
    expect(first.sampleRecordIds).toEqual([
      'rid-coe-01501',
      'rid-coe-01502',
      'ord-coe-01025',
      'ord-coe-01026',
      'inv-acm-00513',
      'inv-acm-00514',
      'led-acm-02049',
      'led-acm-02050',
      'thd-psh-00065',
      'thd-psh-00066',
      'msg-psh-04097',
      'msg-psh-04098',
      'aud-sec-02049',
      'aud-sec-02050',
    ]);
    expect(first.metadata).toMatchObject({
      totalRecords: 106960,
      profileCount: 6,
      sampleWindowCount: 13,
      selectedSampleWindowCount: 7,
      selectedSampleRecordCount: 14,
    });
  });

  test('recreates pristine reset state after portfolio and workload drift', () => {
    const baseline = createInitialPortfolioState();
    const drifted = createInitialPortfolioState();

    drifted.events.push({
      id: 'evt-99',
      appId: 'mobility-marketplace',
      action: 'drift',
      actor: 'chaos.runner',
      requestId: 'drift-1',
      status: 'accepted',
    });
    drifted.apps[0].openWork = 1;
    drifted.failureMode = 'api-timeout';
    drifted.workloadData.helperIds.stableRecords.orderId = 'drifted-order';
    drifted.workloadData.metadata.sampleWindows[0].firstId = 'drifted-window';
    drifted.workloadScenarioProfileMetadata.helperMetadata.sampleWindowIds.push(
      'drifted-sample-window',
    );

    const reset = createInitialPortfolioState();

    expect(summarizePortfolio(drifted)).toMatchObject({
      eventCount: 1,
      failureMode: 'api-timeout',
    });
    expect(reset).toEqual(baseline);
    expect(reset.events).toEqual([]);
    expect(reset.pilotRuns).toEqual([]);
    expect(reset.apps[0]).toMatchObject({
      id: 'mobility-marketplace',
      openWork: 84,
    });
    expect(reset.workloadData.helperIds.stableRecords.orderId).toBe(
      'ord-coe-01025',
    );
    expect(reset.workloadData.metadata.sampleWindows[0]).toMatchObject({
      id: 'orders:city-ops-eu:checkout-surge',
      firstId: 'ord-coe-01025',
      lastId: 'ord-coe-01028',
    });
    expect(reset.workloadScenarioProfileMetadata).toEqual(
      baseline.workloadScenarioProfileMetadata,
    );
    expect(reset.workloadResetSeedMetadata).toEqual(
      baseline.workloadResetSeedMetadata,
    );
  });
});
