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

describe('SSR useId Hydration', () => {
  let app: any;
  let appPort: number;
  let page: Page;
  let browser: Browser;

  beforeAll(async () => {
    const appDir = join(fixtureDir, 'ssr-useid');
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

  test('SSR should generate useId with modern-js- prefix', async () => {
    await page.goto(`http://localhost:${appPort}`, {
      waitUntil: ['networkidle0'],
    });

    await expect(
      page.$eval('h1', element => element.textContent),
    ).resolves.toBe('React useId SSR Test');
    const generatedIds = await page.$$eval(
      '[data-testid^="useid-item-"]',
      elements => elements.map(element => element.id),
    );
    expect(generatedIds.length).toBeGreaterThan(0);
    expect(generatedIds.every(id => id.includes('modern-js-'))).toBe(true);
  });

  test('should not have hydration mismatch', async () => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`http://localhost:${appPort}`, {
      waitUntil: ['networkidle0'],
    });

    const hydrationError = consoleErrors.find(
      err =>
        err.includes('Hydration') ||
        err.includes('did not match') ||
        err.includes('useId'),
    );
    expect(hydrationError).toBeUndefined();
  });
});
