import dns from 'node:dns';
import path from 'node:path';
import { buildFixtureOnce } from '../../../utils/fixtureBuild';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import {
  createSuperAppWorkloadChaosFailureTaxonomy,
  type WorkloadChaosFailureCase,
} from '../shared/workload-chaos-failure-taxonomy';
import {
  defaultEndpointForChaosFailure,
  type SuperAppChaosToggleEndpoint,
} from '../shared/workload-chaos-toggles';

dns.setDefaultResultOrder('ipv4first');
setSuiteTimeout(1000 * 60 * 8);

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const fullModuleSet = [
  'rides',
  'dispatch',
  'orders',
  'erp',
  'chat',
  'mf-remotes',
  'security',
  'billing',
];
const workflowAppByTenant: Record<string, string> = {
  'superapp-global': 'mobility-marketplace',
  'city-ops-eu': 'mobility-marketplace',
  'acme-global': 'enterprise-mega-erp',
  'platform-shell': 'mf-platform',
  'security-root': 'tenant-security',
  'chaos-lab': 'failure-lab',
};
const moderateLoadTenants = [
  'superapp-global',
  'city-ops-eu',
  'acme-global',
  'platform-shell',
  'security-root',
  'chaos-lab',
] as const;

type ChaosTargetRequest = {
  endpoint: SuperAppChaosToggleEndpoint;
  pathname: string;
  requestId: string;
  tenantId: string;
  body?: Record<string, unknown>;
  rawBody?: string;
  headers?: Record<string, string>;
};

type JsonResponseResult = {
  name: string;
  response: Response;
  payload: unknown;
};

async function postJson(
  port: number,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${host}:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function postRaw(
  port: number,
  pathname: string,
  body: string,
  headers: Record<string, string> = {},
) {
  return fetch(`${host}:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
}

async function getBootstrap(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/bootstrap`);
  expect(response.status).toBe(200);
  return response.json();
}

async function resetPortfolio(port: number) {
  const response = await postJson(port, '/bff-api/effect/reset');
  expect(response.status).toBe(200);
  return response.json();
}

function workflowPathForTenant(tenantId: string) {
  const appId = workflowAppByTenant[tenantId] ?? 'mobility-marketplace';
  return `/bff-api/effect/apps/${appId}/workflow`;
}

async function runWorkflow(
  port: number,
  requestId: string,
  tenantId = 'city-ops-eu',
) {
  return postJson(
    port,
    workflowPathForTenant(tenantId),
    {
      action: 'quote',
      actor: 'chaos.toggle.test',
      requestId,
    },
    {
      'x-tenant-id': tenantId,
    },
  );
}

async function runPilot(port: number, requestId: string) {
  return postJson(port, '/bff-api/effect/pilot/grab-marketplace/run', {
    tenant: 'superapp-global',
    actor: 'chaos.load.test',
    requestId,
    modules: fullModuleSet,
    chaos: 'none',
  });
}

async function runSecurityProbe(port: number, requestId: string) {
  return postJson(
    port,
    '/bff-api/effect/security/probe',
    {
      targetTenant: 'security-root',
      targetAppId: 'tenant-security',
      action: 'policy.audit',
      requestId,
      mutation: true,
    },
    {
      authorization: 'Bearer chaos-load-token',
      origin: `${host}:${port}`,
      'x-csrf-token': 'superapp-valid-csrf',
      'x-tenant-id': 'security-root',
      'x-user-role': 'security-admin',
    },
  );
}

async function collectJsonResponse(
  name: string,
  responsePromise: Promise<Response>,
): Promise<JsonResponseResult> {
  const response = await responsePromise;
  return {
    name,
    response,
    payload: await response.json(),
  };
}

async function armChaosToggle(
  port: number,
  failureId: string,
  body: Record<string, unknown>,
) {
  return postJson(port, `/bff-api/effect/failure/${failureId}`, {
    actor: 'chaos.operator',
    reason: 'focused chaos toggle test',
    ...body,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPath(value: unknown, pathName: string) {
  return pathName.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[segment];
  }, value);
}

function securityAppForTenant(tenantId: string) {
  return workflowAppByTenant[tenantId] ?? 'tenant-security';
}

function createSecurityHeaders(
  port: number,
  failure: WorkloadChaosFailureCase,
) {
  return {
    authorization:
      failure.kind === 'auth-expiry'
        ? 'Bearer expired.jwt'
        : 'Bearer chaos-envelope-token',
    origin: `${host}:${port}`,
    'x-csrf-token': 'superapp-valid-csrf',
    'x-tenant-id': failure.tenantSafety.sourceTenantId,
    'x-user-role':
      failure.kind === 'tenant-violation'
        ? 'finance-approver'
        : 'security-admin',
  };
}

function createChaosTargetRequest(
  port: number,
  failure: WorkloadChaosFailureCase,
): ChaosTargetRequest {
  const endpoint = defaultEndpointForChaosFailure(failure);
  const requestId = failure.deterministicInput.requestId;
  const tenantId = failure.tenantSafety.sourceTenantId;

  if (endpoint === 'portfolio.pilot') {
    return {
      endpoint,
      requestId,
      tenantId,
      pathname: '/bff-api/effect/pilot/grab-marketplace/run',
      headers: {
        'x-tenant-id': tenantId,
      },
      body: {
        tenant: tenantId,
        actor: 'chaos.envelope.test',
        requestId,
        modules: fullModuleSet,
        chaos: 'none',
      },
    };
  }

  if (endpoint === 'portfolio.security') {
    const targetTenantId = failure.tenantSafety.targetTenantId;
    return {
      endpoint,
      requestId,
      tenantId,
      pathname: '/bff-api/effect/security/probe',
      headers: createSecurityHeaders(port, failure),
      body: {
        targetTenant: targetTenantId,
        targetAppId: securityAppForTenant(targetTenantId),
        action: failure.operationHint,
        requestId,
        mutation: true,
      },
    };
  }

  const pathname = workflowPathForTenant(tenantId);
  if (failure.kind === 'malformed-json') {
    return {
      endpoint,
      requestId,
      tenantId,
      pathname,
      headers: {
        'x-tenant-id': tenantId,
      },
      rawBody: `{"requestId":"${requestId}","tenant":"${tenantId}"`,
    };
  }

  return {
    endpoint,
    requestId,
    tenantId,
    pathname,
    headers: {
      'x-tenant-id': tenantId,
    },
    body: {
      action: failure.operationHint,
      actor: 'chaos.envelope.test',
      requestId,
    },
  };
}

function invokeChaosTarget(port: number, target: ChaosTargetRequest) {
  if (target.rawBody !== undefined) {
    return postRaw(port, target.pathname, target.rawBody, target.headers);
  }

  return postJson(port, target.pathname, target.body, target.headers);
}

function invokeHealthyEquivalentTarget(
  port: number,
  target: ChaosTargetRequest,
) {
  if (target.endpoint === 'portfolio.pilot') {
    return runPilot(port, target.requestId);
  }

  if (target.endpoint === 'portfolio.security') {
    return runSecurityProbe(port, target.requestId);
  }

  return runWorkflow(port, target.requestId, target.tenantId);
}

function assertNoForbiddenEnvelopeData(
  payload: unknown,
  failure: WorkloadChaosFailureCase,
) {
  const serialized = JSON.stringify(payload);
  for (const fieldPath of failure.expectedErrorEnvelope.forbiddenFields) {
    expect(readPath(payload, fieldPath)).toBeUndefined();
  }
  for (const forbidden of failure.telemetryRedaction.forbiddenRawSubstrings) {
    expect(serialized).not.toContain(forbidden);
  }
  if (
    failure.tenantSafety.expectedTenantViolation &&
    failure.tenantSafety.targetTenantId !== failure.tenantSafety.sourceTenantId
  ) {
    expect(readPath(payload, 'error.tenantId')).toBe(
      failure.tenantSafety.sourceTenantId,
    );
    expect(readPath(payload, 'error.targetTenantRecords')).toBeUndefined();
  }
}

function assertChaosErrorEnvelope(
  payload: unknown,
  failure: WorkloadChaosFailureCase,
  target: ChaosTargetRequest,
) {
  for (const fieldPath of failure.expectedErrorEnvelope.requiredFields) {
    expect(
      readPath(payload, fieldPath),
      `${failure.id} response omitted required field ${fieldPath}: ${JSON.stringify(payload)}`,
    ).not.toBeUndefined();
  }

  const expectedErrorKeys = [
    'applicationStatus',
    'code',
    'failureId',
    'httpStatus',
    'kind',
    'message',
    'messageKey',
    'requestId',
    'resetRequired',
    'responseKind',
    'retryable',
    'tenantId',
  ];
  if (failure.expectedStatus.retryAfterMs !== undefined) {
    expectedErrorKeys.push('retryAfterMs');
  }

  expect(
    Object.keys(readPath(payload, 'error') as Record<string, unknown>),
  ).toEqual(expect.arrayContaining(expectedErrorKeys));
  expect(payload).toMatchObject({
    error: {
      code: failure.expectedErrorEnvelope.code,
      message: failure.label,
      messageKey: failure.expectedErrorEnvelope.messageKey,
      requestId: target.requestId,
      failureId: failure.id,
      kind: failure.kind,
      tenantId: failure.tenantSafety.sourceTenantId,
      retryable: failure.expectedStatus.retryable,
      resetRequired: failure.resetExpectation.required,
      httpStatus: failure.expectedStatus.httpStatus,
      applicationStatus: failure.expectedStatus.applicationStatus,
      responseKind: failure.expectedStatus.responseKind,
      ...(failure.expectedStatus.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: failure.expectedStatus.retryAfterMs }),
    },
    chaos: {
      id: failure.id,
      kind: failure.kind,
      status: 'consumed',
      targetRequestId: target.requestId,
      targetEndpoint: target.endpoint,
      expectedHttpStatus: failure.expectedStatus.httpStatus,
      errorCode: failure.expectedErrorEnvelope.code,
      retryable: failure.expectedStatus.retryable,
      resetRequired: failure.resetExpectation.required,
    },
  });
  assertNoForbiddenEnvelopeData(payload, failure);
}

function assertHealthyPayloadWasNotPoisoned(payload: unknown) {
  expect(readPath(payload, 'error')).toBeUndefined();
  expect(readPath(payload, 'chaos')).toBeUndefined();

  const failureMode = readPath(payload, 'summary.failureMode');
  if (failureMode !== undefined) {
    expect(failureMode).toBe('healthy');
  }
}

async function runModerateHealthyLoad(
  port: number,
  failureIndex: number,
  targetResult: Promise<JsonResponseResult>,
) {
  const healthyRequests = moderateLoadTenants.map((tenantId, tenantIndex) =>
    collectJsonResponse(
      `workflow:${tenantId}`,
      runWorkflow(
        port,
        `load-healthy-workflow-${failureIndex}-${tenantIndex}`,
        tenantId,
      ),
    ),
  );

  healthyRequests.push(
    collectJsonResponse(
      'pilot:superapp-global',
      runPilot(port, `load-healthy-pilot-${failureIndex}`),
    ),
    collectJsonResponse(
      'security:security-root',
      runSecurityProbe(port, `load-healthy-security-${failureIndex}`),
    ),
  );

  const [chaosResult, ...healthyResults] = await Promise.all([
    targetResult,
    ...healthyRequests,
  ]);

  for (const result of healthyResults) {
    expect(result.response.status, result.name).toBe(200);
    assertHealthyPayloadWasNotPoisoned(result.payload);
  }

  return chaosResult;
}

describe('superapp portfolio chaos toggles', () => {
  let port: number;
  let app: Awaited<ReturnType<typeof modernServe>> | undefined;

  beforeAll(async () => {
    const build = await buildFixtureOnce(appDir, {
      build: () => modernBuild(appDir),
    });
    expect(build.code).toBe(0);
    port = await getPort();
    app = await modernServe(appDir, port, {
      cwd: appDir,
      stderr: false,
      stdout: false,
    });
  });

  afterAll(async () => {
    await killApp(app);
  });

  beforeEach(async () => {
    await resetPortfolio(port);
  });

  test('arms a request-scoped taxonomy toggle without affecting healthy workflow traffic', async () => {
    const armedResponse = await armChaosToggle(
      port,
      'chaos.downstream-timeout.v1',
      {
        requestId: 'arm-downstream-timeout',
        targetRequestId: 'workflow-timeout-target',
        targetEndpoint: 'portfolio.workflow',
      },
    );
    expect(armedResponse.status).toBe(200);
    await expect(armedResponse.json()).resolves.toMatchObject({
      failureMode: 'healthy',
      chaosToggle: {
        id: 'chaos.downstream-timeout.v1',
        kind: 'downstream-timeout',
        status: 'armed',
        scope: 'request',
        targetRequestId: 'workflow-timeout-target',
        targetEndpoint: 'portfolio.workflow',
        expectedHttpStatus: 504,
        errorCode: 'DOWNSTREAM_TIMEOUT',
        legacyFailureMode: 'api-timeout',
        retryable: true,
        resetRequired: true,
      },
      summary: {
        failureMode: 'healthy',
        eventCount: 1,
      },
    });

    const afterArm = await getBootstrap(port);
    expect(afterArm.summary).toMatchObject({
      failureMode: 'healthy',
      eventCount: 1,
    });

    const healthyResponse = await runWorkflow(port, 'workflow-healthy-control');
    expect(healthyResponse.status).toBe(200);
    await expect(healthyResponse.json()).resolves.toMatchObject({
      event: {
        requestId: 'workflow-healthy-control',
        status: 'accepted',
      },
      summary: {
        eventCount: 2,
        failureMode: 'healthy',
      },
    });

    const failureResponse = await runWorkflow(port, 'workflow-timeout-target');
    expect(failureResponse.status).toBe(504);
    await expect(failureResponse.json()).resolves.toMatchObject({
      error: {
        code: 'DOWNSTREAM_TIMEOUT',
        failureId: 'chaos.downstream-timeout.v1',
        requestId: 'workflow-timeout-target',
        tenantId: 'city-ops-eu',
        retryable: true,
        resetRequired: true,
        httpStatus: 504,
        applicationStatus: 'failed',
      },
      chaos: {
        id: 'chaos.downstream-timeout.v1',
        status: 'consumed',
        targetEndpoint: 'portfolio.workflow',
      },
    });

    const afterFailure = await getBootstrap(port);
    expect(afterFailure.summary).toMatchObject({
      failureMode: 'healthy',
      eventCount: 2,
    });

    const consumedResponse = await runWorkflow(port, 'workflow-timeout-target');
    expect(consumedResponse.status).toBe(200);
    await expect(consumedResponse.json()).resolves.toMatchObject({
      event: {
        requestId: 'workflow-timeout-target',
        status: 'accepted',
      },
      summary: {
        eventCount: 3,
        failureMode: 'healthy',
      },
    });
  });

  test('keeps resettable toggles active until portfolio reset clears them', async () => {
    const armedResponse = await armChaosToggle(port, 'chaos.retry-storm.v1', {
      targetRequestId: 'workflow-retry-storm',
      targetEndpoint: 'portfolio.workflow',
      scope: 'until-reset',
    });
    expect(armedResponse.status).toBe(200);
    await expect(armedResponse.json()).resolves.toMatchObject({
      chaosToggle: {
        id: 'chaos.retry-storm.v1',
        scope: 'until-reset',
        targetRequestId: 'workflow-retry-storm',
        expectedHttpStatus: 429,
        errorCode: 'RETRY_STORM',
      },
      summary: {
        failureMode: 'healthy',
        eventCount: 1,
      },
    });

    for (const attempt of [1, 2]) {
      const response = await runWorkflow(port, 'workflow-retry-storm');
      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'RETRY_STORM',
          failureId: 'chaos.retry-storm.v1',
          requestId: 'workflow-retry-storm',
          retryable: true,
          resetRequired: true,
          httpStatus: 429,
        },
        chaos: {
          scope: 'until-reset',
          attemptCount: 8,
        },
      });
      expect(attempt).toBeGreaterThan(0);
    }

    await resetPortfolio(port);
    const recovered = await runWorkflow(port, 'workflow-retry-storm');
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toMatchObject({
      event: {
        requestId: 'workflow-retry-storm',
        status: 'accepted',
      },
      summary: {
        eventCount: 1,
        failureMode: 'healthy',
      },
    });
  });

  test('asserts taxonomy error envelopes, request ids, cleanup, and tenant-safe recovery for every failure mode', async () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();

    for (const [index, failure] of taxonomy.failures.entries()) {
      await resetPortfolio(port);
      const target = createChaosTargetRequest(port, failure);

      if (failure.kind === 'duplicate-request') {
        const seedResponse = await invokeChaosTarget(port, target);
        expect(seedResponse.status).toBe(200);
        await expect(seedResponse.json()).resolves.toMatchObject({
          event: {
            requestId: target.requestId,
            status: 'accepted',
          },
          summary: {
            eventCount: 1,
            failureMode: 'healthy',
          },
        });
      }

      const armedResponse = await armChaosToggle(port, failure.id, {
        requestId: `arm-envelope-${index}`,
        targetRequestId: target.requestId,
        targetEndpoint: target.endpoint,
      });
      expect(armedResponse.status).toBe(200);
      await expect(armedResponse.json()).resolves.toMatchObject({
        failureMode: 'healthy',
        chaosToggle: {
          id: failure.id,
          kind: failure.kind,
          status: 'armed',
          scope: 'request',
          targetRequestId: target.requestId,
          targetEndpoint: target.endpoint,
          expectedHttpStatus: failure.expectedStatus.httpStatus,
          responseKind: failure.expectedStatus.responseKind,
          applicationStatus: failure.expectedStatus.applicationStatus,
          errorCode: failure.expectedErrorEnvelope.code,
          retryable: failure.expectedStatus.retryable,
          resetRequired: failure.resetExpectation.required,
        },
      });

      const healthyWhileArmed = await runWorkflow(
        port,
        `healthy-while-armed-${index}`,
        target.tenantId,
      );
      expect(healthyWhileArmed.status).toBe(200);
      await expect(healthyWhileArmed.json()).resolves.toMatchObject({
        event: {
          requestId: `healthy-while-armed-${index}`,
          status: 'accepted',
        },
        summary: {
          failureMode: 'healthy',
        },
      });

      const beforeFailure = await getBootstrap(port);
      const failureResponse = await invokeChaosTarget(port, target);
      expect(failureResponse.status).toBe(failure.expectedStatus.httpStatus);
      const failurePayload = await failureResponse.json();

      if (failure.expectedErrorEnvelope.present) {
        assertChaosErrorEnvelope(failurePayload, failure, target);
      } else {
        expect(failurePayload).toMatchObject({
          event: {
            requestId: target.requestId,
            status: 'deduped',
          },
          summary: {
            eventCount: beforeFailure.summary.eventCount,
            failureMode: 'healthy',
          },
        });
        expect(readPath(failurePayload, 'error')).toBeUndefined();
        expect(readPath(failurePayload, 'chaos')).toBeUndefined();
      }

      const afterFailure = await getBootstrap(port);
      expect(afterFailure.summary).toMatchObject({
        eventCount: beforeFailure.summary.eventCount,
        failureMode: 'healthy',
      });

      const cleanupResponse = await runWorkflow(
        port,
        `cleanup-after-${index}`,
        target.tenantId,
      );
      expect(cleanupResponse.status).toBe(200);
      await expect(cleanupResponse.json()).resolves.toMatchObject({
        event: {
          requestId: `cleanup-after-${index}`,
          status: 'accepted',
        },
        summary: {
          eventCount: beforeFailure.summary.eventCount + 1,
          failureMode: 'healthy',
        },
      });

      await resetPortfolio(port);
      const recoveredResponse = await runWorkflow(
        port,
        `recovered-after-reset-${index}`,
        target.tenantId,
      );
      expect(recoveredResponse.status).toBe(
        failure.resetExpectation.expectedPostResetStatus,
      );
      await expect(recoveredResponse.json()).resolves.toMatchObject({
        event: {
          requestId: `recovered-after-reset-${index}`,
          status: 'accepted',
        },
        summary: {
          eventCount: 1,
          failureMode: failure.resetExpectation.restoresFailureMode,
        },
      });
    }
  });

  test('keeps moderate concurrent chaos load from poisoning healthy requests after reset', async () => {
    const taxonomy = createSuperAppWorkloadChaosFailureTaxonomy();

    for (const [index, failure] of taxonomy.failures.entries()) {
      await resetPortfolio(port);
      const target = createChaosTargetRequest(port, failure);
      const scope = failure.resetExpectation.required
        ? 'until-reset'
        : 'request';

      if (failure.kind === 'duplicate-request') {
        const seedResponse = await invokeHealthyEquivalentTarget(port, target);
        expect(seedResponse.status).toBe(200);
        const seedPayload = await seedResponse.json();
        expect(seedPayload).toMatchObject({
          event: {
            requestId: target.requestId,
            status: 'accepted',
          },
        });
        assertHealthyPayloadWasNotPoisoned(seedPayload);
      }

      const armedResponse = await armChaosToggle(port, failure.id, {
        requestId: `arm-load-${index}`,
        targetRequestId: target.requestId,
        targetEndpoint: target.endpoint,
        scope,
      });
      expect(armedResponse.status).toBe(200);
      await expect(armedResponse.json()).resolves.toMatchObject({
        failureMode: 'healthy',
        chaosToggle: {
          id: failure.id,
          kind: failure.kind,
          scope,
          targetRequestId: target.requestId,
          targetEndpoint: target.endpoint,
          expectedHttpStatus: failure.expectedStatus.httpStatus,
          errorCode: failure.expectedErrorEnvelope.code,
          resetRequired: failure.resetExpectation.required,
        },
        summary: {
          failureMode: 'healthy',
        },
      });

      const chaosResult = await runModerateHealthyLoad(
        port,
        index,
        collectJsonResponse(
          `chaos:${failure.id}`,
          invokeChaosTarget(port, target),
        ),
      );
      expect(chaosResult.response.status, chaosResult.name).toBe(
        failure.expectedStatus.httpStatus,
      );

      if (failure.expectedErrorEnvelope.present) {
        assertChaosErrorEnvelope(chaosResult.payload, failure, target);
      } else {
        expect(chaosResult.payload).toMatchObject({
          event: {
            requestId: target.requestId,
            status: 'deduped',
          },
        });
        assertHealthyPayloadWasNotPoisoned(chaosResult.payload);
      }

      const afterLoad = await getBootstrap(port);
      expect(afterLoad.summary).toMatchObject({
        failureMode: 'healthy',
      });

      await resetPortfolio(port);
      const postResetResults = await Promise.all([
        collectJsonResponse(
          `post-reset-target:${failure.id}`,
          invokeHealthyEquivalentTarget(port, target),
        ),
        collectJsonResponse(
          `post-reset-workflow:${failure.id}`,
          runWorkflow(port, `post-reset-workflow-${index}`, target.tenantId),
        ),
        collectJsonResponse(
          `post-reset-pilot:${failure.id}`,
          runPilot(port, `post-reset-pilot-${index}`),
        ),
        collectJsonResponse(
          `post-reset-security:${failure.id}`,
          runSecurityProbe(port, `post-reset-security-${index}`),
        ),
      ]);

      for (const result of postResetResults) {
        expect(result.response.status, result.name).toBe(
          failure.resetExpectation.expectedPostResetStatus,
        );
        assertHealthyPayloadWasNotPoisoned(result.payload);
      }

      const afterRecovery = await getBootstrap(port);
      expect(afterRecovery.summary).toMatchObject({
        failureMode: failure.resetExpectation.restoresFailureMode,
      });
    }
  });
});
