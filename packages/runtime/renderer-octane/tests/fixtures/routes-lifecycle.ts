import assert from 'node:assert/strict';
import {
  createDataResponse,
  type DataOutcome,
  type DecodedDataOutcome,
  type FileSystemRouteIR,
} from '@modern-js/renderer-core/data';
import { createRequestSession } from '@modern-js/renderer-core/session';
import {
  createMemoryHistory,
  createRouter,
  isNotFound,
  isRedirect,
  Outlet,
} from '@octanejs/tanstack-router';
import {
  attachRouterServerSsrUtils,
  createRequestHandler,
  createSsrStreamResponse,
  RouterServer,
} from '@octanejs/tanstack-router/ssr/server';
import { ssrHtml } from 'octane/server';
import { createOctaneRouteAction } from '../../src/router';
import { createOctaneRouterInjection } from '../../src/router-injection';
import {
  createFileSystemRouteTree,
  RouteDataError,
  resolveRouteData,
  selectApplicationDataRoute,
} from '../../src/routes';
import { renderOctaneApplication } from '../../src/server';

const identity = {
  renderer: 'octane',
  appId: 'native-router-test',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'native-build',
} as const;
const metadata = (status = 200) => ({
  status,
  statusText: '',
  headers: [] as [string, string][],
  cachePolicy: 'no-store' as const,
});
const success = (value: unknown): DataOutcome => ({
  kind: 'success',
  value,
  response: metadata(),
});
const descriptor = (
  id: string,
  properties: Partial<FileSystemRouteIR> = {},
): FileSystemRouteIR => ({ id, children: [], ...properties });
const requestSession = (request = new Request('https://native.test/')) =>
  createRequestSession({
    request,
    identity,
    platform: { kind: 'node', bindings: {} },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function checkNativeDataCompletionFailure(
  timing: 'early' | 'late' | 'commit' | 'cancelled',
) {
  const terminal = deferred<void>();
  const failure = new Error(`Missing terminal data frame: ${timing}`);
  if (timing === 'early') terminal.reject(failure);
  void terminal.promise.catch(() => {});
  const late = deferred<string>();
  const preload = deferred<void>();
  const initial = deferred<void>();
  const hooks: string[] = [];
  const errorComponent = Object.assign(() => null, {
    preload: async () => {
      hooks.push('preload');
    },
  });
  let router!: ReturnType<typeof createRouter>;
  const tree = createFileSystemRouteTree(
    [
      descriptor('item', {
        path: 'item/:itemId',
        modules: { data: '/item.data.ts' },
      }),
    ],
    {
      item: {
        errorComponent,
        ...(timing === 'commit'
          ? {
              component: Object.assign(() => null, {
                preload: () => preload.promise,
              }),
            }
          : {}),
      },
    },
    {
      // Client factories use their browser URL and native loader signal.
      ...(timing === 'commit'
        ? {}
        : { request: new Request('https://native.test/item/7') }),
      getRouter: () => router,
      onOutcome: () => initial.resolve(),
      loadRoute: async (): Promise<DecodedDataOutcome> => ({
        kind: 'success',
        status: 200,
        value: { critical: 'early value', late: late.promise },
        completion: terminal.promise,
      }),
    },
  );
  tree.children[0].update({
    onError: () => {
      hooks.push('onError');
    },
  });
  router = createRouter({
    routeTree: tree,
    isServer: timing !== 'commit',
    history: createMemoryHistory({ initialEntries: ['/item/7'] }),
  });
  const loading = router.load();
  if (timing === 'commit') {
    await Promise.race([
      initial.promise,
      loading.then(() => {
        const failed = router.stores.matches
          .get()
          .find(match => match.status === 'error');
        if (failed) throw failed.error;
        throw new Error(
          'Native router finished before publishing critical data',
        );
      }),
    ]);
    terminal.reject(failure);
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    const pending = router.stores.pendingMatches.get().at(-1)!;
    assert.equal(pending.status, 'pending');
    assert.equal(pending.loaderData.critical, 'early value');
    assert.equal(pending.loaderData.late, late.promise);
    assert.deepEqual(hooks, ['preload']);
    preload.resolve();
  }
  await loading;
  const match = router.stores.matches.get().at(-1)!;
  if (timing === 'early' || timing === 'commit') {
    assert.equal(match.status, 'error');
    assert.equal(match.error, failure);
    assert.deepEqual(hooks, ['preload', 'onError']);
    return;
  }
  assert.equal(match.status, 'success');
  assert.equal(match.loaderData.critical, 'early value');
  assert.equal(match.loaderData.late, late.promise);
  assert.deepEqual(hooks, ['preload']);
  late.resolve('resolved before missing terminal frame');
  await late.promise;
  if (timing === 'cancelled') router.cancelMatch(match.id);
  terminal.reject(failure);
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    if (router.getMatch(match.id)?.status === 'error') break;
    if (timing === 'cancelled' && attempt > 2) break;
  }
  const completed = router.getMatch(match.id)!;
  if (timing === 'cancelled') {
    assert.equal(completed.status, 'success');
    assert.deepEqual(hooks, ['preload']);
  } else {
    assert.equal(completed.status, 'error');
    assert.equal(completed.error, failure);
    assert.deepEqual(hooks, ['preload', 'onError']);
  }
}

export async function nativeDataCompletionFailure() {
  for (const timing of ['early', 'late', 'cancelled'] as const) {
    await checkNativeDataCompletionFailure(timing);
  }
}

/** Reactive native commits run in the owning browser environment. */
export async function nativeDataCompletionCommitFailure() {
  await checkNativeDataCompletionFailure('commit');
}

export async function nativeFileSystemRoutes() {
  const calls: {
    id: string;
    params: Readonly<Record<string, string>>;
    url: string;
  }[] = [];
  const request = new Request('https://native.test/products/42?sort=price', {
    headers: { 'x-request-owned': 'yes' },
  });
  const context = { tenant: 'tractor-store' };
  const root = descriptor('app-root', {
    isRoot: true,
    modules: { data: '/root.data.ts' },
    children: [
      descriptor('layout', {
        children: [
          descriptor('home', { index: true }),
          descriptor('product', {
            path: 'products/:productId',
            modules: { data: '/product.data.ts' },
          }),
          descriptor('locale', {
            path: 'locale/:lang?',
            children: [descriptor('locale-index', { index: true })],
          }),
          descriptor('files', { path: 'files/*' }),
          descriptor('feed', { path: 'feed.xml' }),
        ],
      }),
    ],
  });
  const pending = () => null;
  const error = () => null;
  const tree = createFileSystemRouteTree(
    [root],
    {
      product: {
        pendingComponent: pending,
        errorComponent: error,
        validateSearch: search => ({ sort: search.sort ?? 'name' }),
      },
    },
    {
      request,
      context,
      loadRoute: async (route, input) => {
        assert.equal(input.context, context);
        assert.equal(input.request.headers.get('x-request-owned'), 'yes');
        assert.equal(input.request.signal.aborted, false);
        calls.push({
          id: route.id,
          params: input.params,
          url: input.request.url,
        });
        return success({ loaded: route.id });
      },
    },
  );
  tree.update({
    beforeLoad: () => ({ authorization: 'native-route-context' }),
  });
  const router = createRouter({
    routeTree: tree,
    context: { ultramodern: { rendererIdentity: identity } },
    isServer: true,
    history: createMemoryHistory({
      initialEntries: ['/products/42?sort=price'],
    }),
  });
  await router.load();
  assert.deepEqual(
    calls.map(call => call.id),
    ['app-root', 'product'],
  );
  assert.equal(calls[1]?.params.productId, '42');
  assert.equal(calls[1]?.url, request.url);
  const matches = router.stores.matches.get();
  assert.deepEqual(
    matches.map(
      match =>
        router.routesById[match.routeId]?.options.staticData
          ?.ultramodernRouteId,
    ),
    ['app-root', 'layout', 'product'],
  );
  assert.deepEqual(matches.at(-1)?.loaderData, { loaded: 'product' });
  assert.deepEqual(matches.at(-1)?.search, { sort: 'price' });
  assert.deepEqual(matches.at(-1)?.context, {
    ultramodern: { rendererIdentity: identity },
    authorization: 'native-route-context',
  });
  assert.equal(
    router.routesById[matches.at(-1)!.routeId]?.options.pendingComponent,
    pending,
  );
  assert.equal(
    router.routesById[matches.at(-1)!.routeId]?.options.errorComponent,
    error,
  );
  assert.equal(typeof tree.options.component, 'function');
  assert.notEqual(tree.options.component, Outlet);
  for (const [pathname, expectedId] of [
    ['/', 'home'],
    ['/locale', 'locale-index'],
    ['/locale/en', 'locale-index'],
    ['/files/a/b', 'files'],
    ['/feed.xml', 'feed'],
  ] as const) {
    const match = router.matchRoutes(pathname).at(-1)!;
    assert.equal(
      router.routesById[match.routeId]?.options.staticData?.ultramodernRouteId,
      expectedId,
    );
    if (expectedId === 'files') assert.equal(match.params._splat, 'a/b');
  }
  const loader = () => ({ authorized: true });
  const handlers = { product: { loader }, 'app-root': { loader } };
  assert.equal(
    selectApplicationDataRoute(router, request, 'product', 'loader', handlers)
      ?.handler,
    loader,
  );
  assert.equal(
    selectApplicationDataRoute(router, request, 'product', 'loader', handlers)
      ?.params.productId,
    '42',
  );
  assert.equal(
    selectApplicationDataRoute(router, request, 'app-root', 'loader', handlers)
      ?.handler,
    loader,
  );
  assert.equal(
    selectApplicationDataRoute(
      router,
      new Request('https://native.test/feed.xml'),
      'product',
      'loader',
      handlers,
    ),
    undefined,
  );
  assert.equal(
    selectApplicationDataRoute(router, request, 'product', 'action', handlers),
    undefined,
  );
}

export async function nativeLoaderCancellation() {
  for (const source of ['request', 'native-router'] as const) {
    const controller = new AbortController();
    const request = new Request('https://native.test/item/7', {
      signal: controller.signal,
    });
    const pending = deferred<DataOutcome>();
    let loaderRequest: Request | undefined;
    let observed = 0;
    const tree = createFileSystemRouteTree(
      [
        descriptor('item', {
          path: 'item/:id',
          modules: { data: '/item.data.ts' },
        }),
      ],
      {},
      {
        request,
        loadRoute: async (_route, input) => {
          loaderRequest = input.request;
          return pending.promise;
        },
        onOutcome: () => {
          observed++;
        },
      },
    );
    const router = createRouter({
      routeTree: tree,
      isServer: true,
      history: createMemoryHistory({ initialEntries: ['/item/7'] }),
    });
    const loading = router.load();
    for (let attempts = 0; !loaderRequest && attempts < 1000; attempts++) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.ok(
      loaderRequest,
      'The native router must start its matching loader',
    );
    if (source === 'request') {
      controller.abort(new DOMException('Connection closed', 'AbortError'));
    } else {
      const match = router.stores.pendingMatches.get().at(-1);
      assert.ok(match);
      router.cancelMatch(match.id);
    }
    assert.equal(loaderRequest.signal.aborted, true);
    pending.resolve(success('too late'));
    await loading;
    assert.equal(observed, 0);
    assert.notEqual(router.stores.matches.get().at(-1)?.loaderData, 'too late');
  }
}

export async function nativeOutcomeBoundaries() {
  assert.throws(
    () =>
      resolveRouteData('product', {
        kind: 'not-found',
        value: { missing: 'tractor' },
        thrown: true,
        status: 404,
      }),
    isNotFound,
  );
  try {
    resolveRouteData('product', {
      kind: 'redirect',
      location: '/sign-in',
      response: {
        ...metadata(303),
        headers: [
          ['set-cookie', 'a=1'],
          ['set-cookie', 'b=2'],
        ],
      },
    });
    assert.fail('Expected a native redirect');
  } catch (error) {
    assert.equal(isRedirect(error), true);
    assert.equal((error as Response).status, 303);
    assert.deepEqual(
      new Headers((error as { headers: Headers }).headers).getSetCookie(),
      ['a=1', 'b=2'],
    );
  }
  assert.throws(
    () =>
      resolveRouteData('product', {
        kind: 'error',
        error: { name: 'ValidationError', message: 'Invalid product' },
        data: { field: 'sku' },
        thrown: true,
        status: 422,
      }),
    error =>
      error instanceof RouteDataError &&
      error.status === 422 &&
      error.routeId === 'product' &&
      error.name === 'ValidationError' &&
      (error.data as { field: string }).field === 'sku',
  );
  assert.throws(
    () => createFileSystemRouteTree([descriptor('a'), descriptor('a')], {}),
    /Duplicate filesystem route id/,
  );
  assert.throws(
    () =>
      createFileSystemRouteTree(
        [
          descriptor('root', { isRoot: true }),
          descriptor('other', { isRoot: true }),
        ],
        {},
      ),
    /one application root/,
  );
  assert.throws(
    () =>
      createFileSystemRouteTree(
        [descriptor('a', { modules: { data: '/a.data.ts' } })],
        {},
      ),
    /requires its loader/,
  );
}

async function serializingRouter(late: Promise<unknown>) {
  const request = new Request('https://native.test/');
  const tree = createFileSystemRouteTree(
    [descriptor('home', { index: true, modules: { data: '/home.data.ts' } })],
    {},
    {
      request,
      loadRoute: async () => success({ late }),
    },
  );
  const router = createRouter({
    routeTree: tree,
    isServer: true,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  attachRouterServerSsrUtils({ router });
  await router.load();
  await router.serverSsr!.dehydrate();
  return { router, session: requestSession(request) };
}

export async function nativeRouterInjectionCompletion() {
  const late = deferred<string>();
  const { router, session } = await serializingRouter(late.promise);
  let cleanup = 0;
  router.serverSsr!.onCleanup(() => {
    cleanup++;
  });
  const injection = createOctaneRouterInjection(router, session);
  let notifications = 0;
  const stop = injection.subscribe(() => {
    notifications++;
  });
  let html = injection.take();
  injection.renderComplete?.();
  late.resolve('late native value');
  await injection.done;
  assert.ok(notifications > 0);
  html += injection.take();
  assert.match(html, /\$_TSR\.router=/);
  assert.match(html, /late native value/);
  stop();
  session.resolveResponse({
    kind: 'document',
    status: 200,
    headers: [],
    cache: { mode: 'no-store' },
  });
  session.respond(null);
  await session.completion;
  assert.equal(cleanup, 1);
  assert.equal(router.serverSsr, undefined);
  assert.equal(injection.take(), '');
}

export async function nativeRouterInjectionTimeoutAndAbort() {
  for (const disposition of ['timeout', 'abort'] as const) {
    const { router, session } = await serializingRouter(new Promise(() => {}));
    let cleanup = 0;
    router.serverSsr!.onCleanup(() => {
      cleanup++;
    });
    const injection = createOctaneRouterInjection(router, session, {
      serializationTimeoutMs: 15,
    });
    injection.subscribe(() => {});
    const completion = injection.done.then(
      () => assert.fail('Pending serialization completed'),
      error => error,
    );
    if (disposition === 'timeout') injection.renderComplete?.();
    else
      await session.abort(
        new DOMException('Client disconnected', 'AbortError'),
      );
    const error = await completion;
    assert.match(
      String(error),
      disposition === 'timeout' ? /timed out/ : /Client disconnected/,
    );
    assert.equal(
      (await session.completion).state,
      disposition === 'timeout' ? 'failed' : 'aborted',
    );
    await session.abort('again');
    assert.equal(cleanup, 1);
    assert.equal(router.serverSsr, undefined);
  }
  const tree = createFileSystemRouteTree([], {});
  const router = createRouter({ routeTree: tree, isServer: true });
  assert.throws(
    () => createOctaneRouterInjection(router, requestSession()),
    /serverSsr is required/,
  );
}

export async function nativeRouterDocumentStream() {
  const session = requestSession();
  const tree = createFileSystemRouteTree(
    [descriptor('home', { index: true })],
    {
      home: {
        component: () => ssrHtml('<main>Native filesystem application</main>'),
      },
    },
  );
  const router = createRouter({
    routeTree: tree,
    isServer: true,
    ssr: { nonce: 'router-nonce' },
  });
  let cleanup = 0;
  const response = await createRequestHandler({
    request: session.request,
    createRouter: () => router,
  })(async ({ router }) => {
    router.serverSsr!.onCleanup(() => {
      cleanup++;
    });
    const injection = createOctaneRouterInjection(router, session);
    const response = await renderOctaneApplication({
      session,
      App: RouterServer,
      props: { router },
      injection,
      document: {
        documentId: 'router-document',
        nativeHydrationBuildId: 'native-router-fixture-client',
        nonce: 'router-nonce',
      },
    });
    const transferred = createSsrStreamResponse(router, response);
    assert.equal(transferred.response, response);
    assert.equal(transferred.response.body, response.body);
    return transferred;
  });
  assert.equal(cleanup, 0);
  const html = await response.text();
  assert.match(html, /Native filesystem application/);
  assert.match(html, /\$_TSR\.router=/);
  assert.equal(html.match(/<!doctype html>/gi)?.length, 1);
  assert.equal(html.match(/<html[\s>]/gi)?.length, 1);
  assert.match(html, /nonce="router-nonce"/);
  assert.equal((await session.completion).state, 'completed');
  assert.equal(cleanup, 1);
}

export async function nativeRouteActionContracts() {
  let loads = 0;
  const tree = createFileSystemRouteTree(
    [
      descriptor('home', { index: true, modules: { data: '/home.data.ts' } }),
      descriptor('complete', { path: 'complete' }),
    ],
    {},
    {
      request: new Request('https://native.test/'),
      loadRoute: async () => {
        loads++;
        return success({ loads });
      },
    },
  );
  const router = createRouter({
    routeTree: tree,
    isServer: true,
    origin: 'https://native.test',
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  let outcome = success({ saved: true });
  const requests: Request[] = [];
  const action = createOctaneRouteAction({
    router,
    routeId: 'home',
    identity,
    fetch: async input => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return createDataResponse(outcome, identity, {
        routeId: 'home',
        operation: 'action',
      });
    },
  });
  const form = new FormData();
  form.set('sku', 'tractor');
  assert.equal((await action(undefined, form)).kind, 'success');
  assert.equal(loads, 2);
  assert.equal(requests[0]?.method, 'POST');
  assert.equal((await requests[0]!.formData()).get('sku'), 'tractor');
  outcome = {
    kind: 'error',
    error: { name: 'ValidationError', message: 'Check SKU' },
    data: { sku: 'unknown' },
    thrown: false,
    response: metadata(422),
  };
  const validation = await action(undefined, form);
  assert.equal(validation.kind, 'error');
  assert.equal(validation.status, 422);
  const beforeThrown = loads;
  outcome = {
    kind: 'error',
    error: { name: 'Failure', message: 'Failed save' },
    thrown: true,
    response: metadata(500),
  };
  await assert.rejects(action(undefined, form), /Failed save/);
  assert.equal(loads, beforeThrown);
  outcome = {
    kind: 'redirect',
    location: '/complete',
    response: metadata(303),
  };
  assert.equal((await action(undefined, form)).kind, 'redirect');
  assert.equal(router.latestLocation.pathname, '/complete');
}

export async function nativeRouterDocumentCancellation() {
  const session = requestSession();
  const request = new Request(session.request, { signal: session.signal });
  const late = deferred<string>();
  let producerAborted = false;
  const tree = createFileSystemRouteTree(
    [descriptor('home', { index: true, modules: { data: '/home.data.ts' } })],
    { home: { component: () => ssrHtml('<main>Early native shell</main>') } },
    {
      request,
      loadRoute: async (_route, input) => {
        input.request.signal.addEventListener(
          'abort',
          () => {
            producerAborted = true;
            late.resolve('aborted producer');
          },
          { once: true },
        );
        return {
          kind: 'deferred',
          critical: { early: 'available' },
          deferred: { late: late.promise },
          response: metadata(),
        };
      },
    },
  );
  const router = createRouter({ routeTree: tree, isServer: true });
  let cleanup = 0;
  const response = await createRequestHandler({
    request,
    createRouter: () => router,
  })(async ({ router }) => {
    router.serverSsr!.onCleanup(() => {
      cleanup++;
    });
    const injection = createOctaneRouterInjection(router, session);
    const response = await renderOctaneApplication({
      session,
      App: RouterServer,
      props: { router },
      injection,
      document: {
        documentId: 'cancelled-router-document',
        nativeHydrationBuildId: 'native-router-fixture-client',
      },
    });
    return createSsrStreamResponse(router, response);
  });
  const reader = response.body!.getReader();
  await reader.read();
  const shell = new TextDecoder().decode((await reader.read()).value);
  assert.match(shell, /Early native shell/);
  assert.equal(producerAborted, false);
  await reader.cancel('Client disconnected');
  assert.equal(producerAborted, true);
  assert.equal(request.signal.aborted, true);
  assert.equal((await session.completion).state, 'aborted');
  assert.equal((await session.completion).cacheEligible, false);
  assert.equal(cleanup, 1);
}
