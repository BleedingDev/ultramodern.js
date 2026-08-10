import dns from 'node:dns';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';

dns.setDefaultResultOrder('ipv4first');

describe('generate async entry', () => {
  test('loads the application through the generated async browser boundary', async () => {
    const appDir = path.resolve(__dirname, '..');
    const port = await getPort();
    await modernBuild(appDir);
    const app = await modernServe(appDir, port);
    const browser = await puppeteer.launch(launchOptions as any);

    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}`, {
        waitUntil: 'networkidle0',
      });
      await expect(
        page.$eval('#root', element => element.textContent),
      ).resolves.toContain('hello');
    } finally {
      await browser.close();
      await killApp(app);
    }
  });
});
