import { pathToFileURL } from 'node:url';
import path, { join } from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';

rstest.setConfig({ testTimeout: 1000 * 60 * 3, hookTimeout: 1000 * 60 * 3 });

const fixtureDir = path.resolve(__dirname, '../fixtures');
const appDir = join(fixtureDir, 'nested-routes');

describe('ssg', () => {
  let browser: Browser;
  let distDir: string;
  let page: Page;
  beforeAll(async () => {
    distDir = join(appDir, './dist');
    await modernBuild(appDir);
    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
  });
  afterAll(async () => {
    await page.close();
    await browser.close();
  });

  test('should nested-routes ssg access / work correctly', async () => {
    const htmlPath = path.join(distDir, 'html/index/index.html');
    await page.goto(pathToFileURL(htmlPath).href);
    await expect(
      page.$eval('#data', element => element.textContent?.trim()),
    ).resolves.toBe('Hello, Home');
  });

  test('should nested-routes ssg access /user work correctly', async () => {
    const htmlPath = path.join(distDir, 'html/index/user/index.html');
    await page.goto(pathToFileURL(htmlPath).href);
    await expect(
      page.$eval('#data', element => element.textContent?.trim()),
    ).resolves.toBe('Hello, User');
  });

  test('should nested-routes ssg access /user/1 work correctly with data loading', async () => {
    const htmlPath = path.join(distDir, 'html/index/user/1/index.html');
    await page.goto(pathToFileURL(htmlPath).href);
    await expect(
      page.$eval('#data', element => element.textContent?.trim()),
    ).resolves.toBe('User 1: John Doe');
    await expect(
      page.$eval('#params', element => element.textContent?.trim()),
    ).resolves.toBe('User ID: 1');
  });
});

describe('test ssg request', () => {
  let buildRes: { code: number };
  let app: any;
  let port: any;
  beforeAll(async () => {
    port = await getPort();

    buildRes = await modernBuild(appDir);
    app = await modernServe(appDir, port, {
      cwd: appDir,
    });
  });

  afterAll(async () => {
    await killApp(app);
  });

  test('should visit page correctly', async () => {
    const host = `http://localhost`;
    expect(buildRes.code === 0).toBe(true);
    const browser = await puppeteer.launch(launchOptions as any);
    const page = await browser.newPage();
    await page.goto(`${host}:${port}/user`);

    const description = await page.$('#data');
    const targetText = await page.evaluate(el => el?.textContent, description);
    try {
      expect(targetText?.trim()).toEqual('Hello, User');
    } finally {
      await page.close();
      await browser.close();
    }
  });

  test('should visit dynamic route /user/1 correctly with data loading', async () => {
    const host = `http://localhost`;
    expect(buildRes.code === 0).toBe(true);
    const browser = await puppeteer.launch(launchOptions as any);
    const page = await browser.newPage();
    await page.goto(`${host}:${port}/user/1`);

    const dataElement = await page.$('#data');
    const paramsElement = await page.$('#params');
    const dataText = await page.evaluate(el => el?.textContent, dataElement);
    const paramsText = await page.evaluate(
      el => el?.textContent,
      paramsElement,
    );

    try {
      expect(dataText?.trim()).toEqual('User 1: John Doe');
      expect(paramsText?.trim()).toEqual('User ID: 1');
    } finally {
      await page.close();
      await browser.close();
    }
  });
});
