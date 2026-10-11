import fs from 'fs';
import path from 'path';
import puppeteer, { type Browser, type HTTPRequest } from 'puppeteer';
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

describe('alias set build', () => {
  test(`should get right alias build!`, async () => {
    const buildRes = await modernBuild(appDir);
    expect(buildRes.code === 0).toBe(true);
    expect(existsSync('route.json')).toBe(true);
    expect(existsSync('html/index/index.html')).toBe(true);
  });
});

describe('alias set dev', () => {
  test(`should render page correctly`, async () => {
    const appPort = await getPort();
    const maxRecords = 20;
    const maxTextLength = 2_048;
    const maxOutputLength = 16_000;
    const record = <T>(events: T[], event: T) => {
      events.push(event);
      if (events.length > maxRecords) events.shift();
    };
    const errors: string[] = [];
    const pending = new Map<
      HTTPRequest,
      { method: string; url: string; resourceType: string; startedAt: number }
    >();
    const responses: { status: number; url: string }[] = [];
    const failedRequests: { url: string; error: string }[] = [];
    const lifecycle: string[] = [];
    let pendingCount = 0;
    let stdout = '';
    let stderr = '';
    let phase = 'dev server startup';
    let app: Awaited<ReturnType<typeof launchApp>> | undefined;
    let browser: Browser | undefined;
    let failed = false;
    let cleanupErrors: unknown[] = [];

    try {
      app = await launchApp(
        appDir,
        appPort,
        {
          onStdout: (message: string) => {
            stdout = (stdout + message.slice(-maxOutputLength)).slice(
              -maxOutputLength,
            );
          },
          onStderr: (message: string) => {
            stderr = (stderr + message.slice(-maxOutputLength)).slice(
              -maxOutputLength,
            );
          },
        },
        {
          // FIXME: disable the fast refresh plugin to avoid the `require` not found issue.
          FAST_REFRESH: 'false',
        },
      );
      phase = 'browser startup';
      browser = await puppeteer.launch(launchOptions as any);
      const page = await browser.newPage();
      page.on('pageerror', error =>
        record(errors, (error as Error).message.slice(0, maxTextLength)),
      );
      page.on('request', request => {
        pendingCount += 1;
        if (pending.size < maxRecords) {
          pending.set(request, {
            method: request.method().slice(0, maxTextLength),
            url: request.url().slice(0, maxTextLength),
            resourceType: request.resourceType().slice(0, maxTextLength),
            startedAt: Date.now(),
          });
        }
      });
      page.on('requestfinished', request => {
        pendingCount -= 1;
        pending.delete(request);
      });
      page.on('requestfailed', request => {
        pendingCount -= 1;
        pending.delete(request);
        record(failedRequests, {
          url: request.url().slice(0, maxTextLength),
          error: (request.failure()?.errorText ?? 'unknown').slice(
            0,
            maxTextLength,
          ),
        });
      });
      page.on('response', response =>
        record(responses, {
          status: response.status(),
          url: response.url().slice(0, maxTextLength),
        }),
      );
      page.on('domcontentloaded', () => record(lifecycle, 'domcontentloaded'));
      page.on('load', () => record(lifecycle, 'load'));
      phase = 'navigation';
      await page.goto(`http://localhost:${appPort}`, {
        waitUntil: ['networkidle0'],
      });

      phase = 'page assertions';
      const root = await page.$('#root');
      const targetText = await page.evaluate(el => el?.textContent, root);
      expect(targetText?.trim()).toEqual('Hello Modern.js! 1');
      expect(errors.length).toEqual(0);
    } catch (error) {
      failed = true;
      console.error(
        '[alias-set dev] failure diagnostics',
        JSON.stringify(
          {
            phase,
            url: `http://localhost:${appPort}`,
            lifecycle,
            pendingCount,
            pending: [...pending.values()].map(({ startedAt, ...request }) => ({
              ...request,
              elapsedMs: Date.now() - startedAt,
            })),
            responses,
            failedRequests,
            pageErrors: errors,
            stdout,
            stderr,
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      const cleanup = await Promise.allSettled([
        browser?.close(),
        app ? killApp(app) : undefined,
      ]);
      cleanupErrors = cleanup.flatMap(result =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failed && cleanupErrors.length > 0) {
        console.error(
          '[alias-set dev] cleanup failed',
          cleanupErrors.map(error => String(error).slice(0, maxTextLength)),
        );
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'alias-set cleanup failed');
    }
  });
});
