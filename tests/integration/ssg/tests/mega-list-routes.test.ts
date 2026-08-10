import { pathToFileURL } from 'node:url';
import path, { join } from 'path';
import puppeteer from 'puppeteer';
import { launchOptions, modernBuild } from '../../../utils/modernTestUtils';

rstest.setConfig({ testTimeout: 1000 * 60 * 2, hookTimeout: 1000 * 60 * 2 });

const fixtureDir = path.resolve(__dirname, '../fixtures');

it('should render static mega list routes', async () => {
  const appDir = join(fixtureDir, 'mega-list-routes');
  await modernBuild(appDir);

  const browser = await puppeteer.launch(launchOptions as any);
  const page = await browser.newPage();
  const ids = [0, 100, 9999];
  for (const id of ids) {
    const htmlPath = path.join(appDir, `dist/html/index/user/${id}/index.html`);
    await page.goto(pathToFileURL(htmlPath).href);
    await expect(
      page.$eval('#data', element => element.textContent),
    ).resolves.toBe(`/user/${id}`);
  }
  await browser.close();
});
