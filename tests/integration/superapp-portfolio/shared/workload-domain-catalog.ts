export type WorkloadAppId =
  | 'mobility-marketplace'
  | 'enterprise-mega-erp'
  | 'mf-platform'
  | 'tenant-security'
  | 'failure-lab';

export type WorkloadTenantId =
  | 'superapp-global'
  | 'city-ops-eu'
  | 'acme-global'
  | 'platform-shell'
  | 'security-root'
  | 'chaos-lab';

export type WorkloadRoleId =
  | 'superapp-operator'
  | 'mobility-operator'
  | 'fleet-dispatcher'
  | 'marketplace-manager'
  | 'erp-operator'
  | 'finance-approver'
  | 'support-lead'
  | 'platform-operator'
  | 'security-admin'
  | 'failure-operator';

export type WorkloadUserId =
  | 'ops.commander'
  | 'marketplace.manager'
  | 'dispatch.lead'
  | 'fleet.dispatcher'
  | 'finance.approver'
  | 'support.lead'
  | 'platform.operator'
  | 'security.admin'
  | 'chaos.operator';

export type WorkloadDomainId =
  | 'erp-finance'
  | 'dispatch-mobility'
  | 'marketplace-orders'
  | 'fleet-mobility'
  | 'chat-threads'
  | 'audit-events'
  | 'users-roles'
  | 'admin-operations';

export type WorkloadScenarioId =
  | 'marketplace-surge-to-ledger'
  | 'fleet-incident-refund'
  | 'erp-close-admin-rotation'
  | 'tenant-boundary-audit';

export type WorkloadPilotModuleId =
  | 'rides'
  | 'dispatch'
  | 'orders'
  | 'erp'
  | 'chat'
  | 'mf-remotes'
  | 'security'
  | 'billing';

export type WorkloadDataClass =
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted';

export type WorkloadConsistencyModel =
  | 'strong'
  | 'read-your-writes'
  | 'eventual'
  | 'append-only';

export type WorkloadRisk = 'low' | 'medium' | 'high';
export type WorkloadHttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type WorkloadTenant = {
  id: WorkloadTenantId;
  label: string;
  region: string;
  dataResidency: string;
  appIds: WorkloadAppId[];
  baselineUsers: number;
  featureFlags: string[];
  primaryRoles: WorkloadRoleId[];
};

export type WorkloadRole = {
  id: WorkloadRoleId;
  label: string;
  tenantIds: WorkloadTenantId[];
  permissions: string[];
  mutationScopes: WorkloadDomainId[];
  privileged: boolean;
};

export type WorkloadUser = {
  id: WorkloadUserId;
  displayName: string;
  tenantId: WorkloadTenantId;
  roleId: WorkloadRoleId;
  homeRegion: string;
  appIds: WorkloadAppId[];
  requestActor: string;
  workloadWeight: number;
};

export type WorkloadEntityScale = {
  entity: string;
  perTenant: number;
  highWatermark: number;
  hotPartitionKey: string;
  cadence: string;
};

export type WorkloadBudget = {
  p95Ms: number;
  maxMs: number;
  concurrency: number;
  recordsTouched: number;
};

export type WorkloadMutationProfile = {
  readsPerWrite: number;
  idempotentWrites: boolean;
  crossTenantWrites: boolean;
  retryableActions: string[];
};

export type WorkloadDomain = {
  id: WorkloadDomainId;
  label: string;
  ownerAppId: WorkloadAppId;
  tenantIds: WorkloadTenantId[];
  modules: WorkloadPilotModuleId[];
  routes: string[];
  seedEntities: string[];
  workflows: string[];
  invariants: string[];
  eventKinds: string[];
  dataClasses: WorkloadDataClass[];
  consistency: WorkloadConsistencyModel;
  scale: WorkloadEntityScale[];
  mutationProfile: WorkloadMutationProfile;
  budgets: {
    browser: WorkloadBudget;
    contract: WorkloadBudget;
    load: WorkloadBudget;
    chaos: WorkloadBudget;
  };
};

export type WorkloadScenarioOperation = {
  id: string;
  domainId: WorkloadDomainId;
  personaId: WorkloadUserId;
  action: string;
  route: string;
  method: WorkloadHttpMethod;
  requestId: string;
  idempotencyKey: string;
  expectedEventKind: string;
  weight: number;
  producesAuditEvent: boolean;
};

export type WorkloadScenario = {
  id: WorkloadScenarioId;
  label: string;
  tenantId: WorkloadTenantId;
  region: string;
  domains: WorkloadDomainId[];
  modules: WorkloadPilotModuleId[];
  routes: string[];
  personas: WorkloadUserId[];
  operations: WorkloadScenarioOperation[];
  invariants: string[];
  chaosTargets: WorkloadDomainId[];
};

export type WorkloadAdminOperation = {
  id: string;
  label: string;
  tenantId: WorkloadTenantId;
  personaId: WorkloadUserId;
  targetDomainIds: WorkloadDomainId[];
  route: string;
  mutation: boolean;
  auditEventKind: string;
  risk: WorkloadRisk;
  expectedControls: string[];
  rollbackExpected: boolean;
  invariants: string[];
};

export type WorkloadCatalogHelperMetadata = {
  domainIds: WorkloadDomainId[];
  tenantIds: WorkloadTenantId[];
  scenarioIds: WorkloadScenarioId[];
  actorIds: WorkloadUserId[];
  routeTestIds: string[];
  recommendedProfiles: {
    smokeScenarioIds: WorkloadScenarioId[];
    loadScenarioIds: WorkloadScenarioId[];
    chaosScenarioIds: WorkloadScenarioId[];
    browserScenarioIds: WorkloadScenarioId[];
    contractScenarioIds: WorkloadScenarioId[];
  };
};

export type SuperAppWorkloadCatalog = {
  catalogVersion: 'superapp-workload-data-v1';
  seed: 'superapp-portfolio-workload-data-v1';
  clockStartIso: '2026-01-15T08:00:00.000Z';
  requestIdPrefix: 'swl-v1';
  tenants: WorkloadTenant[];
  roles: WorkloadRole[];
  users: WorkloadUser[];
  domains: WorkloadDomain[];
  scenarios: WorkloadScenario[];
  adminOperations: WorkloadAdminOperation[];
  helperMetadata: WorkloadCatalogHelperMetadata;
};

type BudgetTuple = [
  p95Ms: number,
  maxMs: number,
  concurrency: number,
  records: number,
];

export const SUPERAPP_WORKLOAD_DOMAIN_IDS: WorkloadDomainId[] = [
  'erp-finance',
  'dispatch-mobility',
  'marketplace-orders',
  'fleet-mobility',
  'chat-threads',
  'audit-events',
  'users-roles',
  'admin-operations',
];

export const SUPERAPP_WORKLOAD_TENANT_IDS: WorkloadTenantId[] = [
  'superapp-global',
  'city-ops-eu',
  'acme-global',
  'platform-shell',
  'security-root',
  'chaos-lab',
];

export const SUPERAPP_WORKLOAD_SCENARIO_IDS: WorkloadScenarioId[] = [
  'marketplace-surge-to-ledger',
  'fleet-incident-refund',
  'erp-close-admin-rotation',
  'tenant-boundary-audit',
];

const ACTOR_IDS: WorkloadUserId[] = [
  'ops.commander',
  'marketplace.manager',
  'dispatch.lead',
  'fleet.dispatcher',
  'finance.approver',
  'support.lead',
  'platform.operator',
  'security.admin',
  'chaos.operator',
];

function toBudget([
  p95Ms,
  maxMs,
  concurrency,
  recordsTouched,
]: BudgetTuple): WorkloadBudget {
  return {
    p95Ms,
    maxMs,
    concurrency,
    recordsTouched,
  };
}

function budgets(
  browser: BudgetTuple,
  contract: BudgetTuple,
  load: BudgetTuple,
  chaos: BudgetTuple,
): WorkloadDomain['budgets'] {
  return {
    browser: toBudget(browser),
    contract: toBudget(contract),
    load: toBudget(load),
    chaos: toBudget(chaos),
  };
}

function scale(
  entity: string,
  perTenant: number,
  highWatermark: number,
  hotPartitionKey: string,
  cadence: string,
): WorkloadEntityScale {
  return {
    entity,
    perTenant,
    highWatermark,
    hotPartitionKey,
    cadence,
  };
}

function mutationProfile(input: {
  readsPerWrite: number;
  idempotentWrites: boolean;
  retryableActions: string[];
}): WorkloadMutationProfile {
  return {
    ...input,
    crossTenantWrites: false,
  };
}

function operation(input: Omit<WorkloadScenarioOperation, 'idempotencyKey'>) {
  return {
    ...input,
    idempotencyKey: `idem-${input.requestId.slice('swl-v1-'.length)}`,
  };
}

const tenants: WorkloadTenant[] = [
  {
    id: 'superapp-global',
    label: 'SuperApp Global Operator',
    region: 'GLOBAL',
    dataResidency: 'multi-region',
    appIds: [
      'mobility-marketplace',
      'enterprise-mega-erp',
      'mf-platform',
      'tenant-security',
      'failure-lab',
    ],
    baselineUsers: 2400,
    featureFlags: [
      'cross-app-command-center',
      'global-ledger-close',
      'remote-module-fallbacks',
    ],
    primaryRoles: [
      'superapp-operator',
      'finance-approver',
      'support-lead',
      'security-admin',
    ],
  },
  {
    id: 'city-ops-eu',
    label: 'City Operations Europe',
    region: 'EMEA',
    dataResidency: 'eu-central',
    appIds: ['mobility-marketplace'],
    baselineUsers: 920,
    featureFlags: [
      'driver-dispatch-v2',
      'fleet-telemetry-window',
      'support-chat-escalation',
    ],
    primaryRoles: ['mobility-operator', 'fleet-dispatcher', 'support-lead'],
  },
  {
    id: 'acme-global',
    label: 'Acme Global ERP',
    region: 'GLOBAL',
    dataResidency: 'us-eu-ledger-split',
    appIds: ['enterprise-mega-erp'],
    baselineUsers: 680,
    featureFlags: [
      'bulk-approval-workbench',
      'ledger-reconciliation',
      'payroll-guardrails',
    ],
    primaryRoles: ['erp-operator', 'finance-approver'],
  },
  {
    id: 'platform-shell',
    label: 'Platform Shell Operations',
    region: 'MULTI',
    dataResidency: 'control-plane',
    appIds: ['mf-platform'],
    baselineUsers: 120,
    featureFlags: [
      'manifest-skew-detector',
      'shared-singleton-audit',
      'remote-health-probes',
    ],
    primaryRoles: ['platform-operator'],
  },
  {
    id: 'security-root',
    label: 'Security Root Console',
    region: 'US',
    dataResidency: 'us-restricted',
    appIds: ['tenant-security'],
    baselineUsers: 46,
    featureFlags: [
      'tenant-isolation-audit',
      'csrf-enforcement',
      'redaction-telemetry',
    ],
    primaryRoles: ['security-admin'],
  },
  {
    id: 'chaos-lab',
    label: 'Failure Lab Tenant',
    region: 'LOCAL',
    dataResidency: 'ephemeral-local',
    appIds: ['failure-lab'],
    baselineUsers: 18,
    featureFlags: [
      'api-timeout-drills',
      'chunk-404-drills',
      'restart-during-load-drills',
    ],
    primaryRoles: ['failure-operator'],
  },
];

const roles: WorkloadRole[] = [
  {
    id: 'superapp-operator',
    label: 'SuperApp Operator',
    tenantIds: ['superapp-global'],
    permissions: ['pilot:run', 'workflow:read', 'workflow:write'],
    mutationScopes: ['dispatch-mobility', 'marketplace-orders', 'chat-threads'],
    privileged: true,
  },
  {
    id: 'mobility-operator',
    label: 'Mobility Operator',
    tenantIds: ['city-ops-eu', 'superapp-global'],
    permissions: ['ride:quote', 'dispatch:assign', 'incident:open'],
    mutationScopes: ['dispatch-mobility', 'chat-threads'],
    privileged: false,
  },
  {
    id: 'fleet-dispatcher',
    label: 'Fleet Dispatcher',
    tenantIds: ['city-ops-eu', 'superapp-global'],
    permissions: ['vehicle:read', 'driver-shift:write', 'maintenance:escalate'],
    mutationScopes: ['fleet-mobility', 'dispatch-mobility'],
    privileged: false,
  },
  {
    id: 'marketplace-manager',
    label: 'Marketplace Manager',
    tenantIds: ['city-ops-eu', 'superapp-global'],
    permissions: ['order:read', 'order:adjust', 'merchant:escalate'],
    mutationScopes: ['marketplace-orders', 'chat-threads'],
    privileged: false,
  },
  {
    id: 'erp-operator',
    label: 'ERP Operator',
    tenantIds: ['acme-global', 'superapp-global'],
    permissions: ['ledger:read', 'procurement:write', 'payroll:read'],
    mutationScopes: ['erp-finance'],
    privileged: false,
  },
  {
    id: 'finance-approver',
    label: 'Finance Approver',
    tenantIds: ['acme-global', 'superapp-global'],
    permissions: ['ledger:approve', 'settlement:reconcile', 'refund:approve'],
    mutationScopes: ['erp-finance', 'marketplace-orders'],
    privileged: true,
  },
  {
    id: 'support-lead',
    label: 'Support Lead',
    tenantIds: ['city-ops-eu', 'superapp-global'],
    permissions: ['thread:read', 'thread:write', 'refund:request'],
    mutationScopes: ['chat-threads', 'marketplace-orders'],
    privileged: false,
  },
  {
    id: 'platform-operator',
    label: 'Platform Operator',
    tenantIds: ['platform-shell', 'superapp-global'],
    permissions: ['manifest:read', 'manifest:rotate', 'remote:fallback-toggle'],
    mutationScopes: ['admin-operations'],
    privileged: true,
  },
  {
    id: 'security-admin',
    label: 'Security Admin',
    tenantIds: ['security-root', 'superapp-global'],
    permissions: [
      'role:grant',
      'role:revoke',
      'audit:read',
      'token:quarantine',
    ],
    mutationScopes: ['users-roles', 'audit-events', 'admin-operations'],
    privileged: true,
  },
  {
    id: 'failure-operator',
    label: 'Failure Operator',
    tenantIds: ['chaos-lab', 'superapp-global'],
    permissions: ['failure:inject', 'failure:reset', 'drill:observe'],
    mutationScopes: ['admin-operations', 'audit-events'],
    privileged: true,
  },
];

const users: WorkloadUser[] = [
  [
    'ops.commander',
    'Operations Commander',
    'superapp-global',
    'superapp-operator',
    'GLOBAL',
    24,
  ],
  [
    'marketplace.manager',
    'Marketplace Manager',
    'city-ops-eu',
    'marketplace-manager',
    'EMEA',
    16,
  ],
  [
    'dispatch.lead',
    'Dispatch Lead',
    'city-ops-eu',
    'mobility-operator',
    'EMEA',
    18,
  ],
  [
    'fleet.dispatcher',
    'Fleet Dispatcher',
    'city-ops-eu',
    'fleet-dispatcher',
    'EMEA',
    14,
  ],
  [
    'finance.approver',
    'Finance Approver',
    'acme-global',
    'finance-approver',
    'US',
    12,
  ],
  [
    'support.lead',
    'Support Lead',
    'superapp-global',
    'support-lead',
    'EMEA',
    10,
  ],
  [
    'platform.operator',
    'Platform Operator',
    'platform-shell',
    'platform-operator',
    'MULTI',
    6,
  ],
  [
    'security.admin',
    'Security Admin',
    'security-root',
    'security-admin',
    'US',
    8,
  ],
  [
    'chaos.operator',
    'Chaos Operator',
    'chaos-lab',
    'failure-operator',
    'LOCAL',
    4,
  ],
].map(([id, displayName, tenantId, roleId, homeRegion, workloadWeight]) => {
  const tenant = tenants.find(item => item.id === tenantId);
  return {
    id: id as WorkloadUserId,
    displayName: displayName as string,
    tenantId: tenantId as WorkloadTenantId,
    roleId: roleId as WorkloadRoleId,
    homeRegion: homeRegion as string,
    appIds: tenant?.appIds ?? [],
    requestActor: id as string,
    workloadWeight: workloadWeight as number,
  };
});

const domains: WorkloadDomain[] = [
  {
    id: 'erp-finance',
    label: 'ERP Finance',
    ownerAppId: 'enterprise-mega-erp',
    tenantIds: ['superapp-global', 'acme-global'],
    modules: ['orders', 'erp', 'billing'],
    routes: ['/mega-erp', '/mega-erp/procurement', '/mega-erp/payroll'],
    seedEntities: [
      'gl-ledger',
      'ap-invoice',
      'settlement-batch',
      'payroll-run',
      'tax-jurisdiction',
    ],
    workflows: [
      'bulk approval with partial failure visibility',
      'marketplace settlement reconciliation',
      'refund approval before payout capture',
    ],
    invariants: [
      'ledger postings remain balanced by tenant and currency',
      'approval count matches emitted finance audit events',
      'clock skew cannot bypass settlement approval',
    ],
    eventKinds: [
      'ledger.posted',
      'approval.granted',
      'settlement.reconciled',
      'refund.approved',
    ],
    dataClasses: ['confidential', 'restricted'],
    consistency: 'strong',
    scale: [
      scale(
        'ledger-entry',
        18000,
        500000,
        'tenantId:fiscalPeriod',
        'month-close',
      ),
    ],
    mutationProfile: mutationProfile({
      readsPerWrite: 7,
      idempotentWrites: true,
      retryableActions: ['bulk-approve', 'settlement-reconcile'],
    }),
    budgets: budgets(
      [900, 2500, 4, 120],
      [450, 1200, 8, 60],
      [1500, 5000, 48, 900],
      [2200, 8000, 24, 400],
    ),
  },
  {
    id: 'dispatch-mobility',
    label: 'Dispatch Mobility',
    ownerAppId: 'mobility-marketplace',
    tenantIds: ['superapp-global', 'city-ops-eu'],
    modules: ['rides', 'dispatch'],
    routes: ['/mobility', '/mobility/dispatch'],
    seedEntities: [
      'ride-quote',
      'dispatch-assignment',
      'driver-location',
      'cancellation-token',
      'surge-zone',
    ],
    workflows: [
      'price quote idempotency under burst traffic',
      'driver dispatch retry after cancellation',
      'region reroute during driver shortage',
    ],
    invariants: [
      'quote request id remains idempotent across retries',
      'dispatch and order events stay tenant-scoped',
      'driver assignment cannot be duplicated within a shift window',
    ],
    eventKinds: [
      'quote.created',
      'dispatch.assigned',
      'dispatch.retried',
      'ride.cancelled',
    ],
    dataClasses: ['internal', 'confidential'],
    consistency: 'read-your-writes',
    scale: [
      scale('ride-quote', 42000, 250000, 'tenantId:regionId', 'rush-hour'),
    ],
    mutationProfile: mutationProfile({
      readsPerWrite: 12,
      idempotentWrites: true,
      retryableActions: ['quote', 'dispatch-retry', 'cancel'],
    }),
    budgets: budgets(
      [700, 1800, 6, 80],
      [350, 900, 12, 40],
      [1200, 4500, 96, 1200],
      [1800, 6000, 48, 620],
    ),
  },
  {
    id: 'marketplace-orders',
    label: 'Marketplace Orders',
    ownerAppId: 'mobility-marketplace',
    tenantIds: ['superapp-global', 'city-ops-eu'],
    modules: ['orders', 'billing'],
    routes: ['/mobility', '/mega-erp/procurement'],
    seedEntities: [
      'cart',
      'marketplace-order',
      'merchant-fulfillment',
      'payment-authorization',
      'refund-case',
    ],
    workflows: [
      'order checkout with payment authorization',
      'merchant fulfillment handoff into ERP ledger',
      'refund request linked to support escalation',
    ],
    invariants: [
      'order total equals payment authorization and ledger amount',
      'merchant fulfillment cannot settle before order capture',
      'refund request requires support thread lineage',
    ],
    eventKinds: [
      'order.created',
      'payment.authorized',
      'merchant.fulfilled',
      'refund.requested',
    ],
    dataClasses: ['confidential', 'restricted'],
    consistency: 'read-your-writes',
    scale: [
      scale(
        'marketplace-order',
        26000,
        180000,
        'tenantId:merchantId',
        'promotion-burst',
      ),
    ],
    mutationProfile: mutationProfile({
      readsPerWrite: 9,
      idempotentWrites: true,
      retryableActions: ['checkout', 'merchant-handoff', 'refund-request'],
    }),
    budgets: budgets(
      [800, 2200, 5, 90],
      [420, 1100, 10, 50],
      [1400, 4800, 72, 1000],
      [2100, 7000, 36, 520],
    ),
  },
  {
    id: 'fleet-mobility',
    label: 'Fleet Mobility',
    ownerAppId: 'mobility-marketplace',
    tenantIds: ['superapp-global', 'city-ops-eu'],
    modules: ['rides', 'dispatch'],
    routes: ['/mobility/dispatch'],
    seedEntities: [
      'vehicle',
      'driver-shift',
      'maintenance-ticket',
      'battery-snapshot',
      'geofence',
    ],
    workflows: [
      'driver shift start with vehicle assignment',
      'fleet maintenance escalation during dispatch',
      'telematics window refresh under route churn',
    ],
    invariants: [
      'vehicle cannot be assigned to overlapping active shifts',
      'maintenance hold prevents new dispatch assignment',
      'telemetry lag does not overwrite newer driver location',
    ],
    eventKinds: [
      'shift.started',
      'vehicle.assigned',
      'maintenance.escalated',
      'telemetry.ingested',
    ],
    dataClasses: ['internal', 'confidential'],
    consistency: 'eventual',
    scale: [
      scale('vehicle', 4200, 34000, 'tenantId:fleetZone', 'shift-change'),
    ],
    mutationProfile: mutationProfile({
      readsPerWrite: 18,
      idempotentWrites: false,
      retryableActions: ['shift-start', 'maintenance-escalate'],
    }),
    budgets: budgets(
      [850, 2400, 5, 160],
      [500, 1300, 8, 80],
      [1700, 5500, 64, 2200],
      [2400, 7800, 32, 900],
    ),
  },
  {
    id: 'chat-threads',
    label: 'Chat Threads',
    ownerAppId: 'mobility-marketplace',
    tenantIds: ['superapp-global', 'city-ops-eu', 'platform-shell'],
    modules: ['chat', 'mf-remotes'],
    routes: ['/mobility/support', '/mf-platform/chat'],
    seedEntities: [
      'support-thread',
      'thread-message',
      'operator-presence',
      'attachment-redaction',
      'case-link',
    ],
    workflows: [
      'support chat escalation with billing adjustment',
      'operator chat keeps context across route churn',
      'remote chat fallback during shell degradation',
    ],
    invariants: [
      'support thread and ERP case share request lineage',
      'chat remains available during remote degradation',
      'restricted attachment metadata is redacted from telemetry',
    ],
    eventKinds: [
      'thread.opened',
      'message.sent',
      'case.linked',
      'attachment.redacted',
    ],
    dataClasses: ['internal', 'confidential', 'restricted'],
    consistency: 'read-your-writes',
    scale: [
      scale(
        'support-thread',
        3800,
        44000,
        'tenantId:queueId',
        'incident-spike',
      ),
    ],
    mutationProfile: mutationProfile({
      readsPerWrite: 14,
      idempotentWrites: true,
      retryableActions: ['message-send', 'case-link', 'escalate'],
    }),
    budgets: budgets(
      [650, 1600, 8, 70],
      [320, 850, 12, 36],
      [1000, 3600, 80, 760],
      [1600, 5200, 44, 380],
    ),
  },
  {
    id: 'audit-events',
    label: 'Audit Events',
    ownerAppId: 'tenant-security',
    tenantIds: SUPERAPP_WORKLOAD_TENANT_IDS,
    modules: ['security'],
    routes: ['/security/audit'],
    seedEntities: [
      'audit-log',
      'immutable-event',
      'redaction-token',
      'request-lineage',
      'retention-policy',
    ],
    workflows: [
      'tenant security audit emitted for privileged mutation',
      'telemetry redaction scan for sensitive headers',
      'request id lineage across SuperApp route transitions',
    ],
    invariants: [
      'audit events are append-only and ordered by tenant clock',
      'raw authorization and csrf tokens never leave redaction boundary',
      'request lineage links browser, API, and domain events',
    ],
    eventKinds: [
      'audit.appended',
      'telemetry.redacted',
      'request.lineage-linked',
      'policy.evaluated',
    ],
    dataClasses: ['restricted'],
    consistency: 'append-only',
    scale: [
      scale('audit-event', 90000, 2600000, 'tenantId:eventDay', 'continuous'),
    ],
    mutationProfile: mutationProfile({
      readsPerWrite: 4,
      idempotentWrites: true,
      retryableActions: ['append-audit', 'link-lineage'],
    }),
    budgets: budgets(
      [600, 1500, 4, 140],
      [300, 750, 16, 80],
      [900, 3200, 120, 1800],
      [1400, 4800, 80, 1000],
    ),
  },
  {
    id: 'users-roles',
    label: 'Users And Roles',
    ownerAppId: 'tenant-security',
    tenantIds: SUPERAPP_WORKLOAD_TENANT_IDS,
    modules: ['security'],
    routes: ['/security/roles'],
    seedEntities: [
      'user',
      'role',
      'permission',
      'tenant-membership',
      'csrf-token',
    ],
    workflows: [
      'role grant with tenant isolation check',
      'role revoke invalidates cached command permissions',
      'csrf mutation token validation for privileged action',
    ],
    invariants: [
      'role grant never expands app access outside tenant boundary',
      'security probe remains mandatory for privileged action',
      'cached permissions are scoped by tenant and request id',
    ],
    eventKinds: [
      'role.granted',
      'role.revoked',
      'permission.evaluated',
      'csrf.validated',
    ],
    dataClasses: ['restricted'],
    consistency: 'strong',
    scale: [
      scale('user-membership', 2400, 120000, 'tenantId:roleId', 'admin-hours'),
    ],
    mutationProfile: mutationProfile({
      readsPerWrite: 20,
      idempotentWrites: true,
      retryableActions: ['role-grant', 'role-revoke', 'csrf-validate'],
    }),
    budgets: budgets(
      [750, 1900, 3, 110],
      [350, 900, 12, 60],
      [1100, 4200, 40, 520],
      [1700, 5600, 24, 300],
    ),
  },
  {
    id: 'admin-operations',
    label: 'Admin Operations',
    ownerAppId: 'tenant-security',
    tenantIds: [
      'superapp-global',
      'platform-shell',
      'security-root',
      'chaos-lab',
    ],
    modules: ['mf-remotes', 'security'],
    routes: ['/security/roles', '/failure-lab', '/failure-lab/remotes'],
    seedEntities: [
      'feature-flag',
      'remote-manifest',
      'tenant-config',
      'api-token',
      'drill-schedule',
    ],
    workflows: [
      'remote manifest rotation with fallback probe',
      'tenant api token quarantine',
      'failure drill enable and recovery reset',
    ],
    invariants: [
      'admin mutation emits privileged audit event',
      'rollback path is defined for high-risk operation',
      'remote fallback remains visible to platform shell',
    ],
    eventKinds: [
      'admin.operation-started',
      'manifest.rotated',
      'token.quarantined',
      'drill.reset',
    ],
    dataClasses: ['confidential', 'restricted'],
    consistency: 'strong',
    scale: [
      scale('remote-manifest', 36, 1200, 'tenantId:remoteName', 'deployment'),
    ],
    mutationProfile: mutationProfile({
      readsPerWrite: 15,
      idempotentWrites: true,
      retryableActions: ['manifest-rotate', 'token-quarantine', 'drill-reset'],
    }),
    budgets: budgets(
      [900, 2500, 2, 80],
      [400, 1000, 8, 40],
      [1300, 4800, 24, 260],
      [1900, 6500, 20, 180],
    ),
  },
];

const scenarios: WorkloadScenario[] = [
  {
    id: 'marketplace-surge-to-ledger',
    label: 'Marketplace Surge To Ledger',
    tenantId: 'superapp-global',
    region: 'APAC+EMEA',
    domains: [
      'dispatch-mobility',
      'marketplace-orders',
      'erp-finance',
      'chat-threads',
      'audit-events',
    ],
    modules: [
      'rides',
      'dispatch',
      'orders',
      'erp',
      'chat',
      'security',
      'billing',
    ],
    routes: [
      '/mobility',
      '/mobility/dispatch',
      '/mega-erp/procurement',
      '/security/audit',
    ],
    personas: [
      'ops.commander',
      'marketplace.manager',
      'finance.approver',
      'support.lead',
    ],
    operations: [
      operation({
        id: 'surge-quote',
        domainId: 'dispatch-mobility',
        personaId: 'ops.commander',
        action: 'quote-burst',
        route: '/mobility',
        method: 'POST',
        requestId: 'swl-v1-surge-quote-001',
        expectedEventKind: 'quote.created',
        weight: 30,
        producesAuditEvent: false,
      }),
      operation({
        id: 'surge-order',
        domainId: 'marketplace-orders',
        personaId: 'marketplace.manager',
        action: 'checkout-capture',
        route: '/mobility',
        method: 'POST',
        requestId: 'swl-v1-surge-order-001',
        expectedEventKind: 'order.created',
        weight: 24,
        producesAuditEvent: true,
      }),
      operation({
        id: 'surge-ledger',
        domainId: 'erp-finance',
        personaId: 'finance.approver',
        action: 'settlement-reconcile',
        route: '/mega-erp/procurement',
        method: 'PATCH',
        requestId: 'swl-v1-surge-ledger-001',
        expectedEventKind: 'settlement.reconciled',
        weight: 10,
        producesAuditEvent: true,
      }),
      operation({
        id: 'surge-support',
        domainId: 'chat-threads',
        personaId: 'support.lead',
        action: 'case-link',
        route: '/mobility/support',
        method: 'POST',
        requestId: 'swl-v1-surge-chat-001',
        expectedEventKind: 'case.linked',
        weight: 8,
        producesAuditEvent: true,
      }),
    ],
    invariants: [
      'marketplace order, ledger settlement, and support thread share request lineage',
      'duplicate quote and checkout retries produce deduped domain events',
      'finance approval is recorded before settlement visibility',
    ],
    chaosTargets: ['erp-finance', 'chat-threads', 'audit-events'],
  },
  {
    id: 'fleet-incident-refund',
    label: 'Fleet Incident Refund',
    tenantId: 'superapp-global',
    region: 'EMEA',
    domains: [
      'fleet-mobility',
      'dispatch-mobility',
      'chat-threads',
      'marketplace-orders',
      'erp-finance',
      'audit-events',
    ],
    modules: [
      'rides',
      'dispatch',
      'orders',
      'erp',
      'chat',
      'security',
      'billing',
    ],
    routes: [
      '/mobility/support',
      '/mobility/dispatch',
      '/mega-erp/procurement',
      '/security/audit',
    ],
    personas: [
      'dispatch.lead',
      'fleet.dispatcher',
      'support.lead',
      'finance.approver',
    ],
    operations: [
      operation({
        id: 'incident-shift-hold',
        domainId: 'fleet-mobility',
        personaId: 'fleet.dispatcher',
        action: 'maintenance-escalate',
        route: '/mobility/dispatch',
        method: 'POST',
        requestId: 'swl-v1-fleet-hold-001',
        expectedEventKind: 'maintenance.escalated',
        weight: 12,
        producesAuditEvent: true,
      }),
      operation({
        id: 'incident-dispatch-retry',
        domainId: 'dispatch-mobility',
        personaId: 'dispatch.lead',
        action: 'dispatch-retry',
        route: '/mobility/dispatch',
        method: 'PATCH',
        requestId: 'swl-v1-fleet-dispatch-001',
        expectedEventKind: 'dispatch.retried',
        weight: 18,
        producesAuditEvent: false,
      }),
      operation({
        id: 'incident-support-thread',
        domainId: 'chat-threads',
        personaId: 'support.lead',
        action: 'escalate',
        route: '/mobility/support',
        method: 'POST',
        requestId: 'swl-v1-fleet-chat-001',
        expectedEventKind: 'thread.opened',
        weight: 10,
        producesAuditEvent: true,
      }),
      operation({
        id: 'incident-refund-approval',
        domainId: 'erp-finance',
        personaId: 'finance.approver',
        action: 'refund-approve',
        route: '/mega-erp/procurement',
        method: 'PATCH',
        requestId: 'swl-v1-fleet-refund-001',
        expectedEventKind: 'refund.approved',
        weight: 6,
        producesAuditEvent: true,
      }),
    ],
    invariants: [
      'maintenance hold prevents duplicate dispatch assignment',
      'refund approval references the support thread and dispatch retry',
      'tenant audit event is emitted for every privileged refund mutation',
    ],
    chaosTargets: ['fleet-mobility', 'erp-finance', 'chat-threads'],
  },
  {
    id: 'erp-close-admin-rotation',
    label: 'ERP Close With Admin Rotation',
    tenantId: 'superapp-global',
    region: 'GLOBAL',
    domains: ['erp-finance', 'users-roles', 'admin-operations', 'audit-events'],
    modules: ['orders', 'erp', 'mf-remotes', 'security', 'billing'],
    routes: [
      '/mega-erp',
      '/mega-erp/payroll',
      '/security/roles',
      '/failure-lab/remotes',
    ],
    personas: [
      'finance.approver',
      'platform.operator',
      'security.admin',
      'ops.commander',
    ],
    operations: [
      operation({
        id: 'close-ledger-filter',
        domainId: 'erp-finance',
        personaId: 'finance.approver',
        action: 'month-close-filter',
        route: '/mega-erp',
        method: 'GET',
        requestId: 'swl-v1-close-filter-001',
        expectedEventKind: 'ledger.posted',
        weight: 14,
        producesAuditEvent: false,
      }),
      operation({
        id: 'close-role-grant',
        domainId: 'users-roles',
        personaId: 'security.admin',
        action: 'role-grant',
        route: '/security/roles',
        method: 'POST',
        requestId: 'swl-v1-close-role-001',
        expectedEventKind: 'role.granted',
        weight: 4,
        producesAuditEvent: true,
      }),
      operation({
        id: 'close-manifest-rotate',
        domainId: 'admin-operations',
        personaId: 'platform.operator',
        action: 'manifest-rotate',
        route: '/failure-lab/remotes',
        method: 'PATCH',
        requestId: 'swl-v1-close-manifest-001',
        expectedEventKind: 'manifest.rotated',
        weight: 3,
        producesAuditEvent: true,
      }),
    ],
    invariants: [
      'privileged role grant is visible in audit stream before ledger approval',
      'remote manifest rotation preserves finance widget fallback',
      'month-close workflow rejects stale permission cache entries',
    ],
    chaosTargets: ['erp-finance', 'admin-operations', 'audit-events'],
  },
  {
    id: 'tenant-boundary-audit',
    label: 'Tenant Boundary Audit',
    tenantId: 'security-root',
    region: 'US',
    domains: ['users-roles', 'audit-events', 'admin-operations'],
    modules: ['security', 'mf-remotes'],
    routes: ['/security', '/security/roles', '/security/audit'],
    personas: ['security.admin', 'ops.commander', 'chaos.operator'],
    operations: [
      operation({
        id: 'boundary-policy-evaluate',
        domainId: 'users-roles',
        personaId: 'security.admin',
        action: 'permission-evaluate',
        route: '/security/roles',
        method: 'POST',
        requestId: 'swl-v1-boundary-policy-001',
        expectedEventKind: 'permission.evaluated',
        weight: 12,
        producesAuditEvent: true,
      }),
      operation({
        id: 'boundary-audit-redaction',
        domainId: 'audit-events',
        personaId: 'security.admin',
        action: 'redaction-scan',
        route: '/security/audit',
        method: 'GET',
        requestId: 'swl-v1-boundary-audit-001',
        expectedEventKind: 'telemetry.redacted',
        weight: 10,
        producesAuditEvent: false,
      }),
      operation({
        id: 'boundary-token-quarantine',
        domainId: 'admin-operations',
        personaId: 'security.admin',
        action: 'token-quarantine',
        route: '/security/roles',
        method: 'PATCH',
        requestId: 'swl-v1-boundary-token-001',
        expectedEventKind: 'token.quarantined',
        weight: 4,
        producesAuditEvent: true,
      }),
    ],
    invariants: [
      'cross-tenant request never mutates state after policy rejection',
      'security telemetry redacts bearer and csrf material',
      'admin token quarantine emits append-only audit event',
    ],
    chaosTargets: ['users-roles', 'audit-events', 'admin-operations'],
  },
];

const adminOperations: WorkloadAdminOperation[] = [
  {
    id: 'admin-role-grant-support-lead',
    label: 'Grant Support Lead Role',
    tenantId: 'security-root',
    personaId: 'security.admin',
    targetDomainIds: ['users-roles', 'audit-events'],
    route: '/security/roles',
    mutation: true,
    auditEventKind: 'role.granted',
    risk: 'high',
    expectedControls: [
      'bearer-present',
      'csrf-token',
      'tenant-header-match',
      'privileged-role',
    ],
    rollbackExpected: true,
    invariants: [
      'grant is tenant-scoped',
      'audit event contains redacted actor context',
    ],
  },
  {
    id: 'admin-rotate-remote-manifest',
    label: 'Rotate Remote Manifest',
    tenantId: 'platform-shell',
    personaId: 'platform.operator',
    targetDomainIds: ['admin-operations', 'chat-threads'],
    route: '/failure-lab/remotes',
    mutation: true,
    auditEventKind: 'manifest.rotated',
    risk: 'medium',
    expectedControls: [
      'manifest-version-check',
      'fallback-probe',
      'audit-append',
    ],
    rollbackExpected: true,
    invariants: [
      'manifest rotation preserves shared singleton guard',
      'chat fallback stays routeable during remote skew',
    ],
  },
  {
    id: 'admin-token-quarantine',
    label: 'Quarantine Tenant API Token',
    tenantId: 'security-root',
    personaId: 'security.admin',
    targetDomainIds: ['admin-operations', 'audit-events'],
    route: '/security/audit',
    mutation: true,
    auditEventKind: 'token.quarantined',
    risk: 'high',
    expectedControls: ['bearer-present', 'privileged-role', 'redaction-scan'],
    rollbackExpected: false,
    invariants: [
      'quarantined token value never appears in telemetry',
      'request lineage links quarantine action to policy decision',
    ],
  },
  {
    id: 'admin-failure-drill-reset',
    label: 'Reset Failure Drill',
    tenantId: 'chaos-lab',
    personaId: 'chaos.operator',
    targetDomainIds: ['admin-operations', 'audit-events'],
    route: '/failure-lab',
    mutation: true,
    auditEventKind: 'drill.reset',
    risk: 'medium',
    expectedControls: ['drill-owner', 'recovery-budget', 'audit-append'],
    rollbackExpected: false,
    invariants: [
      'reset restores healthy failure mode',
      'drill reset does not remove prior audit events',
    ],
  },
];

export const SUPERAPP_WORKLOAD_CATALOG: SuperAppWorkloadCatalog = {
  catalogVersion: 'superapp-workload-data-v1',
  seed: 'superapp-portfolio-workload-data-v1',
  clockStartIso: '2026-01-15T08:00:00.000Z',
  requestIdPrefix: 'swl-v1',
  tenants,
  roles,
  users,
  domains,
  scenarios,
  adminOperations,
  helperMetadata: {
    domainIds: SUPERAPP_WORKLOAD_DOMAIN_IDS,
    tenantIds: SUPERAPP_WORKLOAD_TENANT_IDS,
    scenarioIds: SUPERAPP_WORKLOAD_SCENARIO_IDS,
    actorIds: ACTOR_IDS,
    routeTestIds: [
      'portfolio-ready',
      'pilot-command-center',
      'pilot-scenario-plan',
      'pilot-module-results',
      'app-route-kind',
      'workflow-event',
    ],
    recommendedProfiles: {
      smokeScenarioIds: ['marketplace-surge-to-ledger'],
      loadScenarioIds: ['marketplace-surge-to-ledger', 'fleet-incident-refund'],
      chaosScenarioIds: [
        'fleet-incident-refund',
        'erp-close-admin-rotation',
        'tenant-boundary-audit',
      ],
      browserScenarioIds: [
        'marketplace-surge-to-ledger',
        'tenant-boundary-audit',
      ],
      contractScenarioIds: SUPERAPP_WORKLOAD_SCENARIO_IDS,
    },
  },
};

export function createSuperAppWorkloadCatalog(): SuperAppWorkloadCatalog {
  return JSON.parse(
    JSON.stringify(SUPERAPP_WORKLOAD_CATALOG),
  ) as SuperAppWorkloadCatalog;
}

export function getWorkloadDomain(id: WorkloadDomainId) {
  return SUPERAPP_WORKLOAD_CATALOG.domains.find(domain => domain.id === id);
}

export function getWorkloadScenario(id: WorkloadScenarioId) {
  return SUPERAPP_WORKLOAD_CATALOG.scenarios.find(
    scenario => scenario.id === id,
  );
}

export function getWorkloadDomainsForTenant(tenantId: WorkloadTenantId) {
  return SUPERAPP_WORKLOAD_CATALOG.domains.filter(domain =>
    domain.tenantIds.includes(tenantId),
  );
}
