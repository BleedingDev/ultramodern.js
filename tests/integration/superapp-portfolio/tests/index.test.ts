import { execSync } from 'node:child_process';
import dns from 'node:dns';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

dns.setDefaultResultOrder('ipv4first');
setSuiteTimeout(1000 * 60 * 8);

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const browserLaunchOptions = launchOptions as Parameters<
  typeof puppeteer.launch
>[0];

function captureBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', error => {
    errors.push(error instanceof Error ? error.message : String(error));
  });
  return errors;
}

async function postJson(port: number, pathname: string, body?: unknown) {
  return fetch(`${host}:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function getBootstrap(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/bootstrap`);
  expect(response.status).toBe(200);
  return response.json();
}

async function resetPortfolio(port: number) {
  const response = await postJson(port, '/bff-api/effect/reset');
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toMatchObject({
    ok: true,
    summary: {
      appCount: 5,
      highRiskApps: 3,
      eventCount: 0,
      failureMode: 'healthy',
    },
  });
}

async function expectEffectPortfolioContracts(port: number) {
  await resetPortfolio(port);

  const openApiResponse = await fetch(`${host}:${port}/bff-api/openapi.json`);
  expect(openApiResponse.status).toBe(200);
  const openApi = await openApiResponse.json();
  expect(openApi.paths['/effect/bootstrap']).toBeDefined();
  expect(openApi.paths['/effect/apps/{appId}/workflow']).toBeDefined();
  expect(openApi.paths['/effect/failure/{mode}']).toBeDefined();

  const bootstrap = await getBootstrap(port);
  expect(bootstrap.summary).toMatchObject({
    appCount: 5,
    highRiskApps: 3,
    totalOpenWork: 272,
    eventCount: 0,
    failureMode: 'healthy',
  });
  expect(bootstrap.apps.map((app: { id: string }) => app.id)).toEqual([
    'mobility-marketplace',
    'enterprise-mega-erp',
    'mf-platform',
    'tenant-security',
    'failure-lab',
  ]);
  for (const app of bootstrap.apps) {
    expect(app.profiles.smoke.workflows.length).toBeGreaterThanOrEqual(3);
    expect(app.profiles.stress.concurrency).toBeGreaterThanOrEqual(8);
    expect(app.profiles.nightly.durationMs).toBeGreaterThanOrEqual(
      1000 * 60 * 60,
    );
  }

  const workflow = await postJson(
    port,
    '/bff-api/effect/apps/mobility-marketplace/workflow',
    {
      action: 'quote',
      actor: 'ops.commander',
      requestId: 'req-mobility-1',
    },
  );
  expect(workflow.status).toBe(200);
  await expect(workflow.json()).resolves.toMatchObject({
    event: {
      id: 'evt-1',
      appId: 'mobility-marketplace',
      action: 'quote',
      status: 'accepted',
    },
    summary: {
      eventCount: 1,
    },
  });

  const deduped = await postJson(
    port,
    '/bff-api/effect/apps/mobility-marketplace/workflow',
    {
      action: 'quote',
      actor: 'ops.commander',
      requestId: 'req-mobility-1',
    },
  );
  expect(deduped.status).toBe(200);
  await expect(deduped.json()).resolves.toMatchObject({
    event: {
      id: 'evt-1',
      status: 'deduped',
    },
    summary: {
      eventCount: 1,
    },
  });

  const failure = await postJson(port, '/bff-api/effect/failure/remote-down', {
    actor: 'failure.operator',
    reason: 'verify deterministic fallback lane',
  });
  expect(failure.status).toBe(200);
  await expect(failure.json()).resolves.toMatchObject({
    failureMode: 'remote-down',
    summary: {
      failureMode: 'remote-down',
      eventCount: 2,
    },
  });
}

async function expectInvalidRequestsDoNotDrift(port: number) {
  await resetPortfolio(port);
  const before = await getBootstrap(port);

  const invalidWorkflow = await postJson(
    port,
    '/bff-api/effect/apps/unknown-app/workflow',
    {
      action: 'quote',
      actor: 'ops.commander',
      requestId: 'invalid-1',
    },
  );
  expect(invalidWorkflow.status).toBeGreaterThanOrEqual(400);

  const malformed = await fetch(
    `${host}:${port}/bff-api/effect/apps/mobility-marketplace/workflow`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    },
  );
  expect(malformed.status).toBeGreaterThanOrEqual(400);

  const after = await getBootstrap(port);
  expect(after.summary).toEqual(before.summary);
  expect(after.events).toEqual(before.events);
  expect(after.apps).toEqual(before.apps);
}

describe('superapp portfolio fixture', () => {
  let port: number;
  let app: Awaited<ReturnType<typeof modernServe>> | undefined;
  let browser: Browser | undefined;

  beforeAll(async () => {
    execSync('pnpm tsc --noEmit', {
      cwd: appDir,
      stdio: 'inherit',
    });
    const build = await modernBuild(appDir);
    expect(build.code).toBe(0);
    port = await getPort();
    app = await modernServe(appDir, port, {
      cwd: appDir,
      stderr: false,
      stdout: false,
    });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    await killApp(app);
  });

  test('serves Effect portfolio contracts and profile metadata', async () => {
    await expectEffectPortfolioContracts(port);
  });

  test('rejects invalid portfolio requests without state drift', async () => {
    await expectInvalidRequestsDoNotDrift(port);
  });

  test('renders TanStack portfolio routes without browser errors', async () => {
    browser = await puppeteer.launch(browserLaunchOptions);
    const page = await browser.newPage();
    const errors = captureBrowserErrors(page);

    await page.goto(`${host}:${port}`, {
      waitUntil: ['domcontentloaded', 'networkidle0'],
    });
    await page.waitForSelector('[data-testid="portfolio-ready"]');
    await expect(
      page.$eval(
        '[data-testid="summary-apps"]',
        element => element.textContent,
      ),
    ).resolves.toBe('apps:5');

    await page.click('[data-testid="nav-mobility"]');
    await page.waitForSelector('[data-testid="portfolio-app-page"]');
    await expect(
      page.$eval(
        '[data-testid="app-route-kind"]',
        element => element.textContent,
      ),
    ).resolves.toBe('mobility');
    await page.click('[data-testid="run-workflow"]');
    await expect(
      page.waitForFunction(() =>
        document
          .querySelector('[data-testid="workflow-event"]')
          ?.textContent?.includes('evt-1:accepted'),
      ),
    ).resolves.toBeTruthy();

    expect(errors).toEqual([]);
  });
});
