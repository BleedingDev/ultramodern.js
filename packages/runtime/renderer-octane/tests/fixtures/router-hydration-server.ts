import assert from 'node:assert/strict';
import { createRequestSession } from '@modern-js/renderer-core/session';
import { createRouter } from '@octanejs/tanstack-router';
import { createOctaneRouterInjection } from '../../src/router-injection';
import {
  createOctaneRequestHandler,
  createSsrStreamResponse,
  OctaneRouterServer,
} from '../../src/router-server';
import { renderOctaneApplication } from '../../src/server';
import {
  createHydrationRouteTree,
  type RouterHydrationLoadCall,
  routerHydrationHead,
  routerHydrationIdentity,
} from './router-hydration';

export async function renderRouterHydrationDocument(
  nativeHydrationBuildId: string,
) {
  const original = new Request('https://native.test/');
  const session = createRequestSession({
    request: original,
    identity: routerHydrationIdentity,
    platform: { kind: 'node', bindings: {} },
  });
  const request = new Request(original, { signal: session.signal });
  const calls: RouterHydrationLoadCall[] = [];
  const router = createRouter({
    routeTree: createHydrationRouteTree('server', calls, request),
    isServer: true,
    defaultStaleTime: Infinity,
  });
  let cleanups = 0;
  const response = await createOctaneRequestHandler({
    request,
    session,
    createRouter: () => router,
  })(async ({ router }) => {
    router.serverSsr!.onCleanup(() => cleanups++);
    const response = await renderOctaneApplication({
      session,
      App: OctaneRouterServer,
      props: { router },
      injection: createOctaneRouterInjection(router, session),
      document: {
        documentId: 'native-router-hydration-document',
        nativeHydrationBuildId,
      },
    });
    return createSsrStreamResponse(router, response);
  });
  const html = await response.text();
  assert.deepEqual(
    calls.map(call => call.routeId),
    ['application', 'home'],
  );
  assert.match(html, /home server data/);
  assert.match(html, /\$_TSR\.router=/);
  const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
  assert.match(head, /<title[^>]*>Native Octane route hydration<\/title>/);
  assert.ok(head.includes('name="description"'));
  assert.ok(head.includes(routerHydrationHead.description));
  assert.ok(head.includes('rel="canonical"'));
  assert.ok(head.includes(routerHydrationHead.canonical));
  assert.equal(
    html.match(/data-fixture="native-router-hydration"/g)?.length,
    1,
  );
  assert.equal((await session.completion).state, 'completed');
  assert.equal(cleanups, 1);
  return { html, calls, cleanups };
}
