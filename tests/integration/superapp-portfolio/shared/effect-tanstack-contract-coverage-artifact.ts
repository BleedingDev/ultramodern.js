// @effect-diagnostics strictBooleanExpressions:off
import {
  SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS,
  SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS,
  SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES,
  SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES,
  SUPERAPP_TANSTACK_ROUTE_CONTRACTS,
} from './effect-tanstack-contract-map.js';

type EffectEndpoint = (typeof SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS)[number];
type QueryKeyTemplate = (typeof SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES)[number];
type MutationKeyTemplate =
  (typeof SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES)[number];
type InvalidationBoundary =
  (typeof SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES)[number];
type TanStackRoute = (typeof SUPERAPP_TANSTACK_ROUTE_CONTRACTS)[number];
type DomainRoute = (typeof SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS)[number];

export type SuperAppEffectTanStackContractKind =
  | 'effect-endpoint'
  | 'tanstack-query-key'
  | 'tanstack-mutation-key'
  | 'tanstack-invalidation-boundary'
  | 'tanstack-route'
  | 'portfolio-domain-route';

export type SuperAppEffectTanStackRegressionClassification =
  | 'cache-consistency'
  | 'data-integrity'
  | 'effect-lifecycle'
  | 'request-context'
  | 'resilience'
  | 'route-navigation'
  | 'schema-boundary';

export type SuperAppEffectTanStackRegressionBudget = {
  classification: SuperAppEffectTanStackRegressionClassification;
  maxAllowedContractRegressions: 0;
  maxAllowedOrphans: 0;
  destroyReadinessGate: 'blocking';
  evidence: 'effect-tanstack-contract-suite';
};

export type SuperAppEffectTanStackCoverageRow = {
  contractId: string;
  sourceId: string;
  kind: SuperAppEffectTanStackContractKind;
  expectedBehavior: string;
  regressionBudget: SuperAppEffectTanStackRegressionBudget;
  linkedContractIds: string[];
};

export type SuperAppEffectEndpointCoverageRow =
  SuperAppEffectTanStackCoverageRow & {
    kind: 'effect-endpoint';
    operation: EffectEndpoint['operation'];
    method: EffectEndpoint['method'];
    publicPath: EffectEndpoint['publicPath'];
    endpointKind: EffectEndpoint['kind'];
    successFields: string[];
    requestContextFields: string[];
  };

export type SuperAppQueryKeyTemplateCoverageRow =
  SuperAppEffectTanStackCoverageRow & {
    kind: 'tanstack-query-key';
    parts: string[];
    scope: string[];
  };

export type SuperAppMutationKeyTemplateCoverageRow =
  SuperAppEffectTanStackCoverageRow & {
    kind: 'tanstack-mutation-key';
    parts: string[];
    endpointId: MutationKeyTemplate['endpointId'];
    scope: string[];
  };

export type SuperAppInvalidationBoundaryCoverageRow =
  SuperAppEffectTanStackCoverageRow & {
    kind: 'tanstack-invalidation-boundary';
    endpointId: InvalidationBoundary['endpointId'];
    mutationKeyId: InvalidationBoundary['mutationKeyId'];
    stateMutation: InvalidationBoundary['stateMutation'];
    invalidatesQueryKeyIds: string[];
    stateScopes: string[];
  };

export type SuperAppTanStackRouteCoverageRow =
  SuperAppEffectTanStackCoverageRow & {
    kind: 'tanstack-route';
    path: TanStackRoute['path'];
    loaderFields: string[];
    bffEndpointIds: string[];
    queryKeyIds: string[];
    mutationKeyIds: string[];
  };

export type SuperAppPortfolioDomainRouteCoverageRow =
  SuperAppEffectTanStackCoverageRow & {
    kind: 'portfolio-domain-route';
    path: DomainRoute['path'];
    ownerAppId: DomainRoute['ownerAppId'];
    tenantId: DomainRoute['tenantId'];
    appKind: DomainRoute['appKind'];
    queryKeyIds: string[];
  };

export type SuperAppEffectTanStackScenarioId =
  | 'successful-read'
  | 'successful-write'
  | 'optimistic-mutation'
  | 'rollback'
  | 'duplicate-request-idempotency'
  | 'abort-cancellation'
  | 'timeout'
  | 'retry-classification'
  | 'effect-interruption-finalizers'
  | 'schema-decode-failures'
  | 'structured-defects'
  | 'request-context-propagation'
  | 'navigation-invalidation'
  | 'stale-data'
  | 'prefetch'
  | 'tenant-switch'
  | 'offline-to-online-recovery';

export type SuperAppEffectTanStackScenarioCoverageRow = {
  scenarioId: SuperAppEffectTanStackScenarioId;
  expectedBehavior: string;
  contractIds: string[];
  regressionBudget: SuperAppEffectTanStackRegressionBudget;
};

export type SuperAppEffectTanStackCoverageArtifact = {
  artifactVersion: 'superapp-effect-tanstack-contract-coverage-artifact-v1';
  artifactSeed: 'superapp-portfolio-effect-tanstack-contract-coverage-v1';
  fingerprint: string;
  sourceMapFingerprint: string;
  summary: {
    effectEndpointCount: number;
    queryKeyTemplateCount: number;
    mutationKeyTemplateCount: number;
    invalidationBoundaryCount: number;
    tanStackRouteCount: number;
    portfolioDomainRouteCount: number;
    contractRowCount: number;
    scenarioCount: number;
  };
  sourceMapIds: {
    effectEndpointIds: string[];
    queryKeyTemplateIds: string[];
    mutationKeyTemplateIds: string[];
    invalidationBoundaryIds: string[];
    tanStackRouteIds: string[];
    portfolioDomainRouteIds: string[];
  };
  contractRows: SuperAppEffectTanStackCoverageRow[];
  contracts: {
    effectEndpoints: SuperAppEffectEndpointCoverageRow[];
    queryKeyTemplates: SuperAppQueryKeyTemplateCoverageRow[];
    mutationKeyTemplates: SuperAppMutationKeyTemplateCoverageRow[];
    invalidationBoundaries: SuperAppInvalidationBoundaryCoverageRow[];
    tanStackRoutes: SuperAppTanStackRouteCoverageRow[];
    portfolioDomainRoutes: SuperAppPortfolioDomainRouteCoverageRow[];
  };
  scenarioRows: SuperAppEffectTanStackScenarioCoverageRow[];
  compactness: {
    fullSourceContractsOmitted: true;
    includesOnlyIdsTemplatesBudgetsAndExpectedBehavior: true;
    omittedPaths: string[];
  };
};

const ARTIFACT_VERSION =
  'superapp-effect-tanstack-contract-coverage-artifact-v1' as const;
const ARTIFACT_SEED =
  'superapp-portfolio-effect-tanstack-contract-coverage-v1' as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function fingerprintFor(value: unknown) {
  const input = stableStringify(value);
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function contractId(
  kind: SuperAppEffectTanStackContractKind,
  sourceId: string,
) {
  return `${kind}:${sourceId}`;
}

function budget(
  classification: SuperAppEffectTanStackRegressionClassification,
): SuperAppEffectTanStackRegressionBudget {
  return {
    classification,
    maxAllowedContractRegressions: 0,
    maxAllowedOrphans: 0,
    destroyReadinessGate: 'blocking',
    evidence: 'effect-tanstack-contract-suite',
  };
}

function fieldNames(fields: readonly { name: string }[]) {
  return fields.map(field => field.name);
}

function endpointExpectedBehavior(endpoint: EffectEndpoint) {
  if (endpoint.kind === 'query') {
    return `GET ${endpoint.publicPath} returns ${endpoint.successFields.join(
      ', ',
    )} and populates query keys ${endpoint.queryKeyIds.join(', ')}.`;
  }

  return `${endpoint.method} ${endpoint.publicPath} validates params/payload, preserves request context fields ${endpoint.requestContextFields.join(
    ', ',
  )}, returns ${endpoint.successFields.join(
    ', ',
  )}, and enters invalidation boundary ${endpoint.invalidationBoundaryId}.`;
}

function endpointClassification(
  endpoint: EffectEndpoint,
): SuperAppEffectTanStackRegressionClassification {
  if (endpoint.requestContextFields.length > 0) {
    return 'request-context';
  }

  return endpoint.kind === 'query' ? 'cache-consistency' : 'data-integrity';
}

function endpointRow(
  endpoint: EffectEndpoint,
): SuperAppEffectEndpointCoverageRow {
  return {
    contractId: contractId('effect-endpoint', endpoint.id),
    sourceId: endpoint.id,
    kind: 'effect-endpoint',
    operation: endpoint.operation,
    method: endpoint.method,
    publicPath: endpoint.publicPath,
    endpointKind: endpoint.kind,
    successFields: [...endpoint.successFields],
    requestContextFields: [...endpoint.requestContextFields],
    expectedBehavior: endpointExpectedBehavior(endpoint),
    regressionBudget: budget(endpointClassification(endpoint)),
    linkedContractIds: [
      ...endpoint.queryKeyIds.map(id => contractId('tanstack-query-key', id)),
      ...(endpoint.mutationKeyId
        ? [contractId('tanstack-mutation-key', endpoint.mutationKeyId)]
        : []),
      ...(endpoint.invalidationBoundaryId
        ? [
            contractId(
              'tanstack-invalidation-boundary',
              endpoint.invalidationBoundaryId,
            ),
          ]
        : []),
    ],
  };
}

function queryKeyRow(
  template: QueryKeyTemplate,
): SuperAppQueryKeyTemplateCoverageRow {
  return {
    contractId: contractId('tanstack-query-key', template.id),
    sourceId: template.id,
    kind: 'tanstack-query-key',
    parts: [...template.parts],
    scope: [...template.scope],
    expectedBehavior: `Query key ${template.id} is constructed from ${template.parts.join(
      ' / ',
    )} and remains stable for ${template.scope.join(', ')} scope consumers.`,
    regressionBudget: budget('cache-consistency'),
    linkedContractIds: SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.filter(endpoint =>
      endpoint.queryKeyIds.includes(template.id),
    ).map(endpoint => contractId('effect-endpoint', endpoint.id)),
  };
}

function mutationKeyRow(
  template: MutationKeyTemplate,
): SuperAppMutationKeyTemplateCoverageRow {
  return {
    contractId: contractId('tanstack-mutation-key', template.id),
    sourceId: template.id,
    kind: 'tanstack-mutation-key',
    parts: [...template.parts],
    endpointId: template.endpointId,
    scope: [...template.scope],
    expectedBehavior: `Mutation key ${template.id} targets ${template.endpointId} with stable parts ${template.parts.join(
      ' / ',
    )}.`,
    regressionBudget: budget('data-integrity'),
    linkedContractIds: [contractId('effect-endpoint', template.endpointId)],
  };
}

function invalidationBoundaryRow(
  boundary: InvalidationBoundary,
): SuperAppInvalidationBoundaryCoverageRow {
  return {
    contractId: contractId('tanstack-invalidation-boundary', boundary.id),
    sourceId: boundary.id,
    kind: 'tanstack-invalidation-boundary',
    endpointId: boundary.endpointId,
    mutationKeyId: boundary.mutationKeyId,
    stateMutation: boundary.stateMutation,
    invalidatesQueryKeyIds: [...boundary.invalidatesQueryKeyIds],
    stateScopes: [...boundary.stateScopes],
    expectedBehavior: boundary.stateMutation
      ? `Accepted ${boundary.endpointId} mutations invalidate ${boundary.invalidatesQueryKeyIds.join(
          ', ',
        )} without leaving stale state scopes ${boundary.stateScopes.join(', ')}.`
      : `${boundary.endpointId} records a read-only decision and refreshes only ${boundary.invalidatesQueryKeyIds.join(
          ', ',
        )}.`,
    regressionBudget: budget(
      boundary.stateMutation ? 'data-integrity' : 'cache-consistency',
    ),
    linkedContractIds: [
      contractId('effect-endpoint', boundary.endpointId),
      contractId('tanstack-mutation-key', boundary.mutationKeyId),
      ...boundary.invalidatesQueryKeyIds.map(id =>
        contractId('tanstack-query-key', id),
      ),
      ...boundary.currentRuntimeRefresh.map(id =>
        contractId('tanstack-route', id),
      ),
    ],
  };
}

function tanStackRouteRow(
  route: TanStackRoute,
): SuperAppTanStackRouteCoverageRow {
  return {
    contractId: contractId('tanstack-route', route.id),
    sourceId: route.id,
    kind: 'tanstack-route',
    path: route.path,
    loaderFields: fieldNames(route.loaderFields),
    bffEndpointIds: [...route.bffEndpointIds],
    queryKeyIds: [...route.queryKeyIds],
    mutationKeyIds: [...route.mutationKeyIds],
    expectedBehavior: `Route ${route.path} loads ${fieldNames(
      route.loaderFields,
    ).join(', ')} and coordinates query keys ${route.queryKeyIds.join(', ')}.`,
    regressionBudget: budget('route-navigation'),
    linkedContractIds: [
      ...route.bffEndpointIds.map(id => contractId('effect-endpoint', id)),
      ...route.queryKeyIds.map(id => contractId('tanstack-query-key', id)),
      ...route.mutationKeyIds.map(id =>
        contractId('tanstack-mutation-key', id),
      ),
    ],
  };
}

function domainRouteRow(
  route: DomainRoute,
): SuperAppPortfolioDomainRouteCoverageRow {
  return {
    contractId: contractId('portfolio-domain-route', route.path),
    sourceId: route.path,
    kind: 'portfolio-domain-route',
    path: route.path,
    ownerAppId: route.ownerAppId,
    tenantId: route.tenantId,
    appKind: route.appKind,
    queryKeyIds: [...route.queryKeyIds],
    expectedBehavior: `Domain route ${route.path} resolves to ${route.ownerAppId} for tenant ${route.tenantId} and reads ${route.queryKeyIds.join(
      ', ',
    )}.`,
    regressionBudget: budget('route-navigation'),
    linkedContractIds: route.queryKeyIds.map(id =>
      contractId('tanstack-query-key', id),
    ),
  };
}

const SCENARIOS: readonly SuperAppEffectTanStackScenarioCoverageRow[] = [
  {
    scenarioId: 'successful-read',
    expectedBehavior:
      'Bootstrap reads return the mapped success fields and seed cache templates without mutating server state.',
    contractIds: [
      contractId('effect-endpoint', 'effect.bootstrap'),
      contractId('tanstack-query-key', 'portfolio.bootstrap'),
      contractId('tanstack-route', '/'),
    ],
    regressionBudget: budget('cache-consistency'),
  },
  {
    scenarioId: 'successful-write',
    expectedBehavior:
      'Workflow and pilot writes return accepted payloads, update summaries, and enter their mapped invalidation boundaries.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('effect-endpoint', 'effect.runPilot'),
      contractId('tanstack-mutation-key', 'portfolio.workflow.run'),
      contractId('tanstack-mutation-key', 'portfolio.pilot.run'),
    ],
    regressionBudget: budget('data-integrity'),
  },
  {
    scenarioId: 'optimistic-mutation',
    expectedBehavior:
      'Client cache may stage pending workflow events before the server accepts and replaces them with committed events.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('tanstack-mutation-key', 'portfolio.workflow.run'),
      contractId('tanstack-invalidation-boundary', 'workflow-event-accepted'),
    ],
    regressionBudget: budget('cache-consistency'),
  },
  {
    scenarioId: 'rollback',
    expectedBehavior:
      'Failed workflow mutations restore the previous cache snapshot and do not invalidate committed query data.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('tanstack-query-key', 'portfolio.events'),
      contractId('tanstack-invalidation-boundary', 'workflow-event-accepted'),
    ],
    regressionBudget: budget('data-integrity'),
  },
  {
    scenarioId: 'duplicate-request-idempotency',
    expectedBehavior:
      'Repeated workflow request ids return the original accepted event as a non-retryable deduped success.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('tanstack-mutation-key', 'portfolio.workflow.run'),
    ],
    regressionBudget: budget('data-integrity'),
  },
  {
    scenarioId: 'abort-cancellation',
    expectedBehavior:
      'Aborted client writes are cancelled before BFF mutation state changes are observed.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('tanstack-mutation-key', 'portfolio.workflow.run'),
    ],
    regressionBudget: budget('resilience'),
  },
  {
    scenarioId: 'timeout',
    expectedBehavior:
      'Downstream timeout envelopes remain retryable, redact context, and leave portfolio state unchanged.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('effect-endpoint', 'effect.injectFailure'),
    ],
    regressionBudget: budget('resilience'),
  },
  {
    scenarioId: 'retry-classification',
    expectedBehavior:
      'Timeouts and throttles classify as retryable while schema and deduped successes classify as non-retryable.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('effect-endpoint', 'effect.injectFailure'),
    ],
    regressionBudget: budget('resilience'),
  },
  {
    scenarioId: 'effect-interruption-finalizers',
    expectedBehavior:
      'Interrupted Effect fibers run scoped async cleanup and release finalizers exactly once.',
    contractIds: [contractId('effect-endpoint', 'effect.runWorkflow')],
    regressionBudget: budget('effect-lifecycle'),
  },
  {
    scenarioId: 'schema-decode-failures',
    expectedBehavior:
      'Malformed workflow, pilot, and security requests fail decode before handlers mutate state.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('effect-endpoint', 'effect.runPilot'),
      contractId('effect-endpoint', 'effect.securityProbe'),
    ],
    regressionBudget: budget('schema-boundary'),
  },
  {
    scenarioId: 'structured-defects',
    expectedBehavior:
      'Structured Effect defects remain observable to the server suite without leaking request context or mutating state.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runPilot'),
      contractId('effect-endpoint', 'effect.securityProbe'),
    ],
    regressionBudget: budget('effect-lifecycle'),
  },
  {
    scenarioId: 'request-context-propagation',
    expectedBehavior:
      'Workflow, pilot, security, and chaos handlers propagate request ids, tenant headers, actor fields, and redacted security context.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('effect-endpoint', 'effect.runPilot'),
      contractId('effect-endpoint', 'effect.securityProbe'),
      contractId('effect-endpoint', 'effect.injectFailure'),
    ],
    regressionBudget: budget('request-context'),
  },
  {
    scenarioId: 'navigation-invalidation',
    expectedBehavior:
      'Workflow mutation invalidation marks active app routes stale and requires fresh route data before rendering committed state.',
    contractIds: [
      contractId('tanstack-route', '/apps/$appId'),
      contractId('tanstack-invalidation-boundary', 'workflow-event-accepted'),
      contractId('tanstack-query-key', 'portfolio.app.detail'),
    ],
    regressionBudget: budget('route-navigation'),
  },
  {
    scenarioId: 'stale-data',
    expectedBehavior:
      'Expired app detail data is treated as stale until bootstrap refetch refreshes the route cache.',
    contractIds: [
      contractId('tanstack-query-key', 'portfolio.app.detail'),
      contractId('tanstack-query-key', 'portfolio.summary'),
      contractId('tanstack-route', '/apps/$appId'),
    ],
    regressionBudget: budget('cache-consistency'),
  },
  {
    scenarioId: 'prefetch',
    expectedBehavior:
      'App navigation prefetch populates bootstrap and app detail query keys before route activation.',
    contractIds: [
      contractId('tanstack-route', '/apps/$appId'),
      contractId('tanstack-query-key', 'portfolio.bootstrap'),
      contractId('tanstack-query-key', 'portfolio.app.detail'),
    ],
    regressionBudget: budget('route-navigation'),
  },
  {
    scenarioId: 'tenant-switch',
    expectedBehavior:
      'Tenant switches retain only app detail caches belonging to the selected tenant boundary.',
    contractIds: [
      contractId('tanstack-query-key', 'portfolio.app.detail'),
      contractId('portfolio-domain-route', '/mobility'),
      contractId('portfolio-domain-route', '/mega-erp'),
    ],
    regressionBudget: budget('cache-consistency'),
  },
  {
    scenarioId: 'offline-to-online-recovery',
    expectedBehavior:
      'Queued offline mutations replay after online recovery, commit once, and invalidate workflow query keys.',
    contractIds: [
      contractId('effect-endpoint', 'effect.runWorkflow'),
      contractId('tanstack-mutation-key', 'portfolio.workflow.run'),
      contractId('tanstack-invalidation-boundary', 'workflow-event-accepted'),
    ],
    regressionBudget: budget('resilience'),
  },
] as const;

function createSourceMapIds() {
  return {
    effectEndpointIds: SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(
      endpoint => endpoint.id,
    ),
    queryKeyTemplateIds: SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(
      template => template.id,
    ),
    mutationKeyTemplateIds: SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES.map(
      template => template.id,
    ),
    invalidationBoundaryIds: SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES.map(
      boundary => boundary.id,
    ),
    tanStackRouteIds: SUPERAPP_TANSTACK_ROUTE_CONTRACTS.map(route => route.id),
    portfolioDomainRouteIds: SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS.map(
      route => route.path,
    ),
  };
}

export function createSuperAppEffectTanStackContractCoverageArtifact(): SuperAppEffectTanStackCoverageArtifact {
  const contracts = {
    effectEndpoints: SUPERAPP_EFFECT_BFF_ENDPOINT_CONTRACTS.map(endpointRow),
    queryKeyTemplates: SUPERAPP_TANSTACK_QUERY_KEY_TEMPLATES.map(queryKeyRow),
    mutationKeyTemplates:
      SUPERAPP_TANSTACK_MUTATION_KEY_TEMPLATES.map(mutationKeyRow),
    invalidationBoundaries: SUPERAPP_TANSTACK_INVALIDATION_BOUNDARIES.map(
      invalidationBoundaryRow,
    ),
    tanStackRoutes: SUPERAPP_TANSTACK_ROUTE_CONTRACTS.map(tanStackRouteRow),
    portfolioDomainRoutes:
      SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS.map(domainRouteRow),
  };
  const contractRows = [
    ...contracts.effectEndpoints,
    ...contracts.queryKeyTemplates,
    ...contracts.mutationKeyTemplates,
    ...contracts.invalidationBoundaries,
    ...contracts.tanStackRoutes,
    ...contracts.portfolioDomainRoutes,
  ];
  const sourceMapIds = createSourceMapIds();
  const artifactWithoutFingerprint = {
    artifactVersion: ARTIFACT_VERSION,
    artifactSeed: ARTIFACT_SEED,
    sourceMapFingerprint: fingerprintFor(sourceMapIds),
    summary: {
      effectEndpointCount: contracts.effectEndpoints.length,
      queryKeyTemplateCount: contracts.queryKeyTemplates.length,
      mutationKeyTemplateCount: contracts.mutationKeyTemplates.length,
      invalidationBoundaryCount: contracts.invalidationBoundaries.length,
      tanStackRouteCount: contracts.tanStackRoutes.length,
      portfolioDomainRouteCount: contracts.portfolioDomainRoutes.length,
      contractRowCount: contractRows.length,
      scenarioCount: SCENARIOS.length,
    },
    sourceMapIds,
    contractRows,
    contracts,
    scenarioRows: SCENARIOS.map(scenario => ({
      ...scenario,
      contractIds: [...scenario.contractIds],
    })),
    compactness: {
      fullSourceContractsOmitted: true as const,
      includesOnlyIdsTemplatesBudgetsAndExpectedBehavior: true as const,
      omittedPaths: [
        'effectEndpoint.params',
        'effectEndpoint.headers',
        'effectEndpoint.payload',
        'effectEndpoint.sourceFile',
        'effectEndpoint.handler',
        'tanStackRoute.sourceFiles',
        'artifactLinkIds',
      ],
    },
  };

  return clone({
    ...artifactWithoutFingerprint,
    fingerprint: fingerprintFor(artifactWithoutFingerprint),
  });
}

export function serializeSuperAppEffectTanStackContractCoverageArtifact(
  artifact: SuperAppEffectTanStackCoverageArtifact,
) {
  return `${stableStringify(artifact)}\n`;
}
