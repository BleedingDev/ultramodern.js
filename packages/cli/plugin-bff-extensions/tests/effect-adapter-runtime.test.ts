import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEffectEndpointContractHash } from '@modern-js/bff-effect/effect';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { disposeServerRuntime } from '@modern-js/server-runtime-extensions/runtime-lifecycle';
import { describe, expect, test } from '@rstest/core';

import { EffectAdapter } from '../src/effect-adapter';

type Middleware = {
  before?: string[];
  handler: (context: unknown, next: () => Promise<void>) => Promise<unknown>;
  path: string;
};

describe('EffectAdapter runtime ownership', () => {
  test('shares one public Effect runtime across prefixes and disposes once', async () => {
    const appDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-effect-adapter-shared-'),
    );
    const lifecycleMarker = Symbol.for(
      `modernjs.effect-adapter.shared.${path.basename(appDirectory)}`,
    );
    const lifecycle = { initialized: 0, disposed: 0 };
    const testGlobal = globalThis as typeof globalThis & {
      [lifecycleMarker]?: typeof lifecycle;
    };
    const originalNodeEnv = process.env.NODE_ENV;
    testGlobal[lifecycleMarker] = lifecycle;
    const serverBase = {};
    const middlewares: Middleware[] = [];
    const entryFile = path.join(appDirectory, 'api', 'effect.mjs');
    const entrySource = `
import {
  defineEffectBff,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
  useEffectContext,
} from '@modern-js/bff-effect/effect';

const marker = Symbol.for(${JSON.stringify(lifecycleMarker.description)});
const api = HttpApi.make('SharedPrefixApi').add(
  HttpApiGroup.make('shared').add(
    HttpApiEndpoint.get('value', '/value', {
      success: Schema.Struct({
        value: Schema.String,
        requestPath: Schema.String,
        middlewarePath: Schema.String,
        method: Schema.String,
        binding: Schema.String,
      }),
    }),
  ),
);
const routes = HttpApiBuilder.group(api, 'shared', handlers =>
  handlers.handle('value', () => Effect.sync(() => {
    const context = useEffectContext();
    return {
      value: 'shared-runtime',
      requestPath: new URL(context.request.url).pathname,
      middlewarePath: context.path,
      method: context.method,
      binding: String(context.env.binding),
    };
  })),
);
const lifecycle = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.sync(() => { globalThis[marker].initialized += 1; }),
    () => Effect.sync(() => { globalThis[marker].disposed += 1; }),
  ),
);

const runtime = defineEffectBff({
  api,
  layer: Layer.merge(
    HttpApiBuilder.layer(api).pipe(Layer.provide(routes)),
    lifecycle,
  ),
});
export const { api: effectApi, layer: effectLayer } = runtime;
export { effectApi as api, effectLayer as layer };
`;

    try {
      await fs.promises.symlink(
        path.resolve(__dirname, '../node_modules'),
        path.join(appDirectory, 'node_modules'),
        'dir',
      );
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await fs.promises.writeFile(entryFile, entrySource);
      process.env.NODE_ENV = 'production';
      const api = {
        getServerContext: () => ({
          appDirectory,
          apiDirectory: path.dirname(entryFile),
          bffRuntimeFramework: 'effect',
          middlewares,
          serverBase,
        }),
        getServerConfig: () => ({
          bff: { effect: { entry: entryFile } },
        }),
      } as unknown as ServerPluginAPI;
      const adapter = new EffectAdapter(api);
      const invoke = async (middleware: Middleware, prefix: string) => {
        const response = (await middleware.handler(
          {
            env: { binding: 'edge-compatible' },
            req: {
              method: 'GET',
              path: `${prefix}/value`,
              raw: new Request(`https://example.com${prefix}/value`),
            },
          },
          async () => {},
        )) as Response;
        return response.json();
      };

      await adapter.registerMiddleware({ prefix: ['/api', '/api/internal'] });
      expect(middlewares.map(middleware => middleware.path)).toEqual([
        '/api/internal/*',
        '/api/*',
      ]);
      expect(middlewares[0]?.before).toEqual([
        'custom-server-hook',
        'custom-server-middleware',
        'render',
      ]);
      await expect(invoke(middlewares[0]!, '/api/internal')).resolves.toEqual({
        value: 'shared-runtime',
        requestPath: '/value',
        middlewarePath: '/api/internal/value',
        method: 'GET',
        binding: 'edge-compatible',
      });
      await expect(invoke(middlewares[1]!, '/api')).resolves.toEqual({
        value: 'shared-runtime',
        requestPath: '/value',
        middlewarePath: '/api/value',
        method: 'GET',
        binding: 'edge-compatible',
      });
      expect(lifecycle).toEqual({ initialized: 1, disposed: 0 });

      await disposeServerRuntime(serverBase);
      await disposeServerRuntime(serverBase);
      await adapter.dispose();
      expect(lifecycle).toEqual({ initialized: 1, disposed: 1 });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      delete testGlobal[lifecycleMarker];
      await fs.promises.rm(appDirectory, { recursive: true, force: true });
    }
  });

  test('defaults an empty prefix list to /api and validates batch items against their mounted route', async () => {
    const appDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-effect-adapter-policy-'),
    );
    const originalNodeEnv = process.env.NODE_ENV;
    const entryFile = path.join(appDirectory, 'api', 'effect.mjs');
    const entrySource = `
import {
  defineEffectBff,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '@modern-js/bff-effect/effect';

const api = HttpApi.make('MountedPolicyApi').add(
  HttpApiGroup.make('mounted').add(
    HttpApiEndpoint.get('value', '/value', { success: Schema.String }),
  ),
);
const routes = HttpApiBuilder.group(api, 'mounted', handlers =>
  handlers.handle('value', () => Effect.succeed('mounted-policy')),
);
const runtime = defineEffectBff({
  api,
  layer: HttpApiBuilder.layer(api).pipe(Layer.provide(routes)),
});
export const { api: effectApi, layer: effectLayer } = runtime;
export { effectApi as api, effectLayer as layer };
`;

    try {
      await fs.promises.symlink(
        path.resolve(__dirname, '../node_modules'),
        path.join(appDirectory, 'node_modules'),
        'dir',
      );
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await fs.promises.writeFile(entryFile, entrySource);
      process.env.NODE_ENV = 'production';

      const createApi = (
        middlewares: Middleware[],
        crossProjectPolicy: Record<string, unknown> = { enabled: true },
      ) =>
        ({
          getServerContext: () => ({
            appDirectory,
            apiDirectory: path.dirname(entryFile),
            bffRuntimeFramework: 'effect',
            middlewares,
          }),
          getServerConfig: () => ({
            bff: {
              effect: { entry: entryFile },
              requestId: 'crm.producer',
              isCrossProjectServer: true,
              crossProjectPolicy,
            },
          }),
        }) as unknown as ServerPluginAPI;
      const createHeaders = (routePath: string) => {
        const operationId = 'crm.producer:value';
        return {
          'x-modernjs-bff-envelope': JSON.stringify({
            requestId: 'crm.producer',
          }),
          'x-operation-id': operationId,
          'x-modernjs-bff-operation-context': JSON.stringify({
            requestId: 'crm.producer',
            operationId,
            method: 'GET',
            routePath,
            schemaHash: createEffectEndpointContractHash(
              {
                apiId: 'MountedPolicyApi',
                groupName: 'mounted',
                endpointName: 'value',
                method: 'GET',
                routePath,
              },
              'crm.producer',
            ),
            operationVersion: 1,
          }),
        };
      };
      const invoke = (
        middleware: Middleware,
        request: Request,
        requestPath: string,
      ) =>
        middleware.handler(
          {
            env: {},
            req: {
              method: request.method,
              path: requestPath,
              raw: request,
            },
          },
          async () => {},
        ) as Promise<Response>;

      const defaultMiddlewares: Middleware[] = [];
      const defaultAdapter = new EffectAdapter(createApi(defaultMiddlewares));
      await defaultAdapter.registerMiddleware({ prefix: [] });
      expect(defaultMiddlewares.map(middleware => middleware.path)).toEqual([
        '/api/*',
      ]);
      const defaultResponse = await invoke(
        defaultMiddlewares[0]!,
        new Request('https://example.com/api/value', {
          headers: createHeaders('/api/value'),
        }),
        '/api/value',
      );
      expect(defaultResponse.status).toBe(200);
      await expect(defaultResponse.json()).resolves.toBe('mounted-policy');
      await defaultAdapter.dispose();

      const nestedMiddlewares: Middleware[] = [];
      const nestedAdapter = new EffectAdapter(createApi(nestedMiddlewares));
      await nestedAdapter.registerMiddleware({
        prefix: ['/api', '/api/internal'],
      });
      expect(nestedMiddlewares.map(middleware => middleware.path)).toEqual([
        '/api/internal/*',
        '/api/*',
      ]);

      const routePath = '/api/internal/value';
      const batchResponse = await invoke(
        nestedMiddlewares[0]!,
        new Request('https://example.com/api/internal/_data/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            protocolVersion: 2,
            batchId: 'mounted-policy-batch',
            sentAt: Date.now(),
            items: [
              {
                id: 'mounted-item',
                path: routePath,
                method: 'GET',
                headers: createHeaders(routePath),
              },
            ],
          }),
        }),
        '/api/internal/_data/batch',
      );
      expect(batchResponse.status).toBe(200);
      await expect(batchResponse.json()).resolves.toMatchObject({
        items: [{ id: 'mounted-item', status: 200 }],
      });
      await nestedAdapter.dispose();

      const wildcardMiddlewares: Middleware[] = [];
      const wildcardAdapter = new EffectAdapter(
        createApi(wildcardMiddlewares, {
          enabled: true,
          allowUnknownOperations: true,
        }),
      );
      await wildcardAdapter.registerMiddleware({
        prefix: '/api',
        enableHandleWeb: true,
      });
      let nextCalls = 0;
      const wildcardResult = await wildcardMiddlewares[0]!.handler(
        {
          env: {},
          req: {
            method: 'GET',
            path: '/page',
            raw: new Request('https://example.com/page'),
          },
        },
        async () => {
          nextCalls += 1;
        },
      );
      expect(wildcardResult).toBeUndefined();
      expect(nextCalls).toBe(1);
      await wildcardAdapter.dispose();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      await fs.promises.rm(appDirectory, { recursive: true, force: true });
    }
  });

  test('propagates terminal runtime disposal failures through the server lifecycle', async () => {
    const appDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-effect-adapter-dispose-'),
    );
    const originalNodeEnv = process.env.NODE_ENV;
    const entryFile = path.join(appDirectory, 'api', 'effect.mjs');
    const entrySource = `
import {
  defineEffectBff,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '@modern-js/bff-effect/effect';

const api = HttpApi.make('FailingDisposeApi').add(
  HttpApiGroup.make('lifecycle').add(
    HttpApiEndpoint.get('value', '/value', { success: Schema.String }),
  ),
);
const routes = HttpApiBuilder.group(api, 'lifecycle', handlers =>
  handlers.handle('value', () => Effect.succeed('active')),
);
const failingLifecycle = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.sync(() => undefined),
    () => Effect.fail(new Error('effect runtime dispose failed')),
  ),
);
const runtime = defineEffectBff({
  api,
  layer: Layer.merge(
    HttpApiBuilder.layer(api).pipe(Layer.provide(routes)),
    failingLifecycle,
  ),
});
export const { api: effectApi, layer: effectLayer } = runtime;
export { effectApi as api, effectLayer as layer };
`;
    const middlewares: Middleware[] = [];
    const serverBase = {};

    try {
      await fs.promises.symlink(
        path.resolve(__dirname, '../node_modules'),
        path.join(appDirectory, 'node_modules'),
        'dir',
      );
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await fs.promises.writeFile(entryFile, entrySource);
      process.env.NODE_ENV = 'production';
      const api = {
        getServerContext: () => ({
          appDirectory,
          apiDirectory: path.dirname(entryFile),
          bffRuntimeFramework: 'effect',
          middlewares,
          serverBase,
        }),
        getServerConfig: () => ({
          bff: { effect: { entry: entryFile } },
        }),
      } as unknown as ServerPluginAPI;
      const adapter = new EffectAdapter(api);
      await adapter.registerMiddleware({ prefix: '/api' });

      const response = (await middlewares[0]!.handler(
        {
          env: {},
          req: {
            method: 'GET',
            path: '/api/value',
            raw: new Request('https://example.com/api/value'),
          },
        },
        async () => {},
      )) as Response;
      expect(response.status).toBe(200);

      const disposal = disposeServerRuntime(serverBase);
      await expect(disposal).rejects.toBeInstanceOf(AggregateError);
      await expect(disposal).rejects.toMatchObject({
        errors: [expect.anything()],
      });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      await fs.promises.rm(appDirectory, { recursive: true, force: true });
    }
  });

  test('retires a concurrently loading runtime before publishing middleware', async () => {
    const appDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-effect-adapter-retire-'),
    );
    const gateMarker = Symbol.for(
      `modernjs.effect-adapter.retire.${path.basename(appDirectory)}`,
    );
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>(resolve => {
      releaseLoad = resolve;
    });
    let reportStarted!: () => void;
    const started = new Promise<void>(resolve => {
      reportStarted = resolve;
    });
    const testGlobal = globalThis as typeof globalThis & {
      [gateMarker]?: {
        loadGate: Promise<void>;
        reportStarted: () => void;
      };
    };
    testGlobal[gateMarker] = { loadGate, reportStarted };
    const originalNodeEnv = process.env.NODE_ENV;
    const entryFile = path.join(appDirectory, 'api', 'effect.mjs');
    const entrySource = `
import {
  defineEffectBff,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '@modern-js/bff-effect/effect';

const gate = globalThis[Symbol.for(${JSON.stringify(gateMarker.description)})];
gate.reportStarted();
await gate.loadGate;
const api = HttpApi.make('RetiredLoadApi').add(
  HttpApiGroup.make('retired').add(
    HttpApiEndpoint.get('value', '/value', { success: Schema.String }),
  ),
);
const routes = HttpApiBuilder.group(api, 'retired', handlers =>
  handlers.handle('value', () => Effect.succeed('must-not-publish')),
);
const runtime = defineEffectBff({
  api,
  layer: HttpApiBuilder.layer(api).pipe(Layer.provide(routes)),
});
export const { api: effectApi, layer: effectLayer } = runtime;
export { effectApi as api, effectLayer as layer };
`;
    const middlewares: Middleware[] = [];

    try {
      await fs.promises.symlink(
        path.resolve(__dirname, '../node_modules'),
        path.join(appDirectory, 'node_modules'),
        'dir',
      );
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await fs.promises.writeFile(entryFile, entrySource);
      process.env.NODE_ENV = 'production';
      const adapter = new EffectAdapter({
        getServerContext: () => ({
          appDirectory,
          apiDirectory: path.dirname(entryFile),
          bffRuntimeFramework: 'effect',
          middlewares,
        }),
        getServerConfig: () => ({
          bff: { effect: { entry: entryFile } },
        }),
      } as unknown as ServerPluginAPI);

      const registering = adapter.registerMiddleware({ prefix: '/api' });
      await started;
      await adapter.dispose();
      releaseLoad();

      await expect(registering).rejects.toThrow(
        'Cannot initialize a retired Effect adapter.',
      );
      expect(middlewares).toEqual([]);
    } finally {
      releaseLoad();
      process.env.NODE_ENV = originalNodeEnv;
      delete testGlobal[gateMarker];
      await fs.promises.rm(appDirectory, { recursive: true, force: true });
    }
  });

  test('falls through missing and 404 handlers only for web middleware', async () => {
    const middlewares: Middleware[] = [];
    let nextCalls = 0;
    const api = {
      getServerContext: () => ({
        bffRuntimeFramework: 'effect',
        middlewares,
      }),
      getServerConfig: () => ({}),
    } as unknown as ServerPluginAPI;
    const adapter = new EffectAdapter(api);
    await adapter.registerMiddleware({ prefix: '/api', enableHandleWeb: true });
    const result = await middlewares[0]!.handler(
      {
        env: {},
        req: {
          method: 'GET',
          path: '/page',
          raw: new Request('https://example.com/page'),
        },
      },
      async () => {
        nextCalls += 1;
      },
    );

    expect(result).toBeUndefined();
    expect(nextCalls).toBe(1);
  });
});
