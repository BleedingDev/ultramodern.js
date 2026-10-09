import { Buffer } from 'node:buffer';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  createRequestSession,
  type ResponsePolicy,
} from '@modern-js/renderer-core/session';
import {
  createElement,
  earlySignalBootstrapScript,
  lazy,
  Suspense,
  ssrHeadEl,
  ssrHtml,
} from 'octane/server';
import {
  renderOctaneApplication,
  renderOctaneCSRDocument,
} from '../src/server';

const identity: RendererIdentity = {
  renderer: 'octane',
  appId: 'store',
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
const createSession = (request = new Request('https://store.test/')) =>
  createRequestSession({
    request,
    identity,
    platform: { kind: 'node', bindings: {} },
  });
const document = {
  documentId: 'document-a',
  nativeHydrationBuildId: 'native-client-build-b',
};
const decode = (value: Uint8Array | undefined) =>
  new TextDecoder().decode(value);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function streamedApp() {
  const pending = deferred<{ default: () => string }>();
  const Late = lazy(() => pending.promise);
  const App = () =>
    createElement(
      'main',
      null,
      createElement('p', null, 'EARLY'),
      createElement(
        Suspense,
        { fallback: createElement('i', null, 'WAIT') },
        createElement(Late),
      ),
    );
  return { App, pending };
}

describe('native Octane server application', () => {
  test('delivers an empty CSR root with explicit mount identity and nonce-safe assets', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const response = await renderOctaneCSRDocument({
      session,
      document: {
        ...document,
        documentId: 'csr-document',
        rootId: 'application',
        lang: 'cs',
        nonce: 'csr-nonce',
        assets: [
          { kind: 'stylesheet', href: '/main.css' },
          { kind: 'script', href: '/app.js' },
        ],
      },
    });
    expect(session.state).toBe('committed');
    expect(cleanup).not.toHaveBeenCalled();
    const html = await response.text();
    expect(html).toContain('<html lang="cs">');
    expect(html).toContain('<div id="application"></div>');
    expect(html).toContain('"documentId":"csr-document"');
    expect(html).toContain('"hydrating":false');
    expect(html).toContain('"nativeHydrationBuildId":"native-client-build-b"');
    expect(html).toContain('"buildId":"build-a"');
    expect(html).not.toContain('__octaneStreamedRenderer');
    expect(html.indexOf('__ULTRAMODERN_RENDERER__')).toBeLessThan(
      html.indexOf('type="module" src="/app.js"'),
    );
    expect(html).toContain('nonce="csr-nonce"');
    expect(response.headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    );
    expect((await session.completion).state).toBe('completed');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('places native head, deduplicated assets and nonce-safe bootstrap in document order', async () => {
    const session = createSession();
    const nonce = 'nonce"<safe>';
    const response = await renderOctaneApplication({
      session,
      App: () =>
        ssrHtml(
          ssrHeadEl('title', 'title', null, 'Native store') +
            '<main>native</main>',
        ),
      responsePolicy: policy(),
      document: {
        ...document,
        documentId: '</script><script>evil</script>',
        nonce,
        assets: [
          { kind: 'stylesheet', href: '/main.css' },
          { kind: 'stylesheet', href: '/main.css' },
          { kind: 'modulepreload', href: '/app.js' },
          { kind: 'script', href: '/app.js' },
        ],
      },
    });
    const html = await response.text();
    expect(response.headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    );
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    expect(head).toContain('<title>Native store</title>');
    expect(head).toContain('href="/main.css"');
    expect(html.split('rel="stylesheet"')).toHaveLength(2);
    const early = earlySignalBootstrapScript({ nonce });
    expect(html.split(early)).toHaveLength(2);
    expect(html.indexOf(early)).toBeLessThan(
      html.indexOf('<main>native</main>'),
    );
    expect(html.indexOf('__ULTRAMODERN_RENDERER__')).toBeLessThan(
      html.indexOf('type="module" async src="/app.js"'),
    );
    expect(html).toContain('nonce="nonce&quot;&lt;safe&gt;"');
    expect(html).toContain('type="module" async src="/app.js"');
    expect(html).not.toContain('</script><script>evil</script>');
    expect(html).toContain('\\u003C/script\\u003E');
    expect(html).toContain('"hydrating":true');
    expect(html).toContain('"buildId":"build-a"');
    expect(html).toContain('"nativeHydrationBuildId":"native-client-build-b"');
    expect((await session.completion).state).toBe('completed');
    expect((await session.completion).cacheEligible).toBe(true);
  });

  test('resolves terminal HTTP outcomes before invoking the native renderer', async () => {
    const session = createSession();
    const App = rstest.fn(() => ssrHtml('<main>must not render</main>'));
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const blocking = deferred<ResponsePolicy>();
    const responsePromise = renderOctaneApplication({
      session,
      App,
      document,
      resolveResponse: () => blocking.promise,
    });
    expect(App).not.toHaveBeenCalled();
    expect(session.state).toBe('matching');
    blocking.resolve(
      policy({
        kind: 'terminal',
        status: 303,
        headers: [
          ['location', '/sign-in'],
          ['set-cookie', 'a=1'],
          ['set-cookie', 'b=2'],
        ],
        cache: { mode: 'no-store' },
      }),
    );
    const response = await responsePromise;
    expect(App).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.body).toBeNull();
    expect(response.headers.get('location')).toBe('/sign-in');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(response.headers.has('content-type')).toBe(false);
    expect((await session.completion).cacheEligible).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('delivers the early shell while suspense is pending and consumes concurrently with allReady', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const { App, pending } = streamedApp();
    const response = await renderOctaneApplication({ session, App, document });
    const reader = response.body!.getReader();
    expect(decode((await reader.read()).value)).toContain('<!doctype html>');
    const shell = decode((await reader.read()).value);
    expect(shell).toContain('EARLY');
    expect(shell).toContain('WAIT');
    expect(shell).not.toContain('LATE');
    expect(session.state).toBe('committed');
    expect(cleanup).not.toHaveBeenCalled();
    pending.resolve({ default: () => ssrHtml('<b>LATE</b>') });
    let tail = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += decode(chunk.value);
    }
    expect(tail).toContain('LATE');
    expect(tail).toContain('</body></html>');
    expect((await session.completion).state).toBe('completed');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('bounds native byte production during a paused document and retires producers on cancellation', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    const nativeCancel = rstest.fn();
    const unsubscribe = rstest.fn();
    const cancelled = deferred<void>();
    const unsubscribed = deferred<void>();
    const serialization = deferred<void>();
    const values = Array.from({ length: 3 }, () =>
      deferred<{ default: () => string }>(),
    );
    const encoded = values.map(() => deferred<void>());
    const produced = values.map(() => deferred<void>());
    const production = rstest.fn((index: number) => {
      produced[index].resolve();
    });
    const payloads = values.map(
      (_, index) => `octane-pressure-${index}:${'x'.repeat(32_768)}`,
    );
    const children = values.map((value, index) => {
      const Late = lazy(() => value.promise);
      return createElement(
        Suspense,
        { fallback: createElement('i', null, `WAIT-${index}`) },
        createElement(Late),
      );
    });
    session.registerCleanup(cleanup);
    const originalEncode = TextEncoder.prototype.encode;
    let payloadBytes = 0;
    const encode = rstest
      .spyOn(TextEncoder.prototype, 'encode')
      .mockImplementation(function (this: TextEncoder, input?: string) {
        const bytes = originalEncode.call(this, input);
        payloads.forEach((payload, index) => {
          if (input?.includes(payload)) encoded[index].resolve();
        });
        if (input?.includes('octane-pressure-')) {
          payloadBytes += bytes.byteLength;
        }
        return bytes;
      });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await renderOctaneApplication({
        session,
        App: () =>
          createElement(
            'main',
            null,
            createElement('p', null, 'PRESSURE-SHELL'),
            ...children,
          ),
        document,
        injection: {
          take: () => '',
          subscribe: () => () => {
            unsubscribe();
            unsubscribed.resolve();
          },
          done: serialization.promise,
          cancel(reason) {
            nativeCancel(reason);
            cancelled.resolve();
          },
        },
      });
      reader = response.body!.getReader();
      expect(decode((await reader.read()).value)).toContain('<!doctype html>');
      const shell = decode((await reader.read()).value);
      expect(shell).toContain('PRESSURE-SHELL');
      expect(shell).toContain('WAIT-2');
      expect(shell).not.toContain('octane-pressure-');
      expect(decode((await reader.read()).value)).toContain(
        '__ULTRAMODERN_RENDERER__',
      );

      const resolve = (index: number) => {
        values[index].resolve({
          default: () => {
            production(index);
            return ssrHtml(`<b>${payloads[index]}</b>`);
          },
        });
      };
      resolve(0);
      await encoded[0].promise;
      resolve(1);
      await encoded[1].promise;
      resolve(2);
      await values[2].promise;
      // Let ready native promise continuations run without creating body demand.
      await new Promise<void>(done => setImmediate(done));
      expect(production).not.toHaveBeenCalledWith(2);
      // One queued native write and one blocked write are allowed ahead of demand.
      // This measures real byte encoding, not arbitrary deferred tree memory.
      expect(payloadBytes).toBeLessThan(
        Buffer.byteLength(payloads[0]) * 2 + 16_384,
      );
      expect(session.state).toBe('committed');
      expect(cleanup).not.toHaveBeenCalled();

      const resumed = await reader.read();
      expect(resumed.done).toBe(false);
      expect(decode(resumed.value)).toContain(payloads[0]);
      await produced[2].promise;
      await reader.cancel('paused consumer disconnected');
      await session.abort('repeated cancellation');
      await Promise.all([cancelled.promise, unsubscribed.promise]);
      expect((await session.completion).state).toBe('aborted');
      expect((await session.completion).cacheEligible).toBe(false);
      expect(session.signal.reason).toBe('paused consumer disconnected');
      expect(nativeCancel).toHaveBeenCalledTimes(1);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      await reader?.cancel('test cleanup').catch(() => {});
      encode.mockRestore();
    }
  });

  test('keeps native router serialization inside the document and waits for its completion', async () => {
    const session = createSession();
    const serialization = deferred<void>();
    const unsubscribe = rstest.fn();
    const renderComplete = rstest.fn();
    let notify = () => {};
    let queued = '';
    const response = await renderOctaneApplication({
      session,
      App: () => ssrHtml('<main>router shell</main>'),
      document,
      injection: {
        take() {
          const html = queued;
          queued = '';
          return html;
        },
        subscribe(callback) {
          notify = callback;
          return unsubscribe;
        },
        done: serialization.promise,
        renderComplete,
      },
    });
    const reader = response.body!.getReader();
    await reader.read();
    expect(decode((await reader.read()).value)).toContain('router shell');
    expect(session.state).toBe('committed');
    queued =
      '<script type="application/json" id="native-route-data">{"loader":"native"}</script>';
    notify();
    serialization.resolve();
    let tail = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += decode(chunk.value);
    }
    expect(tail).toContain('native-route-data');
    expect(tail.indexOf('native-route-data')).toBeLessThan(
      tail.indexOf('</body>'),
    );
    expect(renderComplete).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect((await session.completion).state).toBe('completed');
  });

  test('publishes bootstrap and executable entry after the complete shell while deferred HTML is pending', async () => {
    const session = createSession();
    const { App, pending } = streamedApp();
    const response = await renderOctaneApplication({
      session,
      App,
      document: {
        ...document,
        nonce: 'early-nonce',
        assets: [{ kind: 'script', href: '/entry.js' }],
      },
    });
    const reader = response.body!.getReader();
    const prefix = decode((await reader.read()).value);
    expect(prefix).toContain('__octaneStreamedRenderer');
    expect(prefix).toContain('<div id="root">');
    const nativeShell = decode((await reader.read()).value);
    expect(nativeShell).toContain('EARLY');
    expect(nativeShell).toContain('WAIT');
    expect(nativeShell).toContain('</main>');
    // This read must resolve before settling the deferred component. Waiting for
    // EOF here would prevent the browser's signal receiver and hydration import.
    const bootstrap = decode((await reader.read()).value);
    expect(bootstrap).toMatch(/^<\/div><script type="application\/json"/);
    expect(bootstrap).toContain('"buildId":"build-a"');
    expect(bootstrap).toContain(
      '"nativeHydrationBuildId":"native-client-build-b"',
    );
    expect(bootstrap).toContain(
      'type="module" async src="/entry.js" nonce="early-nonce"',
    );
    expect(bootstrap).not.toContain('</body>');
    expect(session.state).toBe('committed');
    pending.resolve({ default: () => ssrHtml('<b>LATE</b>') });
    let remaining = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      remaining += decode(next.value);
    }
    expect(remaining).toContain('LATE');
    expect(remaining).not.toContain('__ULTRAMODERN_RENDERER__');
    expect(remaining).toMatch(/<\/body><\/html>$/);
    expect((await session.completion).state).toBe('completed');
  });

  test('retains ordered classic runtime and application scripts after the native shell', async () => {
    const session = createSession();
    const response = await renderOctaneApplication({
      session,
      App: () => ssrHtml('<main>classic shell</main>'),
      document: {
        ...document,
        assets: [
          { kind: 'script', href: '/runtime.js', scriptType: 'classic' },
          { kind: 'script', href: '/entry.js', scriptType: 'classic' },
        ],
      },
    });
    const html = await response.text();
    expect(html).toContain('<script src="/runtime.js"></script>');
    expect(html).toContain('<script src="/entry.js"></script>');
    expect(html).not.toContain('<script async');
    expect(html.indexOf('/runtime.js')).toBeLessThan(html.indexOf('/entry.js'));
    expect(html.indexOf('</main>')).toBeLessThan(html.indexOf('/runtime.js'));
  });

  test('keeps a 200 document with client fallback when a boundary errors before the shell', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const error = new Error('boundary failed before shell');
    const logged = rstest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const Broken = () => {
        throw error;
      };
      const response = await renderOctaneApplication({
        session,
        App: () =>
          createElement(
            'main',
            null,
            createElement('p', null, 'SHELL-SURVIVES'),
            createElement(
              Suspense,
              { fallback: createElement('i', null, 'CLIENT-FALLBACK') },
              createElement(Broken),
            ),
          ),
        document,
        responsePolicy: policy(),
      });
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('SHELL-SURVIVES');
      expect(html).toContain('CLIENT-FALLBACK');
      expect(html).toContain('__ULTRAMODERN_RENDERER__');
      expect(html).toMatch(/<\/body><\/html>$/);
      const completion = await session.completion;
      expect(completion.state).toBe('completed');
      expect(completion.fallback).toBe(true);
      expect(completion.cacheEligible).toBe(false);
      expect(session.signal.aborted).toBe(false);
      expect(logged).toHaveBeenCalledWith(expect.any(String), error);
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });

  test('completes the document when a deferred boundary errors after the shell', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const logged = rstest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failing = deferred<{ default: () => string }>();
      const later = deferred<{ default: () => string }>();
      const Failed = lazy(() => failing.promise);
      const Later = lazy(() => later.promise);
      const response = await renderOctaneApplication({
        session,
        App: () =>
          createElement(
            'main',
            null,
            createElement(
              Suspense,
              { fallback: createElement('i', null, 'WAIT-FAILURE') },
              createElement(Failed),
            ),
            createElement(
              Suspense,
              { fallback: createElement('i', null, 'WAIT-LATER') },
              createElement(Later),
            ),
          ),
        document,
        responsePolicy: policy(),
      });
      const reader = response.body!.getReader();
      await reader.read();
      const shell = decode((await reader.read()).value);
      expect(shell).toContain('WAIT-FAILURE');
      expect(shell).toContain('WAIT-LATER');
      expect(decode((await reader.read()).value)).toContain(
        '__ULTRAMODERN_RENDERER__',
      );
      const error = new Error('deferred boundary failed after shell');
      failing.reject(error);
      // The recoverable error must not abort the request or the other producer.
      await new Promise<void>(done => setImmediate(done));
      expect(session.signal.aborted).toBe(false);
      later.resolve({ default: () => ssrHtml('<b>LATER-CONTENT</b>') });
      let tail = '';
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        tail += decode(next.value);
      }
      expect(tail).toContain('LATER-CONTENT');
      expect(tail).toMatch(/<\/body><\/html>$/);
      expect(response.status).toBe(200);
      const completion = await session.completion;
      expect(completion.state).toBe('completed');
      expect(completion.fallback).toBe(true);
      expect(completion.cacheEligible).toBe(false);
      expect(logged).toHaveBeenCalledWith(expect.any(String), error);
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });

  test('cancels native rendering and request cleanup exactly once on consumer cancellation', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const { App } = streamedApp();
    const response = await renderOctaneApplication({ session, App, document });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.read();
    await reader.cancel('client disconnected');
    await session.abort('again');
    expect(session.signal.aborted).toBe(true);
    expect((await session.completion).state).toBe('aborted');
    expect((await session.completion).cacheEligible).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('completes a session whose native stream never finishes cancelling', async () => {
    const session = createSession();
    const { App } = streamedApp();
    const response = await renderOctaneApplication({ session, App, document });
    const reading = response.text().catch(() => undefined);
    const cancel = rstest
      .spyOn(ReadableStreamDefaultReader.prototype, 'cancel')
      .mockImplementation(() => new Promise<void>(() => {}));
    try {
      session.abort(new Error('client went away'));
      expect((await session.completion).state).toBe('aborted');
      expect(cancel).toHaveBeenCalled();
    } finally {
      cancel.mockRestore();
    }
    await reading;
  });

  test('propagates request abort after shell delivery without changing committed headers', async () => {
    const abortController = new AbortController();
    const session = createSession(
      new Request('https://store.test/', {
        signal: abortController.signal,
      }),
    );
    const { App } = streamedApp();
    const response = await renderOctaneApplication({
      session,
      App,
      document,
      responsePolicy: policy(),
    });
    const reading = response.text();
    const error = new Error('connection closed');
    abortController.abort(error);
    await expect(reading).rejects.toBe(error);
    expect((await session.completion).state).toBe('aborted');
    expect((await session.completion).cacheEligible).toBe(false);
    expect(response.status).toBe(200);
  });

  test('isolates native head and signal identity across concurrent requests', async () => {
    const render = async (value: string) => {
      const session = createSession();
      const response = await renderOctaneApplication({
        session,
        App: () =>
          ssrHtml(
            ssrHeadEl('title', 'title', null, value) + `<main>${value}</main>`,
          ),
        document: { ...document, documentId: value },
      });
      return response.text();
    };
    const [first, second] = await Promise.all([
      render('FIRST'),
      render('SECOND'),
    ]);
    expect(first).toContain('<title>FIRST</title>');
    expect(first).not.toContain('SECOND');
    expect(second).toContain('<title>SECOND</title>');
    expect(second).not.toContain('FIRST');
    expect(first).toContain('"documentId":"FIRST"');
    expect(second).toContain('"documentId":"SECOND"');
  });

  test('fails before shell and disposes request resources on native render failure', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const error = new Error('initial render failed');
    await expect(
      renderOctaneApplication({
        session,
        App: () => {
          throw error;
        },
        document,
      }),
    ).rejects.toBe(error);
    expect((await session.completion).state).toBe('failed');
    expect((await session.completion).cacheEligible).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('rejects a conflicting renderer identity before native render', async () => {
    const App = rstest.fn(() => ssrHtml('<main>unused</main>'));
    const session = createRequestSession({
      request: new Request('https://store.test/'),
      identity: { ...identity, renderer: 'solid' },
      platform: { kind: 'node', bindings: {} },
    });
    await expect(
      renderOctaneApplication({ session, App, document }),
    ).rejects.toThrow('Octane renderer identity');
    expect((await session.completion).state).toBe('failed');
    expect(App).not.toHaveBeenCalled();
  });

  test('renders the native document on the worker platform', async () => {
    const session = createRequestSession({
      request: new Request('https://store.test/'),
      identity,
      platform: { kind: 'worker', bindings: {} },
    });
    session.resolveResponse({
      kind: 'document',
      status: 200,
      headers: [['content-type', 'text/html; charset=utf-8']],
      cache: { mode: 'no-store' },
    });
    const response = await renderOctaneApplication({
      session,
      App: () => ssrHtml('<main>worker document</main>'),
      document,
    });
    expect(await response.text()).toContain('<main>worker document</main>');
    expect((await session.completion).state).toBe('completed');
  });

  test('rejects missing or empty native compilation identity before invoking Octane', async () => {
    const App = rstest.fn(() => ssrHtml('<main>must not render</main>'));
    for (const nativeHydrationBuildId of [undefined, '', '   ']) {
      const session = createSession();
      await expect(
        renderOctaneApplication({
          session,
          App,
          // @ts-expect-error Exercise the runtime boundary with malformed identity.
          document: { ...document, nativeHydrationBuildId },
        }),
      ).rejects.toThrow('native client compilation identity');
      expect((await session.completion).state).toBe('failed');
    }
    const csrSession = createSession();
    await expect(
      renderOctaneCSRDocument({
        session: csrSession,
        // @ts-expect-error A source/profile build identity cannot substitute for it.
        document: { documentId: 'missing-native-build' },
      }),
    ).rejects.toThrow('native client compilation identity');
    expect((await csrSession.completion).state).toBe('failed');
    expect(App).not.toHaveBeenCalled();
  });
});
