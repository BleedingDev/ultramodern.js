import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Ignored operational glue. The caller owns the genuine Puppeteer page, browser,
// live host, installed protocol readers, identity/console collection and receipt.
// This module launches nothing and never changes application code or handlers.
const testId = name => `[data-testid="${name}"]`;
const capital = renderer => renderer[0].toUpperCase() + renderer.slice(1);

async function abortBounded(signal, operation) {
  signal.throwIfAborted();
  let listener;
  const aborted = new Promise((_, reject) => {
    listener = () => reject(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation();
      }),
      aborted,
    ]);
  } finally {
    signal.removeEventListener('abort', listener);
  }
}

function check(value, message) {
  assert.ok(value, `c2-browser-route-proofs: ${message}`);
}

function boundedContext(host, timeoutMs) {
  check(
    Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60_000,
    'timeoutMs must be 1..60000',
  );
  const base = new URL(host.baseUrl);
  check(
    ['http:', 'https:'].includes(base.protocol) &&
      !base.username &&
      !base.password &&
      base.pathname === '/' &&
      !base.search &&
      !base.hash,
    'the actual host origin is required',
  );
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(new Error('Browser route proof exceeded its deadline')),
    timeoutMs,
  );
  const remaining = () => {
    controller.signal.throwIfAborted();
    const value = deadline - Date.now();
    check(value > 0, 'browser route proof exceeded its deadline');
    return value;
  };
  return {
    base,
    controller,
    remaining,
    finish() {
      clearTimeout(timer);
      controller.abort();
    },
  };
}

function context({
  dimension,
  page,
  row,
  host,
  environment,
  identity,
  timeoutMs,
}) {
  check(
    ['navigation', 'data', 'action', 'head-assets'].includes(dimension),
    'unsupported route dimension',
  );
  check(
    page &&
      [
        'goto',
        'evaluate',
        'evaluateHandle',
        'waitForSelector',
        'waitForFunction',
        'waitForResponse',
        '$',
        '$$',
        'goBack',
        'goForward',
      ].every(key => typeof page[key] === 'function'),
    'the caller must supply its actual Puppeteer page',
  );
  check(
    ['development', 'production'].includes(environment),
    'actual environment is required',
  );
  check(
    ['react', 'solid', 'octane'].includes(row?.renderer) &&
      identity?.renderer === row.renderer,
    'actual row and renderer identity must agree',
  );
  assert.deepEqual(
    host?.identity,
    identity,
    'c2-browser-route-proofs: host identity must be the actual selected entry identity',
  );
  const authority = host.authority ?? host.routeAuthority;
  check(
    authority &&
      typeof authority.routePrefix === 'string' &&
      authority.routePrefix.startsWith('/') &&
      !/[?#\\]/u.test(authority.routePrefix),
    'actual analyzed route authority is required',
  );
  check(
    typeof authority.pageRouteId === 'string' &&
      authority.pageRouteId &&
      typeof authority.controlRouteId === 'string' &&
      authority.controlRouteId &&
      authority.pageRouteId !== authority.controlRouteId,
    'actual opaque page and control IDs are required',
  );
  check(
    typeof host.runId === 'string' && /^[A-Za-z0-9_-]{1,47}$/u.test(host.runId),
    'a fresh caller-owned browser runId is required',
  );
  const bounded = boundedContext(host, timeoutMs);
  const prefix =
    authority.routePrefix === '/'
      ? ''
      : authority.routePrefix.replace(/\/$/u, '');
  return {
    ...bounded,
    dimension,
    page,
    row,
    host,
    environment,
    identity,
    authority,
    home: new URL(`${prefix}/`, bounded.base).href,
    heldIds: new Set(),
    identityHeader: (
      host.probes?.identityHeader ?? 'x-ultramodern-renderer-identity'
    ).toLowerCase(),
  };
}

async function visibleText(ctx, selector) {
  const element = await ctx.page.waitForSelector(selector, {
    visible: true,
    timeout: ctx.remaining(),
  });
  check(element, `actual fixture element is missing: ${selector}`);
  try {
    return await element.evaluate(node => node.textContent?.trim() ?? '');
  } finally {
    await element.dispose();
  }
}

async function existingText(ctx, selector) {
  return ctx.page.evaluate(
    value => document.querySelector(value)?.textContent?.trim() ?? '',
    selector,
  );
}

async function waitJSON(ctx, selector, predicate, argument) {
  await ctx.page.waitForFunction(
    (value, condition, expected) => {
      try {
        const parsed = JSON.parse(
          document.querySelector(value)?.textContent ?? '',
        );
        if (condition === 'saved')
          return (parsed?.value?.saved ?? parsed?.saved) === expected;
        if (condition === 'validation')
          return parsed?.kind === 'error' && parsed.status === 422;
        if (condition === 'loader') return parsed?.message === expected;
        return false;
      } catch {
        return false;
      }
    },
    { timeout: ctx.remaining() },
    selector,
    predicate,
    argument,
  );
  return JSON.parse(await existingText(ctx, selector));
}

function observedIdentity(ctx, response) {
  check(response, 'an actual main HTTP response is required');
  const raw = response.headers()[ctx.identityHeader];
  check(
    typeof raw === 'string',
    'actual main response omitted its renderer identity header',
  );
  const value = JSON.parse(raw);
  assert.deepEqual(
    value,
    ctx.identity,
    'c2-browser-route-proofs: response identity does not match the actual selected host',
  );
  return value;
}

async function go(ctx, url) {
  const target = new URL(url, ctx.base);
  check(
    target.origin === ctx.base.origin,
    'fixture navigation cannot leave the actual host',
  );
  const response = await ctx.page.goto(target.href, {
    waitUntil: 'domcontentloaded',
    timeout: ctx.remaining(),
  });
  observedIdentity(ctx, response);
  return response;
}

async function home(ctx, parameters = {}) {
  const url = new URL(ctx.home);
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value);
  await go(ctx, url.href);
  await visibleText(ctx, testId('native-route'));
  await waitJSON(
    ctx,
    testId('native-loader-value'),
    'loader',
    'Native loader value',
  );
  await ctx.page.waitForFunction(
    () => {
      const observed = globalThis.__ultramodernConformance;
      return observed?.active?.counter === 1 && observed?.active?.stable === 1;
    },
    { timeout: ctx.remaining() },
  );
}

async function documentMarker(ctx) {
  // timeOrigin comes from the real document. The separate JSHandle comparison
  // below verifies identity directly; no marker is injected into the app.
  return ctx.page.evaluate(() => String(performance.timeOrigin));
}

async function continuity(ctx, before) {
  try {
    return await ctx.page.evaluate(
      oldDocument => oldDocument === document,
      before,
    );
  } catch {
    return false;
  }
}

async function link(ctx, text, scope = testId('native-route')) {
  const candidates = await ctx.page.$$(`${scope} a`);
  const matches = [];
  for (const element of candidates) {
    const facts = await element.evaluate(node => ({
      text: node.textContent?.trim(),
      tag: node.tagName,
      href: node.href,
      rawHref: node.getAttribute('href'),
    }));
    if (facts.text === text) matches.push({ element, facts });
    else await element.dispose();
  }
  if (matches.length !== 1) {
    await Promise.all(matches.map(value => value.element.dispose()));
    check(false, `exactly one actual fixture link is required: ${text}`);
  }
  const match = matches[0];
  check(
    match.facts.tag === 'A' &&
      new URL(match.facts.href).origin === ctx.base.origin,
    'fixture native Link must render a same-host anchor',
  );
  return match;
}

async function clickLink(ctx, text, marker, scope) {
  const target = await link(ctx, text, scope);
  try {
    await target.element.click();
    await visibleText(ctx, marker);
    await ctx.page.waitForFunction(
      expected => location.href === expected,
      { timeout: ctx.remaining() },
      target.facts.href,
    );
    return target.facts;
  } finally {
    await target.element.dispose();
  }
}

async function navigation(ctx) {
  await home(ctx);
  const before = await ctx.page.evaluateHandle(() => document);
  try {
    const documentBefore = await documentMarker(ctx);
    const urlBefore = ctx.page.url();
    const sourceMarker = await visibleText(ctx, `${testId('native-route')} h1`);
    const clicked = await clickLink(
      ctx,
      'Open native about route',
      testId('native-about'),
    );
    const destinationMarker = await visibleText(
      ctx,
      `${testId('native-about')} h1`,
    );
    const urlAfter = ctx.page.url();
    const documentAfter = await documentMarker(ctx);
    check(
      await continuity(ctx, before),
      'native Link navigation replaced the document',
    );
    await ctx.page.goBack({
      waitUntil: 'domcontentloaded',
      timeout: ctx.remaining(),
    });
    await visibleText(ctx, testId('native-route'));
    await ctx.page.waitForFunction(
      expected => location.href === expected,
      { timeout: ctx.remaining() },
      urlBefore,
    );
    const historyBackUrl = ctx.page.url();
    await ctx.page.goForward({
      waitUntil: 'domcontentloaded',
      timeout: ctx.remaining(),
    });
    await visibleText(ctx, testId('native-about'));
    await ctx.page.waitForFunction(
      expected => location.href === expected,
      { timeout: ctx.remaining() },
      urlAfter,
    );
    check(
      await continuity(ctx, before),
      'native history traversal replaced the document',
    );
    return {
      documentBefore,
      documentAfter,
      nativeLink: clicked.tag === 'A',
      urlBefore,
      urlAfter,
      historyBackUrl,
      historyForwardUrl: ctx.page.url(),
      sourceMarker,
      destinationMarker,
      expectedDestinationMarker: `Native ${capital(ctx.row.renderer)} navigation`,
      clickedLink: clicked,
      documentContinuityObserved: true,
    };
  } finally {
    await before.dispose();
  }
}

function documentCase(ctx, scenario) {
  const url = new URL(ctx.home);
  url.searchParams.set('case', scenario);
  return url.href;
}

function controlURL(ctx, conformanceId) {
  const source = ctx.host.probes?.stream?.statePath;
  check(
    typeof source === 'string',
    'actual supplied stream control endpoint is required',
  );
  const url = new URL(source, ctx.base);
  check(
    url.origin === ctx.base.origin &&
      url.searchParams.get('__loader') === ctx.authority.controlRouteId,
    'control URL does not bind the actual authorized control route',
  );
  url.searchParams.set('conformanceId', conformanceId);
  return url;
}

async function control(ctx, conformanceId, method = 'GET', options = {}) {
  const url = controlURL(ctx, conformanceId);
  const signal = options.signal ?? ctx.controller.signal;
  signal.throwIfAborted();
  options.onDispatch?.(Date.now());
  const response = await fetch(url, {
    method,
    cache: 'no-store',
    redirect: 'manual',
    signal,
  });
  check(
    response.status === 200,
    `real control ${method} must succeed with HTTP200`,
  );
  let state;
  if (ctx.row.renderer === 'react') {
    check(
      ctx.host.probes?.controlProtocol === 'react-json',
      'React must use its actual raw JSON control protocol',
    );
    check(
      /^application\/json(?:;|$)/iu.test(
        response.headers.get('content-type') ?? '',
      ),
      'React controls must return genuine JSON',
    );
    state = await abortBounded(signal, () => response.json());
  } else {
    check(
      typeof ctx.host.decodeControlResponse === 'function',
      'native controls require the installed owning public decoder callback',
    );
    state = await abortBounded(signal, () =>
      ctx.host.decodeControlResponse(response, {
        url: url.href,
        method,
        signal,
      }),
    );
  }
  check(
    state &&
      typeof state === 'object' &&
      !Array.isArray(state) &&
      typeof state.released === 'boolean' &&
      Number.isInteger(state.activeRequests) &&
      state.activeRequests >= 0 &&
      Number.isInteger(state.cleanupCount) &&
      state.cleanupCount >= 0 &&
      typeof state.cancelled === 'boolean',
    'actual control state is malformed',
  );
  return state;
}

async function waitControl(ctx, id, expected) {
  while (true) {
    const state = await control(ctx, id);
    if (
      Object.entries(expected).every(([name, value]) => state[name] === value)
    )
      return state;
    ctx.remaining();
    await delay(Math.min(40, ctx.remaining()), undefined, {
      signal: ctx.controller.signal,
    });
  }
}

async function retireDeferredHandles(ctx, monitor, source, before, failure) {
  const results = await Promise.allSettled([
    (async () => {
      if (!monitor) return;
      let stopFailure;
      try {
        await abortBounded(ctx.controller.signal, () =>
          monitor.evaluate(value => value.stop()),
        );
      } catch (error) {
        if (!ctx.controller.signal.aborted) stopFailure = error;
      }
      let disposeFailure;
      try {
        await monitor.dispose();
      } catch (error) {
        disposeFailure = error;
      }
      if (stopFailure && disposeFailure)
        throw new AggregateError(
          [stopFailure, disposeFailure],
          'Deferred DOM monitor stop and disposal failed',
        );
      if (stopFailure) throw stopFailure;
      if (disposeFailure) throw disposeFailure;
    })(),
    Promise.resolve().then(() => source.dispose()),
    Promise.resolve().then(() => before.dispose()),
  ]);
  const failures = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason);
  if (failures.length > 0)
    throw new AggregateError(
      failure ? [failure, ...failures] : failures,
      'Deferred browser observation handle cleanup failed',
    );
}

async function deferredNavigation(ctx) {
  const id = `${ctx.host.runId}-b-${randomUUID().slice(0, 8)}`;
  check(
    id.length <= 64,
    'fresh browser conformanceId exceeds the fixture contract',
  );
  assert.deepEqual(await control(ctx, id), {
    released: false,
    activeRequests: 0,
    cleanupCount: 0,
    cancelled: false,
  });
  await home(ctx, { conformanceId: id });
  const source = await link(ctx, 'Open native deferred route');
  const url = new URL(source.facts.href);
  check(
    url.origin === ctx.base.origin &&
      url.pathname === new URL(ctx.home).pathname &&
      url.searchParams.get('case') === 'deferred' &&
      url.searchParams.get('conformanceId') === id &&
      !url.searchParams.has('__loader'),
    'actual authored native deferred Link must preserve the fixture token',
  );
  const before = await ctx.page.evaluateHandle(() => document);
  const documentBefore = await documentMarker(ctx);
  ctx.heldIds.add(id);
  let monitor;
  let failure;
  try {
    monitor = await ctx.page.evaluateHandle(() => {
      const facts = { lateSeenAt: null };
      const sample = () => {
        const late = document.querySelector(
          '[data-testid="native-deferred-late"]',
        );
        if (
          late &&
          late.textContent?.trim() &&
          getComputedStyle(late).visibility !== 'hidden' &&
          late.getClientRects().length > 0 &&
          facts.lateSeenAt === null
        )
          facts.lateSeenAt = Date.now();
      };
      const observer = new MutationObserver(sample);
      observer.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
      sample();
      return {
        snapshot() {
          sample();
          return { ...facts };
        },
        stop() {
          observer.disconnect();
        },
      };
    });
    const responsePromise = ctx.page
      .waitForResponse(
        response => {
          const request = response.request();
          const target = new URL(request.url());
          return (
            request.method() === 'GET' &&
            target.origin === ctx.base.origin &&
            target.pathname === url.pathname &&
            target.searchParams.get('__loader') === ctx.authority.pageRouteId &&
            target.searchParams.get('case') === 'deferred' &&
            target.searchParams.get('conformanceId') === id
          );
        },
        { timeout: ctx.remaining() },
      )
      .then(
        response => ({ response }),
        error => ({ error }),
      );
    await source.element.click();
    const held = await waitControl(ctx, id, {
      released: false,
      activeRequests: 1,
      cleanupCount: 0,
      cancelled: false,
    });
    await waitJSON(
      ctx,
      testId('native-loader-value'),
      'loader',
      'Native critical value',
    );
    const pendingMarker = await visibleText(
      ctx,
      testId('native-deferred-pending'),
    );
    const criticalValue = JSON.parse(
      await existingText(ctx, testId('native-loader-value')),
    ).message;
    const lateBeforeRelease = await existingText(
      ctx,
      testId('native-deferred-late'),
    );
    check(
      !lateBeforeRelease && (await continuity(ctx, before)),
      'native deferred Link must expose critical/pending DOM in the same document before release',
    );
    await ctx.page.waitForFunction(
      expected => location.href === expected,
      { timeout: ctx.remaining() },
      url.href,
    );
    const captured = await abortBounded(
      ctx.controller.signal,
      () => responsePromise,
    );
    if (captured.error) throw captured.error;
    observedIdentity(ctx, captured.response);
    check(
      captured.response.status() === 200,
      'native deferred Link data response must actually succeed with HTTP200',
    );
    const contentType = captured.response.headers()['content-type'];
    check(
      ctx.row.renderer === 'react'
        ? /^text\/modernjs-deferred(?:;|$)/iu.test(contentType ?? '')
        : /^application\/vnd\.ultramodern\.data-stream\+json(?:;|$)/iu.test(
            contentType ?? '',
          ),
      'native deferred Link did not use its owning actual streaming data protocol',
    );
    const heldBeforeRelease = await control(ctx, id);
    assert.deepEqual(
      heldBeforeRelease,
      held,
      'c2-browser-route-proofs: held producer changed before explicit release',
    );
    const justBeforeRelease = await monitor.evaluate(value => value.snapshot());
    check(
      justBeforeRelease.lateSeenAt === null,
      'continuous native deferred Link observer saw late DOM before explicit release',
    );
    const urlBeforeRelease = ctx.page.url();
    let releaseDispatchedAt;
    const released = await control(ctx, id, 'POST', {
      onDispatch(value) {
        releaseDispatchedAt = value;
      },
    });
    check(released.released === true, 'explicit release was not observed');
    const lateValue = await visibleText(ctx, testId('native-deferred-late'));
    const completion = await monitor.evaluate(value => value.snapshot());
    check(
      completion.lateSeenAt !== null &&
        completion.lateSeenAt > releaseDispatchedAt,
      'continuous late DOM ordering is early or ambiguous at the release boundary',
    );
    check(
      await continuity(ctx, before),
      'native deferred Link or late adoption replaced the document',
    );
    const completed = await waitControl(ctx, id, {
      released: true,
      activeRequests: 0,
      cleanupCount: 1,
      cancelled: false,
    });
    const stable = await control(ctx, id);
    assert.deepEqual(
      stable,
      completed,
      'c2-browser-route-proofs: producer cleanup was not stable',
    );
    check(
      ctx.page.url() === url.href,
      'native deferred late adoption changed its authorized navigation URL',
    );
    ctx.heldIds.delete(id);
    return {
      nativeDeferredLink: source.facts.tag === 'A',
      deferredCriticalVisible: criticalValue === 'Native critical value',
      deferredPendingVisible: pendingMarker === 'Native pending',
      deferredLateVisible: lateValue === 'Native late value',
      deferredTransport:
        ctx.row.renderer === 'react'
          ? 'react-modernjs-deferred'
          : 'native-data',
      deferredCriticalValue: criticalValue,
      deferredPendingMarker: pendingMarker,
      deferredLateValue: lateValue,
      deferredLateBeforeRelease: lateBeforeRelease,
      deferredDomCompletion: {
        ...completion,
        releaseDispatchedAt,
        orderingClock: 'observed-browser-and-node-Date.now-ms',
      },
      deferredControlBeforeRelease: heldBeforeRelease,
      deferredControlAfterRelease: stable,
      deferredNavigationUrl: ctx.page.url(),
      deferredUrlBeforeRelease: urlBeforeRelease,
      expectedDeferredNavigationUrl: source.facts.href,
      deferredRequestUrl: captured.response.request().url(),
      deferredResponseStatus: captured.response.status(),
      deferredResponseContentType: contentType,
      deferredDocumentBefore: documentBefore,
      deferredDocumentAfter: await documentMarker(ctx),
      deferredDocumentContinuityObserved: true,
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await retireDeferredHandles(ctx, monitor, source.element, before, failure);
  }
}

async function data(ctx) {
  await home(ctx);
  const loader = await waitJSON(
    ctx,
    testId('native-loader-value'),
    'loader',
    'Native loader value',
  );
  const deferred = await deferredNavigation(ctx);
  const notFoundResponse = await go(ctx, documentCase(ctx, 'not-found'));
  let notFoundMarker;
  if (ctx.row.renderer === 'react') {
    await ctx.page.waitForFunction(
      () =>
        [...document.querySelectorAll('body div')].some(
          node =>
            node.children.length === 0 && node.textContent?.trim() === '404',
        ),
      { timeout: ctx.remaining() },
    );
    notFoundMarker = await ctx.page.evaluate(
      () =>
        [...document.querySelectorAll('body div')]
          .find(
            node =>
              node.children.length === 0 && node.textContent?.trim() === '404',
          )
          ?.textContent?.trim() ?? '',
    );
  } else notFoundMarker = await visibleText(ctx, testId('native-not-found'));
  const thrown = await go(ctx, documentCase(ctx, 'error'));
  const thrownErrorMarker = await visibleText(ctx, testId('native-error'));
  const observations = {
    loaderValue: loader.message,
    expectedLoaderValue: 'Native loader value',
    loaderData: loader,
    ...deferred,
    notFoundStatus: notFoundResponse.status(),
    notFoundMarker,
    thrownErrorMarker,
    thrownErrorStatus: thrown.status(),
  };
  if (typeof ctx.host.observeServerOnlyDataIsolation === 'function') {
    const isolation = await ctx.host.observeServerOnlyDataIsolation({
      row: ctx.row,
      host: ctx.host,
      environment: ctx.environment,
      identity: ctx.identity,
    });
    check(
      isolation &&
        typeof isolation.modulePresent === 'boolean' &&
        isolation.evidence &&
        typeof isolation.evidence === 'object',
      'server-only module isolation must carry actual artifact audit evidence',
    );
    observations.serverOnlyDataModulePresent = isolation.modulePresent;
    observations.serverOnlyDataIsolation = isolation.evidence;
  } else
    observations.unresolvedRequirements = [
      'Server-only data isolation requires the central actual client artifact audit.',
    ];
  return observations;
}

function formSelector(ctx) {
  return ctx.row.renderer === 'react'
    ? testId('native-fetcher-form')
    : `${testId('native-route')} form`;
}

async function enterName(ctx, selector, value) {
  const field = await ctx.page.waitForSelector(
    `${selector} input[name="name"]`,
    { visible: true, timeout: ctx.remaining() },
  );
  check(field, 'actual authored native form input is required');
  try {
    await field.click({ clickCount: 3 });
    await field.press('Backspace');
    if (value) await field.type(value);
    const actual = await field.evaluate(node => node.value);
    assert.equal(
      actual,
      value,
      'c2-browser-route-proofs: actual browser input value differs',
    );
    return actual;
  } finally {
    await field.dispose();
  }
}

async function responseOutcome(ctx, response, operation) {
  observedIdentity(ctx, response);
  const request = response.request();
  const requestURL = new URL(request.url());
  const routeId = requestURL.searchParams.get('__loader');
  check(
    routeId && requestURL.origin === ctx.base.origin,
    'native public form request must expose its actual decorated opaque route ID',
  );
  const status = response.status();
  const bytes =
    status >= 300 && status < 400
      ? null
      : await abortBounded(ctx.controller.signal, () => response.buffer());
  const webResponse = new Response(
    [204, 205, 304].includes(status) ? null : bytes,
    { status, headers: response.headers() },
  );
  if (ctx.row.renderer === 'react') {
    const redirect = response.headers()['x-modernjs-redirect'];
    if (redirect !== undefined)
      return {
        kind: 'redirect',
        status,
        location: redirect,
        protocol: 'react-204-redirect',
      };
    check(
      /^application\/json(?:;|$)/iu.test(
        response.headers()['content-type'] ?? '',
      ),
      'ordinary React action must use its genuine JSON protocol',
    );
    const value = await abortBounded(ctx.controller.signal, () =>
      webResponse.json(),
    );
    return status >= 400
      ? { kind: 'error', status, data: value }
      : { kind: 'success', status, value };
  }
  check(
    typeof ctx.host.readDataResponse === 'function',
    'native browser responses require the actual installed public data reader',
  );
  return abortBounded(ctx.controller.signal, () =>
    ctx.host.readDataResponse(
      webResponse,
      { identity: ctx.identity, routeId, operation },
      ctx.controller.signal,
    ),
  );
}

async function requestFields(ctx, request) {
  let body = request.postData();
  if (typeof body !== 'string' && typeof request.fetchPostData === 'function')
    body = await abortBounded(ctx.controller.signal, () =>
      request.fetchPostData(),
    );
  check(typeof body === 'string', 'actual native submission body is required');
  return abortBounded(ctx.controller.signal, () =>
    new Response(body, { headers: request.headers() }).formData(),
  );
}

async function submit(ctx, selector, buttonSelector, expectedRouteId) {
  const button = await ctx.page.waitForSelector(
    `${selector} ${buttonSelector}`,
    { visible: true, timeout: ctx.remaining() },
  );
  check(button, 'actual native form submit button is required');
  try {
    const form = await button.evaluate(node => ({
      formTag: node.form?.tagName,
      buttonType: node.type,
      formAction: node.getAttribute('formaction'),
      formIntent: node.name === 'intent' ? node.value : null,
      inputValue: node.form?.elements.namedItem('name')?.value,
      documentUrl: location.href,
      documentBaseURI: document.baseURI,
      rawFormAction: node.form?.getAttribute('action'),
    }));
    check(
      form.formTag === 'FORM' && form.buttonType === 'submit',
      'proof requires an actual authored form submitter',
    );
    check(
      typeof form.inputValue === 'string',
      'actual clicked form must own its name input',
    );
    const rawTarget = form.formAction ?? form.rawFormAction;
    const target =
      rawTarget && !rawTarget.startsWith('javascript:')
        ? new URL(rawTarget, form.documentBaseURI)
        : new URL(form.documentUrl);
    check(
      target.origin === ctx.base.origin,
      'actual clicked form target cannot leave the owning host',
    );
    const responsePromise = ctx.page.waitForResponse(
      async response => {
        const request = response.request();
        const url = new URL(request.url());
        if (
          request.method() !== 'POST' ||
          url.origin !== target.origin ||
          url.pathname !== target.pathname ||
          !url.searchParams.has('__loader') ||
          (expectedRouteId &&
            url.searchParams.get('__loader') !== expectedRouteId)
        )
          return false;
        for (const [name, value] of target.searchParams)
          if (url.searchParams.get(name) !== value) return false;
        const fields = await requestFields(ctx, request);
        return (
          fields.get('name') === form.inputValue &&
          fields.get('intent') === form.formIntent
        );
      },
      { timeout: ctx.remaining() },
    );
    const [response] = await Promise.all([responsePromise, button.click()]);
    const request = response.request();
    const fields = await requestFields(ctx, request);
    const outcome = await responseOutcome(ctx, response, 'action');
    return {
      form,
      response,
      requestMethod: request.method(),
      requestUrl: request.url(),
      requestFields: [...fields.entries()].map(([name, value]) => [
        name,
        typeof value === 'string' ? value : { fileName: value.name },
      ]),
      submittedValue: fields.get('name'),
      outcome,
      wireStatus: response.status(),
    };
  } finally {
    await button.dispose();
  }
}

async function action(ctx) {
  await home(ctx);
  const selector = formSelector(ctx);
  const submitted = `${ctx.host.runId}-saved`;
  await enterName(ctx, selector, submitted);
  const saved = await submit(
    ctx,
    selector,
    'button[type="submit"]:not([name])',
    ctx.authority.pageRouteId,
  );
  const rendered = await waitJSON(
    ctx,
    testId('native-action-value'),
    'saved',
    submitted,
  );
  const resultValue = rendered?.value?.saved ?? rendered?.saved;
  await enterName(ctx, selector, '');
  const validation = await submit(
    ctx,
    selector,
    'button[type="submit"]:not([name])',
    ctx.authority.pageRouteId,
  );
  let validationMarker;
  if (ctx.row.renderer === 'react') {
    await ctx.page.waitForFunction(
      value => document.querySelector(value)?.textContent?.trim() === 'idle',
      { timeout: ctx.remaining() },
      testId('native-fetcher-state'),
    );
    validationMarker =
      (await existingText(ctx, testId('native-action-error-data'))) ||
      (await existingText(ctx, testId('native-action-error')));
  } else {
    await waitJSON(ctx, testId('native-action-value'), 'validation');
    validationMarker = await existingText(ctx, testId('native-action-value'));
  }
  let submitter;
  const unresolvedRequirements = [];
  if (ctx.row.renderer === 'solid') {
    await clickLink(ctx, 'Open native item route', testId('native-route'));
    await ctx.page.waitForFunction(
      () => document.head.querySelector('base[href]')?.href.endsWith('/items/'),
      { timeout: ctx.remaining() },
    );
    const baseHref = await ctx.page.evaluate(
      () => document.head.querySelector('base[href]')?.href,
    );
    const relativeValue = `${ctx.host.runId}-relative`;
    await enterName(ctx, selector, relativeValue);
    const itemRouteId = ctx.authority.itemRouteId;
    const relative = await submit(
      ctx,
      selector,
      testId('native-relative-submitter'),
      itemRouteId,
    );
    await waitJSON(ctx, testId('native-action-value'), 'saved', relativeValue);
    const actual = new URL(relative.requestUrl);
    const target = new URL(relative.form.formAction, baseHref);
    check(
      actual.origin === target.origin &&
        actual.pathname === target.pathname &&
        actual.searchParams.get('intent') === 'alternate',
      'real relative submitter did not resolve against the real document base',
    );
    check(
      relative.outcome?.kind === 'success' &&
        relative.outcome.value?.saved === relativeValue &&
        relative.submittedValue === relativeValue &&
        relative.outcome.value?.requestUrl === relative.requestUrl &&
        relative.outcome.value?.routeId ===
          actual.searchParams.get('__loader') &&
        relative.outcome.value?.submitterIntent === 'alternate',
      'actual relative action outcome does not agree with its own request',
    );
    submitter = {
      submitterBaseHref: baseHref,
      submitterRequestUrl: relative.requestUrl,
      submitterFormAction: relative.form.formAction,
      submitterFormIntent: relative.form.formIntent,
      submitterObservedRouteId: actual.searchParams.get('__loader'),
      submitterOutcome: relative.outcome,
      submitterRequestFields: relative.requestFields,
    };
    if (typeof itemRouteId === 'string' && itemRouteId) {
      assert.equal(
        actual.searchParams.get('__loader'),
        itemRouteId,
        'c2-browser-route-proofs: relative submitter differs from actual analyzed item route ID',
      );
      submitter.submitterBoundRouteId = itemRouteId;
    } else
      unresolvedRequirements.push(
        'Solid relative submitter needs the independently analyzed itemRouteId; its observed request ID is recorded separately.',
      );
    await clickLink(ctx, 'Home', testId('native-route'), 'nav');
  }
  await enterName(ctx, selector, submitted);
  const before = await ctx.page.evaluateHandle(() => document);
  try {
    const documentBefore = await documentMarker(ctx);
    const redirectBeforeUrl = ctx.page.url();
    const redirected = await submit(
      ctx,
      selector,
      'button[name="intent"][value="redirect"]',
      ctx.authority.pageRouteId,
    );
    await visibleText(ctx, testId('native-about'));
    check(
      await continuity(ctx, before),
      'native action redirect replaced the actual document',
    );
    const observations = {
      nativeForm: saved.form.formTag === 'FORM',
      requestMethod: saved.requestMethod,
      submittedValue: saved.submittedValue,
      expectedSubmittedValue: submitted,
      resultValue,
      expectedResultValue: submitted,
      renderedActionValue: rendered,
      actionOutcome: saved.outcome,
      actionRequestFields: saved.requestFields,
      validationStatus: validation.outcome.status,
      validationMarker,
      validationOutcome: validation.outcome,
      redirectProtocol:
        ctx.row.renderer === 'react' ? 'react-header' : 'native-data',
      redirectTransportStatus: redirected.wireStatus,
      redirectTarget: redirected.outcome.location,
      redirectOutcome: redirected.outcome,
      redirectBeforeUrl,
      redirectAfterUrl: ctx.page.url(),
      documentBefore,
      documentAfter: await documentMarker(ctx),
      documentContinuityObserved: true,
      ...submitter,
    };
    if (ctx.row.renderer !== 'react')
      observations.redirectOutcomeStatus = redirected.outcome.status;
    if (ctx.row.renderer === 'react' && !validationMarker)
      unresolvedRequirements.push(
        'Current React fixture does not render the raw Response validation error.',
      );
    if (unresolvedRequirements.length > 0)
      observations.unresolvedRequirements = unresolvedRequirements;
    return observations;
  } finally {
    await before.dispose();
  }
}

function compilerCSS(ctx) {
  const authority = ctx.host.cssAuthority ?? ctx.authority.cssAuthority;
  check(
    authority &&
      Array.isArray(authority.compiledCssAssets) &&
      Array.isArray(authority.startupStylesheetUrls),
    'head proof requires actual completed compiler CSS authority and startup URLs',
  );
  const normalize = href => {
    check(
      typeof href === 'string' && href,
      'actual compiler CSS href is required',
    );
    const url = new URL(href, ctx.base);
    check(
      url.origin === ctx.base.origin &&
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.hash,
      'compiler CSS URL must resolve to the actual host public endpoint',
    );
    return url.href;
  };
  const records = authority.compiledCssAssets.map(asset => {
    check(
      asset &&
        typeof asset === 'object' &&
        typeof asset.sha256 === 'string' &&
        /^[a-f\d]{64}$/u.test(asset.sha256) &&
        Number.isSafeInteger(asset.size) &&
        asset.size >= 0,
      'actual compiler CSS record requires byte SHA and size',
    );
    return {
      href: normalize(asset.href),
      sha256: asset.sha256,
      size: asset.size,
    };
  });
  check(
    new Set(records.map(record => record.href)).size === records.length,
    'actual compiler CSS closure duplicates a public URL',
  );
  const startup = authority.startupStylesheetUrls.map(normalize);
  check(
    new Set(startup).size === startup.length &&
      startup.every(href => records.some(record => record.href === href)),
    'actual startup stylesheet URLs must be unique members of the compiled CSS closure',
  );
  return {
    records,
    startup,
    byHref: new Map(records.map(record => [record.href, record])),
  };
}

async function loadedStyles(ctx, css) {
  await ctx.browserStyles.ensureDOM();
  await ctx.page.waitForFunction(
    ({ compiled, startup }) => {
      const nodes = [
        ...document.querySelectorAll('link[rel~="stylesheet"]'),
      ].filter(node => node instanceof HTMLLinkElement);
      const urls = nodes.map(node => node.href);
      return (
        new Set(urls).size === urls.length &&
        nodes.every(
          node =>
            node.sheet &&
            !node.disabled &&
            !node.sheet.disabled &&
            compiled.includes(node.href),
        ) &&
        startup.every(href => urls.includes(href))
      );
    },
    { timeout: ctx.remaining() },
    { compiled: css.records.map(record => record.href), startup: css.startup },
  );
  const styles = await ctx.page.evaluate(() =>
    [...document.querySelectorAll('link[rel~="stylesheet"]')]
      .filter(node => node instanceof HTMLLinkElement)
      .map(node => ({
        href: node.href,
        rawHref: node.getAttribute('href'),
        loaded: Boolean(node.sheet) && !node.disabled && !node.sheet.disabled,
      })),
  );
  check(
    new Set(styles.map(style => style.href)).size === styles.length &&
      styles.every(style => style.loaded && css.byHref.has(style.href)) &&
      css.startup.every(href => styles.some(style => style.href === href)),
    'actual loaded DOM styles must be unique, include startup and remain within completed compiler CSS closure',
  );
  return styles;
}

async function withBrowserStyles(ctx, operation) {
  check(
    typeof ctx.page.createCDPSession === 'function',
    'loaded browser CSS requires the public Puppeteer CDP session API',
  );
  const session = await ctx.page.createCDPSession();
  const sheets = new Map();
  let generation = 0;
  let validatedGeneration;
  let domMonitor;
  let validatedDOMGeneration;
  const added = ({ header }) =>
    sheets.set(header.styleSheetId, { header, generation: ++generation });
  const removed = ({ styleSheetId }) => {
    generation += 1;
    sheets.delete(styleSheetId);
  };
  const changed = ({ styleSheetId }) => {
    const record = sheets.get(styleSheetId);
    if (record) record.generation = ++generation;
  };
  session.on('CSS.styleSheetAdded', added);
  session.on('CSS.styleSheetRemoved', removed);
  session.on('CSS.styleSheetChanged', changed);
  const send = (method, params = {}) =>
    abortBounded(ctx.controller.signal, () =>
      session.send(method, params, { timeout: ctx.remaining() }),
    );
  const owner = async style => {
    const { root } = await send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'link[rel~="stylesheet"]',
    });
    const descriptions = await Promise.allSettled(
      nodeIds.map(nodeId => send('DOM.describeNode', { nodeId })),
    );
    const failures = descriptions
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Actual main-document stylesheet owner observation failed',
      );
    const matches = descriptions
      .map(result => result.value.node)
      .filter(node => {
        if (node.nodeName !== 'LINK' || !Array.isArray(node.attributes))
          return false;
        const attributes = new Map();
        for (let index = 0; index < node.attributes.length; index += 2)
          attributes.set(node.attributes[index], node.attributes[index + 1]);
        return attributes.get('href') === style.rawHref;
      });
    check(
      matches.length === 1 &&
        Number.isInteger(matches[0].backendNodeId) &&
        matches[0].backendNodeId > 0,
      'actual loaded CSS must bind exactly one main-document link owner',
    );
    const { frameTree } = await send('Page.getFrameTree');
    return {
      backendNodeId: matches[0].backendNodeId,
      frameId: frameTree.frame.id,
    };
  };
  const candidates = (href, actualOwner) =>
    [...sheets.values()].filter(
      record =>
        record.header.sourceURL === href &&
        record.header.frameId === actualOwner.frameId &&
        record.header.ownerNode === actualOwner.backendNodeId &&
        record.header.origin === 'regular' &&
        record.header.hasSourceURL === false &&
        record.header.isInline === false &&
        record.header.isConstructed === false &&
        record.header.disabled === false &&
        record.header.loadingFailed !== true,
    );
  ctx.browserStyles = {
    async ensureDOM() {
      if (domMonitor) return;
      domMonitor = await ctx.page.evaluateHandle(() => {
        let epoch = 0;
        const observer = new MutationObserver(records => {
          epoch += records.length;
        });
        observer.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        const snapshot = () => {
          epoch += observer.takeRecords().length;
          return epoch;
        };
        return {
          snapshot,
          stop() {
            const value = snapshot();
            observer.disconnect();
            return value;
          },
        };
      });
      ctx.controller.signal.throwIfAborted();
    },
    async domEpoch() {
      await this.ensureDOM();
      return abortBounded(ctx.controller.signal, () =>
        domMonitor.evaluate(value => value.snapshot()),
      );
    },
    async assertDOMEpoch(epoch) {
      check(
        (await this.domEpoch()) === epoch,
        'application DOM changed during the final CSS and semantic consistency snapshot',
      );
      validatedDOMGeneration = epoch;
    },
    epoch() {
      return generation;
    },
    assertEpoch(epoch) {
      check(
        generation === epoch,
        'browser CSS inventory changed during the final consistency snapshot',
      );
      validatedGeneration = epoch;
    },
    assertRetiredSnapshot() {
      check(
        validatedGeneration !== undefined && generation === validatedGeneration,
        'browser CSS inventory changed after its final authenticated snapshot',
      );
    },
    async read(style, expected) {
      const actualOwner = await owner(style);
      let matches = candidates(style.href, actualOwner);
      while (matches.length === 0) {
        ctx.remaining();
        await delay(10, undefined, { signal: ctx.controller.signal });
        matches = candidates(style.href, actualOwner);
      }
      check(
        matches.length === 1,
        'each actual loaded CSS URL must have exactly one enabled external browser stylesheet',
      );
      const record = matches[0];
      const version = record.generation;
      const { text } = await send('CSS.getStyleSheetText', {
        styleSheetId: record.header.styleSheetId,
      });
      check(
        typeof text === 'string',
        'the actual browser stylesheet omitted its source text',
      );
      const bytes = Buffer.from(text, 'utf8');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      check(
        bytes.byteLength === expected.size && sha256 === expected.sha256,
        `browser-held raw CSS bytes differ from the independently compiled record: ${JSON.stringify({ href: style.href, browserSha256: sha256, browserSize: bytes.byteLength, expectedSha256: expected.sha256, expectedSize: expected.size })}`,
      );
      return {
        version,
        browserSha256: sha256,
        browserSize: bytes.byteLength,
        browserStyleSheetId: record.header.styleSheetId,
        browserSourceURL: record.header.sourceURL,
        browserFrameId: actualOwner.frameId,
        browserOwnerNode: actualOwner.backendNodeId,
      };
    },
    async assertUnchanged(style, browser) {
      const actualOwner = await owner(style);
      check(
        actualOwner.backendNodeId === browser.browserOwnerNode &&
          actualOwner.frameId === browser.browserFrameId,
        'actual main-document stylesheet owner changed during CSS authentication',
      );
      const matches = candidates(style.href, actualOwner);
      check(
        matches.length === 1 &&
          matches[0].header.styleSheetId === browser.browserStyleSheetId &&
          matches[0].generation === browser.version,
        'browser stylesheet changed, vanished or duplicated while CSS bytes were authenticated',
      );
      const { text } = await send('CSS.getStyleSheetText', {
        styleSheetId: browser.browserStyleSheetId,
      });
      check(
        typeof text === 'string',
        'the current browser stylesheet omitted its source text',
      );
      const bytes = Buffer.from(text, 'utf8');
      check(
        bytes.byteLength === browser.browserSize &&
          createHash('sha256').update(bytes).digest('hex') ===
            browser.browserSha256,
        'actual browser stylesheet text changed during CSS authentication',
      );
    },
  };
  let failure;
  let result;
  try {
    ctx.controller.signal.throwIfAborted();
    await send('DOM.enable');
    await send('CSS.enable');
    result = await operation();
  } catch (error) {
    failure = error;
  }
  const cleanupFailures = [];
  const cleanup = new AbortController();
  const timer = setTimeout(
    () => cleanup.abort(new Error('Browser CSS observer detach exceeded2s')),
    2_000,
  );
  try {
    try {
      if (!session.detached)
        await abortBounded(cleanup.signal, () => session.detach());
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      if (!failure) ctx.browserStyles.assertRetiredSnapshot();
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (domMonitor) {
      try {
        const epoch = await abortBounded(cleanup.signal, () =>
          domMonitor.evaluate(value => value.stop()),
        );
        if (!failure)
          check(
            epoch === validatedDOMGeneration,
            'application DOM changed after the final authenticated CSS and semantic snapshot',
          );
      } catch (error) {
        cleanupFailures.push(error);
      }
      try {
        await abortBounded(cleanup.signal, () => domMonitor.dispose());
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  } finally {
    session.off('CSS.styleSheetAdded', added);
    session.off('CSS.styleSheetRemoved', removed);
    session.off('CSS.styleSheetChanged', changed);
    delete ctx.browserStyles;
    clearTimeout(timer);
    cleanup.abort();
  }
  if (cleanupFailures.length > 0)
    throw new AggregateError(
      failure ? [failure, ...cleanupFailures] : cleanupFailures,
      'CSS observation and retirement failed',
    );
  if (failure) throw failure;
  return result;
}

async function authenticateStyles(ctx, css, styles) {
  const results = await Promise.allSettled(
    styles.map(async style => {
      const expected = css.byHref.get(style.href);
      check(
        expected,
        'actual loaded CSS has no independently compiled byte record',
      );
      const browser = await ctx.browserStyles.read(style, expected);
      const response = await fetch(style.href, {
        cache: 'no-store',
        redirect: 'manual',
        signal: ctx.controller.signal,
      });
      const contentType = response.headers.get('content-type');
      check(
        response.status === 200 &&
          contentType?.split(';')[0]?.trim().toLowerCase() === 'text/css',
        'actual loaded public CSS must succeed with HTTP200 and CSS media type',
      );
      check(
        response.body,
        'actual loaded public CSS response omitted its body',
      );
      const reader = response.body.getReader();
      const hash = createHash('sha256');
      const decoder = new TextDecoder();
      let size = 0;
      let source = '';
      try {
        while (true) {
          const chunk = await abortBounded(ctx.controller.signal, () =>
            reader.read(),
          );
          if (chunk.done) break;
          size += chunk.value.byteLength;
          check(
            size <= expected.size,
            'public CSS exceeds its actual compiler byte inventory',
          );
          hash.update(chunk.value);
          source += decoder.decode(chunk.value, { stream: true });
        }
        source += decoder.decode();
      } catch (error) {
        await abortBounded(ctx.controller.signal, () =>
          reader.cancel(error),
        ).catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      const sha256 = hash.digest('hex');
      check(
        size === expected.size && sha256 === expected.sha256,
        'actual public loaded CSS bytes differ from completed compiler SHA/size',
      );
      return {
        observation: {
          ...style,
          sha256,
          size,
          status: response.status,
          contentType,
          browserSha256: browser.browserSha256,
          browserSize: browser.browserSize,
          browserStyleSheetId: browser.browserStyleSheetId,
          browserSourceURL: browser.browserSourceURL,
          browserFrameId: browser.browserFrameId,
          browserOwnerNode: browser.browserOwnerNode,
        },
        containsLazyRule: source.includes('.native-lazy-detail'),
        browser,
      };
    }),
  );
  const failures = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason);
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Actual loaded CSS authentication failed',
    );
  const records = results.map(result => result.value);
  await recheckAuthenticatedStyles(ctx, css, records);
  return records;
}

async function recheckAuthenticatedStyles(ctx, css, records, domEpoch) {
  const epoch = ctx.browserStyles.epoch();
  const actualDOMEpoch = domEpoch ?? (await ctx.browserStyles.domEpoch());
  const styles = records.map(record => ({
    href: record.observation.href,
    rawHref: record.observation.rawHref,
    loaded: record.observation.loaded,
  }));
  for (const record of records)
    await ctx.browserStyles.assertUnchanged(record.observation, record.browser);
  assert.deepEqual(
    await loadedStyles(ctx, css),
    styles,
    'c2-browser-route-proofs: actual stylesheet DOM changed before the final observation',
  );
  await ctx.browserStyles.assertDOMEpoch(actualDOMEpoch);
  ctx.browserStyles.assertEpoch(epoch);
}

async function solidLazyCSS(ctx, css) {
  await visibleText(ctx, testId('native-lazy'));
  await ctx.page.waitForFunction(
    selector => {
      const node = document.querySelector(selector);
      if (!node || !node.getClientRects().length) return false;
      const style = getComputedStyle(node);
      return (
        style.visibility !== 'hidden' &&
        style.borderInlineStartWidth === '2px' &&
        style.paddingInlineStart ===
          getComputedStyle(document.documentElement).fontSize
      );
    },
    { timeout: ctx.remaining() },
    testId('native-lazy'),
  );
  const authenticated = await authenticateStyles(
    ctx,
    css,
    await loadedStyles(ctx, css),
  );
  const domEpoch = await ctx.browserStyles.domEpoch();
  const facts = await ctx.page.evaluate(selector => {
    const node = document.querySelector(selector);
    const style = getComputedStyle(node);
    const rootFontSize = getComputedStyle(document.documentElement).fontSize;
    const matchingRule = rules =>
      [...rules].some(rule => {
        if (rule instanceof CSSStyleRule)
          return (
            rule.selectorText.includes('.native-lazy-detail') &&
            node.matches(rule.selectorText) &&
            rule.style.getPropertyValue('border-inline-start-width').trim() ===
              '2px' &&
            rule.style.getPropertyValue('padding-inline-start').trim() ===
              '1rem'
          );
        if (rule instanceof CSSMediaRule)
          return (
            matchMedia(rule.conditionText).matches &&
            matchingRule(rule.cssRules)
          );
        if (rule instanceof CSSSupportsRule)
          return (
            CSS.supports(rule.conditionText) && matchingRule(rule.cssRules)
          );
        if (
          typeof CSSLayerBlockRule !== 'undefined' &&
          rule instanceof CSSLayerBlockRule
        )
          return matchingRule(rule.cssRules);
        return false;
      });
    const activeMatchingRuleStylesheetUrls = [
      ...document.querySelectorAll('link[rel~="stylesheet"]'),
    ]
      .filter(
        link =>
          link instanceof HTMLLinkElement &&
          link.sheet &&
          !link.disabled &&
          !link.sheet.disabled &&
          matchMedia(link.media || 'all').matches &&
          matchMedia(link.sheet.media.mediaText || 'all').matches &&
          matchingRule(link.sheet.cssRules),
      )
      .map(link => link.href);
    return {
      visible:
        node.getClientRects().length > 0 && style.visibility !== 'hidden',
      borderInlineStartWidth: style.borderInlineStartWidth,
      paddingInlineStart: style.paddingInlineStart,
      rootFontSize,
      paddingMatchesRootFontSize: style.paddingInlineStart === rootFontSize,
      activeMatchingRuleStylesheetUrls,
    };
  }, testId('native-lazy'));
  check(
    facts.visible &&
      facts.borderInlineStartWidth === '2px' &&
      facts.paddingMatchesRootFontSize,
    'actual native lazy computed styles changed during CSS authentication',
  );
  const sheets = authenticated
    .filter(
      record =>
        record.containsLazyRule &&
        facts.activeMatchingRuleStylesheetUrls.includes(
          record.observation.href,
        ),
    )
    .map(record => record.observation.href);
  check(
    sheets.length > 0,
    'visible native lazy CSS must have an active matching rule in an actually loaded authenticated compiler stylesheet',
  );
  await recheckAuthenticatedStyles(ctx, css, authenticated, domEpoch);
  return {
    lazyCSSSemanticFacts: { ...facts, authenticatedStylesheetUrls: sheets },
    lazyCSSObservedStylesheets: authenticated.map(record => record.observation),
  };
}

function styleObservations(css, styles) {
  return {
    stylesheetCount: styles.length,
    uniqueStylesheetCount: new Set(styles.map(style => style.href)).size,
    stylesheetUrls: styles.map(style => style.href),
    compiledStylesheetUrls: css.records.map(record => record.href),
    requiredStartupStylesheetUrls: css.startup,
    compiledStylesheetAssets: css.records,
    observedStylesheets: styles,
    stylesheetSetWithinCompiledClosure:
      styles.every(style => css.byHref.has(style.href)) &&
      css.startup.every(href => styles.some(style => style.href === href)),
  };
}

/**
 * Read and authenticate current loaded CSS without navigation. Before an HMR
 * call, the owner supplies the independently observed NEW-generation compiler
 * closure through host.cssAuthority; the startup authority is never reused as
 * current compiler evidence. This function observes bytes, not renderer identity.
 * renderer:'solid' additionally requires the visible lazy component's actual
 * border/padding and an authenticated loaded stylesheet containing its selector.
 * Separate UTF-8 CDP browser stylesheet-text SHA/size must match compiled bytes;
 * no text normalization is performed. A scoped
 * observer is detached in finally and the live stylesheet nodes are rechecked.
 */
export async function observeCompilerStyles({
  page,
  host,
  renderer,
  timeoutMs,
}) {
  check(
    page &&
      typeof page.evaluate === 'function' &&
      typeof page.evaluateHandle === 'function' &&
      typeof page.waitForFunction === 'function',
    'the caller must supply its actual Puppeteer page',
  );
  check(
    renderer === undefined || ['react', 'solid', 'octane'].includes(renderer),
    'a supplied renderer must identify the actual selected renderer',
  );
  const ctx = {
    ...boundedContext(host, timeoutMs),
    page,
    host,
    authority: host.authority ?? host.routeAuthority ?? {},
  };
  try {
    return await abortBounded(ctx.controller.signal, () =>
      withBrowserStyles(ctx, async () => {
        const css = compilerCSS(ctx);
        const lazy = renderer === 'solid' ? await solidLazyCSS(ctx, css) : {};
        const styles =
          renderer === 'solid'
            ? lazy.lazyCSSObservedStylesheets
            : (
                await authenticateStyles(ctx, css, await loadedStyles(ctx, css))
              ).map(record => record.observation);
        return {
          ...styleObservations(css, styles),
          ...lazy,
        };
      }),
    );
  } finally {
    ctx.finish();
  }
}

async function headAssets(ctx) {
  return withBrowserStyles(ctx, () => observedHeadAssets(ctx));
}

async function observedHeadAssets(ctx) {
  const css = compilerCSS(ctx);
  await home(ctx);
  const before = await ctx.page.evaluateHandle(() => document);
  try {
    const lazy =
      ctx.row.renderer === 'solid' ? await solidLazyCSS(ctx, css) : {};
    const titleBeforeNavigation = await ctx.page.evaluate(() => document.title);
    const beforeNodes = await ctx.page.evaluate(() =>
      [...document.head.children]
        .filter(
          node =>
            node.tagName === 'TITLE' ||
            (node.tagName === 'META' &&
              node.getAttribute('name') === 'description'),
        )
        .map(node => ({
          tag: node.tagName,
          text: node.textContent,
          attributes: [...node.attributes].map(attribute => [
            attribute.name,
            attribute.value,
          ]),
        })),
    );
    await clickLink(ctx, 'Open native about route', testId('native-about'));
    await ctx.page.waitForFunction(
      title => document.title === title,
      { timeout: ctx.remaining() },
      `${ctx.row.renderer} acceptance about`,
    );
    const authenticated = await authenticateStyles(
      ctx,
      css,
      await loadedStyles(ctx, css),
    );
    const domEpoch = await ctx.browserStyles.domEpoch();
    const observed = await ctx.page.evaluate(
      selector => ({
        title: document.title,
        color: getComputedStyle(document.querySelector(selector)).color,
        titleNodes: [...document.head.querySelectorAll('title')].map(node => ({
          text: node.textContent,
          attributes: [...node.attributes].map(attribute => [
            attribute.name,
            attribute.value,
          ]),
        })),
        descriptionNodes: [
          ...document.head.querySelectorAll('meta[name="description"]'),
        ].map(node => ({
          content: node.getAttribute('content'),
          attributes: [...node.attributes].map(attribute => [
            attribute.name,
            attribute.value,
          ]),
        })),
      }),
      testId('native-layout'),
    );
    check(
      await continuity(ctx, before),
      'native head navigation replaced the document',
    );
    await recheckAuthenticatedStyles(ctx, css, authenticated, domEpoch);
    const styles = authenticated.map(record => record.observation);
    return {
      titleBeforeNavigation,
      titleAfterNavigation: observed.title,
      expectedTitle: `${ctx.row.renderer} acceptance about`,
      computedStyleAfterNavigation: observed.color,
      expectedComputedStyle: 'rgb(20, 40, 60)',
      ...styleObservations(css, styles),
      titleNodeCount: observed.titleNodes.length,
      descriptionNodeCount: observed.descriptionNodes.length,
      descriptionAfterNavigation:
        observed.descriptionNodes.length === 1
          ? observed.descriptionNodes[0].content
          : null,
      expectedDescription: 'Native renderer conformance',
      headBeforeNavigation: beforeNodes,
      headAfterNavigation: {
        titles: observed.titleNodes,
        descriptions: observed.descriptionNodes,
      },
      documentContinuityObserved: true,
      ...lazy,
    };
  } finally {
    await before.dispose();
  }
}

/**
 * Execute one route dimension on the caller's genuine already-launched page.
 * Required host fields: identity, baseUrl, probes, runId, authority (or
 * routeAuthority): {routePrefix,pageRouteId,controlRouteId}.
 * Head proof requires host.cssAuthority (or authority.cssAuthority), with the
 * actual completed compiledCssAssets[{href,sha256,size}] and possibly empty
 * startupStylesheetUrls. Loaded CSS is a unique subset of that closure, includes
 * startup, and is authenticated against compiled bytes through both real HTTP
 * and exact raw browser-held CDP stylesheet text, without byte normalization.
 * Native hosts also supply installed readDataResponse and decodeControlResponse;
 * Solid supplies independently analyzed authority.itemRouteId for its relative
 * submitter. Missing item authority leaves that obligation unresolved.
 * Optional observeServerOnlyDataIsolation must return actual artifact evidence.
 * Missing artifact isolation authority remains unresolved. Public head evidence
 * records native title/description updates and exact loaded stylesheet nodes.
 * Returned fields are observations only. The caller merges actually collected
 * renderer identity/console evidence and binds the candidate receipt separately.
 */
export async function runRouteDimension(input) {
  const ctx = context(input);
  try {
    return await abortBounded(ctx.controller.signal, async () => {
      if (ctx.dimension === 'navigation') return navigation(ctx);
      if (ctx.dimension === 'data') return data(ctx);
      if (ctx.dimension === 'action') return action(ctx);
      return headAssets(ctx);
    });
  } catch (error) {
    ctx.controller.abort(error);
    {
      const cleanup = new AbortController();
      const timer = setTimeout(
        () =>
          cleanup.abort(new Error('Browser proof request cleanup exceeded2s')),
        2_000,
      );
      try {
        // Release and cancellation are independent: a broken control decoder
        // cannot prevent ordinary navigation from aborting the owning request.
        const results = await Promise.allSettled([
          ...[...ctx.heldIds].map(id =>
            abortBounded(cleanup.signal, () =>
              control(ctx, id, 'POST', { signal: cleanup.signal }),
            ),
          ),
          abortBounded(cleanup.signal, () =>
            ctx.page.goto('about:blank', {
              waitUntil: 'domcontentloaded',
              timeout: 2_000,
            }),
          ),
        ]);
        const failures = results
          .filter(result => result.status === 'rejected')
          .map(result => result.reason);
        if (failures.length > 0)
          throw new AggregateError(
            [error, ...failures],
            'Browser proof failed and held producer cleanup could not be fully confirmed',
          );
      } finally {
        clearTimeout(timer);
        cleanup.abort();
      }
    }
    throw error;
  } finally {
    ctx.finish();
  }
}
