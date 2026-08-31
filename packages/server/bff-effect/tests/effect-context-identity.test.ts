import {
  BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  BFF_TRACEPARENT_HEADER,
} from '@modern-js/create-request';
import { rstest } from '@rstest/core';
import {
  createEffectOperationContext,
  type EffectContext,
} from '../src/effect/operation-context';

const kEffectContextStorage = Symbol.for(
  'modernjs.plugin-bff.effectContextStorage',
);
const globalStore = globalThis as typeof globalThis & {
  [kEffectContextStorage]?: unknown;
};

type NodeContextHelpers = typeof import('../src/effect/context');
type EdgeContextHelpers = typeof import('../src/effect/edge-context');

const createContext = (path: string): EffectContext => {
  const request = new Request(`http://localhost${path}`);
  const base = {
    request,
    env: { RUNTIME: 'test' },
    path,
    method: 'GET',
  };

  return {
    ...base,
    operationContext: createEffectOperationContext(base),
  };
};

const loadNodeContext = (): Promise<NodeContextHelpers> =>
  import('../src/effect/context');

const loadEdgeContext = (): Promise<EdgeContextHelpers> =>
  import('../src/effect/edge-context');

const headerTraceparent =
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const detailTraceparent =
  '00-11111111111111111111111111111111-2222222222222222-00';

const createOperationContext = (headers: HeadersInit) => {
  const request = new Request('http://localhost/context', { headers });
  return createEffectOperationContext({
    request,
    env: {},
    path: '/context',
    method: 'GET',
  });
};

describe('Effect operation trace identity', () => {
  test('derives trace identity from a valid request traceparent', () => {
    const operationContext = createOperationContext({
      [BFF_TRACEPARENT_HEADER]: headerTraceparent,
      [BFF_OPERATION_CONTEXT_DETAIL_HEADER]: JSON.stringify({
        traceparent: detailTraceparent,
        traceId: '33333333333333333333333333333333',
        spanId: '4444444444444444',
      }),
    });

    expect(operationContext.traceparent).toBe(headerTraceparent);
    expect(operationContext.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(operationContext.spanId).toBe('00f067aa0ba902b7');
  });

  test('falls back to a valid detail traceparent when the header is invalid', () => {
    const operationContext = createOperationContext({
      [BFF_TRACEPARENT_HEADER]: 'invalid',
      [BFF_OPERATION_CONTEXT_DETAIL_HEADER]: JSON.stringify({
        traceparent: detailTraceparent,
        traceId: '33333333333333333333333333333333',
        spanId: '4444444444444444',
      }),
    });

    expect(operationContext.traceparent).toBe(detailTraceparent);
    expect(operationContext.traceId).toBe('11111111111111111111111111111111');
    expect(operationContext.spanId).toBe('2222222222222222');
  });

  test('uses detail ids only when no valid traceparent exists', () => {
    const operationContext = createOperationContext({
      [BFF_TRACEPARENT_HEADER]: 'invalid',
      [BFF_OPERATION_CONTEXT_DETAIL_HEADER]: JSON.stringify({
        traceparent: 'also-invalid',
        traceId: '33333333333333333333333333333333',
        spanId: '4444444444444444',
      }),
    });

    expect(operationContext.traceparent).toBeUndefined();
    expect(operationContext.traceId).toBe('33333333333333333333333333333333');
    expect(operationContext.spanId).toBe('4444444444444444');
  });
});

describe('Effect context storage identity', () => {
  beforeEach(() => {
    delete globalStore[kEffectContextStorage];
    rstest.resetModules();
  });

  afterEach(() => {
    delete globalStore[kEffectContextStorage];
    rstest.resetModules();
  });

  test('keeps Node helpers on one scoped context', async () => {
    const node = await loadNodeContext();
    const context = createContext('/node');

    expect(
      node.runWithEffectContext(context, () => ({
        context: node.useEffectContext(),
        operation: node.useOperationContext(),
      })),
    ).toEqual({
      context,
      operation: context.operationContext,
    });
  });

  test('keeps guarded edge helpers on one scoped context', async () => {
    const edge = await loadEdgeContext();
    const context = createContext('/edge');

    expect(
      edge.runWithEffectContext(context, () => ({
        context: edge.useEffectContext(),
        operation: edge.useOperationContext(),
      })),
    ).toEqual({
      context,
      operation: context.operationContext,
    });
  });

  test('shares context in both directions between Node and edge helpers', async () => {
    const node = await loadNodeContext();
    const edge = await loadEdgeContext();
    const nodeContext = createContext('/mixed/node');
    const edgeContext = createContext('/mixed/edge');

    expect(
      node.runWithEffectContext(nodeContext, () => edge.useEffectContext()),
    ).toBe(nodeContext);
    expect(
      edge.runWithEffectContext(edgeContext, () => node.useEffectContext()),
    ).toBe(edgeContext);
  });

  test('shares context across independently evaluated module copies', async () => {
    const firstNode = await loadNodeContext();
    rstest.resetModules();
    const duplicateEdge = await loadEdgeContext();
    rstest.resetModules();
    const duplicateNode = await loadNodeContext();
    const context = createContext('/duplicate');

    expect(duplicateNode).not.toBe(firstNode);
    expect(
      firstNode.runWithEffectContext(context, () => ({
        edge: duplicateEdge.useEffectContext(),
        node: duplicateNode.useEffectContext(),
      })),
    ).toEqual({ edge: context, node: context });
  });
});
