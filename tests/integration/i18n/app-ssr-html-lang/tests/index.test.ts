import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
} from '../../../../utils/modernTestUtils';

const projectDir = path.resolve(__dirname, '..');

describe('app-ssr-html-lang', () => {
  let app: unknown;
  let page: Page;
  let browser: Browser;
  let appPort: number;

  beforeAll(async () => {
    const appDir = projectDir;
    appPort = await getPort();
    app = await launchApp(appDir, appPort);

    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (app) {
      await killApp(app);
    }
  });

  test('should render html lang attribute in SSR and update on navigation', async () => {
    // Check SSR response for 'en'
    await page.goto(`http://localhost:${appPort}/en`);
    // Verify initial HTML contains correct lang attribute
    const langEn = await page.evaluate(() =>
      document.documentElement.getAttribute('lang'),
    );
    expect(langEn).toBe('en');

    // Check SSR response for 'zh'
    await page.goto(`http://localhost:${appPort}/zh`);
    const langZh = await page.evaluate(() =>
      document.documentElement.getAttribute('lang'),
    );
    expect(langZh).toBe('zh');

    const noJsPage = await browser.newPage();
    await noJsPage.setJavaScriptEnabled(false);
    const response = await noJsPage.goto(`http://localhost:${appPort}/zh`);
    expect(response?.status()).toBe(200);
    await expect(
      noJsPage.evaluate(() => document.documentElement.lang),
    ).resolves.toBe('zh');
    await noJsPage.close();
  });
});
