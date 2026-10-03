import { createRequestSession } from '@modern-js/renderer-core/session';
import {
  prepareRouterMatchTransfer,
  RouterProvider,
} from '@modern-js/renderer-solid/router';
import {
  renderApplication,
  runApplicationRequest,
} from '@modern-js/renderer-solid/server';
import {
  getHydrationWriter,
  HydrationScript,
  renderToStream,
  renderToString,
} from '@solidjs/web';
import { NoHydration } from 'solid-js';
import { createProbeRouter } from './routes';

export async function renderCase(mode: string, data?: unknown) {
  const session = createRequestSession({
    request: new Request('https://example.test/', {
      headers: { authorization: 'PRIVATE_REQUEST_TOKEN' },
    }),
    identity: {
      renderer: 'solid',
      appId: 'binding-hydration',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'packed-native-binding',
    },
    platform: { kind: 'node', bindings: { token: 'PRIVATE_REQUEST_TOKEN' } },
  });
  return runApplicationRequest(session, async () => {
    const { router, counters } = createProbeRouter('server', data, session);
    await router.load();
    session.signal.throwIfAborted();
    prepareRouterMatchTransfer(router, session);
    session.resolveResponse({
      kind: 'document',
      status: 200,
      headers: [['content-type', 'text/html; charset=utf-8']],
      cache: { mode: 'no-store' },
    });
    if (mode === 'sync') {
      const html = await renderApplication({
        session,
        view: () => <RouterProvider router={router} />,
      }).text();
      return { html, loaderCalls: counters.loader };
    }
    if (mode === 'noHydration') {
      const html = await renderApplication({
        session,
        view: () => (
          <>
            <NoHydration>
              <RouterProvider router={router} />
            </NoHydration>
            <HydrationScript />
          </>
        ),
      }).text();
      return { html, loaderCalls: counters.loader };
    }
    if (mode === 'absent') {
      return {
        html: renderToString(() => <HydrationScript />),
        loaderCalls: counters.loader,
      };
    }
    if (mode === 'partial') {
      function PartialTransfer() {
        const writer = getHydrationWriter()!;
        const match = router.stores.matches.get()[0]!;
        writer.write(`tsr:${match.id}`, {
          status: match.status,
          updatedAt: match.updatedAt,
        });
        return <HydrationScript />;
      }
      return {
        html: renderToString(() => <PartialTransfer />),
        loaderCalls: counters.loader,
      };
    }
    const abort = new AbortController();
    function DeferredTransfer() {
      const writer = getHydrationWriter()!;
      const matches = router.stores.matches.get();
      for (const match of matches) {
        if (mode === 'invalidDeferredSlot') {
          // Native ABI negative: the maintained public-data producer rejects
          // rich containers before transfer. Real native bytes exercise atomic
          // receiver rejection without editing the hydration registry.
          writer.write(`tsr:${match.id}`, {
            status: match.status,
            updatedAt: match.updatedAt,
            ...(match === matches.at(-1)
              ? {
                  loaderData: {
                    later: Promise.resolve(new Date('2026-10-03T00:00:00Z')),
                  },
                }
              : {}),
          });
          continue;
        }
        const value =
          mode === 'pending'
            ? new Promise(() => {})
            : Promise.reject('REJECTED_NATIVE_TRANSFER');
        writer.write(`tsr:${match.id}`, value);
      }
      return <HydrationScript />;
    }
    const stream = renderToStream(() => <DeferredTransfer />, {
      signal: abort.signal,
    });
    let html = '';
    const reader = stream.readable.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        html +=
          typeof result.value === 'string'
            ? result.value
            : new TextDecoder().decode(result.value);
        if (mode === 'pending') {
          abort.abort();
          await reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
    return { html, loaderCalls: counters.loader };
  });
}
