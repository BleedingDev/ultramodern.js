import type { AdapterParityScenario } from './shared';

export const createEnvelopeParityScenarios = (): AdapterParityScenario[] => [
  {
    name: 'plain handler returns object payload',
    policy: false,
    request: { method: 'get', path: '/hello' },
    expected: { kind: 'payload', status: 200, payload: { message: 'hello' } },
  },
  {
    name: 'plain handler returns scalar payload',
    policy: false,
    request: { method: 'post', path: '/hello' },
    expected: { kind: 'payload', status: 200, payload: 'hello' },
  },
  {
    name: 'plain handler returning undefined',
    policy: false,
    request: { method: 'get', path: '/nothing' },
    expected: {
      kind: 'payload',
      status: 404,
      payload: '404 Not Found',
    },
  },
  {
    name: 'plain handler receives data, query and cookies',
    policy: false,
    request: {
      method: 'post',
      path: '/echo?q=z',
      headers: {
        'content-type': 'application/json',
        cookie: 'id=666',
      },
      body: { a: 1 },
    },
    expected: {
      kind: 'payload',
      status: 200,
      payload: { data: { a: 1 }, query: { q: 'z' }, cookie: 'id=666' },
    },
  },
  {
    name: 'plain handler receives positional route params',
    policy: false,
    request: { method: 'get', path: '/items/123?q=x' },
    expected: {
      kind: 'payload',
      status: 200,
      payload: { id: '123', query: { q: 'x' } },
    },
  },
];
