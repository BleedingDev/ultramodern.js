import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

setSuiteTimeout(1000 * 60 * 5);

const appDir = path.resolve(__dirname, '../');

// The repo's rstest harness has no expect-puppeteer, so assert page text
// through puppeteer directly (waitForFunction keeps streamed SSR stable).
async function expectPageTextContent(target: Page, expected: string) {
  await target.waitForFunction(
    text => (document.body?.textContent || '').includes(text as string),
    { timeout: 10_000 },
    expected,
  );
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html',
    },
  });
  const text = await res.text();
  return { res, text };
}

describe('routes-tanstack', () => {
  let appPort: number;
  let app: unknown;
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];

  beforeAll(async () => {
    await modernBuild(appDir);

    appPort = await getPort();
    app = await modernServe(appDir, appPort);

    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', error => {
      errors.push((error as Error).message);
    });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (app) {
      await killApp(app);
    }
  });

  test('injects TanStack SSR bootstrap (string + stream)', async () => {
    const stringHtml = await fetchHtml(`http://localhost:${appPort}/string`);
    expect(stringHtml.res.status).toBe(200);
    expect(stringHtml.text).toContain('id="$tsr-stream-barrier"');
    expect(stringHtml.text).toContain('$_TSR');

    const streamHtml = await fetchHtml(`http://localhost:${appPort}/stream`);
    expect(streamHtml.res.status).toBe(200);
    expect(streamHtml.text).toContain('id="$tsr-stream-barrier"');
    expect(streamHtml.text).toContain('$_TSR');
  });

  test('emits the TanStack SSR bootstrap before the entry script (string + stream)', async () => {
    for (const route of ['string', 'stream'] as const) {
      const { text } = await fetchHtml(`http://localhost:${appPort}/${route}`);
      const bootstrapIndex = text.indexOf('$_TSR');
      const entryIndex = text.search(
        new RegExp(`<script[^>]*src="/static/js/${route}\\.[a-f0-9]+\\.js"`),
      );
      expect(bootstrapIndex).toBeGreaterThan(-1);
      expect(entryIndex).toBeGreaterThan(-1);
      // the TanStack bootstrap must execute before the Modern.js entry bundle
      expect(entryIndex).toBeGreaterThan(bootstrapIndex);
    }
  });

  test('SSR renders loader data (string + stream)', async () => {
    await page.goto(`http://localhost:${appPort}/string`, {
      waitUntil: ['networkidle0'],
    });
    await expectPageTextContent(page, 'string-layout');
    await expectPageTextContent(page, 'string-index:index');

    await page.goto(`http://localhost:${appPort}/stream`, {
      waitUntil: ['networkidle0'],
    });
    await expectPageTextContent(page, 'stream-layout');
    await expectPageTextContent(page, 'stream-index:index');
    expect(errors).toEqual([]);
  });

  test('navigates and loads data on the client (string entry)', async () => {
    await page.goto(`http://localhost:${appPort}/string`, {
      waitUntil: ['networkidle0'],
    });
    await page.waitForSelector('[data-testid="link-user"]');
    await Promise.all([
      page.click('[data-testid="link-user"]'),
      page.waitForSelector('#user'),
    ]);
    const userText = await page.$eval('#user', el => el.textContent);
    expect(userText).toBe('string-user:123');
    expect(errors).toEqual([]);
  });

  test('supports link prefetch alias (intent)', async () => {
    const prefetchPage = await browser.newPage();
    const prefetchErrors: string[] = [];
    await prefetchPage.setCacheEnabled(false);
    prefetchPage.on('console', msg => {
      if (msg.type() === 'error') {
        prefetchErrors.push(msg.text());
      }
    });
    prefetchPage.on('pageerror', error => {
      prefetchErrors.push((error as Error).message);
    });

    let requestedUserChunk = false;
    const onRequest = (request: any) => {
      if (/string_user\/\(id\)\/page\.[^.]+\.js/.test(request.url())) {
        requestedUserChunk = true;
      }
    };
    prefetchPage.on('request', onRequest);

    try {
      await prefetchPage.goto(`http://localhost:${appPort}/string`, {
        waitUntil: ['networkidle0'],
      });
      await prefetchPage.waitForSelector('[data-testid="link-user"]');
      await prefetchPage.hover('[data-testid="link-user"]');
      await new Promise(resolve => setTimeout(resolve, 700));

      expect(requestedUserChunk).toBe(true);
      expect(prefetchErrors).toEqual([]);
    } finally {
      prefetchPage.off('request', onRequest);
      await prefetchPage.close();
    }
  });

  test('supports optional params (string + stream)', async () => {
    await page.goto(`http://localhost:${appPort}/string/optional`, {
      waitUntil: ['networkidle0'],
    });
    await expectPageTextContent(page, 'string-optional:none');

    await page.goto(`http://localhost:${appPort}/string/optional/456`, {
      waitUntil: ['networkidle0'],
    });
    await expectPageTextContent(page, 'string-optional:456');

    await page.goto(`http://localhost:${appPort}/stream/optional`, {
      waitUntil: ['networkidle0'],
    });
    await expectPageTextContent(page, 'stream-optional:none');

    await page.goto(`http://localhost:${appPort}/stream/optional/456`, {
      waitUntil: ['networkidle0'],
    });
    await expectPageTextContent(page, 'stream-optional:456');

    expect(errors).toEqual([]);
  });

  test('supports redirects (stream entry)', async () => {
    const res = await fetch(`http://localhost:${appPort}/stream/redirect`, {
      redirect: 'manual',
    });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get('location');
    expect(location).toBe('/stream/user/123');

    await page.goto(`http://localhost:${appPort}/stream/redirect`, {
      waitUntil: ['networkidle0'],
    });
    expect(page.url()).toBe(`http://localhost:${appPort}/stream/user/123`);
    await expectPageTextContent(page, 'stream-user:123');
    expect(errors).toEqual([]);
  });

  test('supports Form action and fetcher submit (string entry)', async () => {
    await page.goto(`http://localhost:${appPort}/string/mutation`, {
      waitUntil: ['networkidle0'],
    });
    await page.waitForSelector('#mutation-count');

    const getCount = async () => {
      const text = await page.$eval(
        '#mutation-count',
        el => el.textContent || '',
      );
      return Number(text.replace('string-mutation:', ''));
    };

    const initialCount = await getCount();

    await page.click('[data-testid="mutation-form-submit"]');
    await page.waitForFunction(
      expected =>
        document.querySelector('#mutation-count')?.textContent ===
        `string-mutation:${expected}`,
      {},
      initialCount + 2,
    );

    await page.click('[data-testid="mutation-fetcher-submit"]');
    await page.waitForFunction(
      expected =>
        document.querySelector('#mutation-count')?.textContent ===
        `string-mutation:${expected}`,
      {},
      initialCount + 5,
    );

    await page.click('[data-testid="mutation-fetcher-form-submit"]');
    await page.waitForFunction(
      expected =>
        document.querySelector('#mutation-count')?.textContent ===
        `string-mutation:${expected}`,
      {},
      initialCount + 9,
    );

    await page.click('[data-testid="mutation-fetcher-load"]');
    await page.waitForFunction(
      expected =>
        document.querySelector('#mutation-loader-fetcher-data')?.textContent ===
        `string-mutation-loader:${expected}`,
      {},
      initialCount + 9,
    );
    expect(page.url()).toBe(`http://localhost:${appPort}/string/mutation`);

    const fetcherState = await page.$eval(
      '#mutation-fetcher-state',
      el => el.textContent,
    );
    expect(fetcherState).toBe('idle');
    expect(errors).toEqual([]);
  });

  test('supports navigation blockers (string entry)', async () => {
    await page.goto(`http://localhost:${appPort}/string/blocker`, {
      waitUntil: ['networkidle0'],
    });
    await page.waitForSelector('[data-testid="blocker-leave-link"]');

    await page.click('[data-testid="blocker-leave-link"]');
    await page.waitForSelector('[data-testid="blocker-controls"]');
    expect(page.url()).toBe(`http://localhost:${appPort}/string/blocker`);

    await page.click('[data-testid="blocker-stay"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="blocker-controls"]'),
    );
    expect(page.url()).toBe(`http://localhost:${appPort}/string/blocker`);

    await page.click('[data-testid="blocker-leave-link"]');
    await page.waitForSelector('[data-testid="blocker-controls"]');
    await page.click('[data-testid="blocker-proceed"]');
    await page.waitForFunction(
      expected => window.location.pathname === expected,
      {},
      '/string',
    );
    expect(errors).toEqual([]);
  });

  test('returns 404 for unknown routes', async () => {
    const res = await fetch(`http://localhost:${appPort}/string/unknown`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain('404');
  });
});
