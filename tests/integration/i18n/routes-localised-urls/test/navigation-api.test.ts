import dns from 'node:dns';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
} from '../../../../utils/modernTestUtils';
import {
  clearI18nTestState,
  gotoWithSSRRetry,
  waitForHydration,
} from '../../test-utils';

rstest.setConfig({ testTimeout: 1000 * 60 * 2, hookTimeout: 1000 * 60 * 2 });

dns.setDefaultResultOrder('ipv4first');

const projectDir = path.resolve(__dirname, '..');
const host = 'http://localhost';
const productSlug = 'red-shoe';

describe('router-ssr-i18n-localised-urls navigation and API exclusions', () => {
  let app: Awaited<ReturnType<typeof launchApp>>;
  let browser: Browser;
  let page: Page;
  let appPort: number;

  beforeAll(async () => {
    appPort = await getPort();
    app = await launchApp(projectDir, appPort, {
      requiredWorkspacePackages: [
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
    await expectLocalizedRedirect(
      appPort,
      '/about',
      { 'Accept-Language': 'en-US,en;q=0.9' },
      '/en/about',
    );
  });

  test('redirects an unprefixed canonical path to the detected Czech URL', async () => {
    await expectLocalizedRedirect(
      appPort,
      '/about',
      { 'Accept-Language': 'cs-CZ,cs;q=0.9' },
      '/cs/o-nas',
    );
  });

  test('canonicalizes a prefixed canonical path to its localized Czech path', async () => {
    await expectLocalizedRedirect(appPort, '/cs/about', {}, '/cs/o-nas');
  });

  test('switches a hydrated product page to the localized Czech URL', async () => {
    await gotoWithSSRRetry(
      page,
      `${host}:${appPort}/en/products/${productSlug}`,
    );

    expect(page.url()).toBe(`${host}:${appPort}/en/products/${productSlug}`);
    await expectText(page, '#product-language', 'en');
    await expectText(page, '#loader-language', 'en');
    await expectText(page, '#product-slug', productSlug);
    await expectText(page, '#product-name', 'Red Shoe');
    await waitForHydration(page, '#cs-button');

    await page.click('#cs-button');

    await page.waitForFunction(
      slug =>
        window.location.pathname === `/cs/produkty/${slug}` &&
        document.querySelector('#product-language')?.textContent === 'cs' &&
        document.querySelector('#loader-language')?.textContent === 'cs',
      { timeout: 30000 },
      productSlug,
    );
    expect(page.url()).toBe(`${host}:${appPort}/cs/produkty/${productSlug}`);
    await expectText(page, '#product-slug', productSlug);
    await expectText(page, '#product-name', 'Red Shoe');
  });

  test('does not redirect the BFF API prefix through i18n middleware', async () => {
    const response = await fetch(`${host}:${appPort}/bff-api/health`, {
      redirect: 'manual',
      headers: {
        'Accept-Language': 'cs-CZ,cs;q=0.9',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pathname: '/health',
    });
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

async function expectLocalizedRedirect(
  appPort: number,
  pathname: string,
  headers: HeadersInit,
  expectedPathname: string,
) {
  const response = await fetch(`${host}:${appPort}${pathname}`, {
    redirect: 'manual',
    headers,
  });

  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(400);
  const location = response.headers.get('location');
  expect(location).toBeTruthy();
  expect(new URL(location!, `${host}:${appPort}`).pathname).toBe(
    expectedPathname,
  );
}
