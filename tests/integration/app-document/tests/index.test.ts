import fs from 'fs';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';

import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
  modernBuild,
} from '../../../utils/modernTestUtils';

const appDir = path.resolve(__dirname, '../');

function existsSync(filePath: string) {
  return fs.existsSync(path.join(appDir, 'dist', filePath));
}
describe('test dev and build', () => {
  describe('test build', () => {
    let buildRes: any;
    beforeAll(async () => {
      buildRes = await modernBuild(appDir);
    });

    test(`should get right alias build!`, async () => {
      if (buildRes.code !== 0) {
        console.log('\n===> build failed, stdout: ', buildRes.stdout);
        console.log('\n===> build failed, stderr: ', buildRes.stderr);
      }
      expect(buildRes.code).toEqual(0);
      expect(existsSync('route.json')).toBe(true);
      expect(existsSync('html/test/index.html')).toBe(true);
      expect(existsSync('html/sub/index.html')).toBe(true);
    });

    test('built documents expose custom document behavior in a browser', async () => {
      const browser = await puppeteer.launch(launchOptions as any);
      try {
        const page = await browser.newPage();
        const consoleMessages: string[] = [];
        page.on('console', message => consoleMessages.push(message.text()));

        await page.setContent(
          fs.readFileSync(
            path.join(appDir, 'dist', 'html/sub/index.html'),
            'utf-8',
          ),
        );
        const documentState = await page.evaluate(() => {
          const script =
            document.querySelector<HTMLScriptElement>('#script-has-id');
          const customStyleRule = Array.from(document.styleSheets).some(
            sheet => {
              try {
                return Array.from(sheet.cssRules).some(rule => {
                  const cssText = rule.cssText.replace(/\s+/gu, '');
                  return (
                    cssText.includes('.logo-spin>div:last-child') &&
                    cssText.includes('margin-right:0')
                  );
                });
              } catch {
                return false;
              }
            },
          );

          return {
            aliasRendered:
              document
                .querySelector('#root')
                ?.textContent?.includes('alias message: Alias module works!') ??
              false,
            bodyDirection: document.body.dir,
            customStyleRule,
            headClass: document.head.className,
            iifeScript: {
              async: script?.async,
              defer: script?.defer,
            },
            rootClass: document.querySelector('#root')?.className,
            title: document.title,
            windowState: {
              abc: (window as any).abc,
              b: (window as any).b,
            },
            documentLanguage: document.documentElement.lang,
          };
        });

        expect(documentState).toMatchObject({
          aliasRendered: true,
          bodyDirection: 'ltr',
          customStyleRule: true,
          documentLanguage: 'cn',
          headClass: 'head',
          iifeScript: { async: true, defer: true },
          rootClass: 'root',
          title: 'test-title',
          windowState: { abc: 'hjk', b: 22 },
        });
        expect(consoleMessages).toEqual(
          expect.arrayContaining(['abc', 'sss', 'this is a IIFE function']),
        );
      } finally {
        await browser.close();
      }
    });
  });

  describe('test dev', () => {
    let app: any;
    let appPort: number;
    let errors: unknown[];
    let browser: Browser;
    let page: Page;
    beforeAll(async () => {
      appPort = await getPort();
      app = await launchApp(appDir, appPort, {}, {});
      errors = [];
      browser = await puppeteer.launch(launchOptions as any);
      page = await browser.newPage();
      page.on('pageerror', error => {
        errors.push((error as Error).message);
      });
    });
    afterAll(async () => {
      await killApp(app);
      await page.close();
      await browser.close();
    });

    test(`should render page test correctly`, async () => {
      await page.goto(`http://localhost:${appPort}/test`, {
        waitUntil: ['networkidle0'],
      });

      const root = await page.$('#root');
      const targetText = await page.evaluate(el => el?.textContent, root);
      expect(targetText?.trim()).toEqual('A');
      expect(errors.length).toEqual(0);
    });

    test(`should render page sub correctly`, async () => {
      await page.goto(`http://localhost:${appPort}/sub`, {
        waitUntil: ['networkidle0'],
      });

      await page.waitForSelector('#root a');
      const root = await page.$('#root');
      const targetText = await page.evaluate(el => el?.textContent, root);
      expect(targetText?.trim()).toEqual('去 A去 B');
      expect(errors.length).toEqual(0);
    });

    test(`should render page sub route a correctly`, async () => {
      await page.goto(`http://localhost:${appPort}/sub/a`, {
        waitUntil: ['networkidle0'],
      });

      await page.waitForSelector('#root a');
      const root = await page.$('#root');
      const targetText = await page.evaluate(el => el?.textContent, root);
      expect(targetText?.trim()).toEqual('Here is page A返回 Home');
      expect(errors.length).toEqual(0);
    });
  });
});
