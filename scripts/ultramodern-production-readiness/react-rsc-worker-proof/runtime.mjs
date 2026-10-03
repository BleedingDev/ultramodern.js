import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sha256 } from './contract.mjs';

export async function startBridge(runtime, workerName) {
  const evidence = [];
  const server = http.createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    incoming.once('aborted', () => controller.abort());
    outgoing.once('close', () => {
      if (!outgoing.writableEnded) controller.abort();
    });
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const record = {
        method: incoming.method,
        path: incoming.url,
        tree: incoming.headers['x-rsc-tree'] ?? null,
        action: incoming.headers['x-rsc-action'] ?? null,
        requestByteLength: body.length,
        requestSha256: sha256(body),
      };
      evidence.push(record);
      const response = await runtime.dispatchFetch(
        `https://${workerName}.invalid${incoming.url ?? '/'}`,
        {
          method: incoming.method,
          headers: incoming.headers,
          ...(body.length > 0 ? { body } : {}),
          signal: controller.signal,
        },
      );
      record.status = response.status;
      record.contentType = response.headers.get('content-type');
      outgoing.statusCode = response.status;
      outgoing.statusMessage = response.statusText;
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') outgoing.setHeader(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) outgoing.setHeader('set-cookie', cookies);
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body), outgoing);
      } else {
        outgoing.end();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      evidence.push({ bridgeError: error.message });
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end('workerd proof bridge failed');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    evidence,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    },
  };
}

export async function browserProof(browser, url) {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  const responses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request =>
    requests.push({
      url: request.url(),
      method: request.method(),
      navigation: request.isNavigationRequest(),
      headers: request.headers(),
    }),
  );
  page.on('response', response =>
    responses.push({
      url: response.url(),
      status: response.status(),
      headers: response.headers(),
      method: response.request().method(),
      requestHeaders: response.request().headers(),
    }),
  );
  try {
    await page.goto(`${url}/`, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.waitForSelector('#plain-page');
    const beforeNavigation = requests.length;
    await page.click('[data-testid="link-composite"]');
    await page.waitForSelector('#server-composite-output');
    await page.waitForSelector('#client-slot');
    await page.waitForSelector('#client-children');
    assert.equal(new URL(page.url()).pathname, '/composite');
    assert.equal(
      await page.$eval(
        '#server-composite-output',
        element => element.textContent,
      ),
      'server-rendered composite output',
    );
    assert.equal(
      await page.$eval('#client-slot', element => element.textContent),
      'client slot:slot-label-from-server',
    );
    assert.equal(
      await page.$eval('#client-children', element => element.textContent),
      'client child slot',
    );
    const navigationRequests = requests.slice(beforeNavigation);
    assert(
      !navigationRequests.some(request => request.navigation),
      'Native Link navigation performed a document reload',
    );
    assert(
      navigationRequests.some(request => request.headers['x-rsc-tree']),
      'Native Link navigation did not request Flight',
    );
    const treeResponses = responses.filter(
      response => response.requestHeaders['x-rsc-tree'],
    );
    assert(
      treeResponses.length > 0 &&
        treeResponses.every(response => response.status === 200),
      'Native Flight requests did not all succeed',
    );
    for (const expected of ['3', '6']) {
      await page.waitForFunction(
        () => document.querySelector('.server-increment')?.disabled === false,
      );
      await page.click('.server-increment');
      await page.waitForFunction(
        value =>
          document.querySelector('#action-result')?.textContent.trim() ===
          value,
        {},
        expected,
      );
    }
    const actionResponses = responses.filter(
      response => response.requestHeaders['x-rsc-action'],
    );
    assert.equal(
      actionResponses.length,
      2,
      'Expected two genuine compiled server actions',
    );
    for (const response of actionResponses) {
      assert.equal(response.method, 'POST');
      assert.equal(response.status, 200);
      assert(response.headers['content-type']?.includes('text/x-component'));
      assert(response.requestHeaders['x-rsc-action'].length > 0);
    }
    assert.deepEqual(errors, [], 'Browser reported runtime errors');
    return {
      nativeNavigation: true,
      documentReloads: 0,
      serverComposite: true,
      clientSlots: 2,
      actionValues: [3, 6],
      actionId: actionResponses[0].requestHeaders['x-rsc-action'],
      requests,
      responses,
      errors,
    };
  } finally {
    await page.close();
  }
}

export async function nativeFailureProof(url, actionId, signal) {
  const evidence = [];
  for (const method of ['GET', 'HEAD', 'PUT']) {
    const response = await fetch(url, {
      method,
      headers: { 'x-rsc-action': actionId, 'x-rsc-tree': 'true' },
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(60_000),
      ]),
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      bytes.toString(),
      method === 'HEAD' ? '' : 'Method not allowed',
    );
    evidence.push({
      method,
      status: response.status,
      allow: 'POST',
      sha256: sha256(bytes),
    });
  }
  for (const [label, body, expected] of [
    ['malformed', new Uint8Array([255]), 400],
    ['oversized', new Uint8Array(1024 * 1024 + 1), 413],
  ]) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-rsc-action': actionId, 'content-type': 'text/plain' },
      body,
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(60_000),
      ]),
    });
    assert.equal(response.status, expected, `Native ${label} action rejection`);
    const bytes = Buffer.from(await response.arrayBuffer());
    evidence.push({ label, status: response.status, sha256: sha256(bytes) });
  }
  return evidence;
}
