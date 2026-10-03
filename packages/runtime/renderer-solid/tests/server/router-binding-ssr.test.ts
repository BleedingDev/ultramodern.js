import { renderToString, ssr } from '@solidjs/web';
import { attachRouterServerSsrUtils } from '@tanstack/router-core/ssr/server';
import { createComponent, createMemo, Loading } from 'solid-js';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
  Scripts,
} from '../../src/router-binding/index';
import { renderRouterToStream } from '../../src/router-binding/ssr/renderRouterToStream';
import { renderRouterToString } from '../../src/router-binding/ssr/renderRouterToString';

const nonce = 'native-core-32';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function fixture(input: { deferred?: Promise<string> } = {}) {
  const root = createRootRoute({
    scripts: () => [{ children: 'globalThis.routeScript=true' }],
  });
  const index = createRoute({ getParentRoute: () => root, path: '/' });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: true,
    ssr: { nonce },
    dehydrate: () => ({ deferred: input.deferred }),
  });
  await router.load();
  expect(router.state.matches).toHaveLength(2);
  expect(router.state.matches.every(match => match.status === 'success')).toBe(
    true,
  );
  attachRouterServerSsrUtils({
    router,
    manifest: {
      routes: {
        __root__: {
          scripts: [{ attrs: { src: '/native-entry.js', type: 'module' } }],
        },
      },
    },
  });
  const cleanup: boolean[] = [];
  router.serverSsr?.onCleanup(settled => cleanup.push(settled));
  await router.serverSsr?.dehydrate();
  const children = () =>
    createComponent(RouterContextProvider, {
      router,
      children: () =>
        ssr(
          [
            '<html><head></head><body><main>native view</main>',
            '</body></html>',
          ],
          () => createComponent(Scripts, {}),
        ),
    });
  return { router, children, cleanup };
}

function expectNativeBody(html: string) {
  expect(html.match(/<!DOCTYPE html>/g)).toHaveLength(1);
  expect(html).toContain('native view');
  expectNativeScripts(html);
}

function expectNativeScripts(html: string) {
  expect(html.match(/\$_TSR\.router=/g)).toHaveLength(1);
  expect(html.match(/\$tsr-stream-boundary/g)).toHaveLength(1);
  const scripts = [
    ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
  ].map(match => ({ attributes: match[1], source: match[2] }));
  const bootstrap = scripts.findIndex(script =>
    script.source.includes('$_TSR.router='),
  );
  const route = scripts.findIndex(
    script => script.source === 'globalThis.routeScript=true',
  );
  const entry = scripts.findIndex(script =>
    /\bsrc="\/native-entry\.js"/.test(script.attributes),
  );
  const boundary = scripts.findIndex(script =>
    script.source.includes('$tsr-stream-boundary'),
  );
  // Check actual emitted tags, not a URL embedded in the dehydrated manifest.
  for (const tag of [bootstrap, route, entry, boundary]) {
    expect(tag, html).toBeGreaterThanOrEqual(0);
  }
  expect(bootstrap).toBeLessThan(route);
  expect(route).toBeLessThan(entry);
  expect(entry).toBeLessThan(boundary);
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }
}

describe('current native router SSR transport', () => {
  test('Scripts takes bootstrap tags once and puts the boundary after route assets', async () => {
    const { router, cleanup } = await fixture();
    try {
      const html = renderToString(() =>
        createComponent(RouterContextProvider, {
          router,
          children: () =>
            ssr(
              ['<html><body>', '', '</body></html>'],
              () => createComponent(Scripts, {}),
              () => createComponent(Scripts, {}),
            ),
        }),
      );
      expectNativeScripts(html);
    } finally {
      router.serverSsr?.cleanup();
    }
    expect(cleanup).toHaveLength(1);
  });

  test('string rendering drains late router serialization before its closing body and cleans up once', async () => {
    const late = deferred<string>();
    const { router, children, cleanup } = await fixture({
      deferred: late.promise,
    });
    let complete = false;
    const pending = renderRouterToString({
      router,
      responseHeaders: new Headers({ 'content-type': 'text/html' }),
      children,
    }).then(response => {
      complete = true;
      return response;
    });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(complete).toBe(false);
      late.resolve('native-late-string-data');
      const response = await pending;
      const html = await response.text();
      expect(response.status).toBe(200);
      expectNativeBody(html);
      expect(html).toContain('native-late-string-data');
      expect(html.indexOf('native-late-string-data')).toBeLessThan(
        html.indexOf('</body>'),
      );
      expect(cleanup).toEqual([true]);
    } finally {
      late.resolve('test-cleanup');
      router.serverSsr?.cleanup();
    }
  });

  test('stream rendering merges late router data with native HTML and owns its successful cleanup', async () => {
    const late = deferred<string>();
    const { router, children, cleanup } = await fixture({
      deferred: late.promise,
    });
    try {
      const result = await renderRouterToStream({
        request: new Request('http://localhost/'),
        router,
        responseHeaders: new Headers({ 'content-type': 'text/html' }),
        children,
      });
      const body = result.response.text();
      late.resolve('native-late-stream-data');
      const html = await body;
      expectNativeBody(html);
      expect(html).toContain('native-late-stream-data');
      expect(html.indexOf('native-late-stream-data')).toBeLessThan(
        html.indexOf('</body>'),
      );
      expect(cleanup).toEqual([true]);
    } finally {
      late.resolve('test-cleanup');
      router.serverSsr?.cleanup();
    }
  });

  test('a bot disconnect unblocks native all-ready waiting and cleans the router before the view resolves', async () => {
    const view = deferred<string>();
    const { router, cleanup } = await fixture({ deferred: view.promise });
    let viewResolved = false;
    const controller = new AbortController();
    const reason = new Error('bot disconnected');
    const pending = renderRouterToStream({
      request: new Request('http://localhost/', {
        signal: controller.signal,
        headers: { 'user-agent': 'Googlebot' },
      }),
      router,
      responseHeaders: new Headers(),
      children: () => {
        const value = createMemo(async () => {
          const result = await view.promise;
          viewResolved = true;
          return result;
        });
        return createComponent(Loading, {
          fallback: ssr('<p>pending native view</p>'),
          get children() {
            return ssr(['<p>', '</p>'], () => value());
          },
        });
      },
    });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(viewResolved).toBe(false);
      expect(cleanup).toEqual([false]);
    } finally {
      view.resolve('native view released');
      router.serverSsr?.cleanup();
      await Promise.resolve();
    }
  });
});
