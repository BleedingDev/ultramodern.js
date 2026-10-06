import assert from 'node:assert/strict';
import { CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS } from '@modern-js/app-tools-extensions/cloudflare-output-contract';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

/**
 * Regression coverage for the deployed-Cloudflare-Worker defect where
 * `request.signal` never fires on client disconnect: that only happens when
 * the Worker's compatibility flags include `enable_request_signal`, and the
 * generator/deploy pipeline did not set it (see
 * `CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS` in
 * `app-tools-extensions/src/cloudflare-output-contract.ts`, which every
 * generated `wrangler.json` and the Cloudflare output verifier now derive
 * from).
 *
 * workerd rejects an unrecognized compatibility flag outright at startup, so
 * confirming a worker boots with `enable_request_signal` set (and that an
 * actually-bogus flag name does *not* boot) is a meaningful guard against a
 * silent typo in the flag name shipped by the framework. This environment's
 * Miniflare build does not reproduce genuine client-socket disconnection
 * (`request.signal` never fired here even with the flag set, regardless of
 * closing the underlying TCP connection), so this test cannot assert on the
 * disconnect-triggers-abort behavior itself. The code paths that *consume*
 * `request.signal` once the platform fires it — `createRequestSession` in
 * `renderer-core/src/session/request.ts` (used by `server/worker.ts` for the
 * native Solid/Octane dispatch) and the React SSR stream in
 * `plugin-runtime/src/core/server/stream/createReadableStream.worker.ts` —
 * already have direct unit coverage driving a real `AbortController` through
 * `request.signal` (see `renderer-core/tests/session/request.test.ts` and
 * `plugin-runtime/tests/ssr/serverRender/workerLifecycle.test.tsx`); this
 * test only has to confirm the platform-level flag is real and present.
 */
test('CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS includes a compatibility flag name workerd actually recognizes, and `request.signal` reaches the Worker as a real AbortSignal', async () => {
  assert(
    CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS.includes('enable_request_signal'),
    'enable_request_signal must stay a required Cloudflare compatibility flag',
  );

  const script = `
export default {
  async fetch(request) {
    return Response.json({
      hasSignal: request.signal instanceof AbortSignal,
      aborted: request.signal.aborted,
    });
  },
};
`;

  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: '2026-06-02',
      compatibilityFlags: [...CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS],
    }),
  );
  try {
    const response = await worker.dispatchFetch('http://worker.example/');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hasSignal: true,
      aborted: false,
    });
  } finally {
    await worker.dispose();
  }

  // A genuinely unrecognized flag name fails workerd startup outright. This
  // is the guard against shipping a silently-misspelled flag: if
  // `enable_request_signal` were not a real flag, this whole test would fail
  // the same way the next instantiation is expected to.
  await assert.rejects(async () => {
    const bogus = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script,
        compatibilityDate: '2026-06-02',
        compatibilityFlags: ['nodejs_compat', 'totally_bogus_flag_xyz'],
      }),
    );
    try {
      await bogus.ready;
    } finally {
      await bogus.dispose();
    }
  }, /compatibility flag|runtime failed to start/iu);
});
