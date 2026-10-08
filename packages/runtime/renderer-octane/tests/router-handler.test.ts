import {
  createRequestSession,
  type RequestSession,
} from '@modern-js/renderer-core/session';
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@octanejs/tanstack-router';
import { createSsrStreamResponse } from '@octanejs/tanstack-router/ssr/server';
import { rs } from '@rstest/core';
import { createOctaneRequestHandler } from '../src/router-handler';

const identity = {
  renderer: 'octane',
  appId: 'native-handler-test',
  entryName: 'main',
  buildId: 'source-profile-build',
  protocolVersion: 1,
} as const;
const owners = new Set<RequestSession>();

function createOwner(path = '/') {
  const original = new Request(`https://native.test${path}`);
  const session = createRequestSession({
    request: original,
    identity,
    platform: { kind: 'node', bindings: {} },
  });
  owners.add(session);
  return {
    session,
    request: new Request(original, { signal: session.signal }),
  };
}

afterEach(async () => {
  for (const owner of owners) {
    owner.abort(new Error('native handler test finished'));
    await owner.completion;
  }
  owners.clear();
});

test('native matching and document callback follow guarded serialization', async () => {
  const owner = createOwner('/product/7');
  const loader = rs.fn(({ params }: { params: Record<string, string> }) => ({
    id: params.id,
  }));
  const root = createRootRoute({
    beforeLoad: () => ({ publicTitle: 'native public context' }),
    headers: () => ({
      'x-root': 'native',
      vary: 'Cookie',
      'content-security-policy': "default-src 'self'",
      'server-timing': 'root;dur=1',
    }),
  });
  const product = createRoute({
    getParentRoute: () => root,
    path: 'product/$id',
    loader,
    headers: () => {
      const headers = new Headers({
        'x-product': '7',
        vary: 'Accept-Language, cookie',
        'content-security-policy': "script-src 'self'",
        'server-timing': 'product;dur=2',
      });
      headers.append('set-cookie', 'a=1; Path=/');
      headers.append('set-cookie', 'b=2; Path=/');
      return headers;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([product]),
    isServer: true,
  });
  const callback = rs.fn(
    async ({ responseHeaders }: { responseHeaders: Headers }) => {
      expect(responseHeaders.get('x-root')).toBe('native');
      expect(responseHeaders.get('x-product')).toBe('7');
      expect(responseHeaders.get('vary')).toBe('Cookie, Accept-Language');
      expect(responseHeaders.get('content-security-policy')).toBe(
        "default-src 'self', script-src 'self'",
      );
      expect(responseHeaders.get('server-timing')).toBe(
        'root;dur=1, product;dur=2',
      );
      expect(responseHeaders.getSetCookie()).toEqual([
        'a=1; Path=/',
        'b=2; Path=/',
      ]);
      expect(router.serverSsr?.takeBufferedScripts()?.children).toContain(
        'ultramodern.octane-public-snapshot.v1',
      );
      return new Response('native document');
    },
  );
  const response = await createOctaneRequestHandler({
    ...owner,
    createRouter: () => router,
  })(callback);
  expect(await response.text()).toBe('native document');
  expect(loader).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(router.stores.matches.get().at(-1)?.loaderData).toEqual({ id: '7' });
});

test.each([
  ['/target', 303],
  ['https://elsewhere.test/target', 307],
] as const)(
  'native terminal redirect %s bypasses document serialization',
  async (href, statusCode) => {
    const owner = createOwner();
    const root = createRootRoute({
      loader: () => {
        throw redirect({ href, statusCode });
      },
    });
    const router = createRouter({ routeTree: root, isServer: true });
    const callback = rs.fn(async () => new Response('incorrect document'));
    const response = await createOctaneRequestHandler({
      ...owner,
      createRouter: () => router,
    })(callback);
    expect(response.status).toBe(statusCode);
    expect(response.headers.get('location')).toBe(href);
    expect(response.body).toBeNull();
    expect(callback).not.toHaveBeenCalled();
    expect(router.serverSsr?.takeBufferedHtml()).toBeUndefined();
  },
);

test('preflight rejects a match accessor before native id handling', async () => {
  const owner = createOwner();
  let getterRuns = 0;
  const root = createRootRoute({ loader: () => ({ value: 'safe' }) });
  const router = createRouter({ routeTree: root, isServer: true });
  const nativeLoad = router.load;
  router.load = async (...args) => {
    await nativeLoad(...args);
    Object.defineProperty(router.stores.matches.get()[0], 'id', {
      configurable: true,
      get() {
        getterRuns++;
        return 'unexpected';
      },
    });
  };
  const callback = rs.fn(async () => new Response('incorrect document'));
  await expect(
    createOctaneRequestHandler({ ...owner, createRouter: () => router })(
      callback,
    ),
  ).rejects.toThrow();
  expect(getterRuns).toBe(0);
  expect(callback).not.toHaveBeenCalled();
  expect((await owner.session.completion).state).toBe('failed');
});

test('critical public-data rejection never reaches the response callback', async () => {
  const owner = createOwner();
  let getterRuns = 0;
  const poison = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() {
      getterRuns++;
      return 'private';
    },
  });
  const root = createRootRoute({ loader: () => poison });
  const router = createRouter({ routeTree: root, isServer: true });
  const callback = rs.fn(async () => new Response('incorrect document'));
  await expect(
    createOctaneRequestHandler({ ...owner, createRouter: () => router })(
      callback,
    ),
  ).rejects.toThrow();
  expect(getterRuns).toBe(0);
  expect(callback).not.toHaveBeenCalled();
  expect(router.stores.matches.get()[0]?.loaderData).toBe(poison);
  expect((await owner.session.completion).cacheEligible).toBe(false);
});

test('aborted native loading cancels native matches and releases the handler', async () => {
  const owner = createOwner();
  let loadStarted!: () => void;
  const started = new Promise<void>(resolve => {
    loadStarted = resolve;
  });
  const aborted = rs.fn();
  const root = createRootRoute({
    loader: ({ abortController }) => {
      abortController.signal.addEventListener('abort', aborted, { once: true });
      loadStarted();
      return new Promise(() => {});
    },
  });
  const router = createRouter({ routeTree: root, isServer: true });
  const callback = rs.fn(async () => new Response('incorrect document'));
  const pending = createOctaneRequestHandler({
    ...owner,
    createRouter: () => router,
  })(callback);
  await started;
  const reason = new Error('request cancelled while native loading');
  owner.session.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(aborted).toHaveBeenCalledTimes(1);
  expect(callback).not.toHaveBeenCalled();
  expect((await owner.session.completion).state).toBe('aborted');
});

test('stream response ownership defers native cleanup to the owning session', async () => {
  const owner = createOwner();
  const root = createRootRoute({ loader: () => ({ value: 'safe' }) });
  const router = createRouter({ routeTree: root, isServer: true });
  const cleaned = rs.fn();
  const response = await createOctaneRequestHandler({
    ...owner,
    createRouter: () => router,
  })(async ({ router }) => {
    router.serverSsr!.onCleanup(cleaned);
    owner.session.resolveResponse({
      kind: 'document',
      status: 200,
      headers: [],
      cache: { mode: 'no-store' },
    });
    owner.session.startRendering();
    return createSsrStreamResponse(
      router,
      owner.session.respond(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('safe stream'));
            controller.close();
          },
        }),
      ),
    );
  });
  expect(cleaned).not.toHaveBeenCalled();
  expect(owner.session.ownsResponseBody(response)).toBe(true);
  expect(await response.text()).toBe('safe stream');
  expect((await owner.session.completion).state).toBe('completed');
  expect(cleaned).toHaveBeenCalledTimes(1);
});
