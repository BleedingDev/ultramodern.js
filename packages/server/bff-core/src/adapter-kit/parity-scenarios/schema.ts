import type { AdapterParityScenario } from './shared';

export const createSchemaParityScenarios = (): AdapterParityScenario[] => [
  {
    name: 'schema handler success',
    policy: false,
    request: {
      method: 'patch',
      path: '/schema',
      headers: { 'content-type': 'application/json' },
      body: { id: 777 },
    },
    expected: {
      kind: 'payload',
      status: 200,
      payload: { type: 'HandleSuccess', value: { id: 777 } },
    },
  },
  {
    name: 'schema handler input validation error',
    policy: false,
    request: {
      method: 'patch',
      path: '/schema',
      headers: { 'content-type': 'application/json' },
      body: { id: 'aaa' },
    },
    expected: {
      kind: 'payload',
      status: 200,
      payload: { type: 'InputValidationError', message: 'invalid input' },
    },
  },
  {
    name: 'schema handler output validation error',
    policy: false,
    request: {
      method: 'patch',
      path: '/schema',
      headers: { 'content-type': 'application/json' },
      body: { id: 'boom' },
    },
    expected: {
      kind: 'payload',
      status: 200,
      payload: {
        type: 'OutputValidationError',
        message: 'invalid output',
      },
    },
  },
];
