import assert from 'node:assert/strict';
import { sha256 } from './contract.mjs';

async function captureBrowser(browser, hostOrigin) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', response =>
    requests.push({
      url: response.url(),
      status: response.status(),
      type: response.request().resourceType(),
    }),
  );
  await page.addInitScript(() => {
    const original = new Map();
    const remember = (node, direct) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      for (const id of ['healthy-proof', 'fragile-proof']) {
        if (node.id === id && !original.has(id)) original.set(id, node);
        const descendant = direct ? undefined : node.querySelector(`#${id}`);
        if (descendant && !original.has(id)) original.set(id, descendant);
      }
    };
    new MutationObserver(records => {
      for (const record of records)
        for (const node of record.addedNodes) remember(node, true);
      for (const record of records)
        for (const node of record.addedNodes) remember(node, false);
    }).observe(document, { childList: true, subtree: true });
    Object.defineProperty(window, '__mfOriginalElements', {
      value: id => original.get(id) === document.getElementById(id),
    });
  });
  const response = await page.goto(`${hostOrigin}/mf?token=browser`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  assert.equal(response.status(), 200);
  const body = await response.body();
  return {
    context,
    page,
    errors,
    requests,
    response,
    document: {
      url: response.url(),
      status: response.status(),
      sha256: sha256(body),
      byteLength: body.length,
      html: body.toString(),
    },
  };
}

async function assertRemoteCss(page, roles, requests, expectedRemoteCss) {
  const styles = {};
  for (const role of roles) {
    styles[role] = await page.locator(`#${role}-proof`).evaluate(element => {
      const style = getComputedStyle(element);
      return {
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        borderTopWidth: style.borderTopWidth,
        borderTopStyle: style.borderTopStyle,
      };
    });
    assert.equal(
      styles[role].paddingTop,
      role === 'healthy' ? '7px' : '11px',
      'The actual compiled remote CSS must style its hydrated component',
    );
    assert.equal(styles[role].paddingRight, styles[role].paddingTop);
    assert.equal(
      styles[role].borderTopWidth,
      '1px',
      'The actual compiled shared CSS must style its hydrated component',
    );
    assert.equal(styles[role].borderTopStyle, 'solid');
  }
  const responses = requests.filter(
    request =>
      expectedRemoteCss.includes(request.url) && request.status === 200,
  );
  for (const url of expectedRemoteCss)
    assert(
      responses.some(response => response.url === url),
      `Browser must fetch actual native remote CSS: ${url}`,
    );
  return { styles, responses };
}

export async function browserLifecycleProof(
  browser,
  hostOrigin,
  { expectedRemoteCss } = {},
) {
  const captured = await captureBrowser(browser, hostOrigin);
  const { context, page, errors, requests, document } = captured;
  try {
    assert(
      document.html.includes('healthy-proof') &&
        document.html.includes('fragile-proof'),
      'Both actual native remote components must SSR before hydration',
    );
    for (const id of ['healthy', 'fragile']) {
      await page.waitForSelector(`#${id}-proof[data-hydrated="true"]`);
      assert.equal(
        await page.evaluate(
          id => window.__mfOriginalElements(`${id}-proof`),
          id,
        ),
        true,
        'Native hydration must retain the remote SSR element',
      );
      assert.equal(await page.locator(`#${id}-count`).textContent(), 'count:0');
      await page.locator(`#${id}-count`).click();
      await page.waitForFunction(
        id => document.getElementById(`${id}-count`)?.textContent === 'count:1',
        id,
      );
    }
    const initial = await page.evaluate(() =>
      structuredClone(window.__mfLifecycle),
    );
    const remoteCss = await assertRemoteCss(
      page,
      ['healthy', 'fragile'],
      requests,
      expectedRemoteCss,
    );
    for (const id of ['healthy', 'fragile'])
      assert.equal(initial[id].active, 1);
    const documentRequests = requests.filter(
      request => request.type === 'document',
    ).length;
    await page.evaluate(() => {
      Object.defineProperty(window, '__mfLayoutFirst', {
        value: document.getElementById('lifecycle-layout'),
      });
      Object.defineProperty(window, '__mfDocumentFirst', { value: document });
    });
    await page.locator('#to-away').click();
    await page.waitForSelector('#away-page');
    await page.waitForFunction(() =>
      ['healthy', 'fragile'].every(id => window.__mfLifecycle[id].active === 0),
    );
    const away = await page.evaluate(() =>
      structuredClone(window.__mfLifecycle),
    );
    for (const id of ['healthy', 'fragile'])
      assert(
        away[id].cleanups > initial[id].cleanups,
        'The actual remote useEffect must return its cleanup on native route unmount',
      );
    await page.goBack({ waitUntil: 'networkidle' });
    for (const id of ['healthy', 'fragile'])
      await page.waitForSelector(`#${id}-proof[data-hydrated="true"]`);
    await page.waitForFunction(() =>
      ['healthy', 'fragile'].every(id => window.__mfLifecycle[id].active === 1),
    );
    const remounted = await page.evaluate(() =>
      structuredClone(window.__mfLifecycle),
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__mfLayoutFirst ===
            document.getElementById('lifecycle-layout') &&
          window.__mfDocumentFirst === document,
      ),
      true,
      'Native Link and browser Back must retain the host layout and document',
    );
    assert.equal(
      requests.filter(request => request.type === 'document').length,
      documentRequests,
      'Native router transitions must avoid a document reload',
    );
    for (const id of ['healthy', 'fragile']) {
      assert(remounted[id].setups > initial[id].setups);
      assert.equal(remounted[id].active, 1);
    }
    assert.deepEqual(
      errors,
      [],
      'Valid remote SSR/hydration/navigation must have no browser errors',
    );
    delete document.html;
    return {
      document,
      hydrationRetainedSsrElements: true,
      remoteCss,
      initial,
      away,
      remounted,
      nativeRemoteEvents: true,
      stableHostLayout: true,
      documentReloads: 0,
      errors,
      requests,
    };
  } finally {
    await context.close();
  }
}

export async function browserEndpointFailureProof(
  browser,
  hostOrigin,
  { expectedRemoteCss } = {},
) {
  const captured = await captureBrowser(browser, hostOrigin);
  const { context, page, errors, requests, document } = captured;
  try {
    await page.waitForSelector('#fragile-fallback', { timeout: 60_000 });
    await page.waitForSelector('#healthy-proof[data-hydrated="true"]', {
      timeout: 60_000,
    });
    assert.equal(await page.locator('#healthy-count').textContent(), 'count:0');
    await page.locator('#healthy-count').click();
    await page.waitForFunction(
      () => document.getElementById('healthy-count')?.textContent === 'count:1',
    );
    assert.equal(await page.locator('#fragile-proof').count(), 0);
    const actualFailures = requests.filter(
      request =>
        /\/manifest\/fragile\.json$/u.test(request.url) &&
        request.status === 404,
    );
    assert(
      actualFailures.length > 0,
      'A fresh browser runtime must fetch the actual failed remote manifest endpoint',
    );
    const lifecycle = await page.evaluate(() =>
      structuredClone(window.__mfLifecycle),
    );
    const remoteCss = await assertRemoteCss(
      page,
      ['healthy'],
      requests,
      expectedRemoteCss,
    );
    assert.equal(lifecycle.healthy.active, 1);
    assert.equal(lifecycle.fragile?.active ?? 0, 0);
    delete document.html;
    return {
      document,
      nativeRouteErrorFallback: true,
      healthySiblingInteractive: true,
      remoteCss,
      lifecycle,
      actualFailures,
      observedNativeErrors: errors,
      requests,
    };
  } finally {
    await context.close();
  }
}
