import dns from 'node:dns';
import path from 'node:path';
import { Effect } from '@modern-js/plugin-bff/effect-server';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import { getWorkloadChaosFailureCase } from '../shared/workload-chaos-failure-taxonomy.js';

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

type BootstrapPayload = {
  apps: unknown[];
  events: Array<{
    action: string;
    actor: string;
    appId: string;
    requestId: string;
    status: string;
  }>;
  pilotRuns: unknown[];
  summary: {
    eventCount: number;
    failureMode: string;
  };
};

type FiberExit = {
  _tag: string;
  cause?: {
    reasons?: Array<
      | {
          _tag: 'Die';
          defect: unknown;
        }
      | {
          _tag: string;
        }
    >;
  };
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

async function readResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {
      payload: undefined,
      text,
    };
  }

  try {
    return {
      payload: JSON.parse(text) as Record<string, any>,
      text,
    };
  } catch {
    return {
      payload: undefined,
      text,
    };
  }
}

async function getBootstrap(port: number): Promise<BootstrapPayload> {
  const response = await fetch(`${host}:${port}/bff-api/effect/bootstrap`);
  expect(response.status).toBe(200);
  return response.json() as Promise<BootstrapPayload>;
}

async function resetPortfolio(port: number) {
  const response = await postJson(port, '/bff-api/effect/reset');
  expect(response.status).toBe(200);
}

function workflowPath(appId: string) {
  return `/bff-api/effect/apps/${appId}/workflow`;
}

function expectNoStateDrift(after: BootstrapPayload, before: BootstrapPayload) {
  expect(after.summary).toEqual(before.summary);
  expect(after.events).toEqual(before.events);
  expect(after.apps).toEqual(before.apps);
  expect(after.pilotRuns).toEqual(before.pilotRuns);
}

function causeReasonTags(exit: FiberExit) {
  return exit.cause?.reasons?.map(reason => reason._tag) ?? [];
}

function causeDefects(exit: FiberExit) {
  return (
    exit.cause?.reasons
      ?.filter(
        (reason): reason is { _tag: 'Die'; defect: unknown } =>
          reason._tag === 'Die',
      )
      .map(reason => reason.defect) ?? []
  );
}

function waitForFiberExit(
  fiber: ReturnType<typeof Effect.runFork>,
  timeoutMs = 1000,
) {
  return new Promise<FiberExit>((resolve, reject) => {
    const polled = fiber.pollUnsafe() as FiberExit | undefined;
    if (polled) {
      resolve(polled);
      return;
    }

    let settled = false;
    let unobserve = () => {};
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      unobserve();
      reject(new Error('Timed out waiting for Effect fiber exit'));
    }, timeoutMs);

    unobserve = fiber.addObserver(exit => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      unobserve();
      resolve(exit as FiberExit);
    });
  });
}

describe('superapp server Effect BFF contracts', () => {
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

  test('interrupts server Effect work and runs scoped finalizers deterministically', async () => {
    const events: string[] = [];
    const program = Effect.scoped(
      Effect.gen(function* () {
        const resource = yield* Effect.acquireRelease(
          Effect.sync(() => {
            events.push('acquire:workflow-stream');
            return 'workflow-stream';
          }),
          (_resource, exit: FiberExit) =>
            Effect.sync(() => {
              events.push(
                `release:${exit._tag}:${causeReasonTags(exit).join('|')}`,
              );
            }),
        );
        events.push(`begin:${resource}`);
        yield* Effect.callback<void>(resume => {
          const timer = setTimeout(
            () => resume(Effect.succeed(undefined)),
            10_000,
          );
          return Effect.sync(() => {
            clearTimeout(timer);
            events.push('async-cleanup');
          });
        });
        events.push('complete');
      }),
    );

    const fiber = Effect.runFork(program);
    await new Promise(resolve => setTimeout(resolve, 10));
    fiber.interruptUnsafe();
    const exit = await waitForFiberExit(fiber);

    expect(exit._tag).toBe('Failure');
    expect(causeReasonTags(exit)).toEqual(['Interrupt']);
    expect(events).toEqual([
      'acquire:workflow-stream',
      'begin:workflow-stream',
      'async-cleanup',
      'release:Failure:Interrupt',
    ]);
  });

  test('rejects schema decode failures before workflow, pilot, or security handlers mutate state', async () => {
    const before = await getBootstrap(port);
    const malformedRequests = [
      postJson(port, workflowPath('mobility-marketplace'), {
        action: 'quote',
        actor: 'contract.schema',
        requestId: 123,
      }),
      postJson(port, '/bff-api/effect/pilot/grab-marketplace/run', {
        tenant: 'superapp-global',
        actor: 'contract.schema',
        requestId: 'contract-schema-pilot',
        modules: ['rides', 'not-a-module'],
        chaos: 'none',
      }),
      postJson(
        port,
        '/bff-api/effect/security/probe',
        {
          targetTenant: 'security-root',
          targetAppId: 'unknown-app',
          action: 'boundary-policy-evaluate',
          requestId: 'contract-schema-security',
          mutation: true,
        },
        {
          authorization: 'Bearer schema-secret-token',
          origin: `${host}:${port}`,
          'x-csrf-token': 'superapp-valid-csrf',
          'x-tenant-id': 'security-root',
          'x-user-role': 'security-admin',
        },
      ),
    ];

    const responses = await Promise.all(malformedRequests);
    expect(responses.map(response => response.status)).toEqual([400, 400, 400]);
    const bodies = await Promise.all(responses.map(readResponse));
    expect(bodies.map(body => body.text)).not.toContain('schema-secret-token');

    const after = await getBootstrap(port);
    expectNoStateDrift(after, before);
  });

  test('keeps structured Effect defects observable without leaking context or mutating state', async () => {
    const structuredDefect = {
      _tag: 'SuperAppBffStructuredDefect',
      endpointId: 'effect.runPilot',
      requestId: 'contract-structured-defect',
      contract: 'ust-contract-03',
    };
    const defectExit = (await Effect.runPromiseExit(
      Effect.die(structuredDefect),
    )) as FiberExit;
    expect(defectExit._tag).toBe('Failure');
    expect(causeReasonTags(defectExit)).toEqual(['Die']);
    expect(causeDefects(defectExit)).toEqual([structuredDefect]);

    const before = await getBootstrap(port);
    const pilotDefect = await postJson(
      port,
      '/bff-api/effect/pilot/grab-marketplace/run',
      {
        tenant: 'missing-tenant',
        actor: 'contract.defect',
        requestId: 'contract-domain-defect',
        modules: fullModuleSet,
        chaos: 'none',
      },
    );
    const securityDefect = await postJson(
      port,
      '/bff-api/effect/security/probe',
      {
        targetTenant: 'security-root',
        targetAppId: 'tenant-security',
        action: 'boundary-policy-evaluate',
        requestId: 'contract-security-defect',
        mutation: true,
      },
      {
        authorization: 'Bearer defect-secret-token',
        origin: 'https://evil.example',
        'x-csrf-token': 'superapp-valid-csrf',
        'x-tenant-id': 'security-root',
        'x-user-role': 'security-admin',
      },
    );

    expect(pilotDefect.status).toBeGreaterThanOrEqual(500);
    expect(securityDefect.status).toBeGreaterThanOrEqual(500);
    const pilotBody = await readResponse(pilotDefect);
    const securityBody = await readResponse(securityDefect);
    expect(pilotBody.text).not.toContain('contract-domain-defect');
    expect(securityBody.text).not.toContain('defect-secret-token');

    const after = await getBootstrap(port);
    expectNoStateDrift(after, before);
  });

  test('propagates request context through workflow, pilot, security, and chaos BFF handlers', async () => {
    const workflow = await postJson(
      port,
      workflowPath('mobility-marketplace'),
      {
        action: 'context-propagation',
        actor: 'contract.context',
        requestId: 'context-workflow-1',
      },
      {
        'x-tenant-id': 'city-ops-eu',
      },
    );
    expect(workflow.status).toBe(200);
    await expect(workflow.json()).resolves.toMatchObject({
      event: {
        action: 'context-propagation',
        actor: 'contract.context',
        appId: 'mobility-marketplace',
        requestId: 'context-workflow-1',
        status: 'accepted',
      },
    });

    const pilot = await postJson(
      port,
      '/bff-api/effect/pilot/grab-marketplace/run',
      {
        tenant: 'superapp-global',
        actor: 'contract.context',
        requestId: 'context-pilot-1',
        modules: fullModuleSet,
        chaos: 'none',
      },
    );
    expect(pilot.status).toBe(200);
    await expect(pilot.json()).resolves.toMatchObject({
      run: {
        actor: 'contract.context',
        requestId: 'context-pilot-1',
        tenant: 'superapp-global',
        status: 'accepted',
      },
    });

    const security = await postJson(
      port,
      '/bff-api/effect/security/probe',
      {
        targetTenant: 'security-root',
        targetAppId: 'tenant-security',
        action: 'boundary-policy-evaluate',
        requestId: 'context-security-1',
        mutation: true,
      },
      {
        authorization: 'Bearer context-secret-token',
        origin: `${host}:${port}`,
        'x-csrf-token': 'superapp-valid-csrf',
        'x-tenant-id': 'security-root',
        'x-user-role': 'security-admin',
      },
    );
    expect(security.status).toBe(200);
    await expect(security.json()).resolves.toMatchObject({
      allowed: true,
      telemetry: {
        appId: 'tenant-security',
        authorization: '[redacted]',
        csrfToken: '[redacted]',
        origin: `${host}:${port}`,
        requestId: 'context-security-1',
        role: 'security-admin',
        tenant: 'security-root',
      },
    });

    const slowStream = getWorkloadChaosFailureCase('chaos.slow-stream.v1');
    expect(slowStream).toBeDefined();
    const targetRequestId = 'context-chaos-slow-stream';
    const armed = await postJson(
      port,
      '/bff-api/effect/failure/chaos.slow-stream.v1',
      {
        actor: 'contract.context',
        reason: 'context propagation slow stream contract',
        requestId: 'context-arm-slow-stream',
        targetRequestId,
        targetEndpoint: 'portfolio.workflow',
      },
    );
    expect(armed.status).toBe(200);
    await expect(armed.json()).resolves.toMatchObject({
      chaosToggle: {
        id: 'chaos.slow-stream.v1',
        kind: 'slow-stream',
        targetEndpoint: 'portfolio.workflow',
        targetRequestId,
      },
    });

    const chaos = await postJson(
      port,
      workflowPath('mobility-marketplace'),
      {
        action: slowStream?.operationHint,
        actor: 'contract.context',
        requestId: targetRequestId,
      },
      {
        'x-tenant-id': 'platform-shell',
      },
    );
    expect(chaos.status).toBe(slowStream?.expectedStatus.httpStatus);
    await expect(chaos.json()).resolves.toMatchObject({
      error: {
        code: slowStream?.expectedErrorEnvelope.code,
        failureId: 'chaos.slow-stream.v1',
        kind: 'slow-stream',
        requestId: targetRequestId,
        tenantId: 'platform-shell',
      },
      chaos: {
        armedBy: 'contract.context',
        status: 'consumed',
        targetRequestId,
      },
    });

    const state = await getBootstrap(port);
    expect(
      state.events.some(
        event =>
          event.requestId === 'context-pilot-1:rides' &&
          event.actor === 'contract.context',
      ),
    ).toBe(true);
    expect(
      state.events.some(event => event.requestId === targetRequestId),
    ).toBe(false);
  });
});
