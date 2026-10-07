import type { DocumentAsset } from '@modern-js/renderer-core/document';
import { createRequestSession } from '@modern-js/renderer-core/session';
import {
  ApplicationRouter,
  getApplicationStatus,
  prepareRouterMatchTransfer,
} from '@modern-js/renderer-solid/router';
import {
  renderDocumentApplication,
  runApplicationRequest,
} from '@modern-js/renderer-solid/server';
import { createDeferredRouter, identity } from './routes';

export async function beginDeferredDocument(assets: readonly DocumentAsset[]) {
  const request = new Request('https://deferred.test/item', {
    headers: { authorization: 'PRIVATE_DEFERRED_REQUEST_TOKEN' },
  });
  const session = createRequestSession({
    request,
    identity,
    platform: {
      kind: 'node',
      bindings: { token: 'PRIVATE_DEFERRED_REQUEST_TOKEN' },
    },
  });
  let reject!: (reason: unknown) => void;
  let resolve!: (value: unknown) => void;
  const authored = new Promise<unknown>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return runApplicationRequest(session, async () => {
    const { router, counters } = createDeferredRouter(
      'server',
      authored,
      session,
    );
    await router.load();
    const timeline = { loadedAt: Date.now(), renderingAt: 0, settledAt: 0 };
    const isTerminated = () =>
      session.state === 'failed' || session.state === 'aborted';
    if (isTerminated()) {
      const completion = await session.completion;
      throw new Error(
        `Managed fixture load terminated: ${JSON.stringify({
          state: session.state,
          error:
            completion.error instanceof Error
              ? completion.error.message
              : String(completion.error),
          matches: router.state.matches.map(match => ({
            status: match.status,
            error:
              match.error instanceof Error
                ? match.error.message
                : String(match.error),
          })),
        })}`,
      );
    }
    prepareRouterMatchTransfer(router, session, [
      session,
      session.platform,
      session.platform.bindings,
      request,
    ]);
    if (isTerminated())
      throw new Error(
        `Managed fixture transfer terminated: ${String((await session.completion).error)}`,
      );
    session.resolveResponse({
      kind: 'document',
      status: getApplicationStatus(router),
      headers: [['content-type', 'text/html; charset=utf-8']],
      cache: { mode: 'public', maxAgeSeconds: 30 },
    });
    const errors: Array<{ handling: string; message: string }> = [];
    timeline.renderingAt = Date.now();
    const response = await renderDocumentApplication({
      session,
      document: { renderId: 'managed-deferred:', assets },
      view: () => <ApplicationRouter router={router} />,
      onError(error, context) {
        errors.push({
          handling: context.handling,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
    return {
      response,
      session,
      counters,
      errors,
      authored,
      timeline,
      reject: () => {
        timeline.settledAt = Date.now();
        reject(new Error('Expected public deferred rejection'));
      },
      resolve: () => {
        timeline.settledAt = Date.now();
        resolve({ text: 'native-server-deferred-success' });
      },
    };
  });
}
