import type {
  DataOutcome,
  DataStreamFrame,
} from '@modern-js/renderer-core/data';
import {
  createDataResponse,
  DATA_STREAM_CONTENT_TYPE,
  readDataResponse,
  serializePublicData,
} from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { isServer } from '@solidjs/web';
import { createRoot, createSignal, flush } from 'solid-js';
import type { RouteAction } from '../../src/actions';
import {
  ActionForm,
  createRouteAction,
  RouteActionError,
  useRouteAction,
} from '../../src/actions';
import { mountApplication } from '../../src/client';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '../../src/router-binding/index';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'actions-app',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'actions-build',
};
const metadata = {
  status: 200,
  statusText: 'OK',
  headers: [] as [string, string][],
  cachePolicy: 'no-store',
} as const;
const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function response(outcome: DataOutcome, actualIdentity = identity) {
  return createDataResponse(outcome, actualIdentity, {
    routeId: 'item',
    operation: 'action',
  });
}

function success(value: unknown, status = 200) {
  return response({
    kind: 'success',
    value,
    response: { ...metadata, status },
  });
}

function request() {
  return new Request('http://localhost/items/42', {
    method: 'POST',
    body: new URLSearchParams({ name: 'tractor' }),
  });
}

function fixture(
  component?: () => ReturnType<typeof Outlet>,
  basepath?: string,
) {
  let loads = 0;
  const root = createRootRoute({ component: Outlet });
  const item = createRoute({
    getParentRoute: () => root,
    path: 'items/$itemId',
    staticData: { ultramodernRouteId: 'item' },
    staleTime: Number.POSITIVE_INFINITY,
    loader: async ({ params }) => {
      loads++;
      return { itemId: params.itemId, loads };
    },
    component,
  });
  const done = createRoute({
    getParentRoute: () => root,
    path: 'done',
    component: () => 'complete',
  });
  const router = createRouter({
    routeTree: root.addChildren([item, done]),
    history: createMemoryHistory({
      initialEntries: [`${basepath ?? ''}/items/42`],
    }),
    ...(basepath ? { basepath } : {}),
    origin: 'http://localhost',
    context: { ultramodern: { rendererIdentity: identity } },
    isServer: false,
  });
  return { router, loads: () => loads };
}

function actionFixture(fetch: typeof globalThis.fetch) {
  const native = fixture();
  const action = createRouteAction({
    router: native.router,
    routeId: 'item',
    rendererIdentity: identity,
    url: 'http://localhost/items/42',
    fetch,
  });
  disposers.push(action.dispose);
  return { ...native, action };
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    flush();
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('The native action did not settle');
}

describe('native Solid route actions', () => {
  test('native data responses retain their content type in the DOM realm', () => {
    expect(isServer).toBe(false);
    const [value, setValue] = createSignal(false);
    setValue(true);
    flush();
    expect(value()).toBe(true);
    expect(Request).toBe(window.Request);
    expect(Response).toBe(window.Response);
    expect(Headers).toBe(window.Headers);
    expect(FormData).toBe(window.FormData);
    expect(success('platform').headers.get('content-type')).toContain(
      'application/vnd.ultramodern.data+json',
    );
  });

  test('successful mutation reloads the native matched loader before settling', async () => {
    const { router, action, loads } = actionFixture(async (input, init) => {
      const outgoing = input as Request;
      expect(new URL(outgoing.url).searchParams.get('__loader')).toBe('item');
      expect(init?.credentials).toBe('same-origin');
      expect(init?.redirect).toBe('manual');
      expect((await outgoing.formData()).get('name')).toBe('tractor');
      return success({ saved: true });
    });
    await router.load();
    expect(loads()).toBe(1);
    const submission = action.submit(request());
    flush();
    expect(action.pending()).toBe(true);
    expect(await submission).toEqual({
      kind: 'success',
      value: { saved: true },
      status: 200,
    });
    flush();
    expect(loads()).toBe(2);
    expect(router.state.matches.at(-1)?.loaderData).toEqual({
      itemId: '42',
      loads: 2,
    });
    expect(action.pending()).toBe(false);
    expect(action.error()).toBeUndefined();
  });

  test('422 public validation data stays available without a route reload', async () => {
    const { router, action, loads } = actionFixture(async () =>
      success({ errors: { name: 'Name is required' } }, 422),
    );
    await router.load();
    await action.submit(request());
    flush();
    expect(action.outcome()).toEqual({
      kind: 'success',
      value: { errors: { name: 'Name is required' } },
      status: 422,
    });
    expect(action.error()).toBeUndefined();
    expect(router.state.location.pathname).toBe('/items/42');
    expect(loads()).toBe(1);
  });

  test('public action snapshots block mutation through return values, accessors and nested aliases', async () => {
    const shared = { name: 'tractor' };
    const { router, action, loads } = actionFixture(async () =>
      success({ first: shared, again: shared, list: [shared] }, 422),
    );
    await router.load();
    const returned = await action.submit(request());
    flush();
    expect(Reflect.set(action, 'outcome', () => undefined)).toBe(false);
    expect(Reflect.set(action, 'cancel', () => undefined)).toBe(false);
    expect(returned).toBe(action.outcome());
    if (returned?.kind !== 'success')
      throw new Error('Missing public action data');
    const data = returned.value as {
      first: { name: string };
      again: { name: string };
      list: { name: string }[];
    };
    expect(data.first).toBe(data.again);
    expect(data.first).toBe(data.list[0]);
    expect(Reflect.set(returned, 'status', 200)).toBe(false);
    expect(Reflect.set(data.first, 'name', 'mutated')).toBe(false);
    expect(Reflect.deleteProperty(data, 'first')).toBe(false);
    expect(() =>
      Array.prototype.push.call(data.list, { name: 'injected' }),
    ).toThrow(TypeError);
    let getters = 0;
    expect(
      Reflect.defineProperty(data, 'private', {
        get() {
          getters++;
          return 'PRIVATE_ACTION';
        },
      }),
    ).toBe(false);
    expect(getters).toBe(0);
    expect(data.first.name).toBe('tractor');
    expect(loads()).toBe(1);
  });

  test('public action errors share the checked immutable outcome and data', async () => {
    for (const outcome of [
      {
        kind: 'error',
        error: {
          name: 'ValidationError',
          message: 'Invalid name',
          stack: 'checked-public-action-stack',
        },
        data: { errors: [{ name: 'required' }] },
        thrown: true,
        response: { ...metadata, status: 422 },
      },
      {
        kind: 'not-found',
        value: { errors: [{ name: 'missing' }] },
        thrown: true,
        response: { ...metadata, status: 404 },
      },
    ] satisfies DataOutcome[]) {
      const { router, action } = actionFixture(async () => response(outcome));
      await router.load();
      const returned = await action.submit(request());
      flush();
      const failure = action.error();
      if (!(failure instanceof RouteActionError))
        throw new Error('Missing checked action error');
      const data = failure.data as { errors: { name: string }[] };
      expect(failure.outcome).toBe(returned);
      expect(returned).toBe(action.outcome());
      expect(failure.stack).toBe(
        returned?.kind === 'error' ? returned.error.stack : undefined,
      );
      expect(data).toBe(
        returned?.kind === 'error'
          ? returned.data
          : returned?.kind === 'not-found'
            ? returned.value
            : undefined,
      );
      expect(Reflect.set(failure, 'status', 200)).toBe(false);
      expect(Reflect.set(failure, 'data', { private: true })).toBe(false);
      expect(Reflect.set(data.errors[0]!, 'name', 'mutated')).toBe(false);
      expect(() =>
        Array.prototype.push.call(data.errors, { name: 'injected' }),
      ).toThrow(TypeError);
    }
  });

  test.each([
    ['Date', new Date('2026-10-02T00:00:00Z')],
    ['RegExp', /tractor/gu],
    ['Map', new Map([['name', 'tractor']])],
    ['Set', new Set(['tractor'])],
  ])(
    'the native UI boundary rejects mutable %s without changing the HTTP codec',
    async (_name, value) => {
      const decoded = await readDataResponse(success(value), {
        identity,
        routeId: 'item',
        operation: 'action',
      });
      if (decoded.kind !== 'success')
        throw new Error('Missing HTTP data outcome');
      expect(Object.getPrototypeOf(decoded.value)).toBe(
        Object.getPrototypeOf(value),
      );
      const { router, action, loads } = actionFixture(async () =>
        success(value),
      );
      await router.load();
      expect(await action.submit(request())).toBeUndefined();
      flush();
      expect(action.outcome()).toBeUndefined();
      expect(action.error()).toBeInstanceOf(Error);
      expect(action.error()?.name).toBe('DataProtocolError');
      expect(action.pending()).toBe(false);
      expect(loads()).toBe(1);
    },
  );

  test('public errors and not-found outcomes retain honest action failure state', async () => {
    for (const outcome of [
      {
        kind: 'error',
        error: { name: 'ValidationError', message: 'Invalid name' },
        data: { name: 'required' },
        thrown: true,
        response: { ...metadata, status: 422 },
      },
      {
        kind: 'not-found',
        value: { itemId: '42' },
        thrown: true,
        response: { ...metadata, status: 404 },
      },
    ] satisfies DataOutcome[]) {
      const { router, action, loads } = actionFixture(async () =>
        response(outcome),
      );
      await router.load();
      await action.submit(request());
      flush();
      expect(action.error()).toBeInstanceOf(RouteActionError);
      expect((action.error() as RouteActionError).status).toBe(
        outcome.response.status,
      );
      expect((action.error() as RouteActionError).outcome).toBe(
        action.outcome(),
      );
      expect(loads()).toBe(1);
    }
  });

  test('protocol identity failure cannot invalidate native routes', async () => {
    const { router, action, loads } = actionFixture(async () =>
      response(
        { kind: 'success', value: 'stale', response: metadata },
        { ...identity, buildId: 'stale-build' },
      ),
    );
    await router.load();
    expect(await action.submit(request())).toBeUndefined();
    flush();
    expect(action.error()).toBeInstanceOf(Error);
    expect(action.outcome()).toBeUndefined();
    expect(loads()).toBe(1);
  });

  test('falsy transport rejection remains an explicit action failure', async () => {
    const { router, action, loads } = actionFixture(async () => {
      throw undefined;
    });
    await router.load();
    expect(await action.submit(request())).toBeUndefined();
    flush();
    expect(action.error()).toBeInstanceOf(Error);
    expect(action.error()?.message).toBe('The Solid route action failed');
    expect(action.error()?.cause).toBeUndefined();
    expect(action.outcome()).toBeUndefined();
    expect(loads()).toBe(1);
  });

  test('transport errors expose fresh immutable diagnostics and never evaluate accessors', async () => {
    for (const accessor of [false, true]) {
      let getters = 0;
      const original = new Error('PRIVATE_TRANSPORT_MESSAGE', {
        cause: { nested: { name: 'original' } },
      });
      if (accessor)
        Object.defineProperty(original, 'message', {
          get() {
            getters++;
            return 'PRIVATE_TRANSPORT_GETTER';
          },
        });
      const { action } = actionFixture(async () => {
        throw original;
      });
      expect(await action.submit(request())).toBeUndefined();
      flush();
      const failure = action.error();
      if (!failure) throw new Error('Missing public transport diagnostic');
      expect(failure).not.toBe(original);
      expect(failure.message).not.toContain('PRIVATE_TRANSPORT');
      expect(Reflect.set(failure, 'message', 'mutated')).toBe(false);
      expect(Reflect.set(failure, 'cause', original.cause)).toBe(false);
      expect(getters).toBe(0);
      expect(Object.isFrozen(original)).toBe(false);
      if (failure.cause && typeof failure.cause === 'object') {
        expect(failure.cause).not.toBe(original.cause);
        expect(Object.isFrozen(failure.cause)).toBe(true);
      }
    }
  });

  test('retained public snapshots remain unchanged across another submission and disposal', async () => {
    let calls = 0;
    const { action } = actionFixture(async () =>
      success({ nested: { name: `generation-${++calls}` } }, 422),
    );
    const first = await action.submit(request());
    const second = await action.submit(request());
    action.dispose();
    flush();
    if (first?.kind !== 'success' || second?.kind !== 'success')
      throw new Error('Missing retained action snapshots');
    const firstData = first.value as { nested: { name: string } };
    const secondData = second.value as { nested: { name: string } };
    expect(first).not.toBe(second);
    expect(firstData.nested.name).toBe('generation-1');
    expect(secondData.nested.name).toBe('generation-2');
    expect(Reflect.set(firstData.nested, 'name', 'mutated')).toBe(false);
    expect(Reflect.set(secondData.nested, 'name', 'mutated')).toBe(false);
    expect(action.outcome()).toBe(second);
  });

  test('a superseded request aborts and cannot publish or reload after the winner', async () => {
    let firstSignal: AbortSignal | undefined;
    let resolveFirst!: (value: Response) => void;
    let calls = 0;
    const { router, action, loads } = actionFixture(async (input, init) => {
      calls++;
      if (calls === 1) {
        firstSignal = init?.signal ?? (input as Request).signal;
        return new Promise<Response>(resolve => {
          resolveFirst = resolve;
        });
      }
      return success('winner');
    });
    await router.load();
    const first = action.submit(request());
    // The action body is buffered before the transport starts.
    await waitFor(() => firstSignal !== undefined);
    const second = action.submit(request());
    expect(firstSignal?.aborted).toBe(true);
    await second;
    resolveFirst(success('stale'));
    expect(await first).toBeUndefined();
    flush();
    expect(action.outcome()).toEqual({
      kind: 'success',
      value: 'winner',
      status: 200,
    });
    expect(loads()).toBe(2);
    expect(action.pending()).toBe(false);
    expect(action.error()).toBeUndefined();
  });

  test('native owner disposal aborts the active request exactly once', async () => {
    let signal: AbortSignal | undefined;
    let aborts = 0;
    let action!: RouteAction;
    const { router } = fixture();
    const disposeOwner = createRoot(dispose => {
      action = createRouteAction({
        router,
        routeId: 'item',
        rendererIdentity: identity,
        fetch: async (_input, init) =>
          new Promise((_resolve, reject) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener(
              'abort',
              () => {
                aborts++;
                reject(signal?.reason);
              },
              { once: true },
            );
          }),
      });
      return dispose;
    });
    const submission = action.submit(request());
    await waitFor(() => signal !== undefined);
    disposeOwner();
    disposeOwner();
    expect(await submission).toBeUndefined();
    flush();
    expect(signal?.aborted).toBe(true);
    expect(aborts).toBe(1);
    expect(action.pending()).toBe(false);
    expect(action.error()).toBeUndefined();
    expect(() => action.submit(request())).toThrow('disposed');
  });

  test('external request abort settles without waiting for an ignoring transport', async () => {
    const { action } = actionFixture(async () => new Promise(() => {}));
    const controller = new AbortController();
    const submission = action.submit(
      new Request(request(), { signal: controller.signal }),
    );
    flush();
    expect(action.pending()).toBe(true);
    controller.abort();
    flush();
    expect(action.pending()).toBe(false);
    expect(await submission).toBeUndefined();
    flush();
    expect(action.error()).toBeUndefined();
  });

  test('a resolved deferred value cannot hide truncated terminal framing', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const { router, action, loads } = actionFixture(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
          }),
          { headers: { 'content-type': DATA_STREAM_CONTENT_TYPE } },
        ),
    );
    await router.load();
    const encode = (frame: DataStreamFrame) =>
      new TextEncoder().encode(`${serializePublicData(frame)}\n`);
    const submission = action.submit(request());
    await waitFor(() => stream !== undefined);
    stream.enqueue(
      encode({
        type: 'initial',
        envelope: {
          version: 1,
          identity,
          routeId: 'item',
          operation: 'action',
          outcome: { kind: 'success', value: { critical: true }, status: 200 },
          deferredKeys: ['later'],
        },
      }),
    );
    await waitFor(() => action.outcome() !== undefined);
    const outcome = action.outcome();
    if (outcome?.kind !== 'success')
      throw new Error('Missing deferred action outcome');
    const later = (outcome.value as { later: Promise<string> }).later;
    expect(later).toBeInstanceOf(Promise);
    stream.enqueue(encode({ type: 'resolve', key: 'later', value: 'ready' }));
    expect(await later).toBe('ready');
    expect(action.pending()).toBe(true);
    expect(loads()).toBe(1);
    stream.close();
    expect(await submission).toBeUndefined();
    flush();
    expect(action.error()).toBeInstanceOf(Error);
    expect((action.error() as Error).message).toContain('Truncated');
    expect(action.outcome()).toBe(outcome);
    expect((outcome.value as { later: Promise<string> }).later).toBe(later);
    expect(loads()).toBe(1);
    expect(action.pending()).toBe(false);
  });

  test('pending public state and deferred settlements cannot mutate native action control', async () => {
    let resolveLater!: (value: { rows: { name: string }[] }) => void;
    const later = new Promise<{ rows: { name: string }[] }>(resolve => {
      resolveLater = resolve;
    });
    const { router, action, loads } = actionFixture(async () =>
      response({
        kind: 'deferred',
        critical: { nested: { name: 'tractor' } },
        deferred: { later },
        response: metadata,
      }),
    );
    await router.load();
    const submission = action.submit(request());
    await waitFor(() => action.outcome() !== undefined);
    const outcome = action.outcome();
    if (outcome?.kind !== 'success')
      throw new Error('Missing deferred action data');
    const data = outcome.value as {
      nested: { name: string };
      later: Promise<{ rows: { name: string }[] }>;
    };
    expect(Reflect.set(outcome, 'kind', 'redirect')).toBe(false);
    expect(Reflect.set(outcome, 'status', 422)).toBe(false);
    expect(Reflect.set(outcome, 'location', '/done')).toBe(false);
    expect(Reflect.set(data.nested, 'name', 'mutated')).toBe(false);
    expect(action.pending()).toBe(true);
    expect(loads()).toBe(1);
    const publicLater = data.later;
    resolveLater({ rows: [{ name: 'settled-tractor' }] });
    const settled = await publicLater;
    expect(Reflect.set(settled.rows[0]!, 'name', 'mutated')).toBe(false);
    expect(() =>
      Array.prototype.push.call(settled.rows, { name: 'injected' }),
    ).toThrow(TypeError);
    const returned = await submission;
    flush();
    expect(returned).toBe(outcome);
    expect(action.outcome()).toBe(outcome);
    expect(data.later).toBe(publicLater);
    expect(await data.later).toBe(settled);
    expect(settled.rows[0]?.name).toBe('settled-tractor');
    expect(router.state.location.pathname).toBe('/items/42');
    expect(loads()).toBe(2);
    expect(action.error()).toBeUndefined();
  });

  test('a deferred mutable native value fails its owner before success invalidation', async () => {
    let resolveLater!: (value: Map<string, string>) => void;
    const later = new Promise<Map<string, string>>(resolve => {
      resolveLater = resolve;
    });
    let signal: AbortSignal | undefined;
    const { router, action, loads } = actionFixture(async (input, init) => {
      signal = init?.signal ?? (input as Request).signal;
      return createDataResponse(
        {
          kind: 'deferred',
          critical: { name: 'initial' },
          deferred: { later },
          response: metadata,
        },
        identity,
        { routeId: 'item', operation: 'action', signal },
      );
    });
    await router.load();
    const submission = action.submit(request());
    await waitFor(() => action.outcome() !== undefined);
    const initial = action.outcome();
    if (initial?.kind !== 'success')
      throw new Error('Missing initial action snapshot');
    const publicLater = (initial.value as { later: Promise<unknown> }).later;
    resolveLater(new Map([['name', 'unsupported']]));
    let rejection: unknown;
    try {
      await publicLater;
    } catch (failure) {
      rejection = failure;
    }
    expect(rejection).toMatchObject({ name: 'DataProtocolError' });
    expect(Object.isFrozen(rejection)).toBe(true);
    expect(await submission).toBeUndefined();
    flush();
    expect(action.error()?.name).toBe('DataProtocolError');
    expect(action.error()?.message).toContain('Map');
    expect(action.outcome()).toBe(initial);
    expect(signal?.aborted).toBe(true);
    expect(action.pending()).toBe(false);
    expect(loads()).toBe(1);
  });

  test('deferred rejection exposes checked immutable diagnostics', async () => {
    let rejectLater!: (reason: Error) => void;
    const later = new Promise<string>((_resolve, reject) => {
      rejectLater = reject;
    });
    const { router, action, loads } = actionFixture(async () =>
      response({
        kind: 'deferred',
        critical: { name: 'initial' },
        deferred: { later },
        response: metadata,
      }),
    );
    await router.load();
    const submission = action.submit(request());
    await waitFor(() => action.outcome() !== undefined);
    const outcome = action.outcome();
    if (outcome?.kind !== 'success')
      throw new Error('Missing initial action snapshot');
    const publicLater = (outcome.value as { later: Promise<unknown> }).later;
    const original = new Error('PRIVATE_DEFERRED_MESSAGE');
    rejectLater(original);
    let rejection: unknown;
    try {
      await publicLater;
    } catch (failure) {
      rejection = failure;
    }
    expect(rejection).not.toBe(original);
    expect(rejection).toMatchObject({ name: 'Error' });
    expect(Object.isFrozen(rejection)).toBe(true);
    expect(Reflect.set(rejection as object, 'message', 'mutated')).toBe(false);
    expect(Object.isFrozen(original)).toBe(false);
    expect(await submission).toBe(outcome);
    flush();
    expect(action.outcome()).toBe(outcome);
    expect(action.error()).toBeUndefined();
    expect(loads()).toBe(2);
  });

  test('native redirects navigate to the destination route', async () => {
    const { router, action } = actionFixture(async () =>
      response({
        kind: 'redirect',
        location: '/done',
        response: { ...metadata, status: 303 },
      }),
    );
    await router.load();
    const element = document.createElement('div');
    disposers.push(
      mountApplication(() => <RouterProvider router={router} />, element),
    );
    await action.submit(request());
    flush();
    expect(router.state.location.pathname).toBe('/done');
    expect(element.textContent).toBe('complete');
    expect(action.error()).toBeUndefined();
  });

  test('query-only mutation redirects refresh long-lived native loader data', async () => {
    const { router, action, loads } = actionFixture(async () =>
      response({
        kind: 'redirect',
        location: '?saved=true',
        response: { ...metadata, status: 303 },
      }),
    );
    await router.load();
    const element = document.createElement('div');
    disposers.push(
      mountApplication(() => <RouterProvider router={router} />, element),
    );
    await action.submit(request());
    flush();
    expect(action.error()).toBeUndefined();
    expect(router.state.location.pathname).toBe('/items/42');
    expect(router.state.location.search).toEqual({ saved: true });
    expect(loads()).toBeGreaterThan(1);
    expect(router.state.matches.at(-1)?.loaderData).toEqual({
      itemId: '42',
      loads: loads(),
    });
  });

  test('native ActionForm preserves successful controls and the actual submitter', async () => {
    let fields: [string, FormDataEntryValue][] = [];
    const { router, action } = actionFixture(async input => {
      fields = [...(await (input as Request).formData())];
      return success('saved');
    });
    await router.load();
    const element = document.createElement('div');
    disposers.push(
      mountApplication(
        () => (
          <ActionForm action={action} class="native-form">
            <input name="name" value="tractor" />
            <input name="disabled" value="excluded" disabled />
            <button type="submit" name="intent" value="save">
              Save
            </button>
          </ActionForm>
        ),
        element,
      ),
    );
    const form = element.querySelector('form');
    const button = element.querySelector('button');
    if (!form || !button) throw new Error('Missing native form controls');
    expect(form.method).toBe('post');
    expect(form.className).toBe('native-form');
    const event = new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: button,
    });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => !action.pending());
    expect(action.error()).toBeUndefined();
    expect(fields).toEqual([
      ['name', 'tractor'],
      ['intent', 'save'],
    ]);
  });

  test('useRouteAction derives the filesystem ID and identity from the nearest native match', async () => {
    let action!: RouteAction;
    const native = fixture(() => {
      action = useRouteAction();
      return (
        <ActionForm action={action}>
          <button type="submit">Save</button>
        </ActionForm>
      );
    });
    await native.router.load();
    const element = document.createElement('div');
    disposers.push(
      mountApplication(
        () => <RouterProvider router={native.router} />,
        element,
      ),
    );
    await waitFor(() => !!action);
    expect(action.routeId).toBe('item');
    expect(new URL(action.url()).pathname).toBe('/items/42');
    expect(element.querySelector('form')?.method).toBe('post');
  });

  test('a basepath entry posts actions to the public route URL', async () => {
    let destination = '';
    const native = fixture(undefined, '/admin');
    await native.router.load();
    expect(native.router.state.location.pathname).toBe('/items/42');
    const action = createRouteAction({
      router: native.router,
      routeId: 'item',
      rendererIdentity: identity,
      fetch: async input => {
        destination = (input as Request).url;
        return success('saved');
      },
    });
    disposers.push(action.dispose);
    expect(new URL(action.url()).pathname).toBe('/admin/items/42');
    const element = document.createElement('div');
    disposers.push(
      mountApplication(
        () => (
          <ActionForm action={action}>
            <button type="submit">Save</button>
          </ActionForm>
        ),
        element,
      ),
    );
    const form = element.querySelector('form');
    if (!form) throw new Error('Missing native form');
    await action.submitForm(form);
    flush();
    expect(action.error()).toBeUndefined();
    expect(new URL(destination).pathname).toBe('/admin/items/42');
  });

  test('the native submitter action override retains its path and query', async () => {
    let destination = '';
    const { router, action } = actionFixture(async input => {
      destination = (input as Request).url;
      return success('saved');
    });
    await router.load();
    const element = document.createElement('div');
    disposers.push(
      mountApplication(
        () => (
          <ActionForm action={action}>
            <button
              type="submit"
              formaction="http://localhost/items/99?intent=alternate"
              name="intent"
              value="save"
            >
              Save
            </button>
          </ActionForm>
        ),
        element,
      ),
    );
    const form = element.querySelector('form');
    const button = element.querySelector('button');
    if (!form || !button) throw new Error('Missing native form controls');
    await action.submitForm(form, button);
    flush();
    expect(action.error()).toBeUndefined();
    const url = new URL(destination);
    expect(url.pathname).toBe('/items/99');
    expect(url.searchParams.get('intent')).toBe('alternate');
  });

  test('renderer identity and mutation methods fail before starting transport', () => {
    const { router, action } = actionFixture(async () => success('unused'));
    expect(() =>
      createRouteAction({
        router,
        routeId: 'item',
        rendererIdentity: { ...identity, renderer: 'react' },
      }),
    ).toThrow('Solid renderer identity');
    expect(() =>
      createRouteAction({
        router,
        routeId: 'item',
        rendererIdentity: { ...identity, buildId: 'wrong' },
      }),
    ).toThrow('conflicts');
    expect(() =>
      action.submit(new Request('http://localhost/items/42')),
    ).toThrow('mutation Request');
    expect(action.pending()).toBe(false);
  });
});
