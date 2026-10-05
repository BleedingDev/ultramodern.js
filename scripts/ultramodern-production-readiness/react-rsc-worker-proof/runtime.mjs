import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { sha256 } from './contract.mjs';

const processSnapshot = () =>
  execFileSync(
    '/bin/ps',
    ['-A', '-o', 'pid=', '-o', 'pgid=', '-o', 'uid=', '-o', 'stat='],
    {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    },
  );

export function inspectOwnedProcessGroup(
  groupId,
  {
    snapshotImpl = processSnapshot,
    effectiveUid = process.geteuid(),
    observerPid = process.pid,
  } = {},
) {
  assert(Number.isSafeInteger(groupId) && groupId > 1);
  assert(
    Number.isSafeInteger(effectiveUid) &&
      effectiveUid >= 0 &&
      effectiveUid <= 0xffff_ffff,
  );
  const inspectedAt = new Date().toISOString();
  const output = snapshotImpl();
  assert(
    typeof output === 'string' && output.endsWith('\n'),
    'Owned process inspection must return a complete snapshot',
  );
  const processes = new Map();
  for (const line of output.trim().split('\n')) {
    const fields = line.trim().split(/\s+/u);
    assert.equal(fields.length, 4, 'Invalid owned process inspection row');
    assert(
      fields.slice(0, 2).every(field => /^\d+$/u.test(field)),
      'Invalid owned process inspection identifier',
    );
    const [pid, pgid] = fields.slice(0, 2).map(Number);
    assert(
      [pid, pgid].every(
        value =>
          Number.isSafeInteger(value) && value >= 0 && value <= 0x7fff_ffff,
      ),
      'Invalid owned process inspection identifier',
    );
    assert(
      /^-?(?:0|[1-9]\d*)$/u.test(fields[2]) && fields[2] !== '-0',
      'Invalid owned process inspection UID',
    );
    const printedUid = Number(fields[2]);
    assert(
      Number.isSafeInteger(printedUid) &&
        printedUid >= -0x8000_0000 &&
        printedUid <= 0xffff_ffff,
      'Invalid owned process inspection UID',
    );
    // Darwin ps prints its unsigned 32-bit uid_t using a signed format.
    const uid = printedUid < 0 ? printedUid + 0x1_0000_0000 : printedUid;
    // Darwin reports `?` when task state cannot be read during inspection.
    // That is potentially live, never evidence authorizing a cleanup skip.
    assert(
      /^[?DHIRSTUWXZtx][A-Za-z+<>-]*$/u.test(fields[3]),
      `Invalid owned process inspection state: ${JSON.stringify({
        pid,
        pgid,
        uid,
        state: fields[3],
      })}`,
    );
    assert(!processes.has(pid), 'Duplicate owned process inspection row');
    processes.set(pid, {
      pid,
      pgid,
      uid,
      state: fields[3],
      // A Linux exited leader can still have live threads (the `l` flag).
      live: !['Z', 'X', 'x'].includes(fields[3][0]) || fields[3].includes('l'),
    });
  }
  assert.equal(
    processes.get(observerPid)?.uid,
    effectiveUid,
    'Owned process inspection must include its actual observer',
  );
  const members = [...processes.values()]
    .filter(member => member.pgid === groupId)
    .sort((left, right) => left.pid - right.pid);
  const snapshot = {
    groupId,
    effectiveUid,
    inspectedAt,
    processCount: processes.size,
    members,
    liveMemberCount: members.filter(member => member.live).length,
  };
  if (members.some(member => member.uid !== effectiveUid)) {
    const error = new Error('Owned process group contains a foreign member');
    error.membership = { before: snapshot };
    throw error;
  }
  return snapshot;
}

export async function retireOwnedProcessGroup(
  groupId,
  { killImpl = process.kill, ...inspectionOptions } = {},
) {
  const before = inspectOwnedProcessGroup(groupId, inspectionOptions);
  if (before.members.some(member => member.pid === groupId && member.live)) {
    const error = new Error('Closed owned process group has a live leader');
    error.membership = { before };
    throw error;
  }
  if (before.liveMemberCount === 0) return { before, signaled: false };
  let signalResult = 'delivered';
  try {
    killImpl(-groupId, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') {
      error.membership = { before };
      error.cleanupSignal = 'SIGKILL';
      throw error;
    }
    signalResult = 'absent';
  }
  const deadline = Date.now() + 2000;
  let observationCount = 0;
  for (;;) {
    let after;
    try {
      after = inspectOwnedProcessGroup(groupId, inspectionOptions);
    } catch (error) {
      const observed = error.membership?.before;
      error.membership = { before, ...(observed ? { after: observed } : {}) };
      throw error;
    }
    observationCount += 1;
    const retirement = {
      before,
      after,
      signaled: signalResult === 'delivered',
      signalResult,
      observationCount,
    };
    if (after.members.some(member => member.pid === groupId && member.live)) {
      const error = new Error('Retired owned process group has a live leader');
      error.membership = retirement;
      throw error;
    }
    if (after.liveMemberCount === 0) return retirement;
    if (Date.now() >= deadline) {
      const error = new Error(
        'Owned process group still contains live members',
      );
      error.membership = retirement;
      throw error;
    }
    await delay(25);
  }
}

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
  const requestIndices = new WeakMap();
  let flightTarget;
  let beforeNavigation;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    requestIndices.set(request, requests.length);
    requests.push({
      url: request.url(),
      method: request.method(),
      navigation: request.isNavigationRequest(),
      headers: request.headers(),
    });
  });
  page.on('response', response =>
    responses.push({
      url: response.url(),
      status: response.status(),
      headers: response.headers(),
      method: response.request().method(),
      requestHeaders: response.request().headers(),
      requestIndex: requestIndices.get(response.request()),
    }),
  );
  try {
    await page.goto(`${url}/`, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.waitForSelector('#plain-page');
    flightTarget = new URL(
      await page.$eval(
        '[data-testid="link-composite"]',
        element => element.href,
      ),
    );
    assert.equal(flightTarget.origin, new URL(url).origin);
    flightTarget.hash = '';
    beforeNavigation = requests.length;
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
    // Native viewport preloading may deliver Flight before the click.
    const flightRequestIndices = requests.flatMap((request, index) =>
      request.url === flightTarget.href &&
      request.method === 'GET' &&
      request.headers['x-rsc-tree'] === 'true' &&
      !request.navigation
        ? [index]
        : [],
    );
    assert(
      flightRequestIndices.length > 0,
      'Native Link target did not request Flight',
    );
    const flightResponseIndices = responses.flatMap((response, index) =>
      flightRequestIndices.includes(response.requestIndex) ? [index] : [],
    );
    assert(
      flightRequestIndices.every(requestIndex =>
        flightResponseIndices.some(
          index => responses[index].requestIndex === requestIndex,
        ),
      ) &&
        flightResponseIndices.every(index => {
          const response = responses[index];
          return (
            response.url === flightTarget.href &&
            response.method === 'GET' &&
            response.requestHeaders['x-rsc-tree'] === 'true' &&
            response.status === 200
          );
        }),
      'Native Link target Flight requests did not all succeed',
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
      flight: {
        url: flightTarget.href,
        preload: flightRequestIndices.some(index => index < beforeNavigation),
        click: flightRequestIndices.some(index => index >= beforeNavigation),
        requestIndices: flightRequestIndices,
        responseIndices: flightResponseIndices,
      },
      navigationRequests: requests.slice(beforeNavigation),
      requests,
      responses,
      errors,
    };
  } catch (error) {
    error.browserEvidence = {
      requests,
      responses,
      errors,
      ...(flightTarget ? { flightTarget: flightTarget.href } : {}),
      ...(beforeNavigation === undefined
        ? {}
        : { navigationRequests: requests.slice(beforeNavigation) }),
    };
    throw error;
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
