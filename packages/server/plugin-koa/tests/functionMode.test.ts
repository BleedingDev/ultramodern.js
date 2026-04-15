import * as path from 'path';
import request from 'supertest';
import plugin from '../src/plugin';
import { APIPlugin } from './helpers';
import { ConfigContext, serverManager } from './runtimeHarness';
import './common';

const pwd = path.join(__dirname, './fixtures/function-mode');

describe('function-mode', () => {
  const id = '666';
  const name = 'foo';
  const foo = { id, name };
  let apiHandler: any;

  beforeAll(async () => {
    const runner = await serverManager
      .clone()
      .usePlugin(APIPlugin, plugin)
      .init();
    apiHandler = await runner.prepareApiServer({
      pwd,
      prefix: '/',
    });
  });

  test('should works with body', async () => {
    const res = await request(apiHandler).post('/nest/user').send(foo);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(foo);
  });

  test('should works with schema', async () => {
    const res = await request(apiHandler).patch('/nest/user').send({
      id: 777,
      name: 'xxx',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(777);

    const res2 = await request(apiHandler).patch('/nest/user').send({
      id: 'aaa',
      name: 'xxx',
    });
    expect(res2.status).toBe(400);

    const res3 = await request(apiHandler).patch('/nest/user').send({
      id: '777',
      name: 'xxx',
    });
    expect(res3.status).toBe(500);
  });

  test('should support upload file', async () => {
    const res = await request(apiHandler)
      .post('/upload')
      .field('my_field', 'value')
      .attach('file', path.join(__dirname, './fixtures/assets/index.html'));

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('success');
    expect(res.body.formData).not.toBeUndefined();
  });

  test('should enforce cross-project middleware policy with explicit deny semantics', async () => {
    ConfigContext.set({
      bff: {
        crossProjectPolicy: {
          enabled: true,
          allowedNamespaces: ['crm'],
          requireOperationSchemaHash: false,
          requireOperationVersion: false,
        },
      },
    } as any);

    try {
      const runner = await serverManager
        .clone()
        .usePlugin(APIPlugin, plugin)
        .init();
      const policyHandler = await runner.prepareApiServer({
        pwd,
        prefix: '/',
      });

      const denied = await request(policyHandler).get('/nest/user');
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('BFF_CROSS_PROJECT_POLICY_DENIED');
      expect(denied.body.reason).toBe('missing_envelope');

      const allowed = await request(policyHandler)
        .get('/nest/user')
        .set(
          'x-modernjs-bff-envelope',
          JSON.stringify({ requestId: 'crm.producer-a' }),
        )
        .set('x-operation-id', 'crm.producer-a:GET:/nest/user')
        .set(
          'x-modernjs-bff-operation-context',
          JSON.stringify({
            requestId: 'crm.producer-a',
            operationId: 'crm.producer-a:GET:/nest/user',
            method: 'GET',
            routePath: '/nest/user',
          }),
        );

      expect(allowed.status).toBe(200);
      expect(allowed.body.query).toBeDefined();
    } finally {
      ConfigContext.set({} as any);
    }
  });
});
