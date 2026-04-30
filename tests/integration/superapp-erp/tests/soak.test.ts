import dns from 'node:dns';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
  sleep,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import { createSuperAppRunMetrics, parsePositiveInt } from './superappMetrics';

dns.setDefaultResultOrder('ipv4first');

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const browserLaunchOptions = launchOptions as Parameters<
  typeof puppeteer.launch
>[0];
const soakEnabled = process.env.SUPERAPP_ERP_SOAK === '1';
const soakDurationMs =
  parsePositiveInt(process.env.SUPERAPP_ERP_SOAK_MS) ?? 5 * 60 * 1000;
const soakBatchSize =
  parsePositiveInt(process.env.SUPERAPP_ERP_SOAK_BATCH) ?? 8;
const soakBatchIntervalMs =
  parsePositiveInt(process.env.SUPERAPP_ERP_SOAK_BATCH_INTERVAL_MS) ?? 250;
const soakUiEveryBatches =
  parsePositiveInt(process.env.SUPERAPP_ERP_SOAK_UI_EVERY) ?? 4;
const describeSoak = soakEnabled ? describe : describe.skip;

setSuiteTimeout(soakDurationMs + 1000 * 60 * 4);

type AppProcess = Awaited<ReturnType<typeof modernServe>>;
type SuperAppRunMetrics = ReturnType<typeof createSuperAppRunMetrics>;

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

async function postJson(port: number, pathname: string, payload?: unknown) {
  return fetch(`${host}:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function getJson(port: number, pathname: string) {
  const response = await fetch(`${host}:${port}${pathname}`);
  expect(response.status).toBe(200);
  return response.json();
}

async function resetSuperApp(port: number) {
  const response = await postJson(port, '/bff-api/effect/reset');
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    pendingApprovals: 2,
    totalMessages: 2,
  });
}

async function decideApproval(
  port: number,
  id: string,
  decision: 'approved' | 'rejected',
  actor: string,
) {
  const response = await postJson(
    port,
    `/bff-api/effect/approval/${id}/decision`,
    {
      decision,
      actor,
    },
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function sendChatMessage(
  port: number,
  batch: number,
  index: number,
  priority: 'normal' | 'urgent',
) {
  const response = await postJson(port, '/bff-api/effect/chat/send', {
    channel: index % 2 === 0 ? 'incident-war-room' : 'finance-control',
    author: `soak.agent.${index + 1}`,
    text: `soak batch ${batch} event ${index + 1}`,
    priority,
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function assertShellAndRoutes(page: Page, port: number) {
  await page.goto(`${host}:${port}/`, {
    waitUntil: ['networkidle0'],
    timeout: 50000,
  });
  await page.waitForSelector('[data-testid="dashboard-ready"]');
  await expect(
    page.$eval('[data-testid="tenant-name"]', el => el.textContent),
  ).resolves.toContain('Acme Global Operations');
  await expect(
    page.$eval('[data-testid="route-kind"]', el => el.textContent),
  ).resolves.toBe('executive-command-center');

  await page.click('[data-testid="nav-approvals"]');
  await page.waitForSelector('[data-testid="approvals-page"]');
  await expect(
    page.$eval('[data-testid="route-kind"]', el => el.textContent),
  ).resolves.toBe('finance-approval-workflow');

  await page.click('[data-testid="nav-chat"]');
  await page.waitForSelector('[data-testid="chat-page"]');
  await expect(
    page.$eval('[data-testid="route-kind"]', el => el.textContent),
  ).resolves.toBe('ops-chat-command-channel');
}

describeSoak('SuperApp ERP long-running production soak', () => {
  let app: AppProcess;
  let browser: Browser;
  let page: Page;
  let port: number;
  let browserErrors: string[];
  let runMetrics: SuperAppRunMetrics | undefined;

  beforeAll(async () => {
    runMetrics = createSuperAppRunMetrics({
      appDir,
      suite: 'superapp-erp-soak',
      parameters: {
        durationMs: soakDurationMs,
        batchSize: soakBatchSize,
        batchIntervalMs: soakBatchIntervalMs,
        uiEveryBatches: soakUiEveryBatches,
      },
      budgets: {
        browserErrors: 0,
        finalPendingApprovals: 0,
      },
    });
    port = await getPort();
    const buildResult = await runMetrics.timed('build', () =>
      modernBuild(appDir),
    );
    runMetrics.recordMemory('after-build');
    expect(buildResult.value.code).toBe(0);
    const serveResult = await runMetrics.timed('serve', () =>
      modernServe(appDir, port, {
        cwd: appDir,
        stderr: false,
        stdout: false,
      }),
    );
    app = serveResult.value;
    runMetrics.recordMemory('after-serve');
    browser = await puppeteer.launch(browserLaunchOptions);
    page = await browser.newPage();
    browserErrors = captureBrowserErrors(page);
  });

  afterAll(async () => {
    try {
      runMetrics?.recordBrowserErrors(browserErrors ?? []);
      runMetrics?.writeSummary();
    } finally {
      await page?.close();
      await browser?.close();
      await killApp(app);
    }
  });

  test('keeps Effect state and TanStack navigation stable under sustained workflow load', async () => {
    await runMetrics!.timed('reset', () => resetSuperApp(port));
    runMetrics?.recordMemory('after-reset');
    await expect(
      runMetrics!
        .timed('approval:ap-1001', () =>
          decideApproval(port, 'ap-1001', 'approved', 'finance.lead'),
        )
        .then(result => result.value),
    ).resolves.toMatchObject({
      id: 'ap-1001',
      status: 'approved',
      pendingApprovals: 1,
    });
    await expect(
      runMetrics!
        .timed('approval:ap-1002', () =>
          decideApproval(port, 'ap-1002', 'rejected', 'ops.manager'),
        )
        .then(result => result.value),
    ).resolves.toMatchObject({
      id: 'ap-1002',
      status: 'rejected',
      pendingApprovals: 0,
    });
    runMetrics?.recordMemory('after-decisions');

    const startedAt = Date.now();
    const deadline = startedAt + soakDurationMs;
    let expectedMessages = 2;
    let expectedUrgentMessages = 1;
    let batches = 0;

    while (Date.now() < deadline) {
      batches += 1;
      const payloads = await Promise.all(
        Array.from({ length: soakBatchSize }, (_, index) => {
          const priority = index % 5 === 0 ? 'urgent' : 'normal';
          return runMetrics!
            .timed('chat:send', () =>
              sendChatMessage(port, batches, index, priority),
            )
            .then(result => result.value);
        }),
      );
      expectedMessages += soakBatchSize;
      expectedUrgentMessages += payloads.filter(
        payload => payload.message.priority === 'urgent',
      ).length;

      const bootstrap = (
        await runMetrics!.timed('bootstrap', () =>
          getJson(port, '/bff-api/effect/bootstrap'),
        )
      ).value;
      expect(bootstrap.summary).toMatchObject({
        pendingApprovals: 0,
        urgentMessages: expectedUrgentMessages,
        totalOpenWork: 43,
      });
      expect(bootstrap.chat).toHaveLength(expectedMessages);
      expect(
        bootstrap.approvals.map(
          (approval: { id: string; status: string }) =>
            `${approval.id}:${approval.status}`,
        ),
      ).toEqual(['ap-1001:approved', 'ap-1002:rejected']);

      if (batches % soakUiEveryBatches === 0) {
        runMetrics?.recordMemory(`after-batch-${batches}`);
        await runMetrics!.timed(
          'routes:assert-shell-and-routes',
          () => assertShellAndRoutes(page, port),
          { route: true },
        );
        runMetrics?.recordMemory(`after-route-check-${batches}`);
      }

      await sleep(soakBatchIntervalMs);
    }

    await runMetrics!.timed(
      'routes:assert-shell-and-routes',
      () => assertShellAndRoutes(page, port),
      { route: true },
    );
    runMetrics?.recordMemory('after-final-route-check');
    expect(batches).toBeGreaterThan(0);
    const finalBootstrap = (
      await runMetrics!.timed('bootstrap:final', () =>
        getJson(port, '/bff-api/effect/bootstrap'),
      )
    ).value;
    runMetrics?.recordInvariant('finalBatchCount', batches);
    runMetrics?.recordInvariant('expectedMessageCount', expectedMessages);
    runMetrics?.recordInvariant(
      'finalMessageCount',
      finalBootstrap.chat.length,
    );
    runMetrics?.recordInvariant('expectedUrgentCount', expectedUrgentMessages);
    runMetrics?.recordInvariant(
      'finalUrgentCount',
      finalBootstrap.summary.urgentMessages,
    );
    runMetrics?.recordInvariant(
      'finalPendingApprovals',
      finalBootstrap.summary.pendingApprovals,
    );
    runMetrics?.recordInvariant('browserErrorCount', browserErrors.length);
    expect(browserErrors).toEqual([]);
  });
});
