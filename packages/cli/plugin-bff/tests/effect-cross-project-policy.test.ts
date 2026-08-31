import { resolveCrossProjectPolicy } from '@modern-js/bff-core';
import {
  collectEffectEndpoints,
  createEffectEndpointContractHash,
  type EffectApiModule,
  extractHttpApiFromModule,
  resolveEffectBffModuleHandler,
  toOperationContractSources,
} from '@modern-js/bff-effect/effect';
import { checkCrossProjectPolicyForRequest } from '../../plugin-bff-extensions/src/cross-project-policy/evaluation';
import {
  createHttpApiHandler,
  defineEffectBff,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '../src/runtime/effect';

const REQUEST_ID = 'crm.producer-app';
const PREFIX = '/api';

const pingApi = HttpApi.make('PolicyTestApi').add(
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({
        ok: Schema.Boolean,
      }),
    }),
  ),
);

const pingLayer = HttpApiBuilder.layer(pingApi).pipe(
  Layer.provide(
    HttpApiBuilder.group(pingApi, 'greetings', handlers =>
      handlers.handle('ping', () => Effect.succeed({ ok: true })),
    ),
  ),
);

const reflect: Parameters<typeof collectEffectEndpoints>[0] = (
  apiValue,
  handlers,
) =>
  HttpApi.reflect(apiValue as Parameters<typeof HttpApi.reflect>[0], {
    onGroup: handlers.onGroup ?? (() => {}),
    onEndpoint: handlers.onEndpoint,
  });

const collectEndpoints = () => collectEffectEndpoints(reflect, pingApi, PREFIX);

describe('effect endpoint contract module extraction', () => {
  test('does not execute default factory functions during contract extraction', async () => {
    let called = false;

    await expect(
      extractHttpApiFromModule(
        {
          default: () => {
            called = true;
            return { api: pingApi };
          },
        },
        HttpApi.isHttpApi,
      ),
    ).resolves.toBeNull();
    expect(called).toBe(false);
  });

  test('extracts HttpApi from defineEffectBff entries without factory execution', async () => {
    const module = defineEffectBff({
      api: pingApi,
      layer: pingLayer,
    });

    await expect(
      extractHttpApiFromModule(module, HttpApi.isHttpApi),
    ).resolves.toBe(pingApi);
  });

  test.each([
    [
      'defineEffectBff',
      () =>
        defineEffectBff({
          api: pingApi,
          layer: pingLayer,
        }),
    ],
    ['api/layer', () => ({ api: pingApi, layer: pingLayer })],
    [
      'default api/layer',
      () => ({
        default: {
          api: pingApi,
          layer: pingLayer,
        },
      }),
    ],
  ])('accepts runtime-valid %s in resolver and extractor', async (_name, createModule) => {
    const module = createModule();

    await expect(
      extractHttpApiFromModule(module, HttpApi.isHttpApi),
    ).resolves.toBe(pingApi);

    const resolved = await resolveEffectBffModuleHandler(
      module as EffectApiModule,
    );
    expect(resolved).not.toBeNull();
    await resolved?.dispose?.();
  });

  test.each([
    ['bare api', { api: pingApi }],
    ['default bare api', { default: { api: pingApi } }],
    [
      'default factory',
      {
        default: () => ({
          api: pingApi,
          layer: pingLayer,
        }),
      },
    ],
    [
      'unbranded createHandler with api/layer',
      {
        api: pingApi,
        layer: pingLayer,
        createHandler: () => ({
          handler: () => new Response('ok'),
          dispose: async () => {},
        }),
      },
    ],
  ])('rejects runtime-invalid %s in resolver and extractor', async (_name, module) => {
    await expect(
      extractHttpApiFromModule(module, HttpApi.isHttpApi),
    ).resolves.toBeNull();
    await expect(
      resolveEffectBffModuleHandler(module as EffectApiModule),
    ).resolves.toBeNull();
  });
});

const resolvePolicy = (
  extraPolicy: Record<string, unknown> = {},
): NonNullable<ReturnType<typeof resolveCrossProjectPolicy>> =>
  resolveCrossProjectPolicy({
    crossProjectPolicy: { enabled: true, ...extraPolicy },
    handlers: toOperationContractSources(collectEndpoints()),
    requestId: REQUEST_ID,
    isCrossProjectServer: true,
  })!;

const createPolicyHandler = (extraPolicy: Record<string, unknown> = {}) => {
  const policy = resolvePolicy(extraPolicy);
  return createHttpApiHandler({
    api: pingApi,
    layer: pingLayer,
    validateRequest: request =>
      checkCrossProjectPolicyForRequest(request, policy),
  });
};

const validPolicyHeaders = (): Record<string, string> => {
  const endpoint = collectEndpoints()[0]!;
  const schemaHash = createEffectEndpointContractHash(endpoint, REQUEST_ID);
  return {
    'x-modernjs-bff-envelope': JSON.stringify({ requestId: REQUEST_ID }),
    'x-operation-id': `${REQUEST_ID}:GET:${endpoint.routePath}`,
    'x-modernjs-bff-operation-context': JSON.stringify({
      requestId: REQUEST_ID,
      operationId: `${REQUEST_ID}:GET:${endpoint.routePath}`,
      method: 'GET',
      routePath: endpoint.routePath,
      schemaHash,
      operationVersion: 1,
    }),
  };
};

describe('effect lane cross-project policy enforcement', () => {
  test('denies requests without the cross-project envelope', async () => {
    const handler = createPolicyHandler();

    try {
      const response = await handler.handler(
        new Request('http://localhost/ping'),
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
        reason: 'missing_envelope',
      });
    } finally {
      await handler.dispose();
    }
  });

  test('allows requests carrying a valid envelope and operation contract', async () => {
    const handler = createPolicyHandler();

    try {
      const response = await handler.handler(
        new Request('http://localhost/ping', {
          headers: validPolicyHeaders(),
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await handler.dispose();
    }
  });

  test('denies a valid client contract when it does not match the observed request method', async () => {
    const response = checkCrossProjectPolicyForRequest(
      new Request('http://localhost/ping', {
        method: 'POST',
        headers: validPolicyHeaders(),
      }),
      resolvePolicy(),
    );

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(403);
    await expect(response!.json()).resolves.toMatchObject({
      reason: 'operation_context_mismatch',
    });
  });

  test('denies a valid client contract when it does not match the observed request path', async () => {
    const response = checkCrossProjectPolicyForRequest(
      new Request('http://localhost/not-ping', {
        headers: validPolicyHeaders(),
      }),
      resolvePolicy(),
    );

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(403);
    await expect(response!.json()).resolves.toMatchObject({
      reason: 'operation_context_mismatch',
    });
  });

  test('fails closed when contracts provide only a client-declared operation lookup', async () => {
    const resolvedPolicy = resolvePolicy();
    const operationId = `${REQUEST_ID}:GET:/api/ping`;
    const operationContract =
      resolvedPolicy.expectedOperationContracts['GET:/api/ping']!;
    const policy = {
      ...resolvedPolicy,
      expectedOperationContracts: {
        [`operation:${operationId}`]: operationContract,
      },
    };

    const response = checkCrossProjectPolicyForRequest(
      new Request('http://localhost/not-ping', {
        headers: validPolicyHeaders(),
      }),
      policy,
    );

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(403);
    await expect(response!.json()).resolves.toMatchObject({
      reason: 'operation_context_mismatch',
    });
  });

  test('binds a concrete Effect request path to its server-known route template', () => {
    const policy = resolveCrossProjectPolicy({
      crossProjectPolicy: { enabled: true },
      handlers: [
        {
          name: 'getCustomer',
          httpMethod: 'GET',
          routePath: '/api/customers/:id',
        },
      ],
      requestId: REQUEST_ID,
      isCrossProjectServer: true,
    })!;
    const contract =
      policy.expectedOperationContracts['GET:/api/customers/:id']!;
    const operationId = `${REQUEST_ID}:GET:/api/customers/:id`;

    const response = checkCrossProjectPolicyForRequest(
      new Request('http://localhost/customers/customer-42', {
        headers: {
          'x-modernjs-bff-envelope': JSON.stringify({
            requestId: REQUEST_ID,
          }),
          'x-operation-id': operationId,
          'x-modernjs-bff-operation-context': JSON.stringify({
            requestId: REQUEST_ID,
            operationId,
            method: 'GET',
            routePath: '/api/customers/:id',
            schemaHash: contract.schemaHash,
            operationVersion: contract.operationVersion,
          }),
        },
      }),
      policy,
    );

    expect(response).toBeNull();
  });

  test('denies stale schema hashes (contract mismatch)', async () => {
    const handler = createPolicyHandler();

    try {
      const headers = validPolicyHeaders();
      const details = JSON.parse(
        headers['x-modernjs-bff-operation-context']!,
      ) as Record<string, unknown>;
      details.schemaHash = 'deadbeef';
      headers['x-modernjs-bff-operation-context'] = JSON.stringify(details);

      const response = await handler.handler(
        new Request('http://localhost/ping', { headers }),
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        reason: 'operation_schema_hash_mismatch',
      });
    } finally {
      await handler.dispose();
    }
  });

  test('denies requests when no operation contracts were reflected', async () => {
    const policy = resolveCrossProjectPolicy({
      crossProjectPolicy: { enabled: true },
      handlers: [],
      requestId: REQUEST_ID,
      isCrossProjectServer: true,
    })!;

    const response = checkCrossProjectPolicyForRequest(
      new Request('http://localhost/ping', {
        headers: validPolicyHeaders(),
      }),
      policy,
    );

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(403);
    await expect(response!.json()).resolves.toMatchObject({
      code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
      reason: 'operation_context_mismatch',
    });
  });

  test('denies spoofed namespaces when bound to a verified identity', async () => {
    const handler = createPolicyHandler({
      allowedNamespaces: ['crm'],
      verifyProducerIdentity: (headers: Record<string, unknown>) =>
        typeof headers['x-verified-producer'] === 'string'
          ? (headers['x-verified-producer'] as string)
          : undefined,
    });

    try {
      // Client-asserted envelope claims "crm" but the verified channel says
      // "billing": the client-controlled header must not win.
      const spoofed = await handler.handler(
        new Request('http://localhost/ping', {
          headers: {
            ...validPolicyHeaders(),
            'x-verified-producer': 'billing',
          },
        }),
      );
      expect(spoofed.status).toBe(403);
      await expect(spoofed.json()).resolves.toMatchObject({
        reason: 'producer_identity_mismatch',
      });

      const verified = await handler.handler(
        new Request('http://localhost/ping', {
          headers: {
            ...validPolicyHeaders(),
            'x-verified-producer': 'crm',
          },
        }),
      );
      expect(verified.status).toBe(200);
    } finally {
      await handler.dispose();
    }
  });

  test('batched items cannot bypass the policy seam', async () => {
    const handler = createPolicyHandler();

    try {
      const batchPayload = {
        protocolVersion: 2,
        batchId: 'batch-policy-test',
        sentAt: Date.now(),
        items: [
          {
            id: 'no-headers',
            path: '/ping',
            method: 'GET',
          },
          {
            id: 'with-headers',
            path: '/ping',
            method: 'GET',
            headers: validPolicyHeaders(),
          },
        ],
      };

      const response = await handler.handler(
        new Request('http://localhost/_data/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(batchPayload),
        }),
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        items: Array<{
          id: string;
          status: number;
          body?: { encoding: 'base64'; data: string };
        }>;
      };

      const unauthenticated = payload.items.find(
        item => item.id === 'no-headers',
      );
      expect(unauthenticated?.status).toBe(403);
      expect(
        JSON.parse(atob(unauthenticated?.body?.data || 'e30=')),
      ).toMatchObject({
        reason: 'missing_envelope',
      });

      const authenticated = payload.items.find(
        item => item.id === 'with-headers',
      );
      expect(authenticated?.status).toBe(200);
    } finally {
      await handler.dispose();
    }
  });
});

describe('custom createHandler factory policy enforcement', () => {
  test('branded defineEffectBff factories keep internal (per-batch-item capable) enforcement', async () => {
    const policy = resolvePolicy();
    const warnings: string[] = [];
    const runtime = defineEffectBff({
      api: pingApi,
      layer: pingLayer,
    });

    const loaded = await resolveEffectBffModuleHandler(
      runtime as unknown as EffectApiModule,
      {
        validateRequest: request =>
          checkCrossProjectPolicyForRequest(request, policy),
        onWarning: message => warnings.push(message),
      },
    );

    expect(loaded).not.toBeNull();
    expect(warnings).toEqual([]);

    try {
      const denied = await loaded!.handler(
        new Request('http://localhost/ping'),
      );
      expect(denied.status).toBe(403);
      await expect(denied.json()).resolves.toMatchObject({
        code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
        reason: 'missing_envelope',
      });

      const allowed = await loaded!.handler(
        new Request('http://localhost/ping', {
          headers: validPolicyHeaders(),
        }),
      );
      expect(allowed.status).toBe(200);
      await expect(allowed.json()).resolves.toEqual({ ok: true });
    } finally {
      await loaded?.dispose?.();
    }
  });

  test('unbranded custom factories are rejected by strictEffectApproach by default', async () => {
    const warnings: string[] = [];
    const customModule: EffectApiModule = {
      createHandler: () => ({
        handler: async () => new Response(JSON.stringify({ ok: true })),
        dispose: async () => Promise.resolve(),
      }),
    };

    const loaded = await resolveEffectBffModuleHandler(customModule, {
      onWarning: message => warnings.push(message),
    });

    expect(loaded).toBeNull();
    expect(
      warnings.some(message => message.includes('strictEffectApproach')),
    ).toBe(true);
  });

  test('defineEffectBff policy binds the observed operation before interceptors', async () => {
    const policy = resolvePolicy();
    let interceptedRequests = 0;
    const runtime = defineEffectBff({
      api: pingApi,
      layer: pingLayer,
      interceptRequest: ({ request, next }) => {
        interceptedRequests += 1;
        return new URL(request.url).pathname === '/legacy'
          ? Response.json({ source: 'interceptor' })
          : next();
      },
    });
    const loaded = await resolveEffectBffModuleHandler(
      runtime as unknown as EffectApiModule,
      {
        validateRequest: request =>
          checkCrossProjectPolicyForRequest(request, policy),
      },
    );

    expect(loaded).not.toBeNull();
    try {
      const denied = await loaded!.handler(
        new Request('http://localhost/legacy'),
      );
      expect(denied.status).toBe(403);
      expect(interceptedRequests).toBe(0);

      const intercepted = await loaded!.handler(
        new Request('http://localhost/legacy', {
          headers: validPolicyHeaders(),
        }),
      );
      expect(intercepted.status).toBe(403);
      await expect(intercepted.json()).resolves.toMatchObject({
        reason: 'operation_context_mismatch',
      });

      const interceptedMalformedBody = await loaded!.handler(
        new Request('http://localhost/legacy', {
          method: 'POST',
          headers: {
            ...validPolicyHeaders(),
            'content-type': 'application/json',
          },
          body: '{',
        }),
      );
      expect(interceptedMalformedBody.status).toBe(403);
      await expect(interceptedMalformedBody.json()).resolves.toMatchObject({
        reason: 'operation_context_mismatch',
      });

      const delegatedMalformedBody = await loaded!.handler(
        new Request('http://localhost/ping', {
          method: 'POST',
          headers: {
            ...validPolicyHeaders(),
            'content-type': 'application/json',
          },
          body: '{',
        }),
      );
      expect(delegatedMalformedBody.status).toBe(403);
      await expect(delegatedMalformedBody.json()).resolves.toMatchObject({
        reason: 'operation_context_mismatch',
      });

      const delegated = await loaded!.handler(
        new Request('http://localhost/ping', {
          headers: validPolicyHeaders(),
        }),
      );
      expect(delegated.status).toBe(200);
      await expect(delegated.json()).resolves.toEqual({ ok: true });
      expect(interceptedRequests).toBe(1);
    } finally {
      await loaded?.dispose?.();
    }
  });
});

describe('defineEffectBff client placeholder', () => {
  test('throws an actionable error when the loader-materialized client is used directly', () => {
    const runtime = defineEffectBff({
      api: pingApi,
      layer: pingLayer,
    });

    expect(() => (runtime.client as Record<string, unknown>).greetings).toThrow(
      /only exists when the API entry is imported through the "@api\/index" transformed path/,
    );
  });

  test('stays inert for await/inspection protocols', async () => {
    const runtime = defineEffectBff({
      api: pingApi,
      layer: pingLayer,
    });

    // Awaiting the surrounding object must not trigger the client trap.
    const resolved = await Promise.resolve(runtime);
    expect(resolved).toBe(runtime);
    expect(
      (runtime.client as unknown as Record<string, unknown>).then,
    ).toBeUndefined();
  });
});
