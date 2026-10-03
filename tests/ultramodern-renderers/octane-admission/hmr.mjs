import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
fs.writeFileSync(
  'hmr-evidence.json',
  `${JSON.stringify({ admission: 'running' })}\n`,
);
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ headless: true });
const lazyFile = path.join(root, 'src/Lazy.tsx');
const counterFile = path.join(root, 'src/Counter.tsrx');
const lazySource = fs.readFileSync(lazyFile, 'utf8');
const counterSource = fs.readFileSync(counterFile, 'utf8');
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:40729/', {
    waitUntil: 'networkidle',
  });
  await page.getByTestId('lazy').waitFor();
  await page.waitForFunction(
    () => globalThis.admissionCounterLifecycle?.mounts === 1,
  );
  assert.deepEqual(
    await page.evaluate(() => globalThis.admissionCounterLifecycle),
    { mounts: 1, cleanups: 0 },
  );
  await page.getByTestId('counter').click();
  assert.equal(await page.getByTestId('counter').innerText(), 'Count: 1');
  const sentinel = await page.evaluate(() => {
    globalThis.admissionDocumentSentinel = crypto.randomUUID();
    return {
      sentinel: globalThis.admissionDocumentSentinel,
      timeOrigin: performance.timeOrigin,
      location: location.href,
    };
  });
  fs.writeFileSync(
    counterFile,
    counterSource.replace('Count: ', 'Count HMR: '),
  );
  await page
    .getByTestId('counter')
    .filter({ hasText: 'Count HMR: 1' })
    .waitFor();
  await page.waitForFunction(
    () => globalThis.admissionCounterLifecycle?.mounts === 2,
  );
  assert.deepEqual(
    await page.evaluate(() => globalThis.admissionCounterLifecycle),
    { mounts: 2, cleanups: 1 },
  );
  fs.writeFileSync(
    lazyFile,
    lazySource.replace('Native lazy component', 'Native lazy HMR'),
  );
  await page
    .getByTestId('lazy')
    .filter({ hasText: 'Native lazy HMR' })
    .waitFor();
  assert.equal(await page.getByTestId('counter').innerText(), 'Count HMR: 1');
  assert.deepEqual(
    await page.evaluate(() => globalThis.admissionCounterLifecycle),
    { mounts: 2, cleanups: 1 },
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      sentinel: globalThis.admissionDocumentSentinel,
      timeOrigin: performance.timeOrigin,
      location: location.href,
    })),
    sentinel,
  );
  assert.equal(await page.getByTestId('counter').count(), 1);
  assert.deepEqual(errors, []);
  await page.evaluate(() => globalThis.admissionUnmount());
  assert.equal(await page.locator('#app').innerText(), '');
  const lifecycle = await page.evaluate(
    () => globalThis.admissionCounterLifecycle,
  );
  assert.deepEqual(lifecycle, { mounts: 2, cleanups: 2 });
  const evidence = {
    twoComponentHmr: true,
    editedLeafState: true,
    unaffectedSiblingState: true,
    noDocumentReload: true,
    stableTimeOrigin: true,
    locationRetained: true,
    singleRoot: true,
    rootDisposal: true,
    editedBoundaryDisposedOnce: true,
    lifecycle,
    browserErrors: errors,
  };
  fs.writeFileSync(
    'hmr-evidence.json',
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(JSON.stringify(evidence));
} catch (error) {
  fs.writeFileSync(
    'hmr-evidence.json',
    `${JSON.stringify({ admission: 'failed', failure: String(error), browserErrors: errors }, null, 2)}\n`,
  );
  throw error;
} finally {
  fs.writeFileSync(lazyFile, lazySource);
  fs.writeFileSync(counterFile, counterSource);
  await browser.close();
}
