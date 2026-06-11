import {
  assertParityResult,
  createAdapterParityScenarios,
  createParityApiHandlerInfos,
  createParityBffConfig,
} from '@modern-js/bff-core/adapter-parity';
import request from 'supertest';
import plugin from '../src/plugin';
import { createAPIPlugin } from './helpers';
import { serverManager } from './runtimeHarness';
import './common';

type ApiServerHandler = Parameters<typeof request>[0];

const scenarios = createAdapterParityScenarios();

describe('adapter parity', () => {
  let openHandler: ApiServerHandler;
  let policyHandler: ApiServerHandler;

  beforeAll(async () => {
    const openRunner = await serverManager
      .clone()
      .usePlugin(createAPIPlugin(createParityApiHandlerInfos()), plugin)
      .init();
    openHandler = await openRunner.prepareApiServer({
      pwd: __dirname,
      prefix: '/',
      config: {},
    });

    const policyRunner = await serverManager
      .clone()
      .usePlugin(createAPIPlugin(createParityApiHandlerInfos()), plugin)
      .init();
    policyHandler = await policyRunner.prepareApiServer({
      pwd: __dirname,
      prefix: '/',
      config: { bff: createParityBffConfig() },
    });
  });

  for (const scenario of scenarios) {
    test(scenario.name, async () => {
      const handler = scenario.policy ? policyHandler : openHandler;
      let req = request(handler)[scenario.request.method](
        scenario.request.path,
      );
      for (const [name, value] of Object.entries(
        scenario.request.headers ?? {},
      )) {
        req = req.set(name, value);
      }
      if (scenario.request.body !== undefined) {
        req = req.send(scenario.request.body as Record<string, unknown>);
      }
      const res = await req;
      assertParityResult(scenario, res, 'express');
    });
  }
});
