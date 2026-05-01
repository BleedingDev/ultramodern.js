import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import {
  captureBrowserRuntimeDiagnostics,
  createBrowserRuntimeArtifactPaths,
  finishBrowserRuntimeArtifacts,
  startBrowserRuntimeTrace,
} from './browserRuntimeArtifacts';

setSuiteTimeout(1000 * 60 * 10);

type Browser = any;
type BrowserContext = any;
type BrowserType = any;
type Page = any;

type RuntimePageOptions = {
  hasTouch?: boolean;
  isMobile?: boolean;
  viewport?: {
    height: number;
    width: number;
  };
};
type ModerateHttpLoadOperation = 'bootstrap' | 'security-probe' | 'workflow';
type ModerateHttpLoadSample = {
  endedAt: number;
  error?: string;
  ok: boolean;
  operation: ModerateHttpLoadOperation;
  startedAt: number;
  status?: number;
};
type ModerateHttpLoadSummary = {
  completedDuringSmoke: number;
  errors: string[];
  operationCounts: Record<ModerateHttpLoadOperation, number>;
  requestCount: number;
  statusCounts: Record<string, number>;
  unexpectedErrorCount: number;
};

const requireFromRstestBrowserFixture = createRequire(
  path.resolve(__dirname, '../../rstest/basic-app-rstest-browser/package.json'),
);
const { chromium }: { chromium: BrowserType } =
  requireFromRstestBrowserFixture('playwright');

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const bootstrapApiPattern = '**/bff-api/effect/bootstrap';
const defaultViewport = {
  width: 1440,
  height: 960,
};
const routeTransitionSteps = [
  {
    expectedPath: '/apps/mobility-marketplace',
    heading: 'Mobility Marketplace',
    navTestId: 'nav-mobility',
    routeKind: 'mobility',
  },
  {
    expectedPath: '/apps/enterprise-mega-erp',
    heading: 'Enterprise MegaERP',
    navTestId: 'nav-mega-erp',
    routeKind: 'erp',
  },
  {
    expectedPath: '/apps/mf-platform',
    heading: 'Micro-Frontend Platform',
    navTestId: 'nav-mf-platform',
    routeKind: 'module-federation',
  },
  {
    expectedPath: '/apps/failure-lab',
    heading: 'Failure Lab',
    navTestId: 'nav-failure-lab',
    routeKind: 'failure-lab',
  },
] as const;

type RouteTransitionStep = (typeof routeTransitionSteps)[number];

async function resetPortfolio(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/reset`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
}

async function getByTestIdText(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((element: HTMLElement) => {
    return element.textContent ?? '';
  });
}

async function expectByTestIdText(
  page: Page,
  testId: string,
  expected: string,
) {
  await page.waitForFunction(
    ({ expected, testId }: { expected: string; testId: string }) => {
      return (
        document.querySelector(`[data-testid="${testId}"]`)?.textContent ===
        expected
      );
    },
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
    ({ expected, testId }: { expected: string; testId: string }) => {
      return document
        .querySelector(`[data-testid="${testId}"]`)
        ?.textContent?.includes(expected);
    },
    { expected, testId },
  );
  await expect(getByTestIdText(page, testId)).resolves.toContain(expected);
}

async function getPilotModuleState(page: Page) {
  return page.getByTestId('pilot-modules').evaluate((element: HTMLElement) => {
    return Array.from(element.querySelectorAll('label')).map(label => {
      const input = label.querySelector('input');
      return {
        module: label.textContent?.trim() ?? '',
        checked: Boolean(input?.checked),
      };
    });
  });
}

async function expectWorkflowEvent(page: Page, expected: string) {
  await page.waitForFunction(expectedText => {
    return document
      .querySelector('[data-testid="workflow-event"]')
      ?.textContent?.includes(expectedText);
  }, expected);
}

async function expectPilotStatus(page: Page, expected: string) {
  await page.waitForFunction(expectedText => {
    return document
      .querySelector('[data-testid="pilot-status"]')
      ?.textContent?.includes(expectedText);
  }, expected);
}

function createDeferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });

  return {
    promise,
    resolve,
  };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function incrementCounter(counter: Record<string, number>, key: string) {
  counter[key] = (counter[key] ?? 0) + 1;
}

function summarizeModerateHttpLoad(
  samples: ModerateHttpLoadSample[],
  input: {
    smokeEndedAt?: number;
    smokeStartedAt?: number;
  } = {},
): ModerateHttpLoadSummary {
  const operationCounts: Record<ModerateHttpLoadOperation, number> = {
    bootstrap: 0,
    'security-probe': 0,
    workflow: 0,
  };
  const statusCounts: Record<string, number> = {};
  const errors: string[] = [];
  let completedDuringSmoke = 0;

  for (const sample of samples) {
    operationCounts[sample.operation] += 1;
    if (sample.status !== undefined) {
      incrementCounter(statusCounts, String(sample.status));
    }
    if (
      input.smokeStartedAt !== undefined &&
      input.smokeEndedAt !== undefined &&
      sample.startedAt <= input.smokeEndedAt &&
      sample.endedAt >= input.smokeStartedAt
    ) {
      completedDuringSmoke += 1;
    }
    if (!sample.ok) {
      errors.push(
        `${sample.operation}:${sample.status ?? 'network'}:${
          sample.error ?? 'unknown error'
        }`,
      );
    }
  }

  return {
    completedDuringSmoke,
    errors,
    operationCounts,
    requestCount: samples.length,
    statusCounts,
    unexpectedErrorCount: errors.length,
  };
}

async function expectLoadResponseOk(
  port: number,
  operation: ModerateHttpLoadOperation,
  pathname: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${host}:${port}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${operation} ${response.status} ${pathname} ${text.slice(0, 200)}`,
    );
  }

  return response.status;
}

async function runModerateHttpLoadOperation(
  port: number,
  operation: ModerateHttpLoadOperation,
  workerIndex: number,
) {
  if (operation === 'bootstrap') {
    return expectLoadResponseOk(port, operation, '/bff-api/effect/bootstrap');
  }

  if (operation === 'security-probe') {
    return expectLoadResponseOk(
      port,
      operation,
      '/bff-api/effect/security/probe',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer browser-runtime-load-secret',
          'content-type': 'application/json',
          origin: `${host}:${port}`,
          'x-csrf-token': 'superapp-valid-csrf',
          'x-tenant-id': 'security-root',
          'x-user-role': 'security-admin',
        },
        body: JSON.stringify({
          targetTenant: 'security-root',
          targetAppId: 'tenant-security',
          action: 'load-smoke-security-probe',
          requestId: `ust-browser-05-security-${workerIndex}`,
          mutation: false,
        }),
      },
    );
  }

  return expectLoadResponseOk(
    port,
    operation,
    '/bff-api/effect/apps/mobility-marketplace/workflow',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'load-smoke-workflow',
        actor: `browser.load.${workerIndex}`,
        requestId: `ust-browser-05-workflow-${workerIndex}`,
      }),
    },
  );
}

function startModerateHttpLoad(port: number) {
  const concurrency = 6;
  const maxRunUntil = Date.now() + 1000 * 60;
  const operations: ModerateHttpLoadOperation[] = [
    'bootstrap',
    'workflow',
    'security-probe',
  ];
  const ready = createDeferred();
  const samples: ModerateHttpLoadSample[] = [];
  let readyResolved = false;
  let stopRequested = false;

  const recordSample = (sample: ModerateHttpLoadSample) => {
    samples.push(sample);
    if (!readyResolved && samples.length >= concurrency) {
      readyResolved = true;
      ready.resolve();
    }
  };

  const workers = Array.from(
    { length: concurrency },
    async (_, workerIndex) => {
      let iteration = 0;

      while (!stopRequested && Date.now() < maxRunUntil) {
        const operation =
          operations[(workerIndex + iteration) % operations.length];
        const startedAt = Date.now();

        try {
          const status = await runModerateHttpLoadOperation(
            port,
            operation,
            workerIndex,
          );
          recordSample({
            endedAt: Date.now(),
            ok: true,
            operation,
            startedAt,
            status,
          });
        } catch (error) {
          recordSample({
            endedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
            ok: false,
            operation,
            startedAt,
          });
        }

        iteration += 1;
        await sleep(35 + workerIndex * 5);
      }
    },
  );

  return {
    ready: ready.promise,
    stop: async (
      input: { smokeEndedAt?: number; smokeStartedAt?: number } = {},
    ) => {
      stopRequested = true;
      await Promise.all(workers);
      return summarizeModerateHttpLoad(samples, input);
    },
  };
}

async function expectNoVisibleCrashState(page: Page) {
  const crashState = await page.evaluate(() => {
    const isVisible = (element: Element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const bodyText = document.body.innerText;
    const crashTextMatch = bodyText.match(
      /Application error|Unhandled Runtime Error|Hydration failed|Minified React error|Cannot read properties|Something went wrong|500 Internal Server Error|404 Not Found/i,
    );
    const visibleErrorTexts = Array.from(
      document.querySelectorAll(
        '[role="alert"], [data-testid*="error"], .error',
      ),
    )
      .filter(isVisible)
      .map(element => element.textContent?.trim() ?? '')
      .filter(Boolean);
    const shell = document.querySelector('[data-testid="portfolio-shell"]');

    return {
      bodyTextLength: bodyText.trim().length,
      crashText: crashTextMatch?.[0],
      shellVisible: Boolean(shell && isVisible(shell)),
      visibleErrorTexts,
    };
  });

  expect(crashState.bodyTextLength).toBeGreaterThan(100);
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
  await expectByTestIdText(page, 'summary-apps', 'apps:5');
  expect(new URL(page.url()).pathname).toBe('/');
}

async function expectAppRoute(page: Page, step: RouteTransitionStep) {
  await page.getByTestId(step.navTestId).click();
  await page.getByTestId('portfolio-app-page').waitFor();
  await page.getByRole('heading', { name: step.heading }).waitFor();
  await expectByTestIdText(page, 'app-route-kind', step.routeKind);
  expect(new URL(page.url()).pathname).toBe(step.expectedPath);
}

async function expectViewportLayout(
  page: Page,
  expectedMode: 'desktop' | 'mobile',
) {
  const metrics = await page.evaluate(() => {
    const shell = document
      .querySelector('[data-testid="portfolio-shell"]')
      ?.getBoundingClientRect();
    const nav = document
      .querySelector('.portfolio-nav')
      ?.getBoundingClientRect();
    const workspace = document
      .querySelector('.portfolio-workspace')
      ?.getBoundingClientRect();

    return {
      documentWidth: document.documentElement.scrollWidth,
      navBottom: nav?.bottom ?? 0,
      navRight: nav?.right ?? 0,
      shellWidth: shell?.width ?? 0,
      viewportWidth: window.innerWidth,
      workspaceLeft: workspace?.left ?? 0,
      workspaceTop: workspace?.top ?? 0,
    };
  });

  expect(metrics.shellWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.documentWidth).toBeGreaterThanOrEqual(metrics.shellWidth);

  if (expectedMode === 'mobile') {
    expect(metrics.workspaceTop).toBeGreaterThanOrEqual(metrics.navBottom - 1);
  } else {
    expect(metrics.workspaceLeft).toBeGreaterThanOrEqual(metrics.navRight - 1);
  }
}

async function runRepeatedRouteTransitions(page: Page) {
  for (const _iteration of Array.from({ length: 2 })) {
    for (const step of routeTransitionSteps) {
      await expectAppRoute(page, step);
    }

    await page.getByTestId('nav-portfolio').click();
    await expectPortfolioHome(page);
  }
}

async function createRuntimePage(
  browser: Browser,
  testId: string,
  options: RuntimePageOptions = {},
) {
  const artifactPaths = createBrowserRuntimeArtifactPaths(testId);
  const context = await browser.newContext({
    hasTouch: options.hasTouch,
    isMobile: options.isMobile,
    viewport: options.viewport ?? defaultViewport,
    recordVideo: {
      dir: artifactPaths.videoDir,
    },
  });
  await startBrowserRuntimeTrace(context);
  const page = await context.newPage();
  const diagnostics = captureBrowserRuntimeDiagnostics(page);

  return {
    ...artifactPaths,
    context,
    diagnostics,
    errors: diagnostics.errors,
    page,
    testId,
  };
}

async function finishRuntimePage(
  runtimePage: Awaited<ReturnType<typeof createRuntimePage>>,
  failed: boolean,
) {
  try {
    await finishBrowserRuntimeArtifacts({
      artifactDir: runtimePage.artifactDir,
      context: runtimePage.context,
      diagnostics: runtimePage.diagnostics,
      failed,
      page: runtimePage.page,
      testId: runtimePage.testId,
      videoDir: runtimePage.videoDir,
    });
  } finally {
    await runtimePage.context.close();
  }
}

async function writeModerateHttpLoadSummary(
  artifactDir: string,
  summary: ModerateHttpLoadSummary,
) {
  await writeFile(
    path.join(artifactDir, 'moderate-http-load-summary.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        suite: 'superapp-portfolio-browser-runtime',
        testId: 'production-shell-smoke-under-moderate-load',
        ...summary,
      },
      null,
      2,
    )}\n`,
  );
}

describe('superapp portfolio browser runtime coverage', () => {
  let port: number;
  let app: Awaited<ReturnType<typeof modernServe>> | undefined;
  let browser: Browser | undefined;

  beforeAll(async () => {
    if (!existsSync(chromium.executablePath())) {
      throw new Error(
        'Playwright chromium executable is missing. Run playwright install before running superapp browser runtime coverage.',
      );
    }

    const build = await modernBuild(appDir);
    expect(build.code).toBe(0);
    port = await getPort();
    app = await modernServe(appDir, port, {
      cwd: appDir,
      stderr: false,
      stdout: false,
    });
    browser = await chromium.launch();
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    await killApp(app);
  });

  test('smokes production-served shell with browser artifacts enabled', async () => {
    await resetPortfolio(port);
    const runtimePage = await createRuntimePage(
      browser!,
      'production-shell-smoke',
    );
    const { errors, page } = runtimePage;
    let failed = false;

    try {
      await page.goto(`${host}:${port}`, {
        waitUntil: 'networkidle',
      });
      await page.getByTestId('portfolio-ready').waitFor();
      await page.getByTestId('pilot-command-center').waitFor();

      const shellSmoke = await page.evaluate(() => {
        return {
          appCards: document.querySelectorAll('[data-testid^="portfolio-app-"]')
            .length,
          currentPath: location.pathname,
          navItems: document.querySelectorAll('[data-testid^="nav-"]').length,
          readyText:
            document.querySelector('[data-testid="portfolio-ready"]')
              ?.textContent ?? '',
          title: document.title,
        };
      });
      expect(shellSmoke).toMatchObject({
        appCards: 5,
        currentPath: '/',
      });
      expect(shellSmoke.readyText).toContain('Enterprise MegaERP');
      expect(shellSmoke.navItems).toBeGreaterThanOrEqual(5);
      expect(shellSmoke.title).toBe('SuperApp Portfolio');
      expect(errors).toEqual([]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await finishRuntimePage(runtimePage, failed);
    }
  });

  test('smokes production-served shell while moderate HTTP load is active', async () => {
    await resetPortfolio(port);
    const moderateLoad = startModerateHttpLoad(port);
    await moderateLoad.ready;
    const runtimePage = await createRuntimePage(
      browser!,
      'production-shell-smoke-under-moderate-load',
    );
    const { diagnostics, errors, page } = runtimePage;
    let failed = false;
    let loadSummary: ModerateHttpLoadSummary | undefined;
    let smokeEndedAt: number | undefined;
    let smokeStartedAt: number | undefined;

    try {
      smokeStartedAt = Date.now();
      await page.goto(`${host}:${port}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByTestId('portfolio-ready').waitFor();
      await page.waitForLoadState('networkidle');
      await expectPortfolioHome(page);
      await expectNoVisibleCrashState(page);

      await page.getByTestId('nav-mobility').click();
      await page.getByTestId('portfolio-app-page').waitFor();
      await page
        .getByRole('heading', { name: 'Mobility Marketplace' })
        .waitFor();
      await expectByTestIdText(page, 'app-route-kind', 'mobility');
      await expectNoVisibleCrashState(page);

      await page.getByTestId('run-workflow').click();
      await page.waitForFunction(() => {
        return document
          .querySelector('[data-testid="workflow-event"]')
          ?.textContent?.includes(':accepted');
      });
      await expectNoVisibleCrashState(page);

      await page.getByTestId('nav-portfolio').click();
      await expectPortfolioHome(page);
      await expectNoVisibleCrashState(page);
      smokeEndedAt = Date.now();

      loadSummary = await moderateLoad.stop({
        smokeEndedAt,
        smokeStartedAt,
      });
      await writeModerateHttpLoadSummary(runtimePage.artifactDir, loadSummary);

      expect(loadSummary.requestCount).toBeGreaterThanOrEqual(12);
      expect(loadSummary.completedDuringSmoke).toBeGreaterThan(0);
      expect(loadSummary.unexpectedErrorCount).toBe(0);
      expect(loadSummary.operationCounts.bootstrap).toBeGreaterThan(0);
      expect(loadSummary.operationCounts.workflow).toBeGreaterThan(0);
      expect(loadSummary.operationCounts['security-probe']).toBeGreaterThan(0);
      expect(loadSummary.statusCounts['200']).toBe(loadSummary.requestCount);
      expect(diagnostics.brokenResources).toEqual([]);
      expect(diagnostics.hydrationWarnings).toEqual([]);
      expect(errors).toEqual([]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!loadSummary) {
        smokeEndedAt ??= Date.now();
        loadSummary = await moderateLoad.stop({
          smokeEndedAt,
          smokeStartedAt,
        });
        await writeModerateHttpLoadSummary(
          runtimePage.artifactDir,
          loadSummary,
        );
      }
      await finishRuntimePage(runtimePage, failed);
    }
  });

  test('navigates ERP dashboards, app tables, forms, and lazy module surfaces', async () => {
    await resetPortfolio(port);
    const runtimePage = await createRuntimePage(
      browser!,
      'production-erp-mf-flow',
    );
    const { errors, page } = runtimePage;
    let failed = false;

    try {
      await page.goto(`${host}:${port}`, {
        waitUntil: 'networkidle',
      });
      await page.getByTestId('portfolio-ready').waitFor();
      await page.getByTestId('pilot-command-center').waitFor();

      const appCards = page.locator('[data-testid^="portfolio-app-"]');
      expect(await appCards.count()).toBe(5);
      await expectByTestIdTextContaining(
        page,
        'portfolio-app-enterprise-mega-erp',
        'Enterprise MegaERP',
      );
      await expectByTestIdTextContaining(
        page,
        'portfolio-app-enterprise-mega-erp',
        'routes:3',
      );
      await expectByTestIdTextContaining(
        page,
        'portfolio-app-mf-platform',
        'Micro-Frontend Platform',
      );

      await page.getByTestId('nav-mega-erp').click();
      await page.getByTestId('portfolio-app-page').waitFor();
      await page.getByRole('heading', { name: 'Enterprise MegaERP' }).waitFor();
      await expectByTestIdText(page, 'app-route-kind', 'erp');
      await expectByTestIdText(page, 'app-capabilities', 'capabilities:4');
      await expectByTestIdText(
        page,
        'app-profiles',
        'smoke:3;stress:3;nightly:7',
      );
      await page.getByTestId('run-workflow').click();
      await expectWorkflowEvent(page, 'evt-1:accepted');

      await page.getByTestId('nav-mf-platform').click();
      await page.getByTestId('portfolio-app-page').waitFor();
      await expectByTestIdText(page, 'app-route-kind', 'module-federation');
      await page
        .getByRole('heading', {
          name: 'Micro-Frontend Platform',
        })
        .waitFor();
      await page.getByTestId('run-workflow').click();
      await expectWorkflowEvent(page, 'evt-2:accepted');

      await page.getByTestId('nav-portfolio').click();
      await page.getByTestId('pilot-command-center').waitFor();
      expect(
        await page
          .getByTestId('pilot-module-results')
          .locator('[data-testid^="pilot-module-"]')
          .count(),
      ).toBe(0);
      await page
        .getByTestId('pilot-scenario')
        .selectOption('mega-erp-command-center');
      await expectByTestIdTextContaining(
        page,
        'pilot-scenario-plan',
        'Enterprise MegaERP Command Center',
      );
      await expectByTestIdTextContaining(
        page,
        'pilot-scenario-plan',
        'routes:/mega-erp -> /mega-erp/procurement -> /mega-erp/payroll -> /security/roles',
      );
      expect(await getPilotModuleState(page)).toEqual([
        { module: 'rides', checked: false },
        { module: 'dispatch', checked: false },
        { module: 'orders', checked: true },
        { module: 'erp', checked: true },
        { module: 'chat', checked: true },
        { module: 'mf-remotes', checked: true },
        { module: 'security', checked: true },
        { module: 'billing', checked: true },
      ]);

      await page.getByTestId('run-pilot').click();
      await expectPilotStatus(
        page,
        'Enterprise MegaERP Command Center:accepted:none',
      );
      expect(
        await page
          .getByTestId('pilot-module-results')
          .locator('[data-testid^="pilot-module-"]')
          .count(),
      ).toBe(6);
      await expectByTestIdTextContaining(
        page,
        'pilot-module-mf-remotes',
        'mf-platform',
      );
      await expectByTestIdTextContaining(
        page,
        'pilot-production-checks',
        'checks:13',
      );
      expect(errors).toEqual([]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await finishRuntimePage(runtimePage, failed);
    }
  });

  test('runs chat workflow, switches tenants, and surfaces browser error states', async () => {
    await resetPortfolio(port);
    const runtimePage = await createRuntimePage(
      browser!,
      'production-chat-security-flow',
    );
    const { errors, page } = runtimePage;
    let failed = false;

    try {
      await page.goto(`${host}:${port}`, {
        waitUntil: 'networkidle',
      });
      await page.getByTestId('pilot-command-center').waitFor();
      await page
        .getByTestId('pilot-scenario')
        .selectOption('mobility-erp-chat');
      await expectByTestIdTextContaining(
        page,
        'pilot-scenario-plan',
        'Mobility Incident To ERP Chat Escalation',
      );
      expect(await getPilotModuleState(page)).toEqual([
        { module: 'rides', checked: true },
        { module: 'dispatch', checked: true },
        { module: 'orders', checked: false },
        { module: 'erp', checked: true },
        { module: 'chat', checked: true },
        { module: 'mf-remotes', checked: false },
        { module: 'security', checked: true },
        { module: 'billing', checked: true },
      ]);

      await page.getByTestId('run-pilot').click();
      await expectPilotStatus(
        page,
        'Mobility Incident To ERP Chat Escalation:accepted:none',
      );
      await expectByTestIdTextContaining(
        page,
        'pilot-module-chat',
        'ok:nominal',
      );
      await expectByTestIdTextContaining(page, 'pilot-summary', 'events:6');
      await expectByTestIdTextContaining(page, 'pilot-summary', 'security:1');

      const expectedFetchErrorStart = errors.length;
      const browserTenantChecks = await page.evaluate(async () => {
        const postJson = async (
          pathname: string,
          body: unknown,
          headers: Record<string, string> = {},
        ) => {
          const response = await fetch(pathname, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...headers,
            },
            body: JSON.stringify(body),
          });
          const text = await response.text();
          return {
            status: response.status,
            text,
            json: text ? JSON.parse(text) : null,
          };
        };
        const getSummary = async () => {
          const response = await fetch('/bff-api/effect/bootstrap');
          const payload = await response.json();
          return payload.summary;
        };
        const securityPayload = {
          targetTenant: 'security-root',
          targetAppId: 'tenant-security',
          action: 'role-check',
          requestId: 'browser-runtime-security-probe',
          mutation: true,
        };
        const securityHeaders = {
          authorization: 'Bearer browser-runtime-secret',
          origin: location.origin,
          'x-csrf-token': 'superapp-valid-csrf',
          'x-tenant-id': 'security-root',
          'x-user-role': 'security-admin',
        };
        const allowed = await postJson(
          '/bff-api/effect/security/probe',
          securityPayload,
          securityHeaders,
        );
        const beforeRejected = await getSummary();
        const rejected = await postJson(
          '/bff-api/effect/security/probe',
          securityPayload,
          {
            ...securityHeaders,
            'x-tenant-id': 'city-ops-eu',
          },
        );
        const tenantBoundary = await postJson(
          '/bff-api/effect/pilot/mobility-erp-chat/run',
          {
            tenant: 'city-ops-eu',
            actor: 'browser.tenant-switch',
            requestId: 'browser-tenant-switch-denied',
            modules: [
              'rides',
              'dispatch',
              'erp',
              'chat',
              'security',
              'billing',
            ],
            chaos: 'none',
          },
        );
        const malformed = await fetch(
          '/bff-api/effect/pilot/grab-marketplace/run',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: '{',
          },
        );
        await malformed.text();
        const afterRejected = await getSummary();

        return {
          allowedStatus: allowed.status,
          allowedDecision: allowed.json,
          rejectedStatus: rejected.status,
          rejectedText: rejected.text,
          tenantBoundaryStatus: tenantBoundary.status,
          malformedStatus: malformed.status,
          beforeRejected,
          afterRejected,
        };
      });
      expect(browserTenantChecks.allowedStatus).toBe(200);
      expect(browserTenantChecks.allowedDecision).toMatchObject({
        allowed: true,
        telemetry: {
          tenant: 'security-root',
          role: 'security-admin',
          authorization: '[redacted]',
          csrfToken: '[redacted]',
        },
      });
      expect(browserTenantChecks.rejectedStatus).toBeGreaterThanOrEqual(400);
      expect(browserTenantChecks.rejectedText).not.toContain(
        'browser-runtime-secret',
      );
      expect(browserTenantChecks.tenantBoundaryStatus).toBeGreaterThanOrEqual(
        400,
      );
      expect(browserTenantChecks.malformedStatus).toBeGreaterThanOrEqual(400);
      expect(browserTenantChecks.afterRejected).toEqual(
        browserTenantChecks.beforeRejected,
      );
      const expectedRejectedResourceErrors = errors.splice(
        expectedFetchErrorStart,
      );
      expect(expectedRejectedResourceErrors).toHaveLength(3);
      expect(
        expectedRejectedResourceErrors.every(error =>
          error.startsWith('console:Failed to load resource:'),
        ),
      ).toBe(true);
      expect(
        expectedRejectedResourceErrors.filter(error =>
          error.includes('500 (Internal Server Error)'),
        ),
      ).toHaveLength(2);
      expect(
        expectedRejectedResourceErrors.filter(error =>
          error.includes('400 (Bad Request)'),
        ),
      ).toHaveLength(1);

      await page.getByTestId('reset-pilot').click();
      await expectPilotStatus(page, 'idle');
      await page
        .getByTestId('pilot-scenario')
        .selectOption('mega-erp-command-center');
      await page.getByTestId('pilot-chaos').selectOption('api-timeout');
      await page.getByTestId('run-pilot').click();
      await expectPilotStatus(
        page,
        'Enterprise MegaERP Command Center:accepted:api-timeout',
      );
      await expectByTestIdTextContaining(
        page,
        'pilot-module-erp',
        'failed:degraded',
      );
      await expectByTestIdTextContaining(page, 'pilot-summary', 'degraded:1');
      expect(errors).toEqual([]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await finishRuntimePage(runtimePage, failed);
    }
  });

  test('handles slow bootstrap fetches and offline-to-online recovery', async () => {
    await resetPortfolio(port);
    const runtimePage = await createRuntimePage(
      browser!,
      'slow-network-offline-online-recovery',
    );
    const { context, errors, page } = runtimePage;
    const releaseBootstrap = createDeferred();
    let bootstrapRequestCount = 0;
    let resolveFirstBootstrapRequest: () => void = () => {};
    const firstBootstrapRequest = new Promise<void>(resolve => {
      resolveFirstBootstrapRequest = resolve;
    });
    let failed = false;

    await context.route(bootstrapApiPattern, async (route: any) => {
      bootstrapRequestCount += 1;

      if (bootstrapRequestCount === 1) {
        resolveFirstBootstrapRequest();
        await releaseBootstrap.promise;
      }

      await route.continue();
    });

    try {
      await page.goto(`${host}:${port}`, {
        waitUntil: 'domcontentloaded',
      });
      await firstBootstrapRequest;
      await page.getByTestId('portfolio-loading').waitFor();
      await expectByTestIdText(page, 'route-kind', 'portfolio-command-center');
      expect(await page.getByTestId('portfolio-loading').isVisible()).toBe(
        true,
      );

      releaseBootstrap.resolve();
      await page.getByTestId('portfolio-ready').waitFor();
      await page.waitForLoadState('networkidle');
      await expectPortfolioHome(page);
      expect(bootstrapRequestCount).toBeGreaterThanOrEqual(1);

      await context.setOffline(true);
      const expectedOfflineErrorStart = errors.length;
      const offlineFetchResult = await page.evaluate(async () => {
        try {
          await fetch('/bff-api/effect/bootstrap');
          return 'resolved';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      });
      expect(offlineFetchResult).not.toBe('resolved');

      await context.setOffline(false);
      await expectAppRoute(page, routeTransitionSteps[2]);
      await page.getByTestId('run-workflow').click();
      await expectWorkflowEvent(page, 'evt-1:accepted');

      const expectedOfflineErrors = errors.splice(expectedOfflineErrorStart);
      expect(expectedOfflineErrors.length).toBeGreaterThanOrEqual(1);
      expect(
        expectedOfflineErrors.some(error =>
          /ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to fetch/i.test(error),
        ),
      ).toBe(true);
      expect(
        expectedOfflineErrors.some(
          error =>
            error.startsWith('requestfailed:GET ') &&
            error.includes('/bff-api/effect/bootstrap'),
        ),
      ).toBe(true);
      expect(
        expectedOfflineErrors.every(
          error =>
            error.startsWith('requestfailed:GET ') ||
            error.startsWith('console:Failed to load resource:'),
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await context.setOffline(false);
      await context.unroute(bootstrapApiPattern);
      await finishRuntimePage(runtimePage, failed);
    }
  });

  test('keeps mobile and desktop viewports stable across repeated route transitions', async () => {
    await resetPortfolio(port);
    const viewportScenarios = [
      {
        artifactId: 'mobile-repeated-route-transitions',
        mode: 'mobile' as const,
        options: {
          hasTouch: true,
          isMobile: true,
          viewport: {
            width: 390,
            height: 844,
          },
        },
      },
      {
        artifactId: 'desktop-repeated-route-transitions',
        mode: 'desktop' as const,
        options: {
          viewport: {
            width: 1600,
            height: 1000,
          },
        },
      },
    ];

    for (const scenario of viewportScenarios) {
      const runtimePage = await createRuntimePage(
        browser!,
        scenario.artifactId,
        scenario.options,
      );
      const { errors, page } = runtimePage;
      let failed = false;

      try {
        await page.goto(`${host}:${port}`, {
          waitUntil: 'networkidle',
        });
        await expectPortfolioHome(page);
        await expectViewportLayout(page, scenario.mode);
        await runRepeatedRouteTransitions(page);
        await expectViewportLayout(page, scenario.mode);
        expect(errors).toEqual([]);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        await finishRuntimePage(runtimePage, failed);
      }
    }
  });
});
