import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
} from '../../../../utils/modernTestUtils';
import { waitForText } from '../../test-utils';

const projectDir = path.resolve(__dirname, '..');

describe('i18n-custom-i18n-wrapper', () => {
  let app: Awaited<ReturnType<typeof launchApp>>;
  let page: Page;
  let browser: Browser;
  let appPort: number;

  beforeAll(async () => {
    appPort = await getPort();
    app = await launchApp(projectDir, appPort);
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

  test('loads HTTP resources first then refresh with SDK', async () => {
    await page.goto(`http://localhost:${appPort}/en`, {
      waitUntil: ['networkidle0'],
    });

    await waitForText(page, '#sdk-text', 'Hello World from SDK');
  });

  test('language switch keeps SDK merge', async () => {
    await page.goto(`http://localhost:${appPort}/en`, {
      waitUntil: ['networkidle0'],
    });
    await waitForText(page, '#sdk-text', 'Hello World from SDK');

    await page.click('#switch-zh');
    await waitForText(page, '#sdk-text', '你好，世界（SDK）');

    await page.click('#switch-en');
    await waitForText(page, '#sdk-text', 'Hello World from SDK');
  });
});
