export type PortfolioAppId =
  | 'mobility-marketplace'
  | 'enterprise-mega-erp'
  | 'mf-platform'
  | 'tenant-security'
  | 'failure-lab';

export type PilotScenario =
  | 'grab-marketplace'
  | 'mega-erp-command-center'
  | 'mobility-erp-chat';

export type PilotModuleId =
  | 'rides'
  | 'dispatch'
  | 'orders'
  | 'erp'
  | 'chat'
  | 'mf-remotes'
  | 'security'
  | 'billing';

export type PilotChaosMode =
  | 'none'
  | 'remote-down'
  | 'api-timeout'
  | 'chunk-404'
  | 'clock-skew'
  | 'restart-during-load';

export type ValidationProfile = {
  durationMs: number;
  concurrency: number;
  workflows: string[];
};

export type PortfolioApp = {
  id: PortfolioAppId;
  label: string;
  tenant: string;
  region: string;
  kind: 'mobility' | 'erp' | 'module-federation' | 'security' | 'failure-lab';
  routes: string[];
  capabilities: string[];
  openWork: number;
  risk: 'low' | 'medium' | 'high';
  profiles: {
    smoke: ValidationProfile;
    stress: ValidationProfile;
    nightly: ValidationProfile;
  };
};

export type WorkflowEvent = {
  id: string;
  appId: PortfolioAppId;
  action: string;
  actor: string;
  requestId: string;
  status: 'accepted' | 'deduped';
};

export type PilotModuleResult = {
  module: PilotModuleId;
  appId: PortfolioAppId;
  ok: boolean;
  degraded: boolean;
  invariant: string;
  durationBudgetMs: number;
};

export type PilotRun = {
  id: string;
  requestId: string;
  scenario: PilotScenario;
  tenant: string;
  actor: string;
  status: 'accepted' | 'deduped';
  chaos: PilotChaosMode;
  moduleResults: PilotModuleResult[];
  summary: {
    workflowEvents: number;
    chatMessages: number;
    approvals: number;
    remoteFallbacks: number;
    securityChecks: number;
    degradedModules: number;
  };
};

export type PortfolioState = {
  apps: PortfolioApp[];
  events: WorkflowEvent[];
  pilotRuns: PilotRun[];
  failureMode: 'healthy' | 'remote-down' | 'api-timeout' | 'chunk-404';
  tenantAccess: Record<string, PortfolioAppId[]>;
};

export function createInitialPortfolioState(): PortfolioState {
  return {
    apps: [
      {
        id: 'mobility-marketplace',
        label: 'Mobility Marketplace',
        tenant: 'city-ops-eu',
        region: 'EMEA',
        kind: 'mobility',
        routes: ['/mobility', '/mobility/dispatch', '/mobility/support'],
        capabilities: [
          'rider booking',
          'driver dispatch',
          'price quote idempotency',
          'support chat',
        ],
        openWork: 84,
        risk: 'high',
        profiles: profileSet(
          ['quote', 'dispatch', 'cancel', 'support-chat'],
          ['quote-burst', 'driver-status', 'region-reroute'],
        ),
      },
      {
        id: 'enterprise-mega-erp',
        label: 'Enterprise MegaERP',
        tenant: 'acme-global',
        region: 'GLOBAL',
        kind: 'erp',
        routes: ['/mega-erp', '/mega-erp/procurement', '/mega-erp/payroll'],
        capabilities: [
          'large table filters',
          'bulk approvals',
          'partial failure recovery',
          'activity stream',
        ],
        openWork: 126,
        risk: 'medium',
        profiles: profileSet(
          ['filter-ledger', 'bulk-approve', 'partial-failure'],
          ['bulk-write', 'pagination-churn', 'permission-boundary'],
        ),
      },
      {
        id: 'mf-platform',
        label: 'Micro-Frontend Platform',
        tenant: 'platform-shell',
        region: 'MULTI',
        kind: 'module-federation',
        routes: ['/mf-platform', '/mf-platform/finance', '/mf-platform/chat'],
        capabilities: [
          'remote manifest skew',
          'slow remote fallback',
          'shared singleton check',
          'trace continuity',
        ],
        openWork: 31,
        risk: 'high',
        profiles: profileSet(
          ['load-remote', 'manifest-skew', 'fallback'],
          ['remote-down', 'schema-mismatch', 'shared-singleton'],
        ),
      },
      {
        id: 'tenant-security',
        label: 'Tenant Security Console',
        tenant: 'security-root',
        region: 'US',
        kind: 'security',
        routes: ['/security', '/security/roles', '/security/audit'],
        capabilities: [
          'tenant isolation',
          'role boundaries',
          'csrf guard',
          'telemetry redaction',
        ],
        openWork: 19,
        risk: 'high',
        profiles: profileSet(
          ['role-check', 'tenant-switch', 'csrf-reject'],
          ['requestid-isolation', 'origin-check', 'redaction-scan'],
        ),
      },
      {
        id: 'failure-lab',
        label: 'Failure Lab',
        tenant: 'chaos-lab',
        region: 'LOCAL',
        kind: 'failure-lab',
        routes: ['/failure-lab', '/failure-lab/remotes', '/failure-lab/assets'],
        capabilities: [
          'api timeout',
          'malformed json',
          'chunk 404',
          'remote down',
        ],
        openWork: 12,
        risk: 'medium',
        profiles: profileSet(
          ['api-timeout', 'malformed-json', 'remote-down'],
          ['chunk-404', 'restart-during-load', 'clock-skew'],
        ),
      },
    ],
    events: [],
    pilotRuns: [],
    failureMode: 'healthy',
    tenantAccess: {
      'superapp-global': [
        'mobility-marketplace',
        'enterprise-mega-erp',
        'mf-platform',
        'tenant-security',
        'failure-lab',
      ],
      'city-ops-eu': ['mobility-marketplace'],
      'acme-global': ['enterprise-mega-erp'],
      'platform-shell': ['mf-platform'],
      'security-root': ['tenant-security'],
      'chaos-lab': ['failure-lab'],
    },
  };
}

function profileSet(smokeWorkflows: string[], stressWorkflows: string[]) {
  return {
    smoke: {
      durationMs: 1000,
      concurrency: 1,
      workflows: smokeWorkflows,
    },
    stress: {
      durationMs: 120000,
      concurrency: 8,
      workflows: stressWorkflows,
    },
    nightly: {
      durationMs: 7200000,
      concurrency: 16,
      workflows: [...smokeWorkflows, ...stressWorkflows, 'browser-route-churn'],
    },
  };
}

export function summarizePortfolio(state: PortfolioState) {
  const highRiskApps = state.apps.filter(app => app.risk === 'high').length;
  const totalOpenWork = state.apps.reduce((sum, app) => sum + app.openWork, 0);
  const nightlyWorkflowCount = state.apps.reduce(
    (sum, app) => sum + app.profiles.nightly.workflows.length,
    0,
  );

  return {
    appCount: state.apps.length,
    highRiskApps,
    totalOpenWork,
    eventCount: state.events.length,
    failureMode: state.failureMode,
    nightlyWorkflowCount,
  };
}
