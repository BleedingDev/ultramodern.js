import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCrossProjectPolicy } from '@modern-js/bff-core';
import type { ServerPluginAPI } from '@modern-js/server-core';
import {
  createHttpApiHandler,
  defineEffectBff,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  isValidatorAwareHandlerFactory,
  Layer,
  Schema,
} from '../src/runtime/effect';
import { EffectAdapter } from '../src/runtime/effect/adapter';
import {
  collectEffectEndpoints,
  createEffectEndpointContractHash,
  extractHttpApiFromModule,
  toOperationContractSources,
} from '../src/runtime/effect/endpoint-contracts';
import {
  type EffectApiModule,
  resolveEffectBffModuleHandler,
} from '../src/runtime/effect/module';
import { checkCrossProjectPolicyForRequest } from '../src/utils/crossProjectServerPolicy';

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
  test('propagates zero-arg default factory failures', async () => {
    const error = new Error('factory failed');

    await expect(
      extractHttpApiFromModule(
        {
          default: () => {
            throw error;
          },
        },
        HttpApi.isHttpApi,
      ),
    ).rejects.toThrow(error);
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
        protocolVersion: 1,
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
        items: Array<{ id: string; status: number; body?: string }>;
      };

      const unauthenticated = payload.items.find(
        item => item.id === 'no-headers',
      );
      expect(unauthenticated?.status).toBe(403);
      expect(JSON.parse(unauthenticated?.body || '{}')).toMatchObject({
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
  test('defineEffectBff brands its createHandler factory as validator-aware', () => {
    const runtime = defineEffectBff({
      api: pingApi,
      layer: pingLayer,
    });

    expect(isValidatorAwareHandlerFactory(runtime.createHandler)).toBe(true);
    // A hand-written factory matching the same shape carries no guarantee.
    expect(isValidatorAwareHandlerFactory(() => ({}))).toBe(false);
    expect(isValidatorAwareHandlerFactory(undefined)).toBe(false);
  });

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
