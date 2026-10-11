import type { RendererIdentity } from '../../src/identity';
import type { ResponsePolicy } from '../../src/session';
import { createRequestSession, documentCacheKey } from '../../src/session';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'shop',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'build-a',
};
const policy = (overrides: Partial<ResponsePolicy> = {}): ResponsePolicy => ({
  kind: 'document',
  status: 200,
  headers: [['content-type', 'text/html; charset=utf-8']],
  cache: { mode: 'public', maxAgeSeconds: 30 },
  ...overrides,
});
const createSession = (request = new Request('https://shop.test/')) =>
  createRequestSession({
    request,
    identity,
    platform: { kind: 'node', bindings: { locale: 'en' } },
  });
const bytes = (value: string) => new TextEncoder().encode(value);
const body = (value = '<main>native</main>') =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes(value));
      controller.close();
    },
  });

describe('request response and body ownership', () => {
  test('accepts only the final owned response body, including header-only wrappers', async () => {
    const session = createSession();
    expect(session.ownsResponseBody(new Response(null))).toBe(false);
    session.resolveResponse(policy());
    const owned = session.respond(body());
    const withHeaders = new Response(owned.body, { headers: owned.headers });
    expect(session.ownsResponseBody(owned)).toBe(true);
    expect(session.ownsResponseBody(withHeaders)).toBe(true);
    expect(session.ownsResponseBody(new Response(body()))).toBe(false);
    expect(session.ownsResponseBody(new Response(null))).toBe(false);
    expect(await withHeaders.text()).toBe('<main>native</main>');
    expect((await session.completion).state).toBe('completed');
  });

  test('identifies bodyless responses by the original response rather than unrelated null bodies', async () => {
    const session = createSession();
    session.resolveResponse(policy({ kind: 'terminal', status: 204 }));
    const owned = session.respond(null);
    expect(session.ownsResponseBody(owned)).toBe(true);
    expect(session.ownsResponseBody(new Response(null, { status: 204 }))).toBe(
      false,
    );
    expect((await session.completion).state).toBe('completed');
  });

  test('resolves the blocking HTTP outcome before rendering and freezes the committed policy', async () => {
    const session = createSession();
    expect(() => session.startRendering()).toThrow('blocking HTTP outcome');
    expect(() => session.respond(null)).toThrow('blocking HTTP outcome');
    const headers: [string, string][] = [['content-type', 'text/html']];
    session.resolveResponse(policy({ headers }));
    headers[0][1] = 'application/json';
    session.startRendering();
    const response = session.respond(body());
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(session.state).toBe('committed');
    expect(() => session.resolveResponse(policy({ status: 302 }))).toThrow(
      'already committed',
    );
    expect(() => session.respond(body())).toThrow('exactly one');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<main>native</main>');
    expect((await session.completion).cacheEligible).toBe(true);
  });

  test('preserves terminal outcomes and repeated cookies without forcing HTML', async () => {
    const session = createSession();
    session.resolveResponse(
      policy({
        kind: 'terminal',
        status: 302,
        headers: [
          ['location', '/sign-in'],
          ['set-cookie', 'a=1'],
          ['set-cookie', 'b=2'],
        ],
        cache: { mode: 'no-store' },
      }),
    );
    const response = session.respond(null);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/sign-in');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(response.headers.has('content-type')).toBe(false);
    expect((await session.completion).cacheEligible).toBe(false);
  });

  test('keeps request resources until the single stream consumer reaches EOF', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          source = controller;
        },
        pull() {
          pulls += 1;
        },
      },
      { highWaterMark: 0 },
    );
    const cleanup = rstest.fn();
    const session = createSession();
    session.registerCleanup(cleanup);
    session.resolveResponse(policy());
    const response = session.respond(stream);
    await Promise.resolve();
    expect(pulls).toBe(0);
    expect(cleanup).not.toHaveBeenCalled();
    const consumer = response.body!.getReader();
    const shell = consumer.read();
    source.enqueue(bytes('<main>shell'));
    expect((await shell).done).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    source.close();
    expect((await consumer.read()).done).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect((await session.completion).state).toBe('completed');
    expect(stream.locked).toBe(false);
  });

  test('cancels the native source and disposes exactly once when the consumer cancels', async () => {
    const cancel = rstest.fn();
    const cleanup = rstest.fn();
    const session = createSession();
    session.registerCleanup(cleanup);
    session.registerCleanup(cleanup);
    session.resolveResponse(policy());
    const stream = new ReadableStream<Uint8Array>(
      { cancel },
      { highWaterMark: 0 },
    );
    const response = session.respond(stream);
    await response.body!.cancel('navigation');
    session.abort('second abort');
    await session.completion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('navigation');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(session.signal.aborted).toBe(true);
    expect((await session.completion).state).toBe('aborted');
    expect(stream.locked).toBe(false);
  });

  test('propagates request abort after headers commit while a stream read is pending', async () => {
    const controller = new AbortController();
    const session = createSession(
      new Request('https://shop.test/', { signal: controller.signal }),
    );
    const cleanup = rstest.fn();
    const cancel = rstest.fn();
    session.registerCleanup(cleanup);
    session.resolveResponse(policy());
    const response = session.respond(
      new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }),
    );
    const reading = response.text();
    const reason = new Error('connection closed');
    controller.abort(reason);
    await expect(reading).rejects.toBe(reason);
    expect(session.signal.reason).toBe(reason);
    expect(response.status).toBe(200);
    expect((await session.completion).cacheEligible).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('settles consumer cancellation after asynchronous request cleanup completes', async () => {
    let releaseCleanup!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseCleanup = resolve;
    });
    const session = createSession();
    session.registerCleanup(() => gate);
    session.resolveResponse(policy());
    const response = session.respond(
      new ReadableStream<Uint8Array>({}, { highWaterMark: 0 }),
    );
    let cancelled = false;
    const cancelling = response.body!.cancel('navigation').then(() => {
      cancelled = true;
    });
    await Promise.resolve();
    expect(cancelled).toBe(false);
    releaseCleanup();
    await cancelling;
    expect((await session.completion).state).toBe('aborted');
  });

  test('starts cleanup while native cancellation waits for renderer disposal', async () => {
    let releaseCancellation!: () => void;
    const cancellation = new Promise<void>(resolve => {
      releaseCancellation = resolve;
    });
    const session = createSession();
    const cleanup = rstest.fn(() => {
      releaseCancellation();
    });
    session.registerCleanup(cleanup);
    session.resolveResponse(policy());
    session.respond(
      new ReadableStream<Uint8Array>(
        {
          cancel() {
            return cancellation;
          },
        },
        { highWaterMark: 0 },
      ),
    );
    session.abort('connection closed');
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect((await session.completion).state).toBe('aborted');
  });

  test('suppresses cache admission for a deferred failure without mutating sent status', async () => {
    const session = createSession();
    session.resolveResponse(policy());
    const response = session.respond(
      new ReadableStream<Uint8Array>({}, { highWaterMark: 0 }),
    );
    const reading = response.text();
    const error = new Error('deferred route failed');
    session.fail(error);
    const completion = await session.completion;
    await expect(reading).rejects.toBe(error);
    expect(completion.state).toBe('failed');
    expect(completion.error).toBe(error);
    expect(completion.cacheEligible).toBe(false);
    expect(response.status).toBe(200);
    expect(session.committedPolicy?.status).toBe(200);
  });

  test('completes without waiting on a response stream that never finishes cancelling', async () => {
    const session = createSession();
    session.resolveResponse(policy());
    let cancelled = false;
    const response = session.respond(
      new ReadableStream<Uint8Array>(
        {
          cancel() {
            cancelled = true;
            return new Promise<void>(() => {});
          },
        },
        { highWaterMark: 0 },
      ),
    );
    const reading = response.text();
    session.abort(new Error('client went away'));
    const completion = await session.completion;
    expect(completion.state).toBe('aborted');
    expect(cancelled).toBe(true);
    await expect(reading).rejects.toThrow('client went away');
  });

  test('attempts every disposer in reverse order after a pre-shell failure', async () => {
    const session = createSession();
    const calls: string[] = [];
    session.registerCleanup(() => {
      calls.push('router');
    });
    session.registerCleanup(() => {
      calls.push('renderer');
      throw new Error('dispose failed');
    });
    const error = new Error('no shell');
    session.fail(error);
    const result = await session.completion;
    expect(calls).toEqual(['renderer', 'router']);
    expect(result.cleanupErrors).toHaveLength(1);
    expect(result.error).toBe(error);
    expect(result.cacheEligible).toBe(false);
    expect(() => session.registerCleanup(() => {})).toThrow('terminates');
    expect(() => session.respond(null)).toThrow('exactly one');
    session.fail(new Error('again'));
    expect(await session.completion).toBe(result);
  });

  test('stream errors dispose native resources and never complete successfully', async () => {
    const cleanup = rstest.fn();
    const session = createSession();
    session.registerCleanup(cleanup);
    session.resolveResponse(policy());
    const error = new Error('native stream failed');
    const response = session.respond(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(error);
        },
      }),
    );
    await expect(response.text()).rejects.toBe(error);
    const result = await session.completion;
    expect(result.state).toBe('failed');
    expect(result.cacheEligible).toBe(false);
    expect(session.signal.aborted).toBe(true);
    expect(session.signal.reason).toBe(error);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('keeps the first terminal outcome during a reentrant native abort listener', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    session.signal.addEventListener('abort', () => {
      void session.fail(new Error('native abort listener'));
    });
    const reason = new Error('client disconnected');
    session.abort(reason);
    const completion = await session.completion;
    expect(completion.state).toBe('aborted');
    expect(completion.error).toBe(reason);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('allows native cleanup to return a reentrant abort notification', async () => {
    const session = createSession();
    session.registerCleanup(() => session.abort('cleanup notification'));
    session.abort('client disconnected');
    expect((await session.completion).state).toBe('aborted');
  });

  test('allows native stream cancellation to return a reentrant abort notification', async () => {
    const session = createSession();
    session.resolveResponse(policy());
    session.respond(
      new ReadableStream<Uint8Array>(
        {
          cancel() {
            return session.abort('native cancel notification');
          },
        },
        { highWaterMark: 0 },
      ),
    );
    session.abort('client disconnected');
    expect((await session.completion).state).toBe('aborted');
  });

  test('cleanup failure cannot admit an otherwise successful stream to cache', async () => {
    const session = createSession();
    const laterCleanup = rstest.fn();
    session.registerCleanup(laterCleanup);
    session.registerCleanup(() => {
      throw new Error('owner disposal failed');
    });
    session.resolveResponse(policy());
    await expect(session.respond(body()).text()).rejects.toThrow(
      'cleanup failed',
    );
    expect(laterCleanup).toHaveBeenCalledTimes(1);
    expect((await session.completion).state).toBe('failed');
    expect((await session.completion).cacheEligible).toBe(false);
  });

  test('explicit fallback remains ineligible after a successful document stream', async () => {
    const session = createSession();
    session.resolveResponse(policy());
    session.markFallback();
    await session.respond(body()).text();
    expect((await session.completion).fallback).toBe(true);
    expect((await session.completion).cacheEligible).toBe(false);
  });

  test('rejects invalid response metadata before committing headers', () => {
    const session = createSession();
    expect(() => session.resolveResponse(policy({ status: 199 }))).toThrow(
      '200 to 599',
    );
    expect(() =>
      session.resolveResponse(policy({ headers: [['bad\nheader', 'x']] })),
    ).toThrow();
    expect(session.state).toBe('matching');
    session.resolveResponse(policy({ status: 204 }));
    expect(() => session.respond(body())).toThrow('cannot contain');
    expect(session.state).toBe('ready');
  });
});

describe('document cache isolation', () => {
  test('does not cache bodyless documents whose middleware can still add cookies', async () => {
    const session = createSession();
    session.resolveResponse(policy());
    const response = session.respond(null);
    const completion = await session.completion;
    response.headers.append('set-cookie', 'session=secret');
    expect(completion.cacheEligible).toBe(false);
  });
  test.each([
    ['set-cookie', 'token=secret'],
    ['cache-control', 'private'],
  ])(
    'uses final middleware headers for cache admission: %s',
    async (name, value) => {
      const session = createSession();
      session.resolveResponse(policy());
      const response = session.respond(body());
      response.headers.append(name, value);
      await response.text();
      expect((await session.completion).cacheEligible).toBe(false);
    },
  );

  test('namespaces every immutable identity field before a custom request key', () => {
    const identities = [
      identity,
      { ...identity, renderer: 'octane' as const },
      { ...identity, appId: 'other' },
      { ...identity, entryName: 'admin' },
      { ...identity, buildId: 'build-b' },
    ];
    const keys = identities.map(value =>
      documentCacheKey(value, '/account?x=1'),
    );
    expect(new Set(keys).size).toBe(identities.length);
    expect(documentCacheKey(identity, 'a:b')).not.toBe(
      documentCacheKey(identity, 'ab'),
    );
    expect(() => documentCacheKey(identity, '')).toThrow('nonempty');
    expect(() => documentCacheKey({ ...identity, appId: '' }, '/')).toThrow();
  });

  test.each([
    { cache: { mode: 'private' as const } },
    {
      headers: [
        ['content-type', 'text/html'],
        ['set-cookie', 'token=secret'],
      ],
    },
    {
      headers: [
        ['content-type', 'text/html'],
        ['cache-control', 'public, no-store'],
      ],
    },
    {
      headers: [
        ['content-type', 'text/html'],
        ['cache-control', 'private="set-cookie"'],
      ],
    },
    {
      headers: [
        ['content-type', 'text/html'],
        ['vary', '*'],
      ],
    },
    { headers: [['content-type', 'application/json']] },
    { status: 404 },
    { kind: 'terminal' as const },
  ])(
    'keeps private, terminal and non-document responses out of the shared cache: %j',
    async overrides => {
      const session = createSession();
      session.resolveResponse(policy(overrides as Partial<ResponsePolicy>));
      await session.respond(body()).text();
      expect((await session.completion).cacheEligible).toBe(false);
    },
  );
});
