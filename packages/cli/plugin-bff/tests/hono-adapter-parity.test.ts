/**
 * Executes the bff-core adapter-parity scenario table against the Hono lane:
 * `createHonoRoutes` plus the cross-project policy middleware (the same
 * check `HonoAdapter` installs). This is the live consumer of
 * bff-core's internal adapter parity table and the end-to-end proof for
 * Hono-lane policy enforcement
 * (allowed + every denial reason).
 */

import { resolveCrossProjectPolicy } from '@modern-js/bff-core';
import {
  Hono,
  type ServerMiddleware,
  type ServerPluginAPI,
} from '@modern-js/server-core';
import {
  assertParityResult,
  createAdapterParityScenarios,
  createParityApiHandlerInfos,
  createParityBffConfig,
  type ParityHttpResponse,
} from '../../../server/bff-core/src/adapter-kit/parity';
import { createHonoCrossProjectPolicyMiddleware } from '../../plugin-bff-extensions/src/hono/cross-project-policy';
import { HonoAdapter } from '../src/runtime/hono/adapter';
import createHonoRoutes from '../src/utils/createHonoRoutes';

function createParityApp(policyEnabled: boolean) {
  const app = new Hono();
  const handlerInfos = createParityApiHandlerInfos();

  const bffConfig = createParityBffConfig();
  const policy = policyEnabled
    ? resolveCrossProjectPolicy({
        crossProjectPolicy: bffConfig.crossProjectPolicy,
        handlers: handlerInfos,
        requestId: bffConfig.requestId,
      })
    : undefined;

  for (const route of createHonoRoutes(handlerInfos)) {
    const handlers = Array.isArray(route.handler)
      ? route.handler
      : [route.handler];
    if (policy) {
      handlers.unshift(
        createHonoCrossProjectPolicyMiddleware(policy, route.path),
      );
    }
    (
      app as unknown as Record<
        string,
        (path: string, ...handlers: unknown[]) => unknown
      >
    )[route.method](route.path, ...handlers);
  }

  return app;
}

async function toParityHttpResponse(
  response: Response,
): Promise<ParityHttpResponse> {
  const type = response.headers.get('content-type') || '';
  const text = await response.text();
  let body: unknown;
  if (type.includes('json')) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  return {
    status: response.status,
    type,
    body,
    text,
  };
}

describe('hono adapter parity (bff-core scenario table)', () => {
  const scenarios = createAdapterParityScenarios();

  for (const scenario of scenarios) {
    test(scenario.name, async () => {
      const app = createParityApp(scenario.policy);
      const { method, path, headers, body } = scenario.request;

      const response = await app.request(path, {
        method: method.toUpperCase(),
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      assertParityResult(scenario, await toParityHttpResponse(response));
    });
  }

  test('accepts policy-enabled startup before handlers are discovered', async () => {
    const adapter = new HonoAdapter({
      getServerContext: () => ({
        apiHandlerInfos: undefined,
        bffRuntimeFramework: 'hono',
        middlewares: [],
      }),
      getServerConfig: () => ({
        bff: {
          crossProjectPolicy: { enabled: true },
          isCrossProjectServer: true,
        },
      }),
    } as unknown as ServerPluginAPI);

    await expect(adapter.setHandlers()).resolves.toBeUndefined();
    expect(adapter.apiMiddleware).toEqual([]);
  });

  test('returns safe failure when Retry-After value is invalid', async () => {
    const middlewares: ServerMiddleware[] = [];
    const maintenanceError = Object.assign(new Error('maintenance detail'), {
      status: 503,
      retryAfter: '120\r\nX-Injected: 1',
    });
    const api = {
      getServerContext() {
        return {
          bffRuntimeFramework: 'hono',
          middlewares,
          apiHandlerInfos: [
            {
              routePath: '/api/maintenance',
              httpMethod: 'GET',
              handler: async () => {
                throw maintenanceError;
              },
            },
          ],
        };
      },
      getServerConfig() {
        return {
          onError() {},
        };
      },
    } as unknown as ServerPluginAPI;

    const adapter = new HonoAdapter(api);
    await adapter.registerMiddleware({
      prefix: '/api',
      enableHandleWeb: false,
    });

    const middleware = middlewares[0];
    expect(middleware).toBeDefined();

    const response = (await middleware!.handler(
      {
        req: {
          raw: new Request('http://localhost/api/maintenance'),
          path: '/api/maintenance',
          routePath: '/api/maintenance',
          method: 'GET',
          param: () => ({}),
          query: () => ({}),
          header: () => undefined,
        },
        env: {},
      } as unknown,
      async () => {},
    )) as Response | undefined;

    expect(response?.status).toBe(503);
    expect(response?.headers.get('Retry-After')).toBeNull();
    await expect(response?.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service Unavailable',
        status: 503,
      },
    });
  });
});
