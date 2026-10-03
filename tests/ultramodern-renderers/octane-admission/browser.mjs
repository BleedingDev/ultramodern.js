import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

fs.writeFileSync(
  'browser-evidence.json',
  `${JSON.stringify({ admission: 'running', rootHost: 'element-fragment' })}\n`,
);
const require = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = require('playwright-core');
const url = process.argv[2];
assert.ok(url, 'Pass the URL printed by run.mjs --serve');
const evidence = {
  passed: false,
  rootHost: 'element-fragment',
  nativeHydration: false,
  lazyHydration: false,
  rootDisposal: false,
  nativeBuildIdentity: false,
  nativeHydrationBuildId: null,
  manifestBuildId: null,
  browserErrors: [],
  hydrationDiagnostics: [],
};
let browser;
let allowClient;
let fragmentFailure;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = evidence.browserErrors;
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (/Octane hydration mismatch/.test(message.text()))
      evidence.hydrationDiagnostics.push(message.text());
  });
  const clientReady = new Promise(resolve => {
    allowClient = resolve;
  });
  await page.route('**/client.js', async route => {
    await clientReady;
    await route.continue();
  });
  await page.goto(`${url}/app`, { waitUntil: 'commit' });
  await page.getByTestId('counter').waitFor({ state: 'attached' });
  await page.getByTestId('lazy').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    globalThis.admissionServerCounter = document.querySelector(
      '[data-testid="counter"]',
    );
    globalThis.admissionServerLazy = document.querySelector(
      '[data-testid="lazy"]',
    );
  });
  allowClient();
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(
    () => typeof globalThis.admissionUnmount === 'function',
  );
  const manifestResponse = await page.request.get(
    `${url}/octane-client-build.json`,
  );
  assert.equal(manifestResponse.ok(), true);
  const manifest = await manifestResponse.json();
  const nativeBuildId = await page.evaluate(
    () => globalThis.admissionNativeHydrationBuildId,
  );
  assert.equal(typeof nativeBuildId, 'string');
  assert.ok(nativeBuildId.length > 0);
  assert.equal(typeof manifest.buildId, 'string');
  assert.ok(manifest.buildId.length > 0);
  assert.equal(nativeBuildId, manifest.buildId);
  evidence.nativeBuildIdentity = true;
  evidence.nativeHydrationBuildId = nativeBuildId;
  evidence.manifestBuildId = manifest.buildId;
  assert.equal(
    await page.evaluate(
      () =>
        globalThis.admissionServerCounter ===
        document.querySelector('[data-testid="counter"]'),
    ),
    true,
  );
  assert.equal(
    await page.evaluate(
      () =>
        globalThis.admissionServerLazy ===
        document.querySelector('[data-testid="lazy"]'),
    ),
    true,
  );
  assert.deepEqual(evidence.hydrationDiagnostics, []);
  await page.getByTestId('lazy').waitFor();
  assert.equal(await page.title(), 'Octane admission');
  assert.equal(await page.getByTestId('counter').innerText(), 'Count: 0');
  await page.getByTestId('counter').click();
  assert.equal(await page.getByTestId('counter').innerText(), 'Count: 1');
  assert.equal(
    await page.getByTestId('lazy').innerText(),
    'Native lazy component',
  );
  evidence.nativeHydration = true;
  evidence.lazyHydration = true;
  await page.evaluate(() => globalThis.admissionUnmount());
  assert.equal(await page.locator('#app').innerText(), '');
  evidence.rootDisposal = true;
  assert.deepEqual(errors, []);
} catch (error) {
  fragmentFailure = error;
} finally {
  allowClient?.();
  try {
    await browser?.close();
  } catch (error) {
    fragmentFailure ??= error;
  }
}
evidence.passed = !fragmentFailure;
if (fragmentFailure) evidence.failure = String(fragmentFailure);
fs.writeFileSync(
  'browser-evidence.json',
  `${JSON.stringify(evidence, null, 2)}\n`,
);
if (fragmentFailure) throw fragmentFailure;
console.log(JSON.stringify(evidence));

if (process.argv.includes('--raw-full-document-diagnostic')) {
  const receipt = 'raw-full-document-diagnostic.json';
  fs.writeFileSync(
    receipt,
    `${JSON.stringify({ admission: 'running', rootHost: 'raw-full-document' })}\n`,
  );
  const diagnostic = {
    passed: false,
    rootHost: 'raw-full-document',
    supported: false,
    nativeNavigation: false,
    nativeLoaderData: false,
    preservedLayoutState: false,
    browserErrors: [],
    hydrationDiagnostics: [],
  };
  let diagnosticBrowser;
  let diagnosticFailure;
  try {
    diagnosticBrowser = await chromium.launch({ headless: true });
    const page = await diagnosticBrowser.newPage();
    page.on('pageerror', error => diagnostic.browserErrors.push(String(error)));
    page.on('console', message => {
      if (/Octane hydration mismatch/.test(message.text()))
        diagnostic.hydrationDiagnostics.push(message.text());
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByTestId('route').waitFor();
    assert.equal(
      await page.getByTestId('route').innerText(),
      'Native home loader',
    );
    assert.equal(await page.title(), 'Native Octane router');
    await page.getByTestId('counter').click();
    assert.equal(await page.getByTestId('counter').innerText(), 'Count: 1');
    const sentinel = await page.evaluate(() => {
      globalThis.admissionDocumentSentinel = crypto.randomUUID();
      return globalThis.admissionDocumentSentinel;
    });
    await page.getByRole('link', { name: 'About', exact: true }).click();
    await page.waitForURL('**/about');
    assert.equal(
      await page.getByTestId('route').innerText(),
      'Native about loader',
    );
    assert.equal(
      await page.evaluate(() => globalThis.admissionDocumentSentinel),
      sentinel,
    );
    assert.equal(await page.getByTestId('counter').innerText(), 'Count: 1');
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(url.endsWith('/') ? url : `${url}/`);
    assert.equal(
      await page.getByTestId('route').innerText(),
      'Native home loader',
    );
    assert.deepEqual(diagnostic.browserErrors, []);
    diagnostic.nativeNavigation = true;
    diagnostic.nativeLoaderData = true;
    diagnostic.preservedLayoutState = true;
  } catch (error) {
    diagnosticFailure = error;
  } finally {
    try {
      await diagnosticBrowser?.close();
    } catch (error) {
      diagnosticFailure ??= error;
    }
  }
  diagnostic.passed = !diagnosticFailure;
  if (diagnosticFailure) diagnostic.failure = String(diagnosticFailure);
  fs.writeFileSync(receipt, `${JSON.stringify(diagnostic, null, 2)}\n`);
  console.log(JSON.stringify(diagnostic));
  if (diagnosticFailure) throw diagnosticFailure;
}
