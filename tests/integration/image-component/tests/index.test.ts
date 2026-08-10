import { isVersionAtLeast18 } from '@modern-js/utils';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';

const appDir = path.resolve(__dirname, '../');

function resolveDist(name: string) {
  return path.join(appDir, 'dist', name);
}

function existsSync(filePath: string) {
  return fs.existsSync(resolveDist(filePath));
}

describe('build', () => {
  test(`should build success`, async () => {
    if (!isVersionAtLeast18()) return;
    const buildRes = await modernBuild(appDir);
    expect(buildRes.code === 0).toBe(true);
    expect(existsSync('route.json')).toBe(true);
    expect(existsSync('html/index/index.html')).toBe(true);
  });

  it('should get image url with production CDN', async () => {
    if (!isVersionAtLeast18()) return;
    const appPort = await getPort();
    const app = await modernServe(appDir, appPort);
    const errors: string[] = [];

    const browser = await puppeteer.launch(launchOptions as any);
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push((error as Error).message));
    await page.goto(`http://localhost:${appPort}`, {
      waitUntil: ['networkidle0'],
    });

    const image = await page.$eval('#root img', element => ({
      complete: (element as HTMLImageElement).complete,
      height: (element as HTMLImageElement).height,
      src: element.getAttribute('src'),
      srcset: element.getAttribute('srcset'),
      width: (element as HTMLImageElement).width,
    }));
    expect(image).toEqual({
      complete: true,
      height: 334,
      src: '/static/assets/crab.png?w=1000&q=75',
      srcset:
        '/static/assets/crab.png?w=500&q=75 1x,/static/assets/crab.png?w=1000&q=75 2x',
      width: 500,
    });
    expect(errors.length).toEqual(0);

    await browser.close();
    await killApp(app);
  });
});

describe('dev', () => {
  test(`should render page correctly`, async () => {
    if (!isVersionAtLeast18()) return;
    const appPort = await getPort();
    const app = await launchApp(
      appDir,
      appPort,
      {},
      {
        // FIXME: disable the fast refresh plugin to avoid the `require` not found issue.
        FAST_REFRESH: 'false',
      },
    );
    const errors: string[] = [];

    const browser = await puppeteer.launch(launchOptions as any);
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push((error as Error).message));
    await page.goto(`http://localhost:${appPort}`, {
      waitUntil: ['networkidle0'],
    });

    const root = await page.$('#root img');
    const targetText = await page.evaluate(el => el?.outerHTML, root);
    expect(targetText).toMatch(
      /srcset="\/_(modern|rsbuild)\/ipx\/f_auto,w_500,q_75\/static\/assets\/crab\.png 1x,\/_(modern|rsbuild)\/ipx\/f_auto,w_1000,q_75\/static\/assets\/crab\.png 2x"/,
    );
    expect(targetText).toMatch(
      /src="\/_(modern|rsbuild)\/ipx\/f_auto,w_1000,q_75\/static\/assets\/crab\.png"/,
    );
    expect(targetText).toContain('width="500"');
    expect(errors.length).toEqual(0);

    await browser.close();
    await killApp(app);
  });
});
