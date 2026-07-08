(
  globalThis as typeof globalThis & {
    __webpack_require__?: { u: (chunkId: unknown) => string };
  }
).__webpack_require__ = {
  u: chunkId => String(chunkId),
};

import type {
  RedirectContext,
  ResponseProxy,
} from '../../../src/core/server/requestResponse';
import type { RouterCleanup } from '../../../src/core/server/routerCleanup';

const redirectCtx: RedirectContext = {
  enableRsc: false,
  isRSCNavigation: false,
  basename: '/',
};

const createNoopRouterCleanup = (): RouterCleanup => ({
  get deferred() {
    return false;
  },
  run: async () => undefined,
  deferUntilBodyDone: response => response,
});

const createResponseProxy = (status: number): ResponseProxy => ({
  status,
  headers: {
    'x-router-status': String(status),
  },
});

describe('finalizeRenderResponse', () => {
  it.each([
    204, 205, 304,
  ])('drops the rendered body when applying no-body status %s', async status => {
    const { finalizeRenderResponse } = await import(
      '../../../src/core/server/requestResponse'
    );
    const response = new Response('<html>rendered</html>', {
      status: 200,
      headers: {
        'content-type': 'text/html',
      },
    });

    const finalized = finalizeRenderResponse(
      response,
      createResponseProxy(status),
      redirectCtx,
      createNoopRouterCleanup(),
    );

    expect(finalized.status).toBe(status);
    expect(finalized.headers.get('x-router-status')).toBe(String(status));
    expect(finalized.body).toBeNull();
    await expect(finalized.text()).resolves.toBe('');
  });
});
