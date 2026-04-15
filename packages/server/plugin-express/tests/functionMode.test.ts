import * as path from 'path';
import request from 'supertest';
import plugin from '../src/plugin';
import { APIPlugin } from './helpers';
import { ConfigContext, serverManager } from './runtimeHarness';
import './common';

const pwd = path.join(__dirname, './fixtures/function-mode');

describe('function-mode', () => {
  const id = '666';
  const name = 'modern';
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

  test('should works', async () => {
    const res = await request(apiHandler).get('/hello');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'hello' });
  });

  test('should works with string result', async () => {
    const res = await request(apiHandler).post('/hello');
    expect(res.status).toBe(200);
    expect(res.body).toEqual('hello');
  });

  test('should works with query', async () => {
    const res = await request(apiHandler).get(`/nest/user?id=${id}`);
    expect(res.status).toBe(200);
    expect(res.body.query.id).toBe(id);
  });

  test('should works with body', async () => {
    const res = await request(apiHandler).post('/nest/user').send(foo);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(foo);
  });

  test('should works with context', async () => {
    const res = await request(apiHandler).post(`/nest/user?id=${id}`).send(foo);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(foo);
    expect(res.body.query.id).toBe(id);
  });

  test('should support cookies', async () => {
    const res = await request(apiHandler)
      .post(`/nest/user?id=${id}`)
      .set('Cookie', [`id=${id};name=${name}`]);
    expect(res.status).toBe(200);
    expect(res.body.cookies.id).toBe(id);
    expect(res.body.cookies.name).toBe(name);
  });

  test('should works with schema', async () => {
    const res = await request(apiHandler).patch('/nest/user').send({
      id: 777,
      name: 'xxx',
    });
    expect(res.status).toBe(200);

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
      .attach('file', __filename);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('success');
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

      const denied = await request(policyHandler).get('/hello');
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('BFF_CROSS_PROJECT_POLICY_DENIED');
      expect(denied.body.reason).toBe('missing_envelope');

      const allowed = await request(policyHandler)
        .get('/hello')
        .set(
          'x-modernjs-bff-envelope',
          JSON.stringify({ requestId: 'crm.producer-a' }),
        )
        .set('x-operation-id', 'crm.producer-a:GET:/hello')
        .set(
          'x-modernjs-bff-operation-context',
          JSON.stringify({
            requestId: 'crm.producer-a',
            operationId: 'crm.producer-a:GET:/hello',
            method: 'GET',
            routePath: '/hello',
          }),
        );

      expect(allowed.status).toBe(200);
      expect(allowed.body).toEqual({ message: 'hello' });
    } finally {
      ConfigContext.set({} as any);
    }
  });
});
