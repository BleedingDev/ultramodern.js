import { createSuperAppWorkloadCatalog } from '../shared/portfolio-state';
import {
  createSuperAppGeneratedWorkloadContract,
  GENERATED_WORKLOAD_ENTITIES,
} from '../shared/workload-generated-data';
import { createSuperAppWorkloadResetSeedMetadata } from '../shared/workload-reset-seed';
import { createSuperAppWorkloadScenarioProfileContract } from '../shared/workload-scenario-profiles';
import { createSuperAppWorkloadValidationArtifact } from '../shared/workload-validation-artifact';

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

function sum(values: Iterable<number>) {
  return [...values].reduce((total, value) => total + value, 0);
}

describe('superapp workload validation artifact', () => {
  test('derives dataset summary from generated workload metadata', () => {
    const generated = createSuperAppGeneratedWorkloadContract();
    const first = createSuperAppWorkloadValidationArtifact();
    const second = createSuperAppWorkloadValidationArtifact();

    expect(first).toEqual(second);
    expect(first.fingerprint).toMatch(/^fnv1a-[0-9a-f]{8}$/);
    expect(first.dataset.datasetVersion).toBe(generated.datasetVersion);
    expect(first.dataset.seed).toBe(generated.seed);
    expect(first.dataset.clockStartIso).toBe(generated.clockStartIso);
    expect(first.dataset.clockStepMs).toBe(generated.clockStepMs);
    expect(first.dataset.entityIds).toEqual(GENERATED_WORKLOAD_ENTITIES);
    expect(first.dataset.entityCounts).toEqual(generated.metadata.totals);
    expect(first.dataset.totalRecords).toBe(
      sum(Object.values(generated.metadata.totals)),
    );
    expect(first.dataset.totalRecords).toBe(generated.metadata.totalRecords);
    expect(first.dataset.highWatermarks).toEqual(
      generated.metadata.highWatermarks,
    );
    expect(first.dataset.tenantRecordCounts).toEqual(
      generated.metadata.tenantSummaries.map(summary => ({
        tenantId: summary.tenantId,
        region: summary.region,
        appIds: summary.appIds,
        totalRecords: summary.totalRecords,
        nonZeroEntityIds: GENERATED_WORKLOAD_ENTITIES.filter(
          entity => summary.totals[entity] > 0,
        ),
        sampleIds: summary.sampleIds,
      })),
    );
  });

  test('derives catalog, scenario, profile, and reset coverage from source catalogs', () => {
    const catalog = createSuperAppWorkloadCatalog();
    const scenarioProfiles = createSuperAppWorkloadScenarioProfileContract();
    const resetMetadata = createSuperAppWorkloadResetSeedMetadata();
    const artifact = createSuperAppWorkloadValidationArtifact();

    expect(artifact.tenantCoverage.tenantIds).toEqual(
      catalog.tenants.map(tenant => tenant.id),
    );
    expect(artifact.domainCoverage.domainIds).toEqual(
      catalog.domains.map(domain => domain.id),
    );
    expect(artifact.scenarioCoverage.scenarioIds).toEqual(
      catalog.scenarios.map(scenario => scenario.id),
    );
    expect(artifact.profileCoverage.profileIds).toEqual(
      scenarioProfiles.profiles.map(profile => profile.id),
    );
    expect(artifact.profileCoverage.categoryCounts).toEqual(
      artifact.profileCoverage.categories.map(category => ({
        category,
        count: scenarioProfiles.profiles.filter(
          profile => profile.category === category,
        ).length,
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

    expect(artifact.resetIntegrity).toMatchObject({
      resetVersion: resetMetadata.resetVersion,
      resetSeed: resetMetadata.resetSeed,
      catalogSeed: resetMetadata.catalogSeed,
      generatedSeed: resetMetadata.generatedSeed,
      scenarioProfileSeed: resetMetadata.scenarioProfileSeed,
      clockStartIso: resetMetadata.clockStartIso,
      clockStepMs: resetMetadata.clockStepMs,
      initialEventCounter: resetMetadata.initialEventCounter,
      initialPilotRunCounter: resetMetadata.initialPilotRunCounter,
    });
    expect(Object.values(artifact.resetIntegrity.linkage).every(Boolean)).toBe(
      true,
    );
    expect(artifact.resetIntegrity.stableHelperIds).toEqual(
      resetMetadata.helperIds,
    );
    expect(artifact.resetIntegrity.sampleWindowIds).toEqual(
      resetMetadata.sampleWindows.map(window => window.id),
    );

    for (const coverage of Object.values(artifact.consumerTargetCoverage)) {
      expect(
        coverage.profileIds.every(id =>
          artifact.profileCoverage.profileIds.includes(id),
        ),
      ).toBe(true);
      expect(coverage.resetFingerprint).toBe(
        resetMetadata.defaultSeeds[coverage.resetSeedTarget].fingerprint,
      );
    }
  });

  test('keeps sample windows compact and omits large generated payloads', () => {
    const generated = createSuperAppGeneratedWorkloadContract();
    const artifact = createSuperAppWorkloadValidationArtifact();

    expect(artifact.sampleWindows.totalCount).toBe(
      generated.metadata.sampleWindows.length,
    );
    expect(artifact.sampleWindows.sampleWindowIds).toEqual(
      generated.metadata.sampleWindows.map(window => window.id),
    );
    expect(artifact.sampleWindows.windows).toEqual(
      generated.metadata.sampleWindows.map(window => ({
        id: window.id,
        entity: window.entity,
        tenantId: window.tenantId,
        start: window.start,
        limit: window.limit,
        count: window.count,
        firstId: window.firstId,
        lastId: window.lastId,
      })),
    );

    expect(artifact.compactness).toMatchObject({
      fullGeneratedRecordArraysOmitted: true,
      fullGeneratedSamplePayloadsOmitted: true,
      fullCatalogPayloadsOmitted: true,
      includesOnlyIdsCountsFingerprintsAndWindows: true,
    });
    expect(new Set(artifact.compactness.omittedPaths).size).toBe(
      artifact.compactness.omittedPaths.length,
    );
    expect(hasObjectKey(artifact, 'records')).toBe(false);
    expect(hasObjectKey(artifact, 'samples')).toBe(false);
    expect(hasObjectKey(artifact, 'selectedSampleWindows')).toBe(false);
  });
});
