// @effect-diagnostics strictBooleanExpressions:off
import {
  createSuperAppWorkloadCatalog,
  type SuperAppWorkloadCatalog,
  type WorkloadScenarioId,
  type WorkloadTenantId,
} from './workload-domain-catalog.js';
import {
  createSuperAppGeneratedWorkloadContract,
  type GeneratedWorkloadHelperIds,
  type GeneratedWorkloadSampleWindow,
  type SuperAppGeneratedWorkloadContract,
} from './workload-generated-data.js';
import {
  createSuperAppWorkloadScenarioProfileMetadata,
  getWorkloadScenarioProfile,
  type SuperAppWorkloadScenarioProfileMetadata,
  selectWorkloadScenarioSampleRecords,
  selectWorkloadScenarioSampleWindows,
  type WorkloadScenarioProfileId,
} from './workload-scenario-profiles.js';

export type WorkloadResetSeedTarget =
  | 'stress'
  | 'chaos'
  | 'browser'
  | 'contract';

export type WorkloadResetSeedInput = {
  target?: WorkloadResetSeedTarget;
  scenarioId?: WorkloadScenarioId;
  profileId?: WorkloadScenarioProfileId;
  tenantId?: WorkloadTenantId;
};

export type WorkloadSeedDescriptor = {
  seedVersion: 'superapp-workload-reset-seed-v1';
  seed: string;
  target: WorkloadResetSeedTarget;
  scenarioId: WorkloadScenarioId;
  profileId: WorkloadScenarioProfileId;
  tenantId: WorkloadTenantId;
  catalogSeed: SuperAppWorkloadCatalog['seed'];
  generatedSeed: SuperAppGeneratedWorkloadContract['seed'];
  scenarioProfileSeed: SuperAppWorkloadScenarioProfileMetadata['seed'];
  clockStartIso: SuperAppGeneratedWorkloadContract['clockStartIso'];
  requestIdPrefix: string;
  idempotencyKeyPrefix: string;
  fingerprint: string;
  sampleWindowIds: string[];
  sampleRecordIds: string[];
  selectedSampleWindows: GeneratedWorkloadSampleWindow[];
  metadata: {
    totalRecords: number;
    profileCount: number;
    sampleWindowCount: number;
    selectedSampleWindowCount: number;
    selectedSampleRecordCount: number;
  };
};

export type SuperAppWorkloadResetSeedMetadata = {
  resetVersion: 'superapp-workload-reset-seed-v1';
  resetSeed: 'superapp-portfolio-reset-seed-v1';
  catalogVersion: SuperAppWorkloadCatalog['catalogVersion'];
  catalogSeed: SuperAppWorkloadCatalog['seed'];
  generatedVersion: SuperAppGeneratedWorkloadContract['datasetVersion'];
  generatedSeed: SuperAppGeneratedWorkloadContract['seed'];
  scenarioProfileVersion: SuperAppWorkloadScenarioProfileMetadata['profileVersion'];
  scenarioProfileSeed: SuperAppWorkloadScenarioProfileMetadata['seed'];
  clockStartIso: SuperAppGeneratedWorkloadContract['clockStartIso'];
  clockStepMs: SuperAppGeneratedWorkloadContract['clockStepMs'];
  eventIdPrefix: 'evt';
  pilotRunIdPrefix: 'pilot';
  initialEventCounter: 0;
  initialPilotRunCounter: 0;
  helperIds: GeneratedWorkloadHelperIds;
  sampleWindows: GeneratedWorkloadSampleWindow[];
  defaultSeeds: Record<WorkloadResetSeedTarget, WorkloadSeedDescriptor>;
};

type WorkloadResetSeedContext = {
  workloadCatalog?: SuperAppWorkloadCatalog;
  workloadData?: SuperAppGeneratedWorkloadContract;
  workloadScenarioProfileMetadata?: SuperAppWorkloadScenarioProfileMetadata;
};

type RequiredSeedInput = Required<WorkloadResetSeedInput>;

const RESET_SEED_VERSION = 'superapp-workload-reset-seed-v1' as const;
const RESET_SEED = 'superapp-portfolio-reset-seed-v1' as const;

const DEFAULT_SEED_INPUTS: Record<WorkloadResetSeedTarget, RequiredSeedInput> =
  {
    stress: {
      target: 'stress',
      scenarioId: 'marketplace-surge-to-ledger',
      profileId: 'read-heavy-command-center',
      tenantId: 'city-ops-eu',
    },
    chaos: {
      target: 'chaos',
      scenarioId: 'fleet-incident-refund',
      profileId: 'write-heavy-order-ledger',
      tenantId: 'city-ops-eu',
    },
    browser: {
      target: 'browser',
      scenarioId: 'marketplace-surge-to-ledger',
      profileId: 'mixed-cross-app-journey',
      tenantId: 'city-ops-eu',
    },
    contract: {
      target: 'contract',
      scenarioId: 'tenant-boundary-audit',
      profileId: 'tenant-boundary-probes',
      tenantId: 'security-root',
    },
  };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveContext(context: WorkloadResetSeedContext = {}) {
  const workloadCatalog =
    context.workloadCatalog ?? createSuperAppWorkloadCatalog();
  const workloadData =
    context.workloadData ??
    createSuperAppGeneratedWorkloadContract(workloadCatalog);
  const workloadScenarioProfileMetadata =
    context.workloadScenarioProfileMetadata ??
    createSuperAppWorkloadScenarioProfileMetadata();

  return {
    workloadCatalog,
    workloadData,
    workloadScenarioProfileMetadata,
  };
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

function assertKnownSeedInput(
  input: RequiredSeedInput,
  context: WorkloadResetSeedContext,
) {
  const { workloadCatalog } = resolveContext(context);

  if (!workloadCatalog.scenarios.some(item => item.id === input.scenarioId)) {
    throw new Error(`Unknown workload seed scenario: ${input.scenarioId}`);
  }

  if (!workloadCatalog.tenants.some(item => item.id === input.tenantId)) {
    throw new Error(`Unknown workload seed tenant: ${input.tenantId}`);
  }

  const profile = getWorkloadScenarioProfile(input.profileId);
  if (!profile) {
    throw new Error(`Unknown workload seed profile: ${input.profileId}`);
  }
}

function resolveSeedInput(
  input: WorkloadResetSeedInput = {},
): RequiredSeedInput {
  const target = input.target ?? 'contract';
  const defaults = DEFAULT_SEED_INPUTS[target];

  return {
    target,
    scenarioId: input.scenarioId ?? defaults.scenarioId,
    profileId: input.profileId ?? defaults.profileId,
    tenantId: input.tenantId ?? defaults.tenantId,
  };
}

export function createSuperAppWorkloadSeed(
  input: WorkloadResetSeedInput = {},
  context: WorkloadResetSeedContext = {},
): WorkloadSeedDescriptor {
  const resolvedInput = resolveSeedInput(input);
  const { workloadCatalog, workloadData, workloadScenarioProfileMetadata } =
    resolveContext(context);

  assertKnownSeedInput(resolvedInput, {
    workloadCatalog,
    workloadData,
    workloadScenarioProfileMetadata,
  });

  const profile = getWorkloadScenarioProfile(resolvedInput.profileId);
  if (!profile) {
    throw new Error(
      `Unknown workload seed profile: ${resolvedInput.profileId}`,
    );
  }

  const selectedSampleWindows = selectWorkloadScenarioSampleWindows(
    profile,
    workloadData,
  );
  const selectedRecords = selectWorkloadScenarioSampleRecords(
    profile,
    workloadData,
  );
  const sampleWindowIds = selectedSampleWindows.map(window => window.id);
  const sampleRecordIds = selectedRecords.flatMap(item =>
    item.records.map(record => record.id),
  );
  const fingerprint = fingerprintFor({
    ...resolvedInput,
    catalogSeed: workloadCatalog.seed,
    generatedSeed: workloadData.seed,
    scenarioProfileSeed: workloadScenarioProfileMetadata.seed,
    sampleWindowIds,
    sampleRecordIds,
  });
  const prefixParts = [
    workloadCatalog.requestIdPrefix,
    resolvedInput.target,
    resolvedInput.scenarioId,
    resolvedInput.profileId,
    resolvedInput.tenantId,
  ];
  const requestIdPrefix = prefixParts.join(':');

  return clone({
    seedVersion: RESET_SEED_VERSION,
    seed: `${RESET_SEED}:${fingerprint}`,
    target: resolvedInput.target,
    scenarioId: resolvedInput.scenarioId,
    profileId: resolvedInput.profileId,
    tenantId: resolvedInput.tenantId,
    catalogSeed: workloadCatalog.seed,
    generatedSeed: workloadData.seed,
    scenarioProfileSeed: workloadScenarioProfileMetadata.seed,
    clockStartIso: workloadData.clockStartIso,
    requestIdPrefix,
    idempotencyKeyPrefix: `${requestIdPrefix}:idem`,
    fingerprint,
    sampleWindowIds,
    sampleRecordIds,
    selectedSampleWindows,
    metadata: {
      totalRecords: workloadData.metadata.totalRecords,
      profileCount: workloadScenarioProfileMetadata.helperMetadata.profileCount,
      sampleWindowCount: workloadData.metadata.sampleWindows.length,
      selectedSampleWindowCount: selectedSampleWindows.length,
      selectedSampleRecordCount: sampleRecordIds.length,
    },
  });
}

export function createSuperAppWorkloadResetSeedMetadata(
  context: WorkloadResetSeedContext = {},
): SuperAppWorkloadResetSeedMetadata {
  const { workloadCatalog, workloadData, workloadScenarioProfileMetadata } =
    resolveContext(context);
  const resolvedContext = {
    workloadCatalog,
    workloadData,
    workloadScenarioProfileMetadata,
  };

  return clone({
    resetVersion: RESET_SEED_VERSION,
    resetSeed: RESET_SEED,
    catalogVersion: workloadCatalog.catalogVersion,
    catalogSeed: workloadCatalog.seed,
    generatedVersion: workloadData.datasetVersion,
    generatedSeed: workloadData.seed,
    scenarioProfileVersion: workloadScenarioProfileMetadata.profileVersion,
    scenarioProfileSeed: workloadScenarioProfileMetadata.seed,
    clockStartIso: workloadData.clockStartIso,
    clockStepMs: workloadData.clockStepMs,
    eventIdPrefix: 'evt',
    pilotRunIdPrefix: 'pilot',
    initialEventCounter: 0,
    initialPilotRunCounter: 0,
    helperIds: workloadData.helperIds,
    sampleWindows: workloadData.metadata.sampleWindows,
    defaultSeeds: {
      stress: createSuperAppWorkloadSeed({ target: 'stress' }, resolvedContext),
      chaos: createSuperAppWorkloadSeed({ target: 'chaos' }, resolvedContext),
      browser: createSuperAppWorkloadSeed(
        { target: 'browser' },
        resolvedContext,
      ),
      contract: createSuperAppWorkloadSeed(
        { target: 'contract' },
        resolvedContext,
      ),
    },
  });
}
