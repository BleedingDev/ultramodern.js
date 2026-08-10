import { afterAll, beforeAll, describe, expect, test } from '@rstest/core';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
} from '../../../utils/modernTestUtils';

const DEFAULT_DEV_HOST = 'localhost';
const appDir = path.resolve(__dirname, '../');

describe('asset prefix', () => {
  let app: unknown;
  let appPort: number;
  const errors: string[] = [];
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    appPort = await getPort();
    app = await launchApp(appDir, appPort, {}, {});
    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
    page.on('pageerror', error => {
      errors.push((error as Error).message);
    });
  });

  afterAll(async () => {
    await killApp(app);
    await page.close();
    await browser.close();
  });

  test('should generate assetPrefix correctly when dev.assetPrefix is true', async () => {
    const expected = `http://${DEFAULT_DEV_HOST}:${appPort}`;
    await page.goto(expected, {
      waitUntil: ['networkidle0'],
    });
    const scriptUrls = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(url => url.includes('/static/js/')),
    );

    expect(scriptUrls.length).toBeGreaterThan(0);
    expect(scriptUrls.every(url => url.startsWith(expected))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('should inject window.__assetPrefix__ global variable', async () => {
    const expected = `http://${DEFAULT_DEV_HOST}:${appPort}`;
    await page.goto(expected, {
      waitUntil: ['networkidle0'],
    });

    const assetPrefix = await page.evaluate(() => {
      // @ts-expect-error test-only global from the page runtime.
      return window.__assetPrefix__;
    });

    expect(assetPrefix).toEqual(expected);
    expect(errors).toEqual([]);
  });

  test('should access the file which create by writeFile correctly', async () => {
    await page.goto(`http://${DEFAULT_DEV_HOST}:${appPort}`, {
      waitUntil: ['networkidle0'],
    });
    const url = `http://${DEFAULT_DEV_HOST}:${appPort}/static/test.js`;
    await page.addScriptTag({ url });
    const loaded = await page.evaluate(() => {
      // @ts-expect-error test-only global from the generated static asset.
      return window.__testStaticAssetLoaded;
    });

    expect(loaded).toBe(true);
    expect(errors).toEqual([]);
  });
});
