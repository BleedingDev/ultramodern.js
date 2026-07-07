import {
  createInitialPortfolioState,
  summarizePortfolio,
} from '../shared/portfolio-state';
import {
  createSuperAppWorkloadResetSeedMetadata,
  createSuperAppWorkloadSeed,
} from '../shared/workload-reset-seed';

function contextFromInitialState() {
  const state = createInitialPortfolioState();

  return {
    state,
    context: {
      workloadCatalog: state.workloadCatalog,
      workloadData: state.workloadData,
      workloadScenarioProfileMetadata: state.workloadScenarioProfileMetadata,
    },
  };
}

describe('superapp workload reset and seed metadata', () => {
  test('derives reset metadata from catalog, generated data, and scenario profiles', () => {
    const { state, context } = contextFromInitialState();
    const first = createSuperAppWorkloadResetSeedMetadata(context);
    const second = createSuperAppWorkloadResetSeedMetadata(context);

    expect(first).toEqual(second);
    expect(first).toEqual(state.workloadResetSeedMetadata);
    expect(first.catalogVersion).toBe(state.workloadCatalog.catalogVersion);
    expect(first.catalogSeed).toBe(state.workloadCatalog.seed);
    expect(first.generatedVersion).toBe(state.workloadData.datasetVersion);
    expect(first.generatedSeed).toBe(state.workloadData.seed);
    expect(first.scenarioProfileVersion).toBe(
      state.workloadScenarioProfileMetadata.profileVersion,
    );
    expect(first.scenarioProfileSeed).toBe(
      state.workloadScenarioProfileMetadata.seed,
    );
    expect(first.clockStartIso).toBe(state.workloadData.clockStartIso);
    expect(first.clockStepMs).toBe(state.workloadData.clockStepMs);
    expect(first.helperIds).toEqual(state.workloadData.helperIds);
    expect(first.sampleWindows).toEqual(
      state.workloadData.metadata.sampleWindows,
    );
  });

  test('recreates every default seed from its target tuple', () => {
    const { context } = contextFromInitialState();
    const metadata = createSuperAppWorkloadResetSeedMetadata(context);

    for (const seed of Object.values(metadata.defaultSeeds)) {
      expect(seed.seedVersion).toBe(metadata.resetVersion);
      expect(seed.catalogSeed).toBe(metadata.catalogSeed);
      expect(seed.generatedSeed).toBe(metadata.generatedSeed);
      expect(seed.scenarioProfileSeed).toBe(metadata.scenarioProfileSeed);
      expect(seed.clockStartIso).toBe(metadata.clockStartIso);
      expect(seed.idempotencyKeyPrefix).toBe(`${seed.requestIdPrefix}:idem`);
      expect(seed.fingerprint).toMatch(/^fnv1a-[0-9a-f]{8}$/);
      expect(seed.sampleWindowIds).toEqual(
        seed.selectedSampleWindows.map(window => window.id),
      );
      expect(seed.sampleRecordIds.length).toBeGreaterThan(0);
      expect(seed.selectedSampleWindows.length).toBeGreaterThan(0);
      expect(seed.requestIdPrefix).toContain(seed.target);
      expect(seed.requestIdPrefix).toContain(seed.scenarioId);
      expect(seed.requestIdPrefix).toContain(seed.profileId);
      expect(seed.requestIdPrefix).toContain(seed.tenantId);

      expect(
        createSuperAppWorkloadSeed(
          {
            target: seed.target,
            scenarioId: seed.scenarioId,
            profileId: seed.profileId,
            tenantId: seed.tenantId,
          },
          context,
        ),
      ).toEqual(seed);
    }
  });

  test('fresh portfolio state restores summary and workload metadata', () => {
    const { state, context } = contextFromInitialState();
    const drifted = createInitialPortfolioState();
    const firstApp = drifted.apps[0];

    if (!firstApp) {
      throw new Error('Expected portfolio fixture to include at least one app');
    }

    firstApp.openWork += 1;
    drifted.failureMode = 'api-timeout';

    const reset = createInitialPortfolioState();

    expect(summarizePortfolio(drifted)).not.toEqual(summarizePortfolio(reset));
    expect(summarizePortfolio(reset)).toEqual(summarizePortfolio(state));
    expect(reset.workloadResetSeedMetadata).toEqual(
      createSuperAppWorkloadResetSeedMetadata(context),
    );
  });
});
