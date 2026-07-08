import {
  __setTanstackRscPayloadDecoderForTests,
  createTanstackRscServerPayload,
  handleTanstackRscRedirect,
  loadTanstackRscRouteData,
} from '../../src/runtime/rsc/payloadRouter';

function createPayload(
  routeId: string,
  loaderData: unknown,
  options: { errors?: Record<string, unknown> | null } = {},
) {
  return {
    type: 'render',
    actionData: null,
    errors: options.errors ?? null,
    loaderData: loaderData === undefined ? {} : { [routeId]: loaderData },
    location: { href: routeId },
    routes: [{ id: routeId, hasLoader: true }],
  };
}

async function decodeJsonPayload(stream: ReadableStream<Uint8Array>) {
  return JSON.parse(await new Response(stream).text());
}

describe('tanstack rsc payload router matrix', () => {
  afterEach(() => {
    __setTanstackRscPayloadDecoderForTests();
    rstest.restoreAllMocks();
  });

  test('normalizes redirect basenames while preserving status and non-location headers', () => {
    const scenarios = [
      {
        location: '/base',
        name: 'exact basename',
        redirect: '/',
      },
      {
        location: '/base/login?from=%2Fbase',
        name: 'leading basename',
        redirect: '/login?from=%2Fbase',
      },
      {
        location: '/shop/base/login',
        name: 'mid-path basename',
        redirect: '/shop/base/login',
      },
    ] as const;

    for (const scenario of scenarios) {
      const response = handleTanstackRscRedirect(
        new Headers({
          Location: scenario.location,
          'X-Trace': scenario.name,
        }),
        '/base',
        307,
      );

      expect(response.status).toBe(307);
      expect(response.headers.get('Location')).toBeNull();
      expect(response.headers.get('X-Modernjs-BaseUrl')).toBe('/base');
      expect(response.headers.get('X-Modernjs-Redirect')).toBe(
        scenario.redirect,
      );
      expect(response.headers.get('X-Trace')).toBe(scenario.name);
    }
  });

  test('separates payload fetch cache entries by URL and request method', async () => {
    const payloads = [
      createPayload('/resource', { method: 'GET' }),
      createPayload('/resource', { method: 'POST' }),
    ];
    let payloadIndex = 0;
    const fetchMock = rstest.fn(() =>
      Promise.resolve(new Response(JSON.stringify(payloads[payloadIndex++]))),
    );
    rstest.stubGlobal('fetch', fetchMock);
    __setTanstackRscPayloadDecoderForTests(decodeJsonPayload);

    const [getData, postData] = await Promise.all([
      loadTanstackRscRouteData({
        loadClientData: async () => ({ fallback: 'get' }),
        request: new Request('http://localhost/resource', { method: 'GET' }),
        routeId: '/resource',
      }),
      loadTanstackRscRouteData({
        loadClientData: async () => ({ fallback: 'post' }),
        request: new Request('http://localhost/resource', { method: 'POST' }),
        routeId: '/resource',
      }),
    ]);

    expect(getData).toEqual({ method: 'GET' });
    expect(postData).toEqual({ method: 'POST' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'http://localhost/resource',
      'http://localhost/resource',
    ]);
  });

  test('rethrows matched route errors from the decoded payload', async () => {
    const routeError = new Error('route loader failed');
    const payload = createPayload('/broken', undefined, {
      errors: { '/broken': routeError },
    });
    rstest.stubGlobal(
      'fetch',
      rstest.fn(() => Promise.resolve(new Response('payload'))),
    );
    __setTanstackRscPayloadDecoderForTests(async () => payload);

    await expect(
      loadTanstackRscRouteData({
        loadClientData: async () => ({ fallback: true }),
        request: new Request('http://localhost/broken'),
        routeId: '/broken',
      }),
    ).rejects.toBe(routeError);
  });

  test('returns undefined for route ids missing from the decoded payload', async () => {
    const loadClientData = rstest.fn(async () => ({ fallback: true }));
    const payload = createPayload('/known', { known: true });
    rstest.stubGlobal(
      'fetch',
      rstest.fn(() => Promise.resolve(new Response('payload'))),
    );
    __setTanstackRscPayloadDecoderForTests(async () => payload);

    await expect(
      loadTanstackRscRouteData({
        loadClientData,
        request: new Request('http://localhost/missing'),
        routeId: '/missing',
      }),
    ).resolves.toBeUndefined();
    expect(loadClientData).not.toHaveBeenCalled();
  });

  test('omits server payload matches with no route identity', () => {
    const payload = createTanstackRscServerPayload({
      state: {
        location: { href: '/kept' },
        matches: [
          {
            loaderData: { omitted: true },
            params: {},
            pathname: '/missing-id',
            pathnameBase: '/missing-id',
            route: {
              options: {
                path: 'missing-id',
                staticData: { modernRouteHasLoader: true },
              },
            },
          },
          {
            loaderData: { kept: true },
            params: {},
            pathname: '/kept',
            pathnameBase: '/kept',
            route: {
              id: '/kept',
              options: {
                path: 'kept',
                staticData: { modernRouteHasLoader: true },
              },
            },
          },
        ],
      },
    });

    expect(payload.loaderData).toEqual({ '/kept': { kept: true } });
    expect(payload.routes).toEqual([
      {
        handle: undefined,
        hasAction: false,
        hasClientLoader: false,
        hasErrorBoundary: false,
        hasLoader: true,
        id: '/kept',
        index: undefined,
        params: {},
        parentId: undefined,
        path: 'kept',
        pathname: '/kept',
        pathnameBase: '/kept',
      },
    ]);
  });
});
