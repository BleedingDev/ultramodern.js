import dns from 'node:dns';
import path from 'node:path';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

dns.setDefaultResultOrder('ipv4first');
setSuiteTimeout(1000 * 60 * 8);

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';

async function postJson(port: number, pathname: string, body?: unknown) {
  return fetch(`${host}:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function runWorkflow(port: number, requestId: string) {
  return postJson(port, '/bff-api/effect/apps/mobility-marketplace/workflow', {
    action: 'quote',
    actor: 'chaos.toggle.test',
    requestId,
  });
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

describe('superapp portfolio chaos toggles', () => {
  let port: number;
  let app: Awaited<ReturnType<typeof modernServe>> | undefined;

  beforeAll(async () => {
    const build = await modernBuild(appDir);
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
});
