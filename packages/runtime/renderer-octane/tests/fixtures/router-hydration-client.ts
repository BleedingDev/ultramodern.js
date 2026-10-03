import assert from 'node:assert/strict';
import { createBrowserHistory, createRouter } from '@octanejs/tanstack-router';
import { flushSync } from 'octane';
import {
  hydrateOctaneApplication,
  type OctaneApplicationHandle,
  readOctaneDocumentBootstrap,
} from '../../src/client';
import {
  OctaneRouterRoot,
  prepareOctaneRouterHydration,
} from '../../src/router-client';
import {
  createHydrationRouteTree,
  type RouterHydrationLoadCall,
  routerHydrationHead,
  routerHydrationIdentity,
} from './router-hydration';

export let routerHydrationFailure: unknown;

function assertHeadMetadata() {
  assert.equal(document.title, routerHydrationHead.title);
  assert.equal(document.head.querySelectorAll('title').length, 1);
  const descriptions = document.head.querySelectorAll(
    'meta[name="description"]',
  );
  assert.equal(descriptions.length, 1);
  assert.equal(
    descriptions.item(0).getAttribute('content'),
    routerHydrationHead.description,
  );
  const canonicals = document.head.querySelectorAll('link[rel="canonical"]');
  assert.equal(canonicals.length, 1);
  assert.equal(
    canonicals.item(0).getAttribute('href'),
    routerHydrationHead.canonical,
  );
}

async function settleUntil(assertion: () => void) {
  for (let attempt = 0; ; attempt++) {
    flushSync(() => {});
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 100) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

export async function assertRouterHydrationAndNativeNavigation() {
  routerHydrationFailure = undefined;
  assertHeadMetadata();
  const existingTitle = document.head.querySelector('title');
  const existingDescription = document.head.querySelector(
    'meta[name="description"]',
  );
  const existingCanonical = document.head.querySelector(
    'link[rel="canonical"]',
  );
  const assertRetainedHead = () => {
    assertHeadMetadata();
    assert.equal(document.head.querySelector('title'), existingTitle);
    assert.equal(
      document.head.querySelector('meta[name="description"]'),
      existingDescription,
    );
    assert.equal(
      document.head.querySelector('link[rel="canonical"]'),
      existingCanonical,
    );
  };
  const container = document.getElementById('root')!;
  assert.ok(container);
  const existingMain = container.querySelector('main');
  const existingHome = container.querySelector('[data-fixture="home-route"]');
  const rootHtmlBefore = container.innerHTML;
  assert.ok(existingMain);
  assert.ok(existingHome);
  const calls: RouterHydrationLoadCall[] = [];
  const history = createBrowserHistory({ window });
  const router = createRouter({
    routeTree: createHydrationRouteTree('client', calls),
    history,
    isServer: false,
    defaultStaleTime: Infinity,
  });
  const bootstrap = readOctaneDocumentBootstrap(
    document,
    routerHydrationIdentity,
  );
  assert.equal(bootstrap.hydrating, true);
  const diagnostics: unknown[][] = [];
  const reported: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => diagnostics.push(args);
  let handle: OctaneApplicationHandle | undefined;
  let preparedState: unknown;
  try {
    handle = await hydrateOctaneApplication({
      container,
      identity: routerHydrationIdentity,
      nativeHydrationBuildId: bootstrap.nativeHydrationBuildId,
      documentIdentity: bootstrap.identity,
      documentNativeHydrationBuildId: bootstrap.nativeHydrationBuildId,
      documentId: bootstrap.documentId,
      options: { onUncaughtError: error => reported.push(error) },
      load: async () => {
        await prepareOctaneRouterHydration(router);
        assert.ok(router.stores.matchesId.get().length > 0);
        preparedState = {
          ids: router.stores.matchesId.get(),
          matches: router.stores.matches.get().map(match => ({
            id: match.id,
            routeId: match.routeId,
            status: match.status,
            loaderData: match.loaderData,
          })),
        };
        return { default: OctaneRouterRoot, props: { router } };
      },
    });
    await settleUntil(() => {
      assert.equal(container.querySelector('main'), existingMain);
      assert.equal(
        container.querySelector('[data-fixture="home-route"]'),
        existingHome,
      );
      assert.equal(existingHome.textContent, 'home server data');
      assert.deepEqual(calls, []);
      assertRetainedHead();
    });
    container
      .querySelector('button')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    await settleUntil(() =>
      assert.equal(
        container.querySelector('button')?.textContent,
        'Root count: 1',
      ),
    );

    for (const pathname of ['/products/42', '/', '/products/42']) {
      const selector = pathname === '/' ? 'home-link' : 'product-link';
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      container
        .querySelector(`[data-fixture="${selector}"]`)!
        .dispatchEvent(click);
      assert.equal(click.defaultPrevented, true);
      await settleUntil(() => {
        assert.equal(window.location.pathname, pathname);
        assert.equal(router.stores.location.get().pathname, pathname);
        assert.equal(container.querySelector('main'), existingMain);
        assert.equal(
          container.querySelector('button')?.textContent,
          'Root count: 1',
        );
        assert.equal(
          container.querySelector('h2')?.textContent,
          pathname === '/' ? 'home server data' : 'Product 42 client data',
        );
        assertRetainedHead();
      });
    }
    assert.deepEqual(calls, [
      { routeId: 'product', pathname: '/products/42', productId: '42' },
    ]);
    assert.equal(container.querySelectorAll('main').length, 1);
    assert.deepEqual(reported, []);
    assert.deepEqual(diagnostics, []);
    handle.dispose();
    handle.dispose();
    assert.equal(container.childNodes.length, 0);
    return {
      retainedServerMain: true,
      retainedServerHome: true,
      nativeNavigationCount: 3,
      initialClientLoaderCalls: 0,
      navigationClientLoaderCalls: calls.length,
      diagnostics: diagnostics.length,
      nativeHeadMetadata: true,
      retainedServerHead: true,
    };
  } catch (error) {
    routerHydrationFailure = {
      error: String(error),
      diagnostics: diagnostics.map(args => args.map(String)),
      reported: reported.map(String),
      calls,
      nativeHydrationBuildId: bootstrap.nativeHydrationBuildId,
      preparedState,
      rootHtmlBefore,
      retainedServerMain: container.querySelector('main') === existingMain,
      retainedServerHome:
        container.querySelector('[data-fixture="home-route"]') === existingHome,
      rootHtml: container.innerHTML,
    };
    throw error;
  } finally {
    console.error = originalError;
    handle?.dispose();
    history.destroy();
  }
}
