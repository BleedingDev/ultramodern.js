import {
  collectEffectEndpoints,
  createEffectEndpointContractHash,
  createHttpApiHandler,
  defineEffectBff,
  type EffectApiModule,
  resolveEffectBffModuleHandler,
  toOperationContractSources,
} from '@modern-js/bff-effect/effect';
import { resolveCrossProjectPolicy } from '@modern-js/server-runtime-extensions/bff-policy/node';
import * as Effect from 'effect/Effect';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from 'effect/http-api';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { checkCrossProjectPolicyForRequest } from '../src/cross-project-policy/evaluation';

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
