import path, { join } from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
} from '../../../utils/modernTestUtils';

rstest.setConfig({ testTimeout: 1000 * 20, hookTimeout: 1000 * 20 });

const fixtureDir = path.resolve(__dirname, '../fixtures');

describe('init with SSR', () => {
  let app: any;
  let appPort: number;
  let page: Page;
  let browser: Browser;

  beforeAll(async () => {
    const appDir = join(fixtureDir, 'scriptLoading');
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

  test(`use ssr init data`, async () => {
    await page.goto(`http://localhost:${appPort}`, {
      waitUntil: ['networkidle0'],
    });
    const runtime = await page.evaluate(() => ({
      hasRouteManifest:
        typeof (window as any)._MODERNJS_ROUTE_MANIFEST !== 'undefined',
      scripts: Array.from(document.scripts, script => script.src),
    }));

    expect(runtime.hasRouteManifest).toBe(true);
    expect(runtime.scripts).toContain(
      `http://localhost:${appPort}/static/js/builder-runtime.js`,
    );
  });
});
