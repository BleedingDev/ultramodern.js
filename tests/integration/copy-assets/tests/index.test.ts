import { readFileSync } from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { launchOptions, modernBuild } from '../../../utils/modernTestUtils';

async function testPublicHtml() {
  const appDir = path.resolve(__dirname, '..');

  await modernBuild(appDir, undefined);

  const copiedHTML = readFileSync(
    path.join(appDir, `dist/public/demo.html`),
    'utf-8',
  );
  const browser = await puppeteer.launch(launchOptions as any);
  try {
    const page = await browser.newPage();
    await page.setContent(copiedHTML);
    expect(
      await page.evaluate(() => [
        (window as any).__assetPrefix__,
        (window as any).__assetPrefix2__,
        (window as any).__assetPrefix3__,
      ]),
    ).toEqual(['https://demo.com', 'https://demo.com', 'https://demo.com']);
  } finally {
    await browser.close();
  }
}

describe('copy assets', () => {
  test(`should copy public html and replace the assetPrefix variable in rspack`, async () => {
    await testPublicHtml();
  });
});
