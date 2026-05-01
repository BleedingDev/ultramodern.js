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
  SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS,
  SUPERAPP_TANSTACK_ROUTE_CONTRACTS,
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
  tenant: string;
  kind: string;
  capabilities: string[];
  openWork: number;
  routes: string[];
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
const appRouteContract = SUPERAPP_TANSTACK_ROUTE_CONTRACTS.find(
  route => route.id === '/apps/$appId',
);

if (!appRouteContract) {
  throw new Error('Missing SuperApp app route contract');
}

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

function queryKeysForInvalidation(
  queryKeyIds: readonly string[],
  values: Partial<Record<string, string>> = {},
) {
  return queryKeyIds.map(queryKeyId => {
    if (queryKeyId === 'portfolio.app.detail') {
      if (!values.appId) {
        throw new Error('Missing appId for app detail invalidation');
      }

      return createSuperAppQueryKey('portfolio.app.detail', {
        appId: values.appId,
      });
    }

    return createSuperAppQueryKey(
      queryKeyId as Parameters<typeof createSuperAppQueryKey>[0],
    );
  });
}

class ContractCacheHarness {
  readonly invalidatedQueryKeyIds: string[] = [];
  readonly prefetchedQueryKeyIds: string[] = [];
  readonly refetchedQueryKeyIds: string[] = [];

  private readonly values = new Map<string, unknown>();
  private readonly metadata = new Map<
    string,
    {
      fetchedAtMs: number;
      stale: boolean;
    }
  >();

  private nowMs = 1_000;

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
    const id = cacheId(key);
    this.values.set(id, cloneJson(value));
    this.metadata.set(id, {
      fetchedAtMs: this.nowMs,
      stale: false,
    });
  }

  delete(key: readonly string[]) {
    const id = cacheId(key);
    this.values.delete(id);
    this.metadata.delete(id);
  }

  isStale(key: readonly string[], staleTimeMs = 0) {
    const metadata = this.metadata.get(cacheId(key));
    if (!metadata) {
      return true;
    }

    return metadata.stale || this.nowMs - metadata.fetchedAtMs > staleTimeMs;
  }

  advanceTime(ms: number) {
    this.nowMs += ms;
  }

  markStale(keys: readonly (readonly string[])[]) {
    for (const key of keys) {
      const id = cacheId(key);
      const metadata = this.metadata.get(id);
      if (metadata) {
        this.metadata.set(id, {
          ...metadata,
          stale: true,
        });
      }
    }
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
      this.metadata.set(key, {
        fetchedAtMs: this.nowMs,
        stale: false,
      });
    }
  }

  retainTenantAppDetails(tenantId: string, apps: readonly PortfolioApp[]) {
    const allowedAppIds = new Set(
      apps
        .filter(
          app => tenantId === 'superapp-global' || app.tenant === tenantId,
        )
        .map(app => app.id),
    );

    for (const app of apps) {
      const key = createSuperAppQueryKey('portfolio.app.detail', {
        appId: app.id,
      });
      if (!allowedAppIds.has(app.id)) {
        this.delete(key);
      }
    }

    return allowedAppIds;
  }

  async prefetchQuery<T>(
    queryKeyId: string,
    key: readonly string[],
    load: () => Promise<T>,
  ) {
    if (!this.values.has(cacheId(key)) || this.isStale(key, 30_000)) {
      this.set(key, await load());
      this.prefetchedQueryKeyIds.push(queryKeyId);
    }

    return this.get<T>(key);
  }

  async refetchBootstrap(load: () => Promise<BootstrapPayload>) {
    const payload = await load();
    this.seedBootstrap(payload);
    this.refetchedQueryKeyIds.push(
      'portfolio.bootstrap',
      'portfolio.summary',
      'portfolio.apps',
      'portfolio.app.detail',
      'portfolio.events',
    );
    return payload;
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

  invalidateQueryKeys(
    queryKeyIds: readonly string[],
    values: Partial<Record<string, string>> = {},
  ) {
    this.invalidatedQueryKeyIds.push(...queryKeyIds);
    this.markStale(queryKeysForInvalidation(queryKeyIds, values));
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
    this.invalidateQueryKeys(workflowBoundary.invalidatesQueryKeyIds, {
      appId: payload.event.appId,
    });
  }
}

class ContractRouterHarness {
  readonly invalidatedRouteIds: string[] = [];
  readonly prefetchedRouteIds: string[] = [];

  private currentRoute:
    | {
        appId: string;
        routeId: '/apps/$appId';
      }
    | undefined;

  constructor(private readonly cache: ContractCacheHarness) {}

  async prefetchAppRoute(appId: string, load: () => Promise<BootstrapPayload>) {
    expect(appRouteContract.queryKeyIds).toEqual([
      'portfolio.bootstrap',
      'portfolio.app.detail',
    ]);

    const bootstrap = await this.cache.prefetchQuery(
      'portfolio.bootstrap',
      createSuperAppQueryKey('portfolio.bootstrap'),
      load,
    );
    const app = bootstrap.apps.find(item => item.id === appId);
    expect(app).toBeDefined();

    await this.cache.prefetchQuery(
      'portfolio.app.detail',
      createSuperAppQueryKey('portfolio.app.detail', { appId }),
      async () => app!,
    );
    this.prefetchedRouteIds.push('/apps/$appId');

    return {
      appId,
      routeKind: app!.kind,
      expectedCapabilities: app!.capabilities.length,
    };
  }

  navigateToApp(appId: string) {
    this.currentRoute = {
      appId,
      routeId: '/apps/$appId',
    };

    return this.cache.get<PortfolioApp>(
      createSuperAppQueryKey('portfolio.app.detail', { appId }),
    );
  }

  invalidateForQueryKeys(queryKeyIds: readonly string[]) {
    if (
      this.currentRoute &&
      appRouteContract.queryKeyIds.some(queryKeyId =>
        queryKeyIds.includes(queryKeyId),
      )
    ) {
      this.invalidatedRouteIds.push(this.currentRoute.routeId);
    }
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

  test('prefetches app navigation and invalidates stale route/query data after workflow mutations', async () => {
    const appId = 'mobility-marketplace';
    const appDetailKey = createSuperAppQueryKey('portfolio.app.detail', {
      appId,
    });
    const summaryKey = createSuperAppQueryKey('portfolio.summary');
    const cache = new ContractCacheHarness();
    const router = new ContractRouterHarness(cache);
    const baseline = await getBootstrap(port);

    const loaderData = await router.prefetchAppRoute(appId, async () =>
      cloneJson(baseline),
    );
    const baselineApp = baseline.apps.find(app => app.id === appId);
    expect(loaderData).toEqual({
      appId,
      routeKind: baselineApp?.kind,
      expectedCapabilities: baselineApp?.capabilities.length,
    });
    expect(router.prefetchedRouteIds).toEqual(['/apps/$appId']);
    expect(cache.prefetchedQueryKeyIds).toEqual([
      'portfolio.bootstrap',
      'portfolio.app.detail',
    ]);

    const activeApp = router.navigateToApp(appId);
    expect(activeApp.openWork).toBe(baselineApp?.openWork);
    expect(cache.isStale(appDetailKey, 30_000)).toBe(false);

    cache.advanceTime(31_000);
    expect(cache.isStale(appDetailKey, 30_000)).toBe(true);
    expect(router.navigateToApp(appId).openWork).toBe(baselineApp?.openWork);

    const response = await postJson(port, workflowPath(appId), {
      action: 'quote',
      actor: 'contract.navigation',
      requestId: 'contract-navigation-invalidation',
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as WorkflowPayload;
    expect(payload.event).toMatchObject({
      appId,
      requestId: 'contract-navigation-invalidation',
      status: 'accepted',
    });

    cache.invalidateQueryKeys(workflowBoundary.invalidatesQueryKeyIds, {
      appId,
    });
    router.invalidateForQueryKeys(workflowBoundary.invalidatesQueryKeyIds);
    expect(cache.invalidatedQueryKeyIds).toEqual(
      workflowBoundary.invalidatesQueryKeyIds,
    );
    expect(router.invalidatedRouteIds).toEqual(['/apps/$appId']);
    expect(cache.isStale(summaryKey, 30_000)).toBe(true);
    expect(cache.isStale(appDetailKey, 30_000)).toBe(true);

    const staleApp = router.navigateToApp(appId);
    expect(staleApp.openWork).toBe(baselineApp?.openWork);

    const refreshed = await cache.refetchBootstrap(() => getBootstrap(port));
    const refreshedApp = router.navigateToApp(appId);
    expect(cache.refetchedQueryKeyIds).toEqual([
      'portfolio.bootstrap',
      'portfolio.summary',
      'portfolio.apps',
      'portfolio.app.detail',
      'portfolio.events',
    ]);
    expect(refreshedApp.openWork).toBe((baselineApp?.openWork ?? 0) - 1);
    expect(refreshed.summary.eventCount).toBe(baseline.summary.eventCount + 1);
    expect(
      refreshed.events.some(
        event => event.requestId === 'contract-navigation-invalidation',
      ),
    ).toBe(true);
    expect(cache.isStale(appDetailKey, 30_000)).toBe(false);
  });

  test('rolls back failed mutations and replays queued offline writes after online recovery', async () => {
    const requestId = 'contract-query-rollback-target';
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
      actor: 'contract.query',
      appId: 'mobility-marketplace',
      requestId,
    });
    const failed = await postJson(port, workflowPath('mobility-marketplace'), {
      action: failure.operationHint,
      actor: 'contract.query',
      requestId,
    });
    expect(failed.status).toBe(failure.expectedStatus.httpStatus);
    await expect(failed.json()).resolves.toMatchObject({
      error: {
        code: failure.expectedErrorEnvelope.code,
        retryable: true,
        requestId,
      },
    });

    rollback();
    expect(cache.invalidatedQueryKeyIds).toEqual([]);
    expect(
      cache.get<BootstrapPayload>(
        createSuperAppQueryKey('portfolio.bootstrap'),
      ),
    ).toEqual(baselineCache);
    await expect(getBootstrap(port)).resolves.toMatchObject({
      summary: baseline.summary,
      events: baseline.events,
    });

    const offlineRequest = {
      action: 'dispatch',
      actor: 'contract.query',
      appId: 'mobility-marketplace',
      requestId: 'contract-offline-replay',
    };
    const offlineQueue: (typeof offlineRequest)[] = [];
    let online = false;
    const mutateWhenOnline = async (request: typeof offlineRequest) => {
      if (!online) {
        offlineQueue.push(request);
        return {
          queued: true,
        };
      }

      const response = await postJson(
        port,
        workflowPath(request.appId),
        request,
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as WorkflowPayload;
      cache.commitWorkflow(payload);
      return {
        queued: false,
        payload,
      };
    };

    await expect(mutateWhenOnline(offlineRequest)).resolves.toEqual({
      queued: true,
    });
    expect(offlineQueue).toHaveLength(1);
    const whileOffline = await getBootstrap(port);
    expect(
      whileOffline.events.some(
        event => event.requestId === offlineRequest.requestId,
      ),
    ).toBe(false);

    online = true;
    const replayed = await Promise.all(
      offlineQueue.splice(0).map(request => mutateWhenOnline(request)),
    );
    expect(replayed).toEqual([
      expect.objectContaining({
        queued: false,
        payload: expect.objectContaining({
          event: expect.objectContaining({
            requestId: offlineRequest.requestId,
            status: 'accepted',
          }),
        }),
      }),
    ]);
    expect(cache.invalidatedQueryKeyIds).toEqual(
      workflowBoundary.invalidatesQueryKeyIds,
    );

    const recovered = await cache.refetchBootstrap(() => getBootstrap(port));
    expect(
      recovered.events.some(
        event => event.requestId === offlineRequest.requestId,
      ),
    ).toBe(true);
    expect(recovered.summary.eventCount).toBe(baseline.summary.eventCount + 1);
  });

  test('keeps app detail caches isolated across tenant switches', async () => {
    const bootstrap = await getBootstrap(port);
    const cache = new ContractCacheHarness();
    cache.seedBootstrap(bootstrap);

    const cityRoutes = SUPERAPP_PORTFOLIO_DOMAIN_ROUTE_CONTRACTS.filter(
      route => route.tenantId === 'city-ops-eu',
    );
    expect(new Set(cityRoutes.map(route => route.ownerAppId))).toEqual(
      new Set(['mobility-marketplace']),
    );
    expect(cityRoutes.map(route => route.path)).toEqual([
      '/mobility',
      '/mobility/dispatch',
      '/mobility/support',
    ]);

    const cityApps = cache.retainTenantAppDetails(
      'city-ops-eu',
      bootstrap.apps,
    );
    expect([...cityApps]).toEqual(['mobility-marketplace']);
    expect(
      cache.get<PortfolioApp>(
        createSuperAppQueryKey('portfolio.app.detail', {
          appId: 'mobility-marketplace',
        }),
      ),
    ).toMatchObject({
      id: 'mobility-marketplace',
      tenant: 'city-ops-eu',
    });
    expect(
      cache.get<PortfolioApp>(
        createSuperAppQueryKey('portfolio.app.detail', {
          appId: 'enterprise-mega-erp',
        }),
      ),
    ).toBeUndefined();

    const acmeApps = cache.retainTenantAppDetails(
      'acme-global',
      bootstrap.apps,
    );
    expect([...acmeApps]).toEqual(['enterprise-mega-erp']);
    const router = new ContractRouterHarness(cache);
    const acmeLoader = await router.prefetchAppRoute(
      'enterprise-mega-erp',
      async () => cloneJson(bootstrap),
    );
    expect(acmeLoader).toMatchObject({
      appId: 'enterprise-mega-erp',
      routeKind: 'erp',
    });
    expect(
      cache.get<PortfolioApp>(
        createSuperAppQueryKey('portfolio.app.detail', {
          appId: 'mobility-marketplace',
        }),
      ),
    ).toBeUndefined();
    expect(router.navigateToApp('enterprise-mega-erp')).toMatchObject({
      id: 'enterprise-mega-erp',
      tenant: 'acme-global',
    });
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
