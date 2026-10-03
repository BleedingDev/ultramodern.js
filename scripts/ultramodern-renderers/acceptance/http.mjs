import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const httpDimensions = new Set(['ssr', 'data', 'action', 'head-assets']);

function check(condition, message) {
  assert.ok(condition, `renderer-http: ${message}`);
}

function markers(values, name) {
  check(
    Array.isArray(values) &&
      values.every(value => typeof value === 'string' && value.length > 0),
    `${name} must be an array of nonempty strings`,
  );
  return values;
}

function scopedDeadline(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('HTTP probe timed out')),
    timeoutMs,
  );
  timer.unref();
  return {
    controller,
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  };
}

function responseHeaders(response) {
  return {
    combined: Object.fromEntries(response.headers),
    setCookie: response.headers.getSetCookie(),
  };
}

function assertResponse(specification, response, body) {
  const expected = specification.expect;
  check(
    expected && Number.isInteger(expected.status),
    `${specification.id} needs an expected status`,
  );
  assert.equal(response.status, expected.status, `${specification.id}: status`);
  let assertionCount = 1;
  let observedIdentity;
  if (expected.identity) {
    const encoded = response.headers.get(
      expected.identityHeader ?? 'x-ultramodern-renderer-identity',
    );
    check(
      encoded,
      `${specification.id}: observed renderer identity header is required`,
    );
    observedIdentity = JSON.parse(encoded);
    assert.deepEqual(
      observedIdentity,
      expected.identity,
      `${specification.id}: observed renderer identity`,
    );
    assertionCount += 1;
  }
  for (const [name, value] of Object.entries(expected.headers ?? {})) {
    if (Array.isArray(value)) {
      check(
        name.toLowerCase() === 'set-cookie',
        'header arrays require set-cookie; other headers use their combined value',
      );
      markers(value, `${specification.id} ${name}`);
      assert.deepEqual(
        response.headers.getSetCookie(),
        value,
        `${specification.id}: ${name}`,
      );
    } else {
      check(
        typeof value === 'string',
        `${specification.id} ${name} must be a string`,
      );
      assert.equal(
        response.headers.get(name),
        value,
        `${specification.id}: ${name}`,
      );
    }
    assertionCount += 1;
  }
  for (const value of markers(expected.bodyIncludes ?? [], 'bodyIncludes')) {
    check(
      body.includes(value),
      `${specification.id}: body must include ${JSON.stringify(value)}`,
    );
    assertionCount += 1;
  }
  for (const value of markers(expected.bodyExcludes ?? [], 'bodyExcludes')) {
    check(
      !body.includes(value),
      `${specification.id}: body must exclude ${JSON.stringify(value)}`,
    );
    assertionCount += 1;
  }
  if (
    specification.dimension === 'ssr' ||
    specification.dimension === 'head-assets'
  ) {
    check(
      response.headers.get('content-type')?.includes('text/html'),
      `${specification.id}: HTML content type`,
    );
    check(
      /<html\b/iu.test(body) && /<body\b/iu.test(body),
      `${specification.id}: rendered HTML document`,
    );
    check(
      (expected.bodyIncludes?.length ?? 0) > 0,
      `${specification.id}: rendered HTML needs a positive body marker`,
    );
    assertionCount += 2;
  }
  const headIncludes = markers(expected.headIncludes ?? [], 'headIncludes');
  const headExcludes = markers(expected.headExcludes ?? [], 'headExcludes');
  if (
    specification.dimension === 'head-assets' ||
    headIncludes.length ||
    headExcludes.length
  ) {
    const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/iu.exec(body)?.[1];
    check(head !== undefined, `${specification.id}: rendered head region`);
    if (specification.dimension === 'head-assets') {
      check(
        headIncludes.length > 0,
        `${specification.id}: head-assets needs a positive head marker`,
      );
    }
    assertionCount += 1;
    for (const value of headIncludes) {
      check(
        head.includes(value),
        `${specification.id}: head must include ${JSON.stringify(value)}`,
      );
      assertionCount += 1;
    }
    for (const value of headExcludes) {
      check(
        !head.includes(value),
        `${specification.id}: head must exclude ${JSON.stringify(value)}`,
      );
      assertionCount += 1;
    }
  }
  return {
    id: specification.id,
    status: response.status,
    headers: responseHeaders(response),
    body,
    ...(observedIdentity ? { observedIdentity } : {}),
    assertionCount,
  };
}

/**
 * Probe real HTTP endpoints and return [{ dimension, observations }]. No app is
 * started, generated or patched. Every main response must expose the expected runtime identity as JSON in
 * x-ultramodern-renderer-identity, or the top-level identityHeader override.
 * Candidate source/artifact digests belong to the enclosing receipt.
 * Optional decodeControlResponse(response, { url, method, signal }) decodes
 * fixture controls with the owning public data protocol. It receives an
 * unconsumed Response and its actual URL after HTTP 200 validation. It must
 * return an object; failures never fall back to JSON. Native protocol/identity
 * checks belong to that decoder. Without it, controls keep the raw JSON path.
 *
 * probes.cases: [{ id, dimension, path, method?, headers?, body?, expect: {
 *   status, headers?, bodyIncludes?, bodyExcludes?, headIncludes?, headExcludes?,
 *   identity?, identityHeader?
 * }}]. Dimensions are ssr/data/action/head-assets. Header arrays compare exact
 * Set-Cookie lines, including order. Other header values are combined strings.
 * Redirects are observed without following them.
 * Optional expect.identity compares the parsed JSON response header
 * x-ultramodern-renderer-identity, or identityHeader, with the expected profile.
 *
 * probes.concurrent: [{ id, dimension, cases, readyPath, releasePath }]. The
 * fixture observer returns { activeRequests }; it starts at zero and must show
 * every request active before POST releasePath. Each case supplies a unique
 * positive body marker and excludes every other case's positive markers.
 *
 * probes.stream: { id, path, statePath, releasePath, firstIncludes, finalIncludes,
 *   headers?, expect?, holdMs? }. Shell bytes and an open stream are observed
 * before POST releasePath; finalIncludes must arrive only after that release.
 * Observer JSON progresses { released:false, activeRequests:0 } to one active
 * request while held, then released:true after release. Controls belong to the
 * owning fixture. This driver does not add controls to applications.
 *
 * probes.abort: { id, path, statePath, firstIncludes, expectCleanupCount: 1,
 *   headers?, settleMs? }. Observer JSON is { cleanupCount, activeRequests, cancelled }.
 * States must progress 0/0/false -> 0/1/false -> 1/0/true and stay
 * 1/0/true after cancellation. Normal completion must report cancelled:false.
 *
 * Optional probes.nativeRsc is a case with diagnosticCode and expected 400.
 * This early rejection precedes entry dispatch, so its response is not required
 * to carry an entry identity header. All normal application responses are.
 * Its separate rsc result proves only the HTTP diagnostic. Artifact auditing
 * must prove the absence of React RSC imports.
 */
export async function probeHttp({
  baseUrl,
  renderer,
  identity,
  probes,
  timeoutMs = 5000,
  identityHeader = 'x-ultramodern-renderer-identity',
  decodeControlResponse,
}) {
  check(['react', 'solid', 'octane'].includes(renderer), 'unknown renderer');
  check(
    identity && typeof identity === 'object',
    'candidate identity is required',
  );
  check(probes && typeof probes === 'object', 'explicit probes are required');
  check(
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000,
    'timeoutMs must be between 1 and 60000',
  );
  check(
    identity.renderer === renderer,
    'expected identity must match the selected renderer',
  );
  check(
    typeof identityHeader === 'string' && identityHeader.length > 0,
    'identityHeader is required',
  );
  check(
    decodeControlResponse === undefined ||
      typeof decodeControlResponse === 'function',
    'decodeControlResponse must be a function',
  );
  const base = new URL(baseUrl);
  check(['http:', 'https:'].includes(base.protocol), 'baseUrl must use HTTP');
  const observations = new Map();
  const ids = new Set();
  const observedIdentities = new WeakMap();
  const url = path => {
    check(
      typeof path === 'string' && path.startsWith('/'),
      'probe paths must be absolute paths',
    );
    const target = new URL(path, base);
    check(
      target.origin === base.origin,
      'probe paths must stay on the fixture origin',
    );
    return target;
  };
  const register = specification => {
    check(
      typeof specification?.id === 'string' &&
        specification.id.length > 0 &&
        !ids.has(specification.id),
      'probe ids must be nonempty and unique',
    );
    ids.add(specification.id);
    url(specification.path);
  };
  const record = (dimension, fact) => {
    const row = observations.get(dimension) ?? {
      assertionCount: 0,
      renderer,
      cases: [],
    };
    row.assertionCount += fact.assertionCount;
    row.cases.push(fact);
    observations.set(dimension, row);
  };
  const fetchProbe = async (specification, signal, unboundResponse = false) => {
    const response = await fetch(url(specification.path), {
      method: specification.method ?? 'GET',
      headers: specification.headers,
      body: specification.body,
      redirect: 'manual',
      signal,
    });
    if (!unboundResponse) {
      const encoded = response.headers.get(identityHeader);
      check(
        encoded,
        `${specification.id}: observed renderer identity header is required`,
      );
      const observed = JSON.parse(encoded);
      assert.deepEqual(
        observed,
        identity,
        `${specification.id}: observed renderer identity`,
      );
      observedIdentities.set(response, observed);
    }
    return response;
  };
  const runCase = async (
    specification,
    externalSignal,
    requireEntryIdentity = true,
  ) => {
    const deadline = scopedDeadline(timeoutMs);
    try {
      const signal = externalSignal
        ? AbortSignal.any([externalSignal, deadline.signal])
        : deadline.signal;
      const response = await fetchProbe(
        specification,
        signal,
        !requireEntryIdentity,
      );
      const fact = assertResponse(
        specification,
        response,
        await response.text(),
      );
      return {
        ...fact,
        observedIdentity: observedIdentities.get(response),
        ...(requireEntryIdentity
          ? {}
          : { identityHeaderAbsent: !response.headers.has(identityHeader) }),
        assertionCount: fact.assertionCount + (requireEntryIdentity ? 2 : 0),
      };
    } finally {
      deadline.controller.abort();
      deadline.dispose();
    }
  };
  const control = async (path, signal, method = 'GET') => {
    const response = await fetchProbe({ path, method }, signal, true);
    assert.equal(response.status, 200, `${path}: fixture control status`);
    if (!decodeControlResponse) {
      return { body: await response.text(), status: response.status };
    }
    signal.throwIfAborted();
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const decoded = await Promise.race([
        Promise.resolve().then(() =>
          decodeControlResponse(response, {
            url: response.url,
            method,
            signal,
          }),
        ),
        aborted,
      ]);
      check(
        decoded !== null &&
          typeof decoded === 'object' &&
          !Array.isArray(decoded),
        `${path}: decoded fixture control state must be an object`,
      );
      return { decoded: structuredClone(decoded), status: response.status };
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };
  const state = async (path, signal) => {
    const observed = await control(path, signal);
    return decodeControlResponse ? observed.decoded : JSON.parse(observed.body);
  };

  for (const specification of probes.cases ?? []) {
    register(specification);
    check(
      httpDimensions.has(specification.dimension),
      'HTTP case has an unsupported dimension',
    );
    record(specification.dimension, await runCase(specification));
  }

  for (const group of probes.concurrent ?? []) {
    check(
      typeof group.id === 'string' && !ids.has(group.id),
      'concurrent group needs a unique id',
    );
    ids.add(group.id);
    check(
      httpDimensions.has(group.dimension),
      'concurrent group has an unsupported dimension',
    );
    check(
      Array.isArray(group.cases) && group.cases.length >= 2,
      'concurrency needs at least two requests',
    );
    url(group.readyPath);
    url(group.releasePath);
    const allMarkers = group.cases.map(specification => {
      register(specification);
      check(
        specification.dimension === group.dimension,
        'concurrent case dimensions must match their group',
      );
      const positive = markers(
        specification.expect?.bodyIncludes ?? [],
        'concurrent bodyIncludes',
      );
      check(
        positive.length > 0,
        'concurrent requests need positive isolation markers',
      );
      return positive;
    });
    for (const [index, specification] of group.cases.entries()) {
      const excluded = markers(
        specification.expect.bodyExcludes ?? [],
        'concurrent bodyExcludes',
      );
      check(
        allMarkers.every(
          (values, other) =>
            other === index ||
            values.every(
              value =>
                excluded.includes(value) && !allMarkers[index].includes(value),
            ),
        ),
        'concurrent requests must exclude all other request markers',
      );
    }
    const deadline = scopedDeadline(timeoutMs);
    let released = false;
    let pending = [];
    try {
      const initial = await state(group.readyPath, deadline.signal);
      assert.equal(
        initial.activeRequests,
        0,
        `${group.id}: initial active requests`,
      );
      // Attach rejection handlers immediately; failures while waiting must not
      // become unhandled rejections or leave sibling responses unconsumed.
      pending = group.cases.map(specification =>
        runCase(specification, deadline.signal),
      );
      const settled = Promise.allSettled(pending);
      let ready;
      do {
        ready = await state(group.readyPath, deadline.signal);
        check(
          Number.isInteger(ready.activeRequests) &&
            ready.activeRequests >= 0 &&
            ready.activeRequests <= group.cases.length,
          `${group.id}: invalid active request observation`,
        );
        if (ready.activeRequests < group.cases.length)
          await delay(5, undefined, { signal: deadline.signal });
      } while (ready.activeRequests !== group.cases.length);
      released = true;
      await control(group.releasePath, deadline.signal, 'POST');
      const results = await settled;
      const rejected = results.find(result => result.status === 'rejected');
      if (rejected) throw rejected.reason;
      const facts = results.map(result => result.value);
      record(group.dimension, {
        id: group.id,
        initial,
        ready,
        concurrentRequests: group.cases.length,
        responses: facts,
        assertionCount:
          3 + facts.reduce((count, fact) => count + fact.assertionCount, 0),
      });
    } finally {
      deadline.controller.abort();
      await Promise.allSettled(pending);
      deadline.dispose();
      if (!released) {
        const cleanup = scopedDeadline(timeoutMs);
        try {
          await control(group.releasePath, cleanup.signal, 'POST');
        } catch {
          /* original failure owns the result */
        } finally {
          cleanup.dispose();
        }
      }
    }
  }

  if (probes.stream) {
    const specification = probes.stream;
    register(specification);
    url(specification.statePath);
    url(specification.releasePath);
    check(
      specification.releasePath !== specification.path,
      'stream needs a separate release endpoint',
    );
    markers(
      [specification.firstIncludes, specification.finalIncludes],
      'stream markers',
    );
    check(
      specification.firstIncludes !== specification.finalIncludes,
      'stream markers must differ',
    );
    const holdMs = specification.holdMs ?? 50;
    check(
      Number.isInteger(holdMs) && holdMs >= 25 && holdMs <= 1000,
      'holdMs must be between 25 and 1000',
    );
    const deadline = scopedDeadline(timeoutMs);
    let reader;
    let pump;
    let released = false;
    try {
      const baseline = await state(specification.statePath, deadline.signal);
      assert.deepEqual(
        [baseline.released, baseline.activeRequests],
        [false, 0],
        `${specification.id}: stream latch baseline`,
      );
      const response = await fetchProbe(specification, deadline.signal);
      assert.equal(
        response.status,
        specification.expect?.status ?? 200,
        `${specification.id}: stream response status`,
      );
      check(response.body, `${specification.id}: streaming body is required`);
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let body = '';
      let bytes = 0;
      let firstObservedAt;
      let resolveShell;
      let rejectShell;
      const shell = new Promise((resolve, reject) => {
        resolveShell = resolve;
        rejectShell = reject;
      });
      shell.catch(() => {});
      // One consumer keeps reading while observer/control requests are pending.
      // Pausing here can hide pre-release chunks, including split markers.
      pump = (async () => {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) {
              body += decoder.decode();
              check(
                released,
                `${specification.id}: stream ended before release`,
              );
              return;
            }
            bytes += chunk.value.byteLength;
            body += decoder.decode(chunk.value, { stream: true });
            if (!released) {
              check(
                !body.includes(specification.finalIncludes),
                `${specification.id}: final marker arrived before release`,
              );
            }
            if (
              firstObservedAt === undefined &&
              body.includes(specification.firstIncludes)
            ) {
              firstObservedAt = performance.now();
              resolveShell();
            }
          }
        } catch (error) {
          rejectShell(error);
          throw error;
        }
      })();
      pump.catch(() => {});
      await shell;
      check(bytes > 0, `${specification.id}: first bytes must be observed`);
      await Promise.race([
        delay(holdMs, undefined, { signal: deadline.signal }),
        pump,
      ]);
      const held = await Promise.race([
        state(specification.statePath, deadline.signal),
        pump,
      ]);
      assert.deepEqual(
        [held.released, held.activeRequests],
        [false, 1],
        `${specification.id}: stream latch must remain held after shell`,
      );
      const releaseSentAt = performance.now();
      check(
        firstObservedAt < releaseSentAt,
        `${specification.id}: shell must precede release`,
      );
      released = true;
      await control(specification.releasePath, deadline.signal, 'POST');
      const afterRelease = await state(
        specification.statePath,
        deadline.signal,
      );
      assert.equal(
        afterRelease.released,
        true,
        `${specification.id}: stream latch release must be observed`,
      );
      await pump;
      check(
        body.includes(specification.finalIncludes),
        `${specification.id}: final marker missing after release`,
      );
      const fact = assertResponse(
        { ...specification, expect: specification.expect ?? { status: 200 } },
        response,
        body,
      );
      record('stream', {
        ...fact,
        bytes,
        baseline,
        held,
        afterRelease,
        firstObservedAt,
        releaseSentAt,
        firstBeforeRelease: true,
        heldOpenMs: releaseSentAt - firstObservedAt,
        finalAfterRelease: true,
        observedIdentity: observedIdentities.get(response),
        assertionCount: fact.assertionCount + 12,
      });
    } finally {
      deadline.controller.abort();
      await pump?.catch(() => {});
      await reader?.cancel().catch(() => {});
      deadline.dispose();
      if (!released) {
        const cleanup = scopedDeadline(timeoutMs);
        try {
          await control(specification.releasePath, cleanup.signal, 'POST');
        } catch {
          /* preserve the probe failure */
        } finally {
          cleanup.dispose();
        }
      }
    }
  }

  if (probes.abort) {
    const specification = probes.abort;
    register(specification);
    url(specification.statePath);
    markers([specification.firstIncludes], 'abort marker');
    check(
      specification.expectCleanupCount === 1,
      'abort requires exactly one cleanup',
    );
    const settleMs = specification.settleMs ?? 100;
    check(
      Number.isInteger(settleMs) && settleMs >= 25 && settleMs <= 1000,
      'settleMs must be between 25 and 1000',
    );
    const deadline = scopedDeadline(timeoutMs);
    const request = scopedDeadline(timeoutMs);
    let reader;
    try {
      const baseline = await state(specification.statePath, deadline.signal);
      assert.deepEqual(
        [baseline.cleanupCount, baseline.activeRequests, baseline.cancelled],
        [0, 0, false],
        `${specification.id}: cleanup baseline`,
      );
      const response = await fetchProbe(specification, request.signal);
      assert.equal(
        response.status,
        200,
        `${specification.id}: abort response status`,
      );
      check(
        response.body,
        `${specification.id}: abort stream body is required`,
      );
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let first = '';
      while (!first.includes(specification.firstIncludes)) {
        const chunk = await reader.read();
        check(
          !chunk.done,
          `${specification.id}: stream ended before abort marker`,
        );
        first += decoder.decode(chunk.value, { stream: true });
      }
      const active = await state(specification.statePath, deadline.signal);
      assert.deepEqual(
        [active.cleanupCount, active.activeRequests, active.cancelled],
        [0, 1, false],
        `${specification.id}: request must be active before cancellation`,
      );
      const cancel = reader.cancel();
      request.controller.abort();
      await cancel;
      let cleaned;
      do {
        cleaned = await state(specification.statePath, deadline.signal);
        check(
          Number.isInteger(cleaned.cleanupCount) &&
            cleaned.cleanupCount >= 0 &&
            cleaned.cleanupCount <= 1,
          `${specification.id}: cleanup must run exactly once`,
        );
        check(
          Number.isInteger(cleaned.activeRequests) &&
            cleaned.activeRequests >= 0 &&
            cleaned.activeRequests <= 1,
          `${specification.id}: invalid active request count`,
        );
        if (cleaned.cleanupCount !== 1 || cleaned.activeRequests !== 0)
          await delay(5, undefined, { signal: deadline.signal });
      } while (cleaned.cleanupCount !== 1 || cleaned.activeRequests !== 0);
      check(
        cleaned.cancelled === true,
        `${specification.id}: cleanup must observe request cancellation`,
      );
      const stableUntil = performance.now() + settleMs;
      let samples = 0;
      do {
        await delay(5, undefined, { signal: deadline.signal });
        const observed = await state(specification.statePath, deadline.signal);
        assert.deepEqual(
          [observed.cleanupCount, observed.activeRequests, observed.cancelled],
          [1, 0, true],
          `${specification.id}: cleanup must stay exactly once`,
        );
        samples += 1;
      } while (performance.now() < stableUntil);
      record('abort', {
        id: specification.id,
        baseline,
        active,
        cleaned,
        first,
        stableSamples: samples,
        stableForMs: settleMs,
        cleanupCount: cleaned.cleanupCount,
        cancelled: cleaned.cancelled,
        observedIdentity: observedIdentities.get(response),
        assertionCount: 7 + samples,
      });
    } finally {
      request.controller.abort();
      await reader?.cancel().catch(() => {});
      request.dispose();
      deadline.dispose();
    }
  }

  if (probes.nativeRsc) {
    const specification = probes.nativeRsc;
    register(specification);
    check(
      renderer !== 'react',
      'native RSC rejection probes require a non-React renderer',
    );
    check(
      specification.expect?.status === 400,
      'native RSC rejection requires status 400',
    );
    markers([specification.diagnosticCode], 'native RSC diagnosticCode');
    const fact = await runCase(
      {
        ...specification,
        expect: {
          ...specification.expect,
          bodyIncludes: [
            ...(specification.expect.bodyIncludes ?? []),
            specification.diagnosticCode,
          ],
        },
      },
      undefined,
      false,
    );
    record('rsc', { ...fact, diagnosticCode: specification.diagnosticCode });
  }
  check(observations.size > 0, 'at least one probe must execute');
  return [...observations].map(([dimension, facts]) => ({
    dimension,
    observations: facts,
  }));
}
