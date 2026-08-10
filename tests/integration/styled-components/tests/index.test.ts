import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
} from '../../../utils/modernTestUtils';
import { expectPageToMatchTextContent } from '../../../utils/rstestPuppeteer';

const fixtureStreamDir = path.resolve(__dirname, '../fixtures/stream');
const fixtureStringDir = path.resolve(__dirname, '../fixtures/string');

async function expectStyledComponentBehavior(page: Page) {
  const rendered = await page.evaluate(() => {
    const element = [...document.querySelectorAll('div')].find(
      candidate =>
        candidate.textContent?.trim() === 'styled-components is working',
    );

    return element
      ? {
          color: getComputedStyle(element).color,
          text: element.textContent?.trim(),
        }
      : null;
  });

  expect(rendered).toEqual({
    color: 'rgb(255, 0, 0)',
    text: 'styled-components is working',
  });
}

describe('Styled Components with Streaming SSR', () => {
  let app: any;
  let appPort: number;
  let page: Page;
  let browser: Browser;

  beforeAll(async () => {
    appPort = await getPort();
    app = await launchApp(fixtureStreamDir, appPort, {});

    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();

    await page.goto(`http://localhost:${appPort}`, {
      waitUntil: ['domcontentloaded'],
      timeout: 60000,
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

  test('should render page content correctly', async () => {
    await expectPageToMatchTextContent(page, 'Hello, world!');
    await expectPageToMatchTextContent(page, 'styled-components is working');
  });

  test('should have correct mode and renderLevel in SSR_DATA', async () => {
    const ssrData = await page.evaluate(() => window._SSR_DATA);
    expect(ssrData.mode).toBe('stream');
    expect(ssrData.renderLevel).toBe(2);
  });

  test('should inject style tags', async () => {
    const styleTags = await page.$$('style');
    expect(styleTags.length).toBeGreaterThan(0);
  });

  test('should apply correct styles to components in initial HTML', async () => {
    await expectStyledComponentBehavior(page);
  });
});

describe('Styled Components with string SSR', () => {
  let app: any;
  let appPort: number;
  let page: Page;
  let browser: Browser;

  beforeAll(async () => {
    appPort = await getPort();
    app = await launchApp(fixtureStringDir, appPort, {});

    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
    await page.goto(`http://localhost:${appPort}`, {
      waitUntil: ['networkidle0', 'load'],
      timeout: 60000,
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

  test('should render page content correctly', async () => {
    await expectPageToMatchTextContent(page, 'Hello, world!');
    await expectPageToMatchTextContent(page, 'styled-components is working');
  });

  test('should have correct mode and renderLevel in SSR_DATA', async () => {
    const ssrData = await page.evaluate(() => window._SSR_DATA);
    expect(ssrData.mode).toBe('string');
    expect(ssrData.renderLevel).toBe(2);
  });

  test('should inject style tags', async () => {
    const styleTags = await page.$$('style');
    expect(styleTags.length).toBeGreaterThan(0);
  });

  test('should apply correct styles to components in initial HTML', async () => {
    await expectStyledComponentBehavior(page);
  });
});
