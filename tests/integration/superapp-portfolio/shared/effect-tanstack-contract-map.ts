// @effect-diagnostics strictBooleanExpressions:off
import type {
  PilotChaosMode,
  PilotScenario,
  PortfolioAppId,
} from './portfolio-state';

type HttpMethod = 'GET' | 'POST';
type OperationKind = 'query' | 'mutation';
type ContractScope =
  | 'client'
  | 'server'
  | 'workload'
  | 'tenant'
  | 'reset'
  | 'erp'
  | 'validation';

type QueryKeyId =
  | 'portfolio.bootstrap'
  | 'portfolio.summary'
  | 'portfolio.apps'
  | 'portfolio.app.detail'
  | 'portfolio.events'
  | 'portfolio.pilotRuns'
  | 'portfolio.pilotRun.detail'
  | 'portfolio.failureMode'
  | 'portfolio.workload.catalog'
  | 'portfolio.workload.generatedData'
  | 'portfolio.workload.scenarioProfiles'
  | 'portfolio.workload.resetSeed'
  | 'portfolio.security.decision';

type MutationKeyId =
  | 'portfolio.workflow.run'
  | 'portfolio.pilot.run'
  | 'portfolio.security.probe'
  | 'portfolio.failure.inject'
  | 'portfolio.erp.approval.decide'
  | 'portfolio.erp.chat.send'
  | 'portfolio.reset';

type EffectEndpointId =
  | 'effect.bootstrap'
  | 'effect.erpBootstrap'
  | 'effect.decideErpApproval'
  | 'effect.sendErpChat'
  | 'effect.runWorkflow'
  | 'effect.runPilot'
  | 'effect.securityProbe'
  | 'effect.injectFailure'
  | 'effect.reset';

type InvalidationBoundaryId =
  | 'workflow-event-accepted'
  | 'pilot-run-accepted'
  | 'security-decision-readonly'
  | 'failure-mode-injected'
  | 'erp-approval-decided'
  | 'erp-chat-sent'
  | 'portfolio-reset';

type TanStackRouteId = '__root__' | '/' | '/apps/$appId';

type ContractField = {
  readonly name: string;
  readonly source: 'headers' | 'params' | 'payload' | 'success' | 'loader';
  readonly required: boolean;
};

type QueryKeyTemplate = {
  readonly id: QueryKeyId;
  readonly parts: readonly string[];
  readonly owner: 'tanstack-query';
  readonly representedInRuntime: false;
  readonly source: 'contract-defined';
  readonly scope: readonly ContractScope[];
};

type MutationKeyTemplate = {
  readonly id: MutationKeyId;
  readonly parts: readonly string[];
  readonly endpointId: EffectEndpointId;
  readonly scope: readonly ContractScope[];
};

type EffectEndpointContract = {
  readonly id: EffectEndpointId;
  readonly operation: string;
  readonly method: HttpMethod;
  readonly effectPath: string;
  readonly publicPath: string;
  readonly kind: OperationKind;
  readonly sourceFile: string;
  readonly handler: string;
  readonly params: readonly ContractField[];
  readonly headers: readonly ContractField[];
  readonly payload: readonly ContractField[];
  readonly successFields: readonly string[];
  readonly requestContextFields: readonly string[];
  readonly queryKeyIds: readonly QueryKeyId[];
  readonly mutationKeyId?: MutationKeyId;
  readonly invalidationBoundaryId?: InvalidationBoundaryId;
};

type InvalidationBoundary = {
  readonly id: InvalidationBoundaryId;
  readonly endpointId: EffectEndpointId;
  readonly mutationKeyId: MutationKeyId;
  readonly stateMutation: boolean;
  readonly invalidatesQueryKeyIds: readonly QueryKeyId[];
  readonly stateScopes: readonly string[];
  readonly currentRuntimeRefresh: readonly TanStackRouteId[];
};

type TanStackRouteContract = {
  readonly id: TanStackRouteId;
  readonly path: TanStackRouteId;
  readonly sourceFiles: readonly string[];
  readonly loaderFields: readonly ContractField[];
  readonly bffEndpointIds: readonly EffectEndpointId[];
  readonly queryKeyIds: readonly QueryKeyId[];
  readonly mutationKeyIds: readonly MutationKeyId[];
};

type PortfolioDomainRouteContract = {
  readonly path: string;
  readonly ownerAppId: PortfolioAppId;
  readonly tenantId:
    | 'city-ops-eu'
    | 'acme-global'
    | 'platform-shell'
    | 'security-root'
    | 'chaos-lab';
  readonly appKind:
    | 'mobility'
    | 'erp'
    | 'module-federation'
    | 'security'
    | 'failure-lab';
  readonly routeSource: 'PortfolioApp.routes';
  readonly queryKeyIds: readonly QueryKeyId[];
};

const endpointBase = '/bff-api';

const field = (
  source: ContractField['source'],
  name: string,
  required = true,
): ContractField => ({
  name,
  source,
  required,
});

export const SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES: readonly QueryKeyTemplate[] =
  [
    {
      id: 'portfolio.bootstrap',
      parts: ['superapp-portfolio', 'bootstrap'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['client', 'server', 'workload'],
    },
    {
      id: 'portfolio.summary',
      parts: ['superapp-portfolio', 'summary'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['client', 'server'],
    },
    {
      id: 'portfolio.apps',
      parts: ['superapp-portfolio', 'apps'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['client', 'tenant'],
    },
    {
      id: 'portfolio.app.detail',
      parts: ['superapp-portfolio', 'apps', ':appId'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['client', 'tenant'],
    },
    {
      id: 'portfolio.events',
      parts: ['superapp-portfolio', 'events'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['server', 'validation'],
    },
    {
      id: 'portfolio.pilotRuns',
      parts: ['superapp-portfolio', 'pilot-runs'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['server', 'validation'],
    },
    {
      id: 'portfolio.pilotRun.detail',
      parts: [
        'superapp-portfolio',
        'pilot-runs',
        ':scenario',
        ':tenant',
        ':requestId',
      ],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['server', 'tenant', 'validation'],
    },
    {
      id: 'portfolio.failureMode',
      parts: ['superapp-portfolio', 'failure-mode'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['server', 'validation'],
    },
    {
      id: 'portfolio.workload.catalog',
      parts: ['superapp-portfolio', 'workload', 'catalog'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['workload', 'validation'],
    },
    {
      id: 'portfolio.workload.generatedData',
      parts: ['superapp-portfolio', 'workload', 'generated-data'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['workload', 'validation'],
    },
    {
      id: 'portfolio.workload.scenarioProfiles',
      parts: ['superapp-portfolio', 'workload', 'scenario-profiles'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['workload', 'validation'],
    },
    {
      id: 'portfolio.workload.resetSeed',
      parts: ['superapp-portfolio', 'workload', 'reset-seed'],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['reset', 'validation'],
    },
    {
      id: 'portfolio.security.decision',
      parts: [
        'superapp-portfolio',
        'security',
        'decision',
        ':targetTenant',
        ':targetAppId',
        ':requestId',
      ],
      owner: 'tanstack-query',
      representedInRuntime: false,
      source: 'contract-defined',
      scope: ['server', 'tenant', 'validation'],
    },
  ] as const;

export const SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES: readonly MutationKeyTemplate[] =
  [
    {
      id: 'portfolio.workflow.run',
      endpointId: 'effect.runWorkflow',
      parts: [
        'superapp-portfolio',
        'mutation',
        'workflow',
        ':appId',
        ':requestId',
      ],
      scope: ['client', 'server', 'tenant'],
    },
    {
      id: 'portfolio.pilot.run',
      endpointId: 'effect.runPilot',
      parts: [
        'superapp-portfolio',
        'mutation',
        'pilot',
        ':scenario',
        ':tenant',
        ':requestId',
      ],
      scope: ['client', 'server', 'tenant', 'validation'],
    },
    {
      id: 'portfolio.security.probe',
      endpointId: 'effect.securityProbe',
      parts: [
        'superapp-portfolio',
        'mutation',
        'security-probe',
        ':targetTenant',
        ':targetAppId',
        ':requestId',
      ],
      scope: ['server', 'tenant', 'validation'],
    },
    {
      id: 'portfolio.failure.inject',
      endpointId: 'effect.injectFailure',
      parts: ['superapp-portfolio', 'mutation', 'failure', ':mode'],
      scope: ['server', 'validation'],
    },
    {
      id: 'portfolio.erp.approval.decide',
      endpointId: 'effect.decideErpApproval',
      parts: ['superapp-portfolio', 'mutation', 'erp', 'approval', ':id'],
      scope: ['client', 'server', 'tenant', 'erp'],
    },
    {
      id: 'portfolio.erp.chat.send',
      endpointId: 'effect.sendErpChat',
      parts: ['superapp-portfolio', 'mutation', 'erp', 'chat', ':channel'],
      scope: ['client', 'server', 'tenant', 'erp'],
    },
    {
      id: 'portfolio.reset',
      endpointId: 'effect.reset',
      parts: ['superapp-portfolio', 'mutation', 'reset'],
      scope: ['reset', 'validation'],
    },
  ] as const;

export const SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS: readonly EffectEndpointContract[] =
  [
    {
      id: 'effect.bootstrap',
      operation: 'portfolio.bootstrap',
      method: 'GET',
      effectPath: '/effect/bootstrap',
      publicPath: `${endpointBase}/effect/bootstrap`,
      kind: 'query',
      sourceFile:
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      handler:
        'tests/integration/superapp-portfolio/api/effect/index.ts:bootstrap',
      params: [],
      headers: [],
      payload: [],
      successFields: [
        'apps',
        'pilotScenarios',
        'workloadCatalog',
        'workloadData',
        'workloadScenarioProfileMetadata',
        'workloadResetSeedMetadata',
        'events',
        'pilotRuns',
        'summary',
        'erp',
      ],
      requestContextFields: [],
      queryKeyIds: [
        'portfolio.bootstrap',
        'portfolio.summary',
        'portfolio.apps',
        'portfolio.events',
        'portfolio.pilotRuns',
        'portfolio.failureMode',
        'portfolio.workload.catalog',
        'portfolio.workload.generatedData',
        'portfolio.workload.scenarioProfiles',
        'portfolio.workload.resetSeed',
      ],
    },
    {
      id: 'effect.erpBootstrap',
      operation: 'portfolio.erpBootstrap',
      method: 'GET',
      effectPath: '/effect/apps/enterprise-mega-erp/erp/bootstrap',
      publicPath: `${endpointBase}/effect/apps/enterprise-mega-erp/erp/bootstrap`,
      kind: 'query',
      sourceFile:
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      handler:
        'tests/integration/superapp-portfolio/api/effect/index.ts:erpBootstrap',
      params: [],
      headers: [],
      payload: [],
      successFields: ['tenant', 'modules', 'approvals', 'chat', 'summary'],
      requestContextFields: [],
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      id: 'effect.decideErpApproval',
      operation: 'portfolio.decideErpApproval',
      method: 'POST',
      effectPath: '/effect/apps/enterprise-mega-erp/erp/approval/:id/decision',
      publicPath: `${endpointBase}/effect/apps/enterprise-mega-erp/erp/approval/:id/decision`,
      kind: 'mutation',
      sourceFile:
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      handler:
        'tests/integration/superapp-portfolio/api/effect/index.ts:decideErpApproval',
      params: [field('params', 'id')],
      headers: [],
      payload: [field('payload', 'decision'), field('payload', 'actor')],
      successFields: ['id', 'status', 'actor', 'pendingApprovals'],
      requestContextFields: ['id', 'decision', 'actor'],
      queryKeyIds: [],
      mutationKeyId: 'portfolio.erp.approval.decide',
      invalidationBoundaryId: 'erp-approval-decided',
    },
    {
      id: 'effect.sendErpChat',
      operation: 'portfolio.sendErpChat',
      method: 'POST',
      effectPath: '/effect/apps/enterprise-mega-erp/erp/chat/send',
      publicPath: `${endpointBase}/effect/apps/enterprise-mega-erp/erp/chat/send`,
      kind: 'mutation',
      sourceFile:
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      handler:
        'tests/integration/superapp-portfolio/api/effect/index.ts:sendErpChat',
      params: [],
      headers: [],
      payload: [
        field('payload', 'channel'),
        field('payload', 'author'),
        field('payload', 'text'),
        field('payload', 'priority'),
      ],
      successFields: ['accepted', 'message', 'totalMessages'],
      requestContextFields: ['channel', 'author', 'priority'],
      queryKeyIds: [],
      mutationKeyId: 'portfolio.erp.chat.send',
      invalidationBoundaryId: 'erp-chat-sent',
    },
    {
      id: 'effect.runWorkflow',
      operation: 'portfolio.runWorkflow',
      method: 'POST',
      effectPath: '/effect/apps/:appId/workflow',
      publicPath: `${endpointBase}/effect/apps/:appId/workflow`,
      kind: 'mutation',
      sourceFile:
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      handler:
        'tests/integration/superapp-portfolio/api/effect/index.ts:runWorkflow',
      params: [field('params', 'appId')],
      headers: [],
      payload: [
        field('payload', 'action'),
        field('payload', 'actor'),
        field('payload', 'requestId'),
      ],
      successFields: ['event', 'summary'],
      requestContextFields: ['appId', 'actor', 'requestId'],
      queryKeyIds: [],
      mutationKeyId: 'portfolio.workflow.run',
      invalidationBoundaryId: 'workflow-event-accepted',
    },
    {
      id: 'effect.runPilot',
      operation: 'portfolio.runPilot',
      method: 'POST',
      effectPath: '/effect/pilot/:scenario/run',
      publicPath: `${endpointBase}/effect/pilot/:scenario/run`,
      kind: 'mutation',
      sourceFile:
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      handler:
        'tests/integration/superapp-portfolio/api/effect/index.ts:runPilot',
      params: [field('params', 'scenario')],
      headers: [],
      payload: [
        field('payload', 'tenant'),
        field('payload', 'actor'),
        field('payload', 'requestId'),
        field('payload', 'modules'),
        field('payload', 'chaos', false),
      ],
      successFields: ['run', 'summary'],
      requestContextFields: [
        'scenario',
        'tenant',
        'actor',
        'requestId',
        'modules',
        'chaos',
      ],
      queryKeyIds: [],
      mutationKeyId: 'portfolio.pilot.run',
      invalidationBoundaryId: 'pilot-run-accepted',
    },
    {
      id: 'effect.securityProbe',
      operation: 'portfolio.securityProbe',
      method: 'POST',
      effectPath: '/effect/security/probe',
      publicPath: `${endpointBase}/effect/security/probe`,
      kind: 'mutation',
      sourceFile:
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      handler:
        'tests/integration/superapp-portfolio/api/effect/index.ts:securityProbe',
      params: [],
      headers: [
        field('headers', 'authorization', false),
        field('headers', 'origin', false),
        field('headers', 'x-csrf-token', false),
        field('headers', 'x-tenant-id', false),
        field('headers', 'x-user-role', false),
      ],
      payload: [
        field('payload', 'targetTenant'),
        field('payload', 'targetAppId'),
        field('payload', 'action'),
        field('payload', 'requestId'),
        field('payload', 'mutation', false),
      ],
      successFields: ['allowed', 'checks', 'telemetry'],
      requestContextFields: [
        'authorization',
        'origin',
        'x-csrf-token',
        'x-tenant-id',
        'x-user-role',
        'targetTenant',
        'targetAppId',
        'requestId',
        'mutation',
      ],
      queryKeyIds: ['portfolio.security.decision'],
      mutationKeyId: 'portfolio.security.probe',
      invalidationBoundaryId: 'security-decision-readonly',
    },
    {
      id: 'effect.injectFailure',
      operation: 'portfolio.injectFailure',
      method: 'POST',
      effectPath: '/effect/failure/:mode',
      publicPath: `${endpointBase}/effect/failure/:mode`,
      kind: 'mutation',
      sourceFile:
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      handler:
        'tests/integration/superapp-portfolio/api/effect/index.ts:injectFailure',
      params: [field('params', 'mode')],
      headers: [],
      payload: [field('payload', 'actor'), field('payload', 'reason')],
      successFields: ['failureMode', 'summary'],
      requestContextFields: ['mode', 'actor', 'reason'],
      queryKeyIds: [],
      mutationKeyId: 'portfolio.failure.inject',
      invalidationBoundaryId: 'failure-mode-injected',
    },
    {
      id: 'effect.reset',
      operation: 'portfolio.reset',
      method: 'POST',
      effectPath: '/effect/reset',
      publicPath: `${endpointBase}/effect/reset`,
      kind: 'mutation',
      sourceFile:
        'tests/integration/superapp-portfolio/shared/portfolio-api.ts',
      handler: 'tests/integration/superapp-portfolio/api/effect/index.ts:reset',
      params: [],
      headers: [],
      payload: [],
      successFields: ['ok', 'workloadResetSeedMetadata', 'summary'],
      requestContextFields: [],
      queryKeyIds: [],
      mutationKeyId: 'portfolio.reset',
      invalidationBoundaryId: 'portfolio-reset',
    },
  ] as const;

export const SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES: readonly InvalidationBoundary[] =
  [
    {
      id: 'workflow-event-accepted',
      endpointId: 'effect.runWorkflow',
      mutationKeyId: 'portfolio.workflow.run',
      stateMutation: true,
      invalidatesQueryKeyIds: [
        'portfolio.bootstrap',
        'portfolio.summary',
        'portfolio.apps',
        'portfolio.app.detail',
        'portfolio.events',
      ],
      stateScopes: ['events', 'apps.openWork', 'summary.eventCount'],
      currentRuntimeRefresh: [],
    },
    {
      id: 'pilot-run-accepted',
      endpointId: 'effect.runPilot',
      mutationKeyId: 'portfolio.pilot.run',
      stateMutation: true,
      invalidatesQueryKeyIds: [
        'portfolio.bootstrap',
        'portfolio.summary',
        'portfolio.apps',
        'portfolio.events',
        'portfolio.pilotRuns',
        'portfolio.pilotRun.detail',
        'portfolio.failureMode',
      ],
      stateScopes: [
        'events',
        'pilotRuns',
        'apps.openWork',
        'failureMode',
        'summary.eventCount',
      ],
      currentRuntimeRefresh: ['/'],
    },
    {
      id: 'security-decision-readonly',
      endpointId: 'effect.securityProbe',
      mutationKeyId: 'portfolio.security.probe',
      stateMutation: false,
      invalidatesQueryKeyIds: ['portfolio.security.decision'],
      stateScopes: [],
      currentRuntimeRefresh: [],
    },
    {
      id: 'failure-mode-injected',
      endpointId: 'effect.injectFailure',
      mutationKeyId: 'portfolio.failure.inject',
      stateMutation: true,
      invalidatesQueryKeyIds: [
        'portfolio.bootstrap',
        'portfolio.summary',
        'portfolio.events',
        'portfolio.failureMode',
      ],
      stateScopes: ['events', 'failureMode', 'summary.eventCount'],
      currentRuntimeRefresh: [],
    },
    {
      id: 'erp-approval-decided',
      endpointId: 'effect.decideErpApproval',
      mutationKeyId: 'portfolio.erp.approval.decide',
      stateMutation: true,
      invalidatesQueryKeyIds: ['portfolio.bootstrap', 'portfolio.app.detail'],
      stateScopes: ['erp.approvals', 'erp.summary.pendingApprovals'],
      currentRuntimeRefresh: ['/apps/$appId'],
    },
    {
      id: 'erp-chat-sent',
      endpointId: 'effect.sendErpChat',
      mutationKeyId: 'portfolio.erp.chat.send',
      stateMutation: true,
      invalidatesQueryKeyIds: ['portfolio.bootstrap', 'portfolio.app.detail'],
      stateScopes: ['erp.chat', 'erp.summary.urgentMessages'],
      currentRuntimeRefresh: ['/apps/$appId'],
    },
    {
      id: 'portfolio-reset',
      endpointId: 'effect.reset',
      mutationKeyId: 'portfolio.reset',
      stateMutation: true,
      invalidatesQueryKeyIds: [
        'portfolio.bootstrap',
        'portfolio.summary',
        'portfolio.apps',
        'portfolio.app.detail',
        'portfolio.events',
        'portfolio.pilotRuns',
        'portfolio.pilotRun.detail',
        'portfolio.failureMode',
        'portfolio.workload.catalog',
        'portfolio.workload.generatedData',
        'portfolio.workload.scenarioProfiles',
        'portfolio.workload.resetSeed',
        'portfolio.security.decision',
      ],
      stateScopes: [
        'apps',
        'events',
        'pilotRuns',
        'failureMode',
        'workloadCatalog',
        'workloadData',
        'workloadScenarioProfileMetadata',
        'workloadResetSeedMetadata',
      ],
      currentRuntimeRefresh: ['/'],
    },
  ] as const;

export const SUPERAPP_TANSTACK_ROUTE_CONTRACTS: readonly TanStackRouteContract[] =
  [
    {
      id: '__root__',
      path: '__root__',
      sourceFiles: [
        'tests/integration/superapp-portfolio/src/routes/layout.tsx',
        'tests/integration/superapp-portfolio/src/routes/layout.loader.ts',
      ],
      loaderFields: [field('loader', 'shellMode'), field('loader', 'summary')],
      bffEndpointIds: [],
      queryKeyIds: ['portfolio.summary'],
      mutationKeyIds: [],
    },
    {
      id: '/',
      path: '/',
      sourceFiles: [
        'tests/integration/superapp-portfolio/src/routes/page.tsx',
        'tests/integration/superapp-portfolio/src/routes/page.loader.ts',
      ],
      loaderFields: [field('loader', 'routeKind')],
      bffEndpointIds: ['effect.bootstrap', 'effect.runPilot', 'effect.reset'],
      queryKeyIds: [
        'portfolio.bootstrap',
        'portfolio.summary',
        'portfolio.apps',
        'portfolio.pilotRuns',
      ],
      mutationKeyIds: ['portfolio.pilot.run', 'portfolio.reset'],
    },
    {
      id: '/apps/$appId',
      path: '/apps/$appId',
      sourceFiles: [
        'tests/integration/superapp-portfolio/src/routes/apps/[appId]/page.tsx',
        'tests/integration/superapp-portfolio/src/routes/apps/[appId]/page.data.ts',
      ],
      loaderFields: [
        field('loader', 'appId'),
        field('loader', 'routeKind'),
        field('loader', 'expectedCapabilities'),
      ],
      bffEndpointIds: [
        'effect.bootstrap',
        'effect.erpBootstrap',
        'effect.runWorkflow',
        'effect.decideErpApproval',
        'effect.sendErpChat',
      ],
      queryKeyIds: ['portfolio.bootstrap', 'portfolio.app.detail'],
      mutationKeyIds: [
        'portfolio.workflow.run',
        'portfolio.erp.approval.decide',
        'portfolio.erp.chat.send',
      ],
    },
  ] as const;

export const SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS: readonly PortfolioDomainRouteContract[] =
  [
    {
      path: '/mobility',
      ownerAppId: 'mobility-marketplace',
      tenantId: 'city-ops-eu',
      appKind: 'mobility',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      path: '/mobility/dispatch',
      ownerAppId: 'mobility-marketplace',
      tenantId: 'city-ops-eu',
      appKind: 'mobility',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      path: '/mobility/support',
      ownerAppId: 'mobility-marketplace',
      tenantId: 'city-ops-eu',
      appKind: 'mobility',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      path: '/mega-erp',
      ownerAppId: 'enterprise-mega-erp',
      tenantId: 'acme-global',
      appKind: 'erp',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      path: '/mega-erp/procurement',
      ownerAppId: 'enterprise-mega-erp',
      tenantId: 'acme-global',
      appKind: 'erp',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      path: '/mega-erp/payroll',
      ownerAppId: 'enterprise-mega-erp',
      tenantId: 'acme-global',
      appKind: 'erp',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      path: '/mf-platform',
      ownerAppId: 'mf-platform',
      tenantId: 'platform-shell',
      appKind: 'module-federation',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      path: '/mf-platform/finance',
      ownerAppId: 'mf-platform',
      tenantId: 'platform-shell',
      appKind: 'module-federation',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      path: '/mf-platform/chat',
      ownerAppId: 'mf-platform',
      tenantId: 'platform-shell',
      appKind: 'module-federation',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail'],
    },
    {
      path: '/security',
      ownerAppId: 'tenant-security',
      tenantId: 'security-root',
      appKind: 'security',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail', 'portfolio.security.decision'],
    },
    {
      path: '/security/roles',
      ownerAppId: 'tenant-security',
      tenantId: 'security-root',
      appKind: 'security',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail', 'portfolio.security.decision'],
    },
    {
      path: '/security/audit',
      ownerAppId: 'tenant-security',
      tenantId: 'security-root',
      appKind: 'security',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail', 'portfolio.security.decision'],
    },
    {
      path: '/failure-lab',
      ownerAppId: 'failure-lab',
      tenantId: 'chaos-lab',
      appKind: 'failure-lab',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail', 'portfolio.failureMode'],
    },
    {
      path: '/failure-lab/remotes',
      ownerAppId: 'failure-lab',
      tenantId: 'chaos-lab',
      appKind: 'failure-lab',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail', 'portfolio.failureMode'],
    },
    {
      path: '/failure-lab/assets',
      ownerAppId: 'failure-lab',
      tenantId: 'chaos-lab',
      appKind: 'failure-lab',
      routeSource: 'PortfolioApp.routes',
      queryKeyIds: ['portfolio.app.detail', 'portfolio.failureMode'],
    },
  ] as const;

export const SUPERAPP_REQUEST_CONTEXT_FIELDS = {
  tenantHeaders: ['x-tenant-id', 'x-user-role'] as const,
  securityHeaders: [
    'authorization',
    'origin',
    'x-csrf-token',
    'x-tenant-id',
    'x-user-role',
  ] as const,
  requestIdPayloadFields: ['requestId'] as const,
  tenantPayloadFields: ['tenant', 'targetTenant'] as const,
  actorPayloadFields: ['actor'] as const,
  idempotency: {
    workflow: ['appId', 'requestId'] as const,
    pilot: ['scenario', 'tenant', 'requestId'] as const,
    securityProbe: ['targetTenant', 'targetAppId', 'requestId'] as const,
  },
} as const;

export const SUPERAPP_PILOT_CONTRACT_VALUES = {
  scenarios: [
    'grab-marketplace',
    'mega-erp-command-center',
    'mobility-erp-chat',
  ] as const satisfies readonly PilotScenario[],
  chaosModes: [
    'none',
    'remote-down',
    'api-timeout',
    'chunk-404',
    'clock-skew',
    'restart-during-load',
  ] as const satisfies readonly PilotChaosMode[],
} as const;

const queryKeyTemplateById = new Map(
  SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(template => [
    template.id,
    template,
  ]),
);

const endpointById = new Map(
  SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(endpoint => [
    endpoint.id,
    endpoint,
  ]),
);

const boundaryById = new Map(
  SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES.map(boundary => [
    boundary.id,
    boundary,
  ]),
);

export function getSuperAppEffectEndpoint(id: EffectEndpointId) {
  const endpoint = endpointById.get(id);
  if (!endpoint) {
    throw new Error(`Unknown SuperApp Effect endpoint contract: ${id}`);
  }
  return endpoint;
}

export function getSuperAppInvalidationBoundary(id: InvalidationBoundaryId) {
  const boundary = boundaryById.get(id);
  if (!boundary) {
    throw new Error(`Unknown SuperApp invalidation boundary: ${id}`);
  }
  return boundary;
}

export function createSuperAppQueryKey(
  id: QueryKeyId,
  values: Partial<Record<string, string>> = {},
) {
  const template = queryKeyTemplateById.get(id);
  if (!template) {
    throw new Error(`Unknown SuperApp query key template: ${id}`);
  }

  return template.parts.map(part => {
    if (!part.startsWith(':')) {
      return part;
    }

    const name = part.slice(1);
    const value = values[name];
    if (!value) {
      throw new Error(`Missing SuperApp query key value: ${name}`);
    }
    return value;
  });
}
