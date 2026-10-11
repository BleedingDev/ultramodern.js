import assert from 'node:assert/strict';
import fs from 'node:fs';

const url = process.argv[2];
const receipt = 'signals-browser-evidence.json';
const evidence = {
  passed: false,
  nativeDeferredSignalActivation: true,
  authorityReplayWithoutRefetch: false,
  ssrNodeRetained: null,
  rootDisposal: false,
  requestCounts: {
    initial: null,
    before: null,
    beforeActivation: null,
    after: null,
  },
  signalText: null,
  pageErrors: [],
  failure: 'The probe has not completed.',
};
const writeEvidence = () =>
  fs.writeFileSync(receipt, `${JSON.stringify(evidence, null, 2)}\n`);
writeEvidence();

async function bounded(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Observation timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

let browser;
let page;
let release;
let forceExit = false;
const countRequests = () =>
  page.request
    .get(`${url}/signal-requests`, { timeout: 3000 })
    .then(response => response.json())
    .then(value => value.signalRequests);
const observeNode = async () => {
  const snapshot = await bounded(
    page.evaluate(() => {
      const node = document.querySelector('[data-testid="signal-value"]');
      return {
        retained: node !== null && node === globalThis.admissionServerSignal,
        text: node?.textContent ?? null,
      };
    }),
    2000,
  );
  evidence.ssrNodeRetained = snapshot.retained;
  evidence.signalText = snapshot.text;
};
try {
  assert.ok(url, 'Pass the actual native SSR admission host URL.');
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ headless: true, timeout: 10000 });
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(10000);
  evidence.requestCounts.initial = await countRequests();
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  const client = new Promise(resolve => {
    release = resolve;
  });
  await page.route('**/signals-client.js', async route => {
    await client;
    await route.continue();
  });
  const navigation = page.goto(`${url}/signals`, {
    waitUntil: 'domcontentloaded',
  });
  // Keep the held-script navigation rejection handled until its later await.
  navigation.catch(() => {});
  await page.getByTestId('signal-value').waitFor();
  await page.evaluate(() => {
    globalThis.admissionServerSignal = document.querySelector(
      '[data-testid="signal-value"]',
    );
  });
  evidence.requestCounts.before = await countRequests();
  release();
  await navigation;
  await page.waitForFunction(
    () => typeof globalThis.admissionSignalUnmount === 'function',
  );
  evidence.requestCounts.beforeActivation = await countRequests();
  await page.getByTestId('signal-value').click();
  await page.waitForLoadState('networkidle', { timeout: 5000 });
  evidence.requestCounts.after = await countRequests();
  await observeNode();
  assert.equal(
    evidence.requestCounts.before,
    evidence.requestCounts.initial + 1,
  );
  assert.equal(
    evidence.requestCounts.beforeActivation,
    evidence.requestCounts.before,
  );
  assert.equal(
    evidence.requestCounts.after,
    evidence.requestCounts.before,
    'Deferred native signal activation refetched server-authorized data',
  );
  assert.equal(evidence.signalText, 'Native signal complete');
  assert.equal(evidence.ssrNodeRetained, true);
  await page.evaluate(() => globalThis.admissionSignalUnmount());
  assert.equal(await page.locator('#app').innerHTML(), '');
  assert.deepEqual(evidence.pageErrors, []);
  evidence.passed = true;
  evidence.authorityReplayWithoutRefetch = true;
  evidence.rootDisposal = true;
  evidence.failure = null;
} catch (error) {
  evidence.passed = false;
  evidence.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  if (page && !page.isClosed()) {
    if (evidence.requestCounts.after === null) {
      try {
        evidence.requestCounts.after = await countRequests();
      } catch (observationError) {
        evidence.requestCountFailure = String(observationError);
      }
    }
    try {
      await observeNode();
    } catch (observationError) {
      evidence.nodeObservationFailure = String(observationError);
    }
  }
} finally {
  release?.();
  if (browser) {
    try {
      await bounded(browser.close(), 5000);
    } catch (error) {
      evidence.passed = false;
      evidence.cleanupFailure = String(error);
      evidence.failure ??= evidence.cleanupFailure;
      process.exitCode = 1;
      forceExit = true;
    }
  }
  writeEvidence();
}
console.log(JSON.stringify(evidence));
if (forceExit) process.exit(1);
