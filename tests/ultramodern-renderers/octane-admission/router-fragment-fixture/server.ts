import { createRouter } from '@octanejs/tanstack-router';
import {
  createOctaneRequestHandler,
  createOctaneRouterInjection,
  createRequestSession,
  createSsrStreamResponse,
  OctaneRouterServer,
  renderOctaneApplication,
} from './framework-server';
import { identity, routeTree } from './routes';

export async function renderDocument(nativeHydrationBuildId: string) {
  const original = new Request('https://native.test/');
  const session = createRequestSession({
    request: original,
    identity,
    platform: { kind: 'node', bindings: {} },
  });
  const request = new Request(original, { signal: session.signal });
  const calls: string[] = [];
  const router = createRouter({
    routeTree: routeTree('server', calls, request),
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
        documentId: 'native-public-fragment-document',
        nativeHydrationBuildId,
      },
    });
    return createSsrStreamResponse(router, response);
  });
  const html = await response.text();
  return {
    html,
    calls,
    cleanups,
    completion: (await session.completion).state,
  };
}
