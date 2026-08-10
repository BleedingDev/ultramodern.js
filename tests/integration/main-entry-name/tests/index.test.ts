import fs from 'fs';
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

const appDir = path.resolve(__dirname, '../');

function existsSync(filePath: string) {
  return fs.existsSync(path.join(appDir, 'dist', filePath));
}

describe('test dev', () => {
  test(`should render page correctly`, async () => {
    const appPort = await getPort();
    const app = await launchApp(appDir, appPort, {}, {});
    const errors = [];
    const browser = await puppeteer.launch(launchOptions as any);
    const page = await browser.newPage();
    page.on('pageerror', error => {
      errors.push((error as Error).message);
    });
    await page.goto(`http://localhost:${appPort}`, {
      waitUntil: ['networkidle0'],
    });

    const root = await page.$('.description');
    const targetText = await page.evaluate(el => el?.textContent, root);
    expect(targetText?.trim()).toEqual('Get started by editing src/App.tsx');
    expect(errors.length).toEqual(0);

    await killApp(app);
    await page.close();
    await browser.close();
  });
});

describe('test build', () => {
  let buildRes: { code: number };
  let app: unknown;
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    buildRes = await modernBuild(appDir);
    const appPort = await getPort();
    app = await modernServe(appDir, appPort);
    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
    await page.goto(`http://localhost:${appPort}`, {
      waitUntil: ['networkidle0'],
    });
  });

  afterAll(async () => {
    await killApp(app);
    await page.close();
    await browser.close();
  });

  test(`should get right entry name build!`, async () => {
    expect(buildRes.code === 0).toBe(true);
    expect(existsSync('route.json')).toBe(true);
    expect(existsSync('html/index/index.html')).toBe(true);
    expect(await page.title()).toBe('TikTok');
  });
});
