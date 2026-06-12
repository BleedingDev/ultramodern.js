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
    HttpApiEndpoint.get('ping', '/effect/ping', {
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
        new Request('http://localhost/effect/ping'),
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
        new Request('http://localhost/effect/ping', {
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
        new Request('http://localhost/effect/ping', { headers }),
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
        new Request('http://localhost/effect/ping', {
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
        new Request('http://localhost/effect/ping', {
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
            path: '/effect/ping',
            method: 'GET',
          },
          {
            id: 'with-headers',
            path: '/effect/ping',
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
    expect(loaded?.appliesRequestValidator).toBe(true);
    expect(warnings).toEqual([]);

    try {
      const denied = await loaded!.handler(
        new Request('http://localhost/effect/ping'),
      );
      expect(denied.status).toBe(403);
      await expect(denied.json()).resolves.toMatchObject({
        code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
        reason: 'missing_envelope',
      });

      const allowed = await loaded!.handler(
        new Request('http://localhost/effect/ping', {
          headers: validPolicyHeaders(),
        }),
      );
      expect(allowed.status).toBe(200);
      await expect(allowed.json()).resolves.toEqual({ ok: true });
    } finally {
      await loaded?.dispose?.();
    }
  });

  test('unbranded custom factories that ignore validateRequest fall back to middleware enforcement', async () => {
    const policy = resolvePolicy();
    const warnings: string[] = [];
    // A custom factory matching the public EffectBffHandlerFactory shape
    // that performs NO policy check (it ignores options entirely).
    const customModule: EffectApiModule = {
      createHandler: () => ({
        handler: async () =>
          new Response(JSON.stringify({ ok: true, lane: 'custom-factory' }), {
            headers: { 'content-type': 'application/json; charset=utf-8' },
          }),
        dispose: async () => Promise.resolve(),
      }),
    };

    const loaded = await resolveEffectBffModuleHandler(customModule, {
      validateRequest: request =>
        checkCrossProjectPolicyForRequest(request, policy),
      onWarning: message => warnings.push(message),
    });

    expect(loaded).not.toBeNull();
    // The factory cannot be trusted to run the policy seam, so it must NOT
    // claim internal enforcement — the adapter middleware takes over
    // (policyEnforcedInMiddleware = !appliesRequestValidator).
    expect(loaded?.appliesRequestValidator).toBeUndefined();
    expect(warnings.some(message => message.includes('defineEffectBff'))).toBe(
      true,
    );

    try {
      // Proof the factory really ignores the validator: without middleware
      // enforcement this unauthenticated request would sail through.
      const unenforced = await loaded!.handler(
        new Request('http://localhost/effect/ping'),
      );
      expect(unenforced.status).toBe(200);

      // The middleware-side check the adapter applies for this shape still
      // denies the same request.
      const denial = checkCrossProjectPolicyForRequest(
        new Request('http://localhost/api/effect/ping'),
        policy,
      );
      expect(denial?.status).toBe(403);
      await expect(denial?.json()).resolves.toMatchObject({
        reason: 'missing_envelope',
      });
    } finally {
      await loaded?.dispose?.();
    }
  });

  test('effect adapter denies unauthenticated requests when the entry exports a custom factory ignoring validateRequest', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-custom-factory-'),
    );
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];

    try {
      const entryFile = path.join(appDir, 'api', 'effect', 'index.js');
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await fs.promises.writeFile(
        entryFile,
        `module.exports = {
  createHandler: () => ({
    handler: async () =>
      new Response(JSON.stringify({ ok: true, lane: 'custom-factory' }), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    dispose: async () => {},
  }),
};
`,
      );

      const api = {
        getServerContext() {
          return {
            bffRuntimeFramework: 'effect',
            middlewares,
            appDirectory: appDir,
          };
        },
        getServerConfig() {
          return {
            bff: {
              requestId: REQUEST_ID,
              isCrossProjectServer: true,
              crossProjectPolicy: { enabled: true },
            },
          };
        },
      } as unknown as ServerPluginAPI;

      const adapter = new EffectAdapter(api);
      await adapter.registerMiddleware({
        prefix: '/api',
        enableHandleWeb: false,
      });

      const middleware = middlewares[0];
      expect(middleware).toBeDefined();

      const invoke = (request: Request) =>
        middleware!.handler(
          {
            req: {
              raw: request,
              path: new URL(request.url).pathname,
              method: request.method,
            },
            env: {},
          },
          async () => {},
        ) as Promise<Response>;

      // The factory ignores validateRequest, so without middleware fallback
      // this request would be silently let through (the pre-fix behavior).
      const denied = await invoke(
        new Request('http://localhost/api/effect/ping'),
      );
      expect(denied.status).toBe(403);
      await expect(denied.json()).resolves.toMatchObject({
        code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
        reason: 'missing_envelope',
      });

      // Requests carrying a valid envelope/operation context still reach the
      // custom handler through the middleware check.
      const allowed = await invoke(
        new Request('http://localhost/api/effect/ping', {
          headers: validPolicyHeaders(),
        }),
      );
      expect(allowed.status).toBe(200);
      await expect(allowed.json()).resolves.toMatchObject({
        lane: 'custom-factory',
      });
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('effect adapter contract map covers hosted lambda-lane handlers', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-lambda-contracts-'),
    );
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];

    try {
      // Producer SDK layout: an effect entry with a custom factory (policy
      // enforced by the adapter middleware) plus lambda-lane handlers the
      // generated client stamps per-operation contracts for.
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'producer-sdk', version: '3.2.1' }),
      );
      const entryFile = path.join(appDir, 'api', 'effect', 'index.js');
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await fs.promises.writeFile(
        entryFile,
        `module.exports = {
  createHandler: () => ({
    handler: async () =>
      new Response(JSON.stringify({ ok: true, lane: 'custom-factory' }), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    dispose: async () => {},
  }),
};
`,
      );
      const lambdaFile = path.join(appDir, 'api', 'lambda', 'index.js');
      await fs.promises.mkdir(path.dirname(lambdaFile), { recursive: true });
      await fs.promises.writeFile(
        lambdaFile,
        `module.exports.default = async () => ({ message: 'hello' });
`,
      );

      const apiDirectory = path.join(appDir, 'api');
      const api = {
        getServerContext() {
          return {
            bffRuntimeFramework: 'effect',
            middlewares,
            appDirectory: appDir,
            apiDirectory,
          };
        },
        getServerConfig() {
          return {
            bff: {
              requestId: REQUEST_ID,
              isCrossProjectServer: true,
              crossProjectPolicy: { enabled: true },
            },
          };
        },
      } as unknown as ServerPluginAPI;

      const adapter = new EffectAdapter(api);
      await adapter.registerMiddleware({
        prefix: '/api',
        enableHandleWeb: false,
      });

      // The expected-contract map must include the lambda-lane operation
      // keyed exactly like buildOperationContractMap on the client side.
      const lambdaContract =
        adapter.crossProjectPolicy?.expectedOperationContracts?.['GET:/api'];
      expect(lambdaContract).toBeDefined();
      expect(lambdaContract).toMatchObject({
        requestId: REQUEST_ID,
        method: 'GET',
        routePath: '/api',
        operationId: `${REQUEST_ID}:default`,
        // semver major of the producer package.json
        operationVersion: 3,
      });
      expect(lambdaContract!.schemaHash).toMatch(/^[0-9a-f]{64}$/);
      expect(
        adapter.crossProjectPolicy?.expectedOperationContracts?.[
          `operation:${REQUEST_ID}:default`
        ],
      ).toBe(lambdaContract);

      const middleware = middlewares[0];
      expect(middleware).toBeDefined();

      const invoke = (request: Request) =>
        middleware!.handler(
          {
            req: {
              raw: request,
              path: new URL(request.url).pathname,
              method: request.method,
            },
            env: {},
          },
          async () => {},
        ) as Promise<Response>;

      // A lambda-lane request stamped the way the generated client does it
      // passes the middleware policy (pre-fix: unknown_operation_contract).
      const allowed = await invoke(
        new Request('http://localhost/api', {
          headers: {
            'x-modernjs-bff-envelope': JSON.stringify({
              requestId: REQUEST_ID,
            }),
            'x-operation-id': `${REQUEST_ID}:default`,
            'x-modernjs-bff-operation-context': JSON.stringify({
              requestId: REQUEST_ID,
              operationId: `${REQUEST_ID}:default`,
              method: 'GET',
              routePath: '/api',
              schemaHash: lambdaContract!.schemaHash,
              operationVersion: 3,
            }),
          },
        }),
      );
      expect(allowed.status).toBe(200);
      await expect(allowed.json()).resolves.toMatchObject({
        lane: 'custom-factory',
      });

      // An unknown lambda-lane operation is still denied.
      const denied = await invoke(
        new Request('http://localhost/api/unknown', {
          headers: {
            'x-modernjs-bff-envelope': JSON.stringify({
              requestId: REQUEST_ID,
            }),
            'x-operation-id': `${REQUEST_ID}:nope`,
            'x-modernjs-bff-operation-context': JSON.stringify({
              requestId: REQUEST_ID,
              operationId: `${REQUEST_ID}:nope`,
              method: 'GET',
              routePath: '/api/unknown',
              schemaHash: 'a'.repeat(64),
              operationVersion: 3,
            }),
          },
        }),
      );
      expect(denied.status).toBe(403);
      await expect(denied.json()).resolves.toMatchObject({
        code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
        reason: 'unknown_operation_contract',
      });
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
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
      /only exists when this module is imported through the "@api\/effect\/\*" transformed path/,
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
