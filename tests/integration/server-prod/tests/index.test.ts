import axios from 'axios';
import fs from 'fs';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';

const appPath = path.resolve(__dirname, '../');
const successStatus = 200;
let app: any;
let appPort: number;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  await modernBuild(appPath);
  appPort = await getPort();
  app = await modernServe(appPath, appPort);
  browser = await puppeteer.launch(launchOptions as any);
  page = await browser.newPage();
});

afterAll(async () => {
  await page?.close();
  await browser?.close();
  if (app) {
    await killApp(app);
  }
});

describe('test basic usage', () => {
  test(`should have favicon and app icon in dist and html`, async () => {
    const favicon = path.resolve(appPath, './dist/favicon.ico');
    const favicon1 = path.resolve(appPath, './dist/favicon1.ico');
    const appIcon = path.resolve(appPath, './dist/static/image/icon.png');
    expect(fs.existsSync(favicon)).toBe(true);
    expect(fs.existsSync(favicon1)).toBe(true);
    expect(fs.existsSync(appIcon)).toBe(true);

    for (const route of ['/', '/activity']) {
      await page.goto(`http://localhost:${appPort}${route}`);
      await expect(
        page.$eval('link[rel="icon"]', element => element.getAttribute('href')),
      ).resolves.toBe('/favicon.ico');
      await expect(
        page.$eval('link[rel="apple-touch-icon"]', element => ({
          href: element.getAttribute('href'),
          sizes: element.getAttribute('sizes'),
        })),
      ).resolves.toEqual({
        href: '/static/image/icon.png',
        sizes: '180x180',
      });
    }
  });

  test(`should start successfully`, async () => {
    expect(app.pid).toBeDefined();

    const { status } = await axios.get(`http://localhost:${appPort}`);
    expect(status).toBe(successStatus);

    const { status: aStatus } = await axios.get(
      `http://localhost:${appPort}/activity`,
    );
    expect(aStatus).toBe(successStatus);
  });

  test(`should serve favicon and app icon`, async () => {
    const { status } = await axios.get(
      `http://localhost:${appPort}/favicon1.ico`,
    );
    expect(status).toBe(successStatus);
    // ignore
    // expect(headers['content-type']).toMatch(/image/);

    const { status: aStatus, headers: aHeaders } = await axios.get(
      `http://localhost:${appPort}/favicon.ico`,
    );
    expect(aStatus).toBe(successStatus);
    expect(aHeaders['content-type']).toBe('image/x-icon');
  });

  test(`should serve app icon`, async () => {
    const { status, headers } = await axios.get(
      `http://localhost:${appPort}/static/image/icon.png`,
    );
    expect(status).toBe(successStatus);
    expect(headers['content-type']).toBe('image/png');
  });

  test(`should serve static file with special characters in filename`, async () => {
    const { status, data } = await axios.get(
      `http://localhost:${appPort}/test(bug.txt`,
    );
    expect(status).toBe(successStatus);
    expect(data.trim()).toBe('test');
  });
});
