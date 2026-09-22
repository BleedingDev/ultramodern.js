import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { buildFixtureOnce } from '../../../utils/fixtureBuild';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import {
  createBrowserRuntimePage as createRuntimePage,
  launchRuntimeBrowser,
} from './browserRuntimeFixture';

setSuiteTimeout(1000 * 60 * 10);

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const bootstrapApiPattern = '**/bff-api/effect/bootstrap';
const offlineErrorPattern =
  /ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to fetch|Failed to load resource/i;

async function resetPortfolio(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/reset`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
}

async function getByTestIdText(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate(element => {
    return element.textContent ?? '';
  });
}

async function expectByTestIdText(
  page: Page,
  testId: string,
  expected: string,
) {
  await page.waitForFunction(
    ({ expected, testId }: { expected: string; testId: string }) =>
      document.querySelector(`[data-testid="${testId}"]`)?.textContent ===
      expected,
    { expected, testId },
  );
  await expect(getByTestIdText(page, testId)).resolves.toBe(expected);
}

async function expectByTestIdTextContaining(
  page: Page,
  testId: string,
  expected: string,
) {
  await page.waitForFunction(
    ({ expected, testId }: { expected: string; testId: string }) =>
      document
        .querySelector(`[data-testid="${testId}"]`)
        ?.textContent?.includes(expected),
    { expected, testId },
  );
  await expect(getByTestIdText(page, testId)).resolves.toContain(expected);
}

async function expectNoVisibleCrashState(page: Page) {
  const crashState = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const shell = document.querySelector('[data-testid="portfolio-shell"]');
    return {
      crashText: bodyText.match(
        /Application error|Unhandled Runtime Error|Hydration failed|Minified React error|Cannot read properties|Something went wrong|500 Internal Server Error|404 Not Found/i,
      )?.[0],
      shellVisible: Boolean(shell),
      visibleErrorTexts: Array.from(
        document.querySelectorAll(
          '[role="alert"], [data-testid*="error"], .error',
        ),
      )
        .map(element => element.textContent?.trim() ?? '')
        .filter(Boolean),
    };
  });

  expect(crashState.crashText).toBeUndefined();
  expect(crashState.shellVisible).toBe(true);
  expect(crashState.visibleErrorTexts).toEqual([]);
}

async function expectPortfolioHome(page: Page) {
  await page.getByTestId('portfolio-page').waitFor();
  await page.getByTestId('pilot-command-center').waitFor();
  await expectByTestIdText(page, 'route-kind', 'portfolio-command-center');
  await expectByTestIdTextContaining(
    page,
    'shell-mode',
    'tanstack-effect-superapp-portfolio',
  );
  await expectByTestIdTextContaining(page, 'summary-apps', 'apps:');
  expect(await getByTestIdText(page, 'summary-apps')).toMatch(
    /^apps:[1-9]\d*$/,
  );
  expect(new URL(page.url()).pathname).toBe('/');
}

describe('superapp portfolio browser runtime coverage', () => {
  let port: number;
  let app: Awaited<ReturnType<typeof modernServe>> | undefined;
  let browser: Browser | undefined;

  beforeAll(async () => {
    const build = await buildFixtureOnce(appDir, {
      build: () => modernBuild(appDir),
    });
    expect(build.code).toBe(0);
    port = await getPort();
    app = await modernServe(appDir, port, {
      cwd: appDir,
      stderr: false,
      stdout: false,
    });
    browser = await launchRuntimeBrowser();
  });

  afterAll(async () => {
    await browser?.close();
    await killApp(app);
  });

  test('navigates app routes and runs a workflow without visible errors', async () => {
    await resetPortfolio(port);
    const runtimePage = await createRuntimePage(browser!);
    const { diagnostics, page } = runtimePage;

    try {
      await page.goto(`${host}:${port}`, { waitUntil: 'networkidle' });
      await expectPortfolioHome(page);
      await expectNoVisibleCrashState(page);

      await page.getByTestId('nav-mobility').click();
      await page.getByTestId('portfolio-app-page').waitFor();
      await page
        .getByRole('heading', { name: 'Mobility Marketplace' })
        .waitFor();
      await expectByTestIdText(page, 'app-route-kind', 'mobility');
      await page.getByTestId('run-workflow').click();
      await expectByTestIdTextContaining(page, 'workflow-event', ':accepted');
      await expectNoVisibleCrashState(page);

      await page.getByTestId('nav-portfolio').click();
      await expectPortfolioHome(page);
      await expectNoVisibleCrashState(page);

      expect(diagnostics.brokenResources).toEqual([]);
      expect(diagnostics.hydrationWarnings).toEqual([]);
      expect(diagnostics.errors).toEqual([]);
    } finally {
      await runtimePage.context.close();
    }
  });

  test('shows the loading state during a slow bootstrap and recovers after going offline', async () => {
    await resetPortfolio(port);
    const runtimePage = await createRuntimePage(browser!);
    const { context, diagnostics, page } = runtimePage;

    try {
      let releaseBootstrap = () => {};
      const bootstrapHeld = new Promise<void>(resolve => {
        releaseBootstrap = resolve;
      });
      await context.route(
        bootstrapApiPattern,
        async route => {
          await bootstrapHeld;
          await route.continue();
        },
        { times: 1 },
      );

      await page.goto(`${host}:${port}`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('portfolio-loading').waitFor();
      releaseBootstrap();
      await expectPortfolioHome(page);

      await context.setOffline(true);
      const offlineFetch = await page.evaluate(async () => {
        try {
          await fetch('/bff-api/effect/bootstrap');
          return 'resolved';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      });
      expect(offlineFetch).not.toBe('resolved');
      await context.setOffline(false);

      await page.getByTestId('nav-mobility').click();
      await page.getByTestId('portfolio-app-page').waitFor();
      await page.getByTestId('run-workflow').click();
      await expectByTestIdTextContaining(page, 'workflow-event', ':accepted');

      expect(
        diagnostics.errors.filter(
          (error: string) => !offlineErrorPattern.test(error),
        ),
      ).toEqual([]);
    } finally {
      await runtimePage.context.close();
    }
  });
});
