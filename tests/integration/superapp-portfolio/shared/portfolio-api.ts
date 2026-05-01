import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';
import { SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS } from './workload-chaos-failure-taxonomy.js';
import {
  SUPERAPP_CHAOS_TOGGLE_ENDPOINTS,
  SUPERAPP_CHAOS_TOGGLE_SCOPES,
  SUPERAPP_LEGACY_FAILURE_MODES,
} from './workload-chaos-toggles.js';

const AppIdSchema = Schema.Literals([
  'mobility-marketplace',
  'enterprise-mega-erp',
  'mf-platform',
  'tenant-security',
  'failure-lab',
]);

const ProfileSchema = Schema.Struct({
  durationMs: Schema.Number,
  concurrency: Schema.Number,
  workflows: Schema.Array(Schema.String),
});

const PortfolioAppSchema = Schema.Struct({
  id: AppIdSchema,
  label: Schema.String,
  tenant: Schema.String,
  region: Schema.String,
  kind: Schema.Literals([
    'mobility',
    'erp',
    'module-federation',
    'security',
    'failure-lab',
  ]),
  routes: Schema.Array(Schema.String),
  capabilities: Schema.Array(Schema.String),
  openWork: Schema.Number,
  risk: Schema.Literals(['low', 'medium', 'high']),
  profiles: Schema.Struct({
    smoke: ProfileSchema,
    stress: ProfileSchema,
    nightly: ProfileSchema,
  }),
});

const WorkflowEventSchema = Schema.Struct({
  id: Schema.String,
  appId: AppIdSchema,
  action: Schema.String,
  actor: Schema.String,
  requestId: Schema.String,
  status: Schema.Literals(['accepted', 'deduped']),
});

const PilotScenarioSchema = Schema.Literals([
  'grab-marketplace',
  'mega-erp-command-center',
  'mobility-erp-chat',
]);

const PilotModuleSchema = Schema.Literals([
  'rides',
  'dispatch',
  'orders',
  'erp',
  'chat',
  'mf-remotes',
  'security',
  'billing',
]);

const PilotChaosSchema = Schema.Literals([
  'none',
  'remote-down',
  'api-timeout',
  'chunk-404',
  'clock-skew',
  'restart-during-load',
]);

const FailureModeSchema = Schema.Literals([
  'healthy',
  ...SUPERAPP_LEGACY_FAILURE_MODES,
]);

const FailureInjectionModeSchema = Schema.Literals([
  ...SUPERAPP_LEGACY_FAILURE_MODES,
  ...SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS,
]);

const ChaosToggleScopeSchema = Schema.Literals([
  ...SUPERAPP_CHAOS_TOGGLE_SCOPES,
]);

const ChaosToggleEndpointSchema = Schema.Literals([
  ...SUPERAPP_CHAOS_TOGGLE_ENDPOINTS,
]);

const WorkloadTenantSchema = Schema.Literals([
  'superapp-global',
  'city-ops-eu',
  'acme-global',
  'platform-shell',
  'security-root',
  'chaos-lab',
]);

const WorkloadRoleSchema = Schema.Literals([
  'superapp-operator',
  'mobility-operator',
  'fleet-dispatcher',
  'marketplace-manager',
  'erp-operator',
  'finance-approver',
  'support-lead',
  'platform-operator',
  'security-admin',
  'failure-operator',
]);

const WorkloadUserSchema = Schema.Literals([
  'ops.commander',
  'marketplace.manager',
  'dispatch.lead',
  'fleet.dispatcher',
  'finance.approver',
  'support.lead',
  'platform.operator',
  'security.admin',
  'chaos.operator',
]);

const WorkloadDomainSchema = Schema.Literals([
  'erp-finance',
  'dispatch-mobility',
  'marketplace-orders',
  'fleet-mobility',
  'chat-threads',
  'audit-events',
  'users-roles',
  'admin-operations',
]);

const WorkloadScenarioSchema = Schema.Literals([
  'marketplace-surge-to-ledger',
  'fleet-incident-refund',
  'erp-close-admin-rotation',
  'tenant-boundary-audit',
]);

const WorkloadScenarioProfileCategorySchema = Schema.Literals([
  'read-heavy',
  'write-heavy',
  'mixed',
  'search-filter-sort',
  'chat-pagination',
  'tenant-boundary',
]);

const WorkloadScenarioProfileIdSchema = Schema.Literals([
  'read-heavy-command-center',
  'write-heavy-order-ledger',
  'mixed-cross-app-journey',
  'search-filter-sort-ledger',
  'chat-pagination-history',
  'tenant-boundary-probes',
]);

const WorkloadResetSeedTargetSchema = Schema.Literals([
  'stress',
  'chaos',
  'browser',
  'contract',
]);

const WorkloadDataClassSchema = Schema.Literals([
  'public',
  'internal',
  'confidential',
  'restricted',
]);

const WorkloadConsistencySchema = Schema.Literals([
  'strong',
  'read-your-writes',
  'eventual',
  'append-only',
]);

const WorkloadRiskSchema = Schema.Literals(['low', 'medium', 'high']);

const WorkloadHttpMethodSchema = Schema.Literals([
  'GET',
  'POST',
  'PATCH',
  'DELETE',
]);

const WorkloadTenantPlanSchema = Schema.Struct({
  id: WorkloadTenantSchema,
  label: Schema.String,
  region: Schema.String,
  dataResidency: Schema.String,
  appIds: Schema.Array(AppIdSchema),
  baselineUsers: Schema.Number,
  featureFlags: Schema.Array(Schema.String),
  primaryRoles: Schema.Array(WorkloadRoleSchema),
});

const WorkloadRolePlanSchema = Schema.Struct({
  id: WorkloadRoleSchema,
  label: Schema.String,
  tenantIds: Schema.Array(WorkloadTenantSchema),
  permissions: Schema.Array(Schema.String),
  mutationScopes: Schema.Array(WorkloadDomainSchema),
  privileged: Schema.Boolean,
});

const WorkloadUserPlanSchema = Schema.Struct({
  id: WorkloadUserSchema,
  displayName: Schema.String,
  tenantId: WorkloadTenantSchema,
  roleId: WorkloadRoleSchema,
  homeRegion: Schema.String,
  appIds: Schema.Array(AppIdSchema),
  requestActor: Schema.String,
  workloadWeight: Schema.Number,
});

const WorkloadEntityScaleSchema = Schema.Struct({
  entity: Schema.String,
  perTenant: Schema.Number,
  highWatermark: Schema.Number,
  hotPartitionKey: Schema.String,
  cadence: Schema.String,
});

const WorkloadBudgetSchema = Schema.Struct({
  p95Ms: Schema.Number,
  maxMs: Schema.Number,
  concurrency: Schema.Number,
  recordsTouched: Schema.Number,
});

const WorkloadMutationProfileSchema = Schema.Struct({
  readsPerWrite: Schema.Number,
  idempotentWrites: Schema.Boolean,
  crossTenantWrites: Schema.Boolean,
  retryableActions: Schema.Array(Schema.String),
});

const WorkloadDomainPlanSchema = Schema.Struct({
  id: WorkloadDomainSchema,
  label: Schema.String,
  ownerAppId: AppIdSchema,
  tenantIds: Schema.Array(WorkloadTenantSchema),
  modules: Schema.Array(PilotModuleSchema),
  routes: Schema.Array(Schema.String),
  seedEntities: Schema.Array(Schema.String),
  workflows: Schema.Array(Schema.String),
  invariants: Schema.Array(Schema.String),
  eventKinds: Schema.Array(Schema.String),
  dataClasses: Schema.Array(WorkloadDataClassSchema),
  consistency: WorkloadConsistencySchema,
  scale: Schema.Array(WorkloadEntityScaleSchema),
  mutationProfile: WorkloadMutationProfileSchema,
  budgets: Schema.Struct({
    browser: WorkloadBudgetSchema,
    contract: WorkloadBudgetSchema,
    load: WorkloadBudgetSchema,
    chaos: WorkloadBudgetSchema,
  }),
});

const WorkloadScenarioOperationSchema = Schema.Struct({
  id: Schema.String,
  domainId: WorkloadDomainSchema,
  personaId: WorkloadUserSchema,
  action: Schema.String,
  route: Schema.String,
  method: WorkloadHttpMethodSchema,
  requestId: Schema.String,
  idempotencyKey: Schema.String,
  expectedEventKind: Schema.String,
  weight: Schema.Number,
  producesAuditEvent: Schema.Boolean,
});

const WorkloadScenarioPlanSchema = Schema.Struct({
  id: WorkloadScenarioSchema,
  label: Schema.String,
  tenantId: WorkloadTenantSchema,
  region: Schema.String,
  domains: Schema.Array(WorkloadDomainSchema),
  modules: Schema.Array(PilotModuleSchema),
  routes: Schema.Array(Schema.String),
  personas: Schema.Array(WorkloadUserSchema),
  operations: Schema.Array(WorkloadScenarioOperationSchema),
  invariants: Schema.Array(Schema.String),
  chaosTargets: Schema.Array(WorkloadDomainSchema),
});

const WorkloadAdminOperationSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  tenantId: WorkloadTenantSchema,
  personaId: WorkloadUserSchema,
  targetDomainIds: Schema.Array(WorkloadDomainSchema),
  route: Schema.String,
  mutation: Schema.Boolean,
  auditEventKind: Schema.String,
  risk: WorkloadRiskSchema,
  expectedControls: Schema.Array(Schema.String),
  rollbackExpected: Schema.Boolean,
  invariants: Schema.Array(Schema.String),
});

const WorkloadCatalogSchema = Schema.Struct({
  catalogVersion: Schema.Literal('superapp-workload-data-v1'),
  seed: Schema.Literal('superapp-portfolio-workload-data-v1'),
  clockStartIso: Schema.Literal('2026-01-15T08:00:00.000Z'),
  requestIdPrefix: Schema.Literal('swl-v1'),
  tenants: Schema.Array(WorkloadTenantPlanSchema),
  roles: Schema.Array(WorkloadRolePlanSchema),
  users: Schema.Array(WorkloadUserPlanSchema),
  domains: Schema.Array(WorkloadDomainPlanSchema),
  scenarios: Schema.Array(WorkloadScenarioPlanSchema),
  adminOperations: Schema.Array(WorkloadAdminOperationSchema),
  helperMetadata: Schema.Struct({
    domainIds: Schema.Array(WorkloadDomainSchema),
    tenantIds: Schema.Array(WorkloadTenantSchema),
    scenarioIds: Schema.Array(WorkloadScenarioSchema),
    actorIds: Schema.Array(WorkloadUserSchema),
    routeTestIds: Schema.Array(Schema.String),
    recommendedProfiles: Schema.Struct({
      smokeScenarioIds: Schema.Array(WorkloadScenarioSchema),
      loadScenarioIds: Schema.Array(WorkloadScenarioSchema),
      chaosScenarioIds: Schema.Array(WorkloadScenarioSchema),
      browserScenarioIds: Schema.Array(WorkloadScenarioSchema),
      contractScenarioIds: Schema.Array(WorkloadScenarioSchema),
    }),
  }),
});

const GeneratedWorkloadEntitySchema = Schema.Literals([
  'orders',
  'invoices',
  'ledgerEntries',
  'rides',
  'dispatchAssignments',
  'fleetVehicles',
  'chatThreads',
  'messages',
  'auditEvents',
  'users',
  'roles',
  'memberships',
  'tenantResources',
]);

const GeneratedWorkloadEntityCountsSchema = Schema.Struct({
  orders: Schema.Number,
  invoices: Schema.Number,
  ledgerEntries: Schema.Number,
  rides: Schema.Number,
  dispatchAssignments: Schema.Number,
  fleetVehicles: Schema.Number,
  chatThreads: Schema.Number,
  messages: Schema.Number,
  auditEvents: Schema.Number,
  users: Schema.Number,
  roles: Schema.Number,
  memberships: Schema.Number,
  tenantResources: Schema.Number,
});

const GeneratedWorkloadRecordSchema = Schema.Struct({
  entity: GeneratedWorkloadEntitySchema,
  id: Schema.String,
  tenantId: WorkloadTenantSchema,
  domainId: WorkloadDomainSchema,
  ownerAppId: AppIdSchema,
  createdAtIso: Schema.String,
  partitionKey: Schema.String,
  status: Schema.String,
  actorUserId: Schema.String,
  requestId: Schema.String,
  relatedIds: Schema.Array(Schema.String),
  amountCents: Schema.Number,
  ordinal: Schema.Number,
  checksum: Schema.String,
});

const GeneratedWorkloadHighWatermarkSchema = Schema.Struct({
  entity: GeneratedWorkloadEntitySchema,
  count: Schema.Number,
  firstId: Schema.String,
  lastId: Schema.String,
  lastCreatedAtIso: Schema.String,
});

const GeneratedTenantWorkloadSummarySchema = Schema.Struct({
  tenantId: WorkloadTenantSchema,
  region: Schema.String,
  appIds: Schema.Array(AppIdSchema),
  totalRecords: Schema.Number,
  totals: GeneratedWorkloadEntityCountsSchema,
  sampleIds: Schema.Array(Schema.String),
});

const GeneratedWorkloadSampleWindowSchema = Schema.Struct({
  id: Schema.String,
  entity: GeneratedWorkloadEntitySchema,
  tenantId: WorkloadTenantSchema,
  start: Schema.Number,
  limit: Schema.Number,
  count: Schema.Number,
  firstId: Schema.String,
  lastId: Schema.String,
});

const GeneratedWorkloadSamplesSchema = Schema.Struct({
  orders: Schema.Array(GeneratedWorkloadRecordSchema),
  invoices: Schema.Array(GeneratedWorkloadRecordSchema),
  ledgerEntries: Schema.Array(GeneratedWorkloadRecordSchema),
  rides: Schema.Array(GeneratedWorkloadRecordSchema),
  dispatchAssignments: Schema.Array(GeneratedWorkloadRecordSchema),
  fleetVehicles: Schema.Array(GeneratedWorkloadRecordSchema),
  chatThreads: Schema.Array(GeneratedWorkloadRecordSchema),
  messages: Schema.Array(GeneratedWorkloadRecordSchema),
  auditEvents: Schema.Array(GeneratedWorkloadRecordSchema),
  users: Schema.Array(GeneratedWorkloadRecordSchema),
  roles: Schema.Array(GeneratedWorkloadRecordSchema),
  memberships: Schema.Array(GeneratedWorkloadRecordSchema),
  tenantResources: Schema.Array(GeneratedWorkloadRecordSchema),
});

const GeneratedWorkloadSampleWindowIdsSchema = Schema.Struct({
  orders: Schema.String,
  invoices: Schema.String,
  ledgerEntries: Schema.String,
  rides: Schema.String,
  dispatchAssignments: Schema.String,
  fleetVehicles: Schema.String,
  chatThreads: Schema.String,
  messages: Schema.String,
  auditEvents: Schema.String,
  users: Schema.String,
  roles: Schema.String,
  memberships: Schema.String,
  tenantResources: Schema.String,
});

const GeneratedWorkloadStableRecordIdsSchema = Schema.Struct({
  orderId: Schema.String,
  invoiceId: Schema.String,
  ledgerEntryId: Schema.String,
  rideId: Schema.String,
  dispatchAssignmentId: Schema.String,
  fleetVehicleId: Schema.String,
  chatThreadId: Schema.String,
  messageId: Schema.String,
  auditEventId: Schema.String,
  userId: Schema.String,
  roleId: Schema.String,
  membershipId: Schema.String,
  tenantResourceId: Schema.String,
});

const GeneratedWorkloadTenantBoundaryProbeSchema = Schema.Struct({
  allowedTenantId: WorkloadTenantSchema,
  deniedTenantId: WorkloadTenantSchema,
  appId: AppIdSchema,
  userId: Schema.String,
  roleId: Schema.String,
  resourceId: Schema.String,
  auditEventId: Schema.String,
});

const GeneratedWorkloadContractSchema = Schema.Struct({
  datasetVersion: Schema.Literal('superapp-generated-workload-v1'),
  seed: Schema.Literal('superapp-portfolio-generated-workload-v1'),
  clockStartIso: Schema.Literal('2026-01-15T08:00:00.000Z'),
  clockStepMs: Schema.Number,
  metadata: Schema.Struct({
    totalRecords: Schema.Number,
    totals: GeneratedWorkloadEntityCountsSchema,
    highWatermarks: Schema.Array(GeneratedWorkloadHighWatermarkSchema),
    tenantSummaries: Schema.Array(GeneratedTenantWorkloadSummarySchema),
    sampleWindows: Schema.Array(GeneratedWorkloadSampleWindowSchema),
  }),
  helperIds: Schema.Struct({
    workloadRootTenantId: WorkloadTenantSchema,
    readHeavyTenantId: WorkloadTenantSchema,
    financeTenantId: WorkloadTenantSchema,
    securityTenantId: WorkloadTenantSchema,
    sampleWindows: GeneratedWorkloadSampleWindowIdsSchema,
    stableRecords: GeneratedWorkloadStableRecordIdsSchema,
    tenantBoundaryProbe: GeneratedWorkloadTenantBoundaryProbeSchema,
  }),
  samples: GeneratedWorkloadSamplesSchema,
});

const WorkloadScenarioProfileMetadataSchema = Schema.Struct({
  profileVersion: Schema.Literal('superapp-workload-scenario-profiles-v1'),
  seed: Schema.Literal('superapp-portfolio-scenario-profiles-v1'),
  categories: Schema.Array(WorkloadScenarioProfileCategorySchema),
  profileIds: Schema.Array(WorkloadScenarioProfileIdSchema),
  helperMetadata: Schema.Struct({
    profileCount: Schema.Number,
    categoryCounts: Schema.Array(
      Schema.Struct({
        category: WorkloadScenarioProfileCategorySchema,
        count: Schema.Number,
      }),
    ),
    sampleWindowIds: Schema.Array(Schema.String),
    tenantBoundaryProfileId: WorkloadScenarioProfileIdSchema,
    defaultProfileIds: Schema.Struct({
      k6: Schema.Array(WorkloadScenarioProfileIdSchema),
      load: Schema.Array(WorkloadScenarioProfileIdSchema),
      chaos: Schema.Array(WorkloadScenarioProfileIdSchema),
      browser: Schema.Array(WorkloadScenarioProfileIdSchema),
      contract: Schema.Array(WorkloadScenarioProfileIdSchema),
    }),
  }),
});

const WorkloadSeedDescriptorSchema = Schema.Struct({
  seedVersion: Schema.Literal('superapp-workload-reset-seed-v1'),
  seed: Schema.String,
  target: WorkloadResetSeedTargetSchema,
  scenarioId: WorkloadScenarioSchema,
  profileId: WorkloadScenarioProfileIdSchema,
  tenantId: WorkloadTenantSchema,
  catalogSeed: Schema.Literal('superapp-portfolio-workload-data-v1'),
  generatedSeed: Schema.Literal('superapp-portfolio-generated-workload-v1'),
  scenarioProfileSeed: Schema.Literal(
    'superapp-portfolio-scenario-profiles-v1',
  ),
  clockStartIso: Schema.Literal('2026-01-15T08:00:00.000Z'),
  requestIdPrefix: Schema.String,
  idempotencyKeyPrefix: Schema.String,
  fingerprint: Schema.String,
  sampleWindowIds: Schema.Array(Schema.String),
  sampleRecordIds: Schema.Array(Schema.String),
  selectedSampleWindows: Schema.Array(GeneratedWorkloadSampleWindowSchema),
  metadata: Schema.Struct({
    totalRecords: Schema.Number,
    profileCount: Schema.Number,
    sampleWindowCount: Schema.Number,
    selectedSampleWindowCount: Schema.Number,
    selectedSampleRecordCount: Schema.Number,
  }),
});

const WorkloadResetSeedMetadataSchema = Schema.Struct({
  resetVersion: Schema.Literal('superapp-workload-reset-seed-v1'),
  resetSeed: Schema.Literal('superapp-portfolio-reset-seed-v1'),
  catalogVersion: Schema.Literal('superapp-workload-data-v1'),
  catalogSeed: Schema.Literal('superapp-portfolio-workload-data-v1'),
  generatedVersion: Schema.Literal('superapp-generated-workload-v1'),
  generatedSeed: Schema.Literal('superapp-portfolio-generated-workload-v1'),
  scenarioProfileVersion: Schema.Literal(
    'superapp-workload-scenario-profiles-v1',
  ),
  scenarioProfileSeed: Schema.Literal(
    'superapp-portfolio-scenario-profiles-v1',
  ),
  clockStartIso: Schema.Literal('2026-01-15T08:00:00.000Z'),
  clockStepMs: Schema.Number,
  eventIdPrefix: Schema.Literal('evt'),
  pilotRunIdPrefix: Schema.Literal('pilot'),
  initialEventCounter: Schema.Number,
  initialPilotRunCounter: Schema.Number,
  helperIds: Schema.Struct({
    workloadRootTenantId: WorkloadTenantSchema,
    readHeavyTenantId: WorkloadTenantSchema,
    financeTenantId: WorkloadTenantSchema,
    securityTenantId: WorkloadTenantSchema,
    sampleWindows: GeneratedWorkloadSampleWindowIdsSchema,
    stableRecords: GeneratedWorkloadStableRecordIdsSchema,
    tenantBoundaryProbe: GeneratedWorkloadTenantBoundaryProbeSchema,
  }),
  sampleWindows: Schema.Array(GeneratedWorkloadSampleWindowSchema),
  defaultSeeds: Schema.Struct({
    stress: WorkloadSeedDescriptorSchema,
    chaos: WorkloadSeedDescriptorSchema,
    browser: WorkloadSeedDescriptorSchema,
    contract: WorkloadSeedDescriptorSchema,
  }),
});

const PilotScenarioPlanSchema = Schema.Struct({
  scenario: PilotScenarioSchema,
  label: Schema.String,
  tenant: Schema.String,
  region: Schema.String,
  modules: Schema.Array(PilotModuleSchema),
  routeTransitions: Schema.Array(Schema.String),
  workflows: Schema.Array(Schema.String),
  invariants: Schema.Array(Schema.String),
  chaosModes: Schema.Array(PilotChaosSchema),
});

const PilotModuleResultSchema = Schema.Struct({
  module: PilotModuleSchema,
  appId: AppIdSchema,
  ok: Schema.Boolean,
  degraded: Schema.Boolean,
  invariant: Schema.String,
  durationBudgetMs: Schema.Number,
});

const PilotRunSchema = Schema.Struct({
  id: Schema.String,
  requestId: Schema.String,
  scenario: PilotScenarioSchema,
  scenarioLabel: Schema.String,
  tenant: Schema.String,
  actor: Schema.String,
  status: Schema.Literals(['accepted', 'deduped']),
  chaos: PilotChaosSchema,
  moduleResults: Schema.Array(PilotModuleResultSchema),
  productionChecks: Schema.Array(Schema.String),
  summary: Schema.Struct({
    workflowEvents: Schema.Number,
    chatMessages: Schema.Number,
    approvals: Schema.Number,
    remoteFallbacks: Schema.Number,
    securityChecks: Schema.Number,
    degradedModules: Schema.Number,
  }),
});

const SummarySchema = Schema.Struct({
  appCount: Schema.Number,
  highRiskApps: Schema.Number,
  totalOpenWork: Schema.Number,
  eventCount: Schema.Number,
  failureMode: FailureModeSchema,
  nightlyWorkflowCount: Schema.Number,
});

const ChaosToggleDescriptorSchema = Schema.Struct({
  id: Schema.Literals([...SUPERAPP_WORKLOAD_CHAOS_FAILURE_IDS]),
  kind: Schema.String,
  status: Schema.Literals(['armed', 'consumed']),
  scope: ChaosToggleScopeSchema,
  targetRequestId: Schema.String,
  targetEndpoint: ChaosToggleEndpointSchema,
  expectedHttpStatus: Schema.Number,
  responseKind: Schema.String,
  applicationStatus: Schema.String,
  errorCode: Schema.String,
  messageKey: Schema.String,
  retryable: Schema.Boolean,
  resetRequired: Schema.Boolean,
  retryAfterMs: Schema.optional(Schema.Number),
  armedBy: Schema.String,
  reason: Schema.String,
  armedAtEventId: Schema.String,
  idempotencyKey: Schema.String,
  payloadSeed: Schema.String,
  attemptCount: Schema.Number,
  clockOffsetMs: Schema.Number,
  legacyFailureMode: Schema.optional(Schema.String),
});

const SecurityCheckSchema = Schema.Struct({
  id: Schema.String,
  ok: Schema.Boolean,
});

const SecurityTelemetrySchema = Schema.Struct({
  tenant: Schema.String,
  appId: AppIdSchema,
  requestId: Schema.String,
  role: Schema.String,
  origin: Schema.String,
  authorization: Schema.String,
  csrfToken: Schema.String,
});

export const portfolioApi = HttpApi.make('SuperAppPortfolioApi').add(
  HttpApiGroup.make('portfolio')
    .add(
      HttpApiEndpoint.get('bootstrap', '/effect/bootstrap', {
        success: Schema.Struct({
          apps: Schema.Array(PortfolioAppSchema),
          pilotScenarios: Schema.Array(PilotScenarioPlanSchema),
          workloadCatalog: WorkloadCatalogSchema,
          workloadData: GeneratedWorkloadContractSchema,
          workloadScenarioProfileMetadata:
            WorkloadScenarioProfileMetadataSchema,
          workloadResetSeedMetadata: WorkloadResetSeedMetadataSchema,
          events: Schema.Array(WorkflowEventSchema),
          pilotRuns: Schema.Array(PilotRunSchema),
          summary: SummarySchema,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('runWorkflow', '/effect/apps/:appId/workflow', {
        params: {
          appId: AppIdSchema,
        },
        payload: Schema.Struct({
          action: Schema.String,
          actor: Schema.String,
          requestId: Schema.String,
        }),
        success: Schema.Struct({
          event: WorkflowEventSchema,
          summary: SummarySchema,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('runPilot', '/effect/pilot/:scenario/run', {
        params: {
          scenario: PilotScenarioSchema,
        },
        payload: Schema.Struct({
          tenant: Schema.String,
          actor: Schema.String,
          requestId: Schema.String,
          modules: Schema.Array(PilotModuleSchema),
          chaos: Schema.optional(PilotChaosSchema),
        }),
        success: Schema.Struct({
          run: PilotRunSchema,
          summary: SummarySchema,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('securityProbe', '/effect/security/probe', {
        headers: {
          authorization: Schema.optional(Schema.String),
          origin: Schema.optional(Schema.String),
          'x-csrf-token': Schema.optional(Schema.String),
          'x-tenant-id': Schema.optional(Schema.String),
          'x-user-role': Schema.optional(Schema.String),
        },
        payload: Schema.Struct({
          targetTenant: Schema.String,
          targetAppId: AppIdSchema,
          action: Schema.String,
          requestId: Schema.String,
          mutation: Schema.optional(Schema.Boolean),
        }),
        success: Schema.Struct({
          allowed: Schema.Boolean,
          checks: Schema.Array(SecurityCheckSchema),
          telemetry: SecurityTelemetrySchema,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('injectFailure', '/effect/failure/:mode', {
        params: {
          mode: FailureInjectionModeSchema,
        },
        payload: Schema.Struct({
          actor: Schema.String,
          reason: Schema.String,
          requestId: Schema.optional(Schema.String),
          targetRequestId: Schema.optional(Schema.String),
          targetEndpoint: Schema.optional(ChaosToggleEndpointSchema),
          scope: Schema.optional(ChaosToggleScopeSchema),
        }),
        success: Schema.Struct({
          failureMode: FailureModeSchema,
          chaosToggle: Schema.optional(ChaosToggleDescriptorSchema),
          summary: SummarySchema,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('reset', '/effect/reset', {
        success: Schema.Struct({
          ok: Schema.Boolean,
          workloadResetSeedMetadata: WorkloadResetSeedMetadataSchema,
          summary: SummarySchema,
        }),
      }),
    ),
);
