import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { probeHttp } from '../../../scripts/ultramodern-renderers/acceptance/http.mjs';

// These servers test the probe, not native application support. Candidate
// source/artifact identity must be bound by the application acceptance owner.
const runtimeIdentity = {
  renderer: 'react',
  appId: 'fixture',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'fixture-build',
};
const cookies = [
  'session=one; Path=/; HttpOnly',
  'theme=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
];
const document =
  '<!doctype html><html><head><title>Fixture</title><link rel="stylesheet" href="/fixture.css"><script nonce="fixture-nonce" src="/bootstrap.js"></script></head><body><main>server-rendered fixture</main></body></html>';

async function fixture(t, options = {}) {
  const timers = new Set();
  const concurrent = new Map();
  const events = [];
  let streamResponse;
  let streamActive = 0;
  let streamReleased = false;
  let abortActive = 0;
  let abortCancelled = false;
  let abortResponse;
  let cleanupCount = options.staleCleanup ? 1 : 0;
  const later = (callback, ms) => {
    const timer = setTimeout(callback, ms);
    timers.add(timer);
  };
  const json = (response, value) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(value));
  };
  const finishStream = () => {
    if (streamResponse && !streamResponse.destroyed) {
      events.push('final');
      streamResponse.end(' deferred-final</body></html>');
    }
  };
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://fixture').pathname;
      const controls = [
        '/stream-state',
        '/stream-release',
        '/abort-state',
        '/concurrent-state',
        '/concurrent-release',
      ];
      if (controls.includes(path)) {
        response.statusCode = options.controlStatus ?? 200;
      }
      if (!controls.includes(path) && !options.omitIdentity) {
        response.setHeader(
          options.identityHeader ?? 'x-ultramodern-renderer-identity',
          JSON.stringify(
            options.mixedIdentity
              ? { ...runtimeIdentity, renderer: 'solid' }
              : (options.identity ?? runtimeIdentity),
          ),
        );
      }
      if (path === '/doc' || path === '/bad-head') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader(
          'Set-Cookie',
          options.cookieMode === 'collapsed'
            ? cookies.join(', ')
            : options.cookieMode === 'reversed'
              ? [...cookies].reverse()
              : cookies,
        );
        response.setHeader('X-Features', ['ssr', 'assets']);
        response.end(
          path === '/bad-head'
            ? document
                .replace('<title>Fixture</title>', '')
                .replace('<main>', '<title>Fixture</title><main>')
            : document,
        );
      } else if (path === '/data') {
        json(response, {
          loader: 'loaded',
          request: request.headers['x-request-id'],
        });
      } else if (path === '/data-error') {
        response.statusCode = 422;
        json(response, {
          error: { code: 'INVALID_SEARCH', message: 'invalid search' },
        });
      } else if (path === '/action') {
        let body = '';
        for await (const chunk of request) body += chunk;
        response.statusCode = 303;
        response.setHeader('Location', '/saved');
        response.end(`saved:${body}`);
      } else if (path === '/not-found') {
        response.statusCode = 404;
        response.end('route-not-found');
      } else if (path === '/rsc') {
        response.statusCode = options.rscStatus ?? 400;
        json(response, {
          code: options.badDiagnostic ? 'WRONG_CODE' : 'NATIVE_RSC_UNSUPPORTED',
        });
      } else if (path === '/concurrent-state') {
        json(response, {
          activeRequests: options.staleConcurrent ? 2 : concurrent.size,
        });
      } else if (path === '/concurrent-release') {
        assert.equal(request.method, 'POST');
        for (const [id, held] of concurrent) {
          const actual = options.leakConcurrent ? 'request-b' : id;
          held.setHeader('x-request-id', actual);
          held.setHeader('set-cookie', `request=${actual}; Path=/`);
          held.end(`private:${actual}`);
        }
        concurrent.clear();
        json(response, { released: true });
      } else if (path === '/concurrent') {
        const id = request.headers['x-request-id'];
        concurrent.set(id, response);
        response.once('close', () => concurrent.delete(id));
      } else if (path === '/stream-state') {
        if (
          ['observer-final', 'observer-split'].includes(options.streamMode) &&
          streamActive > 0 &&
          !streamReleased
        ) {
          if (options.streamMode === 'observer-split') {
            streamResponse.write(' deferred-');
            later(() => streamResponse.write('final'), 5);
          } else {
            streamResponse.write(' deferred-final');
          }
          later(
            () =>
              json(response, {
                released: streamReleased,
                activeRequests: streamActive,
              }),
            30,
          );
        } else {
          json(response, {
            released: streamReleased,
            activeRequests: streamActive,
          });
        }
      } else if (path === '/stream-release') {
        assert.equal(request.method, 'POST');
        events.push('release');
        streamReleased = true;
        json(response, { released: true });
        finishStream();
      } else if (path === '/stream') {
        streamResponse = response;
        streamActive += 1;
        response.once('close', () => {
          streamActive -= 1;
        });
        response.setHeader('Content-Type', 'text/html');
        response.statusCode = options.streamStatus ?? 200;
        if (options.streamMode !== 'buffered') {
          events.push('first');
          response.write('<html><body>first-shell');
        }
        if (options.streamMode === 'eager') later(finishStream, 10);
        if (options.streamMode === 'closed') response.end();
      } else if (path === '/abort-state') {
        const observed = {
          cleanupCount,
          activeRequests: abortActive,
          cancelled: abortCancelled,
        };
        if (options.finishDuringObserver && abortActive === 1) {
          abortResponse.end();
          later(() => json(response, observed), 30);
        } else {
          json(response, observed);
        }
      } else if (path === '/abort') {
        abortResponse = response;
        abortActive += 1;
        response.once('close', () => {
          abortActive -= 1;
          abortCancelled = !response.writableFinished;
          if (!options.missingCleanup) cleanupCount += 1;
          if (options.doubleCleanup)
            later(() => {
              cleanupCount += 1;
            }, 15);
        });
        response.setHeader('Content-Type', 'text/html');
        response.write('abort-shell');
        if (options.finishedAbort) response.end();
      } else {
        response.statusCode = 404;
        response.end('unknown fixture endpoint');
      }
    } catch (error) {
      response.destroy(error);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    events,
    get cleanupCount() {
      return cleanupCount;
    },
  };
}

function probe(host, probes, options = {}) {
  return probeHttp({
    baseUrl: host.baseUrl,
    renderer: 'react',
    identity: { ...runtimeIdentity, renderer: options.renderer ?? 'react' },
    probes,
    timeoutMs: 1000,
    ...options,
  });
}

function htmlCase(overrides = {}) {
  return {
    id: 'document',
    dimension: 'ssr',
    path: '/doc',
    expect: {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': cookies,
        'x-features': 'ssr, assets',
      },
      bodyIncludes: ['<main>server-rendered fixture</main>'],
      bodyExcludes: ['react-rsc'],
    },
    ...overrides,
  };
}

function concurrentGroup() {
  return {
    id: 'request-isolation',
    dimension: 'data',
    readyPath: '/concurrent-state',
    releasePath: '/concurrent-release',
    cases: ['request-a', 'request-b'].map((id, index, ids) => ({
      id,
      dimension: 'data',
      path: '/concurrent',
      headers: { 'x-request-id': id },
      expect: {
        status: 200,
        headers: {
          'x-request-id': id,
          'set-cookie': [`request=${id}; Path=/`],
        },
        bodyIncludes: [`private:${id}`],
        bodyExcludes: [`private:${ids[1 - index]}`],
      },
    })),
  };
}

function streamCase(overrides = {}) {
  return {
    id: 'stream',
    path: '/stream',
    statePath: '/stream-state',
    releasePath: '/stream-release',
    firstIncludes: 'first-shell',
    finalIncludes: 'deferred-final',
    holdMs: 25,
    ...overrides,
  };
}

function abortCase() {
  return {
    id: 'abort',
    path: '/abort',
    statePath: '/abort-state',
    firstIncludes: 'abort-shell',
    expectCleanupCount: 1,
    settleMs: 40,
  };
}

test('observes HTML, head assets, repeated cookies, loader errors and action redirect without following it', async t => {
  const host = await fixture(t);
  const results = await probe(host, {
    cases: [
      htmlCase(),
      htmlCase({
        id: 'head',
        dimension: 'head-assets',
        expect: {
          status: 200,
          bodyIncludes: ['server-rendered fixture'],
          headIncludes: [
            '<title>Fixture</title>',
            'rel="stylesheet" href="/fixture.css"',
            'nonce="fixture-nonce"',
          ],
          headExcludes: ['unselected-renderer.js'],
        },
      }),
      {
        id: 'loader',
        dimension: 'data',
        path: '/data',
        headers: { 'x-request-id': 'loader-request' },
        expect: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          bodyIncludes: ['"loader":"loaded"', '"request":"loader-request"'],
        },
      },
      {
        id: 'loader-error',
        dimension: 'data',
        path: '/data-error',
        expect: {
          status: 422,
          bodyIncludes: ['INVALID_SEARCH', 'invalid search'],
        },
      },
      {
        id: 'not-found',
        dimension: 'data',
        path: '/not-found',
        expect: { status: 404, bodyIncludes: ['route-not-found'] },
      },
      {
        id: 'action',
        dimension: 'action',
        path: '/action',
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'sku=fixture-1',
        expect: {
          status: 303,
          headers: { location: '/saved' },
          bodyIncludes: ['saved:sku=fixture-1'],
        },
      },
    ],
  });
  assert.deepEqual(
    results.map(value => value.dimension),
    ['ssr', 'head-assets', 'data', 'action'],
  );
  assert.equal(results[0].observations.assertionCount, 10);
  assert.deepEqual(results[0].observations.cases[0].headers.setCookie, cookies);
  assert.equal(results[0].observations.identity, undefined);
  assert.equal(results[2].observations.cases.length, 3);
  for (const result of results)
    assert.ok(result.observations.assertionCount > 0);
});

test('compares observed runtime identity rather than copying candidate input', async t => {
  const host = await fixture(t);
  const specification = htmlCase();
  specification.expect.identity = runtimeIdentity;
  const result = await probe(host, { cases: [specification] });
  assert.deepEqual(
    result[0].observations.cases[0].observedIdentity,
    runtimeIdentity,
  );
  const mixed = await fixture(t, { mixedIdentity: true });
  await assert.rejects(
    probe(mixed, { cases: [specification] }),
    /observed renderer identity/u,
  );
});

test('rejects collapsed or reordered repeated cookies', async t => {
  for (const cookieMode of ['collapsed', 'reversed']) {
    const host = await fixture(t, { cookieMode });
    await assert.rejects(probe(host, { cases: [htmlCase()] }), /set-cookie/u);
  }
});

test('rejects assets outside the head region and HTML without positive render markers', async t => {
  const host = await fixture(t);
  await assert.rejects(
    probe(host, {
      cases: [
        htmlCase({
          path: '/bad-head',
          dimension: 'head-assets',
          expect: {
            status: 200,
            bodyIncludes: ['server-rendered fixture'],
            headIncludes: ['<title>Fixture</title>'],
          },
        }),
      ],
    }),
    /head must include/u,
  );
  await assert.rejects(
    probe(host, { cases: [htmlCase({ expect: { status: 200 } })] }),
    /positive body marker/u,
  );
});

test('holds concurrent requests together and checks private body, header and cookie isolation', async t => {
  const host = await fixture(t);
  const [result] = await probe(host, { concurrent: [concurrentGroup()] });
  assert.equal(result.dimension, 'data');
  assert.equal(result.observations.cases[0].initial.activeRequests, 0);
  assert.equal(result.observations.cases[0].ready.activeRequests, 2);
  assert.equal(result.observations.cases[0].responses.length, 2);
  assert.equal(result.observations.assertionCount, 17);
});

test('rejects cross-request leakage and stale concurrency observations', async t => {
  const leaking = await fixture(t, { leakConcurrent: true });
  await assert.rejects(
    probe(leaking, { concurrent: [concurrentGroup()] }),
    /x-request-id/u,
  );
  const stale = await fixture(t, { staleConcurrent: true });
  await assert.rejects(
    probe(stale, { concurrent: [concurrentGroup()] }),
    /initial active requests/u,
  );
});

test('requires explicit positive and negative isolation markers', async t => {
  const host = await fixture(t);
  const group = concurrentGroup();
  group.cases[0].expect.bodyExcludes = [];
  await assert.rejects(
    probe(host, { concurrent: [group] }),
    /exclude all other request markers/u,
  );
});

test('observes real first bytes and a held stream before explicitly releasing deferred output', async t => {
  const host = await fixture(t);
  const [result] = await probe(host, { stream: streamCase() });
  const facts = result.observations.cases[0];
  assert.equal(result.dimension, 'stream');
  assert.ok(facts.bytes > 0);
  assert.ok(facts.firstObservedAt < facts.releaseSentAt);
  assert.ok(facts.heldOpenMs >= 25);
  assert.deepEqual(
    [facts.baseline.released, facts.baseline.activeRequests],
    [false, 0],
  );
  assert.deepEqual(
    [facts.held.released, facts.held.activeRequests],
    [false, 1],
  );
  assert.equal(facts.afterRelease.released, true);
  assert.equal(facts.firstBeforeRelease, true);
  assert.equal(facts.finalAfterRelease, true);
  assert.deepEqual(host.events, ['first', 'release', 'final']);
});

test('rejects buffered output rather than releasing it to fabricate an early shell', async t => {
  const host = await fixture(t, { streamMode: 'buffered' });
  await assert.rejects(
    probe(host, { stream: streamCase() }, { timeoutMs: 100 }),
    /timed out|aborted/u,
  );
  assert.deepEqual(host.events, ['release']);
});

test('rejects final bytes, EOF and error status before release', async t => {
  const eager = await fixture(t, { streamMode: 'eager' });
  await assert.rejects(
    probe(eager, { stream: streamCase() }),
    /final marker arrived before release/u,
  );
  const closed = await fixture(t, { streamMode: 'closed' });
  await assert.rejects(
    probe(closed, { stream: streamCase() }),
    /stream ended before release/u,
  );
  const failed = await fixture(t, { streamStatus: 500 });
  await assert.rejects(
    probe(failed, { stream: streamCase() }),
    /stream response status/u,
  );
});

test('rejects final bytes received during the held-state observer request', async t => {
  const host = await fixture(t, { streamMode: 'observer-final' });
  await assert.rejects(
    probe(host, { stream: streamCase() }),
    /final marker arrived before release/u,
  );
});

test('cancels a live request and observes exactly one stable server cleanup', async t => {
  const host = await fixture(t);
  const [result] = await probe(host, { abort: abortCase() });
  const facts = result.observations.cases[0];
  assert.equal(result.dimension, 'abort');
  assert.deepEqual(
    [facts.baseline.cleanupCount, facts.baseline.activeRequests],
    [0, 0],
  );
  assert.deepEqual(
    [facts.active.cleanupCount, facts.active.activeRequests],
    [0, 1],
  );
  assert.deepEqual(
    [facts.cleaned.cleanupCount, facts.cleaned.activeRequests],
    [1, 0],
  );
  assert.ok(facts.stableSamples > 0);
  assert.equal(facts.stableForMs, 40);
  assert.equal(host.cleanupCount, 1);
});

test('rejects stale cleanup, normal completion and cleanup executed twice', async t => {
  const stale = await fixture(t, { staleCleanup: true });
  await assert.rejects(
    probe(stale, { abort: abortCase() }),
    /cleanup baseline/u,
  );
  const finished = await fixture(t, { finishedAbort: true });
  await assert.rejects(
    probe(finished, { abort: abortCase() }),
    /active before cancellation/u,
  );
  const double = await fixture(t, { doubleCleanup: true });
  await assert.rejects(
    probe(double, { abort: abortCase() }),
    /cleanup must stay exactly once|cleanup must run exactly once/u,
  );
});

test('times out if cancellation never produces server cleanup', async t => {
  const host = await fixture(t, { missingCleanup: true });
  await assert.rejects(
    probe(host, { abort: abortCase() }, { timeoutMs: 100 }),
    /timed out|aborted/u,
  );
});

test('reports native RSC rejection separately and requires the observed 400 diagnostic', async t => {
  const identity = { ...runtimeIdentity, renderer: 'solid' };
  const nativeRsc = {
    id: 'rsc',
    path: '/rsc',
    headers: { accept: 'text/x-component' },
    diagnosticCode: 'NATIVE_RSC_UNSUPPORTED',
    expect: { status: 400 },
  };
  const host = await fixture(t, { identity, omitIdentity: true });
  const [result] = await probe(host, { nativeRsc }, { renderer: 'solid' });
  assert.equal(result.dimension, 'rsc');
  assert.equal(
    result.observations.cases[0].diagnosticCode,
    'NATIVE_RSC_UNSUPPORTED',
  );
  assert.equal(result.observations.beforeRendererSetup, undefined);
  assert.equal(result.observations.cases[0].identityHeaderAbsent, true);
  assert.equal(result.observations.cases[0].observedIdentity, undefined);
  await assert.rejects(probe(host, { nativeRsc }), /non-React renderer/u);
  const wrong = await fixture(t, { badDiagnostic: true, identity });
  await assert.rejects(
    probe(wrong, { nativeRsc }, { renderer: 'solid' }),
    /body must include/u,
  );
  const status = await fixture(t, { rscStatus: 200, identity });
  await assert.rejects(
    probe(status, { nativeRsc }, { renderer: 'solid' }),
    /status/u,
  );
});

test('rejects concurrent groups that mislabel child dimensions', async t => {
  const host = await fixture(t);
  const group = concurrentGroup();
  group.dimension = 'ssr';
  await assert.rejects(
    probe(host, { concurrent: [group] }),
    /dimensions must match/u,
  );
});

test('continuously reads split final markers while waiting on the latch observer', async t => {
  const host = await fixture(t, { streamMode: 'observer-split' });
  await assert.rejects(
    probe(host, { stream: streamCase() }),
    /final marker arrived before release/u,
  );
});

test('distinguishes normal completion during observer latency from cancellation', async t => {
  const host = await fixture(t, { finishDuringObserver: true });
  await assert.rejects(
    probe(host, { abort: abortCase() }),
    /cleanup must observe request cancellation/u,
  );
});

test('requires real runtime identity on page, data, stream and abort responses', async t => {
  for (const probes of [
    { cases: [htmlCase()] },
    {
      cases: [
        {
          id: 'data',
          dimension: 'data',
          path: '/data',
          expect: { status: 200, bodyIncludes: ['loaded'] },
        },
      ],
    },
    { stream: streamCase() },
    { abort: abortCase() },
  ]) {
    const host = await fixture(t, { omitIdentity: true });
    await assert.rejects(
      probe(host, probes),
      /observed renderer identity header is required/u,
    );
  }
  const stale = await fixture(t, {
    identity: { ...runtimeIdentity, buildId: 'stale-build' },
  });
  await assert.rejects(
    probe(stale, { cases: [htmlCase()] }),
    /observed renderer identity/u,
  );
});

test('supports an explicit fixture-owned identity header name', async t => {
  const host = await fixture(t, { identityHeader: 'x-fixture-profile' });
  const [result] = await probe(
    host,
    { cases: [htmlCase()] },
    { identityHeader: 'x-fixture-profile' },
  );
  assert.deepEqual(
    result.observations.cases[0].observedIdentity,
    runtimeIdentity,
  );
});

test('delegates control decoding with the actual unconsumed response and request context', async t => {
  const host = await fixture(t);
  const calls = [];
  const results = await probe(
    host,
    {
      concurrent: [concurrentGroup()],
      stream: streamCase({
        statePath: '/stream-state?scope=actual',
        releasePath: '/stream-release?scope=actual',
      }),
      abort: abortCase(),
    },
    {
      decodeControlResponse: async (response, context) => {
        assert.ok(response instanceof Response);
        assert.equal(response.bodyUsed, false);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/json');
        assert.equal(context.url, response.url);
        assert.equal(new URL(context.url).origin, host.baseUrl);
        assert.equal(
          context.method,
          new URL(context.url).pathname.endsWith('-release') ? 'POST' : 'GET',
        );
        assert.ok(context.signal instanceof AbortSignal);
        assert.equal(context.signal.aborted, false);
        calls.push(context);
        // This simulator uses JSON. Actual native decoding is supplied by the
        // caller's installed public data protocol, not by this driver.
        return response.json();
      },
    },
  );
  assert.deepEqual(
    results.map(result => result.dimension),
    ['data', 'stream', 'abort'],
  );
  assert.ok(
    calls.some(
      context => context.url === `${host.baseUrl}/stream-state?scope=actual`,
    ),
  );
  assert.ok(
    calls.some(
      context =>
        context.url === `${host.baseUrl}/stream-release?scope=actual` &&
        context.method === 'POST',
    ),
  );
});

test('propagates decoder errors without retrying the raw JSON control body', async t => {
  const host = await fixture(t);
  const expected = new Error('native control identity rejected');
  let calls = 0;
  await assert.rejects(
    probe(
      host,
      { abort: abortCase() },
      {
        decodeControlResponse: () => {
          calls += 1;
          throw expected;
        },
      },
    ),
    error => error === expected,
  );
  assert.equal(calls, 1);
});

test('rejects failed control HTTP status before invoking the decoder', async t => {
  const host = await fixture(t, { controlStatus: 500 });
  let called = false;
  await assert.rejects(
    probe(
      host,
      { abort: abortCase() },
      {
        decodeControlResponse: () => {
          called = true;
          return {};
        },
      },
    ),
    /fixture control status/u,
  );
  assert.equal(called, false);
});

test('rejects invalid decoded control values instead of treating them as state', async t => {
  for (const value of [null, undefined, 7, 'state', []]) {
    const host = await fixture(t);
    await assert.rejects(
      probe(
        host,
        { abort: abortCase() },
        { decodeControlResponse: () => value },
      ),
      /decoded fixture control state must be an object/u,
    );
  }
});

test('times out a decoder that ignores its abort signal and never settles', async t => {
  const host = await fixture(t);
  let signal;
  await assert.rejects(
    probe(
      host,
      { abort: abortCase() },
      {
        timeoutMs: 100,
        decodeControlResponse: (_response, context) => {
          signal = context.signal;
          return new Promise(() => {});
        },
      },
    ),
    /HTTP probe timed out/u,
  );
  assert.equal(signal.aborted, true);
});

test('copies decoded control snapshots before a shared callback object can change them', async t => {
  const host = await fixture(t);
  const shared = {};
  const [result] = await probe(
    host,
    { stream: streamCase() },
    {
      decodeControlResponse: async response => {
        Object.assign(shared, await response.json());
        return shared;
      },
    },
  );
  const facts = result.observations.cases[0];
  Object.assign(shared, { released: 'mutated', activeRequests: 999 });
  assert.deepEqual(facts.baseline, { released: false, activeRequests: 0 });
  assert.deepEqual(facts.held, { released: false, activeRequests: 1 });
  assert.equal(facts.afterRelease.released, true);
});

test('requires decoded control state to pass the existing lifecycle validations', async t => {
  const host = await fixture(t);
  await assert.rejects(
    probe(
      host,
      { abort: abortCase() },
      {
        decodeControlResponse: async response => ({
          ...(await response.json()),
          cancelled: true,
        }),
      },
    ),
    /cleanup baseline/u,
  );
});

test('rejects empty probes, vacuous stream markers and paths outside the fixture origin', async t => {
  const host = await fixture(t);
  await assert.rejects(probe(host, {}), /at least one probe/u);
  await assert.rejects(
    probe(host, { stream: streamCase({ firstIncludes: '' }) }),
    /nonempty strings/u,
  );
  await assert.rejects(
    probe(host, { cases: [htmlCase({ path: '//elsewhere.invalid/doc' })] }),
    /fixture origin/u,
  );
  await assert.rejects(
    probe(host, { cases: [htmlCase({ dimension: 'hydration' })] }),
    /unsupported dimension/u,
  );
});
