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
