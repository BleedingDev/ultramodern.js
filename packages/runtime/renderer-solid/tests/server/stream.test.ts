import { Buffer } from 'node:buffer';
import {
  generateHydrationScript,
  getRequestEvent,
  renderToStream,
  ssr,
  ssrHydrationKey,
  useHead,
} from '@solidjs/web';
import {
  createComponent,
  createMemo,
  Errored,
  getOwner,
  Hydration,
  Loading,
  NoHydration,
  onCleanup,
} from 'solid-js';
import { parsePublicData } from '../../../renderer-core/src/data/codec';
import type { RendererIdentity } from '../../../renderer-core/src/identity';
import { createRequestSession } from '../../../renderer-core/src/session/request';
import type { RequestSession } from '../../../renderer-core/src/session/types';
import {
  renderApplication,
  renderCSRDocument,
  renderDocumentApplication,
} from '../../src/server';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'shop',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'build-a',
};

function createSession(
  input: {
    request?: Request;
    renderer?: RendererIdentity['renderer'];
    platform?: 'node' | 'worker';
  } = {},
) {
  const session = createRequestSession({
    request: input.request ?? new Request('https://shop.test/'),
    identity: { ...identity, renderer: input.renderer ?? 'solid' },
    platform: { kind: input.platform ?? 'node', bindings: {} },
  });
  session.resolveResponse({
    kind: 'document',
    status: 200,
    headers: [['content-type', 'text/html; charset=utf-8']],
    cache: { mode: 'public', maxAgeSeconds: 30 },
  });
  return session;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function deferredView(input: {
  promise: Promise<string>;
  cleanup?: () => void;
  observe?: (stage: 'start' | 'resolved', request: Request | undefined) => void;
}) {
  return () => {
    onCleanup(input.cleanup ?? (() => {}));
    const value = createMemo(async () => {
      input.observe?.('start', getRequestEvent()?.request);
      const result = await input.promise;
      input.observe?.('resolved', getRequestEvent()?.request);
      return result;
    });
    return ssr(
      ['<!doctype html><html><head></head><body>', '</body></html>'],
      createComponent(Loading, {
        fallback: ssr('<p>waiting</p>'),
        get children() {
          return ssr(['<p>', '</p>'], () => value());
        },
      }),
    );
  };
}

describe('native Solid Node stream', () => {
  test('default native hydration ids safely encode application identity', async () => {
    const session = createRequestSession({
      request: new Request('https://shop.test/'),
      identity: { ...identity, appId: 'shop" <&\' main' },
      platform: { kind: 'node', bindings: {} },
    });
    session.resolveResponse({
      kind: 'document',
      status: 200,
      headers: [['content-type', 'text/html']],
      cache: { mode: 'no-store' },
    });
    const html = await (
      await renderDocumentApplication({
        session,
        view: () => ssr(`<button${ssrHydrationKey()}>native button</button>`),
      })
    ).text();
    expect(html).toMatch(
      /<button _hk=shop%22%20%3C%26%27%20main:main:build-a:[^>]*>native button<\/button>/,
    );
    expect(html).not.toContain(' _hk=shop"');
    const json =
      /<script[^>]*id="__ULTRAMODERN_RENDERER__"[^>]*>(.*?)<\/script>/s.exec(
        html,
      )![1];
    expect(parsePublicData(json)).toEqual({
      identity: session.identity,
      documentId: 'shop%22%20%3C%26%27%20main:main:build-a:',
      hydrating: true,
    });
    const nativeRenderId = 'shop%22%20%3C%26%27%20main:main:build-a:';
    const nativeHtml = await new Response(
      renderToStream(
        () =>
          createComponent(NoHydration, {
            get children() {
              return createComponent(Hydration, {
                id: nativeRenderId,
                get children() {
                  return ssr(
                    `<button${ssrHydrationKey()}>native button</button>`,
                  );
                },
              });
            },
          }),
        { renderId: nativeRenderId },
      ).readable,
    ).text();
    expect(/ _hk=([^\s>]+)/.exec(html)![1]).toBe(
      / _hk=([^\s>]+)/.exec(nativeHtml)![1],
    );
  });
  test('constructs one native app zone with safe identity and nonce data before entry scripts', async () => {
    const session = createRequestSession({
      request: new Request('https://shop.test/'),
      identity: { ...identity, appId: '</script><script>bad()</script>' },
      platform: { kind: 'node', bindings: {} },
    });
    session.resolveResponse({
      kind: 'document',
      status: 200,
      headers: [['content-type', 'text/html']],
      cache: { mode: 'no-store' },
    });
    const view = rstest.fn(() => ssr('<main>SSR application</main>'));
    const html = await (
      await renderDocumentApplication({
        session,
        view,
        document: {
          rootId: 'app" data-bad="true',
          renderId: 'app-zone:',
          lang: 'en" data-bad="true',
          nonce: { script: 'script-nonce', style: 'style-nonce' },
          assets: [
            { kind: 'stylesheet', href: '/app.css' },
            { kind: 'stylesheet', href: '/app.css' },
            { kind: 'modulepreload', href: '/lazy.js' },
            { kind: 'script', href: '/app.js' },
          ],
        },
      })
    ).text();
    expect(view).toHaveBeenCalledTimes(1);
    expect(html).toContain('<main>SSR application</main>');
    expect(html).toContain('id="app&quot; data-bad=&quot;true"');
    expect(html).toContain('lang="en&quot; data-bad=&quot;true"');
    expect(html).not.toContain('</script><script>bad()');
    expect(html.match(/href="\/app.css"/g)).toHaveLength(1);
    expect(html).toContain('href="/app.css" nonce="style-nonce"');
    expect(html).toContain('src="/app.js" nonce="script-nonce"');
    const json =
      /<script[^>]*id="__ULTRAMODERN_RENDERER__"[^>]*>(.*?)<\/script>/s.exec(
        html,
      )![1];
    expect(parsePublicData(json)).toEqual({
      identity: session.identity,
      documentId: 'app-zone:',
      hydrating: true,
    });
    expect(html.indexOf('__ULTRAMODERN_RENDERER__')).toBeLessThan(
      html.indexOf('window._$HY'),
    );
    expect(html.indexOf('window._$HY')).toBeLessThan(
      html.indexOf('src="/app.js"'),
    );
    expect((await session.completion).state).toBe('completed');
  });

  test('hydrated streaming documents start ordered classic and native module assets before deferred EOF', async () => {
    const session = createSession();
    const value = deferred<string>();
    const response = await renderDocumentApplication({
      session,
      view: deferredView({ promise: value.promise }),
      document: {
        nonce: 'script-nonce',
        assets: [
          {
            kind: 'script',
            href: '/runtime.js',
            scriptType: 'classic',
            integrity: 'sha384-runtime',
            crossOrigin: 'anonymous',
          },
          { kind: 'script', href: '/entry.js', scriptType: 'classic' },
          { kind: 'script', href: '/module.js' },
        ],
      },
    });
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    const shell = new TextDecoder().decode(first.value);
    expect(shell).toContain('<p>waiting</p>');
    expect(shell.match(/<script[^>]*\bsrc="[^"]+"[^>]*>/g)).toEqual([
      '<script src="/runtime.js" integrity="sha384-runtime" crossorigin="anonymous" nonce="script-nonce">',
      '<script src="/entry.js" nonce="script-nonce">',
      '<script type="module" async src="/module.js" nonce="script-nonce">',
    ]);
    expect(shell.indexOf('__ULTRAMODERN_RENDERER__')).toBeLessThan(
      shell.indexOf('window._$HY'),
    );
    expect(shell.indexOf('window._$HY')).toBeLessThan(shell.indexOf('self.$R'));
    expect(shell.indexOf('self.$R')).toBeLessThan(
      shell.indexOf('src="/runtime.js"'),
    );
    expect(shell.indexOf('</div>')).toBeLessThan(
      shell.indexOf('src="/runtime.js"'),
    );
    expect(session.state).toBe('committed');
    value.resolve('native fragments complete after entry assets');
    let tail = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += new TextDecoder().decode(chunk.value);
    }
    expect(tail).toContain('native fragments complete after entry assets');
    expect((await session.completion).state).toBe('completed');
  });

  test('static CSR documents retain default classic defer and implicit module scheduling', async () => {
    const session = createSession();
    const html = await renderCSRDocument({
      session,
      document: {
        nonce: 'csr-nonce',
        assets: [
          { kind: 'script', href: '/runtime.js', scriptType: 'classic' },
          { kind: 'script', href: '/entry.js', scriptType: 'classic' },
          { kind: 'script', href: '/module.js' },
        ],
      },
    }).text();
    expect(html.match(/<script[^>]*\bsrc="[^"]+"[^>]*>/g)).toEqual([
      '<script defer src="/runtime.js" nonce="csr-nonce">',
      '<script defer src="/entry.js" nonce="csr-nonce">',
      '<script type="module" src="/module.js" nonce="csr-nonce">',
    ]);
    expect(html.indexOf('__ULTRAMODERN_RENDERER__')).toBeLessThan(
      html.indexOf('src="/runtime.js"'),
    );
    expect(html.indexOf('<div id="root"></div>')).toBeLessThan(
      html.indexOf('src="/runtime.js"'),
    );
    expect(html).not.toContain('window._$HY');
  });

  test('CSR emits an empty root and a strict mount disposition without native hydration bootstrap', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const html = await renderCSRDocument({
      session,
      document: {
        rootId: 'root',
        renderId: 'csr:',
        nonce: 'nonce',
        assets: [{ kind: 'script', href: '/app.js' }],
      },
    }).text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain('window._$HY');
    const json =
      /<script[^>]*id="__ULTRAMODERN_RENDERER__"[^>]*>(.*?)<\/script>/s.exec(
        html,
      )![1];
    expect(parsePublicData(json)).toEqual({
      identity: session.identity,
      documentId: 'csr:',
      hydrating: false,
    });
    expect(html.indexOf('__ULTRAMODERN_RENDERER__')).toBeLessThan(
      html.indexOf('src="/app.js"'),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('document metadata failure disposes resources before constructing a native view', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    const view = rstest.fn(() => null);
    session.registerCleanup(cleanup);
    await expect(
      renderDocumentApplication({
        session,
        view,
        document: { assets: [{ kind: 'script', href: 'javascript:bad()' }] },
      }),
    ).rejects.toThrow('HTTP URL');
    expect(view).not.toHaveBeenCalled();
    expect((await session.completion).state).toBe('failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('delivers native document, hydration, head and manifest assets with one cleanup', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    const ownerCleanup = rstest.fn();
    session.registerCleanup(cleanup);
    session.resolveResponse({
      ...session.responsePolicy!,
      headers: [
        ...session.responsePolicy!.headers,
        ['set-cookie', 'a=1'],
        ['set-cookie', 'b=2'],
      ],
    });
    const response = await renderApplication({
      session,
      document: {
        renderId: 'shop:',
        nonce: 'nonce-value',
        manifest: {
          main: { file: '/main.js', css: ['/main.css'], isEntry: true },
        },
      },
      view: () => {
        onCleanup(ownerCleanup);
        return createComponent(NoHydration, {
          get children() {
            return ssr(
              [
                '<!doctype html><html><head></head><body><div id="root">',
                '</div>',
                '</body></html>',
              ],
              createComponent(Hydration, {
                id: 'shop:',
                get children() {
                  useHead({ tag: 'title', props: { children: 'Solid shop' } });
                  return ssr('<main>native Solid</main>');
                },
              }),
              ssr(generateHydrationScript({ nonce: 'nonce-value' })),
            );
          },
        });
      },
    });
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    const html = await response.text();
    expect(html).toContain('<main>native Solid</main>');
    expect(html).toMatch(/<title[^>]*>Solid shop<\/title>/);
    expect(html).toContain('/main.css');
    expect(html).toContain('nonce="nonce-value"');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(ownerCleanup).toHaveBeenCalledTimes(1);
    expect((await session.completion).cacheEligible).toBe(false);
    await expect(
      renderApplication({ session, view: () => null }),
    ).rejects.toThrow();
  });

  test('returns the shell before an unresolved native Loading boundary', async () => {
    const value = deferred<string>();
    const cleanup = rstest.fn();
    const session = createSession();
    const response = await renderApplication({
      session,
      view: deferredView({ promise: value.promise, cleanup }),
    });
    const reader = response.body!.getReader();
    const shell = await reader.read();
    expect(new TextDecoder().decode(shell.value)).toContain('waiting');
    expect(cleanup).not.toHaveBeenCalled();
    value.resolve('resolved content');
    let rest = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }
    expect(rest).toContain('resolved content');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect((await session.completion).state).toBe('completed');
    expect((await session.completion).cacheEligible).toBe(true);
  });

  test('bounds native byte encoding while document demand is paused and cancels queued delivery once', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    const ownerCleanup = rstest.fn();
    const nativeDisposed = deferred<void>();
    const firstEncoded = deferred<void>();
    const values = Array.from({ length: 8 }, () => deferred<string>());
    const payloads = values.map(
      (_, index) => `solid-pressure-${index}:${'x'.repeat(32_768)}`,
    );
    session.registerCleanup(cleanup);
    const originalEncode = TextEncoder.prototype.encode;
    let payloadWrites = 0;
    let payloadBytes = 0;
    const encode = rstest
      .spyOn(TextEncoder.prototype, 'encode')
      .mockImplementation(function (this: TextEncoder, input?: string) {
        const bytes = originalEncode.call(this, input);
        if (input?.includes('solid-pressure-')) {
          payloadWrites++;
          payloadBytes += bytes.byteLength;
          firstEncoded.resolve();
        }
        return bytes;
      });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await renderDocumentApplication({
        session,
        view: () => {
          onCleanup(() => {
            ownerCleanup();
            nativeDisposed.resolve();
          });
          const children = values.map((value, index) => {
            const data = createMemo(async () => await value.promise);
            return createComponent(Loading, {
              fallback: ssr(`<i>WAIT-${index}</i>`),
              get children() {
                return ssr(['<p>', '</p>'], () => data());
              },
            });
          });
          return ssr(['<main>PRESSURE-SHELL', '</main>'], children);
        },
      });
      reader = response.body!.getReader();
      const shell = new TextDecoder().decode((await reader.read()).value);
      expect(shell).toContain('PRESSURE-SHELL');
      expect(shell).toContain('WAIT-7');
      expect(shell).not.toContain('solid-pressure-');

      values[0].resolve(payloads[0]);
      await firstEncoded.promise;
      values
        .slice(1)
        .forEach((value, index) => value.resolve(payloads[index + 1]));
      await nativeDisposed.promise;
      // Solid may finish computing and queue resolved strings during a pause.
      // This bounds actual native transport encodings, not those string buffers.
      expect(payloadWrites).toBe(1);
      expect(payloadBytes).toBeLessThan(
        Buffer.byteLength(payloads[0]) * 2 + 8_192,
      );
      expect(session.state).toBe('committed');
      expect(cleanup).not.toHaveBeenCalled();
      expect(ownerCleanup).toHaveBeenCalledTimes(1);

      const resumed = await reader.read();
      expect(resumed.done).toBe(false);
      expect(new TextDecoder().decode(resumed.value)).toContain(payloads[0]);
      await reader.cancel('paused consumer disconnected');
      await session.abort('repeated cancellation');
      expect((await session.completion).state).toBe('aborted');
      expect((await session.completion).cacheEligible).toBe(false);
      expect(session.signal.reason).toBe('paused consumer disconnected');
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(ownerCleanup).toHaveBeenCalledTimes(1);
    } finally {
      await reader?.cancel('test cleanup').catch(() => {});
      encode.mockRestore();
    }
  });

  test('isolates request events across reversed async completion without restoring an owner across await', async () => {
    const firstValue = deferred<string>();
    const secondValue = deferred<string>();
    const first = createSession({
      request: new Request('https://shop.test/first'),
    });
    const second = createSession({
      request: new Request('https://shop.test/second'),
    });
    const events: string[] = [];
    const observedView = (session: RequestSession, promise: Promise<string>) =>
      deferredView({
        promise,
        observe(stage, request) {
          expect(request).toBe(session.request);
          if (stage === 'start') expect(getOwner()).not.toBeNull();
          else expect(getOwner()).toBeNull();
          events.push(`${new URL(request!.url).pathname}:${stage}`);
        },
      });
    const firstBody = (
      await renderApplication({
        session: first,
        view: observedView(first, firstValue.promise),
      })
    ).text();
    const secondBody = (
      await renderApplication({
        session: second,
        view: observedView(second, secondValue.promise),
      })
    ).text();
    secondValue.resolve('second request');
    expect(await secondBody).toContain('second request');
    firstValue.resolve('first request');
    expect(await firstBody).toContain('first request');
    expect(events).toEqual([
      '/first:start',
      '/second:start',
      '/second:resolved',
      '/first:resolved',
    ]);
  });

  test('consumer cancellation aborts native owners and request resources exactly once', async () => {
    const value = deferred<string>();
    const ownerCleanup = rstest.fn();
    const cleanup = rstest.fn();
    const session = createSession();
    session.registerCleanup(cleanup);
    const response = await renderApplication({
      session,
      view: deferredView({ promise: value.promise, cleanup: ownerCleanup }),
    });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel('navigation');
    await session.abort('again');
    expect(session.signal.reason).toBe('navigation');
    expect((await session.completion).state).toBe('aborted');
    expect(ownerCleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    value.resolve('late value');
    await Promise.resolve();
    expect(ownerCleanup).toHaveBeenCalledTimes(1);
  });

  test('native head state remains isolated while streamed requests resolve in reverse order', async () => {
    const first = createSession({
      request: new Request('https://shop.test/first'),
    });
    const second = createSession({
      request: new Request('https://shop.test/second'),
    });
    const firstValue = deferred<string>();
    const secondValue = deferred<string>();
    const view = (promise: Promise<string>) => () => {
      useHead({
        tag: 'title',
        props: { children: new URL(getRequestEvent()!.request.url).pathname },
      });
      return deferredView({ promise })();
    };
    const firstBody = (
      await renderApplication({
        session: first,
        view: view(firstValue.promise),
      })
    ).text();
    const secondBody = (
      await renderApplication({
        session: second,
        view: view(secondValue.promise),
      })
    ).text();
    secondValue.resolve('second body');
    const secondHTML = await secondBody;
    firstValue.resolve('first body');
    const firstHTML = await firstBody;
    expect(firstHTML).toMatch(/<title[^>]*>\/first<\/title>/);
    expect(firstHTML).not.toMatch(/<title[^>]*>\/second<\/title>/);
    expect(secondHTML).toMatch(/<title[^>]*>\/second<\/title>/);
    expect(secondHTML).not.toMatch(/<title[^>]*>\/first<\/title>/);
  });

  test('native cleanup keeps its request event when another stream owns the active render context', async () => {
    const first = createSession({
      request: new Request('https://shop.test/first'),
    });
    const second = createSession({
      request: new Request('https://shop.test/second'),
    });
    const firstValue = deferred<string>();
    const secondValue = deferred<string>();
    const firstCleanup = rstest.fn();
    const secondCleanup = rstest.fn();
    const firstReader = (
      await renderApplication({
        session: first,
        view: deferredView({
          promise: firstValue.promise,
          cleanup: () => firstCleanup(getRequestEvent()?.request),
        }),
      })
    ).body!.getReader();
    await firstReader.read();
    const secondReader = (
      await renderApplication({
        session: second,
        view: deferredView({
          promise: secondValue.promise,
          cleanup: () => secondCleanup(getRequestEvent()?.request),
        }),
      })
    ).body!.getReader();
    await secondReader.read();
    await firstReader.cancel('first disconnect');
    await secondReader.cancel('second disconnect');
    expect(firstCleanup).toHaveBeenCalledWith(first.request);
    expect(secondCleanup).toHaveBeenCalledWith(second.request);
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).toHaveBeenCalledTimes(1);
    firstValue.resolve('late first');
    secondValue.resolve('late second');
  });

  test('request cancellation errors a pending consumer and preserves committed headers', async () => {
    const abort = new AbortController();
    const session = createSession({
      request: new Request('https://shop.test/', { signal: abort.signal }),
    });
    const value = deferred<string>();
    const cleanup = rstest.fn();
    const response = await renderApplication({
      session,
      view: deferredView({ promise: value.promise, cleanup }),
    });
    const reading = response.text();
    const reason = new Error('connection closed');
    abort.abort(reason);
    await expect(reading).rejects.toBe(reason);
    expect(response.status).toBe(200);
    expect((await session.completion).cacheEligible).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
    value.resolve('late value');
  });

  test('preserves a native Errored fallback and prevents successful cache admission', async () => {
    const session = createSession();
    const error = new Error('contained error');
    const hook = rstest.fn(() => new Error('public message'));
    const response = await renderApplication({
      session,
      onError: hook,
      view: () =>
        createComponent(Errored, {
          fallback: ssr('<p>contained fallback</p>'),
          get children(): never {
            throw error;
          },
        }),
    });
    expect(await response.text()).toContain('contained fallback');
    expect(hook).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ handling: 'fallback' }),
    );
    expect((await session.completion).state).toBe('completed');
    expect((await session.completion).fallback).toBe(true);
    expect((await session.completion).cacheEligible).toBe(false);
  });

  test('a native deferred client recovery keeps sent policy but cannot become a cached success', async () => {
    const value = deferred<string>();
    const session = createSession();
    const hook = rstest.fn();
    const response = await renderApplication({
      session,
      onError: hook,
      view: deferredView({ promise: value.promise }),
    });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      'waiting',
    );
    value.reject(new Error('deferred failure'));
    while (!(await reader.read()).done) {
      /* Consume Solid's client recovery instructions. */
    }
    expect(response.status).toBe(200);
    expect(hook).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ handling: 'client' }),
    );
    expect((await session.completion).cacheEligible).toBe(false);
  });

  test('synchronous native failure disposes request resources and does not answer with HTML', async () => {
    const session = createSession();
    const cleanup = rstest.fn();
    const ownerCleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const error = new Error('no shell');
    await expect(
      renderApplication({
        session,
        view: () => {
          onCleanup(ownerCleanup);
          throw error;
        },
      }),
    ).rejects.toThrow(error);
    expect((await session.completion).state).toBe('failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(ownerCleanup).toHaveBeenCalledTimes(1);
  });

  test('an uncontained shell-time native failure rejects before any HTTP head commits', async () => {
    const session = createSession();
    const value = deferred<string>();
    const cleanup = rstest.fn();
    const hook = rstest.fn();
    const rendering = renderApplication({
      session,
      onError: hook,
      view: () => {
        onCleanup(cleanup);
        const data = createMemo(async () => await value.promise);
        return ssr(['<main>', '</main>'], () => data());
      },
    });
    const error = new Error('uncontained shell error');
    value.reject(error);
    await expect(rendering).rejects.toBe(error);
    expect(hook).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ handling: 'failed' }),
    );
    expect(session.committedPolicy).toBeUndefined();
    expect((await session.completion).state).toBe('failed');
    expect((await session.completion).cacheEligible).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('rejects unsupported platforms, identities and terminal outcomes before invoking the view', async () => {
    const view = rstest.fn(() => null);
    const worker = createSession({ platform: 'worker' });
    await expect(renderApplication({ session: worker, view })).rejects.toThrow(
      'worker rendering has not been admitted',
    );
    const react = createSession({ renderer: 'react' });
    await expect(renderApplication({ session: react, view })).rejects.toThrow(
      'Solid renderer identity',
    );
    const terminal = createSession();
    terminal.resolveResponse({
      kind: 'terminal',
      status: 302,
      headers: [['location', '/login']],
      cache: { mode: 'no-store' },
    });
    await expect(
      renderApplication({ session: terminal, view }),
    ).rejects.toThrow('terminal responses bypass rendering');
    expect(view).not.toHaveBeenCalled();
    await Promise.all([
      worker.completion,
      react.completion,
      terminal.completion,
    ]);
  });
});
