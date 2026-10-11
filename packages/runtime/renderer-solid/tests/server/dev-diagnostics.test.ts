import type { FileSystemRouteIR } from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  createRequestSession,
  type RequestSession,
} from '@modern-js/renderer-core/session';
import { ssr } from '@solidjs/web';
import { createComponent } from 'solid-js';
import {
  ApplicationRouter,
  createApplicationRouter,
  createFileSystemRouteTree,
  createMemoryHistory,
  useRouteAction,
} from '../../src/router';
import {
  renderDocumentApplication,
  runApplicationRequest,
} from '../../src/server';

// This project resolves solid-js/@solidjs/web through the `development`
// condition (see rstest.config.mts), which is the only build that runs
// Solid's reactivity diagnostics (STRICT_READ_UNTRACKED, SERVER_WRITE, ...).
// The plain `server` project resolves the silent production build, so these
// assertions would be vacuous there.

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'dev-diagnostics',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'dev-diagnostics-build',
};

function createSession(name: string) {
  return createRequestSession({
    request: new Request(`https://diagnostics.test/${name}`),
    identity: {
      renderer: 'solid',
      appId: 'dev-diagnostics',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'dev-diagnostics-build',
    },
    platform: { kind: 'node', bindings: {} },
  });
}

function resolveDocument(session: RequestSession) {
  session.resolveResponse({
    kind: 'document',
    status: 200,
    headers: [['content-type', 'text/html; charset=utf-8']],
    cache: { mode: 'public', maxAgeSeconds: 30 },
  });
}

const routes: FileSystemRouteIR[] = [
  {
    id: 'layout',
    isRoot: true,
    children: [
      {
        id: 'item',
        path: 'item',
        modules: { data: '/item.data.ts' },
        children: [],
      },
    ],
  },
];

describe('Solid native server render diagnostics', () => {
  test('a route calling useRouteAction renders and disposes without a SERVER_WRITE warning', async () => {
    const warn = console.warn.bind(console);
    const warningSpy = rstest.spyOn(console, 'warn').mockImplementation(warn);
    try {
      const session = createSession('action-route');
      const routeTree = createFileSystemRouteTree(
        routes,
        {
          item: {
            component: () => {
              // Exercises the exact hook the generated Solid app template
              // calls directly in a route component's body.
              const action = useRouteAction();
              return ssr(
                ['<main data-route-id="', '"></main>'],
                action.routeId,
              );
            },
          },
        },
        {
          request: session.request,
          session,
          loadRoute: async () => ({
            kind: 'success',
            value: { ready: true },
            response: {
              status: 200,
              statusText: 'OK',
              headers: [],
              cachePolicy: 'public',
            },
          }),
        },
      );

      const response = await runApplicationRequest(session, async () => {
        const router = createApplicationRouter({
          routeTree,
          history: createMemoryHistory({ initialEntries: ['/item'] }),
          origin: 'http://localhost',
          context: { ultramodern: { rendererIdentity: identity } },
          isServer: true,
        });
        await router.load();
        expect(router.state.matches.at(-1)?.error).toBeUndefined();
        resolveDocument(session);
        return renderDocumentApplication({
          session,
          document: { renderId: 'diagnostics:' },
          view: () => createComponent(ApplicationRouter, { router }),
        });
      });

      const html = await response.text();
      expect(html).toContain('data-route-id="item"');
      // The session's completion lifecycle only resolves once the render
      // root's cleanup (onCleanup callbacks, including the route action's
      // disposal) has run — this is where the bug wrote a signal.
      expect((await session.completion).state).toBe('completed');

      const serverWriteWarnings = warningSpy.mock.calls.filter(call =>
        String(call[0]).includes('SERVER_WRITE'),
      );
      expect(serverWriteWarnings).toEqual([]);
    } finally {
      warningSpy.mockRestore();
    }
  });
});
