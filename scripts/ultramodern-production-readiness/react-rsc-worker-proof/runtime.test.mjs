import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  inspectOwnedProcessGroup,
  retireOwnedProcessGroup,
  startBridge,
} from './runtime.mjs';

const groupId = 91002;
const inspectionOptions = { effectiveUid: 501, observerPid: 91001 };
const processSnapshot = (...members) =>
  `91001 91001 501 S\n${members.map(member => `${member}\n`).join('')}`;

test('process group inspection filters the exact group and preserves zombie and live-thread states', () => {
  const snapshot = inspectOwnedProcessGroup(groupId, {
    ...inspectionOptions,
    snapshotImpl: () =>
      processSnapshot(
        '91004 91002 501 Zl',
        '91003 91002 501 Z+',
        '91005 91002 501 H',
        '91006 91002 501 X',
        '91007 91002 501 x',
        '92000 92000 502 R',
        '0 0 0 R',
      ),
  });
  assert.equal(snapshot.groupId, groupId);
  assert.equal(snapshot.effectiveUid, 501);
  assert.equal(snapshot.processCount, 8);
  assert(Number.isFinite(Date.parse(snapshot.inspectedAt)));
  assert.deepEqual(snapshot.members, [
    { pid: 91003, pgid: groupId, uid: 501, state: 'Z+', live: false },
    { pid: 91004, pgid: groupId, uid: 501, state: 'Zl', live: true },
    { pid: 91005, pgid: groupId, uid: 501, state: 'H', live: true },
    { pid: 91006, pgid: groupId, uid: 501, state: 'X', live: false },
    { pid: 91007, pgid: groupId, uid: 501, state: 'x', live: false },
  ]);
  assert.equal(snapshot.liveMemberCount, 2);
});

test('process group inspection rejects incomplete, malformed, and observer-free snapshots', () => {
  for (const output of [
    Buffer.from(processSnapshot()),
    processSnapshot().trimEnd(),
    processSnapshot('91003 91002 501'),
    processSnapshot('91003 91002 -2147483649 S'),
    processSnapshot('91003 91002 4294967296 S'),
    processSnapshot('91003 91002 -0 S'),
    processSnapshot('2147483648 91002 501 S'),
    processSnapshot('91003 2147483648 501 S'),
    processSnapshot('91003 91002 1.5 S'),
    processSnapshot('9007199254740992 91002 501 S'),
    processSnapshot('91003 91002 501 unknown'),
    processSnapshot('91003 91002 501 S', '91003 91002 501 Z'),
    '91003 91002 501 S\n',
    '91001 91001 502 S\n',
  ]) {
    assert.throws(() =>
      inspectOwnedProcessGroup(groupId, {
        ...inspectionOptions,
        snapshotImpl: () => output,
      }),
    );
  }
});

test('signed Darwin nobody UIDs in unrelated groups do not invalidate ownership inspection', () => {
  const snapshot = inspectOwnedProcessGroup(groupId, {
    ...inspectionOptions,
    snapshotImpl: () =>
      processSnapshot('91003 91002 501 S', '619 619 -2 S', '14088 14088 -2 S'),
  });
  assert.equal(snapshot.processCount, 4);
  assert.deepEqual(snapshot.members, [
    { pid: 91003, pgid: groupId, uid: 501, state: 'S', live: true },
  ]);
});

test('Darwin unavailable task states remain potentially live and retain group ownership', async () => {
  const snapshot = inspectOwnedProcessGroup(groupId, {
    ...inspectionOptions,
    snapshotImpl: () =>
      processSnapshot('91003 91002 501 ?s+', '92000 92000 502 ?'),
  });
  assert.deepEqual(snapshot.members, [
    { pid: 91003, pgid: groupId, uid: 501, state: '?s+', live: true },
  ]);
  assert.equal(snapshot.processCount, 3);
  assert.equal(snapshot.liveMemberCount, 1);
  const denied = Object.assign(new Error('Owned group signal denied'), {
    code: 'EPERM',
  });
  await assert.rejects(
    () =>
      retireOwnedProcessGroup(groupId, {
        ...inspectionOptions,
        snapshotImpl: () => processSnapshot('91003 91002 501 ?'),
        killImpl: () => {
          throw denied;
        },
      }),
    error => {
      assert.equal(error, denied);
      assert.equal(error.membership.before.members[0].state, '?');
      assert.equal(error.membership.before.liveMemberCount, 1);
      return true;
    },
  );
  await assert.rejects(
    () =>
      retireOwnedProcessGroup(groupId, {
        ...inspectionOptions,
        snapshotImpl: () => processSnapshot('91003 91002 502 ?'),
        killImpl: () => assert.fail('Foreign members must never be signalled'),
      }),
    /foreign member/u,
  );
});

test('invalid state diagnostics retain only the rejected numeric process row', () => {
  assert.throws(
    () =>
      inspectOwnedProcessGroup(groupId, {
        ...inspectionOptions,
        snapshotImpl: () => processSnapshot('91003 91002 501 S='),
      }),
    error => {
      assert.equal(
        error.message,
        'Invalid owned process inspection state: {"pid":91003,"pgid":91002,"uid":501,"state":"S="}',
      );
      return true;
    },
  );
});

test('an unavailable Darwin state cannot prove retirement after a signal', {
  timeout: 5000,
}, async () => {
  let signals = 0;
  await assert.rejects(
    () =>
      retireOwnedProcessGroup(groupId, {
        ...inspectionOptions,
        snapshotImpl: () => processSnapshot('91003 91002 501 ?'),
        killImpl: () => {
          signals += 1;
        },
      }),
    error => {
      assert.match(error.message, /still contains live members/u);
      assert.equal(error.membership.before.members[0].state, '?');
      assert.equal(error.membership.after.members[0].state, '?');
      assert.equal(error.membership.after.liveMemberCount, 1);
      return true;
    },
  );
  assert.equal(signals, 1);
});

test('signed and unsigned uid_t presentations bind the same observer and group owner', () => {
  for (const [printedUid, effectiveUid] of [
    ['-2147483648', 2147483648],
    ['-2', 4294967294],
    ['-1', 4294967295],
    ['4294967294', 4294967294],
    ['4294967295', 4294967295],
  ]) {
    const snapshot = inspectOwnedProcessGroup(groupId, {
      observerPid: 91001,
      effectiveUid,
      snapshotImpl: () =>
        `91001 91001 ${printedUid} S\n91003 91002 ${printedUid} S\n`,
    });
    assert.equal(snapshot.members[0].uid, effectiveUid);
    assert.equal(snapshot.effectiveUid, effectiveUid);
    assert.equal(snapshot.liveMemberCount, 1);
  }
});

test('a selected signed nobody UID remains a foreign member and cannot authorize a signal', async () => {
  await assert.rejects(
    () =>
      retireOwnedProcessGroup(groupId, {
        ...inspectionOptions,
        snapshotImpl: () => processSnapshot('91003 91002 -2 S'),
        killImpl: () => assert.fail('Foreign members must never be signalled'),
      }),
    error => {
      assert.match(error.message, /foreign member/u);
      assert.equal(error.membership.before.members[0].uid, 4294967294);
      assert.equal(error.membership.before.effectiveUid, 501);
      return true;
    },
  );
});

test('process group retirement retains inspection failures and never signals without authority', async () => {
  const denied = Object.assign(new Error('Process inspection denied'), {
    code: 'EPERM',
  });
  let signals = 0;
  await assert.rejects(
    () =>
      retireOwnedProcessGroup(groupId, {
        ...inspectionOptions,
        snapshotImpl: () => {
          throw denied;
        },
        killImpl: () => {
          signals += 1;
        },
      }),
    error => error === denied,
  );
  for (const member of ['91003 91002 502 S', '91003 91002 502 Z']) {
    await assert.rejects(
      () =>
        retireOwnedProcessGroup(groupId, {
          ...inspectionOptions,
          snapshotImpl: () => processSnapshot(member),
          killImpl: () => {
            signals += 1;
          },
        }),
      error => {
        assert.match(error.message, /foreign member/u);
        assert.equal(error.membership.before.members[0].uid, 502);
        return true;
      },
    );
  }
  for (const state of ['S', '?']) {
    await assert.rejects(
      () =>
        retireOwnedProcessGroup(groupId, {
          ...inspectionOptions,
          snapshotImpl: () => processSnapshot(`91002 91002 501 ${state}`),
          killImpl: () => {
            signals += 1;
          },
        }),
      /live leader/u,
    );
  }
  assert.equal(signals, 0);
});

test('process group retirement skips verified empty and plain-zombie groups', async () => {
  for (const members of [[], ['91002 91002 501 Z', '91003 91002 501 Z+']]) {
    const retirement = await retireOwnedProcessGroup(groupId, {
      ...inspectionOptions,
      snapshotImpl: () => processSnapshot(...members),
      killImpl: () =>
        assert.fail('A verified nonlive group must not be signalled'),
    });
    assert.equal(retirement.signaled, false);
    assert.equal(retirement.before.liveMemberCount, 0);
    assert.equal(retirement.after, undefined);
  }
});

test('process group retirement retains denied signals and the preceding observed membership', async () => {
  const denied = Object.assign(new Error('Owned group signal denied'), {
    code: 'EPERM',
  });
  let snapshots = 0;
  await assert.rejects(
    () =>
      retireOwnedProcessGroup(groupId, {
        ...inspectionOptions,
        snapshotImpl: () => {
          snapshots += 1;
          return processSnapshot('91003 91002 501 Zl');
        },
        killImpl: (pid, signal) => {
          assert.equal(pid, -groupId);
          assert.equal(signal, 'SIGKILL');
          throw denied;
        },
      }),
    error => {
      assert.equal(error, denied);
      assert.equal(error.membership.before.liveMemberCount, 1);
      assert.equal(error.membership.before.members[0].state, 'Zl');
      return true;
    },
  );
  assert.equal(snapshots, 1);
});

test('process group retirement requires fresh nonlive membership after a signal or ESRCH', {
  timeout: 10_000,
}, async () => {
  for (const signalCode of [undefined, 'ESRCH']) {
    for (const remainsLive of [false, true]) {
      let snapshots = 0;
      let signals = 0;
      const retire = () =>
        retireOwnedProcessGroup(groupId, {
          ...inspectionOptions,
          snapshotImpl: () => {
            snapshots += 1;
            return processSnapshot(
              ...(snapshots === 1 || remainsLive ? ['91003 91002 501 S'] : []),
            );
          },
          killImpl: (pid, signal) => {
            signals += 1;
            assert.equal(pid, -groupId);
            assert.equal(signal, 'SIGKILL');
            if (signalCode)
              throw Object.assign(new Error(signalCode), { code: signalCode });
          },
        });
      if (remainsLive) {
        await assert.rejects(retire, error => {
          assert.match(error.message, /still contains live members/u);
          assert.equal(error.membership.before.liveMemberCount, 1);
          assert.equal(error.membership.after.liveMemberCount, 1);
          return true;
        });
      } else {
        const retirement = await retire();
        assert.equal(retirement.signaled, signalCode !== 'ESRCH');
        assert.equal(
          retirement.signalResult,
          signalCode ? 'absent' : 'delivered',
        );
        assert.equal(retirement.before.liveMemberCount, 1);
        assert.equal(retirement.after.liveMemberCount, 0);
      }
      assert.equal(signals, 1);
      assert(snapshots >= 2);
    }
  }
});

test('post-signal inspection failures retain the original authority and never repeat the signal', async () => {
  for (const failure of ['inspection', 'parse', 'foreign']) {
    let snapshots = 0;
    let signals = 0;
    const denied = new Error('Post-signal inspection denied');
    await assert.rejects(
      () =>
        retireOwnedProcessGroup(groupId, {
          ...inspectionOptions,
          snapshotImpl: () => {
            snapshots += 1;
            if (snapshots === 1) return processSnapshot('91003 91002 501 S');
            if (failure === 'inspection') throw denied;
            if (failure === 'parse') return processSnapshot().trimEnd();
            return processSnapshot('91003 91002 502 S');
          },
          killImpl: () => {
            signals += 1;
          },
        }),
      error => {
        if (failure === 'inspection') assert.equal(error, denied);
        assert.equal(error.membership.before.members[0].uid, 501);
        if (failure === 'foreign') {
          assert.equal(error.membership.after.members[0].uid, 502);
        } else assert.equal(error.membership.after, undefined);
        return true;
      },
    );
    assert.equal(signals, 1);
    assert.equal(snapshots, 2);
  }
});

test('delayed process exit is observed without repeating the successful signal', async () => {
  let snapshots = 0;
  let signals = 0;
  const retirement = await retireOwnedProcessGroup(groupId, {
    ...inspectionOptions,
    snapshotImpl: () => {
      snapshots += 1;
      return processSnapshot(...(snapshots <= 2 ? ['91003 91002 501 S'] : []));
    },
    killImpl: (pid, signal) => {
      signals += 1;
      assert.equal(pid, -groupId);
      assert.equal(signal, 'SIGKILL');
    },
  });
  assert.equal(signals, 1);
  assert.equal(snapshots, 3);
  assert.equal(retirement.observationCount, 2);
  assert.equal(retirement.before.liveMemberCount, 1);
  assert.equal(retirement.after.liveMemberCount, 0);
});

test('a real detached command exit retires without signalling an empty group', {
  timeout: 10_000,
}, async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0);'], {
    detached: true,
    stdio: 'ignore',
  });
  const [exitCode, terminatedBy] = await once(child, 'close');
  assert.equal(exitCode, 0);
  assert.equal(terminatedBy, null);
  const retirement = await retireOwnedProcessGroup(child.pid);
  assert.equal(retirement.signaled, false);
  assert.equal(retirement.before.liveMemberCount, 0);
});

test('a real descendant survives its detached leader exit and is retired from the owned group', {
  timeout: 10_000,
}, async t => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
const descendant = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); require("node:fs").writeSync(3, "ready");'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
descendant.once('error', error => { throw error; });
descendant.stdio[3].once('data', ready => {
  if (ready.toString() !== 'ready') throw new Error('Invalid descendant readiness');
  require('node:fs').writeSync(1, JSON.stringify({ groupId: process.pid, descendantPid: descendant.pid }));
  descendant.unref();
  process.exit(0);
});`,
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const closed = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
    await closed;
    await retireOwnedProcessGroup(child.pid);
  });
  const output = Buffer.concat(await Array.fromAsync(child.stdout)).toString();
  const [exitCode, terminatedBy] = await closed;
  assert.equal(exitCode, 0);
  assert.equal(terminatedBy, null);
  const ids = JSON.parse(output);
  assert.equal(ids.groupId, child.pid);
  const retirement = await retireOwnedProcessGroup(child.pid);
  assert.equal(retirement.signaled, true);
  assert(
    retirement.before.members.some(
      member => member.pid === ids.descendantPid && member.live,
    ),
  );
  assert.equal(retirement.after.liveMemberCount, 0);
});

test('a naturally exited unreaped session leader is verified as zombie and skipped', {
  timeout: 10_000,
}, async t => {
  const holder = spawn(
    'python3',
    [
      '-c',
      `
import os, signal, sys
signal.signal(signal.SIGCHLD, signal.SIG_DFL)
child = os.fork()
if child == 0:
    os.setsid()
    os.write(1, (str(os.getpid()) + "\\n").encode())
    os._exit(0)
try:
    sys.stdin.buffer.read(1)
finally:
    os.waitpid(child, 0)
`,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const closed = once(holder, 'close');
  const pidLine = new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const settle = (error, line) => {
      if (settled) return;
      settled = true;
      t.signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(line);
    };
    const abort = () =>
      settle(
        t.signal.reason ?? new Error('Zombie fixture readiness interrupted'),
      );
    t.signal.addEventListener('abort', abort, { once: true });
    if (t.signal.aborted) abort();
    holder.once('error', error => settle(error));
    holder.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('\n'))
        settle(undefined, output.slice(0, output.indexOf('\n')));
    });
    holder.stdout.once('end', () =>
      settle(new Error('Zombie fixture ended before its PID')),
    );
  });
  try {
    let childPid;
    try {
      childPid = Number(await pidLine);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await closed.catch(() => {});
        t.skip('The natural zombie control requires installed python3');
        return;
      }
      throw error;
    }
    assert(Number.isSafeInteger(childPid) && childPid > 1);
    let snapshot;
    let zombieObserved = false;
    const deadline = Date.now() + 5000;
    do {
      snapshot = inspectOwnedProcessGroup(childPid);
      zombieObserved = snapshot.members.some(
        member => member.pid === childPid && member.state[0] === 'Z',
      );
      if (zombieObserved) break;
      assert(
        Date.now() < deadline,
        'The real fork child must reach its unreaped zombie state',
      );
      await delay(20, undefined, { signal: t.signal });
    } while (!zombieObserved && Date.now() < deadline);
    assert(!snapshot.members.some(member => member.pid === holder.pid));
    assert(
      snapshot.members.some(
        member =>
          member.pid === childPid &&
          member.pgid === childPid &&
          member.state[0] === 'Z' &&
          !member.live,
      ),
    );
    const retirement = await retireOwnedProcessGroup(childPid);
    assert.equal(retirement.signaled, false);
    assert.equal(retirement.before.liveMemberCount, 0);
  } finally {
    holder.stdin.end();
    const [exitCode, terminatedBy] = await closed.catch(error => {
      if (error.code === 'ENOENT') return [null, null];
      throw error;
    });
    if (holder.pid) {
      assert.equal(exitCode, 0);
      assert.equal(terminatedBy, null);
    }
  }
});

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
