import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';

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
  failureMode: Schema.Literals([
    'healthy',
    'remote-down',
    'api-timeout',
    'chunk-404',
  ]),
  nightlyWorkflowCount: Schema.Number,
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
          mode: Schema.Literals(['remote-down', 'api-timeout', 'chunk-404']),
        },
        payload: Schema.Struct({
          actor: Schema.String,
          reason: Schema.String,
        }),
        success: Schema.Struct({
          failureMode: Schema.Literals([
            'remote-down',
            'api-timeout',
            'chunk-404',
          ]),
          summary: SummarySchema,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('reset', '/effect/reset', {
        success: Schema.Struct({
          ok: Schema.Boolean,
          summary: SummarySchema,
        }),
      }),
    ),
);
