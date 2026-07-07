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

describe('routes-tanstack-rsc', () => {
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

  test('SSR HTML contains server-rendered composite output', async () => {
    const html = await fetchHtml(`http://localhost:${appPort}/composite`);

    expect(html.res.status).toBe(200);
    expect(html.text).toContain('id="rsc-composite"');
    expect(html.text).toContain('server-rendered composite output');
  });

  test('client navigation renders the composite and client slot', async () => {
    await page.goto(`http://localhost:${appPort}/`, {
      waitUntil: ['networkidle0'],
    });
    await expectPageTextContent(page, 'plain route ready');

    await Promise.all([
      page.waitForSelector('#rsc-composite'),
      page.click('[data-testid="link-composite"]'),
    ]);

    expect(page.url()).toBe(`http://localhost:${appPort}/composite`);
    await expectPageTextContent(page, 'server-rendered composite output');
    await expectPageTextContent(page, 'client slot:slot-label-from-server');
    await expectPageTextContent(page, 'client child slot');
    expect(errors).toEqual([]);
  });
});
