import { describe, expect, it } from '@rstest/core';
import { createDataClient, readDataResponse } from '../../src/data/client';
import {
  DATA_CODEC,
  parsePublicData,
  serializePublicData,
} from '../../src/data/codec';
import {
  createDataResponse,
  dataMetadataToDocumentPolicy,
  deferData,
  handleDataRequest,
  invokeRouteData,
  mergeDataResponseIntoResponse,
  mergeDataResponseMetadata,
  mergeHeaderFields,
  normalizeDataResult,
  publicDataError,
} from '../../src/data/server';
import {
  DATA_STREAM_CONTENT_TYPE,
  type DataOutcome,
  type PublicDataOutcome,
} from '../../src/data/types';
import type { RendererIdentity } from '../../src/identity';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'app',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'build-a',
};
const expected = {
  identity,
  routeId: 'products',
  operation: 'loader' as const,
};
const input = () => ({
  request: new Request('https://example.test/products'),
  routeId: 'products',
  params: { id: 'a/b' },
  context: { secret: 'server-only' },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const success = (outcome: PublicDataOutcome): unknown => {
  if (outcome.kind !== 'success')
    throw new Error(`Expected success, got ${outcome.kind}`);
  return outcome.value;
};

describe('renderer-neutral HTTP data outcomes', () => {
  it('preserves repeated cookies, status and cache intent outside the public projection', async () => {
    const headers = new Headers({
      'cache-control': 'private',
      'x-secret': 'server-only',
    });
    headers.append('set-cookie', 'session=a; HttpOnly');
    headers.append('set-cookie', 'csrf=b; Secure');
    const outcome = await normalizeDataResult(
      Response.json({ created: true }, { status: 201, headers }),
    );
    expect(outcome.response.status).toBe(201);
    expect(outcome.response.cachePolicy).toBe('private');
    expect(
      outcome.response.headers.filter(([name]) => name === 'set-cookie'),
    ).toEqual([
      ['set-cookie', 'session=a; HttpOnly'],
      ['set-cookie', 'csrf=b; Secure'],
    ]);
    const response = createDataResponse(outcome, identity, expected);
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual([
      'session=a; HttpOnly',
      'csrf=b; Secure',
    ]);
    const text = await response.clone().text();
    expect(text).not.toContain('server-only');
    expect(text).not.toContain('session=a');
    expect(await readDataResponse(response, expected)).toEqual({
      kind: 'success',
      value: { created: true },
      status: 201,
    });
  });

  it('preserves returned and thrown redirect and not-found outcomes without a renderer', async () => {
    for (const thrown of [false, true]) {
      const redirect = await normalizeDataResult(
        new Response(null, {
          status: 303,
          headers: { location: '/next', 'set-cookie': 'saved=yes' },
        }),
        { thrown },
      );
      const response = createDataResponse(redirect, identity, expected);
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-modernjs-redirect')).toBe('/next');
      expect(await readDataResponse(response, expected)).toEqual({
        kind: 'redirect',
        location: '/next',
        status: 303,
      });
      const missing = await normalizeDataResult(
        new Response('not found', { status: 404 }),
        { thrown },
      );
      expect(
        await readDataResponse(
          createDataResponse(missing, identity, expected),
          expected,
        ),
      ).toEqual({ kind: 'not-found', value: 'not found', thrown, status: 404 });
    }
  });

  it('keeps non-2xx action data while redacting internal failures in production', async () => {
    const validation = await normalizeDataResult(
      Response.json({ field: 'required' }, { status: 422 }),
    );
    expect(validation).toMatchObject({
      kind: 'error',
      data: { field: 'required' },
      thrown: false,
      response: { status: 422 },
    });
    const serverError = await normalizeDataResult(
      Response.json({ secret: 'database password' }, { status: 500 }),
      { production: true },
    );
    const text = await createDataResponse(
      serverError,
      identity,
      expected,
    ).text();
    expect(text).not.toContain('database password');
    const error = await invokeRouteData(() => {
      throw new Error('secret stack');
    }, input());
    expect(error).toMatchObject({
      kind: 'error',
      error: { name: 'Error', message: 'Unexpected Server Error' },
      response: { status: 500, cachePolicy: 'no-store' },
    });
    const development = await invokeRouteData(
      () => {
        throw new Error('developer detail');
      },
      input(),
      { production: false },
    );
    expect(development).toMatchObject({
      kind: 'error',
      error: { message: 'developer detail' },
    });
  });

  it('projects thrown error fields without evaluating own or inherited accessors', async () => {
    for (const inherited of [false, true]) {
      for (const field of ['name', 'message', 'stack']) {
        let reads = 0;
        const error = new Error('developer detail');
        const owner = inherited ? Object.create(Error.prototype) : error;
        if (inherited) {
          Reflect.deleteProperty(error, field);
          Object.setPrototypeOf(error, owner);
        }
        Object.defineProperty(owner, field, {
          configurable: true,
          get() {
            reads++;
            throw new Error('The error accessor must never execute');
          },
        });
        const outcome = await invokeRouteData(
          () => {
            throw error;
          },
          input(),
          {
            production: false,
          },
        );
        expect(outcome).toMatchObject({
          kind: 'error',
          response: { status: 500 },
        });
        await readDataResponse(
          createDataResponse(outcome, identity, expected),
          expected,
        );
        expect(reads).toBe(0);
      }
    }
  });

  it('keeps safe development error data strings and never reads a lazy stack', () => {
    const error = new TypeError('developer detail');
    expect(publicDataError(error, false)).toMatchObject({
      name: 'TypeError',
      message: 'developer detail',
    });
    Object.defineProperty(error, 'stack', { value: 'explicit safe stack' });
    expect(publicDataError(error, false).stack).toBe('explicit safe stack');
    expect(publicDataError(error, true)).toEqual({
      name: 'Error',
      message: 'Unexpected Server Error',
    });
  });

  it.each([204, 205, 304])(
    'preserves HTTP %s through a body-bearing protocol envelope',
    async status => {
      const outcome = await normalizeDataResult(new Response(null, { status }));
      const response = createDataResponse(outcome, identity, expected);
      expect(response.status).toBe(200);
      expect(await readDataResponse(response, expected)).toEqual({
        kind: 'success',
        value: undefined,
        status,
      });
    },
  );

  it('asks the native router to authorize a route ID and never runs another handler', async () => {
    let calls = 0;
    const request = new Request(
      'https://example.test/products?__loader=secret',
    );
    const response = await handleDataRequest({
      request,
      identity,
      context: {},
      selectRoute(_request, routeId, operation) {
        expect(routeId).toBe('secret');
        expect(operation).toBe('loader');
        return {
          routeId: 'products',
          params: {},
          handler() {
            calls++;
            return 'private';
          },
        };
      },
    });
    expect(response?.status).toBe(403);
    expect(calls).toBe(0);
    expect(
      await handleDataRequest({
        request: new Request('https://example.test/products'),
        identity,
        context: {},
        selectRoute: () => undefined,
      }),
    ).toBeUndefined();
  });

  it('leaves an ordinary POST body untouched when the data transport declines it', async () => {
    const request = new Request('https://example.test/api', {
      method: 'POST',
      body: 'ordinary API body',
    });
    expect(
      await handleDataRequest({
        request,
        identity,
        context: {},
        selectRoute: () => undefined,
      }),
    ).toBeUndefined();
    expect(request.bodyUsed).toBe(false);
    expect(await request.text()).toBe('ordinary API body');
  });

  it('merges repeated cookies and the strictest cache policy using native status', async () => {
    const root = await normalizeDataResult(
      Response.json('root', {
        headers: {
          'set-cookie': 'a=1',
          'cache-control': 'public, max-age=60',
          'x-owner': 'root',
        },
      }),
    );
    const leaf = await normalizeDataResult(
      Response.json('leaf', {
        status: 201,
        headers: {
          'set-cookie': 'b=2',
          'cache-control': 'private',
          'x-owner': 'leaf',
        },
      }),
    );
    const metadata = mergeDataResponseMetadata([root, leaf], {
      status: 404,
      statusText: 'Not Found',
    });
    expect(metadata.status).toBe(404);
    expect(metadata.statusText).toBe('Not Found');
    expect(metadata.headers.filter(([name]) => name === 'set-cookie')).toEqual([
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
    ]);
    expect(metadata.headers.find(([name]) => name === 'x-owner')).toEqual([
      'x-owner',
      'leaf',
    ]);
    expect(metadata.cachePolicy).toBe('no-store');
  });

  it.each([
    {
      root: 'Cookie',
      leaf: 'Accept-Language',
      vary: 'Cookie, Accept-Language',
      cacheMode: 'public',
    },
    {
      root: ' Cookie , Accept-Encoding, Cookie ',
      leaf: 'cookie, Accept-Language, ACCEPT-ENCODING',
      vary: 'Cookie, Accept-Encoding, Accept-Language',
      cacheMode: 'public',
    },
    {
      root: '*',
      leaf: 'Accept-Language',
      vary: '*, Accept-Language',
      cacheMode: 'no-store',
    },
    {
      root: 'Cookie',
      leaf: '*, cookie, *',
      vary: 'Cookie, *',
      cacheMode: 'no-store',
    },
  ])(
    'unions matched loader Vary fields without losing privacy: $vary',
    ({ root, leaf, vary, cacheMode }) => {
      const outcomes = [root, leaf].map(
        (value, index) =>
          ({
            kind: 'success',
            value: index,
            response: {
              status: 200,
              statusText: '',
              headers: [
                [index === 0 ? 'Vary' : 'vArY', value],
                ['cache-control', 'public, max-age=60'],
              ],
              cachePolicy: 'public',
            },
          }) satisfies DataOutcome,
      );
      const metadata = mergeDataResponseMetadata(outcomes, { status: 200 });
      expect(new Headers(metadata.headers).get('vary')).toBe(vary);
      const policy = dataMetadataToDocumentPolicy(metadata);
      expect(
        new Headers(policy.headers.map(([name, value]) => [name, value])).get(
          'vary',
        ),
      ).toBe(vary);
      expect(policy.cache.mode).toBe(cacheMode);
    },
  );

  it('keeps every nested loader Content-Security-Policy and Server-Timing', async () => {
    const outcome = (csp: string, reportOnly: string, timing: string) =>
      normalizeDataResult(
        Response.json(
          { value: true },
          {
            headers: {
              'content-security-policy': csp,
              'content-security-policy-report-only': reportOnly,
              'server-timing': timing,
              link: `</${timing.split(';')[0]}.css>; rel=preload; as=style`,
            },
          },
        ),
      );
    const merged = mergeDataResponseMetadata(
      [
        await outcome("default-src 'self'", "img-src 'self'", 'layout;dur=3'),
        await outcome("script-src 'self'", "style-src 'self'", 'page;dur=5'),
      ],
      { status: 200 },
    );
    const headers = new Headers(merged.headers);
    expect(headers.get('content-security-policy')).toBe(
      "default-src 'self', script-src 'self'",
    );
    expect(headers.get('content-security-policy-report-only')).toBe(
      "img-src 'self', style-src 'self'",
    );
    expect(headers.get('server-timing')).toBe('layout;dur=3, page;dur=5');
    expect(headers.get('link')).toBe(
      '</layout.css>; rel=preload; as=style, </page.css>; rel=preload; as=style',
    );
  });

  it('projects loader metadata to HTML without data representation headers', async () => {
    const value = await normalizeDataResult(
      Response.json(
        { value: true },
        {
          headers: {
            'content-length': '99',
            'content-encoding': 'gzip',
            'Content-Digest': 'sha-256=:bG9hZGVyLWJvZHk=:',
            'rEpR-DiGeSt': 'sha-256=:bG9hZGVyLXJlcHJlc2VudGF0aW9u=:',
            DIGEST: 'sha-256=bG9hZGVyLWJvZHk=',
            etag: 'data-etag',
            'last-modified': 'yesterday',
            'content-range': 'bytes 1-2/3',
            'content-disposition': 'attachment',
            'content-location': '/data.json',
            'content-language': 'cs',
            'cache-control': 'public, max-age=60, s-maxage=120',
            'x-owner': 'route',
            'content-security-policy': "default-src 'self'",
          },
        },
      ),
    );
    const policy = dataMetadataToDocumentPolicy(
      mergeDataResponseMetadata([value], { status: 200 }),
    );
    const headers = new Headers(
      policy.headers.map(([name, header]) => [name, header]),
    );
    expect(headers.get('content-type')).toBe('text/html; charset=utf-8');
    for (const name of [
      'content-length',
      'content-encoding',
      'content-digest',
      'repr-digest',
      'digest',
      'etag',
      'last-modified',
      'content-range',
      'content-disposition',
      'content-location',
      'content-language',
    ])
      expect(headers.has(name)).toBe(false);
    expect(headers.get('x-owner')).toBe('route');
    expect(headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(headers.get('cache-control')).toBe('public, max-age=60');
    expect(policy.cache).toEqual({ mode: 'public', maxAgeSeconds: 60 });
    const unsafe = dataMetadataToDocumentPolicy({
      ...value.response,
      headers: [
        ...value.response.headers,
        ['set-cookie', 'a=1'],
        ['set-cookie', 'b=2'],
      ],
    });
    expect(unsafe.cache).toEqual({ mode: 'no-store' });
    expect(unsafe.headers.filter(([name]) => name === 'set-cookie')).toEqual([
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
    ]);
  });

  it('preserves native terminal response ownership while merging layout cookies', async () => {
    const headers = new Headers({
      location: '/next',
      'content-type': 'text/plain',
      'x-native': 'native',
      'Content-Digest': 'sha-256=:bmF0aXZlLWJvZHk=:',
      'Repr-Digest': 'sha-256=:bmF0aXZlLXJlcHJlc2VudGF0aW9u=:',
      Digest: 'sha-256=bmF0aXZlLWJvZHk=',
    });
    headers.append('set-cookie', 'child=1');
    headers.append('set-cookie', 'native=2');
    const native = new Response('native redirect body', {
      status: 303,
      headers,
    });
    const root = await normalizeDataResult(
      Response.json(
        {},
        {
          headers: {
            'set-cookie': 'layout=1',
            'x-layout': 'layout',
            'Content-Digest': 'sha-256=:bGF5b3V0LWJvZHk=:',
            'Repr-Digest': 'sha-256=:bGF5b3V0LXJlcHJlc2VudGF0aW9u=:',
            Digest: 'sha-256=bGF5b3V0LWJvZHk=',
          },
        },
      ),
    );
    const child = await normalizeDataResult(
      new Response(null, {
        status: 303,
        headers: { location: '/next', 'set-cookie': 'child=1' },
      }),
    );
    const response = mergeDataResponseIntoResponse(
      native,
      mergeDataResponseMetadata([root, child], { status: 303 }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/next');
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(response.headers.get('x-native')).toBe('native');
    expect(response.headers.get('x-layout')).toBe('layout');
    expect(response.headers.get('content-digest')).toBe(
      'sha-256=:bmF0aXZlLWJvZHk=:',
    );
    expect(response.headers.get('repr-digest')).toBe(
      'sha-256=:bmF0aXZlLXJlcHJlc2VudGF0aW9u=:',
    );
    expect(response.headers.get('digest')).toBe('sha-256=bmF0aXZlLWJvZHk=');
    expect(response.headers.getSetCookie()).toEqual([
      'layout=1',
      'child=1',
      'native=2',
    ]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('native redirect body');
  });

  it.each([
    ['x-public, max-age=60', 'no-store'],
    ['foo="public", max-age=60', 'no-store'],
    ['public, max-age=60', 'public'],
    ['Public, x-no-cache, max-age=60', 'public'],
    ['no-cache="set-cookie, x-a", public, max-age=60', 'no-store'],
  ])(
    'classifies Cache-Control %s by exact directive',
    async (cacheControl, policy) => {
      const outcome = await normalizeDataResult(
        new Response(null, { headers: { 'cache-control': cacheControl } }),
      );
      expect(outcome.response.cachePolicy).toBe(policy);
    },
  );

  it.each([
    'foo="x,public,max-age=3600',
    'public, max-age=3600 junk',
    'public; max-age=3600',
  ])('fails closed on malformed Cache-Control %s', async cacheControl => {
    const outcome = await normalizeDataResult(
      Response.json({}, { headers: { 'cache-control': cacheControl } }),
    );
    expect(outcome.response.cachePolicy).toBe('no-store');
    expect(
      dataMetadataToDocumentPolicy(
        mergeDataResponseMetadata([outcome], { status: 200 }),
      ).cache,
    ).toEqual({ mode: 'no-store' });
  });

  it('lets primary singleton fields win while list fields keep both sources', () => {
    expect(
      mergeHeaderFields(
        [
          ['Cross-Origin-Opener-Policy', 'same-origin'],
          ['vary', 'Cookie'],
          ['link', '</a.css>; rel=preload'],
        ],
        [
          ['cross-origin-opener-policy', 'unsafe-none'],
          ['vary', 'Accept-Language'],
          ['link', '</b.css>; rel=preload'],
          ['x-loader', '1'],
        ],
      ),
    ).toEqual([
      ['Cross-Origin-Opener-Policy', 'same-origin'],
      ['vary', 'Cookie'],
      ['link', '</a.css>; rel=preload'],
      ['vary', 'Accept-Language'],
      ['link', '</b.css>; rel=preload'],
      ['x-loader', '1'],
    ]);
  });

  it('ignores lifetimes inside quoted Cache-Control extension values', async () => {
    const outcome = await normalizeDataResult(
      Response.json(
        {},
        { headers: { 'cache-control': 'public, foo="x,max-age=3600,y"' } },
      ),
    );
    expect(
      dataMetadataToDocumentPolicy(
        mergeDataResponseMetadata([outcome], { status: 200 }),
      ).cache,
    ).toEqual({ mode: 'no-store' });
    const quoted = await normalizeDataResult(
      Response.json(
        {},
        {
          headers: {
            'cache-control': 'public, foo="x,max-age=3600,y", max-age=60',
          },
        },
      ),
    );
    expect(
      dataMetadataToDocumentPolicy(
        mergeDataResponseMetadata([quoted], { status: 200 }),
      ).cache,
    ).toEqual({ mode: 'public', maxAgeSeconds: 60 });
  });

  it('drops hop-by-hop and Connection-named loader fields', async () => {
    const outcome = await normalizeDataResult(
      Response.json(
        { value: true },
        {
          headers: {
            connection: 'close, x-hop',
            'keep-alive': 'timeout=5',
            trailer: 'x-checksum',
            upgrade: 'websocket',
            'x-hop': '1',
            'x-owner': 'route',
          },
        },
      ),
    );
    const document = new Headers(
      dataMetadataToDocumentPolicy(
        mergeDataResponseMetadata([outcome], { status: 200 }),
      ).headers.map(([name, value]) => [name, value]),
    );
    const envelope = createDataResponse(outcome, identity, expected).headers;
    for (const headers of [document, envelope]) {
      for (const name of [
        'connection',
        'keep-alive',
        'trailer',
        'upgrade',
        'x-hop',
      ])
        expect(headers.has(name), name).toBe(false);
      expect(headers.get('x-owner')).toBe('route');
    }
  });

  it('accumulates CSP, Server-Timing and Vary into a terminal response', async () => {
    const native = new Response('native error', {
      status: 500,
      headers: {
        'content-security-policy': "default-src 'self'",
        'server-timing': 'render;dur=2',
        vary: 'Cookie',
      },
    });
    const loader = await normalizeDataResult(
      new Response(null, {
        headers: {
          'content-security-policy': "script-src 'self'",
          'server-timing': 'loader;dur=4',
          vary: 'Accept-Language, cookie',
        },
      }),
    );
    const response = mergeDataResponseIntoResponse(
      native,
      mergeDataResponseMetadata([loader], { status: 500 }),
    );
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'self', script-src 'self'",
    );
    expect(response.headers.get('server-timing')).toBe(
      'render;dur=2, loader;dur=4',
    );
    expect(response.headers.get('vary')).toBe('Cookie, Accept-Language');
  });

  it('uses the shortest public lifetime and rejects malformed cache ages', async () => {
    const outcomes = await Promise.all(
      [60, 3600].map(maxAge =>
        normalizeDataResult(
          Response.json(
            {},
            { headers: { 'cache-control': `public, max-age=${maxAge}` } },
          ),
        ),
      ),
    );
    const metadata = mergeDataResponseMetadata(outcomes, { status: 200 });
    expect(dataMetadataToDocumentPolicy(metadata).cache).toEqual({
      mode: 'public',
      maxAgeSeconds: 60,
    });
    for (const cacheControl of [
      'public, max-age=wrong',
      'public, max-age=60, s-maxage=wrong',
      'public, max-age=60, max-age=120',
      'public, s-maxage=3600',
    ]) {
      const invalid = await normalizeDataResult(
        Response.json({}, { headers: { 'cache-control': cacheControl } }),
      );
      expect(dataMetadataToDocumentPolicy(invalid.response).cache).toEqual({
        mode: 'no-store',
      });
    }
  });

  it.each([
    ['private, max-age=5', 'private, max-age=3600', 5],
    ['private, max-age=3600', 'private, max-age=5', 5],
    ['public, max-age=3', 'private, max-age=5', 3],
    ['private, max-age=5', 'public, max-age=3600', 5],
    ['private, max-age=5, s-maxage=1', 'private, max-age=3600', 1],
    ['private', 'private, max-age=3600', 0],
    ['private, max-age=wrong', 'private, max-age=3600', 0],
    ['private, max-age=5, max-age=60', 'private, max-age=3600', 0],
    ['private, max-age=5, max-age', 'private, max-age=3600', 0],
    ['private, max-age=5, s-maxage', 'private, max-age=3600', 0],
    ['private, max-age, s-maxage=3600', 'private, max-age=5', 0],
    ['private, s-maxage=3600', 'private, max-age=5', 0],
    ['public, s-maxage=3600', 'private, max-age=5', 0],
  ] satisfies [string, string, number][])(
    'bounds private loader freshness from %s and %s to %s seconds',
    async (root, leaf, maxAge) => {
      const outcomes = await Promise.all(
        [root, leaf].map(cacheControl =>
          normalizeDataResult(
            Response.json({}, { headers: { 'cache-control': cacheControl } }),
          ),
        ),
      );
      const metadata = mergeDataResponseMetadata(outcomes, { status: 200 });
      expect(metadata.cachePolicy).toBe('private');
      expect(new Headers(metadata.headers).get('cache-control')).toBe(
        `private, max-age=${maxAge}, must-revalidate`,
      );
      expect(dataMetadataToDocumentPolicy(metadata).cache).toEqual({
        mode: 'private',
      });
    },
  );

  it.each(['no-store', 'no-cache'])(
    'keeps %s stricter than bounded private loader freshness',
    async cacheControl => {
      const outcomes = await Promise.all(
        ['private, max-age=5', cacheControl].map(control =>
          normalizeDataResult(
            Response.json({}, { headers: { 'cache-control': control } }),
          ),
        ),
      );
      const metadata = mergeDataResponseMetadata(outcomes, { status: 200 });
      expect(metadata.cachePolicy).toBe('no-store');
      expect(new Headers(metadata.headers).get('cache-control')).toBe(
        'no-store',
      );
    },
  );

  it.each([200, 206, 304])(
    'removes replaced representation metadata from a data envelope for HTTP %s',
    async status => {
      const headers = new Headers({
        'content-type': 'application/json',
        'content-length': '99',
        'content-encoding': 'gzip',
        'transfer-encoding': 'chunked',
        'content-range': 'bytes 1-2/3',
        'accept-ranges': 'bytes',
        'content-disposition': 'attachment; filename="data.json"',
        'content-location': '/data.json',
        'content-language': 'cs',
        'Content-Digest': 'sha-256=:bG9hZGVyLWJvZHk=:',
        'rEpR-DiGeSt': 'sha-256=:bG9hZGVyLXJlcHJlc2VudGF0aW9u=:',
        DIGEST: 'sha-256=bG9hZGVyLWJvZHk=',
        etag: 'original-etag',
        'last-modified': 'Wed, 07 Oct 2026 09:00:00 GMT',
        location: '/original',
        'cache-control': 'private, max-age=5',
        'x-owner': 'route',
        'content-security-policy': "default-src 'self'",
      });
      headers.append('set-cookie', 'session=1; HttpOnly');
      headers.append('set-cookie', 'csrf=2; Secure');
      const outcome = await normalizeDataResult(
        new Response(status === 304 ? null : '{"value":true}', {
          status,
          headers,
        }),
      );
      const response = createDataResponse(outcome, identity, expected);
      expect(response.status).toBe(200);
      for (const name of [
        'content-length',
        'content-encoding',
        'transfer-encoding',
        'content-range',
        'accept-ranges',
        'content-disposition',
        'content-location',
        'content-language',
        'content-digest',
        'repr-digest',
        'digest',
        'etag',
        'last-modified',
        'location',
      ])
        expect(response.headers.has(name), name).toBe(false);
      expect(response.headers.get('content-type')).toBe(
        'application/vnd.ultramodern.data+json; charset=utf-8',
      );
      expect(response.headers.get('x-owner')).toBe('route');
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'self'",
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.getSetCookie()).toEqual([
        'session=1; HttpOnly',
        'csrf=2; Secure',
      ]);
      expect(await readDataResponse(response, expected)).toEqual({
        kind: 'success',
        value: status === 304 ? undefined : { value: true },
        status,
      });
    },
  );

  it('bounds actual response body bytes and cancels oversized producers', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(normalizeDataResult(new Response(body))).rejects.toThrow(
      /byte limit/,
    );
    expect(cancelled).toBe(true);
    await expect(
      readDataResponse(
        new Response('x'.repeat(1024 * 1024 + 1), {
          headers: { 'content-type': 'application/vnd.ultramodern.data+json' },
        }),
        expected,
      ),
    ).rejects.toThrow(/byte limit/);
  });

  it('cancels a pending ordinary data body read when its request aborts', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const pending = readDataResponse(
      new Response(body, {
        headers: { 'content-type': 'application/vnd.ultramodern.data+json' },
      }),
      expected,
      controller.signal,
    );
    controller.abort(new Error('ordinary reader closed'));
    await expect(pending).rejects.toThrow('ordinary reader closed');
    expect(cancelled).toBe(true);
  });

  it('cancels a pending loader Response body read with the same request signal', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const args = {
      ...input(),
      request: new Request('https://example.test/products', {
        signal: controller.signal,
      }),
    };
    const pending = invokeRouteData(() => new Response(body), args);
    await Promise.resolve();
    controller.abort(new Error('loader reader closed'));
    await expect(pending).rejects.toThrow('loader reader closed');
    expect(cancelled).toBe(true);
  });

  it('passes only request-owned context and native params to loader/action work', async () => {
    const context = { secret: 'private-cookie' };
    let received: unknown;
    const response = await handleDataRequest({
      request: new Request('https://example.test/products?__loader=products', {
        method: 'POST',
        body: 'payload',
        headers: { 'content-type': 'text/plain' },
      }),
      identity,
      context,
      selectRoute(_request, _routeId, operation) {
        expect(operation).toBe('action');
        return {
          routeId: 'products',
          params: { id: 'a/b' },
          async handler(args) {
            received = args.context;
            expect(args.params).toEqual({ id: 'a/b' });
            return { value: await args.request.text() };
          },
        };
      },
    });
    expect(received).toBe(context);
    const text = await response!.clone().text();
    expect(text).not.toContain('private-cookie');
    expect(
      await readDataResponse(response!, { ...expected, operation: 'action' }),
    ).toEqual({ kind: 'success', value: { value: 'payload' }, status: 200 });
  });

  it('propagates abort before invocation and while native work is pending', async () => {
    const controller = new AbortController();
    const args = {
      ...input(),
      request: new Request('https://example.test/products', {
        signal: controller.signal,
      }),
    };
    let entered = false;
    const promise = invokeRouteData(async ({ request }) => {
      entered = true;
      await new Promise<void>((_resolve, reject) =>
        request.signal.addEventListener(
          'abort',
          () => reject(request.signal.reason),
          { once: true },
        ),
      );
      return 'never';
    }, args);
    expect(entered).toBe(true);
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(promise).rejects.toThrow('cancelled');
    let calls = 0;
    await expect(
      invokeRouteData(() => {
        calls++;
      }, args),
    ).rejects.toThrow('cancelled');
    expect(calls).toBe(0);
  });

  it('rejects data identity and schema mismatches before exposing a value', async () => {
    const outcome = await normalizeDataResult('value');
    await expect(
      readDataResponse(
        createDataResponse(
          outcome,
          { ...identity, buildId: 'other' },
          expected,
        ),
        expected,
      ),
    ).rejects.toThrow(/identity mismatch/);
    await expect(
      readDataResponse(
        createDataResponse(outcome, identity, {
          ...expected,
          routeId: 'other',
        }),
        expected,
      ),
    ).rejects.toThrow(/route identity mismatch/);
    const envelope = parsePublicData(
      await createDataResponse(outcome, identity, expected).text(),
    ) as Record<string, unknown>;
    envelope.version = 2;
    await expect(
      readDataResponse(
        new Response(serializePublicData(envelope), {
          headers: { 'content-type': 'application/vnd.ultramodern.data+json' },
        }),
        expected,
      ),
    ).rejects.toThrow(/protocol/);
    expect(DATA_CODEC).toBe('seroval-json@1.6.8');
  });
});

describe('deferred data stream', () => {
  it.each([204, 205, 304])(
    'rejects deferred HTTP %s before creating a stream',
    async status => {
      await expect(
        normalizeDataResult(deferData({ critical: true }, {}, { status })),
      ).rejects.toThrow(
        'Deferred data must have a successful body-bearing response status',
      );
    },
  );

  it('validates and snapshots critical data before a response can commit headers', async () => {
    const critical = { value: 'original' };
    const outcome = await normalizeDataResult(deferData(critical, {}));
    const response = createDataResponse(outcome, identity, expected);
    critical.value = 'changed after response';
    expect(success(await readDataResponse(response, expected))).toEqual({
      value: 'original',
    });
    const unsupported = await normalizeDataResult(
      deferData({ huge: 10n ** 10000n }, {}),
    );
    expect(() => createDataResponse(unsupported, identity, expected)).toThrow(
      /codec limits/,
    );
  });

  it('delivers critical data before unresolved work, then resolves rich values', async () => {
    const late = deferred<unknown>();
    const outcome = await normalizeDataResult(
      deferData({ critical: 'shell' }, { late: late.promise }),
    );
    const response = createDataResponse(outcome, identity, expected);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const decoded = await readDataResponse(response, expected);
    const value = success(decoded) as {
      critical: string;
      late: Promise<unknown>;
    };
    expect(value.critical).toBe('shell');
    let settled = false;
    void value.late.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    late.resolve(new Map([['date', new Date('2026-10-02')]]));
    expect(await value.late).toEqual(
      new Map([['date', new Date('2026-10-02')]]),
    );
  });

  it('reports a late error through its promise without changing committed HTTP status', async () => {
    const late = deferred<unknown>();
    const outcome = await normalizeDataResult(
      deferData({ critical: true }, { late: late.promise }, { status: 202 }),
    );
    const response = createDataResponse(outcome, identity, expected);
    const value = success(await readDataResponse(response, expected)) as {
      late: Promise<unknown>;
    };
    late.reject(new Error('private deferred stack'));
    await expect(value.late).rejects.toThrow('Unexpected Server Error');
    expect(response.status).toBe(202);
  });

  it('rejects late HTTP response values rather than changing sent headers', async () => {
    const outcome = await normalizeDataResult(
      deferData(
        {},
        {
          late: Promise.resolve(Response.redirect('https://example.test/next')),
        },
      ),
    );
    const response = createDataResponse(outcome, identity, expected);
    const value = success(await readDataResponse(response, expected)) as {
      late: Promise<unknown>;
    };
    await expect(value.late).rejects.toThrow('Unexpected Server Error');
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('propagates reader cancellation into the request supplied to deferred work', async () => {
    let signal: AbortSignal | undefined;
    const late = deferred<unknown>();
    const response = await handleDataRequest({
      request: new Request('https://example.test/products?__loader=products'),
      identity,
      context: {},
      selectRoute: () => ({
        routeId: 'products',
        params: {},
        handler({ request }) {
          signal = request.signal;
          return deferData({}, { late: late.promise });
        },
      }),
    });
    const reader = response!.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel('client disconnected');
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    late.resolve('cleanup');
  });

  it('contains cancellation callback failures and invokes cleanup only once', async () => {
    for (const asynchronous of [false, true]) {
      let calls = 0;
      const late = deferred<unknown>();
      const outcome = await normalizeDataResult(
        deferData({}, { late: late.promise }),
      );
      const controller = new AbortController();
      const response = createDataResponse(outcome, identity, {
        ...expected,
        signal: controller.signal,
        onCancel() {
          calls++;
          if (asynchronous)
            return Promise.reject(new Error('async owner cancel failed'));
          throw new Error('owner cancel failed');
        },
      });
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel('closed');
      controller.abort('later abort');
      late.resolve('late cleanup');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(calls).toBe(1);
    }
  });

  it('handles frame boundaries split across UTF-8 and script strings', async () => {
    const outcome = await normalizeDataResult(
      deferData({ text: '</script>🚜' }, { late: Promise.resolve('<script>') }),
    );
    const original = createDataResponse(outcome, identity, expected);
    const bytes = new Uint8Array(await original.arrayBuffer());
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const response = new Response(chunks, {
      headers: { 'content-type': DATA_STREAM_CONTENT_TYPE },
    });
    const value = success(await readDataResponse(response, expected)) as {
      text: string;
      late: Promise<string>;
    };
    expect(value.text).toBe('</script>🚜');
    expect(await value.late).toBe('<script>');
  });

  it('rejects truncated and unexpected deferred frames deterministically', async () => {
    const outcome = await normalizeDataResult(
      deferData({}, { late: Promise.resolve(1) }),
    );
    const text = await createDataResponse(outcome, identity, expected).text();
    const first = `${text.split('\n')[0]}\n`;
    const decoded = await readDataResponse(
      new Response(first, {
        headers: { 'content-type': DATA_STREAM_CONTENT_TYPE },
      }),
      expected,
    );
    const value = success(decoded) as { late: Promise<unknown> };
    await expect(value.late).rejects.toThrow(/Truncated/);
    const bad = `${serializePublicData({ type: 'resolve', key: 'late', value: 1 })}\n`;
    await expect(
      readDataResponse(
        new Response(bad, {
          headers: { 'content-type': DATA_STREAM_CONTENT_TYPE },
        }),
        expected,
      ),
    ).rejects.toThrow(/before the initial/);
  });

  it('exposes terminal integrity failure after every deferred value already resolved', async () => {
    const outcome = await normalizeDataResult(
      deferData({}, { late: Promise.resolve(1) }),
    );
    const text = await createDataResponse(outcome, identity, expected).text();
    const lines = text.trimEnd().split('\n');
    for (const malformed of [
      `${lines.slice(0, -1).join('\n')}\n`,
      `${text}${serializePublicData({ type: 'resolve', key: 'late', value: 2 })}\n`,
    ]) {
      const decoded = await readDataResponse(
        new Response(malformed, {
          headers: { 'content-type': DATA_STREAM_CONTENT_TYPE },
        }),
        expected,
      );
      const value = success(decoded) as { late: Promise<unknown> };
      expect(await value.late).toBe(1);
      await expect(decoded.completion).rejects.toThrow(
        /Truncated|follow stream completion/,
      );
    }
    const valid = await readDataResponse(
      new Response(text, {
        headers: { 'content-type': DATA_STREAM_CONTENT_TYPE },
      }),
      expected,
    );
    await expect(valid.completion).resolves.toBeUndefined();
  });

  it('encodes at most one ready large frame while the native consumer is paused', async () => {
    const original = TextEncoder.prototype.encode;
    let largeEncodes = 0;
    TextEncoder.prototype.encode = function (value?: string) {
      if (value && value.length > 500_000) largeEncodes++;
      return original.call(this, value);
    };
    try {
      const ready = Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
          String(index),
          Promise.resolve('x'.repeat(600_000)),
        ]),
      );
      const outcome = await normalizeDataResult(deferData({}, ready));
      const response = createDataResponse(outcome, identity, expected);
      const reader = response.body!.getReader();
      await reader.read();
      for (let index = 0; index < 20; index++) await Promise.resolve();
      // Each frame is encoded once for its byte bound and once for transport.
      expect(largeEncodes).toBeLessThanOrEqual(2);
      await reader.cancel('test finished');
    } finally {
      TextEncoder.prototype.encode = original;
    }
  });
});

describe('client data proxies', () => {
  it('keeps mutation bodies, caller headers, credentials and cancellation', async () => {
    for (const [contentType, body] of [
      ['application/json', '{"value":1}'],
      ['text/plain', 'hello'],
      ['application/x-www-form-urlencoded', 'value=hello+world'],
    ]) {
      const controller = new AbortController();
      const request = new Request(
        'https://example.test/products?q=1&__loader=old',
        {
          method: 'POST',
          headers: { 'content-type': contentType, 'x-csrf-token': 'csrf' },
          body,
          signal: controller.signal,
        },
      );
      const proxy = createDataClient('products', identity, {
        fetch: (async (input, init) => {
          const forwarded = input as Request;
          expect(forwarded.headers.get('x-csrf-token')).toBe('csrf');
          expect(forwarded.headers.get('content-type')).toBe(contentType);
          expect(await forwarded.text()).toBe(body);
          expect(
            new URL(forwarded.url).searchParams.getAll('__loader'),
          ).toEqual(['products']);
          expect(new URL(forwarded.url).searchParams.get('q')).toBe('1');
          expect(init?.credentials).toBe('same-origin');
          expect(init?.redirect).toBe('manual');
          const outcome = await normalizeDataResult(
            Response.json({ field: 'required' }, { status: 422 }),
          );
          return createDataResponse(outcome, identity, {
            ...expected,
            operation: 'action',
          });
        }) as typeof fetch,
      });
      const result = await proxy.action({ request });
      expect(result).toMatchObject({
        kind: 'error',
        data: { field: 'required' },
        status: 422,
      });
    }
  });

  it('does not accept a non-protocol server response or follow a native redirect itself', async () => {
    const proxy = createDataClient('products', identity, {
      fetch: (async () =>
        new Response('Forbidden', { status: 403 })) as typeof fetch,
    });
    await expect(proxy.loader({ request: input().request })).rejects.toThrow(
      /HTTP 403/,
    );
    const redirect = await normalizeDataResult(
      Response.redirect('https://other.test/target', 307),
    );
    const native = createDataClient('products', identity, {
      fetch: (async () =>
        createDataResponse(redirect, identity, expected)) as typeof fetch,
    });
    expect(await native.loader({ request: input().request })).toEqual({
      kind: 'redirect',
      location: 'https://other.test/target',
      status: 307,
    });
  });

  it('preserves multipart file data and a caller abort after Fetch starts', async () => {
    const controller = new AbortController();
    const form = new FormData();
    form.set('name', 'tractor');
    form.set(
      'photo',
      new File([Uint8Array.of(1, 2, 3)], 'tractor.bin', {
        type: 'application/octet-stream',
      }),
    );
    let entered = false;
    const proxy = createDataClient('products', identity, {
      fetch: (async (input, init) => {
        const request = input as Request;
        const sent = await request.formData();
        expect(sent.get('name')).toBe('tractor');
        const file = sent.get('photo') as File;
        expect(file.name).toBe('tractor.bin');
        expect(file.type).toBe('application/octet-stream');
        expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([
          1, 2, 3,
        ]);
        expect(request.headers.get('x-csrf-token')).toBe('csrf');
        entered = true;
        return new Promise<Response>((_resolve, reject) =>
          init!.signal!.addEventListener(
            'abort',
            () => reject(init!.signal!.reason),
            { once: true },
          ),
        );
      }) as typeof fetch,
    });
    const pending = proxy.action({
      request: new Request('https://example.test/products', {
        method: 'POST',
        body: form,
        headers: { 'x-csrf-token': 'csrf' },
        signal: controller.signal,
      }),
    });
    while (!entered) await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort(new DOMException('cancelled form', 'AbortError'));
    await expect(pending).rejects.toThrow('cancelled form');
  });
});
