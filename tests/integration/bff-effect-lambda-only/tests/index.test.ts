import { execFileSync } from 'node:child_process';
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

dns.setDefaultResultOrder('ipv4first');

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const browserLaunchOptions = launchOptions as Parameters<
  typeof puppeteer.launch
>[0];

type AppProcess = Awaited<ReturnType<typeof launchApp>>;

function expectTypecheckPasses() {
  execFileSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'], {
    cwd: appDir,
    stdio: 'pipe',
  });
}

async function expectLambdaRoute(port: number) {
  const response = await fetch(`${host}:${port}/bff-api`);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    message: 'Hello from lambda-only effect runtime',
  });
}

async function expectClientSdkInBrowser(page: Page, port: number) {
  await page.goto(`${host}:${port}/`, { timeout: 50000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('.lambda-message');
    return (
      el &&
      el.textContent !== null &&
      el.textContent !== 'pending' &&
      el.textContent.trim() !== ''
    );
  });
  const message = await page.$eval('.lambda-message', el => el?.textContent);
  expect(message).toBe('Hello from lambda-only effect runtime');
}

describe('bff effect lambda-only tests', () => {
  describe('in dev', () => {
    let app: AppProcess;
    let browser: Browser;
    let page: Page;
    let port = 8080;

    beforeAll(async () => {
      jest.setTimeout(1000 * 60 * 2);
      expectTypecheckPasses();
      port = await getPort();
      app = await launchApp(appDir, port, {});
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
    });

    test('lambda route works under effect runtime', async () => {
      await expectLambdaRoute(port);
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
      jest.setTimeout(1000 * 60 * 2);
      port = await getPort();
      await modernBuild(appDir, [], {});
      app = await modernServe(appDir, port, {});
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
    });

    test('lambda route works under effect runtime', async () => {
      await expectLambdaRoute(port);
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
