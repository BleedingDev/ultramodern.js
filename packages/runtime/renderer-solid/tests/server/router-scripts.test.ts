import { renderToString, ssr } from '@solidjs/web';
import { attachRouterServerSsrUtils } from '@tanstack/router-core/ssr/server';
import { createComponent } from 'solid-js';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
  Scripts,
} from '../../src/router-binding/index';

const nonce = 'native-core-32';

async function fixture() {
  const root = createRootRoute({
    scripts: () => [{ children: 'globalThis.routeScript=true' }],
  });
  const index = createRoute({ getParentRoute: () => root, path: '/' });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: true,
    ssr: { nonce },
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
  return { router, cleanup };
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

describe('native router body scripts', () => {
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
});
