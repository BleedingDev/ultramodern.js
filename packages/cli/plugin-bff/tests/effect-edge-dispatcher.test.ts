import type { NormalizedCrossProjectPolicy } from '@modern-js/bff-core/security/cross-project-policy';
import { createEffectBffEdgeDispatcher } from '../src/runtime/effect/edge-dispatcher';
import type { EffectBffHandlerFactory } from '../src/runtime/effect/module';

describe('Effect edge dispatcher', () => {
  test('rejects malformed normalized policy from direct edge callers', async () => {
    await expect(
      createEffectBffEdgeDispatcher({
        module: {},
        crossProjectPolicy: {
          enabled: 'true',
          expectedOperationContracts: {},
        } as never,
      }),
    ).rejects.toThrow('requires boolean enabled');
  });

  test('forwards Effect runtime config and enforces normalized cross-project policy', async () => {
    const openapi = { path: '/openapi.json' };
    const dataPlatform = {
      enabled: true,
      requireEnvelope: true,
      expectedNamespace: 'catalog',
      batch: { enabled: false },
    };
    const crossProjectPolicy: NormalizedCrossProjectPolicy = {
      enabled: true,
      requireEnvelope: true,
      requireOperationContext: true,
      requireOperationContextDetails: true,
      requireOperationSchemaHash: true,
      requireOperationVersion: true,
      allowUnknownOperations: false,
      denyStatus: 451,
      expectedOperationContracts: {
        'GET:/products/:id': {
          schemaHash: 'catalog-products-v4',
          operationVersion: 4,
        },
        'GET:/admin/:id': {
          schemaHash: 'catalog-admin-v4',
          operationVersion: 4,
        },
        'POST:/products/:id': {
          schemaHash: 'catalog-products-post-v4',
          operationVersion: 4,
        },
      },
    };
    let receivedOptions: Parameters<EffectBffHandlerFactory>[0];
    let handled = 0;
    let disposed = 0;
    const createHandler: EffectBffHandlerFactory = options => {
      receivedOptions = options;
      return {
        handler: request => {
          const denial = options?.validateRequest?.(request);
          if (denial) {
            return denial;
          }
          handled += 1;
          return Response.json({ ok: true });
        },
        dispose: async () => {
          disposed += 1;
        },
      };
    };
    Object.defineProperty(
      createHandler,
      Symbol.for('modernjs.effect.validatorAware'),
      { value: true },
    );

    const dispatcher = await createEffectBffEdgeDispatcher({
      module: { createHandler },
      prefix: '/catalog-api',
      openapi,
      dataPlatform,
      crossProjectPolicy,
    });

    expect(receivedOptions?.openapi).toBe(openapi);
    expect(receivedOptions?.dataPlatform).toBe(dataPlatform);
    expect(receivedOptions?.validateRequest).toBeTypeOf('function');

    const response = await dispatcher.dispatch(
      new Request('https://example.com/catalog-api/products/42'),
    );

    expect(response.status).toBe(451);
    await expect(response.json()).resolves.toMatchObject({
      code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
      reason: 'missing_envelope',
    });
    expect(handled).toBe(0);

    const operationId = 'catalog.consumer:GET:/products/:id';
    const acceptedHeaders = {
      'x-modernjs-bff-envelope': JSON.stringify({
        requestId: 'catalog.consumer',
      }),
      'x-operation-id': operationId,
      'x-modernjs-bff-operation-context': JSON.stringify({
        requestId: 'catalog.consumer',
        operationId,
        method: 'GET',
        routePath: '/products/:id',
        schemaHash: 'catalog-products-v4',
        operationVersion: 4,
      }),
    };
    const acceptedResponse = await dispatcher.dispatch(
      new Request('https://example.com/catalog-api/products/42', {
        headers: acceptedHeaders,
      }),
    );

    expect(acceptedResponse.status).toBe(200);
    await expect(acceptedResponse.json()).resolves.toEqual({ ok: true });
    expect(handled).toBe(1);

    const forgedRouteResponse = await dispatcher.dispatch(
      new Request('https://example.com/catalog-api/products/42', {
        headers: {
          ...acceptedHeaders,
          'x-modernjs-bff-operation-context': JSON.stringify({
            requestId: 'catalog.consumer',
            operationId,
            method: 'GET',
            routePath: '/admin/:id',
            schemaHash: 'catalog-admin-v4',
            operationVersion: 4,
          }),
        },
      }),
    );

    expect(forgedRouteResponse.status).toBe(451);
    await expect(forgedRouteResponse.json()).resolves.toMatchObject({
      code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
      reason: 'operation_context_mismatch',
    });
    expect(handled).toBe(1);

    const forgedMethodResponse = await dispatcher.dispatch(
      new Request('https://example.com/catalog-api/products/42', {
        headers: {
          ...acceptedHeaders,
          'x-modernjs-bff-operation-context': JSON.stringify({
            requestId: 'catalog.consumer',
            operationId,
            method: 'POST',
            routePath: '/products/:id',
            schemaHash: 'catalog-products-post-v4',
            operationVersion: 4,
          }),
        },
      }),
    );

    expect(forgedMethodResponse.status).toBe(451);
    await expect(forgedMethodResponse.json()).resolves.toMatchObject({
      code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
      reason: 'operation_context_mismatch',
    });
    expect(handled).toBe(1);

    const staleResponse = await dispatcher.dispatch(
      new Request('https://example.com/catalog-api/products/42', {
        headers: {
          ...acceptedHeaders,
          'x-modernjs-bff-operation-context': JSON.stringify({
            requestId: 'catalog.consumer',
            operationId,
            method: 'GET',
            routePath: '/products/:id',
            schemaHash: 'stale-contract',
            operationVersion: 4,
          }),
        },
      }),
    );

    expect(staleResponse.status).toBe(451);
    await expect(staleResponse.json()).resolves.toMatchObject({
      code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
      reason: 'operation_schema_hash_mismatch',
    });
    expect(handled).toBe(1);

    await dispatcher.dispose();
    expect(disposed).toBe(1);
  });
});
