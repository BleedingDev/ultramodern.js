import dns from 'node:dns';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
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

  test('dev keeps the async entry boundary out of lazy compilation', async () => {
    const appDir = path.resolve(__dirname, '..');
    const port = await getPort();
    const output: string[] = [];
    const app = await launchApp(appDir, port, {
      onStdout: (message: string) => output.push(message),
    });
    const browser = await puppeteer.launch(launchOptions as any);

    try {
      const outputBeforeLoad = output.length;
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}`, {
        waitUntil: 'networkidle0',
      });
      await expect(
        page.$eval('#root', element => element.textContent),
      ).resolves.toContain('hello');
      // A lazy `bootstrap.jsx -> import('./index')` boundary makes the first
      // page load compile the whole entry on demand.
      expect(output.slice(outputBeforeLoad).join('')).not.toMatch(
        /building \.modern-js\/[^/\s]+\/index\.jsx/,
      );
    } finally {
      await browser.close();
      await killApp(app);
    }
  });
});
