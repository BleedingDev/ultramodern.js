// @effect-diagnostics strictBooleanExpressions:off
import {
  createSuperAppWorkloadCatalog,
  type SuperAppWorkloadCatalog,
  type WorkloadDomainId,
  type WorkloadPilotModuleId,
  type WorkloadScenarioId,
  type WorkloadTenantId,
  type WorkloadUserId,
} from './workload-domain-catalog.js';
import {
  createSuperAppWorkloadResetSeedMetadata,
  type WorkloadResetSeedTarget,
} from './workload-reset-seed.js';
import {
  createSuperAppWorkloadScenarioProfileMetadata,
  getWorkloadScenarioProfile,
  type WorkloadScenarioConsumerTarget,
  type WorkloadScenarioProfileId,
} from './workload-scenario-profiles.js';

export type WorkloadChaosFailureId =
  | 'chaos.downstream-timeout.v1'
  | 'chaos.partial-module-error.v1'
  | 'chaos.stale-remote-manifest.v1'
  | 'chaos.down-remote.v1'
  | 'chaos.malformed-json.v1'
  | 'chaos.auth-expiry.v1'
  | 'chaos.tenant-violation.v1'
  | 'chaos.retry-storm.v1'
  | 'chaos.slow-stream.v1'
  | 'chaos.duplicate-request.v1';

export type WorkloadChaosFailureKind =
  | 'downstream-timeout'
  | 'partial-module-error'
  | 'stale-remote-manifest'
  | 'down-remote'
  | 'malformed-json'
  | 'auth-expiry'
  | 'tenant-violation'
  | 'retry-storm'
  | 'slow-stream'
  | 'duplicate-request';

export type WorkloadChaosFailureSeverity =
  | 'recoverable'
  | 'degraded'
  | 'blocked'
  | 'security';

export type WorkloadChaosFailureErrorCode =
  | 'DOWNSTREAM_TIMEOUT'
  | 'PARTIAL_MODULE_ERROR'
  | 'STALE_REMOTE_MANIFEST'
  | 'REMOTE_UNAVAILABLE'
  | 'MALFORMED_JSON'
  | 'AUTH_EXPIRED'
  | 'TENANT_VIOLATION'
  | 'RETRY_STORM'
  | 'SLOW_STREAM'
  | 'DUPLICATE_REQUEST_DEDUPED';

export type WorkloadChaosExpectedStatus = {
  httpStatus: number;
  responseKind:
    | 'error-envelope'
    | 'partial-error-envelope'
    | 'security-error-envelope'
    | 'deduped-success';
  applicationStatus:
    | 'failed'
    | 'degraded'
    | 'rejected'
    | 'throttled'
    | 'deduped';
  retryable: boolean;
  retryAfterMs?: number;
};

export type WorkloadChaosExpectedErrorEnvelope = {
  present: boolean;
  code: WorkloadChaosFailureErrorCode;
  messageKey: string;
  requiredFields: string[];
  optionalFields: string[];
  forbiddenFields: string[];
};

export type WorkloadChaosResetExpectation = {
  required: boolean;
  seedTarget: WorkloadResetSeedTarget;
  resetEndpoint: 'portfolio.reset';
  restoresFailureMode: 'healthy';
  verifiesHealthyFollowUp: true;
  verifiesNoSharedStatePoisoning: true;
  expectedPostResetStatus: 200;
};

export type WorkloadChaosTenantSafety = {
  tenantScoped: true;
  requiresTenantHeader: true;
  crossTenantReadsAllowed: false;
  crossTenantMutationsAllowed: false;
  preservesHealthyTenantTraffic: true;
  expectedTenantViolation: boolean;
  sourceTenantId: WorkloadTenantId;
  targetTenantId: WorkloadTenantId;
};

export type WorkloadChaosTelemetryRedactionExpectation = {
  required: true;
  allowedAttributes: string[];
  redactedAttributes: string[];
  forbiddenRawSubstrings: string[];
};

export type WorkloadChaosDeterministicInput = {
  requestId: string;
  idempotencyKey: string;
  payloadSeed: string;
  attemptCount: number;
  clockOffsetMs: number;
};

export type WorkloadChaosFailureCase = {
  id: WorkloadChaosFailureId;
  kind: WorkloadChaosFailureKind;
  label: string;
  description: string;
  severity: WorkloadChaosFailureSeverity;
  scenarioId: WorkloadScenarioId;
  profileId: WorkloadScenarioProfileId;
  tenantId: WorkloadTenantId;
  personaId: WorkloadUserId;
  domainIds: WorkloadDomainId[];
  moduleIds: WorkloadPilotModuleId[];
  route: string;
  operationHint: string;
  sampleWindowIds: string[];
  expectedStatus: WorkloadChaosExpectedStatus;
  expectedErrorEnvelope: WorkloadChaosExpectedErrorEnvelope;
  resetExpectation: WorkloadChaosResetExpectation;
  tenantSafety: WorkloadChaosTenantSafety;
  telemetryRedaction: WorkloadChaosTelemetryRedactionExpectation;
  consumerTargetHints: WorkloadScenarioConsumerTarget[];
  deterministicInput: WorkloadChaosDeterministicInput;
};

export type WorkloadChaosFailureTaxonomy = {
  taxonomyVersion: 'superapp-workload-chaos-failure-taxonomy-v1';
  seed: 'superapp-portfolio-chaos-failure-taxonomy-v1';
  fingerprint: string;
  failureIds: WorkloadChaosFailureId[];
  resetSeed: {
    target: WorkloadResetSeedTarget;
    scenarioId: WorkloadScenarioId;
    profileId: WorkloadScenarioProfileId;
    tenantId: WorkloadTenantId;
    requestIdPrefix: string;
  };
  consumerTargetCoverage: Record<
    WorkloadScenarioConsumerTarget,
    WorkloadChaosFailureId[]
  >;
  failures: WorkloadChaosFailureCase[];
};

type WorkloadChaosFailureDefinition = Omit<
  WorkloadChaosFailureCase,
  'sampleWindowIds' | 'deterministicInput'
>;

type WorkloadChaosFailureTaxonomyContext = {
  workloadCatalog?: SuperAppWorkloadCatalog;
};

const TAXONOMY_VERSION = 'superapp-workload-chaos-failure-taxonomy-v1' as const;
const TAXONOMY_SEED = 'superapp-portfolio-chaos-failure-taxonomy-v1' as const;
const RESET_SEED_TARGET = 'chaos' as const;

export const SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS: WorkloadChaosFailureId[] = [
  'chaos.downstream-timeout.v1',
  'chaos.partial-module-error.v1',
  'chaos.stale-remote-manifest.v1',
  'chaos.down-remote.v1',
  'chaos.malformed-json.v1',
  'chaos.auth-expiry.v1',
  'chaos.tenant-violation.v1',
  'chaos.retry-storm.v1',
  'chaos.slow-stream.v1',
  'chaos.duplicate-request.v1',
];

const ALL_CONSUMER_TARGETS: WorkloadScenarioConsumerTarget[] = [
  'k6',
  'load',
  'chaos',
  'browser',
  'contract',
];

const COMMON_REQUIRED_ERROR_FIELDS = [
  'error.code',
  'error.message',
  'error.requestId',
  'error.failureId',
  'error.tenantId',
  'error.retryable',
  'error.resetRequired',
];

const COMMON_FORBIDDEN_ERROR_FIELDS = [
  'error.stack',
  'error.rawPayload',
  'error.authorization',
  'error.cookie',
  'error.csrfToken',
  'error.crossTenantRecordIds',
];

const COMMON_ALLOWED_TELEMETRY_ATTRIBUTES = [
  'failure.id',
  'failure.kind',
  'failure.code',
  'request.id',
  'tenant.id',
  'scenario.id',
  'profile.id',
  'domain.id',
  'module.id',
];

const COMMON_REDACTED_TELEMETRY_ATTRIBUTES = [
  'authorization',
  'cookie',
  'csrfToken',
  'accessToken',
  'refreshToken',
  'rawPayload',
];

const COMMON_FORBIDDEN_RAW_SUBSTRINGS = [
  'Bearer ',
  'superapp-valid-csrf',
  'amountCents',
  'rawPayload',
];

function expectedStatus(
  input: WorkloadChaosExpectedStatus,
): WorkloadChaosExpectedStatus {
  return input;
}

function expectedErrorEnvelope(input: {
  present?: boolean;
  code: WorkloadChaosFailureErrorCode;
  messageKey: string;
  optionalFields?: string[];
  forbiddenFields?: string[];
}): WorkloadChaosExpectedErrorEnvelope {
  return {
    present: input.present ?? true,
    code: input.code,
    messageKey: input.messageKey,
    requiredFields: COMMON_REQUIRED_ERROR_FIELDS,
    optionalFields: input.optionalFields ?? [],
    forbiddenFields: [
      ...COMMON_FORBIDDEN_ERROR_FIELDS,
      ...(input.forbiddenFields ?? []),
    ],
  };
}

function resetExpectation(required: boolean): WorkloadChaosResetExpectation {
  return {
    required,
    seedTarget: RESET_SEED_TARGET,
    resetEndpoint: 'portfolio.reset',
    restoresFailureMode: 'healthy',
    verifiesHealthyFollowUp: true,
    verifiesNoSharedStatePoisoning: true,
    expectedPostResetStatus: 200,
  };
}

function tenantSafety(input: {
  expectedTenantViolation?: boolean;
  sourceTenantId: WorkloadTenantId;
  targetTenantId?: WorkloadTenantId;
}): WorkloadChaosTenantSafety {
  return {
    tenantScoped: true,
    requiresTenantHeader: true,
    crossTenantReadsAllowed: false,
    crossTenantMutationsAllowed: false,
    preservesHealthyTenantTraffic: true,
    expectedTenantViolation: input.expectedTenantViolation ?? false,
    sourceTenantId: input.sourceTenantId,
    targetTenantId: input.targetTenantId ?? input.sourceTenantId,
  };
}

function telemetryRedaction(
  extraForbiddenRawSubstrings: string[] = [],
): WorkloadChaosTelemetryRedactionExpectation {
  return {
    required: true,
    allowedAttributes: COMMON_ALLOWED_TELEMETRY_ATTRIBUTES,
    redactedAttributes: COMMON_REDACTED_TELEMETRY_ATTRIBUTES,
    forbiddenRawSubstrings: [
      ...COMMON_FORBIDDEN_RAW_SUBSTRINGS,
      ...extraForbiddenRawSubstrings,
    ],
  };
}

const FAILURE_DEFINITIONS: WorkloadChaosFailureDefinition[] = [
  {
    id: 'chaos.downstream-timeout.v1',
    kind: 'downstream-timeout',
    label: 'Downstream Timeout',
    description:
      'ERP refund approval exceeds the chaos budget and must return a timeout envelope without mutating later healthy requests.',
    severity: 'blocked',
    scenarioId: 'fleet-incident-refund',
    profileId: 'write-heavy-order-ledger',
    tenantId: 'city-ops-eu',
    personaId: 'finance.approver',
    domainIds: ['erp-finance'],
    moduleIds: ['erp'],
    route: '/mega-erp/procurement',
    operationHint: 'incident-refund-approval',
    expectedStatus: expectedStatus({
      httpStatus: 504,
      responseKind: 'error-envelope',
      applicationStatus: 'failed',
      retryable: true,
      retryAfterMs: 1000,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      code: 'DOWNSTREAM_TIMEOUT',
      messageKey: 'superapp.chaos.downstreamTimeout',
      optionalFields: ['error.timeoutMs', 'error.downstreamService'],
    }),
    resetExpectation: resetExpectation(true),
    tenantSafety: tenantSafety({ sourceTenantId: 'city-ops-eu' }),
    telemetryRedaction: telemetryRedaction(),
    consumerTargetHints: ['chaos', 'contract', 'load'],
  },
  {
    id: 'chaos.partial-module-error.v1',
    kind: 'partial-module-error',
    label: 'Partial Module Error',
    description:
      'One pilot module fails while sibling modules return classified degraded results and shared request lineage remains intact.',
    severity: 'degraded',
    scenarioId: 'marketplace-surge-to-ledger',
    profileId: 'mixed-cross-app-journey',
    tenantId: 'superapp-global',
    personaId: 'ops.commander',
    domainIds: ['marketplace-orders', 'erp-finance', 'chat-threads'],
    moduleIds: ['orders', 'erp', 'chat'],
    route: '/mobility',
    operationHint: 'surge-order',
    expectedStatus: expectedStatus({
      httpStatus: 207,
      responseKind: 'partial-error-envelope',
      applicationStatus: 'degraded',
      retryable: true,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      code: 'PARTIAL_MODULE_ERROR',
      messageKey: 'superapp.chaos.partialModuleError',
      optionalFields: ['error.moduleId', 'error.degradedModuleIds'],
    }),
    resetExpectation: resetExpectation(true),
    tenantSafety: tenantSafety({ sourceTenantId: 'superapp-global' }),
    telemetryRedaction: telemetryRedaction(),
    consumerTargetHints: ['chaos', 'browser', 'contract'],
  },
  {
    id: 'chaos.stale-remote-manifest.v1',
    kind: 'stale-remote-manifest',
    label: 'Stale Remote Manifest',
    description:
      'Manifest rotation serves an older remote version and must fail with a deterministic conflict before loading a stale chunk.',
    severity: 'recoverable',
    scenarioId: 'erp-close-admin-rotation',
    profileId: 'search-filter-sort-ledger',
    tenantId: 'platform-shell',
    personaId: 'platform.operator',
    domainIds: ['admin-operations', 'erp-finance'],
    moduleIds: ['mf-remotes'],
    route: '/failure-lab/remotes',
    operationHint: 'close-manifest-rotate',
    expectedStatus: expectedStatus({
      httpStatus: 409,
      responseKind: 'error-envelope',
      applicationStatus: 'failed',
      retryable: false,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      code: 'STALE_REMOTE_MANIFEST',
      messageKey: 'superapp.chaos.staleRemoteManifest',
      optionalFields: ['error.manifestVersion', 'error.expectedVersion'],
    }),
    resetExpectation: resetExpectation(true),
    tenantSafety: tenantSafety({ sourceTenantId: 'platform-shell' }),
    telemetryRedaction: telemetryRedaction(['manifest.token']),
    consumerTargetHints: ['chaos', 'browser', 'contract'],
  },
  {
    id: 'chaos.down-remote.v1',
    kind: 'down-remote',
    label: 'Down Remote',
    description:
      'Module Federation remote lookup is unavailable and must route to fallback without poisoning the next healthy remote load.',
    severity: 'degraded',
    scenarioId: 'erp-close-admin-rotation',
    profileId: 'mixed-cross-app-journey',
    tenantId: 'platform-shell',
    personaId: 'platform.operator',
    domainIds: ['admin-operations', 'erp-finance'],
    moduleIds: ['mf-remotes'],
    route: '/failure-lab/remotes',
    operationHint: 'admin-rotate-remote-manifest',
    expectedStatus: expectedStatus({
      httpStatus: 503,
      responseKind: 'error-envelope',
      applicationStatus: 'degraded',
      retryable: true,
      retryAfterMs: 1500,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      code: 'REMOTE_UNAVAILABLE',
      messageKey: 'superapp.chaos.remoteUnavailable',
      optionalFields: ['error.remoteId', 'error.fallbackRoute'],
    }),
    resetExpectation: resetExpectation(true),
    tenantSafety: tenantSafety({ sourceTenantId: 'platform-shell' }),
    telemetryRedaction: telemetryRedaction(),
    consumerTargetHints: ['chaos', 'browser', 'load'],
  },
  {
    id: 'chaos.malformed-json.v1',
    kind: 'malformed-json',
    label: 'Malformed JSON',
    description:
      'A request body parse failure must return a validation envelope before domain handlers or tenant mutations run.',
    severity: 'recoverable',
    scenarioId: 'marketplace-surge-to-ledger',
    profileId: 'write-heavy-order-ledger',
    tenantId: 'city-ops-eu',
    personaId: 'marketplace.manager',
    domainIds: ['marketplace-orders'],
    moduleIds: ['orders'],
    route: '/mobility',
    operationHint: 'surge-order',
    expectedStatus: expectedStatus({
      httpStatus: 400,
      responseKind: 'error-envelope',
      applicationStatus: 'rejected',
      retryable: false,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      code: 'MALFORMED_JSON',
      messageKey: 'superapp.chaos.malformedJson',
      optionalFields: ['error.parseOffset'],
      forbiddenFields: ['error.body'],
    }),
    resetExpectation: resetExpectation(false),
    tenantSafety: tenantSafety({ sourceTenantId: 'city-ops-eu' }),
    telemetryRedaction: telemetryRedaction(['{"tenant"']),
    consumerTargetHints: ['chaos', 'contract'],
  },
  {
    id: 'chaos.auth-expiry.v1',
    kind: 'auth-expiry',
    label: 'Auth Expiry',
    description:
      'Expired bearer material must be rejected as authentication failure while preserving redacted audit telemetry.',
    severity: 'security',
    scenarioId: 'tenant-boundary-audit',
    profileId: 'tenant-boundary-probes',
    tenantId: 'security-root',
    personaId: 'security.admin',
    domainIds: ['users-roles', 'audit-events'],
    moduleIds: ['security'],
    route: '/security/roles',
    operationHint: 'boundary-policy-evaluate',
    expectedStatus: expectedStatus({
      httpStatus: 401,
      responseKind: 'security-error-envelope',
      applicationStatus: 'rejected',
      retryable: true,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      code: 'AUTH_EXPIRED',
      messageKey: 'superapp.chaos.authExpiry',
      optionalFields: ['error.authScheme', 'error.refreshRequired'],
      forbiddenFields: ['error.token'],
    }),
    resetExpectation: resetExpectation(false),
    tenantSafety: tenantSafety({ sourceTenantId: 'security-root' }),
    telemetryRedaction: telemetryRedaction(['expired.jwt']),
    consumerTargetHints: ['chaos', 'contract'],
  },
  {
    id: 'chaos.tenant-violation.v1',
    kind: 'tenant-violation',
    label: 'Tenant Violation',
    description:
      'Cross-tenant access attempts must fail closed, report failed controls, and avoid reads or writes against the target tenant.',
    severity: 'security',
    scenarioId: 'tenant-boundary-audit',
    profileId: 'tenant-boundary-probes',
    tenantId: 'acme-global',
    personaId: 'finance.approver',
    domainIds: ['users-roles', 'admin-operations'],
    moduleIds: ['security', 'mf-remotes'],
    route: '/security/roles',
    operationHint: 'acme-to-platform-denied',
    expectedStatus: expectedStatus({
      httpStatus: 403,
      responseKind: 'security-error-envelope',
      applicationStatus: 'rejected',
      retryable: false,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      code: 'TENANT_VIOLATION',
      messageKey: 'superapp.chaos.tenantViolation',
      optionalFields: ['error.failedCheckIds', 'error.targetTenantId'],
      forbiddenFields: ['error.targetTenantRecords'],
    }),
    resetExpectation: resetExpectation(false),
    tenantSafety: tenantSafety({
      expectedTenantViolation: true,
      sourceTenantId: 'acme-global',
      targetTenantId: 'platform-shell',
    }),
    telemetryRedaction: telemetryRedaction(['res-cha-']),
    consumerTargetHints: ['chaos', 'browser', 'contract'],
  },
  {
    id: 'chaos.retry-storm.v1',
    kind: 'retry-storm',
    label: 'Retry Storm',
    description:
      'Repeated idempotent dispatch retries must throttle deterministically and keep dedupe keys tenant-scoped.',
    severity: 'blocked',
    scenarioId: 'fleet-incident-refund',
    profileId: 'write-heavy-order-ledger',
    tenantId: 'city-ops-eu',
    personaId: 'dispatch.lead',
    domainIds: ['dispatch-mobility', 'audit-events'],
    moduleIds: ['dispatch', 'security'],
    route: '/mobility/dispatch',
    operationHint: 'incident-dispatch-retry',
    expectedStatus: expectedStatus({
      httpStatus: 429,
      responseKind: 'error-envelope',
      applicationStatus: 'throttled',
      retryable: true,
      retryAfterMs: 2500,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      code: 'RETRY_STORM',
      messageKey: 'superapp.chaos.retryStorm',
      optionalFields: ['error.retryAfterMs', 'error.attemptCount'],
    }),
    resetExpectation: resetExpectation(true),
    tenantSafety: tenantSafety({ sourceTenantId: 'city-ops-eu' }),
    telemetryRedaction: telemetryRedaction(),
    consumerTargetHints: ['k6', 'load', 'chaos', 'contract'],
  },
  {
    id: 'chaos.slow-stream.v1',
    kind: 'slow-stream',
    label: 'Slow Stream',
    description:
      'Chat stream stalls after headers and must close with a timeout envelope while finalizers release stream state.',
    severity: 'degraded',
    scenarioId: 'fleet-incident-refund',
    profileId: 'chat-pagination-history',
    tenantId: 'platform-shell',
    personaId: 'support.lead',
    domainIds: ['chat-threads', 'audit-events'],
    moduleIds: ['chat'],
    route: '/mobility/support',
    operationHint: 'incident-support-thread',
    expectedStatus: expectedStatus({
      httpStatus: 504,
      responseKind: 'error-envelope',
      applicationStatus: 'failed',
      retryable: true,
      retryAfterMs: 1000,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      code: 'SLOW_STREAM',
      messageKey: 'superapp.chaos.slowStream',
      optionalFields: ['error.streamId', 'error.bytesSent'],
    }),
    resetExpectation: resetExpectation(true),
    tenantSafety: tenantSafety({ sourceTenantId: 'platform-shell' }),
    telemetryRedaction: telemetryRedaction(['msg-psh-']),
    consumerTargetHints: ['chaos', 'browser', 'contract'],
  },
  {
    id: 'chaos.duplicate-request.v1',
    kind: 'duplicate-request',
    label: 'Duplicate Request',
    description:
      'A repeated idempotency key must return the existing accepted result as deduped without creating another event.',
    severity: 'recoverable',
    scenarioId: 'marketplace-surge-to-ledger',
    profileId: 'write-heavy-order-ledger',
    tenantId: 'city-ops-eu',
    personaId: 'marketplace.manager',
    domainIds: ['marketplace-orders', 'audit-events'],
    moduleIds: ['orders'],
    route: '/mobility',
    operationHint: 'surge-order',
    expectedStatus: expectedStatus({
      httpStatus: 200,
      responseKind: 'deduped-success',
      applicationStatus: 'deduped',
      retryable: false,
    }),
    expectedErrorEnvelope: expectedErrorEnvelope({
      present: false,
      code: 'DUPLICATE_REQUEST_DEDUPED',
      messageKey: 'superapp.chaos.duplicateRequestDeduped',
      optionalFields: ['event.status', 'event.requestId'],
    }),
    resetExpectation: resetExpectation(false),
    tenantSafety: tenantSafety({ sourceTenantId: 'city-ops-eu' }),
    telemetryRedaction: telemetryRedaction(),
    consumerTargetHints: ['k6', 'load', 'chaos', 'contract'],
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function assertUniqueIds(definitions: WorkloadChaosFailureDefinition[]) {
  const ids = definitions.map(item => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Duplicate workload chaos failure ids are not allowed');
  }

  if (ids.join('|') !== SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS.join('|')) {
    throw new Error('Workload chaos failure id order changed unexpectedly');
  }
}

function assertKnownReferences(
  definition: WorkloadChaosFailureDefinition,
  catalog: SuperAppWorkloadCatalog,
) {
  const scenario = catalog.scenarios.find(
    item => item.id === definition.scenarioId,
  );
  if (!scenario) {
    throw new Error(`Unknown chaos scenario id: ${definition.scenarioId}`);
  }

  if (!catalog.tenants.some(item => item.id === definition.tenantId)) {
    throw new Error(`Unknown chaos tenant id: ${definition.tenantId}`);
  }

  const profile = getWorkloadScenarioProfile(definition.profileId);
  if (!profile) {
    throw new Error(`Unknown chaos profile id: ${definition.profileId}`);
  }

  for (const domainId of definition.domainIds) {
    if (!catalog.domains.some(item => item.id === domainId)) {
      throw new Error(`Unknown chaos domain id: ${domainId}`);
    }
  }

  for (const moduleId of definition.moduleIds) {
    if (!scenario.modules.includes(moduleId)) {
      throw new Error(
        `Chaos module ${moduleId} is not part of scenario ${scenario.id}`,
      );
    }
  }

  for (const target of definition.consumerTargetHints) {
    if (!ALL_CONSUMER_TARGETS.includes(target)) {
      throw new Error(`Unknown chaos consumer target: ${target}`);
    }
  }

  return profile.sampleWindowIds;
}

function deterministicInputFor(
  definition: WorkloadChaosFailureDefinition,
  index: number,
  requestIdPrefix: string,
  idempotencyKeyPrefix: string,
): WorkloadChaosDeterministicInput {
  const ordinal = String(index + 1).padStart(2, '0');
  const suffix = definition.kind.replaceAll('-', ':');
  const attemptCount = definition.kind === 'retry-storm' ? 8 : 1;

  return {
    requestId: `${requestIdPrefix}:failure:${ordinal}:${suffix}`,
    idempotencyKey: `${idempotencyKeyPrefix}:failure:${ordinal}:${suffix}`,
    payloadSeed: `${TAXONOMY_SEED}:${definition.id}`,
    attemptCount,
    clockOffsetMs: index * 17000,
  };
}

function consumerTargetCoverage(
  failures: WorkloadChaosFailureCase[],
): Record<WorkloadScenarioConsumerTarget, WorkloadChaosFailureId[]> {
  return Object.fromEntries(
    ALL_CONSUMER_TARGETS.map(target => [
      target,
      failures
        .filter(failure => failure.consumerTargetHints.includes(target))
        .map(failure => failure.id),
    ]),
  ) as Record<WorkloadScenarioConsumerTarget, WorkloadChaosFailureId[]>;
}

export function createSuperAppWorkloadChaosFailureTaxonomy(
  context: WorkloadChaosFailureTaxonomyContext = {},
): WorkloadChaosFailureTaxonomy {
  const workloadCatalog =
    context.workloadCatalog ?? createSuperAppWorkloadCatalog();
  const profileMetadata = createSuperAppWorkloadScenarioProfileMetadata();
  const resetSeed =
    createSuperAppWorkloadResetSeedMetadata().defaultSeeds[RESET_SEED_TARGET];

  assertUniqueIds(FAILURE_DEFINITIONS);

  const failures = FAILURE_DEFINITIONS.map((definition, index) => {
    const sampleWindowIds = assertKnownReferences(definition, workloadCatalog);
    if (!profileMetadata.profileIds.includes(definition.profileId)) {
      throw new Error(
        `Unknown chaos profile metadata id: ${definition.profileId}`,
      );
    }

    return {
      ...definition,
      sampleWindowIds,
      deterministicInput: deterministicInputFor(
        definition,
        index,
        resetSeed.requestIdPrefix,
        resetSeed.idempotencyKeyPrefix,
      ),
    };
  });

  const taxonomyWithoutFingerprint = {
    taxonomyVersion: TAXONOMY_VERSION,
    seed: TAXONOMY_SEED,
    failureIds: SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS,
    resetSeed: {
      target: resetSeed.target,
      scenarioId: resetSeed.scenarioId,
      profileId: resetSeed.profileId,
      tenantId: resetSeed.tenantId,
      requestIdPrefix: resetSeed.requestIdPrefix,
    },
    consumerTargetCoverage: consumerTargetCoverage(failures),
    failures,
  };

  return clone({
    ...taxonomyWithoutFingerprint,
    fingerprint: fingerprintFor(taxonomyWithoutFingerprint),
  });
}

export function getWorkloadChaosFailureCase(id: WorkloadChaosFailureId) {
  return createSuperAppWorkloadChaosFailureTaxonomy().failures.find(
    failure => failure.id === id,
  );
}

export function getWorkloadChaosFailuresForConsumerTarget(
  target: WorkloadScenarioConsumerTarget,
) {
  const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();
  return taxonomy.failures.filter(failure =>
    failure.consumerTargetHints.includes(target),
  );
}
