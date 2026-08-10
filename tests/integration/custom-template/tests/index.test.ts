import { readFileSync } from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { launchOptions, modernBuild } from '../../../utils/modernTestUtils';

describe('custom template', () => {
  test(`should allow to custom template by html.template option`, async () => {
    const appDir = path.resolve(__dirname, '..');

    await modernBuild(appDir);

    const browser = await puppeteer.launch(launchOptions as any);
    try {
      const page = await browser.newPage();
      await page.setContent(
        readFileSync(
          path.resolve(appDir, `dist/html/index/index.html`),
          'utf8',
        ),
      );

      expect(await page.title()).toBe('Hello World');
      expect(await page.$eval('#root', root => root.childElementCount)).toBe(0);
      expect(
        await page.$eval('meta[name="viewport"]', meta =>
          meta.getAttribute('content'),
        ),
      ).toContain('viewport-fit=cover');
      expect(
        await page.$eval('script[src]', script => script.getAttribute('src')),
      ).toBe('/static/js/index.js');
    } finally {
      await browser.close();
    }
  });
});
