import dns from 'node:dns';
import path, { join } from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
} from '../../../utils/modernTestUtils';

dns.setDefaultResultOrder('ipv4first');
const fixtureDir = path.resolve(__dirname, '../fixtures');

describe('test partial ssr', () => {
  let app: any;
  let appPort: number;
  let page: Page;
  let ssrPage: Page;
  let browser: Browser;

  beforeAll(async () => {
    const appDir = join(fixtureDir, 'partial');
    appPort = await getPort();
    app = await launchApp(appDir, appPort);

    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
    ssrPage = await browser.newPage();
    await ssrPage.setJavaScriptEnabled(false);
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (app) {
      await killApp(app);
    }
  });

  test('should render / with CSR', async () => {
    await ssrPage.goto(`http://localhost:${appPort}/one`);
    expect(await ssrPage.$('#root_layout')).toBeNull();

    await page.goto(`http://localhost:${appPort}/one`);
    await page.waitForSelector('#root_layout');
    await expect(
      page.$eval('#root_layout', element => element.textContent),
    ).resolves.toContain('root layout');
  });

  test('should render /a with CSR', async () => {
    await ssrPage.goto(`http://localhost:${appPort}/one/a`);
    expect(await ssrPage.$('#root_layout')).toBeNull();

    await page.goto(`http://localhost:${appPort}/one/a`);
    await page.waitForSelector('#root_layout');
    await page.waitForSelector('.page-a');
    await expect(
      page.$eval('#root_layout', element => element.textContent),
    ).resolves.toContain('root layout');
    await expect(
      page.$eval('.page-a', element => element.textContent),
    ).resolves.toContain('PageA Data');
  });

  test('should render /b with SSR', async () => {
    await ssrPage.goto(`http://localhost:${appPort}/one/b`);
    await expect(
      ssrPage.$eval('#root_layout', element => element.textContent),
    ).resolves.toContain('root layout');

    await page.goto(`http://localhost:${appPort}/one/b`);
    await page.waitForSelector('#root_layout');
    await page.waitForSelector('.page-b');

    await expect(
      page.$eval('.page-b', element => element.textContent),
    ).resolves.toContain('PageB Data');
  });

  // This test case ensures that the data loader for b is executed on the server side
  test('should navigate to /b correctly', async () => {
    await page.goto(`http://localhost:${appPort}/one/a`, {
      waitUntil: ['networkidle0'],
    });
    await Promise.all([page.click('.b-btn'), page.waitForSelector('.page-b')]);
    const pageBElm = await page.$('.page-b');
    const text = await page.evaluate(el => el?.textContent, pageBElm);
    expect(text).toContain('PageB Data');
  });

  test('should render nested route with CSR', async () => {
    await ssrPage.goto(`http://localhost:${appPort}/one/b/d`);
    expect(await ssrPage.$('#root_layout')).toBeNull();

    await page.goto(`http://localhost:${appPort}/one/b/d`);
    await page.waitForSelector('#root_layout');
    await page.waitForSelector('.page-d');

    await expect(
      page.$eval('#root_layout', element => element.textContent),
    ).resolves.toContain('root layout');
    await expect(
      page.$eval('.page-d', element => element.textContent),
    ).resolves.toContain('PageD Data');
  });
});
