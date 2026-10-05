import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  candidateHeader,
  controlHeader,
  defaultRoutes,
  receiptHeader,
  validateCandidateBinding,
  validateRoutes,
  validateToken,
} from './contract.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function byteEvidence(bytes) {
  return {
    byteLength: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString('base64'),
    text: bytes.toString('utf8'),
  };
}

function nativeMarkup(html) {
  return html
    .replace(
      /<(script|style|textarea|title|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
      '',
    )
    .replace(/<!--[\s\S]*?-->/gu, '');
}

async function bounded(label, promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Worker lifecycle deadline exceeded: ${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run only with the authenticated, installed Miniflare instance owned by the
 * calling producer. This helper creates no provider, build, bridge, or process.
 * Its receipts are additive: the producer retains the existing C2 executions.
 */
export async function verifyWorkerLifecycle({
  miniflare,
  workerName,
  token,
  candidateBinding,
  routes = defaultRoutes,
  timeoutMs = 15_000,
  onObservation,
}) {
  const candidate = validateCandidateBinding(candidateBinding);
  validateToken(token);
  const routeInputs = validateRoutes(routes);
  assert.equal(
    miniflare?.constructor?.name,
    'Miniflare',
    'Use the actual installed Miniflare provider',
  );
  assert.equal(typeof miniflare.dispatchFetch, 'function');
  assert.equal(typeof workerName, 'string');
  assert(/^[a-zA-Z0-9_-]+$/u.test(workerName));
  assert(
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 60_000,
  );
  assert(onObservation === undefined || typeof onObservation === 'function');
  const candidateText = JSON.stringify(candidate);
  const evidence = {
    schema: 'bleedingdev.ultramodern.renderer-worker-lifecycle-proof',
    schemaVersion: 1,
    status: 'running',
    ...candidate,
    token,
    workerName,
    dispatchForms: [],
    assertionCount: 0,
  };
  const active = new Set();
  const equal = (actual, expected, message) => {
    assert.deepEqual(actual, expected, message);
    evidence.assertionCount += 1;
  };
  const check = (condition, message) => {
    assert(condition, message);
    evidence.assertionCount += 1;
  };
  const publish = async () => {
    await onObservation?.(evidence);
  };
  const headers = id => ({
    [controlHeader]: token,
    [candidateHeader]: candidateText,
    ...(id ? { 'x-lifecycle-request': id } : {}),
  });
  const urlFor = (route, id, action) => {
    const url = new URL(route.urlPath, `https://${workerName}.invalid`);
    if (id) url.searchParams.set('lifecycleRequest', id);
    if (action) url.searchParams.set('lifecycleControl', action);
    return url.href;
  };

  async function diagnostic(route, form, action = 'observe', id) {
    const url = urlFor(route, id, action);
    const response = await bounded(
      `diagnostic ${action}`,
      miniflare.dispatchFetch(url, {
        method: 'POST',
        headers: headers(),
        signal: AbortSignal.timeout(timeoutMs),
      }),
      timeoutMs,
    );
    const bytes = Buffer.from(
      await bounded(
        `diagnostic ${action} body`,
        response.arrayBuffer(),
        timeoutMs,
      ),
    );
    form.diagnostics.push({
      url,
      status: response.status,
      headers: [...response.headers],
      body: byteEvidence(bytes),
    });
    equal(
      response.status,
      200,
      `Real workerd diagnostic failed: ${bytes.toString('utf8')}`,
    );
    const observation = JSON.parse(bytes.toString('utf8'));
    equal(observation.candidateBinding, candidate);
    equal(observation.token, token);
    equal(observation.dispatchForm, route.dispatchForm);
    await publish();
    return observation;
  }

  async function observeUntil(route, form, predicate, label) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const packet = await diagnostic(route, form);
      if (predicate(packet.observations)) return packet.observations;
      check(Date.now() < deadline, `Real workerd did not observe ${label}`);
      await delay(25);
    }
  }

  function dispatch(route, form, id) {
    const controller = new AbortController();
    const responseEvidence = { id, url: urlFor(route, id), chunks: [] };
    const operation = { id, controller, evidence: responseEvidence };
    active.add(operation);
    form.responses.push(responseEvidence);
    operation.response = bounded(
      `response ${id}`,
      miniflare.dispatchFetch(responseEvidence.url, {
        method: 'POST',
        headers: {
          ...headers(id),
          'content-type': 'text/plain; charset=utf-8',
        },
        body: token + ':' + id + ':request:α🌐',
        signal: controller.signal,
      }),
      timeoutMs,
    );
    // A failed pending dispatch remains observable without unhandled rejection noise.
    operation.response.catch(() => {});
    return operation;
  }

  async function open(operation, route) {
    const response = await operation.response;
    operation.evidence.status = response.status;
    operation.evidence.statusText = response.statusText;
    operation.evidence.headers = [...response.headers];
    equal(
      response.status,
      207,
      'The native response status changed in actual workerd execution',
    );
    equal(response.statusText, 'Lifecycle Multi-Status');
    check(
      response.headers.get('content-type')?.startsWith('text/html;'),
      'Native HTML MIME was not preserved',
    );
    equal(
      response.headers.get('x-lifecycle-response'),
      token + ':' + operation.id,
    );
    check(
      typeof response.headers.getSetCookie === 'function',
      'Installed provider must expose repeated cookies',
    );
    operation.evidence.setCookies = response.headers.getSetCookie();
    equal(
      operation.evidence.setCookies,
      [
        'lifecycle_first=' + operation.id + '; Path=/; HttpOnly',
        'lifecycle_second=' +
          operation.id +
          '; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
      ],
      'Repeated Set-Cookie fields were folded or dropped',
    );
    const receipt = response.headers.get(receiptHeader);
    check(
      typeof receipt === 'string' && receipt.length > 0,
      'The executing fixture receipt is absent',
    );
    equal(JSON.parse(decodeURIComponent(receipt)), {
      candidateBinding: candidate,
      token,
      dispatchForm: route.dispatchForm,
      id: operation.id,
    });
    check(response.body, 'The actual worker returned no native SSR body');
    operation.reader = response.body.getReader();
  }

  async function readShell(operation) {
    let bytes = Buffer.alloc(0);
    const shell = token + ':' + operation.id + ':shell:α🌐</p>';
    const pending = operation.id + ':pending</p>';
    while (
      !nativeMarkup(bytes.toString('utf8')).includes(shell) ||
      !nativeMarkup(bytes.toString('utf8')).includes(pending)
    ) {
      const result = await bounded(
        `progressive shell ${operation.id}`,
        operation.reader.read(),
        timeoutMs,
      );
      equal(result.done, false, 'Native SSR ended before its shell');
      const chunk = Buffer.from(result.value);
      operation.evidence.chunks.push(byteEvidence(chunk));
      bytes = Buffer.concat([bytes, chunk]);
      check(bytes.length <= 1024 * 1024, 'Unexpected lifecycle shell size');
    }
    const markup = nativeMarkup(bytes.toString('utf8'));
    check(
      markup.includes(token + ':' + operation.id + ':shell:α🌐'),
      'First bytes contain no native SSR request markup',
    );
    check(
      markup.includes('id="lifecycle-pending"'),
      'React did not deliver its genuine pending Suspense shell',
    );
    check(
      !markup.includes('id="lifecycle-deferred"'),
      'Deferred work completed before progressive bytes were observed',
    );
    operation.evidence.progressiveShell = byteEvidence(bytes);
    await publish();
  }

  async function finish(operation) {
    for (;;) {
      const result = await bounded(
        `body completion ${operation.id}`,
        operation.reader.read(),
        timeoutMs,
      );
      if (result.done) break;
      operation.evidence.chunks.push(byteEvidence(Buffer.from(result.value)));
      check(
        operation.evidence.chunks.reduce(
          (size, chunk) => size + chunk.byteLength,
          0,
        ) <=
          1024 * 1024,
        'Unexpected lifecycle response size',
      );
    }
    const bytes = Buffer.concat(
      operation.evidence.chunks.map(chunk =>
        Buffer.from(chunk.base64, 'base64'),
      ),
    );
    operation.evidence.completedBody = byteEvidence(bytes);
    const markup = nativeMarkup(bytes.toString('utf8'));
    check(
      markup.includes('id="lifecycle-deferred"'),
      'Native deferred SSR markup is absent',
    );
    check(
      markup.includes(token + ':' + operation.id + ':deferred:α🌐'),
      'Deferred SSR lost its request-owned value',
    );
    check(
      !bytes.toString('utf8').includes('<!--$!-->'),
      'Native SSR returned an error boundary',
    );
    operation.reader.releaseLock();
    active.delete(operation);
    await publish();
  }

  async function observeAbortDelivery(operation) {
    operation.evidence.abortReads = [];
    for (;;) {
      let result;
      try {
        result = await bounded(
          'request abort delivery',
          operation.reader.read(),
          timeoutMs,
        );
      } catch (error) {
        operation.evidence.abortReads.push({ error: error.message });
        if (error.message.startsWith('Worker lifecycle deadline exceeded:'))
          throw error;
        operation.evidence.abortDeliveryTerminal = 'error';
        return;
      }
      operation.evidence.abortReads.push({
        done: result.done,
        ...(result.value
          ? { body: byteEvidence(Buffer.from(result.value)) }
          : {}),
      });
      if (result.done) {
        operation.evidence.abortDeliveryTerminal = 'eof';
        return;
      }
      check(
        operation.evidence.abortReads.reduce(
          (size, read) => size + (read.body?.byteLength ?? 0),
          0,
        ) <=
          1024 * 1024,
        'Unexpected native abort response size',
      );
    }
  }

  function assertSnapshots(observation, completed, dispatchForm) {
    equal(
      observation.mapAlreadyOwned,
      false,
      'Overlapping native requests share their loader Map',
    );
    for (const snapshot of observation.snapshots) {
      equal(
        snapshot.owner,
        observation.id,
        'Another request overwrote native loader state across an await',
      );
      equal(
        snapshot.binding,
        token,
        'The actual worker binding was lost across an await',
      );
      equal(
        snapshot.bindingsIdentity,
        true,
        'Worker options replaced the native bindings object',
      );
      equal(
        snapshot.contextIdentity,
        true,
        'Worker options replaced the native execution context',
      );
      equal(
        snapshot.executionContext,
        true,
        'The actual worker execution context is absent',
      );
      equal(snapshot.method, 'POST');
      equal(snapshot.requestHeader, observation.id);
      if (dispatchForm === 'request-handler') {
        equal(
          snapshot.nativeRequestHeader,
          observation.id,
          'Native SSR context lost its request header across an await',
        );
        equal(
          snapshot.nativeLoaderContextIdentity,
          true,
          'Native SSR context replaced its request loader Map',
        );
      }
    }
    const phases = new Set(
      observation.snapshots.map(snapshot => snapshot.phase),
    );
    for (const phase of [
      'before-setup-await',
      'after-setup-await',
      'before-deferred-await',
    ])
      check(
        phases.has(phase),
        `Request ${observation.id} did not observe ${phase}`,
      );
    if (completed)
      for (const phase of ['after-deferred-await', 'deferred-render'])
        check(
          phases.has(phase),
          `Request ${observation.id} did not observe ${phase}`,
        );
  }

  function assertSettled(route, observation, completed) {
    assertSnapshots(observation, completed, route.dispatchForm);
    equal(observation.producerStarts, 1);
    equal(
      observation.producerCleanups,
      1,
      'The actual active deferred producer did not clean up exactly once',
    );
    equal(
      observation.requestCleanups,
      1,
      'The native delivered request did not clean up exactly once',
    );
    equal(
      observation.waitUntilCompletions,
      1,
      'The actual execution context did not settle registered work',
    );
    equal(observation.producerResolutions, completed ? 1 : 0);
    if (completed) {
      equal(observation.requestSignalAborts, 0);
      equal(observation.sourceCancels, 0);
      equal(observation.sourceErrors, 0);
      equal(observation.sourceCompletions, 1);
      equal(observation.renderErrors, []);
    } else {
      check(
        observation.producerCancellationCalls >= 1,
        'Cancellation did not reach the actual active producer',
      );
      const signalSettledNativeReact =
        observation.requestSignalAborts === 1 &&
        (observation.sourceErrors > 0 ||
          (observation.renderErrors.length > 0 &&
            observation.sourceCompletions > 0));
      check(
        observation.sourceCancels > 0 || signalSettledNativeReact,
        'Cancellation did not reach the native render stream',
      );
    }
    if (route.dispatchForm === 'request-handler')
      equal(
        observation.nativeTerminals,
        [{ status: completed ? 'complete' : 'cancelled' }],
        'The native renderer did not emit exactly one matching terminal',
      );
  }

  try {
    for (const route of routeInputs) {
      const form = {
        ...route,
        diagnostics: [],
        responses: [],
        observations: [],
      };
      evidence.dispatchForms.push(form);
      const first = dispatch(route, form, 'overlap_a');
      const second = dispatch(route, form, 'overlap_b');
      const beforeRelease = await observeUntil(
        route,
        form,
        records =>
          ['overlap_a', 'overlap_b'].every(id =>
            records.some(record => record.id === id),
          ),
        'both overlapping requests before setup release',
      );
      for (const observation of beforeRelease) {
        equal(observation.setupReleased, false);
        equal(observation.requestCleanups, 0);
      }
      await diagnostic(route, form, 'setup', second.id);
      await open(second, route);
      await readShell(second);
      await diagnostic(route, form, 'setup', first.id);
      await open(first, route);
      await readShell(first);
      const held = (await diagnostic(route, form)).observations;
      for (const observation of held) {
        assertSnapshots(observation, false, route.dispatchForm);
        equal(observation.producerStarts, 1);
        equal(
          observation.deferredReleased,
          false,
          'Progressive bytes were credited after producer completion',
        );
        equal(
          observation.producerCleanups,
          0,
          'Deferred producer was cleaned up before streamed delivery',
        );
        equal(
          observation.requestCleanups,
          0,
          'Native request cleanup ran before deferred rendering completed',
        );
        equal(observation.nativeTerminals, []);
      }
      await diagnostic(route, form, 'deferred', second.id);
      await finish(second);
      await observeUntil(
        route,
        form,
        records =>
          records.find(record => record.id === second.id)?.requestCleanups ===
          1,
        'second delivered response cleanup',
      );
      const stillHeld = (await diagnostic(route, form)).observations.find(
        record => record.id === first.id,
      );
      equal(
        stillHeld.producerCleanups,
        0,
        'One request cleaned up another still-pending producer',
      );
      equal(
        stillHeld.requestCleanups,
        0,
        'One request cleaned up another still-pending request',
      );
      await diagnostic(route, form, 'deferred', first.id);
      await finish(first);
      const completed = await observeUntil(
        route,
        form,
        records =>
          records
            .filter(record => record.id.startsWith('overlap_'))
            .every(
              record =>
                record.requestCleanups === 1 &&
                record.waitUntilCompletions === 1,
            ),
        'overlap cleanup',
      );
      for (const observation of completed)
        assertSettled(route, observation, true);
      const completionSequence = id =>
        completed
          .find(record => record.id === id)
          .events.find(event => event.type === 'producer-resolved').sequence;
      check(
        completionSequence(second.id) < completionSequence(first.id),
        'Deferred overlap did not preserve controlled completion order',
      );
      for (const operation of [first, second]) {
        const other = operation === first ? second : first;
        check(
          !nativeMarkup(operation.evidence.completedBody.text).includes(
            token + ':' + other.id + ':',
          ),
          'Native SSR bytes contain another overlapping request value',
        );
      }

      for (const cancellation of ['request-abort', 'body-cancel']) {
        const operation = dispatch(route, form, cancellation);
        await observeUntil(
          route,
          form,
          records => records.some(record => record.id === operation.id),
          `${cancellation} request entry`,
        );
        await diagnostic(route, form, 'setup', operation.id);
        await open(operation, route);
        await readShell(operation);
        const before = (await diagnostic(route, form)).observations.find(
          record => record.id === operation.id,
        );
        equal(before.producerCleanups, 0);
        equal(before.requestCleanups, 0);
        equal(before.producerResolutions, 0);
        operation.evidence.cancellation = cancellation;
        if (cancellation === 'request-abort') {
          operation.controller.abort(
            new Error('Controlled real workerd request abort'),
          );
          await observeAbortDelivery(operation);
        } else {
          await bounded(
            'native response body cancellation',
            operation.reader.cancel(
              'Controlled real workerd body cancellation',
            ),
            timeoutMs,
          );
        }
        const records = await observeUntil(
          route,
          form,
          records => {
            const observation = records.find(
              record => record.id === operation.id,
            );
            return (
              observation?.requestCleanups === 1 &&
              observation.producerCleanups === 1 &&
              observation.waitUntilCompletions === 1
            );
          },
          `${cancellation} reaching the active workerd producer and cleanup`,
        );
        const observation = records.find(record => record.id === operation.id);
        assertSettled(route, observation, false);
        equal(
          observation.deferredReleased,
          false,
          'Abort only completed an already-released producer',
        );
        if (cancellation === 'request-abort')
          equal(
            observation.requestSignalAborts,
            1,
            'The host AbortController never reached the actual workerd Request.signal',
          );
        else
          equal(
            observation.sourceCancels,
            1,
            'Body cancellation never reached the actual native React source',
          );
        operation.reader.releaseLock();
        active.delete(operation);
        await publish();
      }
      form.observations = (await diagnostic(route, form)).observations;
      equal(form.observations.length, 4);
      for (const observation of form.observations)
        assertSettled(
          route,
          observation,
          observation.id.startsWith('overlap_'),
        );
    }
    evidence.status = 'passed';
    await publish();
    return evidence;
  } catch (error) {
    evidence.status = 'failed';
    evidence.failure = { name: error.name, message: error.message };
    error.workerLifecycleEvidence = evidence;
    await publish();
    throw error;
  } finally {
    for (const operation of active) {
      operation.controller.abort(
        new Error('Worker lifecycle helper ownership cleanup'),
      );
      if (operation.reader) {
        try {
          await bounded(
            'owned response cleanup',
            operation.reader.cancel(
              'Worker lifecycle helper ownership cleanup',
            ),
            timeoutMs,
          );
        } catch (error) {
          operation.evidence.ownershipCleanupError = error.message;
        }
        try {
          operation.reader.releaseLock();
        } catch {}
      } else {
        // The parent owns provider disposal, including any still-pending response.
        operation.evidence.ownershipCleanup =
          'request-aborted-parent-disposes-provider';
      }
    }
  }
}
