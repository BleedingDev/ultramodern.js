import { existsSync } from 'node:fs';
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

const requireFromRstestBrowserFixture = createRequire(
  path.resolve(__dirname, '../../rstest/basic-app-rstest-browser/package.json'),
);
const { chromium }: { chromium: BrowserType } =
  requireFromRstestBrowserFixture('playwright');

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';

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

async function createRuntimePage(browser: Browser, testId: string) {
  const artifactPaths = createBrowserRuntimeArtifactPaths(testId);
  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 960,
    },
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
});
