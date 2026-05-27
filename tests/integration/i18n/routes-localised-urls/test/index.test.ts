import dns from 'node:dns';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
} from '../../../../utils/modernTestUtils';
import { clearI18nTestState, gotoWithSSRRetry } from '../../test-utils';

rstest.setConfig({ testTimeout: 1000 * 60 * 2, hookTimeout: 1000 * 60 * 2 });

dns.setDefaultResultOrder('ipv4first');

const projectDir = path.resolve(__dirname, '..');
const host = 'http://localhost';

describe('router-ssr-i18n-localised-urls redirects', () => {
  let app: Awaited<ReturnType<typeof launchApp>>;
  let browser: Browser;
  let page: Page;
  let appPort: number;

  beforeAll(async () => {
    appPort = await getPort();
    app = await launchApp(projectDir, appPort, {
      ensureWorkspacePackages: [
        '@modern-js/plugin-bff',
        '@modern-js/plugin-i18n',
        '@modern-js/runtime',
      ],
    });
    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
  });

  beforeEach(async () => {
    await clearI18nTestState(page);
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (app) {
      await killApp(app);
    }
  });

  test('redirects an unprefixed canonical English path to /en/about', async () => {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    const body = await gotoWithSSRRetry(page, `${host}:${appPort}/about`);

    expect(page.url()).toBe(`${host}:${appPort}/en/about`);
    expect(body).toContain('About');
    await expectText(page, '#about-heading', 'About');
    await expectText(page, '#about-language', 'en');
  });

  test('redirects an unprefixed canonical path to the detected Czech URL', async () => {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'cs-CZ,cs;q=0.9',
    });

    const body = await gotoWithSSRRetry(page, `${host}:${appPort}/about`);

    expect(page.url()).toBe(`${host}:${appPort}/cs/o-nas`);
    expect(body).toContain('O nas');
    await expectText(page, '#about-heading', 'O nas');
    await expectText(page, '#about-language', 'cs');
  });

  test('canonicalizes a prefixed canonical path to its localized Czech path', async () => {
    const body = await gotoWithSSRRetry(page, `${host}:${appPort}/cs/about`);

    expect(page.url()).toBe(`${host}:${appPort}/cs/o-nas`);
    expect(body).toContain('O nas');
    await expectText(page, '#about-heading', 'O nas');
    await expectText(page, '#about-language', 'cs');
  });
});

async function expectText(page: Page, selector: string, expected: string) {
  await page.waitForFunction(
    (targetSelector, targetText) =>
      document.querySelector(targetSelector)?.textContent?.trim() ===
      targetText,
    { timeout: 30000 },
    selector,
    expected,
  );
}
