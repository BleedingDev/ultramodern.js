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
  tenant: Schema.String,
  actor: Schema.String,
  status: Schema.Literals(['accepted', 'deduped']),
  chaos: PilotChaosSchema,
  moduleResults: Schema.Array(PilotModuleResultSchema),
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
          events: Schema.Array(WorkflowEventSchema),
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
