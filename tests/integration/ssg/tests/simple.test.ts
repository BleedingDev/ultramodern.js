import { pathToFileURL } from 'node:url';
import path, { join } from 'path';
import puppeteer from 'puppeteer';
import { launchOptions, modernBuild } from '../../../utils/modernTestUtils';

rstest.setConfig({ testTimeout: 1000 * 60 * 2, hookTimeout: 1000 * 60 * 2 });

const fixtureDir = path.resolve(__dirname, '../fixtures');

describe('ssg', () => {
  test('should simple ssg work correctly', async () => {
    const appDir = join(fixtureDir, 'simple');
    await modernBuild(appDir);

    const htmlPath = path.join(appDir, './dist/html/index/index.html');
    const browser = await puppeteer.launch(launchOptions as any);
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href);
    await expect(
      page.$eval('#data', element => element.textContent?.trim()),
    ).resolves.toBe('Hello, Modern.js');
    await browser.close();
  });
});
