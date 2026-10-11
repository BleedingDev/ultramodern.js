import {
  applyRouterServerPrepareResult,
  getRouterRuntimeState,
  getRouterServerSnapshot,
} from '../src/routerState';
import {
  createRouterStatePlugin,
  ROUTER_CLEANUP_ERROR,
} from '../src/routerStatePlugin';

function install() {
  const registryHooks = { onAfterCreateRouter: { call() {} } };
  const plugin = createRouterStatePlugin({ registryHooks });
  let beforeRender!: (context: object) => void;
  let afterCreate!: Parameters<
    Parameters<typeof plugin.setup>[0]['onAfterCreateRouter']
  >[0];
  let prepared!: Parameters<
    Parameters<typeof plugin.setup>[0]['onRenderPrepared']
  >[0];
  let end!: Parameters<Parameters<typeof plugin.setup>[0]['onRequestEnd']>[0];
  plugin.setup({
    onBeforeRender: callback => {
      beforeRender = callback;
    },
    onAfterCreateRouter: callback => {
      afterCreate = callback;
    },
    onRenderPrepared: callback => {
      prepared = callback;
    },
    onRequestEnd: callback => {
      end = callback;
    },
  });
  return { plugin, registryHooks, beforeRender, afterCreate, prepared, end };
}

test('keeps injected hooks and per-context policies stable without sharing app values', () => {
  const { beforeRender } = install();
  const first: any = {};
  const second: any = {};
  beforeRender(first);
  const policy = first.linkPrefetchPolicy;
  beforeRender(first);
  beforeRender(second);
  expect(first.linkPrefetchPolicy).toBe(policy);
  expect(second.linkPrefetchPolicy).not.toBe(policy);
});

test('installs shared request policy once per native runtime API', () => {
  const registryHooks = { onAfterCreateRouter: { call() {} } };
  const first = createRouterStatePlugin({ registryHooks });
  const second = createRouterStatePlugin({ registryHooks });
  const createApi = () => ({
    onBeforeRender: rs.fn(),
    onRenderPrepared: rs.fn(),
    onRequestEnd: rs.fn(),
    onAfterCreateRouter: rs.fn(),
  });
  const api = createApi();
  first.setup(api);
  second.setup(api);
  first.setup(api);
  for (const tap of Object.values(api)) {
    expect(tap).toHaveBeenCalledTimes(1);
  }

  const anotherRuntime = createApi();
  second.setup(anotherRuntime);
  for (const tap of Object.values(anotherRuntime)) {
    expect(tap).toHaveBeenCalledTimes(1);
  }
});

test('projects loader data, errors and valid route ids from injected SSR input', () => {
  const { afterCreate } = install();
  const errors = { route: new Error('route error') };
  const context = {
    routerContext: {
      statusCode: 503,
      errors,
      loaderData: { root: { ok: true } },
      matches: [{ route: { id: 'root' } }, { route: {} }],
    },
  };
  afterCreate({
    framework: 'react-router',
    phase: 'ssr-prepare',
    runtimeContext: context,
    router: context.routerContext,
    basename: '/nested',
  });
  expect(getRouterRuntimeState(context)?.instance).toBe(context.routerContext);
  expect(getRouterServerSnapshot(context)).toMatchObject({
    framework: 'react-router',
    basename: '/nested',
    statusCode: 503,
    matchedRouteIds: ['root'],
    routerData: { loaderData: context.routerContext.loaderData, errors },
  });
});

test('supplies snapshot status and errors after preparation without native router context', () => {
  const { prepared } = install();
  const context = {};
  const error = new Error('snapshot loader error');
  applyRouterServerPrepareResult(context, {
    state: { framework: 'custom-router' },
    snapshot: { statusCode: 418, errors: { root: error } },
  });
  expect(prepared({ runtimeContext: context })).toEqual({
    runtimeContext: context,
    routerResult: { statusCode: 418, errors: { root: error } },
  });
});

test('preserves native metadata when no snapshot exists or its fields are absent', () => {
  const { prepared } = install();
  const context = {};
  const native = {
    runtimeContext: context,
    routerResult: {
      statusCode: 503,
      errors: { native: new Error('native loader error') },
    },
  };
  expect(prepared(native)).toBe(native);
  applyRouterServerPrepareResult(context, {
    state: { framework: 'custom-router' },
    snapshot: { framework: 'custom-router' },
  });
  expect(prepared(native).routerResult).toEqual(native.routerResult);
});

test('a captured empty error result takes precedence over stale native errors', () => {
  const { prepared } = install();
  const context = {};
  applyRouterServerPrepareResult(context, {
    state: { framework: 'custom-router' },
    snapshot: { statusCode: 200, errors: {} },
  });
  expect(
    prepared({
      runtimeContext: context,
      routerResult: { statusCode: 500, errors: { stale: new Error('stale') } },
    }).routerResult,
  ).toEqual({ statusCode: 200, errors: {} });
});

test('request completion disposes the prepared router and waits for disposal', async () => {
  const { end } = install();
  const context = {};
  const events: string[] = [];
  let finish = () => {};
  const disposal = new Promise<void>(resolve => {
    finish = resolve;
  });
  applyRouterServerPrepareResult(context, {
    state: { framework: 'custom-router' },
    cleanup: async () => {
      events.push('dispose:start');
      await disposal;
      events.push('dispose:end');
    },
  });
  const completion = end({ runtimeContext: context });
  expect(events).toEqual(['dispose:start']);
  finish();
  await completion;
  expect(events).toEqual(['dispose:start', 'dispose:end']);
});

test('reports router disposal failures through the request reporter', async () => {
  const { end } = install();
  const onError = rs.fn();
  const context = { ssrContext: { onError } };
  const failure = new Error('router disposal failed');
  applyRouterServerPrepareResult(context, {
    state: { framework: 'custom-router' },
    cleanup: () => {
      throw failure;
    },
  });
  await end({ runtimeContext: context });
  expect(onError).toHaveBeenCalledExactlyOnceWith(
    failure,
    ROUTER_CLEANUP_ERROR,
  );
});
