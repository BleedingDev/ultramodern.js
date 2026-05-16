import { execSync } from 'node:child_process';
import dns from 'node:dns';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

dns.setDefaultResultOrder('ipv4first');

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const browserLaunchOptions = launchOptions as Parameters<
  typeof puppeteer.launch
>[0];

type AppProcess = Awaited<ReturnType<typeof launchApp>>;

function expectTypecheckPasses() {
  execSync('pnpm exec tsgo --noEmit -p tsconfig.json', {
    cwd: appDir,
    stdio: 'pipe',
  });
}

async function expectEffectRoute(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/hello`);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    message: 'Hello from effect-only runtime',
  });
}

async function expectLambdaRouteBlocked(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/`);
  expect(response.status).toBe(404);
  const body = await response.text();
  expect(body).not.toContain('Hello from lambda-only effect runtime');
}

async function expectClientSdkInBrowser(page: Page, port: number) {
  await page.goto(`${host}:${port}/`, { timeout: 50000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('.effect-message');
    return (
      el &&
      el.textContent !== null &&
      el.textContent !== 'pending' &&
      el.textContent.trim() !== ''
    );
  });
  const message = await page.$eval('.effect-message', el => el?.textContent);
  expect(message).toBe('Hello from effect-only runtime');
}

describe('bff effect lambda-only tests', () => {
  describe('in dev', () => {
    let app: AppProcess;
    let browser: Browser;
    let page: Page;
    let port = 8080;

    beforeAll(async () => {
      setSuiteTimeout(1000 * 60 * 2);
      expectTypecheckPasses();
      port = await getPort();
      app = await launchApp(appDir, port, {});
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
    });

    test('effect route works under strict effect runtime', async () => {
      await expectEffectRoute(port);
    });

    test('api/lambda routes are not served in effect runtime', async () => {
      await expectLambdaRouteBlocked(port);
    });

    test('client import works in browser', async () => {
      await expectClientSdkInBrowser(page, port);
    });

    afterAll(async () => {
      await killApp(app);
      await page?.close();
      await browser?.close();
    });
  });

  describe('in prod', () => {
    let app: AppProcess;
    let browser: Browser;
    let page: Page;
    let port = 8080;

    beforeAll(async () => {
      setSuiteTimeout(1000 * 60 * 2);
      port = await getPort();
      await modernBuild(appDir, [], {});
      app = await modernServe(appDir, port, {});
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
    });

    test('effect route works under strict effect runtime', async () => {
      await expectEffectRoute(port);
    });

    test('api/lambda routes are not served in effect runtime', async () => {
      await expectLambdaRouteBlocked(port);
    });

    test('client import works in browser', async () => {
      await expectClientSdkInBrowser(page, port);
    });

    afterAll(async () => {
      await killApp(app);
      await page?.close();
      await browser?.close();
    });
  });
});
