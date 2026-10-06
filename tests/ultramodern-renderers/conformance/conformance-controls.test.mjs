import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';

// Direct native Request ownership tests. These do not certify HTTP transport,
// the installed data wire, SSR, streaming or either native application.
const modules = await Promise.all(
  ['solid', 'octane'].map(
    renderer => import(`./fixtures/${renderer}/src/conformance-controls.ts`),
  ),
);
let nextId = 0;

function request(id, privateValue, signal) {
  return new Request(`http://fixture/control?conformanceId=${id}`, {
    headers:
      privateValue === undefined
        ? {}
        : { 'x-conformance-private': privateValue },
    signal,
  });
}

function ownedProducer(t, controls, input) {
  const pending = controls.holdProducer(input);
  pending.catch(() => {});
  t.after(async () => {
    try {
      controls.releaseControl(input);
    } finally {
      input.signal.dispatchEvent(new Event('abort'));
      await Promise.allSettled([pending]);
    }
  });
  return pending;
}

for (const [index, renderer] of ['solid', 'octane'].entries()) {
  const controls = modules[index];

  test(`${renderer} holds private producers until explicit release and retires each once`, async t => {
    const id = `release-${nextId++}`;
    const first = request(id, 'private-a');
    const second = request(id, 'private-b');
    assert.deepEqual(await controls.observeControl(first).json(), {
      released: false,
      activeRequests: 0,
      cleanupCount: 0,
      cancelled: false,
    });
    const a = ownedProducer(t, controls, first);
    const b = ownedProducer(t, controls, second);
    assert.equal(getEventListeners(first.signal, 'abort').length, 1);
    assert.equal(getEventListeners(second.signal, 'abort').length, 1);
    let completed = false;
    a.then(() => {
      completed = true;
    });
    await Promise.resolve();
    assert.equal(completed, false);
    assert.deepEqual(await controls.observeControl(first).json(), {
      released: false,
      activeRequests: 2,
      cleanupCount: 0,
      cancelled: false,
    });
    assert.equal(controls.releaseControl(first).status, 200);
    assert.deepEqual(await Promise.all([a, b]), [
      'Native late value private-a',
      'Native late value private-b',
    ]);
    assert.equal(getEventListeners(first.signal, 'abort').length, 0);
    assert.equal(getEventListeners(second.signal, 'abort').length, 0);
    const final = {
      released: true,
      activeRequests: 0,
      cleanupCount: 2,
      cancelled: false,
    };
    assert.deepEqual(await controls.observeControl(first).json(), final);
    assert.deepEqual(await controls.releaseControl(first).json(), final);
    first.signal.dispatchEvent(new Event('abort'));
    assert.deepEqual(await controls.observeControl(first).json(), final);
    await assert.rejects(
      controls.holdProducer(first),
      error => error instanceof Response && error.status === 409,
    );
  });

  test(`${renderer} request abort retires once without cancelling its sibling`, async t => {
    const id = `abort-${nextId++}`;
    const controller = new AbortController();
    const aborted = request(id, 'cancelled-private', controller.signal);
    const survivor = request(id, 'survivor-private');
    const reason = new Error('native request cancelled');
    const rejected = assert.rejects(
      ownedProducer(t, controls, aborted),
      error => error === reason,
    );
    const pending = ownedProducer(t, controls, survivor);
    controller.abort(reason);
    await rejected;
    assert.deepEqual(await controls.observeControl(survivor).json(), {
      released: false,
      activeRequests: 1,
      cleanupCount: 1,
      cancelled: true,
    });
    controller.abort(new Error('second cancellation'));
    assert.equal(controls.releaseControl(survivor).status, 200);
    assert.equal(await pending, 'Native late value survivor-private');
    const final = {
      released: true,
      activeRequests: 0,
      cleanupCount: 2,
      cancelled: true,
    };
    assert.deepEqual(await controls.observeControl(survivor).json(), final);
    assert.deepEqual(await controls.releaseControl(survivor).json(), final);
  });

  test(`${renderer} handles an already aborted native Request without leaving a producer`, async t => {
    const id = `preabort-${nextId++}`;
    const controller = new AbortController();
    const reason = new Error('already cancelled');
    controller.abort(reason);
    const input = request(id, 'private', controller.signal);
    await assert.rejects(
      controls.holdProducer(input),
      error => error === reason,
    );
    assert.deepEqual(await controls.observeControl(input).json(), {
      released: false,
      activeRequests: 0,
      cleanupCount: 1,
      cancelled: true,
    });
  });

  test(`${renderer} bounds orphan producers at 30s and clears released timers`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const held = request(`timeout-${nextId++}`, 'timed-private');
    const timedOut = assert.rejects(
      ownedProducer(t, controls, held),
      /30s deadline/u,
    );
    t.mock.timers.tick(29_999);
    assert.equal(
      (await controls.observeControl(held).json()).activeRequests,
      1,
    );
    t.mock.timers.tick(1);
    await timedOut;
    assert.deepEqual(await controls.observeControl(held).json(), {
      released: false,
      activeRequests: 0,
      cleanupCount: 1,
      cancelled: false,
    });
    const completed = request(`timer-clean-${nextId++}`);
    const value = ownedProducer(t, controls, completed);
    controls.releaseControl(completed);
    assert.equal(await value, 'Native late value');
    t.mock.timers.tick(30_000);
    assert.deepEqual(await controls.observeControl(completed).json(), {
      released: true,
      activeRequests: 0,
      cleanupCount: 1,
      cancelled: false,
    });
  });

  test(`${renderer} validates group tokens and emits request-scoped repeated cookies`, async t => {
    for (const query of [
      '',
      '?conformanceId=',
      '?conformanceId=a&conformanceId=b',
      '?conformanceId=../../escape',
      `?conformanceId=${'a'.repeat(65)}`,
    ]) {
      const invalid = new Request(`http://fixture/control${query}`);
      assert.equal(controls.observeControl(invalid).status, 400);
      assert.equal(controls.releaseControl(invalid).status, 400);
      await assert.rejects(
        controls.holdProducer(invalid),
        error => error instanceof Response && error.status === 400,
      );
    }
    const input = request(`headers-${nextId++}`, 'private; cookie=value');
    const headers = controls.responseHeaders(input);
    assert.equal(
      headers.get('content-type'),
      'application/json; charset=utf-8',
    );
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.equal(headers.get('x-conformance-private'), 'private; cookie=value');
    assert.deepEqual(headers.getSetCookie(), [
      `conformance-group=${new URL(input.url).searchParams.get('conformanceId')}; Path=/; SameSite=Lax`,
      'conformance-private=private%3B%20cookie%3Dvalue; Path=/; SameSite=Lax',
    ]);
  });

  test(`${renderer} bounds group storage without evicting active producers`, async t => {
    const fresh = await import(
      `./fixtures/${renderer}/src/conformance-controls.ts?capacity=isolated`
    );
    const active = request('capacity-0', 'active-private');
    const pending = ownedProducer(t, fresh, active);
    for (let group = 1; group < 128; group += 1) {
      assert.equal(
        fresh.observeControl(request(`capacity-${group}`)).status,
        200,
      );
    }
    assert.equal(
      fresh.observeControl(request('capacity-overflow')).status,
      429,
    );
    assert.equal(
      fresh.releaseControl(request('capacity-overflow')).status,
      429,
    );
    await assert.rejects(
      fresh.holdProducer(request('capacity-overflow')),
      error => error instanceof Response && error.status === 429,
    );
    assert.equal((await fresh.observeControl(active).json()).activeRequests, 1);
    fresh.releaseControl(active);
    assert.equal(await pending, 'Native late value active-private');
  });
}

test('Solid and Octane control modules isolate the same group token', async t => {
  const input = request('cross-renderer-isolation', 'private');
  const solid = ownedProducer(t, modules[0], input);
  const octane = ownedProducer(t, modules[1], input);
  modules[0].releaseControl(input);
  assert.equal(await solid, 'Native late value private');
  assert.equal(
    (await modules[1].observeControl(input).json()).activeRequests,
    1,
  );
  modules[1].releaseControl(input);
  assert.equal(await octane, 'Native late value private');
});
