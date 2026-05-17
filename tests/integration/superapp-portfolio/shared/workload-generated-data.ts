// @effect-diagnostics globalDate:off strictBooleanExpressions:off
import {
  SUPERAPP_WORKLOAD_CATALOG,
  SUPERAPP_WORKLOAD_TENANT_IDS,
  type SuperAppWorkloadCatalog,
  type WorkloadAppId,
  type WorkloadDomainId,
  type WorkloadTenantId,
} from './workload-domain-catalog.js';

export type GeneratedWorkloadEntity =
  | 'orders'
  | 'invoices'
  | 'ledgerEntries'
  | 'rides'
  | 'dispatchAssignments'
  | 'fleetVehicles'
  | 'chatThreads'
  | 'messages'
  | 'auditEvents'
  | 'users'
  | 'roles'
  | 'memberships'
  | 'tenantResources';

export type GeneratedWorkloadEntityCounts = {
  orders: number;
  invoices: number;
  ledgerEntries: number;
  rides: number;
  dispatchAssignments: number;
  fleetVehicles: number;
  chatThreads: number;
  messages: number;
  auditEvents: number;
  users: number;
  roles: number;
  memberships: number;
  tenantResources: number;
};

export type GeneratedWorkloadRecord = {
  entity: GeneratedWorkloadEntity;
  id: string;
  tenantId: WorkloadTenantId;
  domainId: WorkloadDomainId;
  ownerAppId: WorkloadAppId;
  createdAtIso: string;
  partitionKey: string;
  status: string;
  actorUserId: string;
  requestId: string;
  relatedIds: string[];
  amountCents: number;
  ordinal: number;
  checksum: string;
};

export type GeneratedWorkloadHighWatermark = {
  entity: GeneratedWorkloadEntity;
  count: number;
  firstId: string;
  lastId: string;
  lastCreatedAtIso: string;
};

export type GeneratedTenantWorkloadSummary = {
  tenantId: WorkloadTenantId;
  region: string;
  appIds: WorkloadAppId[];
  totalRecords: number;
  totals: GeneratedWorkloadEntityCounts;
  sampleIds: string[];
};

export type GeneratedWorkloadSampleWindow = {
  id: string;
  entity: GeneratedWorkloadEntity;
  tenantId: WorkloadTenantId;
  start: number;
  limit: number;
  count: number;
  firstId: string;
  lastId: string;
};

export type SuperAppGeneratedWorkloadMetadata = {
  totalRecords: number;
  totals: GeneratedWorkloadEntityCounts;
  highWatermarks: GeneratedWorkloadHighWatermark[];
  tenantSummaries: GeneratedTenantWorkloadSummary[];
  sampleWindows: GeneratedWorkloadSampleWindow[];
};

export type GeneratedWorkloadSamples = {
  [entity in GeneratedWorkloadEntity]: GeneratedWorkloadRecord[];
};

export type GeneratedWorkloadHelperIds = {
  workloadRootTenantId: WorkloadTenantId;
  readHeavyTenantId: WorkloadTenantId;
  financeTenantId: WorkloadTenantId;
  securityTenantId: WorkloadTenantId;
  sampleWindows: {
    orders: string;
    invoices: string;
    ledgerEntries: string;
    rides: string;
    dispatchAssignments: string;
    fleetVehicles: string;
    chatThreads: string;
    messages: string;
    auditEvents: string;
    users: string;
    roles: string;
    memberships: string;
    tenantResources: string;
  };
  stableRecords: {
    orderId: string;
    invoiceId: string;
    ledgerEntryId: string;
    rideId: string;
    dispatchAssignmentId: string;
    fleetVehicleId: string;
    chatThreadId: string;
    messageId: string;
    auditEventId: string;
    userId: string;
    roleId: string;
    membershipId: string;
    tenantResourceId: string;
  };
  tenantBoundaryProbe: {
    allowedTenantId: WorkloadTenantId;
    deniedTenantId: WorkloadTenantId;
    appId: WorkloadAppId;
    userId: string;
    roleId: string;
    resourceId: string;
    auditEventId: string;
  };
};

export type SuperAppGeneratedWorkloadContract = {
  datasetVersion: 'superapp-generated-workload-v1';
  seed: 'superapp-portfolio-generated-workload-v1';
  clockStartIso: '2026-01-15T08:00:00.000Z';
  clockStepMs: 17000;
  metadata: SuperAppGeneratedWorkloadMetadata;
  helperIds: GeneratedWorkloadHelperIds;
  samples: GeneratedWorkloadSamples;
};

export type SuperAppGeneratedWorkloadDataset = Omit<
  SuperAppGeneratedWorkloadContract,
  'samples'
> & {
  records: GeneratedWorkloadSamples;
};

type TenantGenerationProfile = {
  tenantId: WorkloadTenantId;
  counts: GeneratedWorkloadEntityCounts;
};

type SampleWindowSpec = Omit<
  GeneratedWorkloadSampleWindow,
  'count' | 'firstId' | 'lastId'
>;

export const GENERATED_WORKLOAD_ENTITIES: GeneratedWorkloadEntity[] = [
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
];

const WORKLOAD_DATASET_VERSION = 'superapp-generated-workload-v1' as const;
const WORKLOAD_DATASET_SEED =
  'superapp-portfolio-generated-workload-v1' as const;
const WORKLOAD_CLOCK_START_ISO = '2026-01-15T08:00:00.000Z' as const;
const WORKLOAD_CLOCK_STEP_MS = 17000 as const;
const WORKLOAD_CLOCK_START_MS = Date.parse(WORKLOAD_CLOCK_START_ISO);

const ENTITY_ID_PREFIX: Record<GeneratedWorkloadEntity, string> = {
  orders: 'ord',
  invoices: 'inv',
  ledgerEntries: 'led',
  rides: 'rid',
  dispatchAssignments: 'dsp',
  fleetVehicles: 'veh',
  chatThreads: 'thd',
  messages: 'msg',
  auditEvents: 'aud',
  users: 'usr',
  roles: 'rol',
  memberships: 'mem',
  tenantResources: 'res',
};

const TENANT_ID_PREFIX: Record<WorkloadTenantId, string> = {
  'superapp-global': 'sgl',
  'city-ops-eu': 'coe',
  'acme-global': 'acm',
  'platform-shell': 'psh',
  'security-root': 'sec',
  'chaos-lab': 'cha',
};

const ENTITY_DOMAIN: Record<GeneratedWorkloadEntity, WorkloadDomainId> = {
  orders: 'marketplace-orders',
  invoices: 'erp-finance',
  ledgerEntries: 'erp-finance',
  rides: 'dispatch-mobility',
  dispatchAssignments: 'dispatch-mobility',
  fleetVehicles: 'fleet-mobility',
  chatThreads: 'chat-threads',
  messages: 'chat-threads',
  auditEvents: 'audit-events',
  users: 'users-roles',
  roles: 'users-roles',
  memberships: 'users-roles',
  tenantResources: 'admin-operations',
};

const ENTITY_STATUSES: Record<GeneratedWorkloadEntity, string[]> = {
  orders: ['captured', 'fulfilled', 'refunded', 'manual-review'],
  invoices: ['open', 'approved', 'paid', 'exception'],
  ledgerEntries: ['posted', 'reconciled', 'pending-close', 'reversed'],
  rides: ['quoted', 'accepted', 'in-progress', 'completed', 'cancelled'],
  dispatchAssignments: ['queued', 'assigned', 'retrying', 'completed'],
  fleetVehicles: ['available', 'assigned', 'charging', 'maintenance-hold'],
  chatThreads: ['open', 'waiting-on-customer', 'escalated', 'resolved'],
  messages: ['sent', 'delivered', 'redacted', 'system-note'],
  auditEvents: ['appended', 'redacted', 'policy-evaluated', 'retained'],
  users: ['active', 'invited', 'locked', 'service-account'],
  roles: ['active', 'privileged', 'tenant-custom', 'pending-review'],
  memberships: ['active', 'pending', 'expired', 'break-glass'],
  tenantResources: ['active', 'quarantined', 'rotating', 'degraded'],
};

const BASE_ROLE_IDS = [
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
] as const;

const OWNER_APPS: WorkloadAppId[] = [
  'mobility-marketplace',
  'enterprise-mega-erp',
  'mf-platform',
  'tenant-security',
  'failure-lab',
];

function counts(
  input: Partial<GeneratedWorkloadEntityCounts>,
): GeneratedWorkloadEntityCounts {
  return {
    orders: 0,
    invoices: 0,
    ledgerEntries: 0,
    rides: 0,
    dispatchAssignments: 0,
    fleetVehicles: 0,
    chatThreads: 0,
    messages: 0,
    auditEvents: 0,
    users: 0,
    roles: 0,
    memberships: 0,
    tenantResources: 0,
    ...input,
  };
}

export const SUPERAPP_GENERATED_WORKLOAD_TENANT_PROFILES: TenantGenerationProfile[] =
  [
    {
      tenantId: 'superapp-global',
      counts: counts({
        orders: 2400,
        invoices: 1800,
        ledgerEntries: 4300,
        rides: 2200,
        dispatchAssignments: 2200,
        fleetVehicles: 700,
        chatThreads: 900,
        messages: 9000,
        auditEvents: 5200,
        users: 780,
        roles: 260,
        memberships: 1560,
        tenantResources: 520,
      }),
    },
    {
      tenantId: 'city-ops-eu',
      counts: counts({
        orders: 3900,
        rides: 4100,
        dispatchAssignments: 4100,
        fleetVehicles: 1270,
        chatThreads: 1200,
        messages: 12000,
        auditEvents: 4400,
        users: 980,
        roles: 280,
        memberships: 1900,
        tenantResources: 760,
      }),
    },
    {
      tenantId: 'acme-global',
      counts: counts({
        invoices: 2850,
        ledgerEntries: 6900,
        auditEvents: 3900,
        users: 720,
        roles: 240,
        memberships: 1350,
        tenantResources: 480,
      }),
    },
    {
      tenantId: 'platform-shell',
      counts: counts({
        chatThreads: 1000,
        messages: 10000,
        auditEvents: 2600,
        users: 240,
        roles: 160,
        memberships: 540,
        tenantResources: 360,
      }),
    },
    {
      tenantId: 'security-root',
      counts: counts({
        auditEvents: 4100,
        users: 180,
        roles: 180,
        memberships: 480,
        tenantResources: 260,
      }),
    },
    {
      tenantId: 'chaos-lab',
      counts: counts({
        auditEvents: 2800,
        users: 160,
        roles: 140,
        memberships: 390,
        tenantResources: 220,
      }),
    },
  ];

const SAMPLE_WINDOW_SPECS: SampleWindowSpec[] = [
  {
    id: 'orders:city-ops-eu:checkout-surge',
    entity: 'orders',
    tenantId: 'city-ops-eu',
    start: 1024,
    limit: 4,
  },
  {
    id: 'invoices:acme-global:month-close',
    entity: 'invoices',
    tenantId: 'acme-global',
    start: 512,
    limit: 4,
  },
  {
    id: 'ledgerEntries:acme-global:reconciliation',
    entity: 'ledgerEntries',
    tenantId: 'acme-global',
    start: 2048,
    limit: 4,
  },
  {
    id: 'rides:city-ops-eu:rush-hour',
    entity: 'rides',
    tenantId: 'city-ops-eu',
    start: 1500,
    limit: 4,
  },
  {
    id: 'dispatchAssignments:city-ops-eu:retry-window',
    entity: 'dispatchAssignments',
    tenantId: 'city-ops-eu',
    start: 1500,
    limit: 4,
  },
  {
    id: 'fleetVehicles:city-ops-eu:shift-change',
    entity: 'fleetVehicles',
    tenantId: 'city-ops-eu',
    start: 128,
    limit: 4,
  },
  {
    id: 'chatThreads:platform-shell:remote-fallback',
    entity: 'chatThreads',
    tenantId: 'platform-shell',
    start: 64,
    limit: 4,
  },
  {
    id: 'messages:platform-shell:pagination-window',
    entity: 'messages',
    tenantId: 'platform-shell',
    start: 4096,
    limit: 4,
  },
  {
    id: 'auditEvents:security-root:policy-stream',
    entity: 'auditEvents',
    tenantId: 'security-root',
    start: 2048,
    limit: 4,
  },
  {
    id: 'users:superapp-global:operator-page',
    entity: 'users',
    tenantId: 'superapp-global',
    start: 128,
    limit: 4,
  },
  {
    id: 'roles:security-root:privileged-page',
    entity: 'roles',
    tenantId: 'security-root',
    start: 32,
    limit: 4,
  },
  {
    id: 'memberships:acme-global:finance-page',
    entity: 'memberships',
    tenantId: 'acme-global',
    start: 256,
    limit: 4,
  },
  {
    id: 'tenantResources:chaos-lab:drill-page',
    entity: 'tenantResources',
    tenantId: 'chaos-lab',
    start: 80,
    limit: 4,
  },
];

function createEmptySamples(): GeneratedWorkloadSamples {
  return {
    orders: [],
    invoices: [],
    ledgerEntries: [],
    rides: [],
    dispatchAssignments: [],
    fleetVehicles: [],
    chatThreads: [],
    messages: [],
    auditEvents: [],
    users: [],
    roles: [],
    memberships: [],
    tenantResources: [],
  };
}

function getProfile(tenantId: WorkloadTenantId) {
  const profile = SUPERAPP_GENERATED_WORKLOAD_TENANT_PROFILES.find(
    item => item.tenantId === tenantId,
  );
  if (!profile) {
    throw new Error(`Unknown generated workload tenant: ${tenantId}`);
  }
  return profile;
}

function totalForCounts(countValues: GeneratedWorkloadEntityCounts) {
  return GENERATED_WORKLOAD_ENTITIES.reduce(
    (sum, entity) => sum + countValues[entity],
    0,
  );
}

function addCounts(
  target: GeneratedWorkloadEntityCounts,
  input: GeneratedWorkloadEntityCounts,
) {
  for (const entity of GENERATED_WORKLOAD_ENTITIES) {
    target[entity] += input[entity];
  }
}

function localIdFor(
  entity: GeneratedWorkloadEntity,
  tenantId: WorkloadTenantId,
  localIndex: number,
) {
  return `${ENTITY_ID_PREFIX[entity]}-${TENANT_ID_PREFIX[tenantId]}-${String(
    localIndex,
  ).padStart(5, '0')}`;
}

function createdAtIsoFor(
  entity: GeneratedWorkloadEntity,
  tenantId: WorkloadTenantId,
  localIndex: number,
) {
  const entityOffset = GENERATED_WORKLOAD_ENTITIES.indexOf(entity) * 100000;
  const tenantOffset = SUPERAPP_WORKLOAD_TENANT_IDS.indexOf(tenantId) * 10000;
  return new Date(
    WORKLOAD_CLOCK_START_MS +
      (entityOffset + tenantOffset + localIndex) * WORKLOAD_CLOCK_STEP_MS,
  ).toISOString();
}

function hashToInt(input: string) {
  const seededInput = `${WORKLOAD_DATASET_SEED}:${input}`;
  let hash = 2166136261;
  for (let index = 0; index < seededInput.length; index += 1) {
    hash ^= seededInput.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(values: readonly T[], seed: string): T {
  return values[hashToInt(seed) % values.length] as T;
}

function amountCentsFor(
  entity: GeneratedWorkloadEntity,
  tenantId: WorkloadTenantId,
  localIndex: number,
) {
  const base =
    entity === 'fleetVehicles' || entity === 'tenantResources' ? 0 : 500;
  return base + (hashToInt(`${entity}:${tenantId}:${localIndex}`) % 950000);
}

function domainFor(
  entity: GeneratedWorkloadEntity,
  tenantId: WorkloadTenantId,
  localIndex: number,
  catalog: SuperAppWorkloadCatalog,
) {
  if (entity !== 'tenantResources') {
    return ENTITY_DOMAIN[entity];
  }

  const tenantDomains = catalog.domains.filter(domain =>
    domain.tenantIds.includes(tenantId),
  );
  return (
    tenantDomains[(localIndex - 1) % tenantDomains.length]?.id ??
    'admin-operations'
  );
}

function ownerAppFor(
  domainId: WorkloadDomainId,
  catalog: SuperAppWorkloadCatalog,
) {
  return (
    catalog.domains.find(domain => domain.id === domainId)?.ownerAppId ??
    pick(OWNER_APPS, domainId)
  );
}

function boundedIdFor(
  entity: GeneratedWorkloadEntity,
  tenantId: WorkloadTenantId,
  localIndex: number,
) {
  const profile = getProfile(tenantId);
  const total = profile.counts[entity];
  if (total === 0) {
    return '';
  }
  return localIdFor(entity, tenantId, ((localIndex - 1) % total) + 1);
}

function relatedIdsFor(
  entity: GeneratedWorkloadEntity,
  tenantId: WorkloadTenantId,
  localIndex: number,
) {
  const userId = boundedIdFor('users', tenantId, localIndex);
  const roleId = boundedIdFor('roles', tenantId, localIndex);
  const orderId = boundedIdFor('orders', tenantId, localIndex);
  const invoiceId = boundedIdFor('invoices', tenantId, localIndex);
  const ledgerEntryId = boundedIdFor('ledgerEntries', tenantId, localIndex);
  const rideId = boundedIdFor('rides', tenantId, localIndex);
  const dispatchId = boundedIdFor('dispatchAssignments', tenantId, localIndex);
  const vehicleId = boundedIdFor('fleetVehicles', tenantId, localIndex);
  const threadId = boundedIdFor('chatThreads', tenantId, localIndex);
  const resourceId = boundedIdFor('tenantResources', tenantId, localIndex);

  const relatedByEntity: Record<GeneratedWorkloadEntity, string[]> = {
    orders: [userId, invoiceId, ledgerEntryId],
    invoices: [orderId, ledgerEntryId, userId],
    ledgerEntries: [invoiceId, orderId],
    rides: [userId, dispatchId, vehicleId],
    dispatchAssignments: [rideId, userId, vehicleId],
    fleetVehicles: [resourceId, dispatchId],
    chatThreads: [userId, orderId, rideId],
    messages: [threadId, userId],
    auditEvents: [userId, resourceId, orderId, invoiceId, rideId],
    users: [roleId],
    roles: [pick(BASE_ROLE_IDS, `${tenantId}:${localIndex}`)],
    memberships: [userId, roleId],
    tenantResources: [userId, roleId],
  };

  return relatedByEntity[entity].filter(Boolean);
}

function partitionKeyFor(
  entity: GeneratedWorkloadEntity,
  tenantId: WorkloadTenantId,
  localIndex: number,
) {
  switch (entity) {
    case 'orders':
      return `${tenantId}:merchant-${(localIndex % 96) + 1}`;
    case 'invoices':
    case 'ledgerEntries':
      return `${tenantId}:fiscal-2026-${String((localIndex % 12) + 1).padStart(
        2,
        '0',
      )}`;
    case 'rides':
    case 'dispatchAssignments':
    case 'fleetVehicles':
      return `${tenantId}:zone-${(localIndex % 32) + 1}`;
    case 'chatThreads':
    case 'messages':
      return `${tenantId}:queue-${(localIndex % 24) + 1}`;
    case 'auditEvents':
      return `${tenantId}:audit-day-${(localIndex % 31) + 1}`;
    case 'users':
    case 'roles':
    case 'memberships':
      return `${tenantId}:role-${(localIndex % 16) + 1}`;
    case 'tenantResources':
      return `${tenantId}:resource-${(localIndex % 48) + 1}`;
  }
}

function createGeneratedRecord(
  entity: GeneratedWorkloadEntity,
  tenantId: WorkloadTenantId,
  localIndex: number,
  catalog: SuperAppWorkloadCatalog,
): GeneratedWorkloadRecord {
  const domainId = domainFor(entity, tenantId, localIndex, catalog);
  const id = localIdFor(entity, tenantId, localIndex);
  const relatedIds = relatedIdsFor(entity, tenantId, localIndex);
  const requestId = `swl-data-${TENANT_ID_PREFIX[tenantId]}-${
    ENTITY_ID_PREFIX[entity]
  }-${String(localIndex).padStart(5, '0')}`;

  return {
    entity,
    id,
    tenantId,
    domainId,
    ownerAppId: ownerAppFor(domainId, catalog),
    createdAtIso: createdAtIsoFor(entity, tenantId, localIndex),
    partitionKey: partitionKeyFor(entity, tenantId, localIndex),
    status: pick(ENTITY_STATUSES[entity], id),
    actorUserId: boundedIdFor('users', tenantId, localIndex) || id,
    requestId,
    relatedIds,
    amountCents: amountCentsFor(entity, tenantId, localIndex),
    ordinal: localIndex,
    checksum: hashToInt(`${id}:${requestId}:${relatedIds.join(':')}`).toString(
      36,
    ),
  };
}

function createSampleWindow(
  spec: SampleWindowSpec,
): GeneratedWorkloadSampleWindow {
  const profile = getProfile(spec.tenantId);
  const total = profile.counts[spec.entity];
  const count = Math.max(0, Math.min(spec.limit, total - spec.start));
  const firstIndex = spec.start + 1;
  const lastIndex = spec.start + count;

  return {
    ...spec,
    count,
    firstId:
      count > 0 ? localIdFor(spec.entity, spec.tenantId, firstIndex) : '',
    lastId: count > 0 ? localIdFor(spec.entity, spec.tenantId, lastIndex) : '',
  };
}

function createHighWatermarks(): GeneratedWorkloadHighWatermark[] {
  return GENERATED_WORKLOAD_ENTITIES.map(entity => {
    const firstProfile = SUPERAPP_GENERATED_WORKLOAD_TENANT_PROFILES.find(
      profile => profile.counts[entity] > 0,
    );
    const lastProfile = [...SUPERAPP_GENERATED_WORKLOAD_TENANT_PROFILES]
      .reverse()
      .find(profile => profile.counts[entity] > 0);
    const count = SUPERAPP_GENERATED_WORKLOAD_TENANT_PROFILES.reduce(
      (sum, profile) => sum + profile.counts[entity],
      0,
    );

    if (!firstProfile || !lastProfile || count === 0) {
      return {
        entity,
        count: 0,
        firstId: '',
        lastId: '',
        lastCreatedAtIso: WORKLOAD_CLOCK_START_ISO,
      };
    }

    const lastIndex = lastProfile.counts[entity];
    return {
      entity,
      count,
      firstId: localIdFor(entity, firstProfile.tenantId, 1),
      lastId: localIdFor(entity, lastProfile.tenantId, lastIndex),
      lastCreatedAtIso: createdAtIsoFor(
        entity,
        lastProfile.tenantId,
        lastIndex,
      ),
    };
  });
}

function createTenantSummaries(
  catalog: SuperAppWorkloadCatalog,
): GeneratedTenantWorkloadSummary[] {
  return SUPERAPP_GENERATED_WORKLOAD_TENANT_PROFILES.map(profile => {
    const tenant = catalog.tenants.find(item => item.id === profile.tenantId);
    return {
      tenantId: profile.tenantId,
      region: tenant?.region ?? 'UNKNOWN',
      appIds: tenant?.appIds ?? [],
      totalRecords: totalForCounts(profile.counts),
      totals: { ...profile.counts },
      sampleIds: GENERATED_WORKLOAD_ENTITIES.flatMap(entity =>
        profile.counts[entity] > 0
          ? [localIdFor(entity, profile.tenantId, 1)]
          : [],
      ),
    };
  });
}

function createMetadata(
  catalog: SuperAppWorkloadCatalog,
): SuperAppGeneratedWorkloadMetadata {
  const totals = counts({});
  for (const profile of SUPERAPP_GENERATED_WORKLOAD_TENANT_PROFILES) {
    addCounts(totals, profile.counts);
  }

  return {
    totalRecords: totalForCounts(totals),
    totals,
    highWatermarks: createHighWatermarks(),
    tenantSummaries: createTenantSummaries(catalog),
    sampleWindows: SAMPLE_WINDOW_SPECS.map(createSampleWindow),
  };
}

function createHelperIds(): GeneratedWorkloadHelperIds {
  return {
    workloadRootTenantId: 'superapp-global',
    readHeavyTenantId: 'city-ops-eu',
    financeTenantId: 'acme-global',
    securityTenantId: 'security-root',
    sampleWindows: {
      orders: 'orders:city-ops-eu:checkout-surge',
      invoices: 'invoices:acme-global:month-close',
      ledgerEntries: 'ledgerEntries:acme-global:reconciliation',
      rides: 'rides:city-ops-eu:rush-hour',
      dispatchAssignments: 'dispatchAssignments:city-ops-eu:retry-window',
      fleetVehicles: 'fleetVehicles:city-ops-eu:shift-change',
      chatThreads: 'chatThreads:platform-shell:remote-fallback',
      messages: 'messages:platform-shell:pagination-window',
      auditEvents: 'auditEvents:security-root:policy-stream',
      users: 'users:superapp-global:operator-page',
      roles: 'roles:security-root:privileged-page',
      memberships: 'memberships:acme-global:finance-page',
      tenantResources: 'tenantResources:chaos-lab:drill-page',
    },
    stableRecords: {
      orderId: localIdFor('orders', 'city-ops-eu', 1025),
      invoiceId: localIdFor('invoices', 'acme-global', 513),
      ledgerEntryId: localIdFor('ledgerEntries', 'acme-global', 2049),
      rideId: localIdFor('rides', 'city-ops-eu', 1501),
      dispatchAssignmentId: localIdFor(
        'dispatchAssignments',
        'city-ops-eu',
        1501,
      ),
      fleetVehicleId: localIdFor('fleetVehicles', 'city-ops-eu', 129),
      chatThreadId: localIdFor('chatThreads', 'platform-shell', 65),
      messageId: localIdFor('messages', 'platform-shell', 4097),
      auditEventId: localIdFor('auditEvents', 'security-root', 2049),
      userId: localIdFor('users', 'superapp-global', 129),
      roleId: localIdFor('roles', 'security-root', 33),
      membershipId: localIdFor('memberships', 'acme-global', 257),
      tenantResourceId: localIdFor('tenantResources', 'chaos-lab', 81),
    },
    tenantBoundaryProbe: {
      allowedTenantId: 'security-root',
      deniedTenantId: 'city-ops-eu',
      appId: 'tenant-security',
      userId: localIdFor('users', 'security-root', 1),
      roleId: localIdFor('roles', 'security-root', 1),
      resourceId: localIdFor('tenantResources', 'security-root', 1),
      auditEventId: localIdFor('auditEvents', 'security-root', 1),
    },
  };
}

function createContractSamples(
  catalog: SuperAppWorkloadCatalog,
): GeneratedWorkloadSamples {
  const samples = createEmptySamples();
  for (const window of SAMPLE_WINDOW_SPECS.map(createSampleWindow)) {
    for (let offset = 0; offset < window.count; offset += 1) {
      samples[window.entity].push(
        createGeneratedRecord(
          window.entity,
          window.tenantId,
          window.start + offset + 1,
          catalog,
        ),
      );
    }
  }
  return samples;
}

export function createSuperAppGeneratedWorkloadContract(
  catalog: SuperAppWorkloadCatalog = SUPERAPP_WORKLOAD_CATALOG,
): SuperAppGeneratedWorkloadContract {
  return {
    datasetVersion: WORKLOAD_DATASET_VERSION,
    seed: WORKLOAD_DATASET_SEED,
    clockStartIso: WORKLOAD_CLOCK_START_ISO,
    clockStepMs: WORKLOAD_CLOCK_STEP_MS,
    metadata: createMetadata(catalog),
    helperIds: createHelperIds(),
    samples: createContractSamples(catalog),
  };
}

export function createSuperAppGeneratedWorkloadDataset(
  catalog: SuperAppWorkloadCatalog = SUPERAPP_WORKLOAD_CATALOG,
): SuperAppGeneratedWorkloadDataset {
  const records = createEmptySamples();
  for (const profile of SUPERAPP_GENERATED_WORKLOAD_TENANT_PROFILES) {
    for (const entity of GENERATED_WORKLOAD_ENTITIES) {
      for (
        let localIndex = 1;
        localIndex <= profile.counts[entity];
        localIndex += 1
      ) {
        records[entity].push(
          createGeneratedRecord(entity, profile.tenantId, localIndex, catalog),
        );
      }
    }
  }

  return {
    datasetVersion: WORKLOAD_DATASET_VERSION,
    seed: WORKLOAD_DATASET_SEED,
    clockStartIso: WORKLOAD_CLOCK_START_ISO,
    clockStepMs: WORKLOAD_CLOCK_STEP_MS,
    metadata: createMetadata(catalog),
    helperIds: createHelperIds(),
    records,
  };
}
