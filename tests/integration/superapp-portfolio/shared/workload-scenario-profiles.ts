// @effect-diagnostics strictBooleanExpressions:off
import {
  type WorkloadAppId,
  type WorkloadBudget,
  type WorkloadDomainId,
  type WorkloadHttpMethod,
  type WorkloadRoleId,
  type WorkloadScenarioId,
  type WorkloadTenantId,
  type WorkloadUserId,
} from './workload-domain-catalog.js';
import {
  type GeneratedWorkloadEntity,
  type GeneratedWorkloadRecord,
  type GeneratedWorkloadSampleWindow,
  type SuperAppGeneratedWorkloadContract,
} from './workload-generated-data.js';

export type WorkloadScenarioProfileCategory =
  | 'read-heavy'
  | 'write-heavy'
  | 'mixed'
  | 'search-filter-sort'
  | 'chat-pagination'
  | 'tenant-boundary';

export type WorkloadScenarioProfileId =
  | 'read-heavy-command-center'
  | 'write-heavy-order-ledger'
  | 'mixed-cross-app-journey'
  | 'search-filter-sort-ledger'
  | 'chat-pagination-history'
  | 'tenant-boundary-probes';

export type WorkloadScenarioConsumerTarget =
  | 'k6'
  | 'load'
  | 'chaos'
  | 'browser'
  | 'contract';

export type WorkloadScenarioOperationKind =
  | 'read'
  | 'write'
  | 'search-filter-sort'
  | 'paginate'
  | 'tenant-probe';

export type WorkloadScenarioOperationMix = {
  reads: number;
  writes: number;
  searchFilterSorts: number;
  paginations: number;
  tenantProbes: number;
};

export type WorkloadScenarioSampleSelector = {
  id: string;
  entity: GeneratedWorkloadEntity;
  tenantId: WorkloadTenantId;
  domainId: WorkloadDomainId;
  sampleWindowId: string;
  expectedRecordIds: string[];
};

export type WorkloadScenarioStep = {
  id: string;
  label: string;
  kind: WorkloadScenarioOperationKind;
  tenantId: WorkloadTenantId;
  domainId: WorkloadDomainId;
  personaId: WorkloadUserId;
  method: WorkloadHttpMethod;
  route: string;
  weight: number;
  sampleSelectorIds: string[];
  expectedEventKind: string;
  idempotent: boolean;
  mutatesData: boolean;
};

export type WorkloadTenantBoundaryProbe = {
  id: string;
  sourceTenantId: WorkloadTenantId;
  targetTenantId: WorkloadTenantId;
  targetAppId: WorkloadAppId;
  personaId: WorkloadUserId;
  roleId: WorkloadRoleId;
  action: string;
  mutation: false;
  expectedAllowed: boolean;
  expectedNoMutation: true;
  expectedFailedCheckIds: string[];
  sampleSelectorIds: string[];
};

export type WorkloadScenarioExpectedBudgets = {
  browser: WorkloadBudget;
  contract: WorkloadBudget;
  load: WorkloadBudget;
  chaos: WorkloadBudget;
};

export type WorkloadScenarioProfile = {
  id: WorkloadScenarioProfileId;
  category: WorkloadScenarioProfileCategory;
  label: string;
  description: string;
  tenantIds: WorkloadTenantId[];
  domainIds: WorkloadDomainId[];
  catalogScenarioIds: WorkloadScenarioId[];
  targets: WorkloadScenarioConsumerTarget[];
  operationMix: WorkloadScenarioOperationMix;
  budgets: WorkloadScenarioExpectedBudgets;
  mutationCapable: boolean;
  sampleWindowIds: string[];
  sampleSelectors: WorkloadScenarioSampleSelector[];
  steps: WorkloadScenarioStep[];
  tenantBoundaryProbes: WorkloadTenantBoundaryProbe[];
  invariants: string[];
};

export type WorkloadScenarioProfileCategoryCount = {
  category: WorkloadScenarioProfileCategory;
  count: number;
};

export type WorkloadScenarioProfileHelperMetadata = {
  profileCount: number;
  categoryCounts: WorkloadScenarioProfileCategoryCount[];
  sampleWindowIds: string[];
  tenantBoundaryProfileId: WorkloadScenarioProfileId;
  defaultProfileIds: {
    k6: WorkloadScenarioProfileId[];
    load: WorkloadScenarioProfileId[];
    chaos: WorkloadScenarioProfileId[];
    browser: WorkloadScenarioProfileId[];
    contract: WorkloadScenarioProfileId[];
  };
};

export type SuperAppWorkloadScenarioProfileContract = {
  profileVersion: 'superapp-workload-scenario-profiles-v1';
  seed: 'superapp-portfolio-scenario-profiles-v1';
  categories: WorkloadScenarioProfileCategory[];
  profileIds: WorkloadScenarioProfileId[];
  profiles: WorkloadScenarioProfile[];
  helperMetadata: WorkloadScenarioProfileHelperMetadata;
};

export type SuperAppWorkloadScenarioProfileMetadata = Omit<
  SuperAppWorkloadScenarioProfileContract,
  'profiles'
>;

export type WorkloadScenarioSelectedRecords = {
  selector: WorkloadScenarioSampleSelector;
  records: GeneratedWorkloadRecord[];
};

type BudgetTuple = [
  p95Ms: number,
  maxMs: number,
  concurrency: number,
  recordsTouched: number,
];

export const SUPERAPP_WORKLOAD_SCENARIO_PROFILE_CATEGORIES: WorkloadScenarioProfileCategory[] =
  [
    'read-heavy',
    'write-heavy',
    'mixed',
    'search-filter-sort',
    'chat-pagination',
    'tenant-boundary',
  ];

export const SUPERAPP_WORKLOAD_SCENARIO_PROFILE_IDS: WorkloadScenarioProfileId[] =
  [
    'read-heavy-command-center',
    'write-heavy-order-ledger',
    'mixed-cross-app-journey',
    'search-filter-sort-ledger',
    'chat-pagination-history',
    'tenant-boundary-probes',
  ];

function budget([
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
): WorkloadScenarioExpectedBudgets {
  return {
    browser: budget(browser),
    contract: budget(contract),
    load: budget(load),
    chaos: budget(chaos),
  };
}

function selector(
  input: WorkloadScenarioSampleSelector,
): WorkloadScenarioSampleSelector {
  return input;
}

function step(input: WorkloadScenarioStep): WorkloadScenarioStep {
  return input;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function profile(
  input: Omit<WorkloadScenarioProfile, 'mutationCapable' | 'sampleWindowIds'>,
): WorkloadScenarioProfile {
  return {
    ...input,
    mutationCapable: input.steps.some(item => item.mutatesData),
    sampleWindowIds: unique(
      input.sampleSelectors.map(item => item.sampleWindowId),
    ),
  };
}

const orderSurgeSelector = selector({
  id: 'orders-checkout-surge',
  entity: 'orders',
  tenantId: 'city-ops-eu',
  domainId: 'marketplace-orders',
  sampleWindowId: 'orders:city-ops-eu:checkout-surge',
  expectedRecordIds: ['ord-coe-01025', 'ord-coe-01026'],
});

const invoiceCloseSelector = selector({
  id: 'invoices-month-close',
  entity: 'invoices',
  tenantId: 'acme-global',
  domainId: 'erp-finance',
  sampleWindowId: 'invoices:acme-global:month-close',
  expectedRecordIds: ['inv-acm-00513', 'inv-acm-00514'],
});

const ledgerReconciliationSelector = selector({
  id: 'ledger-reconciliation',
  entity: 'ledgerEntries',
  tenantId: 'acme-global',
  domainId: 'erp-finance',
  sampleWindowId: 'ledgerEntries:acme-global:reconciliation',
  expectedRecordIds: ['led-acm-02049', 'led-acm-02050'],
});

const rideRushHourSelector = selector({
  id: 'rides-rush-hour',
  entity: 'rides',
  tenantId: 'city-ops-eu',
  domainId: 'dispatch-mobility',
  sampleWindowId: 'rides:city-ops-eu:rush-hour',
  expectedRecordIds: ['rid-coe-01501', 'rid-coe-01502'],
});

const dispatchRetrySelector = selector({
  id: 'dispatch-retry-window',
  entity: 'dispatchAssignments',
  tenantId: 'city-ops-eu',
  domainId: 'dispatch-mobility',
  sampleWindowId: 'dispatchAssignments:city-ops-eu:retry-window',
  expectedRecordIds: ['dsp-coe-01501', 'dsp-coe-01502'],
});

const fleetShiftSelector = selector({
  id: 'fleet-shift-change',
  entity: 'fleetVehicles',
  tenantId: 'city-ops-eu',
  domainId: 'fleet-mobility',
  sampleWindowId: 'fleetVehicles:city-ops-eu:shift-change',
  expectedRecordIds: ['veh-coe-00129', 'veh-coe-00130'],
});

const chatThreadSelector = selector({
  id: 'chat-remote-fallback',
  entity: 'chatThreads',
  tenantId: 'platform-shell',
  domainId: 'chat-threads',
  sampleWindowId: 'chatThreads:platform-shell:remote-fallback',
  expectedRecordIds: ['thd-psh-00065', 'thd-psh-00066'],
});

const messagePaginationSelector = selector({
  id: 'messages-pagination-window',
  entity: 'messages',
  tenantId: 'platform-shell',
  domainId: 'chat-threads',
  sampleWindowId: 'messages:platform-shell:pagination-window',
  expectedRecordIds: ['msg-psh-04097', 'msg-psh-04098'],
});

const auditPolicySelector = selector({
  id: 'audit-policy-stream',
  entity: 'auditEvents',
  tenantId: 'security-root',
  domainId: 'audit-events',
  sampleWindowId: 'auditEvents:security-root:policy-stream',
  expectedRecordIds: ['aud-sec-02049', 'aud-sec-02050'],
});

const operatorUserSelector = selector({
  id: 'users-operator-page',
  entity: 'users',
  tenantId: 'superapp-global',
  domainId: 'users-roles',
  sampleWindowId: 'users:superapp-global:operator-page',
  expectedRecordIds: ['usr-sgl-00129', 'usr-sgl-00130'],
});

const privilegedRoleSelector = selector({
  id: 'roles-privileged-page',
  entity: 'roles',
  tenantId: 'security-root',
  domainId: 'users-roles',
  sampleWindowId: 'roles:security-root:privileged-page',
  expectedRecordIds: ['rol-sec-00033', 'rol-sec-00034'],
});

const financeMembershipSelector = selector({
  id: 'memberships-finance-page',
  entity: 'memberships',
  tenantId: 'acme-global',
  domainId: 'users-roles',
  sampleWindowId: 'memberships:acme-global:finance-page',
  expectedRecordIds: ['mem-acm-00257', 'mem-acm-00258'],
});

const tenantResourceSelector = selector({
  id: 'tenant-resources-drill-page',
  entity: 'tenantResources',
  tenantId: 'chaos-lab',
  domainId: 'admin-operations',
  sampleWindowId: 'tenantResources:chaos-lab:drill-page',
  expectedRecordIds: ['res-cha-00081', 'res-cha-00082'],
});

export const SUPERAPP_WORKLOAD_SCENARIO_PROFILES: WorkloadScenarioProfile[] = [
  profile({
    id: 'read-heavy-command-center',
    category: 'read-heavy',
    label: 'Read Heavy Command Center',
    description:
      'High-cardinality dashboard reads across mobility, marketplace, fleet, and audit windows.',
    tenantIds: ['city-ops-eu', 'security-root'],
    domainIds: [
      'marketplace-orders',
      'dispatch-mobility',
      'fleet-mobility',
      'audit-events',
    ],
    catalogScenarioIds: ['marketplace-surge-to-ledger'],
    targets: ['k6', 'load', 'browser', 'contract'],
    operationMix: {
      reads: 86,
      writes: 4,
      searchFilterSorts: 6,
      paginations: 4,
      tenantProbes: 0,
    },
    budgets: budgets(
      [850, 2200, 6, 260],
      [420, 1100, 10, 120],
      [1250, 4500, 96, 1800],
      [1800, 6000, 48, 900],
    ),
    sampleSelectors: [
      orderSurgeSelector,
      rideRushHourSelector,
      dispatchRetrySelector,
      fleetShiftSelector,
      auditPolicySelector,
    ],
    steps: [
      step({
        id: 'read-orders-window',
        label: 'Read marketplace checkout surge window',
        kind: 'read',
        tenantId: 'city-ops-eu',
        domainId: 'marketplace-orders',
        personaId: 'marketplace.manager',
        method: 'GET',
        route: '/mobility?tab=orders',
        weight: 28,
        sampleSelectorIds: ['orders-checkout-surge'],
        expectedEventKind: 'order.created',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'read-dispatch-window',
        label: 'Read dispatch rush-hour retry window',
        kind: 'read',
        tenantId: 'city-ops-eu',
        domainId: 'dispatch-mobility',
        personaId: 'dispatch.lead',
        method: 'GET',
        route: '/mobility/dispatch',
        weight: 26,
        sampleSelectorIds: ['rides-rush-hour', 'dispatch-retry-window'],
        expectedEventKind: 'dispatch.retried',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'read-fleet-shift',
        label: 'Read fleet shift-change status',
        kind: 'read',
        tenantId: 'city-ops-eu',
        domainId: 'fleet-mobility',
        personaId: 'fleet.dispatcher',
        method: 'GET',
        route: '/mobility/dispatch?panel=fleet',
        weight: 22,
        sampleSelectorIds: ['fleet-shift-change'],
        expectedEventKind: 'vehicle.assigned',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'read-audit-tail',
        label: 'Read security audit tail for dashboard lineage',
        kind: 'read',
        tenantId: 'security-root',
        domainId: 'audit-events',
        personaId: 'security.admin',
        method: 'GET',
        route: '/security/audit?scope=city-ops-eu',
        weight: 24,
        sampleSelectorIds: ['audit-policy-stream'],
        expectedEventKind: 'audit.appended',
        idempotent: true,
        mutatesData: false,
      }),
    ],
    tenantBoundaryProbes: [],
    invariants: [
      'read paths do not emit mutation events',
      'dashboard partitions stay tenant-scoped',
      'audit tail reads preserve append-only ordering',
    ],
  }),
  profile({
    id: 'write-heavy-order-ledger',
    category: 'write-heavy',
    label: 'Write Heavy Order Ledger',
    description:
      'Idempotent checkout, invoice approval, ledger append, and chat write burst.',
    tenantIds: [
      'city-ops-eu',
      'acme-global',
      'platform-shell',
      'security-root',
    ],
    domainIds: [
      'marketplace-orders',
      'erp-finance',
      'chat-threads',
      'audit-events',
    ],
    catalogScenarioIds: [
      'marketplace-surge-to-ledger',
      'erp-close-admin-rotation',
    ],
    targets: ['k6', 'load', 'chaos', 'contract'],
    operationMix: {
      reads: 18,
      writes: 82,
      searchFilterSorts: 0,
      paginations: 0,
      tenantProbes: 0,
    },
    budgets: budgets(
      [950, 2600, 4, 140],
      [500, 1300, 8, 80],
      [1550, 5200, 72, 1200],
      [2300, 8000, 36, 620],
    ),
    sampleSelectors: [
      orderSurgeSelector,
      invoiceCloseSelector,
      ledgerReconciliationSelector,
      messagePaginationSelector,
      auditPolicySelector,
    ],
    steps: [
      step({
        id: 'write-order-capture',
        label: 'Capture marketplace checkout',
        kind: 'write',
        tenantId: 'city-ops-eu',
        domainId: 'marketplace-orders',
        personaId: 'marketplace.manager',
        method: 'POST',
        route: '/mobility',
        weight: 32,
        sampleSelectorIds: ['orders-checkout-surge'],
        expectedEventKind: 'order.created',
        idempotent: true,
        mutatesData: true,
      }),
      step({
        id: 'write-invoice-approval',
        label: 'Approve month-close invoice batch',
        kind: 'write',
        tenantId: 'acme-global',
        domainId: 'erp-finance',
        personaId: 'finance.approver',
        method: 'PATCH',
        route: '/mega-erp/procurement',
        weight: 28,
        sampleSelectorIds: ['invoices-month-close'],
        expectedEventKind: 'approval.granted',
        idempotent: true,
        mutatesData: true,
      }),
      step({
        id: 'write-ledger-reconcile',
        label: 'Reconcile ledger entries after checkout surge',
        kind: 'write',
        tenantId: 'acme-global',
        domainId: 'erp-finance',
        personaId: 'finance.approver',
        method: 'PATCH',
        route: '/mega-erp',
        weight: 18,
        sampleSelectorIds: ['ledger-reconciliation'],
        expectedEventKind: 'settlement.reconciled',
        idempotent: true,
        mutatesData: true,
      }),
      step({
        id: 'write-chat-message',
        label: 'Append support message during remote fallback',
        kind: 'write',
        tenantId: 'platform-shell',
        domainId: 'chat-threads',
        personaId: 'support.lead',
        method: 'POST',
        route: '/mf-platform/chat',
        weight: 12,
        sampleSelectorIds: ['messages-pagination-window'],
        expectedEventKind: 'message.sent',
        idempotent: true,
        mutatesData: true,
      }),
      step({
        id: 'read-write-audit-confirmation',
        label: 'Confirm privileged write audit trail',
        kind: 'read',
        tenantId: 'security-root',
        domainId: 'audit-events',
        personaId: 'security.admin',
        method: 'GET',
        route: '/security/audit?kind=approval.granted',
        weight: 10,
        sampleSelectorIds: ['audit-policy-stream'],
        expectedEventKind: 'audit.appended',
        idempotent: true,
        mutatesData: false,
      }),
    ],
    tenantBoundaryProbes: [],
    invariants: [
      'write retries preserve idempotency keys',
      'ledger updates remain balanced by tenant',
      'privileged writes emit audit confirmation reads',
    ],
  }),
  profile({
    id: 'mixed-cross-app-journey',
    category: 'mixed',
    label: 'Mixed Cross App Journey',
    description:
      'Balanced read/write journey spanning dispatch, marketplace, ERP, chat, and audit.',
    tenantIds: [
      'city-ops-eu',
      'acme-global',
      'platform-shell',
      'security-root',
    ],
    domainIds: [
      'dispatch-mobility',
      'marketplace-orders',
      'erp-finance',
      'chat-threads',
      'audit-events',
    ],
    catalogScenarioIds: [
      'marketplace-surge-to-ledger',
      'fleet-incident-refund',
    ],
    targets: ['k6', 'load', 'chaos', 'browser', 'contract'],
    operationMix: {
      reads: 46,
      writes: 34,
      searchFilterSorts: 10,
      paginations: 10,
      tenantProbes: 0,
    },
    budgets: budgets(
      [900, 2500, 6, 220],
      [460, 1200, 10, 120],
      [1450, 5000, 80, 1400],
      [2200, 7600, 40, 700],
    ),
    sampleSelectors: [
      rideRushHourSelector,
      orderSurgeSelector,
      invoiceCloseSelector,
      ledgerReconciliationSelector,
      chatThreadSelector,
      messagePaginationSelector,
      auditPolicySelector,
    ],
    steps: [
      step({
        id: 'mixed-quote-write',
        label: 'Create ride quote during marketplace flow',
        kind: 'write',
        tenantId: 'city-ops-eu',
        domainId: 'dispatch-mobility',
        personaId: 'dispatch.lead',
        method: 'POST',
        route: '/mobility',
        weight: 16,
        sampleSelectorIds: ['rides-rush-hour'],
        expectedEventKind: 'quote.created',
        idempotent: true,
        mutatesData: true,
      }),
      step({
        id: 'mixed-checkout-write',
        label: 'Capture order from quote context',
        kind: 'write',
        tenantId: 'city-ops-eu',
        domainId: 'marketplace-orders',
        personaId: 'marketplace.manager',
        method: 'POST',
        route: '/mobility',
        weight: 18,
        sampleSelectorIds: ['orders-checkout-surge'],
        expectedEventKind: 'order.created',
        idempotent: true,
        mutatesData: true,
      }),
      step({
        id: 'mixed-ledger-read',
        label: 'Read ledger reconciliation state',
        kind: 'read',
        tenantId: 'acme-global',
        domainId: 'erp-finance',
        personaId: 'finance.approver',
        method: 'GET',
        route: '/mega-erp',
        weight: 20,
        sampleSelectorIds: ['ledger-reconciliation'],
        expectedEventKind: 'ledger.posted',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'mixed-audit-search',
        label: 'Search audit lineage by request id',
        kind: 'search-filter-sort',
        tenantId: 'security-root',
        domainId: 'audit-events',
        personaId: 'security.admin',
        method: 'GET',
        route: '/security/audit?requestId=swl-v1-surge-order-001',
        weight: 14,
        sampleSelectorIds: ['audit-policy-stream'],
        expectedEventKind: 'request.lineage-linked',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'mixed-chat-pagination',
        label: 'Page chat messages for support context',
        kind: 'paginate',
        tenantId: 'platform-shell',
        domainId: 'chat-threads',
        personaId: 'support.lead',
        method: 'GET',
        route: '/mf-platform/chat?cursor=msg-psh-04097',
        weight: 10,
        sampleSelectorIds: [
          'chat-remote-fallback',
          'messages-pagination-window',
        ],
        expectedEventKind: 'message.sent',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'mixed-refund-write',
        label: 'Request refund after incident escalation',
        kind: 'write',
        tenantId: 'city-ops-eu',
        domainId: 'marketplace-orders',
        personaId: 'support.lead',
        method: 'PATCH',
        route: '/mobility/support',
        weight: 10,
        sampleSelectorIds: ['orders-checkout-surge'],
        expectedEventKind: 'refund.requested',
        idempotent: true,
        mutatesData: true,
      }),
      step({
        id: 'mixed-invoice-read',
        label: 'Read invoice close state after refund request',
        kind: 'read',
        tenantId: 'acme-global',
        domainId: 'erp-finance',
        personaId: 'finance.approver',
        method: 'GET',
        route: '/mega-erp/procurement',
        weight: 12,
        sampleSelectorIds: ['invoices-month-close'],
        expectedEventKind: 'approval.granted',
        idempotent: true,
        mutatesData: false,
      }),
    ],
    tenantBoundaryProbes: [],
    invariants: [
      'cross-app request lineage stays stable across read and write legs',
      'chat pagination never loses the incident context',
      'refund writes do not expose another tenant invoice window',
    ],
  }),
  profile({
    id: 'search-filter-sort-ledger',
    category: 'search-filter-sort',
    label: 'Search Filter Sort Ledger',
    description:
      'ERP and security table scans with deterministic filters, sorts, and stable sample windows.',
    tenantIds: ['acme-global', 'security-root', 'superapp-global'],
    domainIds: ['erp-finance', 'users-roles', 'audit-events'],
    catalogScenarioIds: ['erp-close-admin-rotation'],
    targets: ['load', 'browser', 'contract'],
    operationMix: {
      reads: 48,
      writes: 0,
      searchFilterSorts: 52,
      paginations: 0,
      tenantProbes: 0,
    },
    budgets: budgets(
      [950, 2600, 5, 420],
      [480, 1300, 8, 180],
      [1600, 5400, 64, 2400],
      [2300, 8000, 32, 1000],
    ),
    sampleSelectors: [
      invoiceCloseSelector,
      ledgerReconciliationSelector,
      financeMembershipSelector,
      operatorUserSelector,
      auditPolicySelector,
    ],
    steps: [
      step({
        id: 'search-invoice-status',
        label: 'Filter invoices by month-close status',
        kind: 'search-filter-sort',
        tenantId: 'acme-global',
        domainId: 'erp-finance',
        personaId: 'finance.approver',
        method: 'GET',
        route: '/mega-erp/procurement?status=open&sort=createdAt',
        weight: 32,
        sampleSelectorIds: ['invoices-month-close'],
        expectedEventKind: 'approval.granted',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'sort-ledger-amount',
        label: 'Sort ledger entries by amount and fiscal period',
        kind: 'search-filter-sort',
        tenantId: 'acme-global',
        domainId: 'erp-finance',
        personaId: 'finance.approver',
        method: 'GET',
        route: '/mega-erp?sort=amountCents&fiscalPeriod=2026-01',
        weight: 32,
        sampleSelectorIds: ['ledger-reconciliation'],
        expectedEventKind: 'ledger.posted',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'filter-finance-memberships',
        label: 'Filter finance memberships by privileged role',
        kind: 'search-filter-sort',
        tenantId: 'acme-global',
        domainId: 'users-roles',
        personaId: 'security.admin',
        method: 'GET',
        route: '/security/roles?tenant=acme-global&role=finance-approver',
        weight: 20,
        sampleSelectorIds: ['memberships-finance-page', 'users-operator-page'],
        expectedEventKind: 'permission.evaluated',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'search-audit-policy',
        label: 'Search policy audit stream by event kind',
        kind: 'search-filter-sort',
        tenantId: 'security-root',
        domainId: 'audit-events',
        personaId: 'security.admin',
        method: 'GET',
        route: '/security/audit?kind=policy.evaluated&sort=createdAt',
        weight: 16,
        sampleSelectorIds: ['audit-policy-stream'],
        expectedEventKind: 'policy.evaluated',
        idempotent: true,
        mutatesData: false,
      }),
    ],
    tenantBoundaryProbes: [],
    invariants: [
      'filter and sort parameters are deterministic',
      'search reads do not change ledger or membership state',
      'audit search preserves redaction boundaries',
    ],
  }),
  profile({
    id: 'chat-pagination-history',
    category: 'chat-pagination',
    label: 'Chat Pagination History',
    description:
      'Cursor and route-churn pagination through remote chat history with a small write marker.',
    tenantIds: ['platform-shell'],
    domainIds: ['chat-threads'],
    catalogScenarioIds: ['marketplace-surge-to-ledger'],
    targets: ['k6', 'load', 'chaos', 'browser', 'contract'],
    operationMix: {
      reads: 55,
      writes: 5,
      searchFilterSorts: 0,
      paginations: 40,
      tenantProbes: 0,
    },
    budgets: budgets(
      [700, 1800, 8, 180],
      [360, 900, 12, 90],
      [1100, 3800, 80, 1200],
      [1700, 5600, 44, 620],
    ),
    sampleSelectors: [chatThreadSelector, messagePaginationSelector],
    steps: [
      step({
        id: 'chat-thread-list',
        label: 'Read remote chat thread list',
        kind: 'read',
        tenantId: 'platform-shell',
        domainId: 'chat-threads',
        personaId: 'platform.operator',
        method: 'GET',
        route: '/mf-platform/chat',
        weight: 20,
        sampleSelectorIds: ['chat-remote-fallback'],
        expectedEventKind: 'thread.opened',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'chat-page-before-cursor',
        label: 'Page messages before stable cursor',
        kind: 'paginate',
        tenantId: 'platform-shell',
        domainId: 'chat-threads',
        personaId: 'support.lead',
        method: 'GET',
        route: '/mf-platform/chat?cursor=msg-psh-04097&direction=before',
        weight: 32,
        sampleSelectorIds: ['messages-pagination-window'],
        expectedEventKind: 'message.sent',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'chat-page-after-cursor',
        label: 'Page messages after stable cursor',
        kind: 'paginate',
        tenantId: 'platform-shell',
        domainId: 'chat-threads',
        personaId: 'support.lead',
        method: 'GET',
        route: '/mf-platform/chat?cursor=msg-psh-04098&direction=after',
        weight: 32,
        sampleSelectorIds: ['messages-pagination-window'],
        expectedEventKind: 'message.sent',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'chat-append-marker',
        label: 'Append idempotent support marker',
        kind: 'write',
        tenantId: 'platform-shell',
        domainId: 'chat-threads',
        personaId: 'support.lead',
        method: 'POST',
        route: '/mf-platform/chat',
        weight: 8,
        sampleSelectorIds: ['chat-remote-fallback'],
        expectedEventKind: 'message.sent',
        idempotent: true,
        mutatesData: true,
      }),
      step({
        id: 'chat-thread-refresh',
        label: 'Refresh thread context after marker append',
        kind: 'read',
        tenantId: 'platform-shell',
        domainId: 'chat-threads',
        personaId: 'platform.operator',
        method: 'GET',
        route: '/mf-platform/chat?refresh=1',
        weight: 8,
        sampleSelectorIds: ['chat-remote-fallback'],
        expectedEventKind: 'case.linked',
        idempotent: true,
        mutatesData: false,
      }),
    ],
    tenantBoundaryProbes: [],
    invariants: [
      'cursor windows remain stable across route churn',
      'message append marker is idempotent',
      'remote fallback keeps chat pagination routeable',
    ],
  }),
  profile({
    id: 'tenant-boundary-probes',
    category: 'tenant-boundary',
    label: 'Tenant Boundary Probes',
    description:
      'Read-only allow and deny probes for tenant isolation without data mutation.',
    tenantIds: [
      'security-root',
      'city-ops-eu',
      'acme-global',
      'platform-shell',
      'chaos-lab',
      'superapp-global',
    ],
    domainIds: ['users-roles', 'audit-events', 'admin-operations'],
    catalogScenarioIds: ['tenant-boundary-audit'],
    targets: ['chaos', 'browser', 'contract'],
    operationMix: {
      reads: 50,
      writes: 0,
      searchFilterSorts: 0,
      paginations: 0,
      tenantProbes: 50,
    },
    budgets: budgets(
      [650, 1700, 4, 80],
      [320, 900, 12, 60],
      [950, 3200, 40, 420],
      [1450, 4800, 24, 260],
    ),
    sampleSelectors: [
      operatorUserSelector,
      privilegedRoleSelector,
      auditPolicySelector,
      tenantResourceSelector,
    ],
    steps: [
      step({
        id: 'probe-security-audit-allowed',
        label: 'Allow security-root audit read',
        kind: 'tenant-probe',
        tenantId: 'security-root',
        domainId: 'audit-events',
        personaId: 'security.admin',
        method: 'GET',
        route: '/security/audit?tenant=security-root',
        weight: 35,
        sampleSelectorIds: ['audit-policy-stream'],
        expectedEventKind: 'policy.evaluated',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'probe-city-to-security-denied',
        label: 'Deny city tenant reading security-root roles',
        kind: 'tenant-probe',
        tenantId: 'city-ops-eu',
        domainId: 'users-roles',
        personaId: 'dispatch.lead',
        method: 'GET',
        route: '/security/roles?tenant=security-root',
        weight: 35,
        sampleSelectorIds: ['roles-privileged-page'],
        expectedEventKind: 'permission.evaluated',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'probe-acme-to-platform-denied',
        label: 'Deny ERP tenant reading platform admin resource',
        kind: 'tenant-probe',
        tenantId: 'platform-shell',
        domainId: 'admin-operations',
        personaId: 'finance.approver',
        method: 'GET',
        route: '/security/roles?tenant=platform-shell',
        weight: 20,
        sampleSelectorIds: ['tenant-resources-drill-page'],
        expectedEventKind: 'permission.evaluated',
        idempotent: true,
        mutatesData: false,
      }),
      step({
        id: 'probe-operator-page-allowed',
        label: 'Allow superapp operator user page read',
        kind: 'tenant-probe',
        tenantId: 'superapp-global',
        domainId: 'users-roles',
        personaId: 'ops.commander',
        method: 'GET',
        route: '/security/roles?tenant=superapp-global',
        weight: 10,
        sampleSelectorIds: ['users-operator-page'],
        expectedEventKind: 'permission.evaluated',
        idempotent: true,
        mutatesData: false,
      }),
    ],
    tenantBoundaryProbes: [
      {
        id: 'security-root-audit-allowed',
        sourceTenantId: 'security-root',
        targetTenantId: 'security-root',
        targetAppId: 'tenant-security',
        personaId: 'security.admin',
        roleId: 'security-admin',
        action: 'audit:read',
        mutation: false,
        expectedAllowed: true,
        expectedNoMutation: true,
        expectedFailedCheckIds: [],
        sampleSelectorIds: ['audit-policy-stream'],
      },
      {
        id: 'city-ops-to-security-denied',
        sourceTenantId: 'city-ops-eu',
        targetTenantId: 'security-root',
        targetAppId: 'tenant-security',
        personaId: 'dispatch.lead',
        roleId: 'mobility-operator',
        action: 'role:read',
        mutation: false,
        expectedAllowed: false,
        expectedNoMutation: true,
        expectedFailedCheckIds: [
          'tenant:header-matches-target',
          'tenant:app-access',
          'role:allowed-for-tenant',
        ],
        sampleSelectorIds: ['roles-privileged-page'],
      },
      {
        id: 'acme-to-platform-denied',
        sourceTenantId: 'acme-global',
        targetTenantId: 'platform-shell',
        targetAppId: 'mf-platform',
        personaId: 'finance.approver',
        roleId: 'finance-approver',
        action: 'admin-resource:read',
        mutation: false,
        expectedAllowed: false,
        expectedNoMutation: true,
        expectedFailedCheckIds: [
          'tenant:header-matches-target',
          'tenant:app-access',
          'role:allowed-for-tenant',
        ],
        sampleSelectorIds: ['tenant-resources-drill-page'],
      },
    ],
    invariants: [
      'allowed probes stay read-only',
      'denied probes never mutate tenant state',
      'failed checks identify the tenant, app, and role boundary',
    ],
  }),
];

const profileById = new Map(
  SUPERAPP_WORKLOAD_SCENARIO_PROFILES.map(item => [item.id, item]),
);

function categoryCount(
  category: WorkloadScenarioProfileCategory,
): WorkloadScenarioProfileCategoryCount {
  return {
    category,
    count: SUPERAPP_WORKLOAD_SCENARIO_PROFILES.filter(
      item => item.category === category,
    ).length,
  };
}

function createProfileContract(): SuperAppWorkloadScenarioProfileContract {
  const sampleWindowIds = unique(
    SUPERAPP_WORKLOAD_SCENARIO_PROFILES.flatMap(item => item.sampleWindowIds),
  );

  return {
    profileVersion: 'superapp-workload-scenario-profiles-v1',
    seed: 'superapp-portfolio-scenario-profiles-v1',
    categories: SUPERAPP_WORKLOAD_SCENARIO_PROFILE_CATEGORIES,
    profileIds: SUPERAPP_WORKLOAD_SCENARIO_PROFILE_IDS,
    profiles: SUPERAPP_WORKLOAD_SCENARIO_PROFILES,
    helperMetadata: {
      profileCount: SUPERAPP_WORKLOAD_SCENARIO_PROFILES.length,
      categoryCounts:
        SUPERAPP_WORKLOAD_SCENARIO_PROFILE_CATEGORIES.map(categoryCount),
      sampleWindowIds,
      tenantBoundaryProfileId: 'tenant-boundary-probes',
      defaultProfileIds: {
        k6: [
          'read-heavy-command-center',
          'write-heavy-order-ledger',
          'mixed-cross-app-journey',
          'chat-pagination-history',
        ],
        load: [
          'read-heavy-command-center',
          'write-heavy-order-ledger',
          'mixed-cross-app-journey',
          'search-filter-sort-ledger',
          'chat-pagination-history',
        ],
        chaos: [
          'write-heavy-order-ledger',
          'mixed-cross-app-journey',
          'chat-pagination-history',
          'tenant-boundary-probes',
        ],
        browser: [
          'read-heavy-command-center',
          'mixed-cross-app-journey',
          'search-filter-sort-ledger',
          'chat-pagination-history',
          'tenant-boundary-probes',
        ],
        contract: SUPERAPP_WORKLOAD_SCENARIO_PROFILE_IDS,
      },
    },
  };
}

const PROFILE_CONTRACT = createProfileContract();

export function createSuperAppWorkloadScenarioProfileContract(): SuperAppWorkloadScenarioProfileContract {
  return JSON.parse(
    JSON.stringify(PROFILE_CONTRACT),
  ) as SuperAppWorkloadScenarioProfileContract;
}

export function createSuperAppWorkloadScenarioProfileMetadata(): SuperAppWorkloadScenarioProfileMetadata {
  const { profiles: _profiles, ...metadata } = PROFILE_CONTRACT;
  return JSON.parse(
    JSON.stringify(metadata),
  ) as SuperAppWorkloadScenarioProfileMetadata;
}

export function getWorkloadScenarioProfile(id: WorkloadScenarioProfileId) {
  return profileById.get(id);
}

export function getWorkloadScenarioProfilesByCategory(
  category: WorkloadScenarioProfileCategory,
) {
  return SUPERAPP_WORKLOAD_SCENARIO_PROFILES.filter(
    profileItem => profileItem.category === category,
  );
}

function resolveProfile(
  profileOrId: WorkloadScenarioProfile | WorkloadScenarioProfileId,
) {
  if (typeof profileOrId !== 'string') {
    return profileOrId;
  }

  const resolved = getWorkloadScenarioProfile(profileOrId);
  if (!resolved) {
    throw new Error(`Unknown workload scenario profile: ${profileOrId}`);
  }
  return resolved;
}

export function selectWorkloadScenarioSampleWindows(
  profileOrId: WorkloadScenarioProfile | WorkloadScenarioProfileId,
  contract: SuperAppGeneratedWorkloadContract,
): GeneratedWorkloadSampleWindow[] {
  const resolved = resolveProfile(profileOrId);
  return resolved.sampleWindowIds.map(sampleWindowId => {
    const sampleWindow = contract.metadata.sampleWindows.find(
      window => window.id === sampleWindowId,
    );
    if (!sampleWindow) {
      throw new Error(`Missing workload sample window: ${sampleWindowId}`);
    }
    return sampleWindow;
  });
}

export function selectWorkloadScenarioSampleRecords(
  profileOrId: WorkloadScenarioProfile | WorkloadScenarioProfileId,
  contract: SuperAppGeneratedWorkloadContract,
): WorkloadScenarioSelectedRecords[] {
  const resolved = resolveProfile(profileOrId);
  return resolved.sampleSelectors.map(sampleSelector => {
    const expectedIds = new Set(sampleSelector.expectedRecordIds);
    const records = contract.samples[sampleSelector.entity].filter(record =>
      expectedIds.has(record.id),
    );
    return {
      selector: sampleSelector,
      records,
    };
  });
}

export function getWorkloadTenantBoundaryProbes(
  profileId: WorkloadScenarioProfileId = 'tenant-boundary-probes',
) {
  return resolveProfile(profileId).tenantBoundaryProbes;
}
