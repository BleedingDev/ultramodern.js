import dns from 'node:dns';
import { fs as fse } from '@modern-js/utils';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
  modernBuild,
  modernServe,
  sleep,
} from '../../../utils/modernTestUtils';

rstest.setConfig({ testTimeout: 1000 * 60 * 5, hookTimeout: 1000 * 60 * 5 });

const sourceAppDir = path.resolve(__dirname, '../');
const ensureWorkspacePackages = [
  '@modern-js/app-tools',
  '@modern-js/plugin-bff',
  '@modern-js/server-utils',
];
const buildDoneMarker = /(?:^|\n)File \((?:client|server)\)\s+/i;
dns.setDefaultResultOrder('ipv4first');

async function createIsolatedAppDir(prefix: string) {
  const appDir = await fse.mkdtemp(
    path.join(path.dirname(sourceAppDir), prefix),
  );

  await fse.copy(sourceAppDir, appDir, {
    filter: src => {
      const relative = path.relative(sourceAppDir, src);
      if (!relative) {
        return true;
      }
      const [firstSegment] = relative.split(path.sep);
      return ![
        'node_modules',
        'dist',
        'dist-deploy',
        '.output',
        'tests',
      ].includes(firstSegment);
    },
  });
  await fse.ensureSymlink(
    path.join(sourceAppDir, 'node_modules'),
    path.join(appDir, 'node_modules'),
    'dir',
  );

  return appDir;
}

async function waitForApiInfoReady(
  host: string,
  port: number,
  timeout = 15_000,
) {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${host}:${port}/api/info`);
      const text = await response.text();
      const data = JSON.parse(text);

      if (response.ok && data?.url === '/api/info') {
        return;
      }

      lastError = new Error(`Unexpected /api/info response: ${text}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  throw lastError ?? new Error('Timed out waiting for /api/info');
}

async function expectApiInfo(host: string, port: number) {
  const res = await fetch(`${host}:${port}/api/info`);
  const data = await res.json();

  expect(data).toEqual({
    company: 'bytedance',
    addRes: 3,
    url: '/api/info',
    user: 'modern.js',
  });
}

async function gotoAndWaitForSelector(
  page: Page,
  url: string,
  selector: string,
) {
  return retryPageAction(async () => {
    await page.goto(url, {
      waitUntil: ['domcontentloaded'],
    });
    await page.waitForSelector(selector, { timeout: 10_000 });
  });
}

async function retryPageAction<T>(action: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }

  throw lastError;
}

async function navigateHomeAndReadData(page: Page, userUrl: string) {
  return retryPageAction(async () => {
    await page.goto(userUrl, {
      waitUntil: ['domcontentloaded'],
    });
    await page.waitForSelector('#home-btn', { timeout: 10_000 });
    await page.click('#home-btn');
    await page.waitForSelector('#data', { timeout: 10_000 });
    return page.$eval('#data', el => el?.textContent);
  });
}

describe('pure-esm-project in dev', () => {
  let port = 8080;
  const host = `http://localhost`;
  let app: any;
  let page: Page;
  let browser: Browser;
  let appDir: string;

  beforeAll(async () => {
    appDir = await createIsolatedAppDir('.pure-esm-index-');
    port = await getPort();
    app = await launchApp(appDir, port, {
      ensureWorkspacePackages,
    });
    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
    await waitForApiInfoReady(host, port);
  });

  test('stream ssr with bff handle web', async () => {
    await gotoAndWaitForSelector(
      page,
      `${host}:${port}?name=bytedance`,
      '#data',
    );
    const text = await page.$eval('#data', el => el?.textContent);
    expect(text).toMatch('name: bytedance, age: 18');
  });

  test('stream ssr with bff handle web, client nav', async () => {
    const text = await navigateHomeAndReadData(page, `${host}:${port}/user`);
    expect(text).toMatch('name: modernjs, age: 18');
  });

  test('api service should serve normally', async () => {
    await expectApiInfo(host, port);
  });

  afterAll(async () => {
    await killApp(app);
    await page.close();
    await browser.close();
    await fse.remove(appDir);
  });
});

describe('pure-esm-project in prod', () => {
  let port = 8080;
  const host = `http://localhost`;
  let app: any;
  let page: Page;
  let browser: Browser;
  let appDir: string;

  beforeAll(async () => {
    appDir = await createIsolatedAppDir('.pure-esm-index-');
    port = await getPort();

    await modernBuild(appDir, [], {
      stdout: false,
      stderr: false,
      marker: buildDoneMarker,
      ensureWorkspacePackages,
    });

    app = await modernServe(appDir, port, {});
    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
    await waitForApiInfoReady(host, port);
  });

  test('stream ssr with bff handle web', async () => {
    await gotoAndWaitForSelector(
      page,
      `${host}:${port}?name=bytedance`,
      '#data',
    );
    const text = await page.$eval('#data', el => el?.textContent);
    expect(text).toMatch('name: bytedance, age: 18');
  });

  test('stream ssr with bff handle web, client nav', async () => {
    const text = await navigateHomeAndReadData(page, `${host}:${port}/user`);
    expect(text).toMatch('name: modernjs, age: 18');
  });

  test('api service should serve normally', async () => {
    await expectApiInfo(host, port);
  });

  afterAll(async () => {
    await killApp(app);
    await page.close();
    await browser.close();
    await fse.remove(appDir);
  });
});
