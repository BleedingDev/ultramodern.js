const {
  getArtifactLinks,
  getScenarioDefinition,
} = require('./scenario-catalog');

const DEFAULT_AUTOCANNON_CONNECTIONS = 64;
const DEFAULT_AUTOCANNON_DURATION_SECONDS = 30;
const DEFAULT_AUTOCANNON_PIPELINING = 1;
const DEFAULT_AUTOCANNON_TIMEOUT_SECONDS = 10;
const DEFAULT_AUTOCANNON_WORKERS = 4;

const PROBE_BLUEPRINTS = [
  {
    id: 'get-bootstrap',
    label: 'GET bootstrap BFF',
    role: 'read-bff-control-plane',
    scenarioId: 'smoke',
    operationId: 'bootstrap',
    classificationHint:
      'BFF bootstrap read saturation; unexpected status codes usually point at server capacity before client socket pressure.',
  },
  {
    id: 'get-root-route',
    label: 'GET shell root route',
    role: 'read-shell-route',
    scenarioId: 'smoke',
    operationId: 'root-route',
    autocannon: {
      connections: 96,
    },
    classificationHint:
      'Static shell route pressure; socket errors without non-2xx responses are more likely load-client or connection-pool limits.',
  },
  {
    id: 'get-ledger-search',
    label: 'GET ledger search/filter/sort',
    role: 'read-search-filter-sort',
    scenarioId: 'mixed-read-write',
    operationId: 'mixed-ledger-search',
    classificationHint:
      'Search/filter/sort read path pressure for query-heavy ledger pages.',
  },
  {
    id: 'get-chat-page',
    label: 'GET chat cursor page',
    role: 'read-pagination',
    scenarioId: 'chat',
    operationId: 'chat-page-before',
    classificationHint: 'Cursor pagination pressure for chat history windows.',
  },
  {
    id: 'post-workflow',
    label: 'POST mobility workflow',
    role: 'write-workflow',
    scenarioId: 'mixed-read-write',
    operationId: 'mixed-mobility-workflow',
    autocannon: {
      connections: 48,
    },
    classificationHint:
      'Workflow write pressure; server-side non-2xx responses are separated from client/socket failures.',
  },
  {
    id: 'post-pilot-run',
    label: 'POST pilot scenario run',
    role: 'write-pilot',
    scenarioId: 'mixed-read-write',
    operationId: 'mixed-grab-marketplace',
    autocannon: {
      connections: 48,
    },
    classificationHint:
      'Cross-app pilot write pressure through the main BFF write path.',
  },
  {
    id: 'post-security-probe',
    label: 'POST tenant security probe',
    role: 'write-tenant-probe',
    scenarioId: 'tenant-boundary',
    operationId: 'tenant-security-allowed',
    autocannon: {
      connections: 40,
    },
    classificationHint:
      'Tenant-boundary probe pressure with auth/origin headers preserved from the k6 catalog.',
  },
  {
    id: 'post-reset-state',
    label: 'POST reset state',
    role: 'write-reset',
    scenarioId: 'reset',
    operationId: 'reset-state',
    autocannon: {
      connections: 24,
      durationSeconds: 15,
    },
    classificationHint:
      'Reset endpoint pressure kept shorter because it is a state-management path, not a default PR threshold.',
  },
];

const PROBE_BLUEPRINT_BY_ID = new Map(
  PROBE_BLUEPRINTS.map(blueprint => [blueprint.id, blueprint]),
);

function getAutocannonProbeCatalog() {
  const probes = PROBE_BLUEPRINTS.map(createProbeDefinition);
  return clone({
    schemaVersion: 1,
    catalogId: 'superapp-autocannon-probes-v1',
    defaultProbeIds: probes.map(probe => probe.id),
    workerModel: {
      mode: 'multi-worker',
      defaultWorkers: DEFAULT_AUTOCANNON_WORKERS,
      defaultConnections: DEFAULT_AUTOCANNON_CONNECTIONS,
      defaultDurationSeconds: DEFAULT_AUTOCANNON_DURATION_SECONDS,
      defaultPipelining: DEFAULT_AUTOCANNON_PIPELINING,
      defaultTimeoutSeconds: DEFAULT_AUTOCANNON_TIMEOUT_SECONDS,
      purpose:
        'Run endpoint probes with autocannon worker threads so artifacts can separate server HTTP failures from load-client/socket failures.',
    },
    probes,
  });
}

function getAutocannonProbeIds() {
  return PROBE_BLUEPRINTS.map(blueprint => blueprint.id);
}

function getAutocannonProbeDefinition(id) {
  const blueprint = PROBE_BLUEPRINT_BY_ID.get(id);
  if (!blueprint) {
    throw new Error(`Unknown SuperApp autocannon probe: ${id}`);
  }
  return clone(createProbeDefinition(blueprint));
}

function normalizeAutocannonProbeSelection(selection) {
  const rawSelection = Array.isArray(selection)
    ? selection
    : String(selection || 'all').split(',');
  const normalized = rawSelection
    .map(item => String(item).trim())
    .filter(Boolean);

  if (normalized.length === 0 || normalized.includes('all')) {
    return getAutocannonProbeIds();
  }

  for (const id of normalized) {
    if (!PROBE_BLUEPRINT_BY_ID.has(id)) {
      throw new Error(
        `Unknown SuperApp autocannon probe "${id}". Use one of: ${getAutocannonProbeIds().join(
          ', ',
        )}, all`,
      );
    }
  }

  return [...new Set(normalized)];
}

function buildAutocannonProbeRequest(probe, input = {}) {
  const context = createRequestContext(probe, input);
  const body =
    probe.operation.bodyTemplate === undefined
      ? undefined
      : JSON.stringify(
          materializeTemplate(probe.operation.bodyTemplate, context),
        );
  const headers = {
    ...materializeTemplate(probe.operation.headers || {}, context),
    'x-request-id': context.requestId,
    'x-superapp-autocannon-probe': probe.id,
    'x-superapp-autocannon-worker-model': 'multi-worker',
    'x-superapp-k6-operation': probe.operation.id,
    'x-superapp-k6-scenario': probe.scenarioId,
    'x-superapp-workload-catalog-seed': context.artifactCatalogSeed,
  };

  return {
    body,
    bodyBytes: body === undefined ? 0 : Buffer.byteLength(body),
    headers,
    method: probe.endpoint.method,
    path: materializeTemplate(probe.endpoint.path, context),
  };
}

function buildAutocannonCliArgs(probe, input = {}) {
  const request = buildAutocannonProbeRequest(probe, input);
  const autocannon = {
    ...probe.autocannon,
    workers: input.workers || probe.autocannon.workers,
    connections: input.connections || probe.autocannon.connections,
    durationSeconds: input.durationSeconds || probe.autocannon.durationSeconds,
    pipelining: input.pipelining || probe.autocannon.pipelining,
    timeoutSeconds: input.timeoutSeconds || probe.autocannon.timeoutSeconds,
  };
  const args = [
    '--json',
    '--method',
    request.method,
    '--connections',
    String(autocannon.connections),
    '--duration',
    String(autocannon.durationSeconds),
    '--pipelining',
    String(autocannon.pipelining),
    '--workers',
    String(autocannon.workers),
    '--timeout',
    String(autocannon.timeoutSeconds),
    '--headers',
    JSON.stringify(request.headers),
  ];

  if (request.body !== undefined) {
    args.push('--body', request.body);
  }

  args.push(`${trimBaseUrl(input.baseUrl)}${request.path}`);

  return {
    args,
    autocannon,
    request,
  };
}

function validateAutocannonProbeCatalog(catalog = getAutocannonProbeCatalog()) {
  const ids = new Set();
  const methodCounts = {
    GET: 0,
    POST: 0,
  };
  const errors = [];

  for (const probe of catalog.probes) {
    if (ids.has(probe.id)) {
      errors.push(`Autocannon probe ids must be unique: ${probe.id}`);
    }
    ids.add(probe.id);

    if (!probe.endpoint.method || !probe.endpoint.path) {
      errors.push(`${probe.id} must declare endpoint method and path`);
    }
    if (
      !Number.isFinite(probe.autocannon.workers) ||
      probe.autocannon.workers < 2
    ) {
      errors.push(`${probe.id} must use at least two autocannon workers`);
    }
    if (
      !Number.isFinite(probe.autocannon.connections) ||
      probe.autocannon.connections <= 0
    ) {
      errors.push(`${probe.id} must declare positive connections`);
    }
    if (methodCounts[probe.endpoint.method] !== undefined) {
      methodCounts[probe.endpoint.method] += 1;
    }
  }

  if (methodCounts.GET === 0 || methodCounts.POST === 0) {
    errors.push('Autocannon probe catalog must include GET and POST probes');
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid SuperApp autocannon probe catalog:\n${errors.join('\n')}`,
    );
  }

  return true;
}

function createProbeDefinition(blueprint) {
  const scenario = getScenarioDefinition(blueprint.scenarioId);
  const operation = scenario.operations.find(
    item => item.id === blueprint.operationId,
  );
  if (!operation) {
    throw new Error(
      `Autocannon probe ${blueprint.id} references missing operation ${blueprint.scenarioId}:${blueprint.operationId}`,
    );
  }

  return {
    id: blueprint.id,
    label: blueprint.label,
    role: blueprint.role,
    scenarioId: blueprint.scenarioId,
    operationId: blueprint.operationId,
    classificationHint: blueprint.classificationHint,
    endpoint: {
      method: operation.method,
      path: operation.path,
      expectedStatus: operation.expectedStatus || [200],
      kind: operation.kind,
      workloadProfileId: operation.workloadProfileId,
      artifactLinkIds: operation.artifactLinkIds || [],
      sampleSelectorIds: operation.sampleSelectorIds || [],
    },
    autocannon: {
      connections: DEFAULT_AUTOCANNON_CONNECTIONS,
      durationSeconds: DEFAULT_AUTOCANNON_DURATION_SECONDS,
      pipelining: DEFAULT_AUTOCANNON_PIPELINING,
      timeoutSeconds: DEFAULT_AUTOCANNON_TIMEOUT_SECONDS,
      workers: DEFAULT_AUTOCANNON_WORKERS,
      ...blueprint.autocannon,
      workerModel: 'multi-worker',
    },
    operation: {
      id: operation.id,
      bodyTemplate: operation.bodyTemplate,
      headers: operation.headers,
      method: operation.method,
      path: operation.path,
    },
  };
}

function createRequestContext(probe, input = {}) {
  const artifactLinks = getArtifactLinks();
  const runId = input.runId || 'superapp-autocannon-local';
  return {
    artifactCatalogSeed: artifactLinks.workloadCatalog.seed,
    operationId: probe.operationId,
    requestId: `${runId}-${probe.id}`,
    runId,
    scenarioId: probe.scenarioId,
  };
}

function materializeTemplate(value, context) {
  if (Array.isArray(value)) {
    return value.map(item => materializeTemplate(item, context));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        materializeTemplate(item, context),
      ]),
    );
  }

  if (typeof value !== 'string') {
    return value;
  }

  return value.replace(/\{\{([^}]+)\}\}/g, (_match, key) =>
    String(context[key] || ''),
  );
}

function trimBaseUrl(value) {
  return String(value || 'http://localhost:8080').replace(/\/+$/, '');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  DEFAULT_AUTOCANNON_CONNECTIONS,
  DEFAULT_AUTOCANNON_DURATION_SECONDS,
  DEFAULT_AUTOCANNON_PIPELINING,
  DEFAULT_AUTOCANNON_TIMEOUT_SECONDS,
  DEFAULT_AUTOCANNON_WORKERS,
  buildAutocannonCliArgs,
  buildAutocannonProbeRequest,
  getAutocannonProbeCatalog,
  getAutocannonProbeDefinition,
  getAutocannonProbeIds,
  normalizeAutocannonProbeSelection,
  validateAutocannonProbeCatalog,
};
