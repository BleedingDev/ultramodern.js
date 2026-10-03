import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import {
  holdProducer,
  observeControl,
  releaseControl,
  responseHeaders,
} from './fixtures/react/src/server/conformance-controls.ts';

// Direct owning Request/Response tests. No React host, transport bridge, stream,
// hydration, installed dependency, or browser behavior is certified here.
function input(id, privateValue, signal) {
  return new Request(`http://fixture/control?conformanceId=${id}`, {
    headers: { 'x-conformance-private': privateValue },
    signal,
  });
}

function ownProducer(t, request) {
  const pending = holdProducer(request);
  pending.catch(() => {});
  t.after(async () => {
    try {
      releaseControl(request);
    } finally {
      request.signal.dispatchEvent(new Event('abort'));
      await Promise.allSettled([pending]);
    }
  });
  return pending;
}

test('React owning controls hold overlapping private values until explicit release', async t => {
  const first = input('react-overlap', 'private-a');
  const second = input('react-overlap', 'private-b');
  const a = ownProducer(t, first);
  const b = ownProducer(t, second);
  assert.deepEqual(await observeControl(first).json(), {
    released: false,
    activeRequests: 2,
    cleanupCount: 0,
    cancelled: false,
  });
  assert.equal(getEventListeners(first.signal, 'abort').length, 1);
  assert.equal(getEventListeners(second.signal, 'abort').length, 1);
  assert.equal(releaseControl(first).status, 200);
  assert.deepEqual(await Promise.all([a, b]), [
    'Native late value private-a',
    'Native late value private-b',
  ]);
  assert.deepEqual(await releaseControl(second).json(), {
    released: true,
    activeRequests: 0,
    cleanupCount: 2,
    cancelled: false,
  });
  assert.equal(getEventListeners(first.signal, 'abort').length, 0);
  assert.equal(getEventListeners(second.signal, 'abort').length, 0);
});

test('React owning Request abort cleans exactly once and does not retire its sibling', async t => {
  const controller = new AbortController();
  const aborted = input('react-abort', 'aborted-private', controller.signal);
  const sibling = input('react-abort', 'sibling-private');
  const a = ownProducer(t, aborted);
  const b = ownProducer(t, sibling);
  const reason = new Error('owning request disconnected');
  controller.abort(reason);
  await assert.rejects(a, error => error === reason);
  aborted.signal.dispatchEvent(new Event('abort'));
  assert.deepEqual(await observeControl(aborted).json(), {
    released: false,
    activeRequests: 1,
    cleanupCount: 1,
    cancelled: true,
  });
  releaseControl(sibling);
  assert.equal(await b, 'Native late value sibling-private');
  assert.deepEqual(await releaseControl(sibling).json(), {
    released: true,
    activeRequests: 0,
    cleanupCount: 2,
    cancelled: true,
  });
  assert.equal(getEventListeners(aborted.signal, 'abort').length, 0);
  assert.equal(getEventListeners(sibling.signal, 'abort').length, 0);
});

test('React owning controls observe actual raw Response JSON and approved repeated headers', async () => {
  const request = input('react-response', 'private/response');
  const response = observeControl(request);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'application/json; charset=utf-8',
  );
  assert.deepEqual(await response.json(), {
    released: false,
    activeRequests: 0,
    cleanupCount: 0,
    cancelled: false,
  });
  const approved = responseHeaders(request);
  assert.equal(approved.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(approved.get('cache-control'), 'no-store');
  assert.equal(approved.get('x-conformance-private'), 'private/response');
  assert.deepEqual(approved.getSetCookie(), [
    'conformance-group=react-response; Path=/; SameSite=Lax',
    'conformance-private=private%2Fresponse; Path=/; SameSite=Lax',
  ]);
});

test('React invalid control tokens fail before allocating producers', async () => {
  for (const query of [
    '',
    '?conformanceId=',
    '?conformanceId=twice&conformanceId=twice',
    '?conformanceId=invalid/path',
    `?conformanceId=${'x'.repeat(65)}`,
  ]) {
    const request = new Request(`http://fixture/control${query}`);
    assert.equal(observeControl(request).status, 400);
    assert.equal(releaseControl(request).status, 400);
    await assert.rejects(
      holdProducer(request),
      error => error instanceof Response && error.status === 400,
    );
  }
});

test('React pre-aborted ownership and already released groups cannot leave producers', async t => {
  const controller = new AbortController();
  const reason = new Error('aborted before loader');
  controller.abort(reason);
  const request = input('react-pre-abort', 'private', controller.signal);
  await assert.rejects(ownProducer(t, request), error => error === reason);
  assert.deepEqual(await observeControl(request).json(), {
    released: false,
    activeRequests: 0,
    cleanupCount: 1,
    cancelled: true,
  });
  const released = input('react-already-released', 'private');
  releaseControl(released);
  await assert.rejects(
    holdProducer(released),
    error => error instanceof Response && error.status === 409,
  );
  assert.equal((await observeControl(released).json()).cleanupCount, 0);
});

test('React bounded orphan timer retires ownership and is cleared after explicit release', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const request = input('react-timeout', 'private');
  const pending = ownProducer(t, request);
  t.mock.timers.tick(29_999);
  assert.equal((await observeControl(request).json()).activeRequests, 1);
  t.mock.timers.tick(1);
  await assert.rejects(pending, /exceeded its 30s deadline/u);
  assert.deepEqual(await observeControl(request).json(), {
    released: false,
    activeRequests: 0,
    cleanupCount: 1,
    cancelled: false,
  });
  const released = input('react-cleared-timeout', 'private');
  const value = ownProducer(t, released);
  releaseControl(released);
  await value;
  t.mock.timers.tick(30_001);
  assert.equal((await observeControl(released).json()).cleanupCount, 1);
});
