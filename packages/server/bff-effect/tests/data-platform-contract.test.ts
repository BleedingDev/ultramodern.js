import {
  buildQueryKey,
  buildScopeKey,
  createDataBatchTransportTelemetryAttributes,
  createHydrationEnvelope,
  createInvalidationEvent,
  createOperationId,
  createRequestEnvelope,
  DATA_BATCH_TRANSPORT_OTEL_EVENT,
  deriveChildTraceContext,
  formatTraceparentHeader,
  parseTraceparentHeader,
  type SelectionPlan,
  shouldApplyInvalidation,
  validateHydrationEnvelope,
  validateRequestEnvelope,
  validateSelectionPlan,
} from '../src/data-platform';

describe('data-platform architecture contracts', () => {
  test('maps batch transport events to stable OTel attributes', () => {
    expect(DATA_BATCH_TRANSPORT_OTEL_EVENT).toBe('modernjs.data.batch');
    expect(
      createDataBatchTransportTelemetryAttributes({
        type: 'fallback',
        endpoint: 'http://localhost:8080/_data/batch',
        batchId: 'batch-1',
        size: 3,
        reason: 'batch-timeout',
      }),
    ).toEqual({
      'modernjs.data.batch.degraded': true,
      'modernjs.data.batch.endpoint': 'http://localhost:8080/_data/batch',
      'modernjs.data.batch.id': 'batch-1',
      'modernjs.data.batch.reason': 'batch-timeout',
      'modernjs.data.batch.size': 3,
      'modernjs.data.batch.type': 'fallback',
    });
  });

  test('creates deterministic operation IDs and prevents cross-app collisions', () => {
    const hostOperation = {
      appNamespace: 'host-app',
      apiId: 'OrdersApi',
      group: 'orders',
      endpoint: 'list',
      version: 1,
      schemaHash: 'a1',
    } as const;

    const sameHostOperation = {
      apiId: 'OrdersApi',
      endpoint: 'list',
      group: 'orders',
      appNamespace: 'host-app',
      version: 1,
      schemaHash: 'a1',
    } as const;

    const remoteOperation = {
      ...hostOperation,
      appNamespace: 'remote-app',
    } as const;

    const hostOperationId = createOperationId(hostOperation);
    const sameHostOperationId = createOperationId(sameHostOperation);
    const remoteOperationId = createOperationId(remoteOperation);

    expect(hostOperationId).toBe(sameHostOperationId);
    expect(hostOperationId).not.toBe(remoteOperationId);
  });

  test('isolates scope and query keys by namespace and normalized origin', () => {
    const hostScope = buildScopeKey({
      appNamespace: 'host-app',
      origin: 'HTTP://LOCALHOST:3011/mf',
      userId: 'u-1',
    });

    const hostScopeNormalized = buildScopeKey({
      appNamespace: 'host-app',
      origin: 'http://localhost:3011',
      userId: 'u-1',
    });

    const remoteScope = buildScopeKey({
      appNamespace: 'remote-app',
      origin: 'http://localhost:3011',
      userId: 'u-1',
    });

    expect(hostScope).toBe(hostScopeNormalized);
    expect(hostScope).not.toBe(remoteScope);

    const operationId = createOperationId({
      appNamespace: 'host-app',
      apiId: 'OrdersApi',
      group: 'orders',
      endpoint: 'list',
    });

    const queryA = buildQueryKey({
      operationId,
      scopeKey: hostScope,
      requestInput: {
        page: 1,
        filters: {
          status: 'open',
        },
      },
      selectionPlan: {
        id: true,
        summary: {
          total: true,
        },
      },
    });

    const queryB = buildQueryKey({
      operationId,
      scopeKey: hostScope,
      requestInput: {
        filters: {
          status: 'open',
        },
        page: 1,
      },
      selectionPlan: {
        summary: {
          total: true,
        },
        id: true,
      },
    });

    expect(queryA).toBe(queryB);
  });

  test('validates selection plans with depth, field, and allow-list limits', () => {
    const validPlan: SelectionPlan = {
      id: true,
      profile: {
        name: true,
      },
    };

    const valid = validateSelectionPlan(validPlan, {
      maxDepth: 3,
      maxFields: 5,
      allowedLeafPaths: ['id', 'profile.name'],
    });

    expect(valid.ok).toBe(true);

    const tooDeepPlan: SelectionPlan = {
      a: {
        b: {
          c: {
            d: true,
          },
        },
      },
    };

    const tooDeep = validateSelectionPlan(tooDeepPlan, {
      maxDepth: 3,
    });

    expect(tooDeep.ok).toBe(false);
    expect(tooDeep.errors.join('\n')).toContain('exceeds maxDepth');

    const tooManyFields = validateSelectionPlan(
      {
        a: true,
        b: true,
        c: true,
      },
      {
        maxFields: 2,
      },
    );

    expect(tooManyFields.ok).toBe(false);
    expect(tooManyFields.errors.join('\n')).toContain('too many fields');

    const unknownField = validateSelectionPlan(
      {
        id: true,
        profile: {
          email: true,
        },
      },
      {
        allowedLeafPaths: ['id', 'profile.name'],
      },
    );

    expect(unknownField.ok).toBe(false);
    expect(unknownField.errors.join('\n')).toContain('Unknown selected field');

    const invalidValue = validateSelectionPlan({
      id: 1 as unknown as true,
    });

    expect(invalidValue.ok).toBe(false);
    expect(invalidValue.errors.join('\n')).toContain('Invalid selection value');
  });

  test('creates and validates request envelopes with integrity and trace requirements', () => {
    const trace = {
      traceId: '11111111111111111111111111111111',
      spanId: '2222222222222222',
      sampled: true,
    } as const;

    const envelope = createRequestEnvelope({
      operation: {
        appNamespace: 'host-app',
        apiId: 'OrdersApi',
        group: 'orders',
        endpoint: 'list',
      },
      scope: {
        appNamespace: 'host-app',
        origin: 'http://localhost:3011',
        userId: 'u-1',
      },
      requestInput: {
        page: 1,
      },
      requestMode: 'cache-first',
      traceContext: trace,
      requireTraceContext: true,
      selectionPlan: {
        id: true,
      },
      timestamp: 1700000000000,
    });

    const valid = validateRequestEnvelope(envelope, {
      expectedProtocolVersion: 1,
      expectedNamespace: 'host-app',
      expectedOrigin: 'http://localhost:3011/mf',
      requireTraceContext: true,
    });

    expect(valid.ok).toBe(true);
    expect(envelope.traceparent).toBe(
      '00-11111111111111111111111111111111-2222222222222222-01',
    );

    const tampered = {
      ...envelope,
      input: {
        page: 2,
      },
    };

    const tamperedResult = validateRequestEnvelope(tampered, {
      expectedProtocolVersion: 1,
      requireTraceContext: true,
    });

    expect(tamperedResult.ok).toBe(false);
    expect(tamperedResult.errors).toContain('Input hash mismatch');

    expect(() =>
      createRequestEnvelope({
        operation: {
          appNamespace: 'host-app',
          apiId: 'OrdersApi',
          group: 'orders',
          endpoint: 'list',
        },
        scope: {
          appNamespace: 'host-app',
          origin: 'http://localhost:3011',
        },
        requestInput: {},
        requireTraceContext: true,
      }),
    ).toThrow('Trace context is required');
  });

  test('detects hydration payload tampering and metadata mismatches', () => {
    const envelope = createHydrationEnvelope({
      runtimeVersion: '1.0.0',
      scope: {
        appNamespace: 'host-app',
        origin: 'http://localhost:3011/mf',
      },
      payload: {
        queries: [{ id: 'q1', data: { count: 2 } }],
      },
      createdAt: 1700000000000,
    });

    const valid = validateHydrationEnvelope(envelope, {
      expectedProtocolVersion: 1,
      expectedNamespace: 'host-app',
      expectedOrigin: 'http://localhost:3011',
      expectedRuntimeVersion: '1.0.0',
    });

    expect(valid.ok).toBe(true);

    const tampered = {
      ...envelope,
      payload: {
        queries: [{ id: 'q1', data: { count: 999 } }],
      },
    };

    const tamperedResult = validateHydrationEnvelope(tampered, {
      expectedNamespace: 'host-app',
      expectedOrigin: 'http://localhost:3011',
      expectedRuntimeVersion: '1.0.0',
    });

    expect(tamperedResult.ok).toBe(false);
    expect(tamperedResult.errors).toContain('Hydration checksum mismatch');
  });

  test('prevents accidental cross-namespace invalidation unless explicitly enabled', () => {
    const hostTarget = {
      appNamespace: 'host-app',
      apiId: 'HostApi',
      group: 'mf',
      endpoint: 'page.loader',
    };

    const event = createInvalidationEvent({
      sourceOperation: {
        appNamespace: 'remote-app',
        apiId: 'RemoteApi',
        group: 'mutator',
        endpoint: 'submit',
      },
      sourceScope: {
        appNamespace: 'host-app',
        origin: 'http://localhost:3011',
        userId: 'u-1',
      },
      targetNamespaces: ['host-app'],
      targetOperations: [hostTarget],
    });

    const hostScopeKey = buildScopeKey({
      appNamespace: 'host-app',
      origin: 'http://localhost:3011',
      userId: 'u-1',
    });

    const remoteScopeKey = buildScopeKey({
      appNamespace: 'remote-app',
      origin: 'http://localhost:3010',
      userId: 'u-1',
    });

    const hostSubscriberNoCross = {
      namespace: 'host-app',
      scopeKey: hostScopeKey,
      operationIds: [createOperationId(hostTarget)],
      acceptCrossNamespace: false,
    };

    const hostSubscriberCross = {
      ...hostSubscriberNoCross,
      acceptCrossNamespace: true,
    };

    const remoteSubscriber = {
      namespace: 'remote-app',
      scopeKey: remoteScopeKey,
      acceptCrossNamespace: true,
    };

    expect(shouldApplyInvalidation(event, hostSubscriberNoCross)).toBe(false);
    expect(shouldApplyInvalidation(event, hostSubscriberCross)).toBe(true);
    expect(shouldApplyInvalidation(event, remoteSubscriber)).toBe(false);
  });

  test('simulated MF mutation scenario invalidates only targeted host query scope', () => {
    const hostLoaderOperation = {
      appNamespace: 'host-app',
      apiId: 'HostApi',
      group: 'mf',
      endpoint: 'page.loader',
    };

    const hostScope = {
      appNamespace: 'host-app',
      origin: 'http://localhost:3011',
      userId: 'u-1',
    };

    const remoteScope = {
      appNamespace: 'remote-app',
      origin: 'http://localhost:3010',
      userId: 'u-1',
    };

    const hostQueryKey = buildQueryKey({
      operationId: createOperationId(hostLoaderOperation),
      scopeKey: buildScopeKey(hostScope),
      requestInput: {
        route: '/mf',
      },
    });

    const remoteQueryKey = buildQueryKey({
      operationId: createOperationId({
        appNamespace: 'remote-app',
        apiId: 'RemoteApi',
        group: 'widget',
        endpoint: 'panel.loader',
      }),
      scopeKey: buildScopeKey(remoteScope),
      requestInput: {
        route: '/remote',
      },
    });

    const hostCache = new Map<string, { count: number }>([
      [hostQueryKey, { count: 1 }],
    ]);
    const remoteCache = new Map<string, { count: number }>([
      [remoteQueryKey, { count: 42 }],
    ]);

    const event = createInvalidationEvent({
      sourceOperation: {
        appNamespace: 'remote-app',
        apiId: 'RemoteApi',
        group: 'mutator',
        endpoint: 'submit',
      },
      sourceScope: hostScope,
      targetNamespaces: ['host-app'],
      targetOperations: [hostLoaderOperation],
    });

    const hostSubscriber = {
      namespace: 'host-app',
      scopeKey: buildScopeKey(hostScope),
      operationIds: [createOperationId(hostLoaderOperation)],
      acceptCrossNamespace: true,
    };

    const remoteSubscriber = {
      namespace: 'remote-app',
      scopeKey: buildScopeKey(remoteScope),
    };

    if (shouldApplyInvalidation(event, hostSubscriber)) {
      hostCache.delete(hostQueryKey);
    }
    if (shouldApplyInvalidation(event, remoteSubscriber)) {
      remoteCache.delete(remoteQueryKey);
    }

    expect(hostCache.has(hostQueryKey)).toBe(false);
    expect(remoteCache.has(remoteQueryKey)).toBe(true);
  });

  test('simulated distributed tracing preserves parent-child relationships', () => {
    const browserTraceparent =
      '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

    const browserContext = parseTraceparentHeader(browserTraceparent);
    expect(browserContext).toBeTruthy();

    if (!browserContext) {
      throw new Error('Expected valid browser trace context');
    }

    const hostContext = deriveChildTraceContext(
      browserContext,
      'cccccccccccccccc',
    );
    const remoteContext = deriveChildTraceContext(
      hostContext,
      'dddddddddddddddd',
    );

    expect(hostContext.traceId).toBe(browserContext.traceId);
    expect(hostContext.parentSpanId).toBe(browserContext.spanId);
    expect(remoteContext.traceId).toBe(browserContext.traceId);
    expect(remoteContext.parentSpanId).toBe(hostContext.spanId);

    expect(formatTraceparentHeader(hostContext)).toBe(
      '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cccccccccccccccc-01',
    );
    expect(formatTraceparentHeader(remoteContext)).toBe(
      '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-dddddddddddddddd-01',
    );

    expect(parseTraceparentHeader('00-xyz-123-01')).toBeNull();
  });
});
