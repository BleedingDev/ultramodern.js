// @effect-diagnostics strictBooleanExpressions:off
import {
  createSuperAppWorkloadCatalog,
  SUPERAPP_WORKLOAD_DOMAIN_IDS,
  SUPERAPP_WORKLOAD_SCENARIO_IDS,
  SUPERAPP_WORKLOAD_TENANT_IDS,
  type SuperAppWorkloadCatalog,
  type WorkloadDomainId,
  type WorkloadScenarioId,
  type WorkloadTenantId,
} from './workload-domain-catalog.js';
import {
  createSuperAppGeneratedWorkloadContract,
  GENERATED_WORKLOAD_ENTITIES,
  type GeneratedWorkloadEntity,
  type GeneratedWorkloadEntityCounts,
  type GeneratedWorkloadHelperIds,
  type SuperAppGeneratedWorkloadContract,
} from './workload-generated-data.js';
import {
  createSuperAppWorkloadResetSeedMetadata,
  type SuperAppWorkloadResetSeedMetadata,
  type WorkloadResetSeedTarget,
} from './workload-reset-seed.js';
import {
  createSuperAppWorkloadScenarioProfileContract,
  type SuperAppWorkloadScenarioProfileContract,
  type SuperAppWorkloadScenarioProfileMetadata,
  type WorkloadScenarioConsumerTarget,
  type WorkloadScenarioOperationMix,
  type WorkloadScenarioProfileCategory,
  type WorkloadScenarioProfileId,
} from './workload-scenario-profiles.js';

export type WorkloadValidationArtifactContext = {
  workloadCatalog?: SuperAppWorkloadCatalog;
  workloadData?: SuperAppGeneratedWorkloadContract;
  workloadScenarioProfileContract?: SuperAppWorkloadScenarioProfileContract;
  workloadResetSeedMetadata?: SuperAppWorkloadResetSeedMetadata;
};

export type WorkloadValidationDatasetSummary = {
  datasetVersion: SuperAppGeneratedWorkloadContract['datasetVersion'];
  seed: SuperAppGeneratedWorkloadContract['seed'];
  clockStartIso: SuperAppGeneratedWorkloadContract['clockStartIso'];
  clockStepMs: SuperAppGeneratedWorkloadContract['clockStepMs'];
  totalRecords: number;
  entityIds: GeneratedWorkloadEntity[];
  entityCounts: GeneratedWorkloadEntityCounts;
  highWatermarks: Array<{
    entity: GeneratedWorkloadEntity;
    count: number;
    firstId: string;
    lastId: string;
    lastCreatedAtIso: string;
  }>;
  tenantRecordCounts: Array<{
    tenantId: WorkloadTenantId;
    region: string;
    appIds: string[];
    totalRecords: number;
    nonZeroEntityIds: GeneratedWorkloadEntity[];
    sampleIds: string[];
  }>;
};

export type WorkloadValidationTenantCoverage = {
  tenantIds: WorkloadTenantId[];
  tenantCount: number;
  tenants: Array<{
    tenantId: WorkloadTenantId;
    region: string;
    appIds: string[];
    domainIds: WorkloadDomainId[];
    scenarioIds: WorkloadScenarioId[];
    profileIds: WorkloadScenarioProfileId[];
    sampleWindowIds: string[];
    totalRecords: number;
  }>;
};

export type WorkloadValidationDomainCoverage = {
  domainIds: WorkloadDomainId[];
  domainCount: number;
  domains: Array<{
    domainId: WorkloadDomainId;
    ownerAppId: string;
    tenantIds: WorkloadTenantId[];
    scenarioIds: WorkloadScenarioId[];
    profileIds: WorkloadScenarioProfileId[];
    consumerTargets: WorkloadScenarioConsumerTarget[];
    routeCount: number;
    dataClasses: string[];
    consistency: string;
    budgetTargets: Array<'browser' | 'contract' | 'load' | 'chaos'>;
  }>;
};

export type WorkloadValidationScenarioCoverage = {
  scenarioIds: WorkloadScenarioId[];
  scenarioCount: number;
  scenarios: Array<{
    scenarioId: WorkloadScenarioId;
    tenantId: WorkloadTenantId;
    domainIds: WorkloadDomainId[];
    profileIds: WorkloadScenarioProfileId[];
    consumerTargets: WorkloadScenarioConsumerTarget[];
    routeCount: number;
    operationCount: number;
    chaosTargetIds: WorkloadDomainId[];
  }>;
};

export type WorkloadValidationProfileCoverage = {
  profileVersion: SuperAppWorkloadScenarioProfileMetadata['profileVersion'];
  seed: SuperAppWorkloadScenarioProfileMetadata['seed'];
  profileIds: WorkloadScenarioProfileId[];
  profileCount: number;
  categories: WorkloadScenarioProfileCategory[];
  categoryCounts: Array<{
    category: WorkloadScenarioProfileCategory;
    count: number;
  }>;
  profiles: Array<{
    profileId: WorkloadScenarioProfileId;
    category: WorkloadScenarioProfileCategory;
    targets: WorkloadScenarioConsumerTarget[];
    tenantIds: WorkloadTenantId[];
    domainIds: WorkloadDomainId[];
    scenarioIds: WorkloadScenarioId[];
    sampleWindowIds: string[];
    sampleSelectorCount: number;
    stepCount: number;
    tenantBoundaryProbeCount: number;
    operationMix: WorkloadScenarioOperationMix;
    mutationCapable: boolean;
  }>;
};

export type WorkloadValidationConsumerTargetCoverage = {
  target: WorkloadScenarioConsumerTarget;
  profileIds: WorkloadScenarioProfileId[];
  categoryIds: WorkloadScenarioProfileCategory[];
  scenarioIds: WorkloadScenarioId[];
  tenantIds: WorkloadTenantId[];
  domainIds: WorkloadDomainId[];
  sampleWindowIds: string[];
  stepCount: number;
  mutationCapableProfileIds: WorkloadScenarioProfileId[];
  resetSeedTarget: WorkloadResetSeedTarget;
  resetFingerprint: string;
  resetRequestIdPrefix: string;
  resetSampleWindowCount: number;
  resetSampleRecordCount: number;
};

export type WorkloadValidationResetIntegrity = {
  resetVersion: SuperAppWorkloadResetSeedMetadata['resetVersion'];
  resetSeed: SuperAppWorkloadResetSeedMetadata['resetSeed'];
  catalogSeed: SuperAppWorkloadResetSeedMetadata['catalogSeed'];
  generatedSeed: SuperAppWorkloadResetSeedMetadata['generatedSeed'];
  scenarioProfileSeed: SuperAppWorkloadResetSeedMetadata['scenarioProfileSeed'];
  clockStartIso: SuperAppWorkloadResetSeedMetadata['clockStartIso'];
  clockStepMs: SuperAppWorkloadResetSeedMetadata['clockStepMs'];
  eventIdPrefix: SuperAppWorkloadResetSeedMetadata['eventIdPrefix'];
  pilotRunIdPrefix: SuperAppWorkloadResetSeedMetadata['pilotRunIdPrefix'];
  initialEventCounter: SuperAppWorkloadResetSeedMetadata['initialEventCounter'];
  initialPilotRunCounter: SuperAppWorkloadResetSeedMetadata['initialPilotRunCounter'];
  stableHelperIds: GeneratedWorkloadHelperIds;
  sampleWindowIds: string[];
  defaultSeeds: Record<
    WorkloadResetSeedTarget,
    {
      target: WorkloadResetSeedTarget;
      seed: string;
      fingerprint: string;
      scenarioId: WorkloadScenarioId;
      profileId: WorkloadScenarioProfileId;
      tenantId: WorkloadTenantId;
      requestIdPrefix: string;
      idempotencyKeyPrefix: string;
      sampleWindowIds: string[];
      sampleRecordIds: string[];
      selectedSampleWindowCount: number;
      selectedSampleRecordCount: number;
    }
  >;
  linkage: {
    catalogVersionMatches: boolean;
    generatedVersionMatches: boolean;
    scenarioProfileVersionMatches: boolean;
    helperIdsMatchGeneratedData: boolean;
    sampleWindowIdsMatchGeneratedData: boolean;
  };
};

export type WorkloadValidationSampleWindowSummary = {
  totalCount: number;
  sampleWindowIds: string[];
  countsByEntity: Record<GeneratedWorkloadEntity, number>;
  windows: Array<{
    id: string;
    entity: GeneratedWorkloadEntity;
    tenantId: WorkloadTenantId;
    start: number;
    limit: number;
    count: number;
    firstId: string;
    lastId: string;
  }>;
};

export type WorkloadValidationCompactness = {
  fullGeneratedRecordArraysOmitted: true;
  fullGeneratedSamplePayloadsOmitted: true;
  fullCatalogPayloadsOmitted: true;
  includesOnlyIdsCountsFingerprintsAndWindows: true;
  omittedPaths: string[];
  note: string;
};

export type SuperAppWorkloadValidationArtifact = {
  artifactVersion: 'superapp-workload-validation-artifact-v1';
  artifactSeed: 'superapp-portfolio-validation-artifact-v1';
  fingerprint: string;
  sourceVersions: {
    catalogVersion: SuperAppWorkloadCatalog['catalogVersion'];
    generatedVersion: SuperAppGeneratedWorkloadContract['datasetVersion'];
    scenarioProfileVersion: SuperAppWorkloadScenarioProfileMetadata['profileVersion'];
    resetVersion: SuperAppWorkloadResetSeedMetadata['resetVersion'];
  };
  sourceSeeds: {
    catalogSeed: SuperAppWorkloadCatalog['seed'];
    generatedSeed: SuperAppGeneratedWorkloadContract['seed'];
    scenarioProfileSeed: SuperAppWorkloadScenarioProfileMetadata['seed'];
    resetSeed: SuperAppWorkloadResetSeedMetadata['resetSeed'];
  };
  dataset: WorkloadValidationDatasetSummary;
  tenantCoverage: WorkloadValidationTenantCoverage;
  domainCoverage: WorkloadValidationDomainCoverage;
  scenarioCoverage: WorkloadValidationScenarioCoverage;
  profileCoverage: WorkloadValidationProfileCoverage;
  consumerTargetCoverage: Record<
    WorkloadScenarioConsumerTarget,
    WorkloadValidationConsumerTargetCoverage
  >;
  resetIntegrity: WorkloadValidationResetIntegrity;
  sampleWindows: WorkloadValidationSampleWindowSummary;
  compactness: WorkloadValidationCompactness;
};

type ResolvedValidationContext = {
  workloadCatalog: SuperAppWorkloadCatalog;
  workloadData: SuperAppGeneratedWorkloadContract;
  workloadScenarioProfileContract: SuperAppWorkloadScenarioProfileContract;
  workloadScenarioProfileMetadata: SuperAppWorkloadScenarioProfileMetadata;
  workloadResetSeedMetadata: SuperAppWorkloadResetSeedMetadata;
};

const ARTIFACT_VERSION = 'superapp-workload-validation-artifact-v1' as const;
const ARTIFACT_SEED = 'superapp-portfolio-validation-artifact-v1' as const;
const CONSUMER_TARGETS: WorkloadScenarioConsumerTarget[] = [
  'k6',
  'load',
  'chaos',
  'browser',
  'contract',
];
const RESET_TARGET_BY_CONSUMER: Record<
  WorkloadScenarioConsumerTarget,
  WorkloadResetSeedTarget
> = {
  k6: 'stress',
  load: 'stress',
  chaos: 'chaos',
  browser: 'browser',
  contract: 'contract',
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function fingerprintFor(value: unknown) {
  const input = stableStringify(value);
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function profileMetadataFromContract(
  contract: SuperAppWorkloadScenarioProfileContract,
): SuperAppWorkloadScenarioProfileMetadata {
  const { profiles: _profiles, ...metadata } = contract;
  return metadata;
}

function resolveContext(
  context: WorkloadValidationArtifactContext = {},
): ResolvedValidationContext {
  const workloadCatalog =
    context.workloadCatalog ?? createSuperAppWorkloadCatalog();
  const workloadData =
    context.workloadData ??
    createSuperAppGeneratedWorkloadContract(workloadCatalog);
  const workloadScenarioProfileContract =
    context.workloadScenarioProfileContract ??
    createSuperAppWorkloadScenarioProfileContract();
  const workloadScenarioProfileMetadata = profileMetadataFromContract(
    workloadScenarioProfileContract,
  );
  const workloadResetSeedMetadata =
    context.workloadResetSeedMetadata ??
    createSuperAppWorkloadResetSeedMetadata({
      workloadCatalog,
      workloadData,
      workloadScenarioProfileMetadata,
    });

  return {
    workloadCatalog,
    workloadData,
    workloadScenarioProfileContract,
    workloadScenarioProfileMetadata,
    workloadResetSeedMetadata,
  };
}

function createDatasetSummary({
  workloadData,
}: ResolvedValidationContext): WorkloadValidationDatasetSummary {
  return {
    datasetVersion: workloadData.datasetVersion,
    seed: workloadData.seed,
    clockStartIso: workloadData.clockStartIso,
    clockStepMs: workloadData.clockStepMs,
    totalRecords: workloadData.metadata.totalRecords,
    entityIds: GENERATED_WORKLOAD_ENTITIES,
    entityCounts: workloadData.metadata.totals,
    highWatermarks: workloadData.metadata.highWatermarks.map(mark => ({
      entity: mark.entity,
      count: mark.count,
      firstId: mark.firstId,
      lastId: mark.lastId,
      lastCreatedAtIso: mark.lastCreatedAtIso,
    })),
    tenantRecordCounts: workloadData.metadata.tenantSummaries.map(summary => ({
      tenantId: summary.tenantId,
      region: summary.region,
      appIds: summary.appIds,
      totalRecords: summary.totalRecords,
      nonZeroEntityIds: GENERATED_WORKLOAD_ENTITIES.filter(
        entity => summary.totals[entity] > 0,
      ),
      sampleIds: summary.sampleIds,
    })),
  };
}

function createTenantCoverage({
  workloadCatalog,
  workloadData,
  workloadScenarioProfileContract,
}: ResolvedValidationContext): WorkloadValidationTenantCoverage {
  return {
    tenantIds: SUPERAPP_WORKLOAD_TENANT_IDS,
    tenantCount: SUPERAPP_WORKLOAD_TENANT_IDS.length,
    tenants: workloadCatalog.tenants.map(tenant => {
      const tenantSummary = workloadData.metadata.tenantSummaries.find(
        summary => summary.tenantId === tenant.id,
      );
      const domainIds = workloadCatalog.domains
        .filter(domain => domain.tenantIds.includes(tenant.id))
        .map(domain => domain.id);
      const scenarioIds = workloadCatalog.scenarios
        .filter(scenario => scenario.tenantId === tenant.id)
        .map(scenario => scenario.id);
      const profileIds = workloadScenarioProfileContract.profiles
        .filter(profile => profile.tenantIds.includes(tenant.id))
        .map(profile => profile.id);
      const sampleWindowIds = workloadData.metadata.sampleWindows
        .filter(window => window.tenantId === tenant.id)
        .map(window => window.id);

      return {
        tenantId: tenant.id,
        region: tenant.region,
        appIds: tenant.appIds,
        domainIds,
        scenarioIds,
        profileIds,
        sampleWindowIds,
        totalRecords: tenantSummary?.totalRecords ?? 0,
      };
    }),
  };
}

function createDomainCoverage({
  workloadCatalog,
  workloadScenarioProfileContract,
}: ResolvedValidationContext): WorkloadValidationDomainCoverage {
  return {
    domainIds: SUPERAPP_WORKLOAD_DOMAIN_IDS,
    domainCount: SUPERAPP_WORKLOAD_DOMAIN_IDS.length,
    domains: workloadCatalog.domains.map(domain => {
      const scenarioIds = workloadCatalog.scenarios
        .filter(scenario => scenario.domains.includes(domain.id))
        .map(scenario => scenario.id);
      const profiles = workloadScenarioProfileContract.profiles.filter(
        profile => profile.domainIds.includes(domain.id),
      );

      return {
        domainId: domain.id,
        ownerAppId: domain.ownerAppId,
        tenantIds: domain.tenantIds,
        scenarioIds,
        profileIds: profiles.map(profile => profile.id),
        consumerTargets: unique(profiles.flatMap(profile => profile.targets)),
        routeCount: domain.routes.length,
        dataClasses: domain.dataClasses,
        consistency: domain.consistency,
        budgetTargets: ['browser', 'contract', 'load', 'chaos'],
      };
    }),
  };
}

function createScenarioCoverage({
  workloadCatalog,
  workloadScenarioProfileContract,
}: ResolvedValidationContext): WorkloadValidationScenarioCoverage {
  return {
    scenarioIds: SUPERAPP_WORKLOAD_SCENARIO_IDS,
    scenarioCount: SUPERAPP_WORKLOAD_SCENARIO_IDS.length,
    scenarios: workloadCatalog.scenarios.map(scenario => {
      const profiles = workloadScenarioProfileContract.profiles.filter(
        profile => profile.catalogScenarioIds.includes(scenario.id),
      );

      return {
        scenarioId: scenario.id,
        tenantId: scenario.tenantId,
        domainIds: scenario.domains,
        profileIds: profiles.map(profile => profile.id),
        consumerTargets: unique(profiles.flatMap(profile => profile.targets)),
        routeCount: scenario.routes.length,
        operationCount: scenario.operations.length,
        chaosTargetIds: scenario.chaosTargets,
      };
    }),
  };
}

function createProfileCoverage({
  workloadScenarioProfileContract,
  workloadScenarioProfileMetadata,
}: ResolvedValidationContext): WorkloadValidationProfileCoverage {
  return {
    profileVersion: workloadScenarioProfileMetadata.profileVersion,
    seed: workloadScenarioProfileMetadata.seed,
    profileIds: workloadScenarioProfileMetadata.profileIds,
    profileCount: workloadScenarioProfileMetadata.helperMetadata.profileCount,
    categories: workloadScenarioProfileMetadata.categories,
    categoryCounts:
      workloadScenarioProfileMetadata.helperMetadata.categoryCounts,
    profiles: workloadScenarioProfileContract.profiles.map(profile => ({
      profileId: profile.id,
      category: profile.category,
      targets: profile.targets,
      tenantIds: profile.tenantIds,
      domainIds: profile.domainIds,
      scenarioIds: profile.catalogScenarioIds,
      sampleWindowIds: profile.sampleWindowIds,
      sampleSelectorCount: profile.sampleSelectors.length,
      stepCount: profile.steps.length,
      tenantBoundaryProbeCount: profile.tenantBoundaryProbes.length,
      operationMix: profile.operationMix,
      mutationCapable: profile.mutationCapable,
    })),
  };
}

function createConsumerTargetCoverage({
  workloadScenarioProfileContract,
  workloadScenarioProfileMetadata,
  workloadResetSeedMetadata,
}: ResolvedValidationContext): Record<
  WorkloadScenarioConsumerTarget,
  WorkloadValidationConsumerTargetCoverage
> {
  const profileById = new Map(
    workloadScenarioProfileContract.profiles.map(profile => [
      profile.id,
      profile,
    ]),
  );

  return Object.fromEntries(
    CONSUMER_TARGETS.map(target => {
      const profileIds =
        workloadScenarioProfileMetadata.helperMetadata.defaultProfileIds[
          target
        ];
      const profiles = profileIds.map(profileId => {
        const profile = profileById.get(profileId);
        if (!profile) {
          throw new Error(
            `Missing workload validation target profile: ${profileId}`,
          );
        }
        return profile;
      });
      const resetSeedTarget = RESET_TARGET_BY_CONSUMER[target];
      const resetSeed = workloadResetSeedMetadata.defaultSeeds[resetSeedTarget];

      return [
        target,
        {
          target,
          profileIds,
          categoryIds: unique(profiles.map(profile => profile.category)),
          scenarioIds: unique(
            profiles.flatMap(profile => profile.catalogScenarioIds),
          ),
          tenantIds: unique(profiles.flatMap(profile => profile.tenantIds)),
          domainIds: unique(profiles.flatMap(profile => profile.domainIds)),
          sampleWindowIds: unique(
            profiles.flatMap(profile => profile.sampleWindowIds),
          ),
          stepCount: profiles.reduce(
            (sum, profile) => sum + profile.steps.length,
            0,
          ),
          mutationCapableProfileIds: profiles
            .filter(profile => profile.mutationCapable)
            .map(profile => profile.id),
          resetSeedTarget,
          resetFingerprint: resetSeed.fingerprint,
          resetRequestIdPrefix: resetSeed.requestIdPrefix,
          resetSampleWindowCount: resetSeed.metadata.selectedSampleWindowCount,
          resetSampleRecordCount: resetSeed.metadata.selectedSampleRecordCount,
        },
      ];
    }),
  ) as Record<
    WorkloadScenarioConsumerTarget,
    WorkloadValidationConsumerTargetCoverage
  >;
}

function createResetIntegrity({
  workloadCatalog,
  workloadData,
  workloadScenarioProfileMetadata,
  workloadResetSeedMetadata,
}: ResolvedValidationContext): WorkloadValidationResetIntegrity {
  const sampleWindowIds = workloadResetSeedMetadata.sampleWindows.map(
    window => window.id,
  );
  const generatedSampleWindowIds = workloadData.metadata.sampleWindows.map(
    window => window.id,
  );
  const defaultSeeds = Object.fromEntries(
    Object.entries(workloadResetSeedMetadata.defaultSeeds).map(
      ([target, seed]) => [
        target,
        {
          target: seed.target,
          seed: seed.seed,
          fingerprint: seed.fingerprint,
          scenarioId: seed.scenarioId,
          profileId: seed.profileId,
          tenantId: seed.tenantId,
          requestIdPrefix: seed.requestIdPrefix,
          idempotencyKeyPrefix: seed.idempotencyKeyPrefix,
          sampleWindowIds: seed.sampleWindowIds,
          sampleRecordIds: seed.sampleRecordIds,
          selectedSampleWindowCount: seed.metadata.selectedSampleWindowCount,
          selectedSampleRecordCount: seed.metadata.selectedSampleRecordCount,
        },
      ],
    ),
  ) as WorkloadValidationResetIntegrity['defaultSeeds'];

  return {
    resetVersion: workloadResetSeedMetadata.resetVersion,
    resetSeed: workloadResetSeedMetadata.resetSeed,
    catalogSeed: workloadResetSeedMetadata.catalogSeed,
    generatedSeed: workloadResetSeedMetadata.generatedSeed,
    scenarioProfileSeed: workloadResetSeedMetadata.scenarioProfileSeed,
    clockStartIso: workloadResetSeedMetadata.clockStartIso,
    clockStepMs: workloadResetSeedMetadata.clockStepMs,
    eventIdPrefix: workloadResetSeedMetadata.eventIdPrefix,
    pilotRunIdPrefix: workloadResetSeedMetadata.pilotRunIdPrefix,
    initialEventCounter: workloadResetSeedMetadata.initialEventCounter,
    initialPilotRunCounter: workloadResetSeedMetadata.initialPilotRunCounter,
    stableHelperIds: workloadResetSeedMetadata.helperIds,
    sampleWindowIds,
    defaultSeeds,
    linkage: {
      catalogVersionMatches:
        workloadResetSeedMetadata.catalogVersion ===
        workloadCatalog.catalogVersion,
      generatedVersionMatches:
        workloadResetSeedMetadata.generatedVersion ===
        workloadData.datasetVersion,
      scenarioProfileVersionMatches:
        workloadResetSeedMetadata.scenarioProfileVersion ===
        workloadScenarioProfileMetadata.profileVersion,
      helperIdsMatchGeneratedData:
        stableStringify(workloadResetSeedMetadata.helperIds) ===
        stableStringify(workloadData.helperIds),
      sampleWindowIdsMatchGeneratedData:
        stableStringify(sampleWindowIds) ===
        stableStringify(generatedSampleWindowIds),
    },
  };
}

function createSampleWindowSummary({
  workloadData,
}: ResolvedValidationContext): WorkloadValidationSampleWindowSummary {
  return {
    totalCount: workloadData.metadata.sampleWindows.length,
    sampleWindowIds: workloadData.metadata.sampleWindows.map(
      window => window.id,
    ),
    countsByEntity: GENERATED_WORKLOAD_ENTITIES.reduce(
      (countsByEntity, entity) => {
        countsByEntity[entity] = workloadData.metadata.sampleWindows.filter(
          window => window.entity === entity,
        ).length;
        return countsByEntity;
      },
      {} as Record<GeneratedWorkloadEntity, number>,
    ),
    windows: workloadData.metadata.sampleWindows.map(window => ({
      id: window.id,
      entity: window.entity,
      tenantId: window.tenantId,
      start: window.start,
      limit: window.limit,
      count: window.count,
      firstId: window.firstId,
      lastId: window.lastId,
    })),
  };
}

function createCompactness(): WorkloadValidationCompactness {
  return {
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
    note: 'Full generated record arrays and generated record payload samples are intentionally omitted; consumers should use IDs, counts, sample windows, helper IDs, and reset fingerprints.',
  };
}

export function createSuperAppWorkloadValidationArtifact(
  context: WorkloadValidationArtifactContext = {},
): SuperAppWorkloadValidationArtifact {
  const resolvedContext = resolveContext(context);
  const artifactWithoutFingerprint = {
    artifactVersion: ARTIFACT_VERSION,
    artifactSeed: ARTIFACT_SEED,
    sourceVersions: {
      catalogVersion: resolvedContext.workloadCatalog.catalogVersion,
      generatedVersion: resolvedContext.workloadData.datasetVersion,
      scenarioProfileVersion:
        resolvedContext.workloadScenarioProfileMetadata.profileVersion,
      resetVersion: resolvedContext.workloadResetSeedMetadata.resetVersion,
    },
    sourceSeeds: {
      catalogSeed: resolvedContext.workloadCatalog.seed,
      generatedSeed: resolvedContext.workloadData.seed,
      scenarioProfileSeed: resolvedContext.workloadScenarioProfileMetadata.seed,
      resetSeed: resolvedContext.workloadResetSeedMetadata.resetSeed,
    },
    dataset: createDatasetSummary(resolvedContext),
    tenantCoverage: createTenantCoverage(resolvedContext),
    domainCoverage: createDomainCoverage(resolvedContext),
    scenarioCoverage: createScenarioCoverage(resolvedContext),
    profileCoverage: createProfileCoverage(resolvedContext),
    consumerTargetCoverage: createConsumerTargetCoverage(resolvedContext),
    resetIntegrity: createResetIntegrity(resolvedContext),
    sampleWindows: createSampleWindowSummary(resolvedContext),
    compactness: createCompactness(),
  };

  return clone({
    ...artifactWithoutFingerprint,
    fingerprint: fingerprintFor(artifactWithoutFingerprint),
  });
}
