import { createRequestSession, type ResponsePolicy } from '../../src/session';

function createSession() {
  return createRequestSession({
    request: new Request('https://shop.test/'),
    identity: {
      renderer: 'solid',
      appId: 'shop',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'status-text',
    },
    platform: { kind: 'node', bindings: {} },
  });
}

describe('native response status text', () => {
  test('preserves a copied reason on a bodyless terminal response', async () => {
    const session = createSession();
    const policy = {
      kind: 'terminal',
      status: 204,
      statusText: 'No inventory',
      headers: [],
      cache: { mode: 'no-store' },
    } satisfies ResponsePolicy;
    session.resolveResponse(policy);
    policy.statusText = 'Changed after resolution';
    const response = session.respond(null);

    expect(response.statusText).toBe('No inventory');
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(session.committedPolicy?.statusText).toBe('No inventory');
    expect((await session.completion).state).toBe('completed');
  });

  test('preserves reason text while the session owns streamed delivery', async () => {
    const session = createSession();
    session.resolveResponse({
      kind: 'document',
      status: 200,
      statusText: 'Fresh inventory',
      headers: [['content-type', 'text/html; charset=utf-8']],
      cache: { mode: 'public', maxAgeSeconds: 30 },
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<main>inventory</main>'));
        controller.close();
      },
    });
    const response = session.respond(stream);

    expect(response.statusText).toBe('Fresh inventory');
    expect(session.ownsResponseBody(response)).toBe(true);
    expect(await response.text()).toBe('<main>inventory</main>');
    expect((await session.completion).cacheEligible).toBe(true);
  });

  test.each(['Invalid\r\nreason', 'Invalid\u20ac'])(
    'rejects invalid Fetch reason %j before committing or claiming a stream',
    async statusText => {
      const session = createSession();
      const stream = new ReadableStream<Uint8Array>({}, { highWaterMark: 0 });
      const reader = rstest.spyOn(stream, 'getReader');

      expect(() =>
        session.resolveResponse({
          kind: 'document',
          status: 200,
          statusText,
          headers: [['content-type', 'text/html']],
          cache: { mode: 'no-store' },
        }),
      ).toThrow(TypeError);
      expect(session.state).toBe('matching');
      expect(session.responsePolicy).toBeUndefined();
      expect(session.committedPolicy).toBeUndefined();
      expect(() => session.respond(stream)).toThrow('blocking HTTP outcome');
      expect(reader).not.toHaveBeenCalled();

      session.abort();
      await session.completion;
      await stream.cancel();
    },
  );

  test('keeps the Fetch default when no reason text was supplied', async () => {
    const session = createSession();
    session.resolveResponse({
      kind: 'terminal',
      status: 200,
      headers: [],
      cache: { mode: 'no-store' },
    });

    expect(session.respond(null).statusText).toBe('');
    expect((await session.completion).state).toBe('completed');
  });
});
