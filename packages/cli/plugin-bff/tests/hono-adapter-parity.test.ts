/**
 * Executes the bff-core adapter-parity scenario table against the hono lane:
 * `createHonoRoutes` plus the cross-project policy middleware (the same
 * check `HonoAdapter` installs). This is the live consumer of
 * bff-core's internal adapter parity table since the express/koa adapters
 * were removed, and the end-to-end proof for hono-lane policy enforcement
 * (allowed + every denial reason).
 */

import { resolveCrossProjectPolicy } from '@modern-js/bff-core';
import { Hono, type MiddlewareHandler } from '@modern-js/server-core';
import {
  assertParityResult,
  createAdapterParityScenarios,
  createParityApiHandlerInfos,
  createParityBffConfig,
  type ParityHttpResponse,
} from '../../../server/bff-core/src/adapter-kit/parity';
import createHonoRoutes from '../src/utils/createHonoRoutes';
import { checkCrossProjectPolicyResponse } from '../src/utils/crossProjectServerPolicy';

function createParityApp(policyEnabled: boolean) {
  const app = new Hono();
  const handlerInfos = createParityApiHandlerInfos();

  if (policyEnabled) {
    const bffConfig = createParityBffConfig();
    const policy = resolveCrossProjectPolicy({
      crossProjectPolicy: bffConfig.crossProjectPolicy,
      handlers: handlerInfos,
      requestId: bffConfig.requestId,
    });
    const policyMiddleware: MiddlewareHandler = async (c, next) => {
      const denial = checkCrossProjectPolicyResponse(c.req.header(), policy);
      if (denial) {
        return denial;
      }
      await next();
    };
    app.all('*', policyMiddleware);
  }

  for (const route of createHonoRoutes(handlerInfos)) {
    const handlers = Array.isArray(route.handler)
      ? route.handler
      : [route.handler];
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

      assertParityResult(
        scenario,
        await toParityHttpResponse(response),
        'hono',
      );
    });
  }
});
