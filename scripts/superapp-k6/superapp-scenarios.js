import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

import './scenario-catalog.js';

const catalogApi = globalThis.SUPERAPP_K6_CATALOG_API;
const selectedScenarioIds = catalogApi.normalizeScenarioSelection(
  __ENV.SUPERAPP_K6_SCENARIO || 'smoke',
);
const thresholdProfile = catalogApi.normalizeLoadThresholdProfile(
  __ENV.SUPERAPP_K6_THRESHOLD_PROFILE || 'smoke',
);

export const options = catalogApi.buildK6OptionsForScenarios(
  selectedScenarioIds,
  thresholdProfile,
);

const operationDuration = new Trend('superapp_operation_duration', true);
const operationFailed = new Rate('superapp_operation_failed');
const operationCount = new Counter('superapp_operation_count');

export function setup() {
  return {
    artifactLinks: catalogApi.getArtifactLinks(),
    baseUrl: trimBaseUrl(
      __ENV.SUPERAPP_K6_BASE_URL || __ENV.BASE_URL || 'http://localhost:8080',
    ),
    runId: __ENV.SUPERAPP_K6_RUN_ID || 'superapp-k6-local',
    scenarioIds: selectedScenarioIds,
    thresholdProfile,
  };
}

export function workload(data) {
  const scenario = catalogApi.getScenarioDefinition(exec.scenario.name);
  const iteration =
    exec.scenario.iterationInTest +
    exec.vu.idInTest * scenario.operations.length;
  const operation = catalogApi.selectWeightedOperation(scenario, iteration);
  const context = createRequestContext(data, scenario, operation, iteration);
  const request = createRequest(data.baseUrl, operation, context);
  const response = http.request(
    operation.method,
    request.url,
    request.body,
    request.params,
  );
  const tags = {
    superapp_operation: operation.id,
    superapp_operation_kind: operation.kind,
    superapp_scenario: scenario.id,
    superapp_workload_profile: operation.workloadProfileId || 'none',
  };
  const ok = statusMatches(response.status, operation.expectedStatus || [200]);

  operationDuration.add(response.timings.duration, tags);
  operationFailed.add(!ok, tags);
  operationCount.add(1, tags);

  check(
    response,
    {
      [`${scenario.id}:${operation.id} expected status`]: () => ok,
    },
    tags,
  );

  sleep(operation.sleepSeconds || scenario.sleepSeconds || 0.2);
}

export default workload;

function trimBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function createRequestContext(data, scenario, operation, iteration) {
  const vu = exec.vu.idInTest;
  const requestId = [
    data.runId,
    scenario.id,
    operation.id,
    `vu${vu}`,
    `it${iteration}`,
  ].join('-');

  return {
    artifactCatalogSeed: data.artifactLinks.workloadCatalog.seed,
    iteration,
    operationId: operation.id,
    requestId,
    runId: data.runId,
    scenarioId: scenario.id,
    vu,
  };
}

function createRequest(baseUrl, operation, context) {
  const body =
    operation.bodyTemplate === undefined
      ? null
      : JSON.stringify(materializeTemplate(operation.bodyTemplate, context));
  const headers = materializeTemplate(operation.headers || {}, context);
  const params = {
    headers: {
      ...headers,
      'x-request-id': context.requestId,
      'x-superapp-k6-operation': operation.id,
      'x-superapp-k6-scenario': context.scenarioId,
      'x-superapp-workload-catalog-seed': context.artifactCatalogSeed,
    },
    tags: {
      superapp_operation: operation.id,
      superapp_operation_kind: operation.kind,
      superapp_scenario: context.scenarioId,
    },
    timeout: operation.timeout || '10s',
  };

  return {
    body,
    params,
    url: `${baseUrl}${materializeTemplate(operation.path, context)}`,
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

function statusMatches(status, expectedStatus) {
  if (Array.isArray(expectedStatus)) {
    return expectedStatus.includes(status);
  }

  if (typeof expectedStatus === 'number') {
    return status === expectedStatus;
  }

  if (expectedStatus && typeof expectedStatus === 'object') {
    const min = expectedStatus.min ?? 100;
    const max = expectedStatus.max ?? 599;
    return status >= min && status <= max;
  }

  return false;
}
