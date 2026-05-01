import {
  createSuperAppWorkloadCatalog,
  type SuperAppWorkloadCatalog,
} from './workload-domain-catalog.js';
import {
  createSuperAppGeneratedWorkloadContract,
  type SuperAppGeneratedWorkloadContract,
} from './workload-generated-data.js';
import {
  createSuperAppWorkloadResetSeedMetadata,
  type SuperAppWorkloadResetSeedMetadata,
} from './workload-reset-seed.js';
import {
  createSuperAppWorkloadScenarioProfileMetadata,
  type SuperAppWorkloadScenarioProfileMetadata,
} from './workload-scenario-profiles.js';

export type {
  SuperAppWorkloadCatalog,
  WorkloadAdminOperation,
  WorkloadAppId,
  WorkloadBudget,
  WorkloadCatalogHelperMetadata,
  WorkloadConsistencyModel,
  WorkloadDataClass,
  WorkloadDomain,
  WorkloadDomainId,
  WorkloadEntityScale,
  WorkloadHttpMethod,
  WorkloadMutationProfile,
  WorkloadPilotModuleId,
  WorkloadRisk,
  WorkloadRole,
  WorkloadRoleId,
  WorkloadScenario,
  WorkloadScenarioId,
  WorkloadScenarioOperation,
  WorkloadTenant,
  WorkloadTenantId,
  WorkloadUser,
  WorkloadUserId,
} from './workload-domain-catalog.js';
export {
  createSuperAppWorkloadCatalog,
  getWorkloadDomain,
  getWorkloadDomainsForTenant,
  getWorkloadScenario,
  SUPERAPP_WORKLOAD_CATALOG,
  SUPERAPP_WORKLOAD_DOMAIN_IDS,
  SUPERAPP_WORKLOAD_SCENARIO_IDS,
  SUPERAPP_WORKLOAD_TENANT_IDS,
} from './workload-domain-catalog.js';
export type {
  GeneratedTenantWorkloadSummary,
  GeneratedWorkloadEntity,
  GeneratedWorkloadEntityCounts,
  GeneratedWorkloadHelperIds,
  GeneratedWorkloadHighWatermark,
  GeneratedWorkloadRecord,
  GeneratedWorkloadSamples,
  GeneratedWorkloadSampleWindow,
  SuperAppGeneratedWorkloadContract,
  SuperAppGeneratedWorkloadDataset,
  SuperAppGeneratedWorkloadMetadata,
} from './workload-generated-data.js';
export {
  createSuperAppGeneratedWorkloadContract,
  createSuperAppGeneratedWorkloadDataset,
  GENERATED_WORKLOAD_ENTITIES,
  SUPERAPP_GENERATED_WORKLOAD_TENANT_PROFILES,
} from './workload-generated-data.js';
export type {
  SuperAppWorkloadResetSeedMetadata,
  WorkloadResetSeedInput,
  WorkloadResetSeedTarget,
  WorkloadSeedDescriptor,
} from './workload-reset-seed.js';
export {
  createSuperAppWorkloadResetSeedMetadata,
  createSuperAppWorkloadSeed,
} from './workload-reset-seed.js';
export type {
  SuperAppWorkloadScenarioProfileContract,
  SuperAppWorkloadScenarioProfileMetadata,
  WorkloadScenarioConsumerTarget,
  WorkloadScenarioExpectedBudgets,
  WorkloadScenarioOperationKind,
  WorkloadScenarioOperationMix,
  WorkloadScenarioProfile,
  WorkloadScenarioProfileCategory,
  WorkloadScenarioProfileHelperMetadata,
  WorkloadScenarioProfileId,
  WorkloadScenarioSampleSelector,
  WorkloadScenarioSelectedRecords,
  WorkloadScenarioStep,
  WorkloadTenantBoundaryProbe,
} from './workload-scenario-profiles.js';
export {
  createSuperAppWorkloadScenarioProfileContract,
  createSuperAppWorkloadScenarioProfileMetadata,
  getWorkloadScenarioProfile,
  getWorkloadScenarioProfilesByCategory,
  getWorkloadTenantBoundaryProbes,
  SUPERAPP_WORKLOAD_SCENARIO_PROFILE_CATEGORIES,
  SUPERAPP_WORKLOAD_SCENARIO_PROFILE_IDS,
  SUPERAPP_WORKLOAD_SCENARIO_PROFILES,
  selectWorkloadScenarioSampleRecords,
  selectWorkloadScenarioSampleWindows,
} from './workload-scenario-profiles.js';

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

export type PilotScenarioPlan = {
  scenario: PilotScenario;
  label: string;
  tenant: string;
  region: string;
  modules: PilotModuleId[];
  routeTransitions: string[];
  workflows: string[];
  invariants: string[];
  chaosModes: PilotChaosMode[];
};

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
  scenarioLabel: string;
  tenant: string;
  actor: string;
  status: 'accepted' | 'deduped';
  chaos: PilotChaosMode;
  moduleResults: PilotModuleResult[];
  productionChecks: string[];
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
  pilotScenarios: PilotScenarioPlan[];
  workloadCatalog: SuperAppWorkloadCatalog;
  workloadData: SuperAppGeneratedWorkloadContract;
  workloadScenarioProfileMetadata: SuperAppWorkloadScenarioProfileMetadata;
  workloadResetSeedMetadata: SuperAppWorkloadResetSeedMetadata;
  events: WorkflowEvent[];
  pilotRuns: PilotRun[];
  failureMode: 'healthy' | 'remote-down' | 'api-timeout' | 'chunk-404';
  tenantAccess: Record<string, PortfolioAppId[]>;
};

export function createInitialPortfolioState(): PortfolioState {
  const workloadCatalog = createSuperAppWorkloadCatalog();
  const workloadData = createSuperAppGeneratedWorkloadContract(workloadCatalog);
  const workloadScenarioProfileMetadata =
    createSuperAppWorkloadScenarioProfileMetadata();
  const workloadResetSeedMetadata = createSuperAppWorkloadResetSeedMetadata({
    workloadCatalog,
    workloadData,
    workloadScenarioProfileMetadata,
  });

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
    pilotScenarios: createPilotScenarioPlans(),
    workloadCatalog,
    workloadData,
    workloadScenarioProfileMetadata,
    workloadResetSeedMetadata,
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

function createPilotScenarioPlans(): PilotScenarioPlan[] {
  return [
    {
      scenario: 'grab-marketplace',
      label: 'Grab-style Marketplace Surge',
      tenant: 'superapp-global',
      region: 'APAC+EMEA',
      modules: [
        'rides',
        'dispatch',
        'orders',
        'erp',
        'chat',
        'mf-remotes',
        'security',
        'billing',
      ],
      routeTransitions: [
        '/mobility',
        '/mobility/dispatch',
        '/mf-platform/chat',
        '/security/audit',
      ],
      workflows: [
        'price quote idempotency under burst traffic',
        'driver dispatch retry after cancellation',
        'marketplace order handoff into ERP ledger',
        'support chat escalation with billing adjustment',
        'remote module fallback during marketplace shell load',
      ],
      invariants: [
        'quote request id remains idempotent across retries',
        'dispatch and order events stay tenant-scoped',
        'billing approval is recorded before settlement',
        'support chat remains available during remote degradation',
      ],
      chaosModes: [
        'none',
        'remote-down',
        'api-timeout',
        'chunk-404',
        'clock-skew',
        'restart-during-load',
      ],
    },
    {
      scenario: 'mega-erp-command-center',
      label: 'Enterprise MegaERP Command Center',
      tenant: 'superapp-global',
      region: 'GLOBAL',
      modules: ['orders', 'erp', 'chat', 'mf-remotes', 'security', 'billing'],
      routeTransitions: [
        '/mega-erp',
        '/mega-erp/procurement',
        '/mega-erp/payroll',
        '/security/roles',
      ],
      workflows: [
        'bulk approval with partial failure visibility',
        'large ledger filter and pagination churn',
        'procurement exception routed to finance chat',
        'payroll and AP billing guardrail check',
        'micro-frontend finance widget degradation',
      ],
      invariants: [
        'bulk approval count matches emitted workflow events',
        'ERP timeout marks only ERP module as degraded',
        'security probe remains mandatory for privileged action',
        'billing clock skew cannot bypass approval accounting',
      ],
      chaosModes: [
        'none',
        'remote-down',
        'api-timeout',
        'chunk-404',
        'clock-skew',
        'restart-during-load',
      ],
    },
    {
      scenario: 'mobility-erp-chat',
      label: 'Mobility Incident To ERP Chat Escalation',
      tenant: 'superapp-global',
      region: 'EMEA',
      modules: ['rides', 'dispatch', 'erp', 'chat', 'security', 'billing'],
      routeTransitions: [
        '/mobility/support',
        '/mobility/dispatch',
        '/mega-erp/procurement',
        '/security/audit',
      ],
      workflows: [
        'ride incident creates support thread',
        'driver dispatch state is reconciled with ERP case',
        'operator chat keeps context across route churn',
        'refund billing path requires security check',
      ],
      invariants: [
        'support thread and ERP case share request lineage',
        'dispatch retry does not duplicate billing approval',
        'tenant security audit is emitted for refund mutation',
        'chat remains operational while ERP is degraded',
      ],
      chaosModes: [
        'none',
        'remote-down',
        'api-timeout',
        'chunk-404',
        'clock-skew',
        'restart-during-load',
      ],
    },
  ];
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
