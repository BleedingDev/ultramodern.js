import { execFileSync } from 'child_process';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../../utils/modernTestUtils';
import { clearI18nTestState, waitForHydration } from '../../test-utils';

const appDir = path.resolve(__dirname, '../');

function resolveTsgoBin() {
  const pkgPath = require.resolve('@typescript/native-preview/package.json');
  const pkgDir = path.dirname(pkgPath);
  const pkg = require(pkgPath) as {
    bin?:
      | string
      | {
          tsgo?: string;
        };
  };
  const binEntry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tsgo;
  return path.resolve(pkgDir, binEntry ?? 'bin/tsgo.js');
}

const tsgoBin = resolveTsgoBin();

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'manual',
  });
  const text = await res.text();
  return { res, text };
}

async function setReloadSentinel(page: Page) {
  await page.evaluate(() => {
    (window as any).__localisedUrlsNoReloadSentinel = 'kept';
  });
}

async function getReloadSentinel(page: Page) {
  return page.evaluate(() => (window as any).__localisedUrlsNoReloadSentinel);
}

describe('i18n TanStack localisedUrls', () => {
  let appPort: number;
  let app: unknown;
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];

  async function createTrackedPage() {
    const trackedPage = await browser.newPage();
    await trackedPage.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });
    trackedPage.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    trackedPage.on('pageerror', error => {
      errors.push((error as Error).message);
    });
    await clearI18nTestState(trackedPage);
    return trackedPage;
  }

  beforeAll(
    async () => {
      await modernBuild(appDir);

      appPort = await getPort();
      app = await modernServe(appDir, appPort);

      browser = await puppeteer.launch(launchOptions as any);
    },
    1000 * 60 * 5,
  );

  beforeEach(async () => {
    errors.length = 0;
    page = await createTrackedPage();
  });

  afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (app) {
      await killApp(app);
    }
  });

  test('SSR renders localized TanStack route data and bootstrap', async () => {
    const html = await fetchHtml(
      `http://localhost:${appPort}/cs/produkty/bota`,
    );

    expect(html.res.status).toBe(200);
    expect(html.text).toContain('id="$tsr-stream-barrier"');
    expect(html.text).toContain('$_TSR');
    expect(html.text).toMatch(/product:.*cs.*bota.*Produkty/s);
    expect(html.text).toMatch(/path:.*\/cs\/produkty\/bota/s);
  });

  test('generated TanStack route types include localized aliases', () => {
    try {
      execFileSync(
        process.execPath,
        [tsgoBin, '--noEmit', '-p', 'tsconfig.json'],
        { cwd: appDir, stdio: 'pipe' },
      );
    } catch (e: any) {
      const stdout = e?.stdout ? String(e.stdout) : '';
      const stderr = e?.stderr ? String(e.stderr) : '';
      throw new Error(`TypeScript typecheck failed:\n${stdout}\n${stderr}`);
    }
  });

  test('TanStack Link navigates to localized aliases without a document reload', async () => {
    await page.goto(`http://localhost:${appPort}/en/products/shoe`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '[data-testid="tanstack-cs-product"]');
    const initialProduct = await page.$eval('#product', el => el.textContent);
    expect(initialProduct).toBe('product:en:shoe:Products');
    await setReloadSentinel(page);

    await page.click('[data-testid="tanstack-cs-product"]');
    await page.waitForFunction(
      expected => window.location.pathname === expected,
      {},
      '/cs/produkty/bota',
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#product')?.textContent ===
        'product:cs:bota:Produkty',
    );
    await page.waitForFunction(
      () => document.querySelector('#current-language')?.textContent === 'cs',
    );

    expect(await getReloadSentinel(page)).toBe('kept');
    expect(errors).toEqual([]);
  });

  test('changeLanguage maps the current localized TanStack URL without reload', async () => {
    await page.goto(`http://localhost:${appPort}/en/products/shoe`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '[data-testid="switch-cs"]');
    await setReloadSentinel(page);

    await page.click('[data-testid="switch-cs"]');
    await page.waitForFunction(
      expected => window.location.pathname === expected,
      {},
      '/cs/produkty/shoe',
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#product')?.textContent ===
        'product:cs:shoe:Produkty',
    );
    await page.waitForFunction(
      () => document.querySelector('#current-language')?.textContent === 'cs',
    );

    expect(await getReloadSentinel(page)).toBe('kept');
    expect(errors).toEqual([]);
  });

  test('I18nLink emits localized hrefs and reaches the localized static route', async () => {
    await page.goto(`http://localhost:${appPort}/cs/odkaz-probe`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '[data-testid="i18n-terms"]');

    const href = await page.$eval('[data-testid="i18n-terms"]', el =>
      el.getAttribute('href'),
    );
    expect(href).toBe('/cs/obchodni-podminky');

    await page.click('[data-testid="i18n-terms"]');
    await page.waitForFunction(
      expected => window.location.pathname === expected,
      {},
      '/cs/obchodni-podminky',
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#terms')?.textContent ===
        'terms:cs:Obchodni podminky',
    );
    expect(errors).toEqual([]);
  });

  test('supports localized optional params', async () => {
    await page.goto(`http://localhost:${appPort}/cs/volitelne`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '#optional');
    const emptyOptional = await page.$eval('#optional', el => el.textContent);
    expect(emptyOptional).toBe('optional:cs:none');
    expect(errors).toEqual([]);

    await page.close();
    errors.length = 0;
    page = await createTrackedPage();

    await page.goto(`http://localhost:${appPort}/cs/volitelne/lehke`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '#optional');
    const optionalWithSlug = await page.$eval(
      '#optional',
      el => el.textContent,
    );
    expect(optionalWithSlug).toBe('optional:cs:lehke');
    expect(errors).toEqual([]);
  });

  test('does not locale-redirect the BFF API prefix', async () => {
    const response = await fetch(
      `http://localhost:${appPort}/bff-api/localised-urls/status`,
      {
        headers: {
          'Accept-Language': 'cs-CZ,cs;q=0.9',
        },
        redirect: 'manual',
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scope: 'tanstack-localised-urls',
    });
  });

  test('framework Link navigates cross-page hash targets without reload', async () => {
    await page.goto(`http://localhost:${appPort}/cs/odkaz-probe`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '[data-testid="hash-cta"]');
    await setReloadSentinel(page);

    await page.click('[data-testid="hash-cta"]');

    await page.waitForFunction(
      () =>
        window.location.pathname === '/cs' &&
        window.location.hash === '#work-with-me',
    );

    expect(await getReloadSentinel(page)).toBe('kept');

    // Verify the element is present in the DOM (hash navigation completed)
    const elementExists = await page.evaluate(
      () => document.getElementById('work-with-me') !== null,
    );
    expect(elementExists).toBe(true);
    expect(errors).toEqual([]);
  });

  test('typed Link localizes params', async () => {
    await page.goto(`http://localhost:${appPort}/cs/odkaz-probe`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '[data-testid="typed-product"]');

    const href = await page.$eval('[data-testid="typed-product"]', el =>
      el.getAttribute('href'),
    );
    expect(href).toBe('/cs/produkty/bota');
    expect(errors).toEqual([]);
  });

  test('active state is language-invariant', async () => {
    // On the en terms page the layout nav-terms link should be active
    await page.goto(`http://localhost:${appPort}/en/terms-of-service`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '[data-testid="layout-nav-terms"]');

    const enStatus = await page.$eval('[data-testid="layout-nav-terms"]', el =>
      el.getAttribute('data-status'),
    );
    const enAriaCurrent = await page.$eval(
      '[data-testid="layout-nav-terms"]',
      el => el.getAttribute('aria-current'),
    );
    expect(enStatus).toBe('active');
    expect(enAriaCurrent).toBe('page');

    // On the cs localised terms page (obchodni-podminky) it should also be active
    await page.close();
    errors.length = 0;
    page = await createTrackedPage();

    await page.goto(`http://localhost:${appPort}/cs/obchodni-podminky`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '[data-testid="layout-nav-terms"]');

    const csStatus = await page.$eval('[data-testid="layout-nav-terms"]', el =>
      el.getAttribute('data-status'),
    );
    const csAriaCurrent = await page.$eval(
      '[data-testid="layout-nav-terms"]',
      el => el.getAttribute('aria-current'),
    );
    expect(csStatus).toBe('active');
    expect(csAriaCurrent).toBe('page');

    // On a different page it should NOT be active
    await page.close();
    errors.length = 0;
    page = await createTrackedPage();

    await page.goto(`http://localhost:${appPort}/cs/odkaz-probe`, {
      waitUntil: ['networkidle0'],
    });
    await waitForHydration(page, '[data-testid="layout-nav-terms"]');

    const probeStatus = await page.$eval(
      '[data-testid="layout-nav-terms"]',
      el => el.getAttribute('data-status'),
    );
    expect(probeStatus).toBeNull();
    expect(errors).toEqual([]);
  });
});
