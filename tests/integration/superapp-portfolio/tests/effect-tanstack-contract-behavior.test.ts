import dns from 'node:dns';
import path from 'node:path';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import {
  createSuperAppQueryKey,
  getSuperAppEffectEndpoint,
  getSuperAppInvalidationBoundary,
} from '../shared/effect-tanstack-contract-map.js';
import {
  getWorkloadChaosFailureCase,
  type WorkloadChaosFailureId,
} from '../shared/workload-chaos-failure-taxonomy.js';

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

type PortfolioSummary = {
  eventCount: number;
  failureMode: string;
  totalOpenWork: number;
  [key: string]: unknown;
};

type PortfolioApp = {
  id: string;
  openWork: number;
  [key: string]: unknown;
};

type PortfolioEvent = {
  id: string;
  appId: string;
  action: string;
  actor: string;
  requestId: string;
  status: string;
};

type BootstrapPayload = {
  apps: PortfolioApp[];
  events: PortfolioEvent[];
  pilotRuns: unknown[];
  summary: PortfolioSummary;
  [key: string]: unknown;
};

type WorkflowPayload = {
  event: PortfolioEvent;
  summary: PortfolioSummary;
};

type RetryClassification =
  | 'non-retryable-deduped-success'
  | 'non-retryable-error'
  | 'retryable-throttle'
  | 'retryable-timeout'
  | 'retryable-transient';

const bootstrapEndpoint = getSuperAppEffectEndpoint('effect.bootstrap');
const workflowEndpoint = getSuperAppEffectEndpoint('effect.runWorkflow');
const failureEndpoint = getSuperAppEffectEndpoint('effect.injectFailure');
const workflowBoundary = getSuperAppInvalidationBoundary(
  'workflow-event-accepted',
);

function cloneJson<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function cacheId(key: readonly string[]) {
  return JSON.stringify(key);
}

function workflowPath(appId: string) {
  return workflowEndpoint.publicPath.replace(':appId', appId);
}

function failurePath(mode: string) {
  return failureEndpoint.publicPath.replace(':mode', mode);
}

function workflowCacheKeys(appId: string) {
  return [
    createSuperAppQueryKey('portfolio.bootstrap'),
    createSuperAppQueryKey('portfolio.summary'),
    createSuperAppQueryKey('portfolio.apps'),
    createSuperAppQueryKey('portfolio.app.detail', { appId }),
    createSuperAppQueryKey('portfolio.events'),
  ];
}

class ContractCacheHarness {
  readonly invalidatedQueryKeyIds: string[] = [];

  private readonly values = new Map<string, unknown>();

  seedBootstrap(payload: BootstrapPayload) {
    this.set(createSuperAppQueryKey('portfolio.bootstrap'), payload);
    this.set(createSuperAppQueryKey('portfolio.summary'), payload.summary);
    this.set(createSuperAppQueryKey('portfolio.apps'), payload.apps);
    this.set(createSuperAppQueryKey('portfolio.events'), payload.events);
    this.set(
      createSuperAppQueryKey('portfolio.failureMode'),
      payload.summary.failureMode,
    );

    for (const app of payload.apps) {
      this.set(
        createSuperAppQueryKey('portfolio.app.detail', { appId: app.id }),
        app,
      );
    }
  }

  get<T>(key: readonly string[]): T {
    return cloneJson(this.values.get(cacheId(key)) as T);
  }

  set(key: readonly string[], value: unknown) {
    this.values.set(cacheId(key), cloneJson(value));
  }

  snapshot(keys: readonly (readonly string[])[]) {
    return new Map(
      keys.map(key => {
        const id = cacheId(key);
        return [id, cloneJson(this.values.get(id))] as const;
      }),
    );
  }

  restore(snapshot: ReadonlyMap<string, unknown>) {
    for (const [key, value] of snapshot) {
      this.values.set(key, cloneJson(value));
    }
  }

  applyOptimisticWorkflow(input: {
    action: string;
    actor: string;
    appId: string;
    requestId: string;
  }) {
    const rollbackSnapshot = this.snapshot(workflowCacheKeys(input.appId));
    const bootstrap = this.get<BootstrapPayload>(
      createSuperAppQueryKey('portfolio.bootstrap'),
    );
    const optimisticEvent: PortfolioEvent = {
      id: `optimistic:${input.requestId}`,
      appId: input.appId,
      action: input.action,
      actor: input.actor,
      requestId: input.requestId,
      status: 'pending',
    };

    const apps = bootstrap.apps.map(app =>
      app.id === input.appId
        ? { ...app, openWork: Math.max(0, app.openWork - 1) }
        : app,
    );
    const optimisticBootstrap = {
      ...bootstrap,
      apps,
      events: [...bootstrap.events, optimisticEvent],
      summary: {
        ...bootstrap.summary,
        eventCount: bootstrap.summary.eventCount + 1,
      },
    };
    this.seedBootstrap(optimisticBootstrap);

    return () => this.restore(rollbackSnapshot);
  }

  commitWorkflow(payload: WorkflowPayload) {
    const bootstrap = this.get<BootstrapPayload>(
      createSuperAppQueryKey('portfolio.bootstrap'),
    );
    const committedBootstrap = {
      ...bootstrap,
      events: [
        ...bootstrap.events.filter(
          event =>
            event.requestId !== payload.event.requestId ||
            event.status !== 'pending',
        ),
        payload.event,
      ],
      summary: payload.summary,
    };

    this.seedBootstrap(committedBootstrap);
    this.invalidatedQueryKeyIds.push(
      ...workflowBoundary.invalidatesQueryKeyIds,
    );
  }
}

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

async function getBootstrap(port: number): Promise<BootstrapPayload> {
  const response = await fetch(
    `${host}:${port}${bootstrapEndpoint.publicPath}`,
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<BootstrapPayload>;
}

async function resetPortfolio(port: number) {
  const response = await postJson(port, '/bff-api/effect/reset');
  expect(response.status).toBe(200);
  return response.json();
}

function requiredFailure(id: WorkloadChaosFailureId) {
  const failure = getWorkloadChaosFailureCase(id);
  if (!failure) {
    throw new Error(`Missing workload chaos failure case: ${id}`);
  }

  return failure;
}

async function armWorkflowChaos(
  port: number,
  failureId: WorkloadChaosFailureId,
  targetRequestId: string,
) {
  const failure = requiredFailure(failureId);
  const response = await postJson(port, failurePath(failureId), {
    actor: 'contract.operator',
    reason: 'effect tanstack contract behavior test',
    requestId: `arm:${targetRequestId}`,
    targetRequestId,
    targetEndpoint: 'portfolio.workflow',
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    chaosToggle: {
      id: failure.id,
      expectedHttpStatus: failure.expectedStatus.httpStatus,
      retryable: failure.expectedStatus.retryable,
      resetRequired: failure.resetExpectation.required,
      targetEndpoint: 'portfolio.workflow',
      targetRequestId,
    },
  });

  return failure;
}

function classifyRetryOutcome(input: {
  payload: Record<string, any>;
  status: number;
}): RetryClassification {
  if (input.payload.event?.status === 'deduped') {
    return 'non-retryable-deduped-success';
  }

  const error = input.payload.error;
  if (!error?.retryable) {
    return 'non-retryable-error';
  }

  if (input.status === 429) {
    return 'retryable-throttle';
  }

  if (input.status === 504 || error.code === 'DOWNSTREAM_TIMEOUT') {
    return 'retryable-timeout';
  }

  return 'retryable-transient';
}

describe('superapp Effect and TanStack contract behavior', () => {
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

  test('reads bootstrap data and commits optimistic workflow writes through contract keys', async () => {
    expect(bootstrapEndpoint.method).toBe('GET');
    expect(workflowEndpoint.method).toBe('POST');
    expect(workflowBoundary.invalidatesQueryKeyIds).toEqual([
      'portfolio.bootstrap',
      'portfolio.summary',
      'portfolio.apps',
      'portfolio.app.detail',
      'portfolio.events',
    ]);

    const bootstrap = await getBootstrap(port);
    for (const field of bootstrapEndpoint.successFields) {
      expect(bootstrap[field]).not.toBeUndefined();
    }
    expect(bootstrap.summary).toMatchObject({
      eventCount: 0,
      failureMode: 'healthy',
    });

    const cache = new ContractCacheHarness();
    cache.seedBootstrap(bootstrap);
    expect(
      cache.get<BootstrapPayload>(createSuperAppQueryKey('portfolio.bootstrap'))
        .summary,
    ).toMatchObject({
      eventCount: 0,
      failureMode: 'healthy',
    });

    const workflowRequest = {
      action: 'quote',
      actor: 'contract.behavior',
      appId: 'mobility-marketplace',
      requestId: 'contract-workflow-success',
    };
    const rollback = cache.applyOptimisticWorkflow(workflowRequest);
    const optimisticEvents = cache.get<PortfolioEvent[]>(
      createSuperAppQueryKey('portfolio.events'),
    );
    expect(optimisticEvents.at(-1)).toMatchObject({
      id: 'optimistic:contract-workflow-success',
      requestId: workflowRequest.requestId,
      status: 'pending',
    });

    const response = await postJson(
      port,
      workflowPath(workflowRequest.appId),
      workflowRequest,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as WorkflowPayload;
    for (const field of workflowEndpoint.successFields) {
      expect(payload[field as keyof WorkflowPayload]).not.toBeUndefined();
    }
    expect(payload).toMatchObject({
      event: {
        id: 'evt-1',
        appId: workflowRequest.appId,
        requestId: workflowRequest.requestId,
        status: 'accepted',
      },
      summary: {
        eventCount: 1,
        failureMode: 'healthy',
      },
    });

    cache.commitWorkflow(payload);
    expect(cache.invalidatedQueryKeyIds).toEqual(
      workflowBoundary.invalidatesQueryKeyIds,
    );
    expect(
      cache.get<PortfolioEvent[]>(createSuperAppQueryKey('portfolio.events')),
    ).toEqual([
      expect.objectContaining({
        id: 'evt-1',
        requestId: workflowRequest.requestId,
        status: 'accepted',
      }),
    ]);
    expect(
      cache.get<PortfolioEvent[]>(createSuperAppQueryKey('portfolio.events')),
    ).not.toEqual([
      expect.objectContaining({
        id: 'optimistic:contract-workflow-success',
      }),
    ]);
    expect(
      cache.get<PortfolioSummary>(createSuperAppQueryKey('portfolio.summary')),
    ).toMatchObject({
      eventCount: 1,
      failureMode: 'healthy',
    });

    const serverState = await getBootstrap(port);
    expect(serverState.events).toEqual(
      cache.get<PortfolioEvent[]>(createSuperAppQueryKey('portfolio.events')),
    );
    expect(serverState.summary.eventCount).toBe(1);
    rollback();
  });

  test('rolls back optimistic workflow cache on timeout envelopes and classifies retries', async () => {
    const requestId = 'contract-timeout-target';
    const failure = await armWorkflowChaos(
      port,
      'chaos.downstream-timeout.v1',
      requestId,
    );
    const baseline = await getBootstrap(port);
    const cache = new ContractCacheHarness();
    cache.seedBootstrap(baseline);
    const baselineCache = cache.get<BootstrapPayload>(
      createSuperAppQueryKey('portfolio.bootstrap'),
    );

    const rollback = cache.applyOptimisticWorkflow({
      action: failure.operationHint,
      actor: 'contract.behavior',
      appId: 'mobility-marketplace',
      requestId,
    });
    expect(
      cache
        .get<PortfolioEvent[]>(createSuperAppQueryKey('portfolio.events'))
        .some(
          event => event.requestId === requestId && event.status === 'pending',
        ),
    ).toBe(true);

    const response = await postJson(
      port,
      workflowPath('mobility-marketplace'),
      {
        action: failure.operationHint,
        actor: 'contract.behavior',
        requestId,
      },
    );
    expect(response.status).toBe(failure.expectedStatus.httpStatus);
    const payload = (await response.json()) as Record<string, any>;
    expect(payload).toMatchObject({
      error: {
        code: failure.expectedErrorEnvelope.code,
        failureId: failure.id,
        requestId,
        retryable: true,
        retryAfterMs: failure.expectedStatus.retryAfterMs,
        responseKind: failure.expectedStatus.responseKind,
        applicationStatus: failure.expectedStatus.applicationStatus,
      },
      chaos: {
        id: failure.id,
        status: 'consumed',
      },
    });
    expect(classifyRetryOutcome({ payload, status: response.status })).toBe(
      'retryable-timeout',
    );

    rollback();
    expect(
      cache.get<BootstrapPayload>(
        createSuperAppQueryKey('portfolio.bootstrap'),
      ),
    ).toEqual(baselineCache);

    const afterTimeout = await getBootstrap(port);
    expect(afterTimeout.summary.eventCount).toBe(baseline.summary.eventCount);
    expect(
      afterTimeout.events.some(event => event.requestId === requestId),
    ).toBe(false);

    await resetPortfolio(port);
    const retryStormRequestId = 'contract-retry-storm-target';
    const retryStorm = await armWorkflowChaos(
      port,
      'chaos.retry-storm.v1',
      retryStormRequestId,
    );
    const retryResponse = await postJson(
      port,
      workflowPath('mobility-marketplace'),
      {
        action: retryStorm.operationHint,
        actor: 'contract.behavior',
        requestId: retryStormRequestId,
      },
    );
    expect(retryResponse.status).toBe(429);
    const retryPayload = (await retryResponse.json()) as Record<string, any>;
    expect(retryPayload).toMatchObject({
      error: {
        code: 'RETRY_STORM',
        retryable: true,
        retryAfterMs: retryStorm.expectedStatus.retryAfterMs,
        applicationStatus: 'throttled',
      },
      chaos: {
        attemptCount: retryStorm.deterministicInput.attemptCount,
      },
    });
    expect(
      classifyRetryOutcome({
        payload: retryPayload,
        status: retryResponse.status,
      }),
    ).toBe('retryable-throttle');
  });

  test('dedupes duplicate request ids as non-retryable idempotent success', async () => {
    const duplicateContract = requiredFailure('chaos.duplicate-request.v1');
    const request = {
      action: duplicateContract.operationHint,
      actor: 'contract.behavior',
      requestId: 'contract-duplicate-workflow',
    };

    const first = await postJson(
      port,
      workflowPath('mobility-marketplace'),
      request,
    );
    expect(first.status).toBe(200);
    const firstPayload = (await first.json()) as WorkflowPayload;
    expect(firstPayload).toMatchObject({
      event: {
        id: 'evt-1',
        requestId: request.requestId,
        status: 'accepted',
      },
      summary: {
        eventCount: 1,
      },
    });

    const second = await postJson(
      port,
      workflowPath('mobility-marketplace'),
      request,
    );
    expect(second.status).toBe(duplicateContract.expectedStatus.httpStatus);
    const secondPayload = (await second.json()) as Record<string, any>;
    expect(secondPayload).toMatchObject({
      event: {
        id: firstPayload.event.id,
        requestId: request.requestId,
        status: duplicateContract.expectedStatus.applicationStatus,
      },
      summary: {
        eventCount: 1,
      },
    });
    expect(secondPayload.error).toBeUndefined();
    expect(duplicateContract.expectedStatus).toMatchObject({
      responseKind: 'deduped-success',
      retryable: false,
    });
    expect(classifyRetryOutcome({ payload: secondPayload, status: 200 })).toBe(
      'non-retryable-deduped-success',
    );

    const state = await getBootstrap(port);
    expect(
      state.events.filter(event => event.requestId === request.requestId),
    ).toHaveLength(1);
  });

  test('keeps aborted client writes outside BFF state before interruption coverage', async () => {
    const before = await getBootstrap(port);
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetch(`${host}:${port}${workflowPath('mobility-marketplace')}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'quote',
          actor: 'contract.behavior',
          requestId: 'contract-aborted-write',
        }),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });

    const after = await getBootstrap(port);
    expect(after.summary).toEqual(before.summary);
    expect(after.events).toEqual(before.events);
  });

  test('keeps pilot reads and writes on the contract boundary for later navigation cache coverage', async () => {
    const response = await postJson(
      port,
      '/bff-api/effect/pilot/grab-marketplace/run',
      {
        tenant: 'superapp-global',
        actor: 'contract.behavior',
        requestId: 'contract-pilot-success',
        modules: fullModuleSet,
        chaos: 'none',
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: {
        requestId: 'contract-pilot-success',
        status: 'accepted',
        summary: {
          workflowEvents: 8,
          degradedModules: 0,
        },
      },
      summary: {
        eventCount: 8,
        failureMode: 'healthy',
      },
    });
  });
});
