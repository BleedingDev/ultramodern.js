import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { startBridge } from './runtime.mjs';

async function openResponse(t, url, { body, ...options } = {}) {
  const request = http.request(url, { agent: false, ...options });
  t.after(() => request.destroy());
  const response = new Promise((resolve, reject) => {
    request.once('response', resolve);
    request.once('error', reject);
  });
  request.end(body);
  return { request, response: await response };
}

test('HTTP bridge preserves binary action requests and native response metadata', {
  timeout: 5000,
}, async t => {
  const requestBody = Buffer.from([0, 255, 128, 13, 10, 45, 0]);
  const responseBody = Buffer.from([255, 0, 129, 10, 13, 254]);
  const cookies = [
    'first=one; Path=/; HttpOnly',
    'second=two; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
  ];
  let dispatchCalls = 0;
  const bridge = await startBridge(
    {
      dispatchFetch(url, options) {
        dispatchCalls += 1;
        assert.equal(typeof url, 'string');
        assert.equal(url, 'https://react-rsc-proof.invalid/action?value=%2F');
        assert.equal(options.method, 'POST');
        assert.deepEqual(options.body, requestBody);
        assert.equal(
          options.headers['content-type'],
          'application/octet-stream',
        );
        assert.equal(options.headers['x-rsc-action'], 'compiled-action-id');
        assert.equal(options.headers.cookie, 'request=kept');
        assert.equal(options.signal.aborted, false);
        const headers = new Headers({
          'content-type': 'application/octet-stream',
          'x-native-response': 'preserved',
        });
        for (const cookie of cookies) headers.append('set-cookie', cookie);
        return new Response(responseBody, {
          status: 207,
          statusText: 'Native Multi-Status',
          headers,
        });
      },
    },
    'react-rsc-proof',
  );
  t.after(() => bridge.close());

  const { response } = await openResponse(t, `${bridge.url}/action?value=%2F`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': requestBody.length,
      'x-rsc-action': 'compiled-action-id',
      cookie: 'request=kept',
    },
    body: requestBody,
  });
  assert.equal(response.statusCode, 207);
  assert.equal(response.statusMessage, 'Native Multi-Status');
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.equal(response.headers['x-native-response'], 'preserved');
  assert.deepEqual(response.headers['set-cookie'], cookies);
  assert.deepEqual(
    Buffer.concat(await Array.fromAsync(response)),
    responseBody,
  );
  assert.equal(dispatchCalls, 1);
  assert.equal(bridge.evidence.length, 1);
  assert.equal(bridge.evidence[0].requestByteLength, requestBody.length);
  assert.equal(
    bridge.evidence[0].requestSha256,
    createHash('sha256').update(requestBody).digest('hex'),
  );
  assert.equal(bridge.evidence[0].action, 'compiled-action-id');
  assert.equal(bridge.evidence[0].status, 207);
});

test('HTTP bridge delivers stream bytes before the native response finishes', {
  timeout: 5000,
}, async t => {
  const first = Buffer.from('first-flight-chunk');
  const last = Buffer.from('last-flight-chunk');
  let streamController;
  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      controller.enqueue(first);
    },
  });
  const bridge = await startBridge(
    {
      dispatchFetch() {
        return new Response(stream, {
          headers: { 'content-type': 'text/x-component' },
        });
      },
    },
    'react-rsc-proof',
  );
  t.after(() => bridge.close());

  const { response } = await openResponse(t, `${bridge.url}/composite`, {
    headers: { 'x-rsc-tree': 'true' },
  });
  const iterator = response[Symbol.asyncIterator]();
  const received = [];
  let receivedLength = 0;
  while (receivedLength < first.length) {
    const chunk = await iterator.next();
    assert.equal(chunk.done, false);
    received.push(chunk.value);
    receivedLength += chunk.value.length;
  }
  assert.deepEqual(Buffer.concat(received), first);
  assert.equal(response.complete, false);
  assert.equal(bridge.evidence[0].tree, 'true');

  streamController.enqueue(last);
  streamController.close();
  while (true) {
    const chunk = await iterator.next();
    if (chunk.done) break;
    received.push(chunk.value);
  }
  assert.deepEqual(Buffer.concat(received), Buffer.concat([first, last]));
  assert.equal(response.complete, true);
  assert(!bridge.evidence.some(record => record.bridgeError));
});

test('HTTP disconnect aborts the dispatched request and cancels its response stream', {
  timeout: 5000,
}, async t => {
  const aborted = Promise.withResolvers();
  const canceled = Promise.withResolvers();
  let dispatchSignal;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('stream-is-open'));
    },
    cancel(reason) {
      canceled.resolve(reason);
    },
  });
  const bridge = await startBridge(
    {
      dispatchFetch(_url, options) {
        dispatchSignal = options.signal;
        dispatchSignal.addEventListener('abort', () => aborted.resolve(), {
          once: true,
        });
        return new Response(stream);
      },
    },
    'react-rsc-proof',
  );
  t.after(() => bridge.close());

  const { request, response } = await openResponse(t, bridge.url);
  response.once('error', () => {});
  const first = await response[Symbol.asyncIterator]().next();
  assert.equal(first.done, false);
  assert.equal(dispatchSignal.aborted, false);
  request.destroy();
  await aborted.promise;
  await canceled.promise;
  assert.equal(dispatchSignal.aborted, true);
  assert(!bridge.evidence.some(record => record.bridgeError));
});

test('HTTP bridge preserves HEAD and stops accepting requests after closure', {
  timeout: 5000,
}, async t => {
  let dispatchCalls = 0;
  let closed = false;
  const bridge = await startBridge(
    {
      dispatchFetch(_url, options) {
        dispatchCalls += 1;
        assert.equal(options.method, 'HEAD');
        assert.equal(Object.hasOwn(options, 'body'), false);
        return new Response(null, { status: 405, headers: { allow: 'POST' } });
      },
    },
    'react-rsc-proof',
  );
  t.after(async () => {
    if (!closed) await bridge.close();
  });

  const { response } = await openResponse(t, bridge.url, { method: 'HEAD' });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'POST');
  assert.equal(Buffer.concat(await Array.fromAsync(response)).length, 0);
  await bridge.close();
  closed = true;
  await assert.rejects(openResponse(t, bridge.url), { code: 'ECONNREFUSED' });
  assert.equal(dispatchCalls, 1);
});
