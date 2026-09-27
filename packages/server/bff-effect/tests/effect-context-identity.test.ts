import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  BFF_TRACEPARENT_HEADER,
} from '@modern-js/runtime-extensions/request-context';
import { rstest } from '@rstest/core';
import { build } from 'esbuild';
import {
  createEffectOperationContext,
  type EffectContext,
} from '../src/effect/operation-context';

type NodeContextHelpers = typeof import('../src/effect/index');
type EdgeContextHelpers = typeof import('../src/effect/edge');

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
  import('../src/effect/index');

const loadEdgeContext = (): Promise<EdgeContextHelpers> =>
  import('../src/effect/edge');

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
});

describe('Effect context storage identity', () => {
  beforeEach(() => {
    rstest.resetModules();
  });

  afterEach(() => {
    rstest.resetModules();
  });

  test('shares one module-scoped storage between the Node and edge entries', async () => {
    const node = await loadNodeContext();
    const edge = await loadEdgeContext();
    const context = createContext('/shared');

    expect(
      node.runWithEffectContext(context, () => edge.useEffectContext()),
    ).toBe(context);
    expect(
      edge.runWithEffectContext(context, () => node.useOperationContext()),
    ).toBe(context.operationContext);
    expect(
      Object.getOwnPropertySymbols(globalThis).map(String),
    ).not.toContainEqual(expect.stringContaining('effectContextStorage'));
  });

  test('a re-evaluated module owns a fresh storage', async () => {
    const before = await loadNodeContext();
    rstest.resetModules();
    const after = await loadNodeContext();

    expect(
      before.runWithEffectContext(createContext('/stale'), () => {
        try {
          return after.useEffectContext();
        } catch (error) {
          return error;
        }
      }),
    ).toBeInstanceOf(Error);
  });
});

// Module Federation selects each shared request separately, so a host may
// provide `/effect` while a remote provides `/effect-edge` or bundles the root.
// Every entry must reach the storage through `@modern-js/bff-effect/context`
// rather than evaluating its own copy.
test.each([
  ['the root entry', '../src/index.ts'],
  ['@modern-js/bff-effect/effect', '../src/effect/index.ts'],
  ['@modern-js/bff-effect/effect-edge', '../src/effect/edge.ts'],
])('%s reads the storage through @modern-js/bff-effect/context', async (_, entry) => {
  const tempDir = await mkdtemp(resolve(__dirname, '.effect-entry-'));
  const bundle = async (name: string, entryPoint: string) => {
    const outfile = join(tempDir, `${name}.mjs`);
    await build({
      entryPoints: [entryPoint],
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      outfile,
      // Resolve the self-reference like an installed package, not through the
      // package's own tsconfig `paths`.
      tsconfigRaw: {},
    });
    return import(pathToFileURL(outfile).href);
  };
  try {
    const providerEntry = join(tempDir, 'provider.ts');
    await writeFile(
      providerEntry,
      "export * from '@modern-js/bff-effect/context';",
    );
    const provider = await bundle('provider', providerEntry);
    const bundled = await bundle('entry', resolve(__dirname, entry));
    const context = createContext('/entry');

    expect(
      provider.runWithEffectContext(context, () => bundled.useEffectContext()),
    ).toBe(context);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
